// Limita los intentos fallidos de inicio de sesión para que nadie pueda probar contraseñas sin parar.
// Se cuentan por IP + email y se guardan en memoria (se reinician si se reinicia el servidor).
const MAX_INTENTOS = 5;
const VENTANA_MS = 15 * 60 * 1000;

const intentos = new Map();

function clave(req, email) {
  return `${req.ip}|${String(email || '').trim().toLowerCase()}`;
}

// Devuelve los minutos que faltan si la combinación está bloqueada, o 0 si puede intentar
function minutosBloqueado(req, email) {
  const registro = intentos.get(clave(req, email));
  if (!registro) return 0;
  if (Date.now() - registro.desde > VENTANA_MS) {
    intentos.delete(clave(req, email));
    return 0;
  }
  if (registro.fallos < MAX_INTENTOS) return 0;
  return Math.ceil((registro.desde + VENTANA_MS - Date.now()) / 60000);
}

function registrarFallo(req, email) {
  const k = clave(req, email);
  const registro = intentos.get(k);
  if (!registro || Date.now() - registro.desde > VENTANA_MS) {
    intentos.set(k, { fallos: 1, desde: Date.now() });
  } else {
    registro.fallos += 1;
  }
}

function limpiar(req, email) {
  intentos.delete(clave(req, email));
}

module.exports = { minutosBloqueado, registrarFallo, limpiar, MAX_INTENTOS, reiniciarTodo: () => intentos.clear() };
