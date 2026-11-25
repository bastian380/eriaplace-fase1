const express = require('express');
const pool = require('../db');
const { verificarToken, requireRol } = require('../middleware/auth');
const { notificar } = require('../notificar');
const { ROLES_GESTION, filtroFerias } = require('../permisos');
const { cerrarInscripcion, vencerOfertas } = require('../listaEspera');

const router = express.Router();

// Lugar en la fila: cuántas personas siguen esperando antes, incluyendo a esta
const SQL_POSICION = `CASE WHEN e.estado = 'esperando' THEN
  (SELECT COUNT(*) FROM lista_espera a WHERE a.feria_id = e.feria_id AND a.estado = 'esperando' AND a.id <= e.id) END AS posicion`;

// El comerciante se anota en la lista de una feria sin puestos libres
router.post('/', verificarToken, requireRol('comerciante'), async (req, res) => {
  const feriaId = Number(req.body.feria_id);
  const rubro = String(req.body.rubro || '').trim().slice(0, 120);
  const comentario = String(req.body.comentario || '').trim().slice(0, 500) || null;
  if (!Number.isInteger(feriaId)) return res.status(400).json({ error: 'Debes elegir una feria' });
  if (!rubro) return res.status(400).json({ error: 'El rubro es obligatorio' });
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const [[feria]] = await conexion.query('SELECT id, nombre, admin_feria_id FROM feria WHERE id = ? AND publicada = 1 FOR UPDATE', [feriaId]);
    if (!feria) {
      await conexion.rollback();
      return res.status(400).json({ error: 'La feria elegida no existe o no está disponible' });
    }
    const [[{ libres }]] = await conexion.query(
      "SELECT COUNT(*) AS libres FROM puesto WHERE feria_id = ? AND estado = 'disponible'", [feriaId]);
    if (libres > 0) {
      await conexion.rollback();
      return res.status(409).json({ error: 'Esta feria todavía tiene puestos libres: envía una solicitud normal' });
    }
    const [repetida] = await conexion.query(
      "SELECT id FROM lista_espera WHERE feria_id = ? AND usuario_id = ? AND estado IN ('esperando', 'ofrecido')", [feriaId, req.usuario.id]);
    if (repetida.length > 0) {
      await conexion.rollback();
      return res.status(409).json({ error: 'Ya estás en la lista de espera de esta feria' });
    }
    const [resultado] = await conexion.query(
      'INSERT INTO lista_espera (feria_id, usuario_id, rubro, comentario) VALUES (?, ?, ?, ?)',
      [feriaId, req.usuario.id, rubro, comentario]
    );
    const [[{ posicion }]] = await conexion.query(
      "SELECT COUNT(*) AS posicion FROM lista_espera WHERE feria_id = ? AND estado = 'esperando' AND id <= ?", [feriaId, resultado.insertId]);
    await conexion.commit();
    return res.status(201).json({ id: resultado.insertId, posicion });
  } catch (err) {
    await conexion.rollback();
    console.error(err);
    return res.status(500).json({ error: 'Error al anotarte en la lista de espera' });
  } finally {
    conexion.release();
  }
});

router.get('/mias', verificarToken, requireRol('comerciante'), async (req, res) => {
  try {
    await vencerOfertas();
    const [filas] = await pool.query(
      `SELECT e.id, e.estado, e.rubro, e.oferta_vence, f.nombre AS feria_nombre, p.codigo AS puesto_codigo, p.zona AS puesto_zona,
              COALESCE(p.precio, f.precio_puesto) AS monto, ${SQL_POSICION}
       FROM lista_espera e JOIN feria f ON f.id = e.feria_id LEFT JOIN puesto p ON p.id = e.puesto_id
       WHERE e.usuario_id = ? AND e.estado IN ('esperando', 'ofrecido') ORDER BY e.id`,
      [req.usuario.id]
    );
    return res.json(filas.map((f) => ({ ...f, posicion: f.posicion === null ? null : Number(f.posicion) })));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error al obtener tu lista de espera' });
  }
});

