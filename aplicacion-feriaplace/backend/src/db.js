const mysql = require('mysql2/promise');
require('dotenv').config();

// Datos de conexión. En tu PC salen de DB_HOST, DB_USER, etc. (archivo .env).
// En un hosting como Railway basta con una sola variable con la URL completa (MYSQL_URL o DATABASE_URL).
function configDb() {
  const url = process.env.MYSQL_URL || process.env.DATABASE_URL;
  if (url) return { uri: url };
  return {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  };
}

const pool = mysql.createPool({
  ...configDb(),
  waitForConnections: true,
  connectionLimit: 10,
});

module.exports = pool;
module.exports.configDb = configDb;
