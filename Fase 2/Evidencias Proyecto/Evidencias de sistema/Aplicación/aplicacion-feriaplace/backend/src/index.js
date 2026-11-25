require('dotenv').config();
const app = require('./app');
const { recordarPagos } = require('./recordatorios');
const { vencerOfertas } = require('./listaEspera');

// Sin una clave secreta propia cualquiera podría fabricar sesiones de administrador
const SECRETO_DE_EJEMPLO = 'pon_aqui_una_cadena_larga_y_aleatoria';
if (!process.env.JWT_SECRET) {
  console.error('Falta JWT_SECRET en el archivo .env (o en las variables del hosting). No se puede iniciar.');
  process.exit(1);
}
if (process.env.JWT_SECRET === SECRETO_DE_EJEMPLO || process.env.JWT_SECRET.length < 16) {
  if (process.env.NODE_ENV === 'production') {
    console.error('JWT_SECRET es la de ejemplo o es muy corta. Pon una cadena larga y aleatoria antes de publicar.');
    process.exit(1);
  }
  console.warn('Aviso: JWT_SECRET es la de ejemplo o es muy corta. Cámbiala antes de publicar la app.');
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`FeriaPlace corriendo en http://localhost:${PORT}`);
});

// Recordatorios de pago: se revisan al partir y luego cada una hora
function revisarRecordatorios() {
  recordarPagos().catch((err) => console.error('No se pudieron enviar los recordatorios:', err.message));
  vencerOfertas().catch((err) => console.error('No se pudieron revisar las ofertas de la lista de espera:', err.message));
}
setTimeout(revisarRecordatorios, 10000);
setInterval(revisarRecordatorios, 60 * 60 * 1000);
