const express = require('express');
const pool = require('../db');
const { verificarToken, requireRol } = require('../middleware/auth');
const { notificar } = require('../notificar');

const router = express.Router();

const ESTADOS = ['pendiente', 'aprobado', 'rechazado'];
const ROLES_CLIENTES = ['comerciante', 'admin_feria'];

// Cuentas de comerciantes y de Administradores de Feria, para que la plataforma apruebe o rechace a quienes se registran
router.get('/', verificarToken, requireRol('administrador'), async (req, res) => {
  const { estado, rol } = req.query;
  if (estado && !ESTADOS.includes(estado)) {
    return res.status(400).json({ error: 'Estado no válido' });
  }
  if (rol && !ROLES_CLIENTES.includes(rol)) {
    return res.status(400).json({ error: 'Rol no válido' });
  }
  const condiciones = ["u.rol IN ('comerciante', 'admin_feria')"];
  const params = [];
  if (estado) { condiciones.push('u.estado = ?'); params.push(estado); }
  if (rol) { condiciones.push('u.rol = ?'); params.push(rol); }
  try {
    const [filas] = await pool.query(
      `SELECT u.id, u.nombre, u.email, u.telefono, u.rol, u.organizacion, u.estado, u.motivo_registro, u.comentario_admin,
              u.creado_en, u.revisado_en,
              (SELECT COUNT(*) FROM solicitud s WHERE s.usuario_id = u.id) AS solicitudes,
              (SELECT COUNT(*) FROM feria f WHERE f.admin_feria_id = u.id) AS ferias
       FROM usuario u
       WHERE ${condiciones.join(' AND ')}
       ORDER BY u.estado = 'pendiente' DESC, u.creado_en DESC`,
      params
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
    const [[cuenta]] = await pool.query('SELECT rol FROM usuario WHERE id = ?', [req.params.id]);
    const esAdminFeria = cuenta && cuenta.rol === 'admin_feria';
    const [resultado] = await pool.query(
      `UPDATE usuario SET estado = ?, comentario_admin = ?, revisado_en = NOW()
       WHERE id = ? AND rol IN ('comerciante', 'admin_feria')`,
      [estado, estado === 'rechazado' ? comentario || null : null, req.params.id]
    );
    if (resultado.affectedRows === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    await notificar(req.params.id, estado === 'aprobado'
      ? {
        titulo: 'Tu cuenta fue aprobada',
        mensaje: esAdminFeria
          ? 'Ya puedes iniciar sesión en FeriaPlace, crear tu feria con su plano y pedir su publicación.'
          : 'Ya puedes iniciar sesión en FeriaPlace y solicitar un puesto en las ferias publicadas.',
        enlace: esAdminFeria ? 'admin-ferias.html' : 'index.html',
      }
      : {
        titulo: 'Tu cuenta no fue aprobada',
        mensaje: `El administrador revisó tu solicitud de cuenta y no la aprobó.${comentario ? ` Motivo: ${comentario}` : ''}`,
      });
    return res.json({ id: Number(req.params.id), estado });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error al actualizar el usuario' });
  }
}

router.put('/:id/aprobar', verificarToken, requireRol('administrador'), (req, res) => cambiarEstado(req, res, 'aprobado'));
router.put('/:id/rechazar', verificarToken, requireRol('administrador'), (req, res) => cambiarEstado(req, res, 'rechazado'));

module.exports = router;
