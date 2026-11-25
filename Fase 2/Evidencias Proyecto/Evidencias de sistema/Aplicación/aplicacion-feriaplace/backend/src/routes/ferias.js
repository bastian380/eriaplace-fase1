const express = require('express');
const pool = require('../db');
const { verificarToken, usuarioOpcional, requireRol } = require('../middleware/auth');
const { COMUNAS, comunaEnPunto } = require('../comunas');
const { ubicarEnFilas } = require('../plano');
const { leerElementos, guardarElementos } = require('../elementos');
const {
  ROLES_GESTION, esPlataforma, esAdminFeria, puedeGestionar, feriaGestionable, filtroFerias,
  cobertura, puedePublicarse, tarifaPorPuesto, idsPlataforma,
} = require('../permisos');
const { notificar } = require('../notificar');
const { ofrecerPuestosLibres } = require('../listaEspera');

const router = express.Router();

const TAMANOS = ['pequeno', 'mediano', 'grande'];
const LIMITE_PLANO = { min: 6, max: 60 };
const MAX_PUESTOS_INICIALES = 200;
const PRECIO_MAXIMO = 100000000;

const SQL_FERIA_CON_CONTEO = `
  SELECT f.id, f.admin_feria_id, f.nombre, f.lugar, f.fecha_texto, f.descripcion, f.ancho, f.alto, f.publicada,
         f.comuna, f.latitud, f.longitud, f.perimetro, f.precio_puesto,
         DATE_FORMAT(f.fecha_inicio, '%Y-%m-%d') AS fecha_inicio,
         DATE_FORMAT(f.fecha_cierre, '%Y-%m-%d') AS fecha_cierre,
         (SELECT u.nombre FROM usuario u WHERE u.id = f.admin_feria_id) AS admin_feria_nombre,
         (SELECT COALESCE(SUM(c.puestos), 0) FROM cobro_publicacion c WHERE c.feria_id = f.id AND c.estado = 'pagado') AS puestos_pagados,
         (SELECT COALESCE(SUM(c.puestos), 0) FROM cobro_publicacion c WHERE c.feria_id = f.id AND c.estado = 'pendiente') AS puestos_pago_pendiente,
         COUNT(p.id) AS total_puestos,
         COALESCE(SUM(p.estado = 'disponible'), 0) AS puestos_disponibles
  FROM feria f
  LEFT JOIN puesto p ON p.feria_id = f.id`;


function normalizarConteo(feria) {
  return {
    ...feria,
    publicada: Boolean(feria.publicada),
    latitud: feria.latitud === null ? null : Number(feria.latitud),
    longitud: feria.longitud === null ? null : Number(feria.longitud),
    perimetro: typeof feria.perimetro === 'string' ? JSON.parse(feria.perimetro) : feria.perimetro ?? null,
    precio_puesto: feria.precio_puesto === null ? null : Number(feria.precio_puesto),
    total_puestos: Number(feria.total_puestos),
    puestos_disponibles: Number(feria.puestos_disponibles),
    puestos_pagados: Number(feria.puestos_pagados),
    puestos_pago_pendiente: Number(feria.puestos_pago_pendiente),
  };
}

// Lee un precio en pesos: vacío = sin precio (null); si viene, debe ser un entero entre 0 y PRECIO_MAXIMO
function leerPrecio(valor) {
  // Se aceptan montos escritos a la chilena, con signo peso y puntos de miles: "$150.000"
  const texto = String(valor ?? '').replace(/[$.\s]/g, '');
  if (texto === '') return { precio: null };
  const precio = Number(texto);
  if (!Number.isInteger(precio) || precio < 0 || precio > PRECIO_MAXIMO) return { error: true };
  return { precio };
}

