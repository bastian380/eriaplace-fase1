(async () => {
  const sesion = requerirSesion(['comerciante']);
  if (!sesion) return;

  const tbody = document.getElementById('tabla-solicitudes');
  try {
    const solicitudes = await apiFetch('/solicitudes/mias');
    if (solicitudes.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7">Aún no has enviado solicitudes.</td></tr>';
      return;
    }
    tbody.innerHTML = solicitudes.map((s) => `
      <tr>
        <td>${esc(s.feria_nombre || '-')}</td>
        <td>${esc(s.rubro)}</td>
        <td>${[
          s.puesto_preferido_codigo ? `Puesto ${esc(s.puesto_preferido_codigo)}` : '',
          esc(s.zona_preferida || ''),
          NOMBRE_TAMANO[s.tamano_preferido] || '',
        ].filter(Boolean).join('<br>') || '-'}</td>
        <td><span class="badge ${s.estado}">${s.estado}</span></td>
        <td>${esc(s.puesto_codigo || '-')}</td>
        <td>${s.estado === 'confirmada'
    ? `${s.monto !== null ? formatearPesos(s.monto) : 'Monto por confirmar'}<br>
           <span class="badge ${s.estado_pago === 'pagado' ? 'pagado' : 'pendiente'}">${s.estado_pago === 'pagado' ? 'pagado' : 'pago pendiente'}</span>`
    : '-'}</td>
        <td>${esc(s.comentario_admin || '-')}</td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="mensaje error">${esc(err.message)}</div></td></tr>`;
  }
})();
