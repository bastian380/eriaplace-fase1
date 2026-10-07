const express = require('express');
const pool = require('../db');
const { verificarToken, usuarioOpcional, requireRol } = require('../middleware/auth');
const { COMUNAS, comunaEnPunto } = require('../comunas');
const { ubicarEnFilas } = require('../plano');
const { leerElementos, guardarElementos } = require('../elementos');

const router = express.Router();

const TAMANOS = ['pequeno', 'mediano', 'grande'];
const LIMITE_PLANO = { min: 6, max: 60 };
const MAX_PUESTOS_INICIALES = 200;
const PRECIO_MAXIMO = 100000000;

const SQL_FERIA_CON_CONTEO = `
  SELECT f.id, f.nombre, f.lugar, f.fecha_texto, f.descripcion, f.ancho, f.alto, f.publicada,
         f.comuna, f.latitud, f.longitud, f.precio_puesto,
         DATE_FORMAT(f.fecha_inicio, '%Y-%m-%d') AS fecha_inicio,
         DATE_FORMAT(f.fecha_cierre, '%Y-%m-%d') AS fecha_cierre,
         COUNT(p.id) AS total_puestos,
         COALESCE(SUM(p.estado = 'disponible'), 0) AS puestos_disponibles
  FROM feria f
  LEFT JOIN puesto p ON p.feria_id = f.id`;

function esAdmin(req) {
  return req.usuario && req.usuario.rol === 'administrador';
}

function normalizarConteo(feria) {
  return {
    ...feria,
    publicada: Boolean(feria.publicada),
    latitud: feria.latitud === null ? null : Number(feria.latitud),
    longitud: feria.longitud === null ? null : Number(feria.longitud),
    precio_puesto: feria.precio_puesto === null ? null : Number(feria.precio_puesto),
    total_puestos: Number(feria.total_puestos),
    puestos_disponibles: Number(feria.puestos_disponibles),
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
  // La ubicación es opcional, pero si viene deben venir latitud y longitud juntas
  const sinUbicacion = [body.latitud, body.longitud].every((v) => v === undefined || v === null || v === '');
  const latitud = sinUbicacion ? null : Number(body.latitud);
  const longitud = sinUbicacion ? null : Number(body.longitud);
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
    },
  };
}

// Lista de ferias. Visitantes y comerciantes ven solo las publicadas; con ?todas=1 el administrador ve todas.
router.get('/', usuarioOpcional, async (req, res) => {
  const todas = req.query.todas === '1' && esAdmin(req);
  const [ferias] = await pool.query(
    `${SQL_FERIA_CON_CONTEO} ${todas ? '' : 'WHERE f.publicada = 1'} GROUP BY f.id
     ORDER BY f.fecha_inicio IS NULL, f.fecha_inicio, f.creado_en DESC, f.id DESC`
  );
  res.json(ferias.map(normalizarConteo));
});

// Una feria con su plano y todos sus puestos
router.get('/:id', usuarioOpcional, async (req, res) => {
  const [ferias] = await pool.query(`${SQL_FERIA_CON_CONTEO} WHERE f.id = ? GROUP BY f.id`, [req.params.id]);
  if (ferias.length === 0 || (!ferias[0].publicada && !esAdmin(req))) {
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

// El administrador crea una feria nueva. Si indica una cantidad de puestos, se crean ya ubicados en el plano.
router.post('/', verificarToken, requireRol('administrador'), async (req, res) => {
  const { datos, error } = leerDatosFeria(req.body);
  if (error) return res.status(400).json({ error });
  const iniciales = leerPuestosIniciales(req.body, datos);
  if (iniciales.error) return res.status(400).json({ error: iniciales.error });
  datos.alto = iniciales.alto;

  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const [resultado] = await conexion.query(
      `INSERT INTO feria (nombre, lugar, fecha_texto, fecha_inicio, fecha_cierre, precio_puesto, descripcion,
         ancho, alto, publicada, comuna, latitud, longitud)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [datos.nombre, datos.lugar, datos.fecha_texto, datos.fecha_inicio, datos.fecha_cierre, datos.precio_puesto,
        datos.descripcion, datos.ancho, datos.alto, datos.publicada, datos.comuna, datos.latitud, datos.longitud]
    );
    for (const p of iniciales.puestos) {
      await conexion.query(
        'INSERT INTO puesto (feria_id, codigo, zona, tamano, pos_x, pos_y, ancho, alto) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [resultado.insertId, p.codigo, p.zona, p.tamano, p.pos_x, p.pos_y, p.ancho, p.alto]
      );
    }
    await conexion.commit();
    res.status(201).json({
      id: resultado.insertId, ...datos, publicada: Boolean(datos.publicada), total_puestos: iniciales.puestos.length,
    });
  } catch (err) {
    await conexion.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al crear la feria' });
  } finally {
    conexion.release();
  }
});

// El administrador cambia los datos generales de la feria (nombre, fechas, precio, lugar, comuna, ubicación, plano, publicada)
router.put('/:id', verificarToken, requireRol('administrador'), async (req, res) => {
  const { datos, error } = leerDatosFeria(req.body);
  if (error) return res.status(400).json({ error });
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
     WHERE id = ?`,
    [datos.nombre, datos.lugar, datos.fecha_texto, datos.fecha_inicio, datos.fecha_cierre, datos.precio_puesto,
      datos.descripcion, datos.ancho, datos.alto, datos.publicada, datos.comuna, datos.latitud, datos.longitud,
      req.params.id]
  );
  if (resultado.affectedRows === 0) return res.status(404).json({ error: 'Feria no encontrada' });
  res.json({ id: Number(req.params.id), ...datos, publicada: Boolean(datos.publicada) });
});

// El administrador elimina una feria solo si no tiene puestos ocupados ni solicitudes
router.delete('/:id', verificarToken, requireRol('administrador'), async (req, res) => {
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const [[uso]] = await conexion.query(
      `SELECT (SELECT COUNT(*) FROM puesto WHERE feria_id = ? AND estado = 'ocupado') AS ocupados,
              (SELECT COUNT(*) FROM solicitud WHERE feria_id = ?) AS solicitudes`,
      [req.params.id, req.params.id]
    );
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

// El administrador guarda el plano completo: crea, mueve, edita y elimina puestos en una sola operación
router.put('/:id/plano', verificarToken, requireRol('administrador'), async (req, res) => {
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
    const [ferias] = await conexion.query('SELECT * FROM feria WHERE id = ? FOR UPDATE', [req.params.id]);
    if (ferias.length === 0) {
      await conexion.rollback();
      return res.status(404).json({ error: 'Feria no encontrada' });
    }
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
    await conexion.commit();
    res.json({ guardado: true, total: puestos.length, eliminados: aEliminar.length });
  } catch (err) {
    await conexion.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al guardar el plano' });
  } finally {
    conexion.release();
  }
});

module.exports = router;
