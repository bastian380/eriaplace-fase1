# FeriaPlace

Sistema de gestión de puestos de feria. Un comerciante envía una solicitud indicando
sus preferencias (zona, tamaño, rubro); el administrador revisa las solicitudes
pendientes y asigna el puesto real del mapa, agilizando el proceso en vez de que
cada comerciante reserve un lugar específico.

## Reporte de ocupación por feria (octubre 2026)

En **Solicitudes** (admin) hay una tarjeta nueva, "Reporte de ocupación por feria", con una fila
por feria: fechas, puestos totales, ocupados y libres, porcentaje de ocupación, solicitudes
pendientes, lo cobrado y lo por cobrar. Arriba muestra el total de ferias y de puestos ocupados.

- El botón **Descargar CSV** baja el mismo reporte como `reporte-ocupacion.csv` (separado por
  punto y coma y con tildes, para abrirlo directo en Excel en español).
- En la API son `GET /api/reportes/ocupacion` (JSON) y `GET /api/reportes/ocupacion.csv`, solo
  para el administrador.
- No cambia la base de datos: no hay que migrar, solo reiniciar el servidor (`npm start`).

## Ferias de temporada: calendario, precios y pagos (octubre 2026)

Esta versión prepara la app para **ferias de temporada** (por ejemplo, ferias navideñas):

- **Calendario** de ferias por mes, en el inicio (lo ven todos) y en **Ferias y planos** (admin).
  Parte vacío. En el calendario del administrador, tocar un día abre "Nueva feria" con esa fecha
  de inicio; tocar una feria la abre para cambiar sus datos.
- Cada feria tiene **fecha de inicio y fecha de cierre**, horario, "¿De qué se trata?",
  lugar, comuna, ubicación en el mapa y cantidad de puestos.
- **Precio por puesto**: cada feria tiene un precio base por toda la temporada. En el plano se
  puede poner un precio distinto a un puesto (vacío = usa el precio base). Se aceptan montos
  como `150000` o `150.000`.
- **Plano tipo croquis**: además de los puestos, el plano puede tener escenario, baño, bar,
  comedor, boletería, pasillos, paredes y flechas de circulación, con su texto y color.
  Requiere `npm run migrar` (migración 005).
- **Control de pagos**: al asignar un puesto, la solicitud queda con su monto y el pago
  **pendiente**. En **Solicitudes** (admin) está la tabla "Pagos de puestos" con lo cobrado y lo
  por cobrar, filtro por feria, botón **Marcar pagado / Marcar pendiente** y el monto editable.
  No hay pago en línea: el comerciante paga por fuera y el administrador lo anota. El
  comerciante ve el monto y si está pagado en "Mis solicitudes".

**Para actualizar tu base (una sola vez):** detén el servidor y ejecuta la migración. Agrega
`fecha_inicio`, `fecha_cierre` y `precio_puesto` a `feria`, `precio` a `puesto` y `monto`,
`estado_pago` y `pagado_en` a `solicitud`. No borra nada; las solicitudes ya confirmadas quedan
con pago pendiente y sin monto (puedes escribirlo en la tabla de pagos).

```powershell
cd "C:\Users\basti\Desktop\proyecto\backend"
npm run migrar
npm start
```

Respaldo del proyecto antes de este cambio: `respaldos/proyecto-antes-de-calendario-y-pagos-2026-10-06/`.

## Área de ferias vacía (octubre 2026)

La aplicación ya **no trae ferias ni puestos de ejemplo**. El área de ferias parte vacía y el
administrador crea cada feria desde **Ferias y planos** con su información: nombre, lugar,
comuna, ubicación en el mapa, fecha u horario, descripción y **cantidad de puestos**. Los
puestos se crean solos, ordenados en filas, y después se pueden mover o cambiar en el plano.

**Si tu base ya tiene la "Feria principal" de ejemplo** (o cualquier feria que quieras borrar),
puedes vaciarla con este comando. Es opcional y **borra todas las ferias, sus puestos y todas
las solicitudes** (los usuarios se mantienen). Respalda antes la base (ver paso 2 más abajo):

```powershell
cd "C:\Users\basti\Desktop\proyecto\backend"
npm run vaciar-ferias                  # solo muestra cuántas hay, no borra nada
npm run vaciar-ferias -- --confirmar   # borra de verdad
```

