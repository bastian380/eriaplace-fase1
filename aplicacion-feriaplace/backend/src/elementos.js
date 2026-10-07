// Elementos del plano: todo lo que se dibuja en el plano de una feria y no se arrienda
// (escenario, baño, bar, comedor, boletería, paredes, pasillos, flechas de circulación...).
// Las medidas están en celdas de la grilla del plano, igual que los puestos.

const TIPOS_ELEMENTO = ['escenario', 'bano', 'bar', 'comedor', 'boleteria', 'entrada', 'mesas', 'pasillo', 'pared', 'flecha', 'otro'];
const DIRECCIONES = ['arriba', 'abajo', 'izquierda', 'derecha'];
const MAX_ELEMENTOS = 300;

// Revisa y limpia la lista de elementos que manda el editor. Devuelve { elementos } o { error }.
// Los elementos pueden quedar encima de otros (por ejemplo una flecha sobre un pasillo); solo deben caber en el plano.
function leerElementos(lista, feria) {
  if (!Array.isArray(lista)) return { error: 'La lista de elementos del plano no es válida' };
  if (lista.length > MAX_ELEMENTOS) return { error: `El plano admite hasta ${MAX_ELEMENTOS} elementos` };
  const elementos = [];
  for (const e of lista) {
    const tipo = TIPOS_ELEMENTO.includes(e.tipo) ? e.tipo : null;
    if (!tipo) return { error: 'Hay un elemento del plano con un tipo inválido' };
    const etiqueta = String(e.etiqueta || '').trim().slice(0, 40);
    const nombre = etiqueta || tipo;
    const color = /^#[0-9a-fA-F]{6}$/.test(e.color || '') ? e.color.toLowerCase() : null;
    if (!color) return { error: `El elemento "${nombre}" tiene un color inválido` };
    const direccion = tipo === 'flecha' ? (DIRECCIONES.includes(e.direccion) ? e.direccion : 'arriba') : null;
    const medidas = {
      pos_x: Number(e.pos_x), pos_y: Number(e.pos_y), ancho: Number(e.ancho), alto: Number(e.alto),
    };
    if (!Object.values(medidas).every(Number.isInteger)) return { error: `El elemento "${nombre}" tiene una posición inválida` };
    if (medidas.ancho < 1 || medidas.alto < 1 || medidas.pos_x < 0 || medidas.pos_y < 0
      || medidas.pos_x + medidas.ancho > feria.ancho || medidas.pos_y + medidas.alto > feria.alto) {
      return { error: `El elemento "${nombre}" queda fuera del plano` };
    }
    elementos.push({ tipo, etiqueta, color, direccion, ...medidas });
  }
  return { elementos };
}

// Reemplaza todos los elementos de la feria por la lista nueva (dentro de la transacción de quien llama)
async function guardarElementos(conexion, feriaId, elementos) {
  await conexion.query('DELETE FROM elemento_plano WHERE feria_id = ?', [feriaId]);
  for (const e of elementos) {
    await conexion.query(
      `INSERT INTO elemento_plano (feria_id, tipo, etiqueta, color, direccion, pos_x, pos_y, ancho, alto)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [feriaId, e.tipo, e.etiqueta, e.color, e.direccion, e.pos_x, e.pos_y, e.ancho, e.alto]
    );
  }
}

module.exports = { TIPOS_ELEMENTO, leerElementos, guardarElementos };
