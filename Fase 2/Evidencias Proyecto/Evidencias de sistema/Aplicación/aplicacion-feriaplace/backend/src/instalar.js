// Crea las tablas en una base vacía usando database/schema.sql y luego el usuario administrador.
// Sirve para instalar FeriaPlace en un hosting nuevo (por ejemplo Railway) o en otro PC.
// Si las tablas ya existen no las toca (todas son CREATE TABLE IF NOT EXISTS).
// Uso: dentro de backend/, `npm run instalar`
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { configDb } = require('./db');

// El esquema sin las líneas CREATE DATABASE / USE, para correrlo en la base que indique la conexión
function leerEsquema() {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'schema.sql'), 'utf8');
  return sql.split('\n').filter((linea) => !/^\s*(CREATE DATABASE|USE)\b/i.test(linea)).join('\n');
}

async function crearTablas() {
  const conexion = await mysql.createConnection({ ...configDb(), multipleStatements: true });
  try {
    await conexion.query(leerEsquema());
  } finally {
    await conexion.end();
  }
}

module.exports = { crearTablas };

if (require.main === module) {
  (async () => {
    try {
      await crearTablas();
      console.log('Tablas listas.');
      const { seedAdmin } = require('./seed');
      await seedAdmin();
    } catch (err) {
      console.error('Error al instalar la base de datos:', err.message);
      process.exitCode = 1;
    } finally {
      await require('./db').end();
    }
  })();
}