// La plataforma ve todas las filas; el Administrador de Feria, las de sus ferias
router.get('/', verificarToken, requireRol(...ROLES_GESTION), async (req, res) => {
  try {
    await vencerOfertas();
    const filtro = filtroFerias(req);
    const [filas] = await pool.query(
      `SELECT e.id, e.estado, e.rubro, e.comentario, e.oferta_vence, e.creado_en, f.nombre AS feria_nombre,
              u.nombre AS comerciante_nombre, u.email AS comerciante_email, p.codigo AS puesto_codigo, ${SQL_POSICION}
       FROM lista_espera e JOIN feria f ON f.id = e.feria_id JOIN usuario u ON u.id = e.usuario_id
       LEFT JOIN puesto p ON p.id = e.puesto_id
       WHERE ${filtro.sql} AND e.estado IN ('esperando', 'ofrecido')
       ORDER BY f.nombre, e.id`,
      filtro.params
    );
    return res.json(filas.map((f) => ({ ...f, posicion: f.posicion === null ? null : Number(f.posicion) })));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error al obtener la lista de espera' });
  }
});

// El comerciante acepta el puesto ofrecido: queda asignado igual que si el administrador se lo hubiera dado
router.post('/:id/aceptar', verificarToken, requireRol('comerciante'), async (req, res) => {
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const [[e]] = await conexion.query(
      'SELECT *, oferta_vence > NOW() AS vigente FROM lista_espera WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!e || e.usuario_id !== req.usuario.id) {
      await conexion.rollback();
      return res.status(404).json({ error: 'Inscripción no encontrada' });
    }
    if (e.estado !== 'ofrecido' || !e.vigente) {
      await conexion.rollback();
      await vencerOfertas();
      return res.status(409).json({ error: 'Esta oferta ya no está vigente' });
    }
    const [[puesto]] = await conexion.query(
      `SELECT p.id, p.codigo, COALESCE(p.precio, f.precio_puesto) AS monto, f.nombre AS feria, f.admin_feria_id
       FROM puesto p JOIN feria f ON f.id = p.feria_id WHERE p.id = ? FOR UPDATE`, [e.puesto_id]);
    const [resultado] = await conexion.query(
      `INSERT INTO solicitud (usuario_id, feria_id, rubro, comentario, estado, puesto_id, monto, estado_pago, resuelto_en)
       VALUES (?, ?, ?, ?, 'confirmada', ?, ?, 'pendiente', NOW())`,
      [e.usuario_id, e.feria_id, e.rubro, e.comentario, puesto.id, puesto.monto]
    );
    await conexion.query("UPDATE lista_espera SET estado = 'aceptado', oferta_vence = NULL WHERE id = ?", [e.id]);
    await conexion.commit();
    await notificar(e.usuario_id, {
      titulo: `Te asignamos el puesto ${puesto.codigo}`,
      mensaje: `Aceptaste el puesto ${puesto.codigo} de "${puesto.feria}". En "Mis solicitudes" puedes pagarlo y ver tu credencial.`,
      enlace: 'mis-solicitudes.html',
    });
    if (puesto.admin_feria_id) {
      await notificar(puesto.admin_feria_id, {
        titulo: `Puesto ${puesto.codigo} tomado desde la lista de espera`,
        mensaje: `${req.usuario.nombre} aceptó el puesto ${puesto.codigo} de "${puesto.feria}".`,
        enlace: 'admin.html',
      });
    }
    return res.json({ solicitud_id: resultado.insertId, puesto: puesto.codigo, monto: puesto.monto });
  } catch (err) {
    await conexion.rollback();
    console.error(err);
    return res.status(500).json({ error: 'Error al aceptar el puesto' });
  } finally {
    conexion.release();
  }
});

// El comerciante rechaza la oferta o se sale de la fila
router.post('/:id/salir', verificarToken, requireRol('comerciante'), async (req, res) => {
  try {
    const [[e]] = await pool.query('SELECT usuario_id FROM lista_espera WHERE id = ?', [req.params.id]);
    if (!e || e.usuario_id !== req.usuario.id) return res.status(404).json({ error: 'Inscripción no encontrada' });
    if (!(await cerrarInscripcion(Number(req.params.id), 'cancelado'))) {
      return res.status(409).json({ error: 'Esta inscripción ya no está activa' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error al salir de la lista de espera' });
  }
});

module.exports = router;
