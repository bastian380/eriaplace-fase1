const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { verificarToken } = require('../middleware/auth');
const limite = require('../middleware/limite-intentos');
const { CLAVE_DE_EJEMPLO } = require('../seed');

const router = express.Router();

const LARGO_MINIMO_CLAVE = 8;

router.post('/registro', async (req, res) => {
  const { nombre, email, password } = req.body;
  const telefono = String(req.body.telefono || '').trim();
  const motivo = String(req.body.motivo_registro || '').trim();
  if (!nombre || !email || !password) {
    return res.status(400).json({ error: 'Nombre, email y password son obligatorios' });
  }
  if (password.length < LARGO_MINIMO_CLAVE) {
    return res.status(400).json({ error: `La contraseña debe tener al menos ${LARGO_MINIMO_CLAVE} caracteres` });
  }
  if (motivo.length < 10) {
    return res.status(400).json({ error: 'Cuéntanos qué quieres vender y por qué te interesa un puesto (al menos 10 caracteres)' });
  }
  if (motivo.length > 500 || telefono.length > 30) {
    return res.status(400).json({ error: 'El motivo admite hasta 500 caracteres y el teléfono hasta 30' });
  }
  try {
    const [existentes] = await pool.query('SELECT id FROM usuario WHERE email = ?', [email]);
    if (existentes.length > 0) {
      return res.status(409).json({ error: 'Ese email ya está registrado' });
    }
    const hash = await bcrypt.hash(password, 10);
    const [resultado] = await pool.query(
      'INSERT INTO usuario (nombre, email, telefono, password_hash, rol, estado, motivo_registro) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [nombre, email, telefono || null, hash, 'comerciante', 'pendiente', motivo]
    );
    return res.status(201).json({ id: resultado.insertId, nombre, email, rol: 'comerciante', estado: 'pendiente' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error al registrar usuario' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email y password son obligatorios' });
  }
  const minutos = limite.minutosBloqueado(req, email);
  if (minutos > 0) {
    return res.status(429).json({
      error: `Demasiados intentos fallidos. Espera ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} y vuelve a intentarlo.`,
    });
  }
  try {
    const [filas] = await pool.query('SELECT * FROM usuario WHERE email = ?', [email]);
    const usuario = filas[0];
    const coincide = usuario ? await bcrypt.compare(password, usuario.password_hash) : false;
    if (!coincide) {
      limite.registrarFallo(req, email);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    limite.limpiar(req, email);
    // Solo las cuentas aprobadas por el administrador pueden entrar (los administradores siempre pueden)
    if (usuario.rol !== 'administrador' && usuario.estado === 'pendiente') {
      return res.status(403).json({ error: 'Tu cuenta todavía está esperando la aprobación del administrador.' });
    }
    if (usuario.rol !== 'administrador' && usuario.estado === 'rechazado') {
      const motivo = usuario.comentario_admin ? ` Motivo: ${usuario.comentario_admin}` : '';
      return res.status(403).json({ error: `Tu solicitud de cuenta fue rechazada por el administrador.${motivo}` });
    }
    const token = jwt.sign(
      { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    // Avisa al administrador si sigue entrando con la clave de ejemplo del README
    const claveDeEjemplo = usuario.rol === 'administrador' && password === CLAVE_DE_EJEMPLO;
    return res.json({
      token,
      usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol },
      clave_de_ejemplo: claveDeEjemplo,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// Cualquier usuario con sesión cambia su propia contraseña indicando la actual
router.put('/password', verificarToken, async (req, res) => {
  const { actual, nueva } = req.body;
  if (!actual || !nueva) {
    return res.status(400).json({ error: 'Escribe tu contraseña actual y la nueva' });
  }
  if (nueva.length < LARGO_MINIMO_CLAVE) {
    return res.status(400).json({ error: `La contraseña nueva debe tener al menos ${LARGO_MINIMO_CLAVE} caracteres` });
  }
  if (nueva === CLAVE_DE_EJEMPLO) {
    return res.status(400).json({ error: 'Esa es la contraseña de ejemplo del proyecto. Elige otra.' });
  }
  if (nueva === actual) {
    return res.status(400).json({ error: 'La contraseña nueva debe ser distinta de la actual' });
  }
  try {
    const [[usuario]] = await pool.query('SELECT password_hash FROM usuario WHERE id = ?', [req.usuario.id]);
    if (!(await bcrypt.compare(actual, usuario.password_hash))) {
      return res.status(400).json({ error: 'La contraseña actual no es correcta' });
    }
    const hash = await bcrypt.hash(nueva, 10);
    await pool.query('UPDATE usuario SET password_hash = ? WHERE id = ?', [hash, req.usuario.id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error al cambiar la contraseña' });
  }
});

module.exports = router;