// Lee una fecha "AAAA-MM-DD" y revisa que exista en el calendario (no acepta, por ejemplo, 2026-02-30)
function leerFecha(valor) {
  if (valor === undefined || valor === null || valor === '') return { fecha: null };
  const texto = String(valor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return { error: true };
  const d = new Date(`${texto}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== texto) return { error: true };
  return { fecha: texto };
}

const MAX_VERTICES = 100;

// Lee el perímetro de la feria: una lista de puntos [latitud, longitud] que forman un polígono cerrado.
// Vacío = sin perímetro (null). Devuelve undefined si no vino en la petición (para no borrarlo al editar).
function leerPerimetro(valor) {
  if (valor === undefined) return { perimetro: undefined };
  if (valor === null || valor === '' || (Array.isArray(valor) && valor.length === 0)) return { perimetro: null };
  if (!Array.isArray(valor) || valor.length < 3 || valor.length > MAX_VERTICES) {
    return { error: `El perímetro debe tener entre 3 y ${MAX_VERTICES} puntos` };
  }
  const puntos = [];
  for (const punto of valor) {
    const [lat, lng] = Array.isArray(punto) ? punto.map(Number) : [NaN, NaN];
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !comunaEnPunto(lat, lng)) {
      return { error: 'Todos los puntos del perímetro deben estar dentro de la Región Metropolitana' };
    }
    puntos.push([Number(lat.toFixed(6)), Number(lng.toFixed(6))]);
  }
  return { perimetro: puntos };
}

// Centro aproximado del perímetro (promedio de sus puntos): sirve para el marcador y para saber la comuna
function centroDe(perimetro) {
  const suma = perimetro.reduce(([a, b], [lat, lng]) => [a + lat, b + lng], [0, 0]);
  return [suma[0] / perimetro.length, suma[1] / perimetro.length];
}

// Valida y limpia los datos generales de una feria
function leerDatosFeria(body) {
  const nombre = (body.nombre || '').trim();
  const ancho = Number(body.ancho);
  const alto = Number(body.alto);
  if (!nombre) return { error: 'El nombre de la feria es obligatorio' };
  for (const [valor, campo] of [[ancho, 'ancho'], [alto, 'alto']]) {
    if (!Number.isInteger(valor) || valor < LIMITE_PLANO.min || valor > LIMITE_PLANO.max) {
      return { error: `El ${campo} del plano debe ser un número entre ${LIMITE_PLANO.min} y ${LIMITE_PLANO.max}` };
    }
  }
  let comuna = (body.comuna || '').trim() || null;
  if (comuna && !COMUNAS.includes(comuna)) return { error: 'La comuna no es de la Región Metropolitana' };
  const { perimetro, error: errorPerimetro } = leerPerimetro(body.perimetro);
  if (errorPerimetro) return { error: errorPerimetro };
  // La ubicación es opcional, pero si viene deben venir latitud y longitud juntas.
  // Si no se marcó un punto pero sí un perímetro, la ubicación es el centro del perímetro.
  let sinUbicacion = [body.latitud, body.longitud].every((v) => v === undefined || v === null || v === '');
  let latitud = sinUbicacion ? null : Number(body.latitud);
  let longitud = sinUbicacion ? null : Number(body.longitud);
  if (sinUbicacion && perimetro) {
    [latitud, longitud] = centroDe(perimetro);
    sinUbicacion = false;
  }
  if (!sinUbicacion) {
    const comunaDelPunto = Number.isFinite(latitud) && Number.isFinite(longitud) ? comunaEnPunto(latitud, longitud) : null;
    if (!comunaDelPunto) return { error: 'La ubicación debe estar dentro de la Región Metropolitana' };
    // Si no se eligió comuna, se usa la del punto marcado en el mapa
    comuna = comuna || comunaDelPunto;
  }
  const inicio = leerFecha(body.fecha_inicio);
  const cierre = leerFecha(body.fecha_cierre);
  if (inicio.error) return { error: 'La fecha de inicio no es válida' };
  if (cierre.error) return { error: 'La fecha de cierre no es válida' };
  if (Boolean(inicio.fecha) !== Boolean(cierre.fecha)) {
    return { error: 'Indica la fecha de inicio y la de cierre, o deja las dos vacías' };
  }
  if (inicio.fecha && cierre.fecha < inicio.fecha) {
    return { error: 'La fecha de cierre no puede ser anterior a la de inicio' };
  }
  const { precio, error: errorPrecio } = leerPrecio(body.precio_puesto);
  if (errorPrecio) return { error: 'El precio por puesto debe ser un número entero de pesos (ej: 150000 o 150.000)' };
  return {
    datos: {
      nombre,
      fecha_inicio: inicio.fecha,
      fecha_cierre: cierre.fecha,
      precio_puesto: precio,
      lugar: (body.lugar || '').trim() || null,
      fecha_texto: (body.fecha_texto || '').trim() || null,
      descripcion: (body.descripcion || '').trim() || null,
      ancho,
      alto,
      publicada: body.publicada === undefined ? 1 : (body.publicada ? 1 : 0),
      comuna,
      latitud: sinUbicacion ? null : Number(latitud.toFixed(6)),
      longitud: sinUbicacion ? null : Number(longitud.toFixed(6)),
      perimetro,
    },
  };
}

// Lista de ferias. Visitantes y comerciantes ven solo las publicadas.
// Con ?todas=1 el administrador de la plataforma ve todas y el Administrador de Feria ve todas las suyas (también borradores).
router.get('/', usuarioOpcional, async (req, res) => {
  const gestion = req.query.todas === '1' && (esPlataforma(req) || esAdminFeria(req));
  const filtro = gestion ? filtroFerias(req) : { sql: 'f.publicada = 1', params: [] };
  const [ferias] = await pool.query(
    `${SQL_FERIA_CON_CONTEO} WHERE ${filtro.sql} GROUP BY f.id
     ORDER BY f.fecha_inicio IS NULL, f.fecha_inicio, f.creado_en DESC, f.id DESC`,
    filtro.params
  );
  res.json(ferias.map(normalizarConteo));
});

// Una feria con su plano y todos sus puestos
router.get('/:id', usuarioOpcional, async (req, res) => {
  const [ferias] = await pool.query(`${SQL_FERIA_CON_CONTEO} WHERE f.id = ? GROUP BY f.id`, [req.params.id]);
  if (ferias.length === 0 || (!ferias[0].publicada && !puedeGestionar(req, ferias[0]))) {
    return res.status(404).json({ error: 'Feria no encontrada' });
  }
  const [puestos] = await pool.query(
    `SELECT id, codigo, zona, tamano, estado, pos_x, pos_y, ancho, alto, precio
     FROM puesto WHERE feria_id = ? ORDER BY codigo`,
    [req.params.id]
  );
  // Escenario, baños, pasillos, flechas y otros elementos que no se arriendan
  const [elementos] = await pool.query(
    `SELECT id, tipo, etiqueta, color, direccion, pos_x, pos_y, ancho, alto
     FROM elemento_plano WHERE feria_id = ? ORDER BY id`,
    [req.params.id]
  );
  res.json({ ...normalizarConteo(ferias[0]), puestos, elementos });
});

// Lee cuántos puestos crear de inmediato al crear la feria (0 = plano vacío para dibujarlos a mano)
function leerPuestosIniciales(body, datos) {
  const cantidad = body.cantidad_puestos === undefined || body.cantidad_puestos === '' ? 0 : Number(body.cantidad_puestos);
  if (!Number.isInteger(cantidad) || cantidad < 0 || cantidad > MAX_PUESTOS_INICIALES) {
    return { error: `La cantidad de puestos debe ser un número entre 0 y ${MAX_PUESTOS_INICIALES}` };
  }
  if (cantidad === 0) return { puestos: [], alto: datos.alto };
  const tamano = TAMANOS.includes(body.tamano_puestos) ? body.tamano_puestos : 'mediano';
  const zona = String(body.zona_puestos || '').trim().slice(0, 80) || 'General';
  const prefijo = String(body.prefijo_puestos || '').trim().slice(0, 10) || 'A';
  const lista = [];
  for (let i = 1; i <= cantidad; i++) lista.push({ codigo: `${prefijo}${i}`, zona, tamano });
  // Se acomodan en filas; si no caben en el alto elegido, el plano crece hacia abajo
  const { puestos } = ubicarEnFilas(lista, datos.ancho);
  const altoNecesario = Math.max(...puestos.map((p) => p.pos_y + p.alto)) + 1;
  if (altoNecesario > LIMITE_PLANO.max) {
    return { error: `No caben ${cantidad} puestos de ese tamaño. Agranda el ancho del plano o elige menos puestos.` };
  }
  return { puestos, alto: Math.max(datos.alto, altoNecesario) };
}

// Revisa que el id indicado sea un Administrador de Feria aprobado (para asignarle una feria)
async function leerDuenoFeria(valor) {
  if (valor === undefined || valor === null || valor === '') return { id: null };
  const [filas] = await pool.query(
    "SELECT id FROM usuario WHERE id = ? AND rol = 'admin_feria' AND estado = 'aprobado'", [valor]);
  if (filas.length === 0) return { error: 'El usuario elegido no es un Administrador de Feria aprobado' };
  return { id: filas[0].id };
}

// El administrador de la plataforma o un Administrador de Feria crean una feria nueva.
// Si indica una cantidad de puestos, se crean ya ubicados en el plano.
// La feria de un Administrador de Feria nace como borrador: se publica cuando la plataforma recibe el pago de sus puestos.
router.post('/', verificarToken, requireRol(...ROLES_GESTION), async (req, res) => {
  const { datos, error } = leerDatosFeria(req.body);
  if (error) return res.status(400).json({ error });
  const iniciales = leerPuestosIniciales(req.body, datos);
  if (iniciales.error) return res.status(400).json({ error: iniciales.error });
  datos.alto = iniciales.alto;
  let duenoId = req.usuario.id;
  if (esPlataforma(req)) {
    const dueno = await leerDuenoFeria(req.body.admin_feria_id);
    if (dueno.error) return res.status(400).json({ error: dueno.error });
    duenoId = dueno.id;
  }
  if (duenoId) datos.publicada = 0;

  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const [resultado] = await conexion.query(
      `INSERT INTO feria (admin_feria_id, nombre, lugar, fecha_texto, fecha_inicio, fecha_cierre, precio_puesto, descripcion,
         ancho, alto, publicada, comuna, latitud, longitud, perimetro)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [duenoId, datos.nombre, datos.lugar, datos.fecha_texto, datos.fecha_inicio, datos.fecha_cierre, datos.precio_puesto,
        datos.descripcion, datos.ancho, datos.alto, datos.publicada, datos.comuna, datos.latitud, datos.longitud,
        datos.perimetro ? JSON.stringify(datos.perimetro) : null]
    );
    for (const p of iniciales.puestos) {
      await conexion.query(
        'INSERT INTO puesto (feria_id, codigo, zona, tamano, pos_x, pos_y, ancho, alto) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [resultado.insertId, p.codigo, p.zona, p.tamano, p.pos_x, p.pos_y, p.ancho, p.alto]
      );
    }
    await conexion.commit();
    res.status(201).json({
      id: resultado.insertId, admin_feria_id: duenoId, ...datos, perimetro: datos.perimetro ?? null,
      publicada: Boolean(datos.publicada), total_puestos: iniciales.puestos.length,
    });
  } catch (err) {
    await conexion.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al crear la feria' });
  } finally {
    conexion.release();
  }
});

