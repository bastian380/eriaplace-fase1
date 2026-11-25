const express = require('express');
const pool = require('../db');
const { verificarToken, requireRol } = require('../middleware/auth');
const { notificar } = require('../notificar');
const { ROLES_GESTION, filtroFerias, puedeGestionar } = require('../permisos');
const { ofrecerPuestosLibres } = require('../listaEspera');

const router = express.Router();

const TAMANOS = ['pequeno', 'mediano', 'grande'];
const PRECIO_MAXIMO = 100000000;
// Código de autorización si el puesto se pagó en línea
const SQL_AUTORIZACION = `(SELECT pl.codigo_autorizacion FROM pago_linea pl
  WHERE pl.tipo = 'puesto' AND pl.referencia_id = s.id AND pl.estado = 'aprobado' ORDER BY pl.id DESC LIMIT 1) AS pago_autorizacion`;

// El comerciante envía una solicitud para una feria (puede indicar un puesto preferido, pero no lo reserva)
router.post('/', verificarToken, requireRol('comerciante'), async (req, res) => {
  const { feria_id, puesto_preferido_id, zona_preferida, tamano_preferido, rubro, comentario } = req.body;
  if (!rubro) {
    return res.status(400).json({ error: 'El rubro es obligatorio' });
  }
  if (!feria_id) {
    return res.status(400).json({ error: 'Debes elegir una feria' });
  }
  if (tamano_preferido && !TAMANOS.includes(tamano_preferido)) {
    return res.status(400).json({ error: 'Tamaño preferido inválido' });
  }
  try {
    const [ferias] = await pool.query('SELECT id, nombre, admin_feria_id FROM feria WHERE id = ? AND publicada = 1', [feria_id]);
    if (ferias.length === 0) {
      return res.status(400).json({ error: 'La feria elegida no existe o no está disponible' });
    }
    if (puesto_preferido_id) {
      const [puestos] = await pool.query(
        "SELECT id FROM puesto WHERE id = ? AND feria_id = ? AND estado = 'disponible'",
        [puesto_preferido_id, feria_id]
      );
      if (puestos.length === 0) {
        return res.status(409).json({ error: 'El puesto preferido ya no está disponible' });
      }
    }
    const [resultado] = await pool.query(
      `INSERT INTO solicitud (usuario_id, feria_id, puesto_preferido_id, zona_preferida, tamano_preferido, rubro, comentario)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.usuario.id, feria_id, puesto_preferido_id || null, zona_preferida || null,
        tamano_preferido || null, rubro, comentario || null]
    );
    // El Administrador de Feria recibe un aviso de cada solicitud nueva en su feria
    if (ferias[0].admin_feria_id) {
      await notificar(ferias[0].admin_feria_id, {
        titulo: `Nueva solicitud en "${ferias[0].nombre}"`,
        mensaje: `${req.usuario.nombre} pidió un puesto (${rubro}). Revísala en Solicitudes para asignarle un puesto o rechazarla.`,
        enlace: 'admin.html',
      });
    }
    res.status(201).json({ id: resultado.insertId, estado: 'pendiente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al enviar la solicitud' });
  }
});

// El comerciante ve sus propias solicitudes y su estado
router.get('/mias', verificarToken, requireRol('comerciante'), async (req, res) => {
  const [filas] = await pool.query(
    `SELECT s.id, s.zona_preferida, s.tamano_preferido, s.rubro, s.comentario, s.estado,
            s.comentario_admin, s.creado_en, s.resuelto_en, s.monto, s.estado_pago, s.pagado_en,
            ${SQL_AUTORIZACION},
            p.codigo AS puesto_codigo, p.zona AS puesto_zona,
            f.nombre AS feria_nombre, pp.codigo AS puesto_preferido_codigo
     FROM solicitud s
     LEFT JOIN puesto p ON p.id = s.puesto_id
     LEFT JOIN puesto pp ON pp.id = s.puesto_preferido_id
     LEFT JOIN feria f ON f.id = s.feria_id
     WHERE s.usuario_id = ?
     ORDER BY s.creado_en DESC`,
    [req.usuario.id]
  );
  res.json(filas);
});

// La plataforma ve todas las solicitudes; el Administrador de Feria, solo las de sus ferias (opcionalmente por estado)
router.get('/', verificarToken, requireRol(...ROLES_GESTION), async (req, res) => {
  const { estado } = req.query;
  const filtro = filtroFerias(req);
  let sql = `SELECT s.id, s.usuario_id, u.nombre AS comerciante_nombre, u.email AS comerciante_email,
                    s.zona_preferida, s.tamano_preferido, s.rubro, s.comentario, s.estado,
                    s.comentario_admin, s.creado_en, s.resuelto_en, s.monto, s.estado_pago, s.pagado_en,
                    ${SQL_AUTORIZACION},
                    p.codigo AS puesto_codigo, s.feria_id, f.nombre AS feria_nombre,
                    s.puesto_preferido_id, pp.codigo AS puesto_preferido_codigo
             FROM solicitud s
             JOIN usuario u ON u.id = s.usuario_id
             LEFT JOIN puesto p ON p.id = s.puesto_id
             LEFT JOIN puesto pp ON pp.id = s.puesto_preferido_id
             LEFT JOIN feria f ON f.id = s.feria_id`;
  sql += ` WHERE ${filtro.sql}`;
  const params = [...filtro.params];
  if (estado) {
    sql += ' AND s.estado = ?';
    params.push(estado);
  }
  sql += ' ORDER BY s.creado_en ASC';
  const [filas] = await pool.query(sql, params);
  res.json(filas);
});

// Busca la feria de una solicitud y revisa que quien llama la gestione. Devuelve un error para responder o null.
async function sinPermisoSobre(req, feriaId, conexion = pool) {
  const [[feria]] = await conexion.query('SELECT id, admin_feria_id FROM feria WHERE id = ?', [feriaId]);
  if (feria && !puedeGestionar(req, feria)) return { status: 403, error: 'Esta solicitud es de una feria que administra otra persona' };
  return null;
}

// Quien gestiona la feria asigna un puesto concreto a una solicitud pendiente
router.put('/:id/asignar', verificarToken, requireRol(...ROLES_GESTION), async (req, res) => {
  const { id } = req.params;
  const { puesto_id } = req.body;
  if (!puesto_id) {
    return res.status(400).json({ error: 'Debes indicar el puesto a asignar' });
  }

  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();

    const [solicitudes] = await conexion.query(
      'SELECT * FROM solicitud WHERE id = ? FOR UPDATE',
      [id]
    );
    if (solicitudes.length === 0) {
      await conexion.rollback();
      return res.status(404).json({ error: 'Solicitud no encontrada' });
    }
    const negado = await sinPermisoSobre(req, solicitudes[0].feria_id, conexion);
    if (negado) {
      await conexion.rollback();
      return res.status(negado.status).json({ error: negado.error });
    }
    if (solicitudes[0].estado !== 'pendiente') {
      await conexion.rollback();
      return res.status(409).json({ error: 'La solicitud ya fue resuelta' });
    }

    const [puestos] = await conexion.query(
      "SELECT * FROM puesto WHERE id = ? AND estado = 'disponible' FOR UPDATE",
      [puesto_id]
    );
    if (puestos.length === 0) {
      await conexion.rollback();
      return res.status(409).json({ error: 'Ese puesto ya no está disponible' });
    }
    if (solicitudes[0].feria_id && puestos[0].feria_id !== solicitudes[0].feria_id) {
      await conexion.rollback();
      return res.status(409).json({ error: 'Ese puesto es de otra feria' });
    }

    // El monto a cobrar es el precio propio del puesto o, si no tiene, el precio base de su feria
    const [[feria]] = await conexion.query('SELECT precio_puesto FROM feria WHERE id = ?', [puestos[0].feria_id]);
    const monto = puestos[0].precio ?? feria.precio_puesto ?? null;

    await conexion.query("UPDATE puesto SET estado = 'ocupado' WHERE id = ?", [puesto_id]);
    await conexion.query(
      `UPDATE solicitud SET estado = 'confirmada', puesto_id = ?, monto = ?, estado_pago = 'pendiente', resuelto_en = NOW()
       WHERE id = ?`,
      [puesto_id, monto, id]
    );

    await conexion.commit();
    const [[f]] = await pool.query('SELECT nombre FROM feria WHERE id = ?', [puestos[0].feria_id]);
    await notificar(solicitudes[0].usuario_id, {
      titulo: `Te asignamos el puesto ${puestos[0].codigo}`,
      mensaje: `Tu solicitud para "${f.nombre}" fue aprobada: tienes el puesto ${puestos[0].codigo} (${puestos[0].zona}).`
        + `${monto !== null ? ` El arriendo es de $${monto.toLocaleString('es-CL')} por la temporada.` : ''}`
        + ' En "Mis solicitudes" puedes ver tu credencial con código QR.',
      enlace: 'mis-solicitudes.html',
    });
    res.json({ id: Number(id), estado: 'confirmada', puesto_id: Number(puesto_id), monto, estado_pago: 'pendiente' });
  } catch (err) {
    await conexion.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al asignar el puesto' });
  } finally {
    conexion.release();
  }
});

// Quien gestiona la feria rechaza una solicitud pendiente
router.put('/:id/rechazar', verificarToken, requireRol(...ROLES_GESTION), async (req, res) => {
  const { id } = req.params;
  const { comentario_admin } = req.body;
  const [[solicitud]] = await pool.query(
    'SELECT s.usuario_id, s.feria_id, f.nombre AS feria FROM solicitud s LEFT JOIN feria f ON f.id = s.feria_id WHERE s.id = ?', [id]);
  if (!solicitud) return res.status(409).json({ error: 'La solicitud no existe o ya fue resuelta' });
  const negado = await sinPermisoSobre(req, solicitud.feria_id);
  if (negado) return res.status(negado.status).json({ error: negado.error });
  const [resultado] = await pool.query(
    `UPDATE solicitud SET estado = 'rechazada', comentario_admin = ?, resuelto_en = NOW()
     WHERE id = ? AND estado = 'pendiente'`,
    [comentario_admin || null, id]
  );
  if (resultado.affectedRows === 0) {
    return res.status(409).json({ error: 'La solicitud no existe o ya fue resuelta' });
  }
  await notificar(solicitud.usuario_id, {
    titulo: 'Tu solicitud de puesto fue rechazada',
    mensaje: `El administrador rechazó tu solicitud para "${solicitud.feria || 'la feria'}".`
      + `${comentario_admin ? ` Motivo: ${comentario_admin}` : ''}`,
    enlace: 'mis-solicitudes.html',
  });
  res.json({ id: Number(id), estado: 'rechazada' });
});

// Quien gestiona la feria quita un puesto asignado que no está pagado. El puesto se libera y pasa a la lista de espera, si hay.
router.put('/:id/liberar', verificarToken, requireRol(...ROLES_GESTION), async (req, res) => {
  const motivo = String(req.body.comentario_admin || '').trim().slice(0, 500) || 'Se liberó el puesto asignado.';
  const conexion = await pool.getConnection();
  let solicitud;
  let codigo;
  try {
    await conexion.beginTransaction();
    [[solicitud]] = await conexion.query('SELECT * FROM solicitud WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!solicitud) {
      await conexion.rollback();
      return res.status(404).json({ error: 'Solicitud no encontrada' });
    }
    const negado = await sinPermisoSobre(req, solicitud.feria_id, conexion);
    if (negado) {
      await conexion.rollback();
      return res.status(negado.status).json({ error: negado.error });
    }
    if (solicitud.estado !== 'confirmada' || !solicitud.puesto_id) {
      await conexion.rollback();
      return res.status(409).json({ error: 'Esta solicitud no tiene un puesto asignado' });
    }
    if (solicitud.estado_pago === 'pagado') {
      await conexion.rollback();
      return res.status(409).json({ error: 'Este puesto ya está pagado. Márcalo como pendiente antes de liberarlo.' });
    }
    [[{ codigo }]] = await conexion.query('SELECT codigo FROM puesto WHERE id = ? FOR UPDATE', [solicitud.puesto_id]);
    await conexion.query("UPDATE puesto SET estado = 'disponible' WHERE id = ?", [solicitud.puesto_id]);
    await conexion.query(
      `UPDATE solicitud SET estado = 'rechazada', comentario_admin = ?, puesto_id = NULL, monto = NULL, estado_pago = NULL, resuelto_en = NOW()
       WHERE id = ?`,
      [motivo, solicitud.id]
    );
    await conexion.commit();
  } catch (err) {
    await conexion.rollback();
    console.error(err);
    return res.status(500).json({ error: 'Error al liberar el puesto' });
  } finally {
    conexion.release();
  }
  await notificar(solicitud.usuario_id, {
    titulo: `Se liberó tu puesto ${codigo}`,
    mensaje: `El administrador liberó el puesto ${codigo} que tenías asignado. Motivo: ${motivo}`,
    enlace: 'mis-solicitudes.html',
  });
  const ofrecidos = await ofrecerPuestosLibres(solicitud.feria_id).catch((err) => {
    console.error('No se pudo ofrecer el puesto a la lista de espera:', err.message);
    return 0;
  });
  return res.json({ id: solicitud.id, estado: 'rechazada', ofrecido_a_lista: ofrecidos > 0 });
});

// Quien gestiona la feria registra el pago de un puesto asignado: lo marca como pagado o pendiente y puede corregir el monto.
// Es para lo que se paga por fuera (efectivo, transferencia); el pago en línea queda registrado solo (routes/pagos.js).
router.put('/:id/pago', verificarToken, requireRol(...ROLES_GESTION), async (req, res) => {
  const { id } = req.params;
  const { estado_pago } = req.body;
  if (!['pendiente', 'pagado'].includes(estado_pago)) {
    return res.status(400).json({ error: 'El estado del pago debe ser pendiente o pagado' });
  }
  const sinMonto = req.body.monto === undefined;
  // Se aceptan montos escritos a la chilena, con signo peso y puntos de miles: "$150.000"
  const textoMonto = sinMonto ? '' : String(req.body.monto ?? '').replace(/[$.\s]/g, '');
  const monto = textoMonto === '' ? null : Number(textoMonto);
  if (monto !== null && (!Number.isInteger(monto) || monto < 0 || monto > PRECIO_MAXIMO)) {
    return res.status(400).json({ error: 'El monto debe ser un número entero de pesos (ej: 150000 o 150.000)' });
  }
  const [[antes]] = await pool.query('SELECT usuario_id, feria_id, estado_pago FROM solicitud WHERE id = ?', [id]);
  if (!antes) return res.status(409).json({ error: 'Solo se registra el pago de solicitudes con puesto asignado' });
  const negado = await sinPermisoSobre(req, antes.feria_id);
  if (negado) return res.status(negado.status).json({ error: negado.error });
  const [resultado] = await pool.query(
    `UPDATE solicitud
     SET estado_pago = ?,
         pagado_en = CASE WHEN ? = 'pagado' THEN COALESCE(pagado_en, NOW()) ELSE NULL END,
         monto = ${sinMonto ? 'monto' : '?'}
     WHERE id = ? AND estado = 'confirmada'`,
    sinMonto ? [estado_pago, estado_pago, id] : [estado_pago, estado_pago, monto, id]
  );
  if (resultado.affectedRows === 0) {
    return res.status(409).json({ error: 'Solo se registra el pago de solicitudes con puesto asignado' });
  }
  // Si un pago hecho en línea se revierte a pendiente, ese comprobante deja de valer
  if (estado_pago === 'pendiente') {
    await pool.query(
      "UPDATE pago_linea SET estado = 'anulado', resuelto_en = NOW() WHERE tipo = 'puesto' AND referencia_id = ? AND estado = 'aprobado'",
      [id]
    );
  }
  const [[fila]] = await pool.query(`SELECT s.monto, s.estado_pago, s.pagado_en, ${SQL_AUTORIZACION} FROM solicitud s WHERE s.id = ?`, [id]);
  // Solo se avisa cuando el pago pasa de pendiente a pagado (no al corregir el monto)
  if (estado_pago === 'pagado' && antes.estado_pago !== 'pagado') {
    await notificar(antes.usuario_id, {
      titulo: 'Recibimos tu pago',
      mensaje: `Registramos el pago de tu puesto${fila.monto !== null ? ` por $${fila.monto.toLocaleString('es-CL')}` : ''}. Tu credencial ya aparece al día.`,
      enlace: 'mis-solicitudes.html',
    });
  }
  res.json({ id: Number(id), ...fila });
});

module.exports = router;
