// Mapa de Santiago dividido por comunas (Leaflet + OpenStreetMap), compartido por el inicio y el panel de ferias.
// Las comunas vienen de datos/comunas-rm.geojson (52 comunas de la Región Metropolitana).

const COLOR_COMUNA = '#1f6f4f';
// Gran Santiago: encuadre inicial del mapa. Al alejar se ve el resto de la región.
const ENCUADRE_SANTIAGO = [[-33.65, -70.85], [-33.30, -70.45]];

let promesaComunas = null;

function cargarComunas() {
  if (!promesaComunas) {
    promesaComunas = fetch('datos/comunas-rm.geojson').then((r) => {
      if (!r.ok) throw new Error('No se pudo cargar el mapa de comunas');
      return r.json();
    });
  }
  return promesaComunas;
}

// Comprueba si un punto está dentro de un anillo de coordenadas [lng, lat] (algoritmo del rayo)
function puntoEnAnillo(lng, lat, anillo) {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i];
    const [xj, yj] = anillo[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

function puntoEnPoligono(lng, lat, poligono) {
  return puntoEnAnillo(lng, lat, poligono[0]) && !poligono.slice(1).some((hueco) => puntoEnAnillo(lng, lat, hueco));
}

// Devuelve el nombre de la comuna que contiene el punto, o null si está fuera de la región
function comunaEnPunto(comunas, lat, lng) {
  const encontrada = comunas.features.find((f) => {
    const g = f.geometry;
    const poligonos = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
    return poligonos.some((p) => puntoEnPoligono(lng, lat, p));
  });
  return encontrada ? encontrada.properties.nombre : null;
}

function estiloComuna(destacada) {
  return {
    color: COLOR_COMUNA,
    weight: 1.2,
    fillColor: COLOR_COMUNA,
    fillOpacity: destacada ? 0.35 : 0.06,
  };
}

// Crea el mapa con las comunas dibujadas.
// opciones.textoComuna(nombre) -> texto extra del recuadro al pasar el mouse
// opciones.destacar(nombre) -> true para pintar la comuna más fuerte (por ejemplo, si tiene ferias)
// opciones.alHacerClicComuna(nombre, capa, evento)
async function crearMapaSantiago(contenedor, opciones = {}) {
  const mapa = L.map(contenedor, { scrollWheelZoom: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Comunas: BCN',
  }).addTo(mapa);
  mapa.fitBounds(ENCUADRE_SANTIAGO);
  // La rueda del mouse solo hace zoom después de hacer clic en el mapa, para no atrapar el scroll de la página
  mapa.on('click', () => mapa.scrollWheelZoom.enable());
  mapa.on('mouseout', () => mapa.scrollWheelZoom.disable());

  const comunas = await cargarComunas();
  const destacar = opciones.destacar || (() => false);
  const capa = L.geoJSON(comunas, {
    style: (f) => estiloComuna(destacar(f.properties.nombre)),
    onEachFeature: (f, c) => {
      const nombre = f.properties.nombre;
      c.bindTooltip(() => {
        const extra = opciones.textoComuna ? opciones.textoComuna(nombre) : '';
        return `<strong>${esc(nombre)}</strong>${extra ? `<br>${extra}` : ''}`;
      }, { sticky: true });
      c.on('mouseover', () => c.setStyle({ weight: 3, fillOpacity: 0.45 }));
      c.on('mouseout', () => capa.resetStyle(c));
      if (opciones.alHacerClicComuna) c.on('click', (e) => opciones.alHacerClicComuna(nombre, c, e));
    },
  }).addTo(mapa);

  return {
    mapa,
    comunas,
    capa,
    // Vuelve a pintar las comunas (por ejemplo, cuando cambian las ferias)
    repintar: () => capa.eachLayer((c) => capa.resetStyle(c)),
  };
}
