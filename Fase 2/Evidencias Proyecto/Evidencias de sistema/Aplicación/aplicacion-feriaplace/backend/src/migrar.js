// Migraciones de la base de datos:
//   001: ferias con plano y puestos ubicados en el plano.
//   002: comuna y coordenadas de cada feria, para ubicarla en el mapa de Santiago.
//   003: aprobación de cuentas nuevas por el administrador.
//   004: ferias de temporada (fecha de inicio y cierre), precio por puesto y control de pagos.
//   005: elementos del plano que no se arriendan (escenario, baño, bar, pasillos, flechas...).
//   006: perímetro de cada feria, para dibujar su terreno en el mapa de Santiago.
//   007: avisos al comerciante (cuenta aprobada, puesto asignado, pago recibido...).
//   008: Administrador de Feria (dueño de cada feria) y cobros de la plataforma por publicar puestos.
//   009: pago en línea (modo prueba) de puestos y de publicaciones.
//   010: canales de aviso (correo y WhatsApp simulado) y recordatorios de pago.
//   011: lista de espera de las ferias llenas.
//   012: calificaciones y reseñas de los puestos.
//   013: asistencia de los comerciantes con la credencial QR.
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

  console.log('Migración 006: perímetro de la feria en el mapa');

  // Lista de puntos [latitud, longitud] que encierran el terreno de la feria
  await paso('Agregar perímetro a feria', () => existeColumna('feria', 'perimetro'), () => pool.query(
    'ALTER TABLE feria ADD COLUMN perimetro JSON NULL AFTER longitud'));

  console.log('Migración 007: avisos al comerciante');

  await paso('Crear tabla notificacion', () => existeTabla('notificacion'), () => pool.query(`
    CREATE TABLE notificacion (
      id INT AUTO_INCREMENT PRIMARY KEY,
      usuario_id INT NOT NULL,
      titulo VARCHAR(150) NOT NULL,
      mensaje VARCHAR(500) NOT NULL,
      enlace VARCHAR(200) NULL,
      leida TINYINT(1) NOT NULL DEFAULT 0,
      enviada_correo TINYINT(1) NOT NULL DEFAULT 0,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_notificacion_usuario (usuario_id, leida),
      CONSTRAINT fk_notificacion_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`));

  console.log('Migración 008: Administrador de Feria y cobros por publicación');

  // Solo se agrega el valor nuevo al ENUM: las cuentas que ya existen no cambian
  await paso('Agregar rol admin_feria a usuario', async () => {
    const [filas] = await pool.query(
      `SELECT column_type AS column_type FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'usuario' AND column_name = 'rol'`
    );
    return filas[0].column_type.includes('admin_feria');
  }, () => pool.query(
    "ALTER TABLE usuario MODIFY rol ENUM('comerciante', 'administrador', 'admin_feria') NOT NULL DEFAULT 'comerciante'"));

  await paso('Agregar organización a usuario', () => existeColumna('usuario', 'organizacion'), () => pool.query(
    'ALTER TABLE usuario ADD COLUMN organizacion VARCHAR(150) NULL AFTER motivo_registro'));

  // Las ferias que ya existen quedan con admin_feria_id NULL: siguen a cargo de la plataforma y publicadas como estaban
  await paso('Agregar Administrador de Feria a feria', () => existeColumna('feria', 'admin_feria_id'), () => pool.query(`
    ALTER TABLE feria
      ADD COLUMN admin_feria_id INT NULL AFTER id,
      ADD CONSTRAINT fk_feria_admin FOREIGN KEY (admin_feria_id) REFERENCES usuario(id) ON DELETE SET NULL`));

  await paso('Crear tabla cobro_publicacion', () => existeTabla('cobro_publicacion'), () => pool.query(`
    CREATE TABLE cobro_publicacion (
      id INT AUTO_INCREMENT PRIMARY KEY,
      feria_id INT NOT NULL,
      admin_feria_id INT NOT NULL,
      puestos INT NOT NULL,
      tarifa INT NOT NULL,
      monto INT NOT NULL,
      estado ENUM('pendiente', 'pagado') NOT NULL DEFAULT 'pendiente',
      comentario VARCHAR(300) NULL,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      pagado_en DATETIME NULL,
      INDEX idx_cobro_feria (feria_id, estado),
      CONSTRAINT fk_cobro_feria FOREIGN KEY (feria_id) REFERENCES feria(id) ON DELETE CASCADE,
      CONSTRAINT fk_cobro_admin FOREIGN KEY (admin_feria_id) REFERENCES usuario(id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`));

  await paso('Crear tabla configuracion', () => existeTabla('configuracion'), () => pool.query(`
    CREATE TABLE configuracion (
      clave VARCHAR(50) PRIMARY KEY,
      valor VARCHAR(200) NOT NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`));

  console.log('Migración 009: pago en línea');

  await paso('Crear tabla pago_linea', () => existeTabla('pago_linea'), () => pool.query(`
    CREATE TABLE pago_linea (
      id INT AUTO_INCREMENT PRIMARY KEY,
      token CHAR(48) NOT NULL UNIQUE,
      tipo ENUM('puesto', 'publicacion') NOT NULL,
      referencia_id INT NOT NULL,
      usuario_id INT NOT NULL,
      monto INT NOT NULL,
      estado ENUM('iniciado', 'aprobado', 'rechazado', 'anulado') NOT NULL DEFAULT 'iniciado',
      codigo_autorizacion VARCHAR(20) NULL,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resuelto_en DATETIME NULL,
      INDEX idx_pago_referencia (tipo, referencia_id, estado),
      CONSTRAINT fk_pago_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`));

  console.log('Migración 010: canales de aviso y recordatorios de pago');

  await paso('Agregar preferencias de aviso a usuario', () => existeColumna('usuario', 'avisar_correo'), () => pool.query(`
    ALTER TABLE usuario
      ADD COLUMN avisar_correo TINYINT(1) NOT NULL DEFAULT 1,
      ADD COLUMN avisar_whatsapp TINYINT(1) NOT NULL DEFAULT 0`));

  await paso('Agregar último recordatorio a solicitud', () => existeColumna('solicitud', 'ultimo_recordatorio'), () => pool.query(
    'ALTER TABLE solicitud ADD COLUMN ultimo_recordatorio DATETIME NULL'));

  await paso('Crear tabla envio_aviso', () => existeTabla('envio_aviso'), () => pool.query(`
    CREATE TABLE envio_aviso (
      id INT AUTO_INCREMENT PRIMARY KEY,
      notificacion_id INT NOT NULL,
      canal ENUM('correo', 'whatsapp') NOT NULL,
      destino VARCHAR(150) NOT NULL,
      estado ENUM('simulado', 'enviado', 'fallido') NOT NULL,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_envio_notificacion FOREIGN KEY (notificacion_id) REFERENCES notificacion(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`));

  console.log('Migración 011: lista de espera');

  await paso('Crear tabla lista_espera', () => existeTabla('lista_espera'), () => pool.query(`
    CREATE TABLE lista_espera (
      id INT AUTO_INCREMENT PRIMARY KEY,
      feria_id INT NOT NULL,
      usuario_id INT NOT NULL,
      rubro VARCHAR(120) NOT NULL,
      comentario VARCHAR(500) NULL,
      estado ENUM('esperando', 'ofrecido', 'aceptado', 'vencido', 'cancelado') NOT NULL DEFAULT 'esperando',
      puesto_id INT NULL,
      oferta_vence DATETIME NULL,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_espera_feria (feria_id, estado),
      CONSTRAINT fk_espera_feria FOREIGN KEY (feria_id) REFERENCES feria(id) ON DELETE CASCADE,
      CONSTRAINT fk_espera_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id),
      CONSTRAINT fk_espera_puesto FOREIGN KEY (puesto_id) REFERENCES puesto(id) ON DELETE SET NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`));

  console.log('Migración 012: calificaciones y reseñas');

  await paso('Crear tabla resena', () => existeTabla('resena'), () => pool.query(`
    CREATE TABLE resena (
      id INT AUTO_INCREMENT PRIMARY KEY,
      solicitud_id INT NOT NULL,
      usuario_id INT NOT NULL,
      estrellas TINYINT NOT NULL,
      comentario VARCHAR(500) NULL,
      oculta TINYINT(1) NOT NULL DEFAULT 0,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_resena_persona UNIQUE (solicitud_id, usuario_id),
      CONSTRAINT fk_resena_solicitud FOREIGN KEY (solicitud_id) REFERENCES solicitud(id) ON DELETE CASCADE,
      CONSTRAINT fk_resena_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`));

  console.log('Migración 013: asistencia con QR');

  await paso('Crear tabla asistencia', () => existeTabla('asistencia'), () => pool.query(`
    CREATE TABLE asistencia (
      id INT AUTO_INCREMENT PRIMARY KEY,
      solicitud_id INT NOT NULL,
      fecha DATE NOT NULL,
      metodo ENUM('qr', 'manual') NOT NULL,
      registrado_por INT NULL,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_asistencia_dia UNIQUE (solicitud_id, fecha),
      CONSTRAINT fk_asistencia_solicitud FOREIGN KEY (solicitud_id) REFERENCES solicitud(id) ON DELETE CASCADE,
      CONSTRAINT fk_asistencia_usuario FOREIGN KEY (registrado_por) REFERENCES usuario(id) ON DELETE SET NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`));

  console.log('Migración terminada.');
}

migrar()
  .catch((err) => {
    console.error('Error en la migración:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
