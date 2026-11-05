// Utilidades del plano de una feria. Las medidas están en celdas de la grilla del plano.

// Medidas por defecto de cada tamaño de puesto (ancho x alto en celdas)
const MEDIDAS_TAMANO = {
  pequeno: { ancho: 2, alto: 2 },
  mediano: { ancho: 3, alto: 2 },
  grande: { ancho: 4, alto: 3 },
};

// Ubica una lista de puestos en filas agrupadas por zona, dejando un pasillo entre filas.
// Devuelve los puestos con pos_x, pos_y, ancho y alto, y el alto total que ocupa el plano.
function ubicarEnFilas(puestos, anchoPlano) {
  const porZona = new Map();
  for (const p of puestos) {
    if (!porZona.has(p.zona)) porZona.set(p.zona, []);
    porZona.get(p.zona).push(p);
  }
  const ubicados = [];
  let y = 1;
  for (const grupo of porZona.values()) {
    let x = 1;
    let altoFila = 0;
    for (const p of grupo) {
      const medida = MEDIDAS_TAMANO[p.tamano] || MEDIDAS_TAMANO.mediano;
      if (x + medida.ancho > anchoPlano - 1) {
        x = 1;
        y += altoFila + 1;
        altoFila = 0;
      }
      ubicados.push({ ...p, pos_x: x, pos_y: y, ancho: medida.ancho, alto: medida.alto });
      x += medida.ancho + 1;
      altoFila = Math.max(altoFila, medida.alto);
    }
    y += altoFila + 2;
  }
  return { puestos: ubicados, altoUsado: y };
}

module.exports = { MEDIDAS_TAMANO, ubicarEnFilas };
