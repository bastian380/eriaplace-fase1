const express = require('express');
const QRCode = require('qrcode');
const pool = require('../db');
const { verificarToken } = require('../middleware/auth');
const { codigoCredencial, leerCodigo } = require('../credencial');
const { urlApp } = require('../notificar');

const router = express.Router();

const SQL_CREDENCIAL = `
  SELECT s.id, s.usuario_id, s.estado, s.estado_pago, s.monto, s.rubro,
         u.nombre AS titular, p.codigo AS puesto, p.zona,
         f.nombre AS feria, f.lugar, f.comuna,
         DATE_FORMAT(f.fecha_inicio, '%Y-%m-%d') AS fecha_inicio,
         DATE_FORMAT(f.fecha_cierre, '%Y-%m-%d') AS fecha_cierre
  FROM solicitud s
  JOIN usuario u ON u.id = s.usuario_id
  LEFT JOIN puesto p ON p.id = s.puesto_id
  LEFT JOIN feria f ON f.id = s.feria_id
  WHERE s.id = ?`;

// Fecha de hoy en Chile, "AAAA-MM-DD"
function hoyEnChile() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
}

// Lo que ve el inspector: si la credencial vale hoy y si el puesto está pagado
function evaluar(c) {
  const hoy = hoyEnChile();
  let vigencia = 'sin_fechas';
  if (c.fecha_inicio && c.fecha_cierre) {
    if (hoy < c.fecha_inicio) vigencia = 'aun_no_empieza';
    else if (hoy > c.fecha_cierre) vigencia = 'terminada';
    else vigencia = 'en_curso';
  }
  return {
    valida: c.estado === 'confirmada',
    pagado: c.estado_pago === 'pagado',
    vigencia,
    titular: c.titular,
    rubro: c.rubro,
    feria: c.feria,
    lugar: c.lugar,
    comuna: c.comuna,
    puesto: c.puesto,
    zona: c.zona,
    fecha_inicio: c.fecha_inicio,
    fecha_cierre: c.fecha_cierre,
  };
}

// El comerciante (dueño de la solicitud) o el administrador obtienen la credencial con su código QR
router.get('/:id', verificarToken, async (req, res) => {
  try {
    const [[c]] = await pool.query(SQL_CREDENCIAL, [req.params.id]);
    const esDueno = c && c.usuario_id === req.usuario.id;
    if (!c || (!esDueno && req.usuario.rol !== 'administrador')) {
      return res.status(404).json({ error: 'Credencial no encontrada' });
    }
    if (c.estado !== 'confirmada') {
      return res.status(409).json({ error: 'La credencial existe solo para solicitudes con puesto asignado' });
    }
    const codigo = codigoCredencial(c.id);
    // El QR lleva a la página de verificación; si la app está publicada, el inspector la abre desde su celular
    const base = process.env.APP_URL ? urlApp() : `${req.protocol}://${req.get('host')}`;
    const url = `${base}/verificar.html?c=${codigo}`;
    const qr = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return res.json({ codigo, url, qr, ...evaluar(c), monto: c.monto });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error al generar la credencial' });
  }
});

// Verificación pública (la usa el inspector al escanear el QR). No pide sesión, pero sin la firma no muestra nada.
router.get('/verificar/:codigo', async (req, res) => {
  const id = leerCodigo(req.params.codigo);
  if (!id) return res.status(404).json({ error: 'El código no corresponde a ninguna credencial de FeriaPlace' });
  try {
    const [[c]] = await pool.query(SQL_CREDENCIAL, [id]);
    if (!c) return res.status(404).json({ error: 'El código no corresponde a ninguna credencial de FeriaPlace' });
    return res.json(evaluar(c));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error al verificar la credencial' });
  }
});

module.exports = router;