## Actualizar a la versión con mapa de Santiago (octubre 2026)

Esta versión agrega un **mapa de Santiago dividido por comunas** en la página de inicio, y
permite guardar la **comuna y la ubicación** de cada feria para mostrarla en el mapa. La base de
datos necesita un pequeño cambio (agrega las columnas `comuna`, `latitud` y `longitud` a `feria`):

1. Detén el backend si está corriendo (Ctrl + C).
2. Respalda la base de datos (igual que en el paso 2 de la sección siguiente).
3. Aplica la migración y vuelve a levantar el servidor:
   ```powershell
   cd "C:\Users\basti\Desktop\proyecto\backend"
   npm run migrar
   npm start
   ```

`npm run migrar` aplica todo lo que falte (ferias y planos, y ahora la ubicación). Lo que ya
estaba aplicado lo salta, así que no pasa nada si lo ejecutas varias veces.

**Cómo se usa:**

- En el **inicio** aparece el mapa con las 52 comunas de la Región Metropolitana. Al pasar el
  mouse se ve el nombre de la comuna y cuántas ferias tiene; las comunas con ferias se pintan
  más fuerte. Al tocar una comuna aparecen sus ferias, y cada feria con ubicación tiene un
  marcador que lleva a su plano.
- En **Ferias y planos** (administrador), en los datos de la feria, haz clic en el mapa donde se
  hace la feria. La comuna se elige sola según el punto. Presiona **Guardar datos**.
- El mapa de calles viene de OpenStreetMap, así que necesita internet para verse. Las comunas
  están guardadas dentro del proyecto (`public/datos/comunas-rm.geojson`, datos de la Biblioteca
  del Congreso Nacional) y la librería del mapa también (`public/vendor/leaflet`).

## Actualizar a la versión con ferias y planos (hacer una sola vez)

Esta versión agrega **ferias con plano**: la página de inicio muestra las ferias y el mapa de
puestos disponibles, y el administrador puede crear ferias y dibujar sus puestos. La base de
datos necesita una migración:

1. Detén el backend si está corriendo (Ctrl + C).
2. Respalda la base de datos por si acaso (te pedirá la clave de `root` de MySQL):
   ```powershell
   & "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqldump.exe" -u root -p feriaplace --result-file="$HOME\Desktop\feriaplace-respaldo.sql"
   ```
3. Aplica la migración y vuelve a levantar el servidor:
   ```powershell
   cd "C:\Users\basti\Desktop\proyecto\backend"
   npm run migrar
   npm start
   ```

La migración crea una "Feria principal" con los 16 puestos que ya tenías, ordenados en filas
por zona, y asocia a ella las solicitudes existentes. Se puede ejecutar más de una vez sin
problemas. Después puedes reordenar ese plano desde **Ferias y planos**.

## Ya quedó instalado y probado en este equipo

En esta sesión se instalaron y configuraron automáticamente:

- **Node.js LTS** (`C:\Program Files\nodejs`)
- **MySQL Server 8.4** (`C:\Program Files\MySQL\MySQL Server 8.4`), instalado como
  **servicio de Windows** (`MySQL84`, arranque automático), con:
  - Base de datos `feriaplace` ya creada (`database/schema.sql`)
  - Usuario de aplicación `feriaplace_app` con permisos solo sobre `feriaplace`
  - Usuario administrador ya sembrado (`npm run seed`)
- Dependencias del backend instaladas (`backend/node_modules`)
- El flujo completo probado en el navegador: registro, login, solicitud, asignación
  del administrador y mapa reflejando el puesto ocupado.

Credenciales de prueba creadas:

- **Administrador**: `admin@feriaplace.cl` / `Admin123!`
- **Comerciante de prueba**: `juan@ejemplo.cl` / `123456` (ya tiene una solicitud
  confirmada con el puesto A1)

Las credenciales reales de la base de datos están en `backend/.env` (no se sube a git).

## Cómo volver a levantarlo

MySQL corre como **servicio de Windows** (`MySQL84`, arranque automático), así que
**se inicia solo cada vez que enciendes el PC**. Solo necesitas levantar el backend:

### 1. Iniciar el servidor de la aplicación

```powershell
cd "C:\Users\basti\Desktop\proyecto\backend"
npm start
```

