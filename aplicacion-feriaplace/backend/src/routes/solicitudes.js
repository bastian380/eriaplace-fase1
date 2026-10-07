const express = require('express');
const pool = require('../db');
const { verificarToken, requireRol } = require('../middleware/auth');

const router = express.Router();

const TAMANOS = ['pequeno', 'mediano', 'grande'];
const PRECIO_MAXIMO = 100000000;

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
    const [ferias] = await pool.query('SELECT id FROM feria WHERE id = ? AND publicada = 1', [feria_id]);
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

// El administrador ve todas las solicitudes (opcionalmente filtradas por estado)
router.get('/', verificarToken, requireRol('administrador'), async (req, res) => {
  const { estado } = req.query;
  let sql = `SELECT s.id, s.usuario_id, u.nombre AS comerciante_nombre, u.email AS comerciante_email,
                    s.zona_preferida, s.tamano_preferido, s.rubro, s.comentario, s.estado,
                    s.comentario_admin, s.creado_en, s.resuelto_en, s.monto, s.estado_pago, s.pagado_en,
                    p.codigo AS puesto_codigo, s.feria_id, f.nombre AS feria_nombre,
                    s.puesto_preferido_id, pp.codigo AS puesto_preferido_codigo
             FROM solicitud s
             JOIN usuario u ON u.id = s.usuario_id
             LEFT JOIN puesto p ON p.id = s.puesto_id
             LEFT JOIN puesto pp ON pp.id = s.puesto_preferido_id
             LEFT JOIN feria f ON f.id = s.feria_id`;
  const params = [];
  if (estado) {
    sql += ' WHERE s.estado = ?';
    params.push(estado);
  }
  sql += ' ORDER BY s.creado_en ASC';
  const [filas] = await pool.query(sql, params);
  res.json(filas);
});

// El administrador asigna un puesto concreto a una solicitud pendiente
router.put('/:id/asignar', verificarToken, requireRol('administrador'), async (req, res) => {
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
    res.json({ id: Number(id), estado: 'confirmada', puesto_id: Number(puesto_id), monto, estado_pago: 'pendiente' });
  } catch (err) {
    await conexion.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al asignar el puesto' });
  } finally {
    conexion.release();
  }
});

// El administrador rechaza una solicitud pendiente
router.put('/:id/rechazar', verificarToken, requireRol('administrador'), async (req, res) => {
  const { id } = req.params;
  const { comentario_admin } = req.body;
  const [resultado] = await pool.query(
    `UPDATE solicitud SET estado = 'rechazada', comentario_admin = ?, resuelto_en = NOW()
     WHERE id = ? AND estado = 'pendiente'`,
    [comentario_admin || null, id]
  );
  if (resultado.affectedRows === 0) {
    return res.status(409).json({ error: 'La solicitud no existe o ya fue resuelta' });
  }
  res.json({ id: Number(id), estado: 'rechazada' });
});

// El administrador registra el pago de un puesto asignado: lo marca como pagado o pendiente y puede corregir el monto.
// No hay pasarela de pago: el comerciante paga por fuera (efectivo, transferencia) y el administrador lo anota aquí.
router.put('/:id/pago', verificarToken, requireRol('administrador'), async (req, res) => {
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
  const [[fila]] = await pool.query('SELECT monto, estado_pago, pagado_en FROM solicitud WHERE id = ?', [id]);
  res.json({ id: Number(id), ...fila });
});

module.exports = router;
