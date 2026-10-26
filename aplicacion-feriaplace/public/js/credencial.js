(async () => {
  const sesion = requerirSesion(['comerciante', 'administrador']);
  if (!sesion) return;

  const contenedor = document.getElementById('credencial');
  document.getElementById('btn-imprimir').addEventListener('click', () => window.print());
  const id = Number(new URLSearchParams(window.location.search).get('id'));
  try {
    const c = await apiFetch(`/credenciales/${id}`);
    contenedor.innerHTML = `
      <div class="credencial-encabezado">
        <strong>FeriaPlace</strong>
        <span>Credencial de puesto</span>
      </div>
      <div class="credencial-cuerpo">
        <div class="credencial-qr">${c.qr}</div>
        <div>
          <p class="credencial-puesto">Puesto ${esc(c.puesto)}</p>
          <p><strong>${esc(c.titular)}</strong><br>${esc(c.rubro)}</p>
          <p>${esc(c.feria)}<br><span class="texto-suave">${esc([c.lugar, c.comuna].filter(Boolean).join(', '))}</span></p>
          <p>${esc(formatearRangoFechas(c.fecha_inicio, c.fecha_cierre) || 'Sin fechas definidas')}</p>
          <p><span class="badge ${c.pagado ? 'pagado' : 'pendiente'}">${c.pagado ? 'pagado' : 'pago pendiente'}</span></p>
        </div>
      </div>
      <p class="credencial-codigo">Código: ${esc(c.codigo)}</p>`;
  } catch (err) {
    contenedor.innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
  }
})();