// Quien gestiona la feria cambia sus datos generales (nombre, fechas, precio, lugar, comuna, ubicación, plano, publicada).
// Una feria de Administrador de Feria solo se puede publicar si todos sus puestos están pagados a la plataforma.
router.put('/:id', verificarToken, requireRol(...ROLES_GESTION), async (req, res) => {
  const { datos, error } = leerDatosFeria(req.body);
  if (error) return res.status(400).json({ error });
  const permiso = await feriaGestionable(req, req.params.id);
  if (permiso.error) return res.status(permiso.status).json({ error: permiso.error });
  // Si no se indica, la feria queda publicada o en borrador como estaba
  if (req.body.publicada === undefined) datos.publicada = permiso.feria.publicada;
  if (datos.publicada && !permiso.feria.publicada) {
    const publicable = await puedePublicarse(permiso.feria);
    if (!publicable.ok) return res.status(402).json({ error: publicable.error });
  }
  const [[limites]] = await pool.query(
    `SELECT MAX(pos_x + ancho) AS max_x, MAX(pos_y + alto) AS max_y FROM (
       SELECT pos_x, pos_y, ancho, alto FROM puesto WHERE feria_id = ?
       UNION ALL SELECT pos_x, pos_y, ancho, alto FROM elemento_plano WHERE feria_id = ?) t`,
    [req.params.id, req.params.id]
  );
  if ((limites.max_x || 0) > datos.ancho || (limites.max_y || 0) > datos.alto) {
    return res.status(409).json({ error: 'Hay puestos o elementos que quedarían fuera del plano. Muévelos antes de achicarlo.' });
  }
  const [resultado] = await pool.query(
    `UPDATE feria SET nombre = ?, lugar = ?, fecha_texto = ?, fecha_inicio = ?, fecha_cierre = ?, precio_puesto = ?,
       descripcion = ?, ancho = ?, alto = ?, publicada = ?, comuna = ?, latitud = ?, longitud = ?
       ${datos.perimetro === undefined ? '' : ', perimetro = ?'}
     WHERE id = ?`,
    [datos.nombre, datos.lugar, datos.fecha_texto, datos.fecha_inicio, datos.fecha_cierre, datos.precio_puesto,
      datos.descripcion, datos.ancho, datos.alto, datos.publicada, datos.comuna, datos.latitud, datos.longitud,
      ...(datos.perimetro === undefined ? [] : [datos.perimetro ? JSON.stringify(datos.perimetro) : null]),
      req.params.id]
  );
  if (resultado.affectedRows === 0) return res.status(404).json({ error: 'Feria no encontrada' });
  res.json({ id: Number(req.params.id), ...datos, publicada: Boolean(datos.publicada) });
});

