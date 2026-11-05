// Página pública para el inspector municipal: muestra si la credencial es válida, si el puesto está pagado
// y si la feria está en curso. No necesita iniciar sesión.
(() => {
  const resultado = document.getElementById('resultado');
  const campo = document.getElementById('codigo');

  const TEXTO_VIGENCIA = {
    en_curso: 'Feria en curso',
    aun_no_empieza: 'La feria todavía no empieza',
    terminada: 'La feria ya terminó',
    sin_fechas: 'Feria sin fechas definidas',
  };

  async function verificar(codigo) {
    resultado.innerHTML = '<p>Verificando...</p>';
    try {
      const c = await apiFetch(`/credenciales/verificar/${encodeURIComponent(codigo.trim())}`);
      // Está en regla si el puesto sigue asignado, está pagado y la feria no ha terminado
      const enRegla = c.valida && c.pagado && c.vigencia !== 'terminada';
      const titulo = !c.valida ? 'Credencial anulada' : (enRegla ? 'Puesto en regla' : 'Puesto con observaciones');
      resultado.innerHTML = `
        <div class="verificacion ${enRegla ? 'ok' : 'alerta'}">
          <strong>${titulo}</strong>
          <span>${esc(c.titular)} · Puesto ${esc(c.puesto || '-')}</span>
        </div>
        <ul class="verificacion-detalle">
          <li><span>Feria</span>${esc(c.feria || '-')}</li>
          <li><span>Lugar</span>${esc([c.lugar, c.comuna].filter(Boolean).join(', ') || '-')}</li>
          <li><span>Zona</span>${esc(c.zona || '-')}</li>
          <li><span>Rubro</span>${esc(c.rubro)}</li>
          <li><span>Fechas</span>${esc(formatearRangoFechas(c.fecha_inicio, c.fecha_cierre) || '-')} (${TEXTO_VIGENCIA[c.vigencia]})</li>
          <li><span>Pago</span><span class="badge ${c.pagado ? 'pagado' : 'pendiente'}">${c.pagado ? 'pagado' : 'pendiente'}</span></li>
          <li><span>Asignación</span>${c.valida ? 'vigente' : 'el puesto ya no está asignado a esta persona'}</li>
        </ul>`;
    } catch (err) {
      resultado.innerHTML = `<div class="verificacion alerta"><strong>Credencial no válida</strong><span>${esc(err.message)}</span></div>`;
    }
  }

  document.getElementById('form-codigo').addEventListener('submit', (e) => {
    e.preventDefault();
    history.replaceState(null, '', `?c=${encodeURIComponent(campo.value.trim())}`);
    verificar(campo.value);
  });

  const codigo = new URLSearchParams(window.location.search).get('c');
  if (codigo) {
    campo.value = codigo;
    verificar(codigo);
  }
})();
