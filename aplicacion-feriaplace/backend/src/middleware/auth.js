const jwt = require('jsonwebtoken');
const pool = require('../db');

async function verificarToken(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }
  const token = header.slice('Bearer '.length);
  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
  // Si el administrador rechaza una cuenta, la sesión que ya tenía abierta deja de servir
  try {
    const [filas] = await pool.query('SELECT rol, estado FROM usuario WHERE id = ?', [req.usuario.id]);
    if (filas.length === 0) {
      return res.status(401).json({ error: 'La cuenta ya no existe' });
    }
    if (filas[0].rol !== 'administrador' && filas[0].estado !== 'aprobado') {
      return res.status(403).json({ error: 'Tu cuenta no está aprobada por el administrador' });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error al verificar la cuenta' });
  }
  next();
}

// Lee el token si viene, pero deja pasar a visitantes sin sesión
function usuarioOpcional(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      req.usuario = jwt.verify(header.slice('Bearer '.length), process.env.JWT_SECRET);
    } catch (err) {
      req.usuario = null;
    }
  }
  next();
}

function requireRol(...roles) {
  return (req, res, next) => {
    if (!req.usuario || !roles.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    next();
  };
}

module.exports = { verificarToken, usuarioOpcional, requireRol };
