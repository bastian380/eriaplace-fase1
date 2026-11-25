// Recordatorios de pago: avisa a quien tiene un puesto asignado sin pagar, cuando su feria empieza dentro de una semana
// (o ya empezó y no ha terminado). Cada solicitud recibe como máximo un recordatorio cada 3 días.
const pool = require('./db');
const { notificar } = require('./notificar');

const DIAS_ANTES = 7;
const DIAS_ENTRE_RECORDATORIOS = 3;
const SIN_RECIENTE = `(ultimo_recordatorio IS NULL OR ultimo_recordatorio < NOW() - INTERVAL ${DIAS_ENTRE_RECORDATORIOS} DAY)`;

// El proceso automático solo mira ferias con fecha. Con incluirSinFecha (botón del panel) también las que no tienen fechas.
async function recordarPagos({ adminFeriaId, incluirSinFecha = false } = {}) {
  const condiciones = [
    "s.estado = 'confirmada'", "s.estado_pago = 'pendiente'", 's.monto > 0',
    '(f.fecha_cierre IS NULL OR f.fecha_cierre >= CURDATE())',
    `(f.fecha_inicio <= CURDATE() + INTERVAL ${DIAS_ANTES} DAY${incluirSinFecha ? ' OR f.fecha_inicio IS NULL' : ''})`,
    SIN_RECIENTE.replaceAll('ultimo_recordatorio', 's.ultimo_recordatorio'),
  ];
  const params = [];
  if (adminFeriaId) {
    condiciones.push('f.admin_feria_id = ?');
    params.push(adminFeriaId);
  }
  const [filas] = await pool.query(
    `SELECT s.id, s.usuario_id, s.monto, f.nombre AS feria, p.codigo AS puesto,
            DATE_FORMAT(f.fecha_inicio, '%d-%m-%Y') AS inicio
     FROM solicitud s JOIN feria f ON f.id = s.feria_id JOIN puesto p ON p.id = s.puesto_id
     WHERE ${condiciones.join(' AND ')}`,
    params
  );
  let enviados = 0;
  for (const s of filas) {
    // Se marca antes de avisar y solo avisa quien logra marcar: así dos procesos a la vez no duplican el recordatorio
    const [marca] = await pool.query(`UPDATE solicitud SET ultimo_recordatorio = NOW() WHERE id = ? AND ${SIN_RECIENTE}`, [s.id]);
    if (marca.affectedRows === 0) continue;
    await notificar(s.usuario_id, {
      titulo: `Recuerda pagar tu puesto ${s.puesto}`,
      mensaje: `Tienes pendiente el pago de $${s.monto.toLocaleString('es-CL')} por el puesto ${s.puesto} de "${s.feria}"`
        + `${s.inicio ? `, que empieza el ${s.inicio}` : ''}. Puedes pagar en línea desde "Mis solicitudes".`,
      enlace: 'mis-solicitudes.html',
    });
    enviados += 1;
  }
  return enviados;
}

module.exports = { recordarPagos };
