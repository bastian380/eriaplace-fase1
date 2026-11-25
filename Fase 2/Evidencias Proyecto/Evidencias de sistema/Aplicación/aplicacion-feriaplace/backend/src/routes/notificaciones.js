const express = require('express');
const pool = require('../db');
const { verificarToken, requireRol } = require('../middleware/auth');
const { ROLES_GESTION, esPlataforma } = require('../permisos');
const { recordarPagos } = require('../recordatorios');

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

// Canales por los que cada usuario quiere recibir sus avisos
router.get('/preferencias', verificarToken, async (req, res) => {
  const [[u]] = await pool.query('SELECT telefono, avisar_correo, avisar_whatsapp FROM usuario WHERE id = ?', [req.usuario.id]);
  res.json({ telefono: u.telefono || '', avisar_correo: Boolean(u.avisar_correo), avisar_whatsapp: Boolean(u.avisar_whatsapp) });
});

router.put('/preferencias', verificarToken, async (req, res) => {
  const telefono = String(req.body.telefono || '').trim();
  const avisarWhatsapp = Boolean(req.body.avisar_whatsapp);
  if (telefono && !/^\+?[\d\s-]{8,20}$/.test(telefono)) {
    return res.status(400).json({ error: 'Escribe el teléfono con su código, por ejemplo +56 9 1234 5678' });
  }
  if (avisarWhatsapp && !telefono) {
    return res.status(400).json({ error: 'Para recibir avisos por WhatsApp necesitamos tu teléfono' });
  }
  await pool.query(
    'UPDATE usuario SET telefono = ?, avisar_correo = ?, avisar_whatsapp = ? WHERE id = ?',
    [telefono || null, req.body.avisar_correo ? 1 : 0, avisarWhatsapp ? 1 : 0, req.usuario.id]
  );
  res.json({ ok: true });
});

// Bandeja de envíos (solo la plataforma): qué correos y WhatsApp salieron o se simularon
router.get('/envios', verificarToken, requireRol('administrador'), async (req, res) => {
  const [filas] = await pool.query(
    `SELECT e.id, e.canal, e.destino, e.estado, e.creado_en, n.titulo, n.mensaje, u.nombre
     FROM envio_aviso e JOIN notificacion n ON n.id = e.notificacion_id JOIN usuario u ON u.id = n.usuario_id
     ORDER BY e.id DESC LIMIT 100`
  );
  res.json(filas);
});

// Quien gestiona ferias envía ahora los recordatorios de pago (de sus ferias, si es Administrador de Feria)
router.post('/recordatorios', verificarToken, requireRol(...ROLES_GESTION), async (req, res) => {
  try {
    const enviados = await recordarPagos({
      incluirSinFecha: true,
      adminFeriaId: esPlataforma(req) ? undefined : req.usuario.id,
    });
    res.json({ enviados });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al enviar los recordatorios' });
  }
});

module.exports = router;
