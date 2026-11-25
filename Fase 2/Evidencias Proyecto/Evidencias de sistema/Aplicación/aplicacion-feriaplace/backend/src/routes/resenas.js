// Calificaciones y reseñas de un puesto. La reseña es del comerciante que atiende el puesto (su solicitud confirmada),
// no del lugar: si el puesto cambia de manos, el nuevo parte de cero.
const express = require('express');
const pool = require('../db');
const { verificarToken, usuarioOpcional, requireRol } = require('../middleware/auth');
const { ROLES_GESTION, puedeGestionar } = require('../permisos');
const { hoyEnChile } = require('../credencial');

const router = express.Router();

const SQL_ATENCION = `
  SELECT s.id, s.usuario_id, s.rubro, f.admin_feria_id, f.publicada,
         DATE_FORMAT(f.fecha_inicio, '%Y-%m-%d') AS fecha_inicio
  FROM solicitud s JOIN feria f ON f.id = s.feria_id
  WHERE s.estado = 'confirmada'`;

const yaEmpezo = (s) => !s.fecha_inicio || s.fecha_inicio <= hoyEnChile();
const nombreCorto = (nombre) => String(nombre).trim().split(/\s+/)[0];

// Reseñas de quien atiende hoy un puesto. Quien gestiona la feria también ve las ocultas, para poder reactivarlas.
router.get('/puesto/:id', usuarioOpcional, async (req, res) => {
  try {
    const [[atencion]] = await pool.query(`${SQL_ATENCION} AND s.puesto_id = ? ORDER BY s.id DESC LIMIT 1`, [req.params.id]);
    if (!atencion || !atencion.publicada) return res.json({ solicitud_id: null, total: 0, promedio: null, resenas: [] });
    const gestiona = Boolean(req.usuario) && puedeGestionar(req, atencion);
    const [filas] = await pool.query(
      `SELECT r.id, r.usuario_id, r.estrellas, r.comentario, r.oculta, r.creado_en, u.nombre
       FROM resena r JOIN usuario u ON u.id = r.usuario_id
       WHERE r.solicitud_id = ? ${gestiona ? '' : 'AND r.oculta = 0'}
       ORDER BY r.id DESC LIMIT 30`,
      [atencion.id]
    );
    const visibles = filas.filter((r) => !r.oculta);
    const [[resumen]] = await pool.query(
      'SELECT COUNT(*) AS total, AVG(estrellas) AS promedio FROM resena WHERE solicitud_id = ? AND oculta = 0', [atencion.id]);
    const mia = req.usuario ? visibles.find((r) => r.usuario_id === req.usuario.id) : null;
    return res.json({
      solicitud_id: atencion.id,
      rubro: atencion.rubro,
      total: Number(resumen.total),
      promedio: resumen.promedio === null ? null : Math.round(Number(resumen.promedio) * 10) / 10,
      puede_calificar: Boolean(req.usuario) && req.usuario.rol === 'comerciante' && req.usuario.id !== atencion.usuario_id && yaEmpezo(atencion),
      gestiona,
      mia: mia ? { estrellas: mia.estrellas, comentario: mia.comentario } : null,
      resenas: filas.map((r) => ({
        id: r.id, estrellas: r.estrellas, comentario: r.comentario, creado_en: r.creado_en,
        autor: nombreCorto(r.nombre), oculta: Boolean(r.oculta),
      })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error al obtener las reseñas' });
  }
});

// Un comerciante deja (o cambia) su reseña: una por persona y por puesto atendido
router.post('/', verificarToken, requireRol('comerciante'), async (req, res) => {
  const estrellas = Number(req.body.estrellas);
  const comentario = String(req.body.comentario || '').trim().slice(0, 500) || null;
  if (!Number.isInteger(estrellas) || estrellas < 1 || estrellas > 5) {
    return res.status(400).json({ error: 'La calificación debe ser de 1 a 5 estrellas' });
  }
  try {
    const [[atencion]] = await pool.query(`${SQL_ATENCION} AND s.id = ?`, [req.body.solicitud_id]);
    if (!atencion || !atencion.publicada) return res.status(404).json({ error: 'Ese puesto no está disponible para calificar' });
    if (atencion.usuario_id === req.usuario.id) return res.status(403).json({ error: 'No puedes calificar tu propio puesto' });
    if (!yaEmpezo(atencion)) return res.status(409).json({ error: 'Podrás calificar este puesto cuando la feria haya empezado' });
    await pool.query(
      `INSERT INTO resena (solicitud_id, usuario_id, estrellas, comentario) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE estrellas = VALUES(estrellas), comentario = VALUES(comentario)`,
      [atencion.id, req.usuario.id, estrellas, comentario]
    );
    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error al guardar la reseña' });
  }
});

// Quien gestiona la feria oculta una reseña ofensiva (o la vuelve a mostrar)
router.put('/:id/oculta', verificarToken, requireRol(...ROLES_GESTION), async (req, res) => {
  try {
    const [[fila]] = await pool.query(
      `SELECT f.admin_feria_id FROM resena r JOIN solicitud s ON s.id = r.solicitud_id JOIN feria f ON f.id = s.feria_id WHERE r.id = ?`,
      [req.params.id]
    );
    if (!fila) return res.status(404).json({ error: 'Reseña no encontrada' });
    if (!puedeGestionar(req, fila)) return res.status(403).json({ error: 'Esta reseña es de una feria que administra otra persona' });
    const oculta = Boolean(req.body.oculta);
    await pool.query('UPDATE resena SET oculta = ? WHERE id = ?', [oculta ? 1 : 0, req.params.id]);
    return res.json({ oculta });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error al actualizar la reseña' });
  }
});

module.exports = router;
