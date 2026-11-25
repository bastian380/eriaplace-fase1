// Buscador público del inicio: por producto o rubro y, si se quiere, por día.
function estrellasTexto(promedio, total) {
  if (!total) return '';
  return ` · <span class="estrellas" title="${String(promedio).replace('.', ',')} de 5">★ ${String(promedio).replace('.', ',')}</span> (${total})`;
}

(() => {
  const $ = (id) => document.getElementById(id);
  const resultados = $('resultados-busqueda');

  // "AAAA-MM-DD" en hora local
  const textoFecha = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function proximo(diaSemana) {
    const d = new Date();
    d.setDate(d.getDate() + ((diaSemana - d.getDay() + 7) % 7));
    return textoFecha(d);
  }
  function fechaElegida() {
    const cuando = $('buscar-cuando').value;
    if (cuando === 'hoy') return textoFecha(new Date());
    if (cuando === 'sabado') return proximo(6);
    if (cuando === 'domingo') return proximo(0);
    if (cuando === 'fecha') return $('buscar-fecha').value;
    return '';
  }

  $('buscar-cuando').addEventListener('change', () => {
    $('buscar-fecha').classList.toggle('oculto', $('buscar-cuando').value !== 'fecha');
  });

  $('form-buscar').addEventListener('submit', async (e) => {
    e.preventDefault();
    resultados.innerHTML = '<p>Buscando...</p>';
    const fecha = fechaElegida();
    const params = new URLSearchParams({ q: $('buscar-texto').value.trim() });
    if (fecha) params.set('fecha', fecha);
    try {
      const { ferias } = await apiFetch(`/buscar?${params}`);
      if (ferias.length === 0) {
        resultados.innerHTML = `<p class="estado-vacio">No encontramos puestos con ese producto${fecha ? ' ese día' : ''}.</p>`;
        return;
      }
      resultados.innerHTML = ferias.map((f) => `
        <div class="resultado-feria">
          <strong><a href="?feria=${f.id}">${esc(f.nombre)}</a></strong>
          <span class="texto-suave">${[formatearRangoFechas(f.fecha_inicio, f.fecha_cierre), f.lugar, f.comuna].filter(Boolean).map(esc).join(' · ')}</span>
          <ul>${f.puestos.map((p) => `
            <li><a href="?feria=${f.id}&puesto=${p.id}">Puesto ${esc(p.codigo)}</a> · ${esc(p.rubro)} · ${esc(p.zona)}${estrellasTexto(p.promedio, p.total_resenas)}</li>`).join('')}
          </ul>
        </div>`).join('');
    } catch (err) {
      resultados.innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
    }
  });
})();
