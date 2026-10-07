// Migraciones de la base de datos:
//   001: ferias con plano y puestos ubicados en el plano.
//   002: comuna y coordenadas de cada feria, para ubicarla en el mapa de Santiago.
//   003: aprobación de cuentas nuevas por el administrador.
//   004: ferias de temporada (fecha de inicio y cierre), precio por puesto y control de pagos.
//   005: elementos del plano que no se arriendan (escenario, baño, bar, pasillos, flechas...).
// Se puede ejecutar más de una vez sin problemas: cada paso revisa si ya fue aplicado.
// Uso: dentro de backend/, `npm run migrar`
require('dotenv').config();
const pool = require('./db');
const { ubicarEnFilas } = require('./plano');

async function existeTabla(tabla) {
  const [filas] = await pool.query(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
    [tabla]
  );
  return filas.length > 0;
}

async function existeColumna(tabla, columna) {
  const [filas] = await pool.query(
    'SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    [tabla, columna]
  );
  return filas.length > 0;
}

async function existeIndice(tabla, indice) {
  const [filas] = await pool.query(
    'SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
    [tabla, indice]
  );
  return filas.length > 0;
}

async function existeFk(tabla, nombre) {
  const [filas] = await pool.query(
    `SELECT 1 FROM information_schema.table_constraints
     WHERE table_schema = DATABASE() AND table_name = ? AND constraint_name = ? AND constraint_type = 'FOREIGN KEY'`,
    [tabla, nombre]
  );
  return filas.length > 0;
}

async function paso(descripcion, yaAplicado, aplicar) {
  if (await yaAplicado()) {
    console.log(`  = ${descripcion} (ya estaba)`);
    return;
  }
  await aplicar();
  console.log(`  + ${descripcion}`);
}

