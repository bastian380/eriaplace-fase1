// Prepara una base de datos SOLO para pruebas (por defecto feriaplace_test) y levanta la app en un puerto libre.
// Nunca toca la base real: si el nombre no termina en _test, las pruebas se niegan a correr.
require('dotenv').config();

process.env.DB_NAME = process.env.DB_TEST_NAME || 'feriaplace_test';
if (process.env.DB_TEST_USER) process.env.DB_USER = process.env.DB_TEST_USER;
if (process.env.DB_TEST_PASSWORD) process.env.DB_PASSWORD = process.env.DB_TEST_PASSWORD;
delete process.env.MYSQL_URL;
delete process.env.DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-solo-para-las-pruebas-automaticas';

if (!process.env.DB_NAME.endsWith('_test')) {
  throw new Error(`La base de pruebas debe terminar en _test (se indicó "${process.env.DB_NAME}")`);
}

const bcrypt = require('bcrypt');
const pool = require('../src/db');
const { crearTablas } = require('../src/instalar');
const app = require('../src/app');

const ADMIN = { email: 'admin@prueba.cl', password: 'ClaveAdmin2026' };

// Deja la base de pruebas vacía, con las tablas del esquema y un administrador
async function prepararBase() {
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const tabla of ['notificacion', 'solicitud', 'elemento_plano', 'puesto', 'feria', 'usuario']) {
    await pool.query(`DROP TABLE IF EXISTS ${tabla}`);
  }
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');
  await crearTablas();
  await pool.query(
    "INSERT INTO usuario (nombre, email, password_hash, rol) VALUES ('Admin pruebas', ?, ?, 'administrador')",
    [ADMIN.email, await bcrypt.hash(ADMIN.password, 4)]
  );
}

// Levanta el servidor y devuelve una función para llamar a la API como lo hace el navegador
async function levantarServidor() {
  const servidor = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${servidor.address().port}/api`;
  async function api(ruta, { metodo = 'GET', cuerpo, token } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const respuesta = await fetch(base + ruta, {
      method: metodo, headers, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const texto = await respuesta.text();
    let datos = texto;
    try { datos = JSON.parse(texto); } catch { /* respuesta que no es JSON, como el CSV */ }
    return { status: respuesta.status, datos, headers: respuesta.headers };
  }
  async function cerrar() {
    await new Promise((resolve) => servidor.close(resolve));
    await pool.end();
  }
  return { api, cerrar };
}

module.exports = { prepararBase, levantarServidor, ADMIN };
