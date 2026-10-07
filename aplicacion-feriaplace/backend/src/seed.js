// Crea el usuario administrador inicial. Las ferias y sus puestos se crean desde
// "Ferias y planos" en la aplicación, así que aquí no se agrega ninguna feria de ejemplo.
require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('./db');

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
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

(async () => {
  try {
    await seedAdmin();
  } catch (err) {
    console.error('Error al poblar datos iniciales:', err);
  } finally {
    await pool.end();
  }
})();
