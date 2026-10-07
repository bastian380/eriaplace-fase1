// Tipos de elementos del plano que no se arriendan: nombre que ve el admin, etiqueta, color y medidas (ancho x alto en celdas) por defecto
const TIPOS_ELEMENTO = {
  escenario: { nombre: 'Escenario', etiqueta: 'Escenario', color: '#a8558f', medidas: [6, 4] },
  bano: { nombre: 'Baño', etiqueta: 'Baño', color: '#111827', medidas: [3, 2] },
  bar: { nombre: 'Bar', etiqueta: 'Bar', color: '#9ca3af', medidas: [2, 4] },
  comedor: { nombre: 'Comedor', etiqueta: 'Comedor', color: '#84cc16', medidas: [6, 2] },
  boleteria: { nombre: 'Boletería', etiqueta: 'Boletería', color: '#facc15', medidas: [5, 2] },
  entrada: { nombre: 'Entrada', etiqueta: 'Entrada', color: '#0ea5e9', medidas: [4, 1] },
  mesas: { nombre: 'Mesas', etiqueta: 'Mesas', color: '#15803d', medidas: [4, 3] },
  pasillo: { nombre: 'Pasillo', etiqueta: 'Pasillo', color: '#e5e7eb', medidas: [8, 1] },
  pared: { nombre: 'Pared', etiqueta: '', color: '#111827', medidas: [8, 1] },
  flecha: { nombre: 'Flecha de circulación', etiqueta: '', color: '#dc2626', medidas: [1, 2] },
  otro: { nombre: 'Otro', etiqueta: 'Otro', color: '#6b7280', medidas: [3, 2] },
};

// Flechas de circulación dibujadas en SVG: [viewBox, puntos] según la dirección
const FORMA_FLECHA = {
  arriba: ['0 0 20 40', '10,0 20,14 14,14 14,40 6,40 6,14 0,14'],
  abajo: ['0 0 20 40', '10,40 20,26 14,26 14,0 6,0 6,26 0,26'],
  derecha: ['0 0 40 20', '40,10 26,0 26,6 0,6 0,14 26,14 26,20'],
  izquierda: ['0 0 40 20', '0,10 14,0 14,6 40,6 40,14 14,14 14,20'],
};

// Dibuja el plano de una feria como una grilla de ancho x alto celdas, con cada puesto ubicado en ella.
// Los elementos (escenario, baño, pasillos, flechas...) se dibujan debajo de los puestos.
// opciones.alHacerClic(puesto): se llama al tocar un puesto
// opciones.seleccionadoId: id del puesto a destacar
// opciones.claseDePuesto(puesto): clases extra para un puesto
// opciones.elementos: lista de elementos a dibujar (por defecto feria.elementos)
function dibujarPlano(contenedor, feria, puestos, opciones = {}) {
  contenedor.innerHTML = '';
  const marco = document.createElement('div');
  marco.className = 'plano-marco';
  const plano = document.createElement('div');
  plano.className = 'plano';
  aplicarMedidasPlano(plano, feria);

  for (const e of opciones.elementos || feria.elementos || []) {
    plano.appendChild(crearElementoPlano(e));
  }

  for (const p of puestos) {
    const celda = document.createElement('button');
    celda.type = 'button';
    celda.className = `plano-puesto ${p.estado || 'disponible'} ${opciones.claseDePuesto ? opciones.claseDePuesto(p) : ''}`;
    if (opciones.seleccionadoId && p.id === opciones.seleccionadoId) celda.classList.add('seleccionado');
    ubicarEnGrilla(celda, p);
    celda.textContent = p.codigo;
    celda.title = `${p.codigo} · ${p.zona} · ${NOMBRE_TAMANO[p.tamano] || p.tamano} · ${p.estado}`;
    if (opciones.alHacerClic) celda.addEventListener('click', () => opciones.alHacerClic(p));
    plano.appendChild(celda);
  }

  marco.appendChild(plano);
  contenedor.appendChild(marco);
  return plano;
}

function crearElementoPlano(e) {
  const div = document.createElement('div');
  div.className = `plano-elemento tipo-${e.tipo}`;
  ubicarEnGrilla(div, e);
  const tipo = TIPOS_ELEMENTO[e.tipo] || TIPOS_ELEMENTO.otro;
  div.title = e.etiqueta || tipo.nombre;
  if (e.tipo === 'flecha') {
    const [caja, puntos] = FORMA_FLECHA[e.direccion] || FORMA_FLECHA.arriba;
    div.innerHTML = `<svg viewBox="${caja}"><polygon points="${puntos}" fill="${esc(e.color)}"/></svg>`;
    if (e.etiqueta) div.insertAdjacentHTML('beforeend', `<span>${esc(e.etiqueta)}</span>`);
    return div;
  }
  div.style.background = e.color;
  div.style.color = colorTextoSobre(e.color);
  if (e.etiqueta) {
    const texto = document.createElement('span');
    texto.textContent = e.etiqueta;
    div.appendChild(texto);
  }
  return div;
}

// Blanco o negro, lo que se lea mejor sobre el color de fondo
function colorTextoSobre(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const luz = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luz > 0.6 ? '#111827' : '#ffffff';
}

function aplicarMedidasPlano(plano, feria) {
  plano.style.setProperty('--columnas', feria.ancho);
  plano.style.setProperty('--filas', feria.alto);
  plano.style.minWidth = `${feria.ancho * 26}px`;
}

function ubicarEnGrilla(elemento, p) {
  elemento.style.gridColumn = `${p.pos_x + 1} / span ${p.ancho}`;
  elemento.style.gridRow = `${p.pos_y + 1} / span ${p.alto}`;
}