// Quien gestiona la feria la elimina solo si no tiene puestos ocupados, solicitudes ni pagos a la plataforma
router.delete('/:id', verificarToken, requireRol(...ROLES_GESTION), async (req, res) => {
  const permiso = await feriaGestionable(req, req.params.id);
  if (permiso.error) return res.status(permiso.status).json({ error: permiso.error });
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const [[uso]] = await conexion.query(
      `SELECT (SELECT COUNT(*) FROM puesto WHERE feria_id = ? AND estado = 'ocupado') AS ocupados,
              (SELECT COUNT(*) FROM solicitud WHERE feria_id = ?) AS solicitudes,
              (SELECT COUNT(*) FROM cobro_publicacion WHERE feria_id = ? AND estado = 'pagado') AS pagos`,
      [req.params.id, req.params.id, req.params.id]
    );
    if (uso.pagos > 0) {
      await conexion.rollback();
      return res.status(409).json({ error: 'Esta feria tiene pagos de publicación registrados. Puedes despublicarla para ocultarla.' });
    }
    if (uso.ocupados > 0 || uso.solicitudes > 0) {
      await conexion.rollback();
      return res.status(409).json({
        error: 'Esta feria ya tiene solicitudes o puestos ocupados. Puedes despublicarla para ocultarla.',
      });
    }
    await conexion.query('DELETE FROM puesto WHERE feria_id = ?', [req.params.id]);
    const [resultado] = await conexion.query('DELETE FROM feria WHERE id = ?', [req.params.id]);
    await conexion.commit();
    if (resultado.affectedRows === 0) return res.status(404).json({ error: 'Feria no encontrada' });
    res.json({ id: Number(req.params.id), eliminada: true });
  } catch (err) {
    await conexion.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar la feria' });
  } finally {
    conexion.release();
  }
});

