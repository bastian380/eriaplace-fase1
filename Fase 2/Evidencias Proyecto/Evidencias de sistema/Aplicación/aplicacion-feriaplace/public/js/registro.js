document.getElementById('form-registro').addEventListener('submit', async (e) => {
  e.preventDefault();
  const mensaje = document.getElementById('mensaje');
  mensaje.innerHTML = '';
  const nombre = document.getElementById('nombre').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const telefono = document.getElementById('telefono').value.trim();
  const motivo_registro = document.getElementById('motivo').value.trim();
  try {
    await apiFetch('/auth/registro', {
      method: 'POST',
      body: JSON.stringify({ nombre, email, password, telefono, motivo_registro }),
    });
    mensaje.innerHTML = '<div class="mensaje exito">Solicitud enviada. El administrador revisará tu cuenta; cuando la apruebe podrás iniciar sesión.</div>';
    document.getElementById('form-registro').reset();
  } catch (err) {
    mensaje.innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
  }
});
