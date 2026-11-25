// Planos predefinidos: reordenan los puestos de una feria con pasillos, entrada, salida y flechas
// de circulación, para partir de un recorrido claro y después ajustar a mano.
// Cada plantilla recibe el tamaño del "casillero" (el puesto más grande) y el tamaño del plano, y
// devuelve los casilleros en el orden del recorrido más los elementos de circulación.

const PLANTILLAS_PLANO = {
  calle: {
    nombre: 'Calle central',
    descripcion: 'Puestos a ambos lados de una calle ancha. Se entra por un extremo y se sale por el otro; si no caben en una calle, el recorrido sigue en zigzag por las siguientes.',
  },
  bloques: {
    nombre: 'Bloques con pasillos',
    descripcion: 'Islas de puestos espalda con espalda, rodeadas de pasillos y con un pasillo cruzado al medio. Se entra por abajo y se sale por arriba.',
  },
  u: {
    nombre: 'En U con centro libre',
    descripcion: 'Puestos por los bordes mirando hacia adentro y el centro libre para mesas, escenario o juegos. Entrada y salida en el lado abierto.',
  },
};

// Tipos de elemento que la plantilla reemplaza; los demás (escenario, baños...) se respetan
const ELEMENTOS_DE_CIRCULACION = ['pasillo', 'entrada', 'salida', 'flecha'];
const MAXIMO_PLANO = 60;

function elementoCirculacion(tipo, x, y, ancho, alto, direccion) {
  const info = TIPOS_ELEMENTO[tipo];
  return {
    tipo, etiqueta: info.etiqueta, color: info.color, direccion: direccion || null,
    pos_x: x, pos_y: y, ancho, alto,
  };
}

// Flecha de 1x2 (vertical) o 2x1 (horizontal) en el centro de un tramo de pasillo
function flechaEn(x, y, ancho, alto, direccion) {
  const vertical = direccion === 'arriba' || direccion === 'abajo';
  const fa = vertical ? 1 : 2;
  const fh = vertical ? 2 : 1;
  return elementoCirculacion('flecha', x + Math.floor((ancho - fa) / 2), y + Math.floor((alto - fh) / 2), fa, fh, direccion);
}

const DISENOS = {
  // Calles horizontales: fila de puestos, calle de 3, fila de puestos. Las calles siguientes comparten
  // la fila de atrás (espalda con espalda) y se conectan por los costados en zigzag.
  calle(W, H, sw, sh, cantidad) {
    const CALLE = 3;
    const LADO = 2; // columnas libres a cada lado para entrar, salir y pasar de una calle a otra
    const porFila = Math.floor((W - 2 * LADO) / sw);
    const altoBanda = 2 * sh + CALLE;
    // Solo las calles necesarias (sin calles vacías al final)
    const bandas = Math.min(Math.floor(H / altoBanda), Math.ceil(cantidad / (2 * Math.max(1, porFila))));
    if (porFila < 1 || bandas < 1) return null;
    const x0 = LADO + Math.floor((W - 2 * LADO - porFila * sw) / 2);
    const casilleros = [];
    const elementos = [];
    for (let b = 0; b < bandas; b++) {
      const y = b * altoBanda;
      const yCalle = y + sh;
      const haciaDerecha = b % 2 === 0;
      const orden = [...Array(porFila).keys()];
      if (!haciaDerecha) orden.reverse();
      for (const i of orden) casilleros.push({ x: x0 + i * sw, y });
      for (const i of orden) casilleros.push({ x: x0 + i * sw, y: yCalle + CALLE });
      elementos.push(elementoCirculacion('pasillo', 0, yCalle, W, CALLE));
      elementos.push(flechaEn(LADO, yCalle, W - 2 * LADO, CALLE, haciaDerecha ? 'derecha' : 'izquierda'));
      if (b < bandas - 1) {
        // Conector por el costado hacia la calle siguiente
        const xc = haciaDerecha ? W - LADO : 0;
        elementos.push(elementoCirculacion('pasillo', xc, yCalle + CALLE, LADO, altoBanda - CALLE, null));
        elementos.push(flechaEn(xc, yCalle + CALLE, LADO, altoBanda - CALLE, 'abajo'));
      }
    }
    const yPrimera = sh;
    const yUltima = (bandas - 1) * altoBanda + sh;
    const salidaDerecha = (bandas - 1) % 2 === 0;
    elementos.push(elementoCirculacion('entrada', 0, yPrimera, 1, CALLE));
    elementos.push(elementoCirculacion('salida', salidaDerecha ? W - 1 : 0, yUltima, 1, CALLE));
    return { casilleros, elementos };
  },

  // Islas de dos puestos de ancho (espalda con espalda) separadas por pasillos de 2
  bloques(W, H, sw, sh) {
    const P = 2;
    const anchoIsla = 2 * sw;
    const islas = Math.floor((W - P) / (anchoIsla + P));
    const util = H - 2 * P;
    if (islas < 1 || util < sh) return null;
    const conCruce = util >= 2 * sh + P;
    const filas = Math.floor((util - (conCruce ? P : 0)) / sh);
    if (filas < 1) return null;
    const arriba = conCruce ? Math.ceil(filas / 2) : filas;
    const x0 = Math.floor((W - (P + islas * (anchoIsla + P))) / 2) + P;
    const yCruce = P + arriba * sh;
    const yFila = (f) => P + f * sh + (conCruce && f >= arriba ? P : 0);

    const casilleros = [];
    for (let i = 0; i < islas; i++) {
      const x = x0 + i * (anchoIsla + P);
      // Se recorre de abajo hacia arriba, igual que la gente (entra abajo y sale arriba)
      for (let f = filas - 1; f >= 0; f--) casilleros.push({ x, y: yFila(f) });
      for (let f = filas - 1; f >= 0; f--) casilleros.push({ x: x + sw, y: yFila(f) });
    }
    const elementos = [
      elementoCirculacion('pasillo', 0, 0, W, P),
      elementoCirculacion('pasillo', 0, H - P, W, P),
    ];
    if (conCruce) elementos.push(elementoCirculacion('pasillo', 0, yCruce, W, P));
    for (let i = 0; i <= islas; i++) {
      const x = x0 - P + i * (anchoIsla + P);
      elementos.push(elementoCirculacion('pasillo', x, P, P, H - 2 * P));
      if (conCruce) {
        elementos.push(flechaEn(x, P, P, yCruce - P, 'arriba'));
        elementos.push(flechaEn(x, yCruce + P, P, H - P - (yCruce + P), 'arriba'));
      } else {
        elementos.push(flechaEn(x, P, P, H - 2 * P, 'arriba'));
      }
    }
    const xMedio = Math.max(0, Math.floor(W / 2) - 2);
    elementos.push(elementoCirculacion('entrada', xMedio, H - 1, Math.min(4, W), 1));
    elementos.push(elementoCirculacion('salida', xMedio, 0, Math.min(4, W), 1));
    return { casilleros, elementos };
  },

  // Puestos en los bordes izquierdo, superior y derecho; pasillo de 3 por dentro; centro libre
  u(W, H, sw, sh) {
    const P = 3;
    if (W < 2 * sw + 2 * P + 2 || H < sh + P + 2) return null;
    const casilleros = [];
    const filasLado = Math.floor(H / sh);
    for (let f = filasLado - 1; f >= 0; f--) casilleros.push({ x: 0, y: f * sh });
    const porArriba = Math.floor((W - 2 * sw) / sw);
    const xArriba = sw + Math.floor((W - 2 * sw - porArriba * sw) / 2);
    for (let i = 0; i < porArriba; i++) casilleros.push({ x: xArriba + i * sw, y: 0 });
    for (let f = 0; f < filasLado; f++) casilleros.push({ x: W - sw, y: f * sh });

    const xDer = W - sw - P;
    const elementos = [
      elementoCirculacion('pasillo', sw, sh, P, H - sh),
      elementoCirculacion('pasillo', sw, sh, W - 2 * sw, P),
      elementoCirculacion('pasillo', xDer, sh, P, H - sh),
      flechaEn(sw, sh + P, P, H - sh - P, 'arriba'),
      flechaEn(sw + P, sh, W - 2 * sw - 2 * P, P, 'derecha'),
      flechaEn(xDer, sh + P, P, H - sh - P, 'abajo'),
      elementoCirculacion('entrada', sw, H - 1, P, 1),
      elementoCirculacion('salida', xDer, H - 1, P, 1),
    ];
    return { casilleros, elementos };
  },
};

