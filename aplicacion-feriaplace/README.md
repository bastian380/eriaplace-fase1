# FeriaPlace

Sistema de gestión de puestos de feria. Los comerciantes se registran y piden un puesto;
el administrador aprueba cuentas, crea ferias con su plano, asigna puestos, anota los pagos y
revisa un reporte de ocupación por feria (descargable en CSV).

Hecho con **Node.js (Express)** y **MySQL**. La página web se sirve desde el mismo servidor.

---

## Cómo correrlo en otro computador (Windows)

### 1. Instalar lo necesario (una sola vez)

- **Node.js LTS**: https://nodejs.org (siguiente, siguiente, finalizar).
- **MySQL 8 Community**: https://dev.mysql.com/downloads/installer/
  Durante la instalación anota la **clave de `root`** que elijas.
- **Git** (opcional, para clonar): https://git-scm.com. Si no lo quieres instalar, en GitHub
  usa el botón verde **Code → Download ZIP** y descomprime la carpeta.

### 2. Descargar el proyecto

```powershell
cd $HOME\Desktop
git clone https://github.com/bastian380/eriaplace-fase1.git
cd eriaplace-fase1\aplicacion-feriaplace
```

La aplicación está en la carpeta **`aplicacion-feriaplace`** del repositorio (la carpeta
`Fase 1` tiene la documentación del proyecto). Como el repositorio es privado, en el otro
computador te pedirá iniciar sesión con tu cuenta de GitHub.

### 3. Crear la base de datos

Abre **cmd** (Símbolo del sistema, no PowerShell) dentro de la carpeta `aplicacion-feriaplace` y ejecuta:

```cmd
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p < database\schema.sql
```

Te pedirá la clave de `root`. Luego crea el usuario que usa la aplicación:

```cmd
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p
```

y dentro de MySQL escribe:

```sql
CREATE USER 'feriaplace_app'@'localhost' IDENTIFIED BY 'feria123';
GRANT ALL ON feriaplace.* TO 'feriaplace_app'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

> También puedes hacerlo con **MySQL Workbench**: abre `database/schema.sql`, ejecútalo con el
> rayo, y luego ejecuta las 3 líneas de arriba.

### 4. Configurar el backend

En la carpeta `backend`, copia el archivo `.env.example` y renómbralo a `.env`:

```powershell
cd backend
copy .env.example .env
```

Abre `.env` con el Bloc de notas y cambia:

- `DB_PASSWORD=feria123` (la misma clave que pusiste en el paso 3)
- `JWT_SECRET=` cualquier texto largo inventado

### 5. Instalar, preparar y arrancar

Siempre dentro de `backend`:

```powershell
npm install
npm run migrar
npm run seed
npm start
```

Cuando veas el mensaje de que el servidor está escuchando, abre en el navegador:

**http://localhost:4000**

### 6. Entrar como administrador

| Correo | Clave |
|---|---|
| `admin@feriaplace.cl` | `Admin123!` |

(Se pueden cambiar en `.env` con `ADMIN_EMAIL` y `ADMIN_PASSWORD` antes de `npm run seed`.)

La app parte **sin ferias**: créalas desde **Ferias y planos**. Para probar como comerciante,
regístrate en otra ventana y aprueba la cuenta desde **Usuarios**.

---

## Para volver a abrirla otro día

```powershell
cd $HOME\Desktop\eriaplace-fase1\aplicacion-feriaplace\backend
npm start
```

y abre http://localhost:4000. Para detener el servidor: `Ctrl + C`.

## Si algo falla

- **`Access denied for user 'feriaplace_app'`**: la clave de `DB_PASSWORD` en `.env` no es la
  misma del paso 3.
- **`ECONNREFUSED 127.0.0.1:3306`**: MySQL no está encendido. Ábrelo desde *Servicios* de
  Windows (servicio `MySQL80`) y dale Iniciar.
- **`'mysql.exe' no se reconoce`**: revisa la versión en `C:\Program Files\MySQL\` y ajusta la
  ruta (por ejemplo `MySQL Server 8.4`).
- **`npm` no se reconoce**: cierra y vuelve a abrir la terminal después de instalar Node.js.
- **Puerto 4000 ocupado**: cambia `PORT=4000` en `.env` por otro, como `4001`.

## Estructura

```
backend/     servidor Express (rutas, migraciones, seed)
database/    schema.sql para crear la base desde cero
public/      páginas web, estilos y scripts del navegador
docs/        historial de cambios y detalles de cada versión
```

## Contacto

+56 9 2916 9691 · bastianinfor@gmail.com