// Valida la lista completa de puestos de un plano: dentro de los bordes, sin superponerse y con códigos únicos
function validarPlano(puestos, feria) {
  const codigos = new Set();
  for (const p of puestos) {
    const codigo = (p.codigo || '').trim();
    if (!codigo || codigo.length > 20) return `Cada puesto necesita un código de hasta 20 caracteres`;
    if (codigos.has(codigo.toUpperCase())) return `El código ${codigo} está repetido`;
    codigos.add(codigo.toUpperCase());
    if (!(p.zona || '').trim()) return `El puesto ${codigo} necesita una zona`;
    if (!TAMANOS.includes(p.tamano)) return `El puesto ${codigo} tiene un tamaño inválido`;
    if (p.precio === undefined) return `El puesto ${codigo} tiene un precio inválido (ej: 150000 o 150.000)`;
    for (const campo of ['pos_x', 'pos_y', 'ancho', 'alto']) {
      if (!Number.isInteger(p[campo])) return `El puesto ${codigo} tiene una posición inválida`;
    }
    if (p.ancho < 1 || p.alto < 1 || p.pos_x < 0 || p.pos_y < 0
      || p.pos_x + p.ancho > feria.ancho || p.pos_y + p.alto > feria.alto) {
      return `El puesto ${codigo} queda fuera del plano`;
    }
  }
  for (let i = 0; i < puestos.length; i++) {
    for (let j = i + 1; j < puestos.length; j++) {
      const a = puestos[i];
      const b = puestos[j];
      const seTocan = a.pos_x < b.pos_x + b.ancho && b.pos_x < a.pos_x + a.ancho
        && a.pos_y < b.pos_y + b.alto && b.pos_y < a.pos_y + a.alto;
      if (seTocan) return `Los puestos ${a.codigo} y ${b.codigo} se superponen`;
    }
  }
  return null;
}

