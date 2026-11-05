// Borra TODAS las ferias, sus puestos y las solicitudes de puesto, para partir con el área de ferias vacía.
// Los usuarios (administradores y comerciantes) no se tocan.
// Uso: dentro de backend/, `npm run vaciar-ferias -- --confirmar`
require('dotenv').config();
const pool = require('./db');

async function vaciar() {
  const [[conteo]] = await pool.query(
    `SELECT (SELECT COUNT(*) FROM feria) AS ferias,
            (SELECT COUNT(*) FROM puesto) AS puestos,
            (SELECT COUNT(*) FROM solicitud) AS solicitudes`
  );
  console.log(`En la base hay ${conteo.ferias} ferias, ${conteo.puestos} puestos y ${conteo.solicitudes} solicitudes.`);

  if (!process.argv.includes('--confirmar')) {
    console.log('No se borró nada. Para borrarlos de verdad ejecuta: npm run vaciar-ferias -- --confirmar');
    return;
  }

  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    // Las solicitudes apuntan a puestos y ferias, por eso se borran primero
    await conexion.query('DELETE FROM solicitud');
    await conexion.query('DELETE FROM puesto');
    await conexion.query('DELETE FROM feria');
    await conexion.commit();
    console.log('Listo: el área de ferias quedó vacía. Los usuarios se mantienen.');
  } catch (err) {
    await conexion.rollback();
    throw err;
  } finally {
    conexion.release();
  }
}

vaciar()
  .catch((err) => {
    console.error('Error al vaciar las ferias:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
