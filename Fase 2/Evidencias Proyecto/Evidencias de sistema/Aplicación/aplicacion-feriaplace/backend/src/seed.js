// Crea el usuario administrador inicial. Las ferias y sus puestos se crean desde
// "Ferias y planos" en la aplicación, así que aquí no se agrega ninguna feria de ejemplo.
require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('./db');

const CLAVE_DE_EJEMPLO = 'Admin123!';

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('Faltan ADMIN_EMAIL y ADMIN_PASSWORD en el archivo .env');
  }
  // En internet no se puede partir con la clave que aparece en el README
  if (process.env.NODE_ENV === 'production' && (password === CLAVE_DE_EJEMPLO || password.length < 8)) {
    throw new Error('ADMIN_PASSWORD es la de ejemplo o tiene menos de 8 caracteres. Elige otra antes de publicar.');
  }
  const [existentes] = await pool.query('SELECT id FROM usuario WHERE email = ?', [email]);
  if (existentes.length > 0) {
    console.log('El usuario administrador ya existía, se omite.');
    return;
  }
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    'INSERT INTO usuario (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)',
    ['Administrador FeriaPlace', email, hash, 'administrador']
  );
  console.log(`Usuario administrador creado: ${email}`);
}

module.exports = { seedAdmin, CLAVE_DE_EJEMPLO };

if (require.main === module) {
  (async () => {
    try {
      await seedAdmin();
    } catch (err) {
      console.error('Error al poblar datos iniciales:', err.message || err);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  })();
}
