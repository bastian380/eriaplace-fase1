const tipoCuenta = document.getElementById('tipo-cuenta');

// El formulario cambia según el tipo de cuenta: el Administrador de Feria indica su organización
function pintarTipoCuenta() {
  const esAdminFeria = tipoCuenta.value === 'admin_feria';
  document.getElementById('campo-organizacion').classList.toggle('oculto', !esAdminFeria);
  document.getElementById('ayuda-admin-feria').classList.toggle('oculto', !esAdminFeria);
  document.getElementById('organizacion').required = esAdminFeria;
  document.getElementById('etiqueta-motivo').textContent = esAdminFeria
    ? '¿Qué feria administras, dónde y cuántos puestos quieres publicar?'
    : '¿Qué quieres vender y por qué te interesa un puesto?';
  document.getElementById('motivo').placeholder = esAdminFeria
    ? 'Ej: organizo la feria navideña de la Plaza de Maipú, del 5 al 24 de diciembre, con 8 puestos.'
    : 'Ej: vendo verduras de mi huerta en Maipú y busco un puesto los fines de semana.';
}
tipoCuenta.addEventListener('change', pintarTipoCuenta);
if (new URLSearchParams(window.location.search).get('tipo') === 'admin_feria') tipoCuenta.value = 'admin_feria';
pintarTipoCuenta();

document.getElementById('form-registro').addEventListener('submit', async (e) => {
  e.preventDefault();
  const mensaje = document.getElementById('mensaje');
  mensaje.innerHTML = '';
  const nombre = document.getElementById('nombre').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const telefono = document.getElementById('telefono').value.trim();
  const motivo_registro = document.getElementById('motivo').value.trim();
  const tipo_cuenta = tipoCuenta.value;
  const organizacion = document.getElementById('organizacion').value.trim();
  try {
    await apiFetch('/auth/registro', {
      method: 'POST',
      body: JSON.stringify({ nombre, email, password, telefono, motivo_registro, tipo_cuenta, organizacion }),
    });
    mensaje.innerHTML = '<div class="mensaje exito">Solicitud enviada. FeriaPlace revisará tu cuenta; cuando la apruebe podrás iniciar sesión.</div>';
    document.getElementById('form-registro').reset();
    pintarTipoCuenta();
  } catch (err) {
    mensaje.innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
  }
});
