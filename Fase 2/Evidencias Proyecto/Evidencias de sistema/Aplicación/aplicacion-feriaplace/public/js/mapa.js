(async () => {
  const sesion = requerirSesion();
  if (!sesion) return;

  const contenedor = document.getElementById('mapa');
  try {
    const puestos = await apiFetch('/puestos');
    contenedor.innerHTML = puestos.map((p) => `
      <div class="puesto-celda ${p.estado}" title="${p.zona} · ${p.tamano}">
        ${p.codigo}
      </div>
    `).join('');
  } catch (err) {
    contenedor.innerHTML = `<div class="mensaje error">${err.message}</div>`;
  }
})();