// Quien gestiona la feria guarda el plano completo: crea, mueve, edita y elimina puestos en una sola operación.
// Si una feria publicada de un Administrador de Feria queda con más puestos que los pagados, vuelve a borrador.
router.put('/:id/plano', verificarToken, requireRol(...ROLES_GESTION), async (req, res) => {
  const lista = Array.isArray(req.body.puestos) ? req.body.puestos : null;
  if (!lista) return res.status(400).json({ error: 'Debes enviar la lista de puestos' });
  const puestos = lista.map((p) => ({
    // precio undefined = vino mal escrito; validarPlano lo rechaza
    id: p.id ? Number(p.id) : null,
    codigo: String(p.codigo || '').trim(),
    zona: String(p.zona || '').trim().slice(0, 80),
    tamano: p.tamano,
    pos_x: Number(p.pos_x),
    pos_y: Number(p.pos_y),
    ancho: Number(p.ancho),
    alto: Number(p.alto),
    precio: leerPrecio(p.precio).error ? undefined : leerPrecio(p.precio).precio,
  }));

  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const permiso = await feriaGestionable(req, req.params.id, conexion, true);
    if (permiso.error) {
      await conexion.rollback();
      return res.status(permiso.status).json({ error: permiso.error });
    }
    const ferias = [permiso.feria];
    // Opcional: nuevo tamaño del plano (por ejemplo, cuando un plano predefinido necesita más espacio)
    const medidas = {};
    for (const campo of ['ancho', 'alto']) {
      if (req.body[campo] === undefined) continue;
      const valor = Number(req.body[campo]);
      if (!Number.isInteger(valor) || valor < LIMITE_PLANO.min || valor > LIMITE_PLANO.max) {
        await conexion.rollback();
        return res.status(400).json({ error: `El ${campo} del plano debe ser un número entre ${LIMITE_PLANO.min} y ${LIMITE_PLANO.max}` });
      }
      medidas[campo] = valor;
    }
    ferias[0] = { ...ferias[0], ...medidas };
    const errorPlano = validarPlano(puestos, ferias[0]);
    if (errorPlano) {
      await conexion.rollback();
      return res.status(400).json({ error: errorPlano });
    }
    // Si no vienen elementos (escenario, baños, pasillos...), se dejan como estaban
    const elementos = req.body.elementos === undefined ? null : leerElementos(req.body.elementos, ferias[0]);
    if (elementos && elementos.error) {
      await conexion.rollback();
      return res.status(400).json({ error: elementos.error });
    }

    const [actuales] = await conexion.query('SELECT id, codigo, estado FROM puesto WHERE feria_id = ? FOR UPDATE', [req.params.id]);
    const idsActuales = new Map(actuales.map((p) => [p.id, p]));
    for (const p of puestos) {
      if (p.id && !idsActuales.has(p.id)) {
        await conexion.rollback();
        return res.status(400).json({ error: `El puesto ${p.codigo} no pertenece a esta feria` });
      }
    }
    const idsEnviados = new Set(puestos.filter((p) => p.id).map((p) => p.id));
    const aEliminar = actuales.filter((p) => !idsEnviados.has(p.id));
    const ocupado = aEliminar.find((p) => p.estado === 'ocupado');
    if (ocupado) {
      await conexion.rollback();
      return res.status(409).json({ error: `No puedes eliminar el puesto ${ocupado.codigo} porque está ocupado` });
    }

    for (const p of aEliminar) {
      await conexion.query('DELETE FROM puesto WHERE id = ?', [p.id]);
    }
    // Primero se renombran temporalmente los existentes para que intercambiar códigos no choque con el índice único
    for (const p of puestos.filter((x) => x.id)) {
      await conexion.query('UPDATE puesto SET codigo = ? WHERE id = ?', [`~tmp${p.id}`, p.id]);
    }
    for (const p of puestos) {
      if (p.id) {
        await conexion.query(
          'UPDATE puesto SET codigo = ?, zona = ?, tamano = ?, pos_x = ?, pos_y = ?, ancho = ?, alto = ?, precio = ? WHERE id = ?',
          [p.codigo, p.zona, p.tamano, p.pos_x, p.pos_y, p.ancho, p.alto, p.precio, p.id]
        );
      } else {
        await conexion.query(
          'INSERT INTO puesto (feria_id, codigo, zona, tamano, pos_x, pos_y, ancho, alto, precio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [req.params.id, p.codigo, p.zona, p.tamano, p.pos_x, p.pos_y, p.ancho, p.alto, p.precio]
        );
      }
    }
    if (elementos) await guardarElementos(conexion, req.params.id, elementos.elementos);
    if (Object.keys(medidas).length > 0) {
      if (!elementos) {
        // Los elementos que no se enviaron también deben caber en el nuevo tamaño
        const [[fuera]] = await conexion.query(
          'SELECT COUNT(*) AS n FROM elemento_plano WHERE feria_id = ? AND (pos_x + ancho > ? OR pos_y + alto > ?)',
          [req.params.id, ferias[0].ancho, ferias[0].alto]
        );
        if (fuera.n > 0) {
          await conexion.rollback();
          return res.status(400).json({ error: 'Con ese tamaño algunos elementos del plano quedan afuera' });
        }
      }
      await conexion.query('UPDATE feria SET ancho = ?, alto = ? WHERE id = ?', [ferias[0].ancho, ferias[0].alto, req.params.id]);
    }
    let despublicada = false;
    let porPagar = 0;
    if (ferias[0].admin_feria_id && ferias[0].publicada) {
      const c = await cobertura(req.params.id, conexion);
      porPagar = Math.max(0, c.total - c.pagados);
      if (porPagar > 0) {
        await conexion.query('UPDATE feria SET publicada = 0 WHERE id = ?', [req.params.id]);
        despublicada = true;
      }
    }
    await conexion.commit();
    // Si se agregaron puestos y hay gente esperando, se les ofrecen
    await ofrecerPuestosLibres(req.params.id).catch((err) => console.error('No se pudo avisar a la lista de espera:', err.message));
    res.json({ guardado: true, total: puestos.length, eliminados: aEliminar.length, despublicada, puestos_por_pagar: porPagar });
  } catch (err) {
    await conexion.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al guardar el plano' });
  } finally {
    conexion.release();
  }
});

