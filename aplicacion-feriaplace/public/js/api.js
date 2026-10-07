const API_BASE = '/api';

function obtenerSesion() {
  const raw = localStorage.getItem('feriaplace_sesion');
  return raw ? JSON.parse(raw) : null;
}

function guardarSesion(sesion) {
  localStorage.setItem('feriaplace_sesion', JSON.stringify(sesion));
}

// Escapa texto antes de insertarlo como HTML (nombres de ferias, zonas, comentarios, etc.)
function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

const NOMBRE_TAMANO = { pequeno: 'Pequeño', mediano: 'Mediano', grande: 'Grande' };

// Muestra un monto en pesos chilenos: 150000 -> "$150.000"
function formatearPesos(monto) {
  if (monto === null || monto === undefined || monto === '') return '';
  return `$${Number(monto).toLocaleString('es-CL')}`;
}

const NOMBRE_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];

// "2026-12-01" -> Date local (sin corrimiento por zona horaria)
function leerFechaLocal(texto) {
  const [a, m, d] = texto.split('-').map(Number);
  return new Date(a, m - 1, d);
}

// Rango de fechas de una feria de temporada: "1 al 24 de diciembre de 2026"
function formatearRangoFechas(inicio, cierre) {
  if (!inicio || !cierre) return '';
  const a = leerFechaLocal(inicio);
  const b = leerFechaLocal(cierre);
  if (inicio === cierre) return `${b.getDate()} de ${NOMBRE_MES[b.getMonth()]} de ${b.getFullYear()}`;
  const fin = `${b.getDate()} de ${NOMBRE_MES[b.getMonth()]} de ${b.getFullYear()}`;
  if (a.getFullYear() !== b.getFullYear()) return `${a.getDate()} de ${NOMBRE_MES[a.getMonth()]} de ${a.getFullYear()} al ${fin}`;
  if (a.getMonth() !== b.getMonth()) return `${a.getDate()} de ${NOMBRE_MES[a.getMonth()]} al ${fin}`;
  return `${a.getDate()} al ${fin}`;
}

function cerrarSesion() {
  localStorage.removeItem('feriaplace_sesion');
  window.location.href = 'login.html';
}

async function apiFetch(ruta, opciones = {}) {
  const sesion = obtenerSesion();
  const headers = { 'Content-Type': 'application/json', ...(opciones.headers || {}) };
  if (sesion?.token) {
    headers.Authorization = `Bearer ${sesion.token}`;
  }
  const respuesta = await fetch(API_BASE + ruta, { ...opciones, headers });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    if (respuesta.status === 403 && sesion?.token && /no está aprobada/.test(datos.error || '')) {
      localStorage.removeItem('feriaplace_sesion');
    }
    throw new Error(datos.error || 'Error inesperado del servidor');
  }
  return datos;
}

function requerirSesion(rolesPermitidos) {
  const sesion = obtenerSesion();
  if (!sesion) {
    window.location.href = 'login.html';
    return null;
  }
  if (rolesPermitidos && !rolesPermitidos.includes(sesion.usuario.rol)) {
    window.location.href = sesion.usuario.rol === 'administrador' ? 'admin.html' : 'solicitar.html';
    return null;
  }
  return sesion;
}

function pintarNavegacion() {
  const sesion = obtenerSesion();
  const contenedor = document.getElementById('nav-sesion');
  if (!contenedor) return;
  if (!sesion) {
    contenedor.innerHTML = '<a href="index.html">Ferias</a><a href="login.html">Iniciar sesión</a><a href="registro.html">Registrarse</a>';
    return;
  }
  const enlaces = sesion.usuario.rol === 'administrador'
    ? '<a href="index.html">Ferias</a><a href="admin.html">Solicitudes</a><a href="admin-usuarios.html">Usuarios</a><a href="admin-ferias.html">Ferias y planos</a>'
    : '<a href="index.html">Ferias</a><a href="solicitar.html">Solicitar puesto</a><a href="mis-solicitudes.html">Mis solicitudes</a>';
  contenedor.innerHTML = `${enlaces}<a href="#" id="cerrar-sesion">Salir (${esc(sesion.usuario.nombre)})</a>`;
  document.getElementById('cerrar-sesion').addEventListener('click', (e) => {
    e.preventDefault();
    cerrarSesion();
  });
}

// Pie de página común a todas las páginas
function pintarPie() {
  if (document.querySelector('footer.pie')) return;
  const pie = document.createElement('footer');
  pie.className = 'pie';
  pie.innerHTML = `
    <div class="pie-contenido">
      <div>
        <strong>FeriaPlace</strong>
        <p>Gestión de puestos de feria.</p>
      </div>
      <div>
        <strong>Contacto</strong>
        <p><a href="tel:+56929169691">+56 9 2916 9691</a></p>
        <p><a href="mailto:bastianinfor@gmail.com">bastianinfor@gmail.com</a></p>
      </div>
    </div>
    <p class="pie-legal">© ${new Date().getFullYear()} FeriaPlace. Todos los derechos reservados.</p>`;
  document.body.appendChild(pie);
}

document.addEventListener('DOMContentLoaded', pintarNavegacion);
document.addEventListener('DOMContentLoaded', pintarPie);
