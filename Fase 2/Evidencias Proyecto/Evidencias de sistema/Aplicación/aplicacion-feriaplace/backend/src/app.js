// Arma la aplicación Express (rutas de la API y páginas). index.js la pone a escuchar;
// las pruebas automáticas la levantan aparte, en un puerto libre.
const path = require('path');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const feriasRoutes = require('./routes/ferias');
const puestosRoutes = require('./routes/puestos');
const solicitudesRoutes = require('./routes/solicitudes');
const usuariosRoutes = require('./routes/usuarios');
const reportesRoutes = require('./routes/reportes');
const credencialesRoutes = require('./routes/credenciales');
const notificacionesRoutes = require('./routes/notificaciones');

const app = express();

// En un hosting (Railway, Render) la app queda detrás de un proxy: así se ve la IP real del visitante
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/ferias', feriasRoutes);
app.use('/api/puestos', puestosRoutes);
app.use('/api/solicitudes', solicitudesRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/reportes', reportesRoutes);
app.use('/api/credenciales', credencialesRoutes);
app.use('/api/notificaciones', notificacionesRoutes);

app.use(express.static(path.join(__dirname, '..', '..', 'public')));

module.exports = app;