async function migrar() {
  console.log('Migración 001: ferias y planos');

  await paso('Crear tabla feria', () => existeTabla('feria'), () => pool.query(`
    CREATE TABLE feria (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nombre VARCHAR(150) NOT NULL,
      lugar VARCHAR(200) NULL,
      fecha_texto VARCHAR(150) NULL,
      descripcion VARCHAR(1000) NULL,
      ancho INT NOT NULL DEFAULT 24,
      alto INT NOT NULL DEFAULT 14,
      publicada TINYINT(1) NOT NULL DEFAULT 1,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`));

  await paso('Agregar feria y posición en el plano a puesto', () => existeColumna('puesto', 'feria_id'), () => pool.query(`
    ALTER TABLE puesto
      ADD COLUMN feria_id INT NULL AFTER id,
      ADD COLUMN pos_x INT NOT NULL DEFAULT 0,
      ADD COLUMN pos_y INT NOT NULL DEFAULT 0,
      ADD COLUMN ancho INT NOT NULL DEFAULT 3,
      ADD COLUMN alto INT NOT NULL DEFAULT 2`));

  // Los puestos que ya existían pasan a una "Feria principal", ordenados en filas por zona
  const [sinFeria] = await pool.query('SELECT * FROM puesto WHERE feria_id IS NULL ORDER BY zona, id');
  if (sinFeria.length > 0) {
    const anchoPlano = 26;
    const { puestos, altoUsado } = ubicarEnFilas(sinFeria, anchoPlano);
    const conexion = await pool.getConnection();
    try {
      await conexion.beginTransaction();
      const [feria] = await conexion.query(
        'INSERT INTO feria (nombre, lugar, fecha_texto, descripcion, ancho, alto) VALUES (?, ?, ?, ?, ?, ?)',
        ['Feria principal', null, null, 'Plano creado automáticamente con los puestos que ya existían.', anchoPlano, Math.max(12, altoUsado)]
      );
      for (const p of puestos) {
        await conexion.query(
          'UPDATE puesto SET feria_id = ?, pos_x = ?, pos_y = ?, ancho = ?, alto = ? WHERE id = ?',
          [feria.insertId, p.pos_x, p.pos_y, p.ancho, p.alto, p.id]
        );
      }
      await conexion.commit();
      console.log(`  + ${puestos.length} puestos existentes ubicados en "Feria principal"`);
    } catch (err) {
      await conexion.rollback();
      throw err;
    } finally {
      conexion.release();
    }
  }

  await paso('Hacer obligatoria la feria de cada puesto', async () => {
    const [filas] = await pool.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'puesto' AND column_name = 'feria_id'`
    );
    return filas[0].is_nullable === 'NO';
  }, () => pool.query('ALTER TABLE puesto MODIFY feria_id INT NOT NULL'));

  await paso('Relacionar puesto con feria', () => existeFk('puesto', 'fk_puesto_feria'), () => pool.query(
    'ALTER TABLE puesto ADD CONSTRAINT fk_puesto_feria FOREIGN KEY (feria_id) REFERENCES feria(id)'));

  // Antes el código del puesto era único en todo el sistema; ahora es único dentro de cada feria
  await paso('Código de puesto único por feria', () => existeIndice('puesto', 'uq_puesto_feria_codigo'), async () => {
    await pool.query('ALTER TABLE puesto ADD CONSTRAINT uq_puesto_feria_codigo UNIQUE (feria_id, codigo)');
    if (await existeIndice('puesto', 'codigo')) {
      await pool.query('ALTER TABLE puesto DROP INDEX codigo');
    }
  });

  await paso('Agregar feria y puesto preferido a solicitud', () => existeColumna('solicitud', 'feria_id'), () => pool.query(`
    ALTER TABLE solicitud
      ADD COLUMN feria_id INT NULL AFTER usuario_id,
      ADD COLUMN puesto_preferido_id INT NULL AFTER feria_id,
      ADD CONSTRAINT fk_solicitud_feria FOREIGN KEY (feria_id) REFERENCES feria(id),
      ADD CONSTRAINT fk_solicitud_preferido FOREIGN KEY (puesto_preferido_id) REFERENCES puesto(id) ON DELETE SET NULL`));

  // Las solicitudes antiguas quedan asociadas a la feria de su puesto, o a la primera feria si no tenían puesto
  const [actualizadas] = await pool.query(`
    UPDATE solicitud s
    LEFT JOIN puesto p ON p.id = s.puesto_id
    SET s.feria_id = COALESCE(p.feria_id, (SELECT MIN(id) FROM feria))
    WHERE s.feria_id IS NULL`);
  if (actualizadas.affectedRows > 0) {
    console.log(`  + ${actualizadas.affectedRows} solicitudes existentes asociadas a su feria`);
  }

  console.log('Migración 002: comuna y ubicación de las ferias');

  await paso('Agregar comuna, latitud y longitud a feria', () => existeColumna('feria', 'comuna'), () => pool.query(`
    ALTER TABLE feria
      ADD COLUMN comuna VARCHAR(60) NULL AFTER lugar,
      ADD COLUMN latitud DECIMAL(9,6) NULL AFTER comuna,
      ADD COLUMN longitud DECIMAL(9,6) NULL AFTER latitud`));

  await paso('Índice por comuna en feria', () => existeIndice('feria', 'idx_feria_comuna'), () => pool.query(
    'ALTER TABLE feria ADD INDEX idx_feria_comuna (comuna)'));

  console.log('Migración 003: aprobación de cuentas');

  // Las cuentas que ya existían quedan aprobadas; las nuevas se registran como "pendiente"
  await paso('Agregar estado de aprobación a usuario', () => existeColumna('usuario', 'estado'), () => pool.query(`
    ALTER TABLE usuario
      ADD COLUMN estado ENUM('pendiente', 'aprobado', 'rechazado') NOT NULL DEFAULT 'aprobado' AFTER rol,
      ADD COLUMN telefono VARCHAR(30) NULL AFTER email,
      ADD COLUMN motivo_registro VARCHAR(500) NULL AFTER estado,
      ADD COLUMN comentario_admin VARCHAR(500) NULL AFTER motivo_registro,
      ADD COLUMN revisado_en DATETIME NULL AFTER creado_en`));

  console.log('Migración 004: fechas de temporada, precios y pagos');

  await paso('Agregar fecha de inicio, fecha de cierre y precio base a feria', () => existeColumna('feria', 'fecha_inicio'), () => pool.query(`
    ALTER TABLE feria
      ADD COLUMN fecha_inicio DATE NULL AFTER fecha_texto,
      ADD COLUMN fecha_cierre DATE NULL AFTER fecha_inicio,
      ADD COLUMN precio_puesto INT NULL AFTER fecha_cierre`));

  await paso('Índice por fechas en feria', () => existeIndice('feria', 'idx_feria_fechas'), () => pool.query(
    'ALTER TABLE feria ADD INDEX idx_feria_fechas (fecha_inicio, fecha_cierre)'));

  // Si un puesto no tiene precio propio, cobra el precio base de su feria
  await paso('Agregar precio propio a puesto', () => existeColumna('puesto', 'precio'), () => pool.query(
    'ALTER TABLE puesto ADD COLUMN precio INT NULL AFTER alto'));

  await paso('Agregar monto y estado de pago a solicitud', () => existeColumna('solicitud', 'estado_pago'), () => pool.query(`
    ALTER TABLE solicitud
      ADD COLUMN monto INT NULL AFTER puesto_id,
      ADD COLUMN estado_pago ENUM('pendiente', 'pagado') NULL AFTER monto,
      ADD COLUMN pagado_en DATETIME NULL AFTER estado_pago`));

  // Las solicitudes que ya estaban confirmadas quedan con el pago pendiente
  const [sinPago] = await pool.query(
    "UPDATE solicitud SET estado_pago = 'pendiente' WHERE estado = 'confirmada' AND estado_pago IS NULL");
  if (sinPago.affectedRows > 0) {
    console.log(`  + ${sinPago.affectedRows} solicitudes confirmadas quedan con pago pendiente`);
  }

  console.log('Migración 005: elementos del plano');

  await paso('Crear tabla elemento_plano', () => existeTabla('elemento_plano'), () => pool.query(`
    CREATE TABLE elemento_plano (
      id INT AUTO_INCREMENT PRIMARY KEY,
      feria_id INT NOT NULL,
      tipo VARCHAR(20) NOT NULL,
      etiqueta VARCHAR(40) NOT NULL DEFAULT '',
      color CHAR(7) NOT NULL DEFAULT '#6b7280',
      direccion ENUM('arriba', 'abajo', 'izquierda', 'derecha') NULL,
      pos_x INT NOT NULL DEFAULT 0,
      pos_y INT NOT NULL DEFAULT 0,
      ancho INT NOT NULL DEFAULT 2,
      alto INT NOT NULL DEFAULT 2,
      CONSTRAINT fk_elemento_feria FOREIGN KEY (feria_id) REFERENCES feria(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`));

  console.log('Migración terminada.');
}

migrar()
  .catch((err) => {
    console.error('Error en la migración:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
