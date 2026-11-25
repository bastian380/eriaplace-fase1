-- FeriaPlace - esquema de base de datos (instalación desde cero)
-- Si ya tienes una base creada con la versión anterior, NO uses este archivo:
-- ejecuta la migración con `npm run migrar` dentro de backend/.
CREATE DATABASE IF NOT EXISTS feriaplace CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE feriaplace;

CREATE TABLE IF NOT EXISTS usuario (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  telefono VARCHAR(30) NULL,
  password_hash VARCHAR(255) NOT NULL,
  -- administrador = dueño de la plataforma FeriaPlace; admin_feria = Administrador de Feria (cliente de la plataforma);
  -- comerciante = quien arrienda un puesto
  rol ENUM('comerciante', 'administrador', 'admin_feria') NOT NULL DEFAULT 'comerciante',
  -- Las cuentas nuevas (comerciantes y administradores de feria) quedan 'pendiente' hasta que el administrador las aprueba
  estado ENUM('pendiente', 'aprobado', 'rechazado') NOT NULL DEFAULT 'aprobado',
  motivo_registro VARCHAR(500) NULL,     -- lo que la persona cuenta al registrarse (qué quiere vender, por qué)
  organizacion VARCHAR(150) NULL,        -- solo Administrador de Feria: organización o feria que representa
  comentario_admin VARCHAR(500) NULL,    -- motivo del rechazo, si lo hay
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revisado_en DATETIME NULL,
  avisar_correo TINYINT(1) NOT NULL DEFAULT 1,
  avisar_whatsapp TINYINT(1) NOT NULL DEFAULT 0
);

-- Ferias. Cada una tiene su propio plano (una grilla de ancho x alto celdas).
-- Si admin_feria_id tiene valor, la feria es de ese Administrador de Feria; si es NULL, la gestiona la plataforma.
CREATE TABLE IF NOT EXISTS feria (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_feria_id INT NULL,
  nombre VARCHAR(150) NOT NULL,
  lugar VARCHAR(200) NULL,
  comuna VARCHAR(60) NULL,          -- comuna de la Región Metropolitana (ver public/datos/comunas-rm.geojson)
  latitud DECIMAL(9,6) NULL,        -- ubicación en el mapa de Santiago (opcional)
  longitud DECIMAL(9,6) NULL,
  perimetro JSON NULL,              -- terreno de la feria en el mapa: lista de puntos [latitud, longitud]
  fecha_texto VARCHAR(150) NULL,    -- horario libre, ej: "Todos los días de 11:00 a 21:00"
  fecha_inicio DATE NULL,           -- primer día de la feria de temporada
  fecha_cierre DATE NULL,           -- último día de la feria
  precio_puesto INT NULL,           -- precio base de arriendo de un puesto por toda la temporada (pesos)
  descripcion VARCHAR(1000) NULL,
  ancho INT NOT NULL DEFAULT 24,
  alto INT NOT NULL DEFAULT 14,
  publicada TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_feria_comuna (comuna),
  INDEX idx_feria_fechas (fecha_inicio, fecha_cierre),
  CONSTRAINT fk_feria_admin FOREIGN KEY (admin_feria_id) REFERENCES usuario(id) ON DELETE SET NULL
);

-- Puestos dibujados en el plano de una feria (pos_x, pos_y, ancho y alto se miden en celdas de la grilla)
CREATE TABLE IF NOT EXISTS puesto (
  id INT AUTO_INCREMENT PRIMARY KEY,
  feria_id INT NOT NULL,
  codigo VARCHAR(20) NOT NULL,
  zona VARCHAR(80) NOT NULL,
  tamano ENUM('pequeno', 'mediano', 'grande') NOT NULL DEFAULT 'mediano',
  estado ENUM('disponible', 'ocupado') NOT NULL DEFAULT 'disponible',
  pos_x INT NOT NULL DEFAULT 0,
  pos_y INT NOT NULL DEFAULT 0,
  ancho INT NOT NULL DEFAULT 3,
  alto INT NOT NULL DEFAULT 2,
  precio INT NULL,                  -- precio propio del puesto; si es NULL se cobra el precio base de la feria
  CONSTRAINT uq_puesto_feria_codigo UNIQUE (feria_id, codigo),
  CONSTRAINT fk_puesto_feria FOREIGN KEY (feria_id) REFERENCES feria(id)
);

