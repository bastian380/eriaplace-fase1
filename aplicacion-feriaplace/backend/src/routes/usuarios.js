const express = require('express');
const pool = require('../db');
const { verificarToken, requireRol } = require('../middleware/auth');

const router = express.Router();

const ESTADOS = ['pendiente', 'aprobado', 'rechazado'];

// Cuentas de comerciante, para que el administrador apruebe o rechace a quienes se registran
router.get('/', verificarToken, requireRol('administrador'), async (req, res) => {
  const { estado } = req.query;
  if (estado && !ESTADOS.includes(estado)) {
    return res.status(400).json({ error: 'Estado no válido' });
  }
  try {
    const [filas] = await pool.query(
      `SELECT u.id, u.nombre, u.email, u.telefono, u.estado, u.motivo_registro, u.comentario_admin,
              u.creado_en, u.revisado_en,
              (SELECT COUNT(*) FROM solicitud s WHERE s.usuario_id = u.id) AS solicitudes
       FROM usuario u
       WHERE u.rol = 'comerciante' ${estado ? 'AND u.estado = ?' : ''}
       ORDER BY u.estado = 'pendiente' DESC, u.creado_en DESC`,
      estado ? [estado] : []
    );
    return res.json(filas);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

async function cambiarEstado(req, res, estado) {
  const comentario = String(req.body.comentario_admin || '').trim().slice(0, 500);
  try {
    const [resultado] = await pool.query(
      `UPDATE usuario SET estado = ?, comentario_admin = ?, revisado_en = NOW()
       WHERE id = ? AND rol = 'comerciante'`,
      [estado, estado === 'rechazado' ? comentario || null : null, req.params.id]
    );
    if (resultado.affectedRows === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    return res.json({ id: Number(req.params.id), estado });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error al actualizar el usuario' });
  }
}

router.put('/:id/aprobar', verificarToken, requireRol('administrador'), (req, res) => cambiarEstado(req, res, 'aprobado'));
router.put('/:id/rechazar', verificarToken, requireRol('administrador'), (req, res) => cambiarEstado(req, res, 'rechazado'));

module.exports = router;