// El administrador de la plataforma asigna la feria a un Administrador de Feria (o la deja a cargo de la plataforma con null)
router.put('/:id/administrador', verificarToken, requireRol('administrador'), async (req, res) => {
  const dueno = await leerDuenoFeria(req.body.admin_feria_id);
  if (dueno.error) return res.status(400).json({ error: dueno.error });
  const [resultado] = await pool.query('UPDATE feria SET admin_feria_id = ? WHERE id = ?', [dueno.id, req.params.id]);
  if (resultado.affectedRows === 0) return res.status(404).json({ error: 'Feria no encontrada' });
  if (dueno.id) {
    const [[f]] = await pool.query('SELECT nombre FROM feria WHERE id = ?', [req.params.id]);
    await notificar(dueno.id, {
      titulo: `Ahora administras "${f.nombre}"`,
      mensaje: `La plataforma te asignó la feria "${f.nombre}". Ya puedes gestionar su plano, sus solicitudes y sus pagos.`,
      enlace: 'admin-ferias.html',
    });
  }
  res.json({ id: Number(req.params.id), admin_feria_id: dueno.id });
});

// El Administrador de Feria pide publicar su feria: se genera el cobro de la plataforma por los puestos que aún no están
// pagados ni cobrados (puestos x tarifa vigente). Cuando la plataforma registra el pago, la feria se publica.
router.post('/:id/publicacion', verificarToken, requireRol(...ROLES_GESTION), async (req, res) => {
  const permiso = await feriaGestionable(req, req.params.id);
  if (permiso.error) return res.status(permiso.status).json({ error: permiso.error });
  const { feria } = permiso;
  if (!feria.admin_feria_id) {
    return res.status(400).json({ error: 'Las ferias a cargo de la plataforma no pagan publicación' });
  }
  try {
    const c = await cobertura(feria.id);
    if (c.total === 0) return res.status(400).json({ error: 'Agrega puestos al plano antes de pedir la publicación' });
    const faltan = c.total - c.pagados - c.pendientes;
    if (faltan <= 0) {
      if (c.pendientes > 0) {
        return res.status(409).json({ error: 'Ya tienes un cobro pendiente que cubre los puestos de esta feria' });
      }
      // Todo pagado: se publica de inmediato
      await pool.query('UPDATE feria SET publicada = 1 WHERE id = ?', [feria.id]);
      return res.json({ publicada: true, cobro: null });
    }
    const tarifa = await tarifaPorPuesto();
    const monto = faltan * tarifa;
    const [resultado] = await pool.query(
      'INSERT INTO cobro_publicacion (feria_id, admin_feria_id, puestos, tarifa, monto) VALUES (?, ?, ?, ?, ?)',
      [feria.id, feria.admin_feria_id, faltan, tarifa, monto]
    );
    for (const id of await idsPlataforma()) {
      await notificar(id, {
        titulo: `Cobro nuevo: "${feria.nombre}"`,
        mensaje: `Se pidió publicar ${faltan} puestos de "${feria.nombre}" por $${monto.toLocaleString('es-CL')}. Registra el pago cuando lo recibas.`,
        enlace: 'cobros.html',
      });
    }
    return res.status(201).json({
      publicada: false,
      cobro: { id: resultado.insertId, feria_id: feria.id, puestos: faltan, tarifa, monto, estado: 'pendiente' },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error al pedir la publicación' });
  }
});

module.exports = router;
