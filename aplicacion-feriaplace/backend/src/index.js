require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const feriasRoutes = require('./routes/ferias');
const puestosRoutes = require('./routes/puestos');
const solicitudesRoutes = require('./routes/solicitudes');
const usuariosRoutes = require('./routes/usuarios');
const reportesRoutes = require('./routes/reportes');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/ferias', feriasRoutes);
app.use('/api/puestos', puestosRoutes);
app.use('/api/solicitudes', solicitudesRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/reportes', reportesRoutes);

app.use(express.static(path.join(__dirname, '..', '..', 'public')));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`FeriaPlace corriendo en http://localhost:${PORT}`);
});
