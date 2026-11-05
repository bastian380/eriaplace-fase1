// Calendario mensual de ferias de temporada. Cada feria aparece en todos los días entre su fecha de inicio y de cierre.
// Uso: crearCalendario(contenedor, { ferias, alHacerClicFeria(feria), alHacerClicDia('AAAA-MM-DD'), textoVacio })
// Devuelve { actualizar(ferias), irA('AAAA-MM-DD') }.
const COLORES_CALENDARIO = ['#1f6f4f', '#2563eb', '#d97706', '#7c3aed', '#db2777', '#0d9488', '#b91c1c', '#0891b2'];
const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function aTextoFecha(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function crearCalendario(contenedor, opciones = {}) {
  let ferias = [];
  const hoy = new Date();
  let mes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

  function conFechas() {
    return ferias.filter((f) => f.fecha_inicio && f.fecha_cierre);
  }

  // Un color fijo por feria, para reconocerla en todos los días que dura
  function colorDe(feria) {
    return COLORES_CALENDARIO[feria.id % COLORES_CALENDARIO.length];
  }

  function pintar() {
    const lista = conFechas();
    const primerDia = aTextoFecha(mes);
    const ultimoDia = aTextoFecha(new Date(mes.getFullYear(), mes.getMonth() + 1, 0));
    const delMes = lista.filter((f) => f.fecha_inicio <= ultimoDia && f.fecha_cierre >= primerDia);

    // La grilla parte el lunes de la semana del día 1 y termina el domingo de la semana del último día
    const inicio = new Date(mes);
    inicio.setDate(1 - ((mes.getDay() + 6) % 7));
    const celdas = [];
    const cursor = new Date(inicio);
    do {
      for (let i = 0; i < 7; i++) {
        const fecha = aTextoFecha(cursor);
        const enDia = delMes.filter((f) => f.fecha_inicio <= fecha && f.fecha_cierre >= fecha);
        const clases = ['cal-dia'];
        if (cursor.getMonth() !== mes.getMonth()) clases.push('fuera');
        if (fecha === aTextoFecha(hoy)) clases.push('hoy');
        if (opciones.alHacerClicDia) clases.push('elegible');
        celdas.push(`
          <div class="${clases.join(' ')}" data-fecha="${fecha}" ${opciones.alHacerClicDia ? `title="Crear una feria que empiece el ${cursor.getDate()} de ${NOMBRE_MES[cursor.getMonth()]}"` : ''}>
            <span class="cal-numero">${cursor.getDate()}</span>
            ${enDia.map((f) => `<button type="button" class="cal-feria" data-id="${f.id}" style="--color-feria:${colorDe(f)}"
                title="${esc(f.nombre)} · ${esc(formatearRangoFechas(f.fecha_inicio, f.fecha_cierre))}">${esc(f.nombre)}</button>`).join('')}
          </div>`);
        cursor.setDate(cursor.getDate() + 1);
      }
    } while (cursor.getMonth() === mes.getMonth());

    const sinFechas = ferias.length - lista.length;
    contenedor.innerHTML = `
      <div class="cal-barra">
        <button type="button" class="secundario sin-margen boton-chico cal-anterior" aria-label="Mes anterior">&#8249;</button>
        <strong class="cal-titulo">${NOMBRE_MES[mes.getMonth()]} ${mes.getFullYear()}</strong>
        <button type="button" class="secundario sin-margen boton-chico cal-siguiente" aria-label="Mes siguiente">&#8250;</button>
        <button type="button" class="secundario sin-margen boton-chico cal-hoy">Hoy</button>
      </div>
      <div class="cal-marco">
        <div class="cal-grilla">
          ${DIAS_SEMANA.map((d) => `<div class="cal-encabezado">${d}</div>`).join('')}
          ${celdas.join('')}
        </div>
      </div>
      ${delMes.length === 0
    ? `<p class="estado-vacio cal-vacio">${opciones.textoVacio || 'No hay ferias de temporada en este mes.'}</p>`
    : `<ul class="cal-lista">${delMes.map((f) => `
          <li><span class="punto" style="background:${colorDe(f)}"></span>
            <a href="#" data-id="${f.id}">${esc(f.nombre)}</a>
            <span class="texto-suave">${esc(formatearRangoFechas(f.fecha_inicio, f.fecha_cierre))}${f.comuna ? ` · ${esc(f.comuna)}` : ''}</span></li>`).join('')}
        </ul>`}
      ${sinFechas > 0 && opciones.avisarSinFechas
    ? `<p class="texto-suave">${sinFechas === 1 ? '1 feria no tiene' : `${sinFechas} ferias no tienen`} fechas de inicio y cierre, por eso no aparece${sinFechas === 1 ? '' : 'n'} en el calendario.</p>`
    : ''}
    `;

    contenedor.querySelector('.cal-anterior').addEventListener('click', () => mover(-1));
    contenedor.querySelector('.cal-siguiente').addEventListener('click', () => mover(1));
    contenedor.querySelector('.cal-hoy').addEventListener('click', () => {
      mes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      pintar();
    });
    contenedor.querySelectorAll('[data-id]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const feria = ferias.find((f) => f.id === Number(el.dataset.id));
        if (feria && opciones.alHacerClicFeria) opciones.alHacerClicFeria(feria);
      });
    });
    if (opciones.alHacerClicDia) {
      contenedor.querySelectorAll('.cal-dia').forEach((el) => {
        el.addEventListener('click', () => opciones.alHacerClicDia(el.dataset.fecha));
      });
    }
  }

  function mover(meses) {
    mes = new Date(mes.getFullYear(), mes.getMonth() + meses, 1);
    pintar();
  }

  function actualizar(nuevas) {
    ferias = nuevas || [];
    pintar();
  }

  function irA(fecha) {
    const d = leerFechaLocal(fecha);
    mes = new Date(d.getFullYear(), d.getMonth(), 1);
    pintar();
  }

  actualizar(opciones.ferias);
  // Si este mes no hay ferias, se abre directo en el mes de la próxima feria
  if (opciones.irAProxima) {
    const hoyTexto = aTextoFecha(hoy);
    const proxima = conFechas()
      .filter((f) => f.fecha_cierre >= hoyTexto)
      .sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio))[0];
    if (proxima && proxima.fecha_inicio > hoyTexto) irA(proxima.fecha_inicio);
  }
  return { actualizar, irA };
}
