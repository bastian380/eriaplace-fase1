// Cobros de la plataforma al Administrador de Feria por publicar los puestos de su feria (modelo de negocio de FeriaPlace).
// El Administrador de Feria paga en línea (routes/pagos.js) o transfiere, y en ese caso el administrador de la plataforma lo registra aquí.
const express = require('express');
const pool = require('../db');
const { verificarToken, requireRol } = require('../middleware/auth');
const { notificar } = require('../notificar');
const { ROLES_GESTION, esPlataforma, recalcularPublicacion, tarifaPorPuesto } = require('../permisos');

const router = express.Router();
const PRECIO_MAXIMO = 100000000;

// Lee un monto en pesos escrito a la chilena ("$5.000"); vacío = sin cambio (undefined)
function leerMonto(valor) {
  if (valor === undefined || valor === null || String(valor).trim() === '') return { monto: undefined };
  const monto = Number(String(valor).replace(/[$.\s]/g, ''));
  if (!Number.isInteger(monto) || monto < 0 || monto > PRECIO_MAXIMO) return { error: true };
  return { monto };
}

// Tarifa vigente por puesto publicado (la ven la plataforma y los Administradores de Feria)
router.get('/tarifa', verificarToken, requireRol(...ROLES_GESTION), async (req, res) => {
  res.json({ tarifa_puesto: await tarifaPorPuesto() });
});

// La plataforma cambia la tarifa. Los cobros ya generados conservan la tarifa con que se calcularon.
router.put('/tarifa', verificarToken, requireRol('administrador'), async (req, res) => {
  const { monto, error } = leerMonto(req.body.tarifa_puesto);
  if (error || monto === undefined) {
    return res.status(400).json({ error: 'La tarifa debe ser un número entero de pesos (ej: 5000 o 5.000)' });
  }
  await pool.query(
    "INSERT INTO configuracion (clave, valor) VALUES ('tarifa_puesto', ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)",
    [String(monto)]
  );
  res.json({ tarifa_puesto: monto });
});

// Lista de cobros con su resumen. La plataforma ve todos; el Administrador de Feria, solo los suyos.
router.get('/', verificarToken, requireRol(...ROLES_GESTION), async (req, res) => {
  try {
    const [filas] = await pool.query(
      `SELECT c.id, c.feria_id, f.nombre AS feria_nombre, f.publicada, c.admin_feria_id,
              u.nombre AS admin_feria_nombre, u.email AS admin_feria_email, u.organizacion,
              c.puestos, c.tarifa, c.monto, c.estado, c.comentario, c.creado_en, c.pagado_en
       FROM cobro_publicacion c
       JOIN feria f ON f.id = c.feria_id
       JOIN usuario u ON u.id = c.admin_feria_id
       ${esPlataforma(req) ? '' : 'WHERE c.admin_feria_id = ?'}
       ORDER BY c.estado = 'pendiente' DESC, c.creado_en DESC, c.id DESC`,
      esPlataforma(req) ? [] : [req.usuario.id]
    );
    const cobros = filas.map((c) => ({ ...c, publicada: Boolean(c.publicada) }));
    const sumar = (estado) => cobros.filter((c) => c.estado === estado).reduce((t, c) => t + c.monto, 0);
    res.json({
      tarifa_puesto: await tarifaPorPuesto(),
      resumen: {
        cobrado: sumar('pagado'),
        por_cobrar: sumar('pendiente'),
        cobros_pendientes: cobros.filter((c) => c.estado === 'pendiente').length,
        administradores: new Set(cobros.map((c) => c.admin_feria_id)).size,
      },
      cobros,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener los cobros' });
  }
});

// La plataforma registra el pago de un cobro (o lo vuelve a pendiente) y puede corregir el monto.
// Al quedar pagados todos los puestos de la feria, la feria se publica sola; si un pago se anula, vuelve a borrador.
router.put('/:id/pago', verificarToken, requireRol('administrador'), async (req, res) => {
  const { estado } = req.body;
  if (!['pendiente', 'pagado'].includes(estado)) {
    return res.status(400).json({ error: 'El estado del cobro debe ser pendiente o pagado' });
  }
  const { monto, error } = leerMonto(req.body.monto);
  if (error) return res.status(400).json({ error: 'El monto debe ser un número entero de pesos (ej: 5000 o 5.000)' });
  const comentario = req.body.comentario === undefined ? undefined : String(req.body.comentario || '').trim().slice(0, 300) || null;

  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const [[cobro]] = await conexion.query('SELECT * FROM cobro_publicacion WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!cobro) {
      await conexion.rollback();
      return res.status(404).json({ error: 'Cobro no encontrado' });
    }
    await conexion.query(
      `UPDATE cobro_publicacion
       SET estado = ?, pagado_en = CASE WHEN ? = 'pagado' THEN COALESCE(pagado_en, NOW()) ELSE NULL END,
           monto = COALESCE(?, monto), comentario = ${comentario === undefined ? 'comentario' : '?'}
       WHERE id = ?`,
      comentario === undefined
        ? [estado, estado, monto ?? null, cobro.id]
        : [estado, estado, monto ?? null, comentario, cobro.id]
    );
    // Si la plataforma revierte un pago hecho en línea, ese comprobante deja de valer
    if (estado === 'pendiente') {
      await conexion.query(
        "UPDATE pago_linea SET estado = 'anulado', resuelto_en = NOW() WHERE tipo = 'publicacion' AND referencia_id = ? AND estado = 'aprobado'",
        [cobro.id]
      );
    }
    const { feria, publicada } = await recalcularPublicacion(conexion, cobro.feria_id, estado);
    await conexion.commit();

    const [[fila]] = await pool.query('SELECT id, monto, estado, pagado_en, comentario FROM cobro_publicacion WHERE id = ?', [cobro.id]);
    if (estado === 'pagado' && cobro.estado !== 'pagado') {
      await notificar(cobro.admin_feria_id, {
        titulo: publicada ? `"${feria.nombre}" ya está publicada` : 'Recibimos tu pago de publicación',
        mensaje: `Registramos tu pago de $${fila.monto.toLocaleString('es-CL')} por ${cobro.puestos} puestos de "${feria.nombre}".`
          + (publicada ? ' Tu feria ya es visible para los comerciantes.' : ''),
        enlace: 'cobros.html',
      });
    }
    res.json({ ...fila, feria_id: feria.id, feria_publicada: publicada });
  } catch (err) {
    await conexion.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al registrar el pago del cobro' });
  } finally {
    conexion.release();
  }
});

module.exports = router;
