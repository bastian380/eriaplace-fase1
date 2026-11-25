// Avisos: cada aviso queda guardado en la tabla notificacion (se ve en "Avisos" dentro de la app) y además sale por
// los canales que la persona activó en "Mi cuenta":
//   - Correo: se envía de verdad si hay un servidor configurado en .env (SMTP_HOST, etc.); si no, se simula.
//   - WhatsApp: siempre simulado (conectarlo de verdad requiere una cuenta de WhatsApp Business).
// Lo simulado queda en la tabla envio_aviso, y el administrador de la plataforma lo ve en "Avisos".
// Un aviso nunca hace fallar la acción que lo originó: si un envío falla, solo queda anotado.
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

function registrarEnvio(notificacionId, canal, destino, estado) {
  return pool.query(
    'INSERT INTO envio_aviso (notificacion_id, canal, destino, estado) VALUES (?, ?, ?, ?)',
    [notificacionId, canal, destino, estado]
  );
}

async function enviarCorreoReal(smtp, id, usuario, { titulo, mensaje, enlace }) {
  try {
    const link = enlace ? `${urlApp()}/${enlace}` : urlApp();
    await smtp.sendMail({
      from: process.env.CORREO_REMITENTE || process.env.SMTP_USER,
      to: usuario.email,
      subject: `FeriaPlace: ${titulo}`,
      text: `Hola ${usuario.nombre}:\n\n${mensaje}\n\nRevisa el detalle en ${link}\n\nFeriaPlace`,
    });
    await pool.query('UPDATE notificacion SET enviada_correo = 1 WHERE id = ?', [id]);
    await registrarEnvio(id, 'correo', usuario.email, 'enviado');
  } catch (err) {
    console.error(`No se pudo enviar el correo a ${usuario.email}:`, err.message);
    await registrarEnvio(id, 'correo', usuario.email, 'fallido').catch(() => {});
  }
}

// Guarda el aviso y lo despacha por cada canal. El correo real no se espera, para no hacer lenta la respuesta.
async function notificar(usuarioId, aviso) {
  try {
    const [[usuario]] = await pool.query(
      'SELECT nombre, email, telefono, avisar_correo, avisar_whatsapp FROM usuario WHERE id = ?', [usuarioId]);
    if (!usuario) return;
    const [resultado] = await pool.query(
      'INSERT INTO notificacion (usuario_id, titulo, mensaje, enlace) VALUES (?, ?, ?, ?)',
      [usuarioId, aviso.titulo.slice(0, 150), aviso.mensaje.slice(0, 500), aviso.enlace || null]
    );
    const id = resultado.insertId;
    if (usuario.avisar_correo && usuario.email) {
      const smtp = obtenerTransporte();
      if (smtp) enviarCorreoReal(smtp, id, usuario, aviso);
      else await registrarEnvio(id, 'correo', usuario.email, 'simulado');
    }
    if (usuario.avisar_whatsapp && usuario.telefono) {
      await registrarEnvio(id, 'whatsapp', usuario.telefono, 'simulado');
    }
  } catch (err) {
    console.error('No se pudo registrar el aviso:', err.message);
  }
}

module.exports = { notificar, urlApp };
