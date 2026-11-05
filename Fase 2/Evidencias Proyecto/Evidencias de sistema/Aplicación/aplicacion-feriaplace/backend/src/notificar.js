// Avisos al comerciante: cada aviso queda guardado en la tabla notificacion (se ve en "Avisos" dentro de la app)
// y, si hay un servidor de correo configurado en .env (SMTP_HOST, etc.), también se envía por email.
// Un aviso nunca hace fallar la acción que lo originó: si el correo falla, solo queda anotado en la consola.
const nodemailer = require('nodemailer');
const pool = require('./db');

let transporte = null;
function obtenerTransporte() {
  if (!process.env.SMTP_HOST) return null;
  if (!transporte) {
    transporte = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporte;
}

// Dirección pública de la app para los enlaces de los correos (en tu PC, http://localhost:4000)
function urlApp() {
  return (process.env.APP_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, '');
}

async function enviarCorreo(id, usuario, { titulo, mensaje, enlace }) {
  const smtp = obtenerTransporte();
  if (!smtp || !usuario.email) return;
  try {
    const link = enlace ? `${urlApp()}/${enlace}` : urlApp();
    await smtp.sendMail({
      from: process.env.CORREO_REMITENTE || process.env.SMTP_USER,
      to: usuario.email,
      subject: `FeriaPlace: ${titulo}`,
      text: `Hola ${usuario.nombre}:\n\n${mensaje}\n\nRevisa el detalle en ${link}\n\nFeriaPlace`,
    });
    await pool.query('UPDATE notificacion SET enviada_correo = 1 WHERE id = ?', [id]);
  } catch (err) {
    console.error(`No se pudo enviar el correo a ${usuario.email}:`, err.message);
  }
}

// Guarda el aviso y manda el correo sin esperar a que termine (para no hacer lenta la respuesta)
async function notificar(usuarioId, aviso) {
  try {
    const [[usuario]] = await pool.query('SELECT nombre, email FROM usuario WHERE id = ?', [usuarioId]);
    if (!usuario) return;
    const [resultado] = await pool.query(
      'INSERT INTO notificacion (usuario_id, titulo, mensaje, enlace) VALUES (?, ?, ?, ?)',
      [usuarioId, aviso.titulo.slice(0, 150), aviso.mensaje.slice(0, 500), aviso.enlace || null]
    );
    enviarCorreo(resultado.insertId, usuario, aviso);
  } catch (err) {
    console.error('No se pudo registrar el aviso:', err.message);
  }
}

module.exports = { notificar, urlApp };