function seTocanRect(a, b) {
  return a.pos_x < b.pos_x + b.ancho && b.pos_x < a.pos_x + a.ancho
    && a.pos_y < b.pos_y + b.alto && b.pos_y < a.pos_y + a.alto;
}

// Orden natural de códigos: A2 antes que A10
function compararCodigos(a, b) {
  return a.codigo.localeCompare(b.codigo, 'es', { numeric: true, sensitivity: 'base' });
}

// Devuelve { posiciones: Map(puesto -> {pos_x, pos_y}), elementos, ancho, alto, crecio } o { error }
function calcularPlantilla(tipo, puestos, elementosActuales, anchoActual, altoActual) {
  if (!DISENOS[tipo]) return { error: 'Plano predefinido desconocido' };
  if (puestos.length === 0) return { error: 'Primero agrega los puestos de la feria; el plano predefinido los ordena.' };
  const sw = Math.max(...puestos.map((p) => p.ancho));
  const sh = Math.max(...puestos.map((p) => p.alto));
  const fijos = elementosActuales.filter((e) => !ELEMENTOS_DE_CIRCULACION.includes(e.tipo));
  const ordenados = [...puestos].sort(compararCodigos);

  // El plano no se achica más allá de los elementos fijos (escenario, baños...)
  let W = Math.max(anchoActual, ...fijos.map((e) => e.pos_x + e.ancho));
  let H = Math.max(altoActual, ...fijos.map((e) => e.pos_y + e.alto));
  for (let intento = 0; intento < 200; intento++) {
    // Los elementos fijos deben quedar dentro del plano; los casilleros que los tocan se saltan
    const diseno = DISENOS[tipo](W, H, sw, sh, ordenados.length);
    if (diseno) {
      const libres = diseno.casilleros.filter((c) => !fijos.some((e) => seTocanRect({ pos_x: c.x, pos_y: c.y, ancho: sw, alto: sh }, e)));
      if (libres.length >= ordenados.length) {
        const posiciones = new Map(ordenados.map((p, i) => [p, { pos_x: libres[i].x, pos_y: libres[i].y }]));
        return {
          posiciones,
          elementos: [...fijos, ...diseno.elementos],
          ancho: W,
          alto: H,
          crecio: W !== anchoActual || H !== altoActual,
        };
      }
    }
    if (W >= MAXIMO_PLANO && H >= MAXIMO_PLANO) break;
    // Crece de a poco, alternando alto y ancho para no deformar el plano
    if ((intento % 2 === 0 && H < MAXIMO_PLANO) || W >= MAXIMO_PLANO) H = Math.min(MAXIMO_PLANO, H + 2);
    else W = Math.min(MAXIMO_PLANO, W + 2);
  }
  return { error: `No caben ${puestos.length} puestos con este plano predefinido ni en el plano más grande (${MAXIMO_PLANO}×${MAXIMO_PLANO}). Prueba otro o achica algunos puestos.` };
}
