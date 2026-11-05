// Credencial del puesto: un código que identifica la solicitud confirmada y una firma que
// solo el servidor puede calcular (con JWT_SECRET). Así nadie puede inventar el código de otro puesto.
const crypto = require('crypto');

function firmar(solicitudId) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET)
    .update(`credencial:${solicitudId}`).digest('hex').slice(0, 20);
}

// "15-a1b2c3..." -> 15, o null si el código no es válido
function leerCodigo(codigo) {
  const coincide = /^(\d+)-([0-9a-f]{20})$/.exec(String(codigo || '').trim().toLowerCase());
  if (!coincide) return null;
  const id = Number(coincide[1]);
  const esperada = Buffer.from(firmar(id));
  const recibida = Buffer.from(coincide[2]);
  return crypto.timingSafeEqual(esperada, recibida) ? id : null;
}

module.exports = {
  codigoCredencial: (solicitudId) => `${solicitudId}-${firmar(solicitudId)}`,
  leerCodigo,
};
