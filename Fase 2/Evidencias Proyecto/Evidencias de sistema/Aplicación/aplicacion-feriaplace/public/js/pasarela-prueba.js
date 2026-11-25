// Pasarela simulada: muestra el cobro y deja elegir si el pago se aprueba o se rechaza.
(async () => {
  if (!requerirSesion()) return;
  const $ = (id) => document.getElementById(id);
  const token = new URLSearchParams(window.location.search).get('token');
  const mostrar = (tipo, texto) => { $('mensaje-pago').innerHTML = `<div class="mensaje ${tipo}">${esc(texto)}</div>`; };

  function terminar(volver) {
    $('acciones-pago').classList.add('oculto');
    $('enlace-volver').href = volver;
    $('volver-pago').classList.remove('oculto');
  }

  let pago;
  try {
    pago = await apiFetch(`/pagos/${encodeURIComponent(token)}`);
  } catch (err) {
    mostrar('error', err.message);
    return;
  }
  $('detalle-pago').innerHTML = `<p>${esc(pago.descripcion)}</p><p>Total a pagar: <strong>${formatearPesos(pago.monto)}</strong></p>`;
  if (pago.estado !== 'iniciado') {
    mostrar(pago.estado === 'aprobado' ? 'exito' : 'error', pago.estado === 'aprobado'
      ? `Este pago ya fue aprobado. Código de autorización: ${pago.codigo_autorizacion}`
      : 'Este intento de pago ya terminó. Puedes iniciar otro desde la página anterior.');
    terminar(pago.volver);
    return;
  }
  $('acciones-pago').classList.remove('oculto');

  async function enviar(resultado) {
    $('btn-aprobar').disabled = true;
    $('btn-rechazar').disabled = true;
    try {
      const r = await apiFetch(`/pagos/${encodeURIComponent(token)}/resultado`, { method: 'POST', body: JSON.stringify({ resultado }) });
      if (r.estado === 'aprobado') {
        mostrar('exito', `Pago aprobado. Código de autorización: ${r.codigo_autorizacion}.${r.feria_publicada ? ' Tu feria ya está publicada.' : ''}`);
      } else {
        mostrar('error', 'El pago fue rechazado. No se registró ningún cobro; puedes intentarlo de nuevo.');
      }
    } catch (err) {
      mostrar('error', err.message);
    }
    terminar(pago.volver);
  }
  $('btn-aprobar').addEventListener('click', () => enviar('aprobar'));
  $('btn-rechazar').addEventListener('click', () => enviar('rechazar'));
})();
