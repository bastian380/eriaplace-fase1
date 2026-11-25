// Asistencia del día: quien gestiona la feria escanea la credencial QR del comerciante (o lo marca a mano).
const express = require('express');
const pool = require('../db');
const { verificarToken, requireRol } = require('../middleware/auth');
const { ROLES_GESTION, puedeGestionar, feriaGestionable } = require('../permisos');
const { leerCodigo, hoyEnChile } = require('../credencial');

const router = express.Router();

router.use(verificarToken, requireRol(...ROLES_GESTION));

// Registra la asistencia de hoy. Si ya estaba registrada no la duplica y lo avisa.
async function registrar(req, res, solicitudId, metodo) {
  const [[c]] = await pool.query(
    `SELECT s.id, s.estado, s.estado_pago, s.rubro, u.nombre AS titular, p.codigo AS puesto, f.nombre AS feria, f.admin_feria_id,
            DATE_FORMAT(f.fecha_inicio, '%Y-%m-%d') AS fecha_inicio, DATE_FORMAT(f.fecha_cierre, '%Y-%m-%d') AS fecha_cierre
     FROM solicitud s JOIN usuario u ON u.id = s.usuario_id
     LEFT JOIN puesto p ON p.id = s.puesto_id LEFT JOIN feria f ON f.id = s.feria_id
     WHERE s.id = ?`,
    [solicitudId]
  );
  if (!c) return res.status(404).json({ error: 'La credencial no corresponde a ningún puesto' });
  if (!puedeGestionar(req, c)) return res.status(403).json({ error: 'Esta credencial es de una feria que administra otra persona' });
  if (c.estado !== 'confirmada') return res.status(409).json({ error: 'Este puesto ya no está asignado a esta persona' });
  const hoy = hoyEnChile();
  if (c.fecha_inicio && hoy < c.fecha_inicio) return res.status(409).json({ error: 'La feria todavía no empieza' });
  if (c.fecha_cierre && hoy > c.fecha_cierre) return res.status(409).json({ error: 'La feria ya terminó' });
  const [resultado] = await pool.query(
    'INSERT IGNORE INTO asistencia (solicitud_id, fecha, metodo, registrado_por) VALUES (?, ?, ?, ?)',
    [c.id, hoy, metodo, req.usuario.id]
  );
  return res.status(resultado.affectedRows ? 201 : 200).json({
    ya_registrada: resultado.affectedRows === 0,
    titular: c.titular, puesto: c.puesto, feria: c.feria, rubro: c.rubro, pagado: c.estado_pago === 'pagado',
  });
}

// El lector entrega la dirección completa de verificación; también se acepta el código escrito a mano
function extraerCodigo(valor) {
  const texto = String(valor || '').trim();
  const enUrl = /[?&]c=([^&#\s]+)/.exec(texto);
  return enUrl ? enUrl[1] : texto;
}

router.post('/qr', async (req, res) => {
  const id = leerCodigo(extraerCodigo(req.body.codigo));
  if (!id) return res.status(404).json({ error: 'El código no corresponde a ninguna credencial de FeriaPlace' });
  try {
    return await registrar(req, res, id, 'qr');
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error al registrar la asistencia' });
  }
});

router.post('/manual', async (req, res) => {
  try {
    return await registrar(req, res, Number(req.body.solicitud_id), 'manual');
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error al registrar la asistencia' });
  }
});

// Corrige un registro de hoy hecho por error
router.delete('/:solicitudId', async (req, res) => {
  try {
    const [[fila]] = await pool.query(
      'SELECT f.admin_feria_id FROM solicitud s JOIN feria f ON f.id = s.feria_id WHERE s.id = ?', [req.params.solicitudId]);
    if (!fila) return res.status(404).json({ error: 'Puesto no encontrado' });
    if (!puedeGestionar(req, fila)) return res.status(403).json({ error: 'Esta feria la administra otra persona' });
    await pool.query('DELETE FROM asistencia WHERE solicitud_id = ? AND fecha = ?', [req.params.solicitudId, hoyEnChile()]);
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error al corregir la asistencia' });
  }
});

// Todos los puestos asignados de una feria y quién llegó ese día
router.get('/', async (req, res) => {
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.fecha || '')) ? req.query.fecha : hoyEnChile();
  try {
    const permiso = await feriaGestionable(req, req.query.feria_id);
    if (permiso.error) return res.status(permiso.status).json({ error: permiso.error });
    const [filas] = await pool.query(
      `SELECT s.id AS solicitud_id, u.nombre AS titular, p.codigo AS puesto, s.rubro, s.estado_pago,
              a.metodo, DATE_FORMAT(a.creado_en, '%H:%i') AS hora
       FROM solicitud s
       JOIN usuario u ON u.id = s.usuario_id
       JOIN puesto p ON p.id = s.puesto_id
       LEFT JOIN asistencia a ON a.solicitud_id = s.id AND a.fecha = ?
       WHERE s.feria_id = ? AND s.estado = 'confirmada'
       ORDER BY p.codigo`,
      [fecha, permiso.feria.id]
    );
    const puestos = filas.map((f) => ({
      solicitud_id: f.solicitud_id, titular: f.titular, puesto: f.puesto, rubro: f.rubro,
      pagado: f.estado_pago === 'pagado', presente: Boolean(f.metodo), metodo: f.metodo, hora: f.hora,
    }));
    return res.json({ fecha, es_hoy: fecha === hoyEnChile(), total: puestos.length, presentes: puestos.filter((p) => p.presente).length, puestos });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error al obtener la asistencia' });
  }
});

module.exports = router;
