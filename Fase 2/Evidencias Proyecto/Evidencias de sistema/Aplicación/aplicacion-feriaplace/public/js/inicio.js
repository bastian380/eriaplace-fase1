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
  const capasFeria = new Map(); // id de feria -> { marcador, perimetro }

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
    // Cada feria con ubicación aparece con un marcador y, si tiene, con el perímetro de su terreno
    const ubicadas = ferias.filter((x) => x.latitud !== null && x.longitud !== null);
    for (const f of ubicadas) {
      const capas = { marcador: L.marker([f.latitud, f.longitud], { title: f.nombre }).addTo(mapaSantiago.mapa) };
      if (f.perimetro) {
        capas.perimetro = dibujarPerimetro(mapaSantiago.mapa, f.perimetro);
        capas.perimetro.bindTooltip(`<strong>${esc(f.nombre)}</strong><br>Terreno ${textoSuperficie(f.perimetro)}`, { sticky: true });
        capas.perimetro.on('click', () => capas.marcador.openPopup());
      }
      const popup = document.createElement('div');
      popup.innerHTML = `
        <strong>${esc(f.nombre)}</strong><br>
        <span class="texto-suave">${describirFeria(f)}</span><br>
        ${f.perimetro ? `Terreno ${textoSuperficie(f.perimetro)}<br>` : ''}
        ${f.puestos_disponibles} de ${f.total_puestos} puestos disponibles<br>
        <a href="?feria=${f.id}">Ver plano</a>`;
      popup.querySelector('a').addEventListener('click', (e) => {
        e.preventDefault();
        abrirFeria(f.id, true);
      });
      capas.marcador.bindPopup(popup);
      capasFeria.set(f.id, capas);
    }
    // El mapa parte mostrando dónde están las ferias, no toda la ciudad
    if (ubicadas.length > 0) {
      const limites = L.latLngBounds(ubicadas.flatMap((f) => f.perimetro || [[f.latitud, f.longitud]]));
      mapaSantiago.mapa.fitBounds(limites, { padding: [30, 30], maxZoom: 16 });
    }
    if (feriaActual) destacarEnMapa(feriaActual.id);
  }

  // Resalta el terreno de una feria y acerca el mapa a ella
  function destacarEnMapa(id) {
    if (!mapaSantiago) return false;
    capasFeria.forEach((capas, idFeria) => {
      if (capas.perimetro) capas.perimetro.setStyle(estiloPerimetro(idFeria === id));
    });
    const capas = capasFeria.get(id);
    if (!capas) return false;
    if (capas.perimetro) mapaSantiago.mapa.fitBounds(capas.perimetro.getBounds(), { padding: [30, 30], maxZoom: 18 });
    else mapaSantiago.mapa.setView(capas.marcador.getLatLng(), 16);
    return true;
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
    document.getElementById('btn-ver-en-mapa').classList.toggle('oculto', feriaActual.latitud === null);
    destacarEnMapa(id);
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
  document.getElementById('btn-ver-en-mapa').addEventListener('click', () => {
    if (feriaActual && destacarEnMapa(feriaActual.id)) {
      document.getElementById('mapa-santiago').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
  const pedida = Number(new URLSearchParams(window.location.search).get('feria'));
  const inicial = ferias.find((f) => f.id === pedida) || ferias[0];
  if (inicial) abrirFeria(inicial.id);
})();
