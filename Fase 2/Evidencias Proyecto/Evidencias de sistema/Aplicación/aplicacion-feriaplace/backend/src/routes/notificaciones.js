const express = require('express');
const pool = require('../db');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();

// Los avisos del usuario con sesión, del más nuevo al más antiguo, y cuántos no ha leído
router.get('/', verificarToken, async (req, res) => {
  try {
    const [avisos] = await pool.query(
      `SELECT id, titulo, mensaje, enlace, leida, enviada_correo, creado_en
       FROM notificacion WHERE usuario_id = ? ORDER BY creado_en DESC, id DESC LIMIT 50`,
      [req.usuario.id]
    );
    const lista = avisos.map((a) => ({ ...a, leida: Boolean(a.leida), enviada_correo: Boolean(a.enviada_correo) }));
    res.json({ no_leidas: lista.filter((a) => !a.leida).length, avisos: lista });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener los avisos' });
  }
});

// Marca todos los avisos como leídos (al abrir la página de avisos)
router.put('/leidas', verificarToken, async (req, res) => {
  await pool.query('UPDATE notificacion SET leida = 1 WHERE usuario_id = ? AND leida = 0', [req.usuario.id]);
  res.json({ ok: true });
});

module.exports = router;
