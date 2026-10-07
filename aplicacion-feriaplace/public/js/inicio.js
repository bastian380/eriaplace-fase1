(async () => {
  const listaFerias = document.getElementById('lista-ferias');
  const tarjetaPlano = document.getElementById('tarjeta-plano');
  const contenedorPlano = document.getElementById('plano');
  const detallePuesto = document.getElementById('detalle-puesto');
  const sesion = obtenerSesion();

  let ferias = [];
  let feriaActual = null;
  let puestoSeleccionado = null;

  function describirFeria(f) {
    return [formatearRangoFechas(f.fecha_inicio, f.fecha_cierre), f.lugar, f.comuna, f.fecha_texto]
      .filter(Boolean).map(esc).join(' · ');
  }

  // Precio que se cobra por un puesto: el suyo propio o, si no tiene, el precio base de la feria
  function precioDe(p) {
    return p.precio ?? feriaActual.precio_puesto;
  }

  // ---------- Mapa de Santiago ----------
  const detalleComuna = document.getElementById('detalle-comuna');
  let mapaSantiago = null;

  function feriasDeComuna(nombre) {
    return ferias.filter((f) => f.comuna === nombre);
  }

  function textoCantidad(n) {
    if (n === 0) return 'Sin ferias todavía';
    return n === 1 ? '1 feria' : `${n} ferias`;
  }

  function mostrarComuna(nombre) {
    const lista = feriasDeComuna(nombre);
    detalleComuna.classList.remove('oculto');
    detalleComuna.innerHTML = `
      <h3>${esc(nombre)}</h3>
      ${lista.length === 0
    ? '<p class="texto-suave">Todavía no hay ferias publicadas en esta comuna.</p>'
    : `<ul class="ferias-comuna">${lista.map((f) => `
          <li><a href="?feria=${f.id}" data-id="${f.id}">${esc(f.nombre)}</a>
            <span class="texto-suave">${f.puestos_disponibles} de ${f.total_puestos} puestos disponibles</span></li>`).join('')}
        </ul>`}
    `;
    detalleComuna.querySelectorAll('a[data-id]').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        abrirFeria(Number(a.dataset.id), true);
      });
    });
  }

  async function pintarMapa() {
    try {
      mapaSantiago = await crearMapaSantiago('mapa-santiago', {
        destacar: (nombre) => feriasDeComuna(nombre).length > 0,
        textoComuna: (nombre) => textoCantidad(feriasDeComuna(nombre).length),
        alHacerClicComuna: (nombre) => mostrarComuna(nombre),
      });
    } catch (err) {
      document.getElementById('mapa-santiago').innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
      return;
    }
    // Las ferias que ya tienen ubicación aparecen como un marcador
    for (const f of ferias.filter((x) => x.latitud !== null && x.longitud !== null)) {
      const marcador = L.marker([f.latitud, f.longitud], { title: f.nombre }).addTo(mapaSantiago.mapa);
      const popup = document.createElement('div');
      popup.innerHTML = `
        <strong>${esc(f.nombre)}</strong><br>
        <span class="texto-suave">${describirFeria(f)}</span><br>
        ${f.puestos_disponibles} de ${f.total_puestos} puestos disponibles<br>
        <a href="?feria=${f.id}">Ver plano</a>`;
      popup.querySelector('a').addEventListener('click', (e) => {
        e.preventDefault();
        abrirFeria(f.id, true);
      });
      marcador.bindPopup(popup);
    }
  }

  function pintarLista() {
    if (ferias.length === 0) {
      listaFerias.innerHTML = sesion && sesion.usuario.rol === 'administrador'
        ? '<p class="estado-vacio">Todavía no hay ferias. <a href="admin-ferias.html">Crea la primera en Ferias y planos</a>.</p>'
        : '<p class="estado-vacio">Todavía no hay ferias publicadas. Vuelve pronto.</p>';
      return;
    }
    listaFerias.innerHTML = ferias.map((f) => `
      <button type="button" class="feria-item ${feriaActual && feriaActual.id === f.id ? 'activa' : ''}" data-id="${f.id}">
        <strong>${esc(f.nombre)}</strong>
        <span class="texto-suave">${describirFeria(f) || '&nbsp;'}</span>
        ${f.precio_puesto !== null ? `<span class="precio">Puesto desde ${formatearPesos(f.precio_puesto)} por la temporada</span>` : ''}
        <span class="disponibles">${f.puestos_disponibles} de ${f.total_puestos} puestos disponibles</span>
      </button>
    `).join('');
    listaFerias.querySelectorAll('.feria-item').forEach((boton) => {
      boton.addEventListener('click', () => abrirFeria(Number(boton.dataset.id)));
    });
  }

  function pintarDetalle() {
    const p = puestoSeleccionado;
    if (!p) {
      detallePuesto.innerHTML = '<p class="texto-suave">Toca un puesto del plano para ver sus datos.</p>';
      return;
    }
    let accion = '';
    if (p.estado === 'disponible' && (!sesion || sesion.usuario.rol === 'comerciante')) {
      const destino = `solicitar.html?feria=${feriaActual.id}&puesto=${p.id}`;
      const enlace = sesion ? destino : `login.html?volver=${encodeURIComponent(destino)}`;
      accion = `<a class="boton" href="${enlace}">Solicitar este puesto</a>`;
      if (!sesion) accion += '<p class="texto-suave">Necesitas iniciar sesión o <a href="registro.html">crear una cuenta</a> para solicitarlo.</p>';
    }
    detallePuesto.innerHTML = `
      <h3>Puesto ${esc(p.codigo)}</h3>
      <p>${esc(p.zona)} · ${NOMBRE_TAMANO[p.tamano] || esc(p.tamano)} ·
        <span class="badge ${p.estado}">${p.estado}</span></p>
      ${precioDe(p) !== null ? `<p class="precio">Arriendo: ${formatearPesos(precioDe(p))} por toda la temporada</p>` : ''}
      ${accion}
    `;
  }

  function pintarPlano() {
    dibujarPlano(contenedorPlano, feriaActual, feriaActual.puestos, {
      seleccionadoId: puestoSeleccionado && puestoSeleccionado.id,
      alHacerClic: (p) => {
        puestoSeleccionado = p;
        pintarPlano();
        pintarDetalle();
      },
    });
  }

  async function abrirFeria(id, irAlPlano) {
    try {
      feriaActual = await apiFetch(`/ferias/${id}`);
    } catch (err) {
      tarjetaPlano.classList.remove('oculto');
      contenedorPlano.innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
      return;
    }
    puestoSeleccionado = null;
    history.replaceState(null, '', `?feria=${id}`);
    document.getElementById('feria-nombre').textContent = feriaActual.nombre;
    document.getElementById('feria-detalle').innerHTML = describirFeria(feriaActual);
    document.getElementById('feria-descripcion').textContent = feriaActual.descripcion || '';
    tarjetaPlano.classList.remove('oculto');
    pintarLista();
    pintarPlano();
    pintarDetalle();
    if (irAlPlano) tarjetaPlano.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  try {
    ferias = await apiFetch('/ferias');
  } catch (err) {
    listaFerias.innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
    return;
  }
  pintarLista();
  crearCalendario(document.getElementById('calendario'), {
    ferias,
    alHacerClicFeria: (f) => abrirFeria(f.id, true),
    irAProxima: true,
    textoVacio: 'Este mes no hay ferias de temporada publicadas. Usa las flechas para ver otros meses.',
  });
  pintarMapa();
  const pedida = Number(new URLSearchParams(window.location.search).get('feria'));
  const inicial = ferias.find((f) => f.id === pedida) || ferias[0];
  if (inicial) abrirFeria(inicial.id);
})();
