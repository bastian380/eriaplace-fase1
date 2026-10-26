(() => {
  const sesion = requerirSesion();
  if (!sesion) return;

  const formulario = document.getElementById('form-clave');
  const mensaje = document.getElementById('mensaje');

  formulario.addEventListener('submit', async (e) => {
    e.preventDefault();
    mensaje.innerHTML = '';
    const actual = document.getElementById('actual').value;
    const nueva = document.getElementById('nueva').value;
    if (nueva !== document.getElementById('repetir').value) {
      mensaje.innerHTML = '<div class="mensaje error">Las dos contraseñas nuevas no coinciden.</div>';
      return;
    }
    try {
      await apiFetch('/auth/password', { method: 'PUT', body: JSON.stringify({ actual, nueva }) });
      // Ya no usa la clave de ejemplo: se quita el aviso del panel
      guardarSesion({ ...obtenerSesion(), clave_de_ejemplo: false });
      formulario.reset();
      mensaje.innerHTML = '<div class="mensaje exito">Contraseña cambiada. Úsala la próxima vez que inicies sesión.</div>';
    } catch (err) {
      mensaje.innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
    }
  });
})();
