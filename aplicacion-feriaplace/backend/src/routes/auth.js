const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const router = express.Router();

router.post('/registro', async (req, res) => {
  const { nombre, email, password } = req.body;
  const telefono = String(req.body.telefono || '').trim();
  const motivo = String(req.body.motivo_registro || '').trim();
  if (!nombre || !email || !password) {
    return res.status(400).json({ error: 'Nombre, email y password son obligatorios' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
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
  try {
    const [filas] = await pool.query('SELECT * FROM usuario WHERE email = ?', [email]);
    if (filas.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    const usuario = filas[0];
    const coincide = await bcrypt.compare(password, usuario.password_hash);
    if (!coincide) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
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
    return res.json({ token, usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

module.exports = router;
