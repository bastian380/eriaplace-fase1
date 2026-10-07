(async () => {
  const sesion = requerirSesion(['administrador']);
  if (!sesion) return;

  const MEDIDAS = { pequeno: [2, 2], mediano: [3, 2], grande: [4, 3] };
  const COLORES_ZONA = ['#2563eb', '#d97706', '#7c3aed', '#db2777', '#0d9488', '#65a30d', '#dc2626', '#0891b2'];

  const $ = (id) => document.getElementById(id);
  const listaFerias = $('lista-ferias');
  const editor = $('editor');

  let ferias = [];
  let feria = null;       // feria abierta (datos guardados)
  let puestos = [];       // copia editable de los puestos del plano
  let elementos = [];     // copia editable de los elementos del plano (escenario, baño, pasillos...)
  let seleccion = null;   // puesto o elemento seleccionado (los elementos tienen esElemento: true)
  let hayCambios = false;
  let siguienteClave = 1;

  function mostrar(idContenedor, tipo, texto) {
    $(idContenedor).innerHTML = texto ? `<div class="mensaje ${tipo}">${esc(texto)}</div>` : '';
  }

  function colorZona(zona) {
    const zonas = [...new Set(puestos.map((p) => p.zona))].sort();
    return COLORES_ZONA[Math.max(0, zonas.indexOf(zona)) % COLORES_ZONA.length];
  }

  function marcarCambios(valor) {
    hayCambios = valor;
    $('estado-cambios').textContent = valor ? 'Cambios sin guardar' : 'Todo guardado';
    $('btn-descartar').disabled = !valor;
  }

  // ---------- Reglas del plano ----------
  // Los puestos no pueden superponerse entre sí; los elementos solo deben quedar dentro del plano
  function cabe(p, x, y, ancho, alto) {
    if (x < 0 || y < 0 || x + ancho > feria.ancho || y + alto > feria.alto) return false;
    if (p.esElemento) return true;
    return !puestos.some((o) => o !== p
      && x < o.pos_x + o.ancho && o.pos_x < x + ancho
      && y < o.pos_y + o.alto && o.pos_y < y + alto);
  }

  function siguienteCodigo(prefijo) {
    let mayor = 0;
    for (const p of puestos) {
      if (p.codigo.toUpperCase().startsWith(prefijo.toUpperCase())) {
        const numero = Number(p.codigo.slice(prefijo.length));
        if (Number.isInteger(numero)) mayor = Math.max(mayor, numero);
      }
    }
    return `${prefijo}${mayor + 1}`;
  }

  function celdaBajo(evento, plano) {
    const rect = plano.getBoundingClientRect();
    return {
      x: Math.floor(((evento.clientX - rect.left) / rect.width) * feria.ancho),
      y: Math.floor(((evento.clientY - rect.top) / rect.height) * feria.alto),
    };
  }

  // ---------- Dibujo ----------
  function pintarEditor() {
    const plano = dibujarPlano(editor, feria, puestos, {
      elementos,
      seleccionadoId: seleccion && seleccion.clave,
      claseDePuesto: () => 'editable',
    });
    plano.classList.add('con-grilla');
    plano.querySelectorAll('.plano-elemento').forEach((el, i) => {
      const elemento = elementos[i];
      el.classList.toggle('seleccionado', seleccion === elemento);
      el.addEventListener('pointerdown', (e) => iniciarArrastre(e, elemento, el, plano));
    });
    // dibujarPlano usa p.id para destacar; en el editor usamos una clave local porque los nuevos no tienen id
    plano.querySelectorAll('.plano-puesto').forEach((el, i) => {
      const p = puestos[i];
      el.dataset.clave = p.clave;
      el.classList.toggle('seleccionado', seleccion === p);
      el.style.setProperty('--color-zona', colorZona(p.zona));
      el.addEventListener('pointerdown', (e) => iniciarArrastre(e, p, el, plano));
    });
    plano.addEventListener('pointerdown', (e) => {
      if (e.target !== plano) return;
      const celda = celdaBajo(e, plano);
      if ($('n-tipo').value === 'puesto') crearPuestoEn(celda);
      else crearElementoEn($('n-tipo').value, celda);
    });
    // Asa en la esquina de lo seleccionado para cambiar su tamaño arrastrando
    const elSeleccionado = plano.querySelector('.seleccionado');
    if (elSeleccionado && seleccion) {
      const asa = document.createElement('div');
      asa.className = 'asa-tamano';
      asa.title = 'Arrastra para cambiar el tamaño';
      asa.addEventListener('pointerdown', (e) => iniciarCambioTamano(e, seleccion, elSeleccionado, plano));
      elSeleccionado.appendChild(asa);
    }
    $('lista-zonas').innerHTML = [...new Set(puestos.map((p) => p.zona))]
      .map((z) => `<option value="${esc(z)}">`).join('');
  }

  function pintarPanelElemento() {
    $('e-tipo').value = seleccion.tipo;
    $('e-etiqueta').value = seleccion.etiqueta;
    $('e-color').value = seleccion.color;
    $('e-direccion').value = seleccion.direccion || 'arriba';
    $('e-campo-direccion').classList.toggle('oculto', seleccion.tipo !== 'flecha');
    $('e-ancho').value = seleccion.ancho;
    $('e-alto').value = seleccion.alto;
  }

  function pintarPanel() {
    const panel = $('panel-puesto');
    const esElemento = Boolean(seleccion && seleccion.esElemento);
    $('panel-elemento').classList.toggle('oculto', !esElemento);
    if (esElemento) {
      panel.classList.add('oculto');
      pintarPanelElemento();
      return;
    }
    if (!seleccion) {
      panel.classList.add('oculto');
      return;
    }
    panel.classList.remove('oculto');
    $('p-codigo').value = seleccion.codigo;
    $('p-zona').value = seleccion.zona;
    $('p-tamano').value = seleccion.tamano;
    $('p-ancho').value = seleccion.ancho;
    $('p-alto').value = seleccion.alto;
    $('p-precio').value = seleccion.precio ?? '';
    $('p-precio').placeholder = feria.precio_puesto !== null ? String(feria.precio_puesto) : 'Sin precio';
    $('p-precio-ayuda').textContent = feria.precio_puesto !== null
      ? `Déjalo vacío para cobrar el precio base de la feria (${formatearPesos(feria.precio_puesto)}).`
      : 'Déjalo vacío si este puesto no tiene un precio distinto. La feria todavía no tiene precio base.';
    const estado = $('p-estado');
    estado.textContent = seleccion.estado;
    estado.className = `badge ${seleccion.estado === 'ocupado' ? 'rechazada' : 'confirmada'}`;
    $('btn-eliminar-puesto').disabled = seleccion.estado === 'ocupado';
    $('btn-eliminar-puesto').title = seleccion.estado === 'ocupado' ? 'Un puesto ocupado no se puede eliminar' : '';
  }

  function seleccionar(p) {
    seleccion = p;
    pintarEditor();
    pintarPanel();
  }

  // ---------- Acciones sobre el plano ----------
  function crearPuestoEn(celda) {
    const tamano = $('n-tamano').value;
    const [ancho, alto] = MEDIDAS[tamano];
    const zona = $('n-zona').value.trim() || 'General';
    const prefijo = $('n-prefijo').value.trim() || 'P';
    // Si el puesto no cabe justo en el clic, se corre hacia adentro del plano
    const x = Math.min(celda.x, feria.ancho - ancho);
    const y = Math.min(celda.y, feria.alto - alto);
    const nuevo = {
      clave: `n${siguienteClave++}`, id: null, codigo: siguienteCodigo(prefijo), zona, tamano,
      estado: 'disponible', pos_x: x, pos_y: y, ancho, alto, precio: null,
    };
    if (!cabe(nuevo, x, y, ancho, alto)) {
      mostrar('mensaje-plano', 'error', 'No hay espacio libre ahí para un puesto de ese tamaño.');
      return;
    }
    mostrar('mensaje-plano');
    puestos.push(nuevo);
    marcarCambios(true);
    seleccionar(nuevo);
  }

  function crearElementoEn(tipo, celda) {
    const info = TIPOS_ELEMENTO[tipo];
    const ancho = Math.min(info.medidas[0], feria.ancho);
    const alto = Math.min(info.medidas[1], feria.alto);
    const nuevo = {
      clave: `n${siguienteClave++}`, esElemento: true, id: null, tipo, etiqueta: info.etiqueta, color: info.color,
      direccion: tipo === 'flecha' ? 'arriba' : null,
      pos_x: Math.min(celda.x, feria.ancho - ancho), pos_y: Math.min(celda.y, feria.alto - alto), ancho, alto,
    };
    mostrar('mensaje-plano');
    elementos.push(nuevo);
    marcarCambios(true);
    seleccionar(nuevo);
  }

  function iniciarCambioTamano(evento, p, elemento, plano) {
    evento.preventDefault();
    evento.stopPropagation();
    const asa = evento.currentTarget;
    if (document.activeElement) document.activeElement.blur();
    if (!asa.isConnected) {
      seleccionar(p);
      return;
    }
    let medida = { ancho: p.ancho, alto: p.alto };
    let cambio = false;
    asa.setPointerCapture(evento.pointerId);

    function mover(e) {
      const celda = celdaBajo(e, plano);
      const ancho = Math.max(1, Math.min(celda.x - p.pos_x + 1, feria.ancho - p.pos_x));
      const alto = Math.max(1, Math.min(celda.y - p.pos_y + 1, feria.alto - p.pos_y));
      if (ancho === medida.ancho && alto === medida.alto) return;
      cambio = true;
      medida = { ancho, alto };
      ubicarEnGrilla(elemento, { ...p, ...medida });
      elemento.classList.toggle('invalido', !cabe(p, p.pos_x, p.pos_y, ancho, alto));
    }

    function soltar() {
      asa.removeEventListener('pointermove', mover);
      asa.removeEventListener('pointerup', soltar);
      asa.removeEventListener('pointercancel', soltar);
      if (cambio && cabe(p, p.pos_x, p.pos_y, medida.ancho, medida.alto)) {
        p.ancho = medida.ancho;
        p.alto = medida.alto;
        marcarCambios(true);
        mostrar('mensaje-plano');
      } else if (cambio) {
        mostrar('mensaje-plano', 'error', 'Con ese tamaño el puesto choca con otro. Volvió a su tamaño anterior.');
      }
      seleccionar(p);
    }

    asa.addEventListener('pointermove', mover);
    asa.addEventListener('pointerup', soltar);
    asa.addEventListener('pointercancel', soltar);
  }

  function iniciarArrastre(evento, p, elemento, plano) {
    evento.preventDefault();
    evento.stopPropagation();
    if (document.activeElement) document.activeElement.blur();
    // Si al salir de un campo del panel se volvió a dibujar el plano, este puesto ya no está en pantalla:
    // basta con seleccionarlo (el siguiente clic ya lo puede arrastrar)
    if (!elemento.isConnected) {
      seleccionar(p);
      return;
    }
    const inicio = celdaBajo(evento, plano);
    const desfase = { x: inicio.x - p.pos_x, y: inicio.y - p.pos_y };
    let destino = { x: p.pos_x, y: p.pos_y };
    let seMovio = false;
    elemento.setPointerCapture(evento.pointerId);

    function mover(e) {
      const celda = celdaBajo(e, plano);
      const x = Math.max(0, Math.min(celda.x - desfase.x, feria.ancho - p.ancho));
      const y = Math.max(0, Math.min(celda.y - desfase.y, feria.alto - p.alto));
      if (x === destino.x && y === destino.y) return;
      seMovio = true;
      destino = { x, y };
      ubicarEnGrilla(elemento, { ...p, pos_x: x, pos_y: y });
      elemento.classList.toggle('invalido', !cabe(p, x, y, p.ancho, p.alto));
      elemento.classList.add('arrastrando');
    }

    function soltar() {
      elemento.removeEventListener('pointermove', mover);
      elemento.removeEventListener('pointerup', soltar);
      elemento.removeEventListener('pointercancel', soltar);
      if (seMovio && cabe(p, destino.x, destino.y, p.ancho, p.alto)) {
        p.pos_x = destino.x;
        p.pos_y = destino.y;
        marcarCambios(true);
        mostrar('mensaje-plano');
      } else if (seMovio) {
        mostrar('mensaje-plano', 'error', 'Ese lugar choca con otro puesto. El puesto volvió a su posición.');
      }
      seleccionar(p);
    }

    elemento.addEventListener('pointermove', mover);
    elemento.addEventListener('pointerup', soltar);
    elemento.addEventListener('pointercancel', soltar);
  }

  function cambiarMedidas(ancho, alto) {
    if (!Number.isInteger(ancho) || !Number.isInteger(alto) || ancho < 1 || alto < 1) return false;
    if (!cabe(seleccion, seleccion.pos_x, seleccion.pos_y, ancho, alto)) {
      mostrar('mensaje-plano', 'error', 'Con ese tamaño el puesto choca con otro o sale del plano.');
      pintarPanel();
      return false;
    }
    seleccion.ancho = ancho;
    seleccion.alto = alto;
    return true;
  }

  $('p-codigo').addEventListener('input', () => {
    seleccion.codigo = $('p-codigo').value.trim();
    marcarCambios(true);
    pintarEditor();
  });
  $('p-zona').addEventListener('input', () => {
    seleccion.zona = $('p-zona').value;
    marcarCambios(true);
    pintarEditor();
  });
  $('p-tamano').addEventListener('change', () => {
    const tamano = $('p-tamano').value;
    const [ancho, alto] = MEDIDAS[tamano];
    seleccion.tamano = tamano;
    cambiarMedidas(ancho, alto);
    marcarCambios(true);
    seleccionar(seleccion);
  });
  $('p-precio').addEventListener('input', () => {
    const texto = $('p-precio').value.trim();
    seleccion.precio = texto === '' ? null : Number(texto);
    marcarCambios(true);
  });
  for (const id of ['p-ancho', 'p-alto']) {
    $(id).addEventListener('change', () => {
      if (cambiarMedidas(Number($('p-ancho').value), Number($('p-alto').value))) {
        marcarCambios(true);
        mostrar('mensaje-plano');
      }
      seleccionar(seleccion);
    });
  }

  // ---------- Panel del elemento seleccionado ----------
  const opcionesTipo = Object.entries(TIPOS_ELEMENTO).map(([valor, t]) => `<option value="${valor}">${esc(t.nombre)}</option>`).join('');
  $('e-tipo').innerHTML = opcionesTipo;
  $('n-tipo').insertAdjacentHTML('beforeend', opcionesTipo);
  $('n-tipo').addEventListener('change', () => {
    $('n-campos-puesto').classList.toggle('oculto', $('n-tipo').value !== 'puesto');
  });

  $('e-tipo').addEventListener('change', () => {
    const anterior = TIPOS_ELEMENTO[seleccion.tipo];
    const nuevo = TIPOS_ELEMENTO[$('e-tipo').value];
    // Si el texto y el color eran los del tipo anterior, pasan a los del tipo nuevo
    if (seleccion.etiqueta === anterior.etiqueta) seleccion.etiqueta = nuevo.etiqueta;
    if (seleccion.color === anterior.color) seleccion.color = nuevo.color;
    seleccion.tipo = $('e-tipo').value;
    seleccion.direccion = seleccion.tipo === 'flecha' ? (seleccion.direccion || 'arriba') : null;
    marcarCambios(true);
    seleccionar(seleccion);
  });
  $('e-etiqueta').addEventListener('input', () => {
    seleccion.etiqueta = $('e-etiqueta').value;
    marcarCambios(true);
    pintarEditor();
  });
  $('e-color').addEventListener('input', () => {
    seleccion.color = $('e-color').value;
    marcarCambios(true);
    pintarEditor();
  });
  $('e-direccion').addEventListener('change', () => {
    seleccion.direccion = $('e-direccion').value;
    marcarCambios(true);
    pintarEditor();
  });
  for (const id of ['e-ancho', 'e-alto']) {
    $(id).addEventListener('change', () => {
      if (cambiarMedidas(Number($('e-ancho').value), Number($('e-alto').value))) {
        marcarCambios(true);
        mostrar('mensaje-plano');
      }
      seleccionar(seleccion);
    });
  }

  function eliminarSeleccion() {
    if (!seleccion || seleccion.estado === 'ocupado') return;
    if (seleccion.esElemento) elementos = elementos.filter((e) => e !== seleccion);
    else puestos = puestos.filter((p) => p !== seleccion);
    seleccion = null;
    marcarCambios(true);
    pintarEditor();
    pintarPanel();
  }
  $('btn-eliminar-puesto').addEventListener('click', eliminarSeleccion);
  $('btn-eliminar-elemento').addEventListener('click', eliminarSeleccion);

  document.addEventListener('keydown', (e) => {
    if (!seleccion || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    const pasos = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (pasos[e.key]) {
      e.preventDefault();
      const [dx, dy] = pasos[e.key];
      if (cabe(seleccion, seleccion.pos_x + dx, seleccion.pos_y + dy, seleccion.ancho, seleccion.alto)) {
        seleccion.pos_x += dx;
        seleccion.pos_y += dy;
        marcarCambios(true);
        pintarEditor();
      }
    } else if (e.key === 'Delete') {
      eliminarSeleccion();
    } else if (e.key === 'Escape') {
      seleccionar(null);
    }
  });

  // ---------- Guardar / descartar el plano ----------
  $('btn-guardar-plano').addEventListener('click', async () => {
    mostrar('mensaje-plano');
    try {
      const cuerpo = {
        puestos: puestos.map((p) => ({
          id: p.id, codigo: p.codigo, zona: p.zona, tamano: p.tamano,
          pos_x: p.pos_x, pos_y: p.pos_y, ancho: p.ancho, alto: p.alto, precio: p.precio,
        })),
        elementos: elementos.map((e) => ({
          tipo: e.tipo, etiqueta: e.etiqueta, color: e.color, direccion: e.direccion,
          pos_x: e.pos_x, pos_y: e.pos_y, ancho: e.ancho, alto: e.alto,
        })),
      };
      await apiFetch(`/ferias/${feria.id}/plano`, { method: 'PUT', body: JSON.stringify(cuerpo) });
      await abrirFeria(feria.id, true);
      mostrar('mensaje-plano', 'exito', 'Plano guardado. Los comerciantes ya ven estos puestos.');
      await cargarLista();
    } catch (err) {
      mostrar('mensaje-plano', 'error', err.message);
    }
  });

  $('btn-descartar').addEventListener('click', () => {
    if (confirm('¿Descartar los cambios del plano que no has guardado?')) abrirFeria(feria.id, true);
  });

  window.addEventListener('beforeunload', (e) => {
    if (hayCambios) e.preventDefault();
  });

  function puedeSalir() {
    return !hayCambios || confirm('Tienes cambios del plano sin guardar. ¿Quieres descartarlos?');
  }

  // ---------- Ferias ----------
  async function cargarLista() {
    ferias = await apiFetch('/ferias?todas=1');
    calendario.actualizar(ferias);
    if (ferias.length === 0) {
      listaFerias.innerHTML = '<p class="estado-vacio">Aún no hay ferias. Crea la primera con <strong>+ Nueva feria</strong>: ponle nombre, comuna, ubicación, fecha y cuántos puestos tendrá.</p>';
      return;
    }
    listaFerias.innerHTML = ferias.map((f) => `
      <button type="button" class="feria-item ${feria && feria.id === f.id ? 'activa' : ''}" data-id="${f.id}">
        <strong>${esc(f.nombre)}</strong>
        <span class="texto-suave">${f.publicada ? 'Publicada' : 'Oculta (borrador)'}</span>
        <span class="texto-suave">${f.fecha_inicio ? esc(formatearRangoFechas(f.fecha_inicio, f.fecha_cierre)) : 'Sin fechas'}</span>
        ${f.precio_puesto !== null ? `<span class="precio">${formatearPesos(f.precio_puesto)} por puesto</span>` : ''}
        <span class="disponibles">${f.total_puestos} puestos · ${f.puestos_disponibles} disponibles</span>
      </button>
    `).join('');
    listaFerias.querySelectorAll('.feria-item').forEach((b) => {
      b.addEventListener('click', () => {
        if (puedeSalir()) abrirFeria(Number(b.dataset.id));
      });
    });
  }

  // ---------- Ubicación en el mapa ----------
  let mapaUbicacion = null;
  let marcadorUbicacion = null;
  let ubicacion = null; // { latitud, longitud } o null

  function pintarUbicacion() {
    const texto = $('f-ubicacion-texto');
    $('btn-quitar-ubicacion').classList.toggle('oculto', !ubicacion);
    if (!mapaUbicacion) return;
    if (!ubicacion) {
      texto.textContent = 'Todavía no tiene ubicación.';
      if (marcadorUbicacion) marcadorUbicacion.remove();
      marcadorUbicacion = null;
      return;
    }
    texto.textContent = `Ubicada en ${ubicacion.latitud.toFixed(5)}, ${ubicacion.longitud.toFixed(5)}.`;
    const punto = [ubicacion.latitud, ubicacion.longitud];
    if (marcadorUbicacion) marcadorUbicacion.setLatLng(punto);
    else marcadorUbicacion = L.marker(punto).addTo(mapaUbicacion.mapa);
  }

  async function prepararMapaUbicacion() {
    try {
      mapaUbicacion = await crearMapaSantiago('mapa-ubicacion');
    } catch (err) {
      $('mapa-ubicacion').innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
      return;
    }
    $('f-comuna').innerHTML = '<option value="">Sin comuna</option>' + mapaUbicacion.comunas.features
      .map((c) => `<option>${esc(c.properties.nombre)}</option>`).join('');
    if (feria) $('f-comuna').value = feria.comuna || '';
    mapaUbicacion.mapa.on('click', (e) => {
      const comuna = comunaEnPunto(mapaUbicacion.comunas, e.latlng.lat, e.latlng.lng);
      if (!comuna) {
        mostrar('mensaje-feria', 'error', 'Ese punto está fuera de la Región Metropolitana.');
        return;
      }
      ubicacion = { latitud: e.latlng.lat, longitud: e.latlng.lng };
      $('f-comuna').value = comuna;
      mostrar('mensaje-feria');
      pintarUbicacion();
    });
    pintarUbicacion();
  }

  $('btn-quitar-ubicacion').addEventListener('click', () => {
    ubicacion = null;
    pintarUbicacion();
  });

  function llenarFormulario(f) {
    $('f-nombre').value = f ? f.nombre : '';
    $('f-lugar').value = f ? f.lugar || '' : '';
    $('f-fecha').value = f ? f.fecha_texto || '' : '';
    $('f-fecha-inicio').value = f ? f.fecha_inicio || '' : '';
    $('f-fecha-cierre').value = f ? f.fecha_cierre || '' : '';
    $('f-precio').value = f && f.precio_puesto !== null ? f.precio_puesto : '';
    $('f-descripcion').value = f ? f.descripcion || '' : '';
    $('f-ancho').value = f ? f.ancho : 24;
    $('f-alto').value = f ? f.alto : 14;
    $('f-publicada').checked = f ? f.publicada : true;
    $('f-comuna').value = f ? f.comuna || '' : '';
    ubicacion = f && f.latitud !== null ? { latitud: f.latitud, longitud: f.longitud } : null;
    $('titulo-datos').textContent = f ? `Datos de "${f.nombre}"` : 'Nueva feria';
    $('btn-guardar-feria').textContent = f ? 'Guardar datos' : 'Crear feria';
    $('btn-eliminar-feria').classList.toggle('oculto', !f);
    // La cantidad de puestos se indica solo al crear; después se manejan en el plano
    $('f-puestos-iniciales').classList.toggle('oculto', Boolean(f));
    if (!f) $('f-cantidad').value = 0;
    $('tarjeta-datos').classList.remove('oculto');
    if (mapaUbicacion) {
      mapaUbicacion.mapa.invalidateSize();
      if (ubicacion) mapaUbicacion.mapa.setView([ubicacion.latitud, ubicacion.longitud], 14);
      else mapaUbicacion.mapa.fitBounds(ENCUADRE_SANTIAGO);
    }
    pintarUbicacion();
  }

  async function abrirFeria(id, mantenerMensajes) {
    const datos = await apiFetch(`/ferias/${id}`);
    feria = datos;
    puestos = datos.puestos.map((p) => ({ ...p, clave: `p${p.id}` }));
    elementos = (datos.elementos || []).map((e) => ({ ...e, clave: `e${e.id}`, esElemento: true }));
    seleccion = null;
    marcarCambios(false);
    llenarFormulario(feria);
    if (!mantenerMensajes) {
      mostrar('mensaje-feria');
      mostrar('mensaje-plano');
    }
    $('tarjeta-editor').classList.remove('oculto');
    pintarEditor();
    pintarPanel();
    history.replaceState(null, '', `?feria=${id}`);
    listaFerias.querySelectorAll('.feria-item').forEach((b) => b.classList.toggle('activa', Number(b.dataset.id) === id));
  }

  function nuevaFeria(fechaInicio) {
    if (!puedeSalir()) return;
    feria = null;
    puestos = [];
    elementos = [];
    marcarCambios(false);
    llenarFormulario(null);
    mostrar('mensaje-feria');
    $('tarjeta-editor').classList.add('oculto');
    listaFerias.querySelectorAll('.feria-item').forEach((b) => b.classList.remove('activa'));
    if (fechaInicio) {
      $('f-fecha-inicio').value = fechaInicio;
      $('tarjeta-datos').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    $('f-nombre').focus({ preventScroll: Boolean(fechaInicio) });
  }
  $('btn-nueva').addEventListener('click', () => nuevaFeria());
  // La fecha de cierre no puede quedar antes de la de inicio
  $('f-fecha-inicio').addEventListener('change', () => {
    const inicio = $('f-fecha-inicio').value;
    $('f-fecha-cierre').min = inicio;
    if (inicio && (!$('f-fecha-cierre').value || $('f-fecha-cierre').value < inicio)) $('f-fecha-cierre').value = inicio;
  });

  // Calendario: un día vacío abre una feria nueva con esa fecha de inicio; una feria se abre para editarla
  const calendario = crearCalendario($('calendario'), {
    alHacerClicDia: (fecha) => nuevaFeria(fecha),
    alHacerClicFeria: (f) => {
      if (!puedeSalir()) return;
      abrirFeria(f.id).then(() => $('tarjeta-datos').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    },
    avisarSinFechas: true,
    textoVacio: 'No hay ferias en este mes. Toca un día para crear una feria que empiece ese día.',
  });

  $('form-feria').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (feria && hayCambios) {
      mostrar('mensaje-feria', 'error', 'Primero guarda o descarta los cambios del plano.');
      return;
    }
    const cuerpo = {
      nombre: $('f-nombre').value.trim(),
      lugar: $('f-lugar').value.trim(),
      fecha_texto: $('f-fecha').value.trim(),
      fecha_inicio: $('f-fecha-inicio').value,
      fecha_cierre: $('f-fecha-cierre').value,
      precio_puesto: $('f-precio').value.trim(),
      descripcion: $('f-descripcion').value.trim(),
      ancho: Number($('f-ancho').value),
      alto: Number($('f-alto').value),
      publicada: $('f-publicada').checked,
      comuna: $('f-comuna').value,
      latitud: ubicacion ? ubicacion.latitud : null,
      longitud: ubicacion ? ubicacion.longitud : null,
    };
    if (!feria) {
      cuerpo.cantidad_puestos = Number($('f-cantidad').value || 0);
      cuerpo.tamano_puestos = $('f-tamano-puestos').value;
      cuerpo.zona_puestos = $('f-zona-puestos').value.trim();
      cuerpo.prefijo_puestos = $('f-prefijo-puestos').value.trim();
    }
    try {
      const guardada = feria
        ? await apiFetch(`/ferias/${feria.id}`, { method: 'PUT', body: JSON.stringify(cuerpo) })
        : await apiFetch('/ferias', { method: 'POST', body: JSON.stringify(cuerpo) });
      const eraNueva = !feria;
      await cargarLista();
      await abrirFeria(guardada.id, true);
      let textoNueva = 'Feria creada. Ahora dibuja sus puestos en el plano de abajo.';
      if (eraNueva && guardada.total_puestos > 0) {
        textoNueva = `Feria creada con ${guardada.total_puestos} puestos. Puedes acomodarlos en el plano de abajo.`;
      }
      mostrar('mensaje-feria', 'exito', eraNueva
        ? textoNueva
        : 'Datos de la feria guardados.');
    } catch (err) {
      mostrar('mensaje-feria', 'error', err.message);
    }
  });

  $('btn-eliminar-feria').addEventListener('click', async () => {
    if (!feria || !confirm(`¿Eliminar la feria "${feria.nombre}" y todo su plano? Esto no se puede deshacer.`)) return;
    try {
      await apiFetch(`/ferias/${feria.id}`, { method: 'DELETE' });
      feria = null;
      marcarCambios(false);
      $('tarjeta-datos').classList.add('oculto');
      $('tarjeta-editor').classList.add('oculto');
      history.replaceState(null, '', 'admin-ferias.html');
      await cargarLista();
    } catch (err) {
      mostrar('mensaje-feria', 'error', err.message);
    }
  });

  // El mapa se crea con la tarjeta visible para que Leaflet calcule bien su tamaño
  $('tarjeta-datos').classList.remove('oculto');
  await prepararMapaUbicacion();
  $('tarjeta-datos').classList.add('oculto');

  try {
    await cargarLista();
    const pedida = Number(new URLSearchParams(window.location.search).get('feria'));
    const inicial = ferias.find((f) => f.id === pedida) || ferias[0];
    if (inicial) await abrirFeria(inicial.id);
    else $('btn-nueva').click(); // sin ferias todavía: se abre directo el formulario para crear la primera
  } catch (err) {
    listaFerias.innerHTML = `<div class="mensaje error">${esc(err.message)}</div>`;
  }
})();
