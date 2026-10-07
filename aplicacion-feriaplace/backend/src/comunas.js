// Comunas de la Región Metropolitana, leídas del mismo mapa que usa el frontend
const fs = require('fs');
const path = require('path');

const archivo = path.join(__dirname, '..', '..', 'public', 'datos', 'comunas-rm.geojson');
const mapa = JSON.parse(fs.readFileSync(archivo, 'utf8'));
const COMUNAS = mapa.features.map((f) => f.properties.nombre);

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

// Devuelve el nombre de la comuna que contiene el punto, o null si está fuera de la región
function comunaEnPunto(lat, lng) {
  const encontrada = mapa.features.find((f) => {
    const g = f.geometry;
    const poligonos = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
    return poligonos.some((p) => puntoEnAnillo(lng, lat, p[0]) && !p.slice(1).some((h) => puntoEnAnillo(lng, lat, h)));
  });
  return encontrada ? encontrada.properties.nombre : null;
}

module.exports = { COMUNAS, comunaEnPunto };
