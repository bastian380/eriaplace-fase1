// Pago en línea en MODO PRUEBA: una pasarela simulada, propia de la app, que sigue los mismos pasos que Webpay
// (crear la transacción, ir a la pasarela, volver con el resultado). No mueve dinero ni usa credenciales.
// Sirve para dos cobros: el arriendo de un puesto (comerciante) y la publicación de una feria (Administrador de Feria).
const crypto = require('crypto');
const express = require('express');
const pool = require('../db');
const { verificarToken } = require('../middleware/auth');
const { notificar } = require('../notificar');
const { recalcularPublicacion } = require('../permisos');

const router = express.Router();
const MINUTOS_VIGENCIA = 30;
const TIPOS = ['puesto', 'publicacion'];

// El simulador nunca debe quedar disponible en un sitio publicado
router.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(503).json({ error: 'El pago en línea de prueba no está disponible en producción' });
  }
  return next();
});

// Lo que se va a pagar, con el dueño del cobro. Con conexión y bloquear = true deja la fila tomada para la transacción.
async function buscarCobro(tipo, id, conexion = pool, bloquear = false) {
  const candado = bloquear ? ' FOR UPDATE' : '';
  if (tipo === 'puesto') {
    const [[s]] = await conexion.query(
      `SELECT s.id, s.usuario_id, s.estado, s.estado_pago, s.monto, s.feria_id FROM solicitud s WHERE s.id = ?${candado}`, [id]);
    if (!s) return null;
    const [[extra]] = await conexion.query(
      `SELECT f.nombre AS feria, p.codigo AS puesto FROM solicitud s
       LEFT JOIN feria f ON f.id = s.feria_id LEFT JOIN puesto p ON p.id = s.puesto_id WHERE s.id = ?`, [id]);
    return {
      duenoId: s.usuario_id,
      monto: s.monto,
      pagable: s.estado === 'confirmada' && s.estado_pago !== 'pagado',
      descripcion: `Arriendo del puesto ${extra.puesto || ''} en "${extra.feria || 'la feria'}"`,
      volver: 'mis-solicitudes.html',
    };
  }
  const [[c]] = await conexion.query(`SELECT * FROM cobro_publicacion WHERE id = ?${candado}`, [id]);
  if (!c) return null;
  const [[f]] = await conexion.query('SELECT nombre FROM feria WHERE id = ?', [c.feria_id]);
  return {
    duenoId: c.admin_feria_id,
    monto: c.monto,
    pagable: c.estado === 'pendiente',
    descripcion: `Publicación de ${c.puestos} puestos de "${f.nombre}"`,
    volver: 'cobros.html',
    feriaId: c.feria_id,
    puestos: c.puestos,
    feriaNombre: f.nombre,
  };
}

