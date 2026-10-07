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
  rol ENUM('comerciante', 'administrador') NOT NULL DEFAULT 'comerciante',
  -- Las cuentas nuevas de comerciante quedan 'pendiente' hasta que el administrador las aprueba
  estado ENUM('pendiente', 'aprobado', 'rechazado') NOT NULL DEFAULT 'aprobado',
  motivo_registro VARCHAR(500) NULL,     -- lo que la persona cuenta al registrarse (qué quiere vender, por qué)
  comentario_admin VARCHAR(500) NULL,    -- motivo del rechazo, si lo hay
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revisado_en DATETIME NULL
);

-- Ferias creadas por el administrador. Cada una tiene su propio plano (una grilla de ancho x alto celdas)
CREATE TABLE IF NOT EXISTS feria (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  lugar VARCHAR(200) NULL,
  comuna VARCHAR(60) NULL,          -- comuna de la Región Metropolitana (ver public/datos/comunas-rm.geojson)
  latitud DECIMAL(9,6) NULL,        -- ubicación en el mapa de Santiago (opcional)
  longitud DECIMAL(9,6) NULL,
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
  INDEX idx_feria_fechas (fecha_inicio, fecha_cierre)
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
  tipo VARCHAR(20) NOT NULL,        -- escenario, bano, bar, comedor, boleteria, entrada, mesas, pasillo, pared, flecha, otro
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
  CONSTRAINT fk_solicitud_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id),
  CONSTRAINT fk_solicitud_puesto FOREIGN KEY (puesto_id) REFERENCES puesto(id),
  CONSTRAINT fk_solicitud_feria FOREIGN KEY (feria_id) REFERENCES feria(id),
  CONSTRAINT fk_solicitud_preferido FOREIGN KEY (puesto_preferido_id) REFERENCES puesto(id) ON DELETE SET NULL
);