-- Elementos del plano que no se arriendan: escenario, baño, bar, comedor, boletería, pasillos, paredes, flechas...
-- Se pueden dibujar encima de otros (por ejemplo una flecha sobre un pasillo)
CREATE TABLE IF NOT EXISTS elemento_plano (
  id INT AUTO_INCREMENT PRIMARY KEY,
  feria_id INT NOT NULL,
  tipo VARCHAR(20) NOT NULL,        -- escenario, bano, bar, comedor, boleteria, entrada, salida, mesas, pasillo, pared, flecha, otro
  etiqueta VARCHAR(40) NOT NULL DEFAULT '',
  color CHAR(7) NOT NULL DEFAULT '#6b7280',
  direccion ENUM('arriba', 'abajo', 'izquierda', 'derecha') NULL,  -- solo para flechas
  pos_x INT NOT NULL DEFAULT 0,
  pos_y INT NOT NULL DEFAULT 0,
  ancho INT NOT NULL DEFAULT 2,
  alto INT NOT NULL DEFAULT 2,
  CONSTRAINT fk_elemento_feria FOREIGN KEY (feria_id) REFERENCES feria(id) ON DELETE CASCADE
);

-- Solicitudes de puesto enviadas por comerciantes
CREATE TABLE IF NOT EXISTS solicitud (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  feria_id INT NULL,
  puesto_preferido_id INT NULL,
  zona_preferida VARCHAR(80) NULL,
  tamano_preferido ENUM('pequeno', 'mediano', 'grande') NULL,
  rubro VARCHAR(120) NOT NULL,
  comentario VARCHAR(500) NULL,
  estado ENUM('pendiente', 'confirmada', 'rechazada') NOT NULL DEFAULT 'pendiente',
  puesto_id INT NULL,
  monto INT NULL,                   -- lo que debe pagar el comerciante por el puesto asignado
  estado_pago ENUM('pendiente', 'pagado') NULL,  -- lo marca el administrador a mano
  pagado_en DATETIME NULL,
  comentario_admin VARCHAR(500) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resuelto_en DATETIME NULL,
  ultimo_recordatorio DATETIME NULL, -- último recordatorio de pago enviado
  CONSTRAINT fk_solicitud_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id),
  CONSTRAINT fk_solicitud_puesto FOREIGN KEY (puesto_id) REFERENCES puesto(id),
  CONSTRAINT fk_solicitud_feria FOREIGN KEY (feria_id) REFERENCES feria(id),
  CONSTRAINT fk_solicitud_preferido FOREIGN KEY (puesto_preferido_id) REFERENCES puesto(id) ON DELETE SET NULL
);

-- Avisos al comerciante: cuenta aprobada, puesto asignado, solicitud rechazada, pago recibido.
-- Se muestran en "Avisos" y, si hay correo configurado, también se envían por email.
CREATE TABLE IF NOT EXISTS notificacion (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  titulo VARCHAR(150) NOT NULL,
  mensaje VARCHAR(500) NOT NULL,
  enlace VARCHAR(200) NULL,          -- página de la app relacionada, ej: mis-solicitudes.html
  leida TINYINT(1) NOT NULL DEFAULT 0,
  enviada_correo TINYINT(1) NOT NULL DEFAULT 0,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notificacion_usuario (usuario_id, leida),
  CONSTRAINT fk_notificacion_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE
);

-- Cada envío de un aviso por correo o WhatsApp. 'simulado' = no salió de la app (sin SMTP, o WhatsApp en modo prueba).
CREATE TABLE IF NOT EXISTS envio_aviso (
  id INT AUTO_INCREMENT PRIMARY KEY,
  notificacion_id INT NOT NULL,
  canal ENUM('correo', 'whatsapp') NOT NULL,
  destino VARCHAR(150) NOT NULL,
  estado ENUM('simulado', 'enviado', 'fallido') NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_envio_notificacion FOREIGN KEY (notificacion_id) REFERENCES notificacion(id) ON DELETE CASCADE
);

-- Lista de espera de una feria llena. Al liberarse un puesto se ofrece al primero por 48 horas (estado 'ofrecido').
CREATE TABLE IF NOT EXISTS lista_espera (
  id INT AUTO_INCREMENT PRIMARY KEY,
  feria_id INT NOT NULL,
  usuario_id INT NOT NULL,
  rubro VARCHAR(120) NOT NULL,
  comentario VARCHAR(500) NULL,
  estado ENUM('esperando', 'ofrecido', 'aceptado', 'vencido', 'cancelado') NOT NULL DEFAULT 'esperando',
  puesto_id INT NULL,                -- puesto ofrecido
  oferta_vence DATETIME NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_espera_feria (feria_id, estado),
  CONSTRAINT fk_espera_feria FOREIGN KEY (feria_id) REFERENCES feria(id) ON DELETE CASCADE,
  CONSTRAINT fk_espera_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id),
  CONSTRAINT fk_espera_puesto FOREIGN KEY (puesto_id) REFERENCES puesto(id) ON DELETE SET NULL
);