// Inicia el pago de un cobro propio y entrega la dirección de la pasarela
router.post('/iniciar', verificarToken, async (req, res) => {
  const { tipo } = req.body;
  const id = Number(req.body.id);
  if (!TIPOS.includes(tipo) || !Number.isInteger(id)) {
    return res.status(400).json({ error: 'Datos del pago inválidos' });
  }
  try {
    const cobro = await buscarCobro(tipo, id);
    if (!cobro || cobro.duenoId !== req.usuario.id) return res.status(404).json({ error: 'Cobro no encontrado' });
    if (!cobro.pagable) return res.status(409).json({ error: 'Este cobro ya está pagado o todavía no se puede pagar' });
    if (!cobro.monto || cobro.monto <= 0) return res.status(409).json({ error: 'Este cobro todavía no tiene un monto definido' });

    // Un intento anterior sin terminar deja de valer: solo el último se puede confirmar
    await pool.query(
      "UPDATE pago_linea SET estado = 'anulado', resuelto_en = NOW() WHERE tipo = ? AND referencia_id = ? AND estado = 'iniciado'",
      [tipo, id]
    );
    const token = crypto.randomBytes(24).toString('hex');
    await pool.query(
      'INSERT INTO pago_linea (token, tipo, referencia_id, usuario_id, monto) VALUES (?, ?, ?, ?, ?)',
      [token, tipo, id, req.usuario.id, cobro.monto]
    );
    return res.status(201).json({ token, url: `pasarela-prueba.html?token=${token}` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error al iniciar el pago' });
  }
});

// Datos que muestra la pasarela
router.get('/:token', verificarToken, async (req, res) => {
  try {
    const [[pago]] = await pool.query('SELECT * FROM pago_linea WHERE token = ?', [req.params.token]);
    if (!pago || pago.usuario_id !== req.usuario.id) return res.status(404).json({ error: 'Pago no encontrado' });
    const cobro = await buscarCobro(pago.tipo, pago.referencia_id);
    return res.json({
      monto: pago.monto,
      estado: pago.estado,
      codigo_autorizacion: pago.codigo_autorizacion,
      descripcion: cobro ? cobro.descripcion : 'Cobro',
      volver: pago.tipo === 'puesto' ? 'mis-solicitudes.html' : 'cobros.html',
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error al obtener el pago' });
  }
});

async function resolver(conexion, pago, estado, codigo = null) {
  await conexion.query(
    'UPDATE pago_linea SET estado = ?, codigo_autorizacion = ?, resuelto_en = NOW() WHERE id = ?',
    [estado, codigo, pago.id]
  );
}

// Resultado de la pasarela simulada: aprobar o rechazar. Todo ocurre en una transacción para que un cobro no se pague dos veces.
router.post('/:token/resultado', verificarToken, async (req, res) => {
  const { resultado } = req.body;
  if (!['aprobar', 'rechazar'].includes(resultado)) {
    return res.status(400).json({ error: 'El resultado debe ser aprobar o rechazar' });
  }
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const [[pago]] = await conexion.query('SELECT * FROM pago_linea WHERE token = ? FOR UPDATE', [req.params.token]);
    if (!pago || pago.usuario_id !== req.usuario.id) {
      await conexion.rollback();
      return res.status(404).json({ error: 'Pago no encontrado' });
    }
    if (pago.estado !== 'iniciado') {
      await conexion.rollback();
      return res.status(409).json({ error: 'Este pago ya fue procesado' });
    }
    const vencido = Date.now() - new Date(pago.creado_en).getTime() > MINUTOS_VIGENCIA * 60 * 1000;
    if (vencido) {
      await resolver(conexion, pago, 'anulado');
      await conexion.commit();
      return res.status(409).json({ error: 'El pago venció. Inícialo de nuevo.' });
    }
    if (resultado === 'rechazar') {
      await resolver(conexion, pago, 'rechazado');
      await conexion.commit();
      return res.json({ estado: 'rechazado' });
    }

    const cobro = await buscarCobro(pago.tipo, pago.referencia_id, conexion, true);
    if (!cobro || !cobro.pagable || cobro.monto !== pago.monto) {
      await resolver(conexion, pago, 'anulado');
      await conexion.commit();
      return res.status(409).json({ error: 'El cobro cambió o ya fue pagado. No se realizó el pago.' });
    }

    const codigo = String(crypto.randomInt(100000, 1000000));
    await resolver(conexion, pago, 'aprobado', codigo);
    let publicada = false;
    if (pago.tipo === 'puesto') {
      await conexion.query(
        "UPDATE solicitud SET estado_pago = 'pagado', pagado_en = NOW() WHERE id = ?", [pago.referencia_id]);
    } else {
      await conexion.query(
        "UPDATE cobro_publicacion SET estado = 'pagado', pagado_en = NOW(), comentario = ? WHERE id = ?",
        [`Pago en línea (prueba), autorización ${codigo}`, pago.referencia_id]);
      ({ publicada } = await recalcularPublicacion(conexion, cobro.feriaId, 'pagado'));
    }
    await conexion.commit();

    const pesos = `$${pago.monto.toLocaleString('es-CL')}`;
    await notificar(pago.usuario_id, pago.tipo === 'puesto'
      ? {
        titulo: 'Recibimos tu pago en línea',
        mensaje: `Pagaste ${pesos} en línea (código ${codigo}). Tu credencial ya aparece al día.`,
        enlace: 'mis-solicitudes.html',
      }
      : {
        titulo: publicada ? `"${cobro.feriaNombre}" ya está publicada` : 'Recibimos tu pago de publicación',
        mensaje: `Pagaste ${pesos} en línea (código ${codigo}) por ${cobro.puestos} puestos de "${cobro.feriaNombre}".`
          + (publicada ? ' Tu feria ya es visible para los comerciantes.' : ''),
        enlace: 'cobros.html',
      });
    return res.json({ estado: 'aprobado', codigo_autorizacion: codigo, feria_publicada: publicada });
  } catch (err) {
    await conexion.rollback();
    console.error(err);
    return res.status(500).json({ error: 'Error al procesar el pago' });
  } finally {
    conexion.release();
  }
});

module.exports = router;