Verás: `FeriaPlace corriendo en http://localhost:4000`

### 2. Abrir la aplicación

Ve a [http://localhost:4000](http://localhost:4000) en tu navegador.

## Estructura del proyecto

```
proyecto/
├── database/
│   └── schema.sql          # Tablas: usuario, feria, puesto, solicitud (instalación nueva)
├── backend/
│   ├── src/
│   │   ├── index.js        # Servidor Express (sirve API + frontend)
│   │   ├── db.js           # Conexión a MySQL
│   │   ├── seed.js         # Crea el usuario administrador inicial (sin ferias de ejemplo)
│   │   ├── vaciar-ferias.js # Borra todas las ferias, puestos y solicitudes (npm run vaciar-ferias -- --confirmar)
│   │   ├── migrar.js       # Migraciones de la base (001 ferias con plano ... 005 elementos del plano)
│   │   ├── elementos.js    # Elementos del plano que no se arriendan (escenario, baño, pasillos, flechas...)
│   │   ├── plano.js        # Medidas de puestos y acomodo automático en filas
│   │   ├── comunas.js      # Comunas de la Región Metropolitana y en qué comuna cae un punto
│   │   ├── middleware/auth.js
│   │   └── routes/
│   │       ├── auth.js         # Registro / login
│   │       ├── ferias.js       # Ferias y su plano (público: ver; admin: crear, editar, dibujar puestos)
│   │       ├── puestos.js      # Puestos (lectura)
│   │       └── solicitudes.js  # Crear, listar, asignar y rechazar solicitudes
│   ├── .env                # Credenciales reales (no compartir)
│   └── package.json
└── public/                 # Frontend (HTML + JS plano, sin frameworks)
    ├── index.html           # Inicio: lista de ferias y plano con puestos disponibles (sin login)
    ├── login.html / registro.html
    ├── solicitar.html       # Solicitud con feria y puesto preferido (comerciante)
    ├── mis-solicitudes.html # Estado de mis solicitudes (comerciante)
    ├── admin.html           # Panel de asignación (administrador)
    ├── admin-ferias.html    # Crear ferias y dibujar su plano (administrador)
    ├── js/plano.js          # Dibujo del plano, compartido por todas las páginas
    ├── js/mapa-santiago.js  # Mapa de Santiago por comunas (inicio y panel de ferias)
    ├── js/calendario.js     # Calendario mensual de ferias de temporada (inicio y panel de ferias)
    ├── datos/comunas-rm.geojson  # Límites de las 52 comunas de la Región Metropolitana
    └── vendor/leaflet/      # Librería del mapa (Leaflet 1.9.4), incluida para no depender de otro sitio
```

## Flujo de negocio

1. Cualquier persona que abre la página de inicio ve las **ferias publicadas** y el **plano**
   de cada una, con los puestos disponibles en verde y los ocupados en gris.
2. Al tocar un puesto disponible aparece **"Solicitar este puesto"**. Si no tiene sesión, se le
   pide iniciar sesión o crear su cuenta de comerciante y luego vuelve al formulario.
3. El comerciante envía una **solicitud** para una feria con su rubro y, opcionalmente, un
   puesto preferido, zona, tamaño y comentario. El puesto preferido **no queda reservado**.
4. El **administrador** ve las solicitudes pendientes. Para cada una solo aparecen los puestos
   libres de esa feria, con el preferido ya marcado. Lo **asigna** (o rechaza con un motivo).
   La asignación usa una transacción para que dos solicitudes no tomen el mismo puesto.
5. Al asignar, la solicitud queda con el **monto** (precio del puesto o precio base de la feria)
   y el **pago pendiente**. Cuando el comerciante paga, el administrador lo marca como pagado
   en "Pagos de puestos".
6. El comerciante ve en "Mis solicitudes" el estado, el puesto asignado, el monto y si está pagado.

## Crear una feria y su plano (administrador)

En **Ferias y planos**:

1. **+ Nueva feria** (o toca un día en el calendario): nombre, lugar, comuna, fecha de inicio y
   de cierre, horario, precio por puesto, de qué se trata, ubicación en el mapa y
   tamaño del plano en cuadros (por ejemplo 24 x 14). En **Puestos de la feria** indica la
   **cantidad de puestos**, su tamaño, zona y letra del código (por ejemplo 20 puestos "F" crea
   F1 a F20). Se ubican solos en filas; si no caben, el plano crece hacia abajo. Con 0 el plano
   queda vacío. Si desmarcas "Publicada" queda como borrador, oculta para los comerciantes.
2. En el plano, elige el código, la zona y el tamaño del **nuevo puesto** y **haz clic en un
   espacio vacío** para crearlo. Los códigos se numeran solos (A1, A2, ...).
3. **Arrastra** un puesto para moverlo (o usa las flechas del teclado). Al seleccionarlo puedes
   cambiar código, zona, tamaño, medidas o precio propio, o eliminarlo (tecla Supr). No se puede eliminar un
   puesto ocupado. Para cambiar el tamaño también puedes arrastrar la **esquina naranja** de lo seleccionado.
4. Para dibujar el resto del recinto, en **Agregar** elige Escenario, Baño, Bar, Comedor,
   Boletería, Entrada, Mesas, Pasillo, Pared, Flecha de circulación u Otro, y haz clic en un
   espacio vacío. Al seleccionarlo puedes cambiar su texto, color, medidas y (en las flechas) la
   dirección. Estos elementos no se arriendan, pueden quedar encima de otros (por ejemplo una
   flecha sobre un pasillo) y los ven todos en el plano de la feria.
5. Presiona **Guardar plano**. Hasta entonces nada cambia para los comerciantes.

Una feria que ya tiene solicitudes o puestos ocupados no se puede eliminar; en ese caso
desmárcala como "Publicada" para ocultarla.

## Crear más usuarios

- Cualquier persona puede pedir una cuenta de **comerciante** desde `registro.html`,
  contando qué quiere vender y por qué le interesa un puesto. La cuenta queda
  **pendiente**: no puede iniciar sesión ni pedir puestos hasta que el administrador la
  apruebe en **Usuarios** (`admin-usuarios.html`). Ahí también puede rechazarla o bloquear
  más tarde una cuenta ya aprobada (con un motivo que la persona ve al intentar entrar).
  Las cuentas que existían antes de `npm run migrar` quedan aprobadas.
- Para crear otro **administrador**, la forma más simple es conectarse a MySQL y
  actualizar el rol de un usuario ya registrado:

```sql
UPDATE usuario SET rol = 'administrador' WHERE email = 'correo@ejemplo.cl';
```

(No se agregó un formulario de "crear administrador" en la interfaz a propósito,
para que no cualquiera pueda auto-asignarse ese rol.)

## Si algo falla

- **"Error de conexión" al cargar cualquier página**: revisa que MySQL esté
  corriendo (`Get-Process mysqld`) y que el backend esté corriendo (`npm start`
  dentro de `backend/`).
- **Error de la base de datos al iniciar el backend**: revisa que
  `backend/.env` tenga las credenciales correctas (`DB_USER`, `DB_PASSWORD`,
  `DB_NAME`).
- Si necesitas reinstalar dependencias: `cd backend` y `npm install`.
- Si necesitas volver a crear el administrador (por ejemplo, en una base de datos nueva):
  `npm run seed` dentro de `backend/`. Ya no crea ninguna feria de ejemplo.
- **Error "Unknown column 'feria_id'"** o **"Unknown column 'f.comuna'"** o **"Unknown column 'estado'"**, o la página de inicio
  no muestra ferias: falta la migración, ejecuta `npm run migrar` dentro de `backend/`.
- **El mapa aparece gris, solo con las líneas de las comunas**: el mapa de calles necesita
  internet. Las comunas y las ferias funcionan igual.

## Instalar desde cero en otro equipo

1. Instala Node.js LTS y MySQL 8 (o MariaDB).
2. Crea la base y el usuario de la aplicación:
   ```sql
   SOURCE database/schema.sql;
   CREATE USER 'feriaplace_app'@'localhost' IDENTIFIED BY 'tu_clave';
   GRANT ALL ON feriaplace.* TO 'feriaplace_app'@'localhost';
   ```
3. En `backend/`, copia `.env.example` como `.env` y completa la clave de la base y un `JWT_SECRET` propio.
4. `npm install`, luego `npm run seed` (crea el administrador; las ferias se crean desde la aplicación) y `npm start`.
5. Abre http://localhost:4000.