-- Calificaciones del comerciante que atiende un puesto (su solicitud confirmada). Una por persona.
CREATE TABLE IF NOT EXISTS resena (
  id INT AUTO_INCREMENT PRIMARY KEY,
  solicitud_id INT NOT NULL,
  usuario_id INT NOT NULL,           -- quien califica
  estrellas TINYINT NOT NULL,
  comentario VARCHAR(500) NULL,
  oculta TINYINT(1) NOT NULL DEFAULT 0,  -- la oculta quien gestiona la feria si es ofensiva
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_resena_persona UNIQUE (solicitud_id, usuario_id),
  CONSTRAINT fk_resena_solicitud FOREIGN KEY (solicitud_id) REFERENCES solicitud(id) ON DELETE CASCADE,
  CONSTRAINT fk_resena_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE
);

-- Asistencia diaria de cada puesto asignado, registrada al escanear la credencial QR o a mano.
CREATE TABLE IF NOT EXISTS asistencia (
  id INT AUTO_INCREMENT PRIMARY KEY,
  solicitud_id INT NOT NULL,
  fecha DATE NOT NULL,
  metodo ENUM('qr', 'manual') NOT NULL,
  registrado_por INT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_asistencia_dia UNIQUE (solicitud_id, fecha),
  CONSTRAINT fk_asistencia_solicitud FOREIGN KEY (solicitud_id) REFERENCES solicitud(id) ON DELETE CASCADE,
  CONSTRAINT fk_asistencia_usuario FOREIGN KEY (registrado_por) REFERENCES usuario(id) ON DELETE SET NULL
);

-- Cobros de la plataforma al Administrador de Feria por publicar los puestos de su feria.
-- monto = puestos x tarifa vigente al pedir la publicación. El administrador de la plataforma marca el pago
-- (no hay pasarela: se paga por transferencia) y entonces la feria se publica.
CREATE TABLE IF NOT EXISTS cobro_publicacion (
  id INT AUTO_INCREMENT PRIMARY KEY,
  feria_id INT NOT NULL,
  admin_feria_id INT NOT NULL,
  puestos INT NOT NULL,              -- cuántos puestos cubre este cobro
  tarifa INT NOT NULL,               -- precio por puesto que se usó para calcular el monto
  monto INT NOT NULL,
  estado ENUM('pendiente', 'pagado') NOT NULL DEFAULT 'pendiente',
  comentario VARCHAR(300) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pagado_en DATETIME NULL,
  INDEX idx_cobro_feria (feria_id, estado),
  CONSTRAINT fk_cobro_feria FOREIGN KEY (feria_id) REFERENCES feria(id) ON DELETE CASCADE,
  CONSTRAINT fk_cobro_admin FOREIGN KEY (admin_feria_id) REFERENCES usuario(id)
);

-- Pagos en línea (modo prueba). tipo = 'puesto': referencia_id es la solicitud; tipo = 'publicacion': es el cobro_publicacion.
CREATE TABLE IF NOT EXISTS pago_linea (
  id INT AUTO_INCREMENT PRIMARY KEY,
  token CHAR(48) NOT NULL UNIQUE,
  tipo ENUM('puesto', 'publicacion') NOT NULL,
  referencia_id INT NOT NULL,
  usuario_id INT NOT NULL,           -- quien paga
  monto INT NOT NULL,
  estado ENUM('iniciado', 'aprobado', 'rechazado', 'anulado') NOT NULL DEFAULT 'iniciado',
  codigo_autorizacion VARCHAR(20) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resuelto_en DATETIME NULL,
  INDEX idx_pago_referencia (tipo, referencia_id, estado),
  CONSTRAINT fk_pago_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id)
);

-- Valores que el administrador de la plataforma puede cambiar desde la app (por ahora, la tarifa por puesto)
CREATE TABLE IF NOT EXISTS configuracion (
  clave VARCHAR(50) PRIMARY KEY,
  valor VARCHAR(200) NOT NULL
);
