// Mantiene el destino de vuelta si la persona pasa por "Regístrate aquí"
document.getElementById('enlace-registro').href = `registro.html${window.location.search}`;

let sesionExpirada = false;
try {
  sesionExpirada = sessionStorage.getItem('feriaplace_sesion_expirada') === '1';
  sessionStorage.removeItem('feriaplace_sesion_expirada');
} catch (err) { /* sin almacenamiento */ }
if (sesionExpirada || new URLSearchParams(window.location.search).get('expirada')) {
  document.getElementById('mensaje').innerHTML =
    '<div class="mensaje error">Tu sesión expiró (dura 8 horas). Vuelve a iniciar sesión.</div>';
}

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const mensaje = document.getElementById('mensaje');
  mensaje.innerHTML = '';
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  try {
    const datos = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    guardarSesion(datos);
    // Si venía desde "Solicitar este puesto", vuelve a esa página (solo rutas internas)
    const volver = new URLSearchParams(window.location.search).get('volver');
    if (volver && /^[a-z-]+\.html(\?[\w=&%-]*)?$/.test(volver) && datos.usuario.rol === 'comerciante') {
      window.location.href = volver;
      return;
    }
    window.location.href = datos.usuario.rol === 'administrador' || datos.usuario.rol === 'admin_feria' ? 'admin.html' : 'index.html';
  } catch (err) {
    mensaje.innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
  }
});
