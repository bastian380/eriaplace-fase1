const express = require('express');
const pool = require('../db');
const { verificarToken, requireRol } = require('../middleware/auth');
const { ROLES_GESTION, filtroFerias } = require('../permisos');
const { generarExcel, generarPdf } = require('../exportar');

const router = express.Router();

// Reporte de ocupación por feria: puestos totales, ocupados y libres, solicitudes y lo cobrado.
// Los puestos y las solicitudes se cuentan en consultas separadas para que el JOIN no duplique filas.
// El Administrador de Feria solo ve sus ferias; la plataforma ve todas.
async function calcularOcupacion(req) {
  const filtro = filtroFerias(req);
  const [ferias] = await pool.query(
    `SELECT f.id, f.nombre, f.comuna, f.publicada,
            (SELECT u.nombre FROM usuario u WHERE u.id = f.admin_feria_id) AS admin_feria_nombre,
            DATE_FORMAT(f.fecha_inicio, '%Y-%m-%d') AS fecha_inicio,
            DATE_FORMAT(f.fecha_cierre, '%Y-%m-%d') AS fecha_cierre,
            COUNT(p.id) AS puestos_total,
            COALESCE(SUM(p.estado = 'ocupado'), 0) AS puestos_ocupados,
            COALESCE(SUM(p.estado = 'disponible'), 0) AS puestos_libres
     FROM feria f
     LEFT JOIN puesto p ON p.feria_id = f.id
     WHERE ${filtro.sql}
     GROUP BY f.id
     ORDER BY f.fecha_inicio IS NULL, f.fecha_inicio, f.nombre`,
    filtro.params
  );
  const [solicitudes] = await pool.query(
    `SELECT feria_id,
            SUM(estado = 'pendiente') AS solicitudes_pendientes,
            SUM(estado = 'confirmada') AS solicitudes_confirmadas,
            SUM(estado = 'rechazada') AS solicitudes_rechazadas,
            COALESCE(SUM(CASE WHEN estado = 'confirmada' AND estado_pago = 'pagado' THEN monto END), 0) AS cobrado,
            COALESCE(SUM(CASE WHEN estado = 'confirmada' AND (estado_pago IS NULL OR estado_pago <> 'pagado') THEN monto END), 0) AS por_cobrar
     FROM solicitud
     WHERE feria_id IS NOT NULL
     GROUP BY feria_id`
  );
  const porFeria = new Map(solicitudes.map((s) => [s.feria_id, s]));
  return ferias.map((f) => {
    const s = porFeria.get(f.id) || {};
    const total = Number(f.puestos_total);
    const ocupados = Number(f.puestos_ocupados);
    return {
      id: f.id,
      nombre: f.nombre,
      admin_feria_nombre: f.admin_feria_nombre,
      comuna: f.comuna,
      fecha_inicio: f.fecha_inicio,
      fecha_cierre: f.fecha_cierre,
      publicada: Boolean(f.publicada),
      puestos_total: total,
      puestos_ocupados: ocupados,
      puestos_libres: Number(f.puestos_libres),
      porcentaje_ocupacion: total === 0 ? 0 : Math.round((ocupados / total) * 1000) / 10,
      solicitudes_pendientes: Number(s.solicitudes_pendientes || 0),
      solicitudes_confirmadas: Number(s.solicitudes_confirmadas || 0),
      solicitudes_rechazadas: Number(s.solicitudes_rechazadas || 0),
      cobrado: Number(s.cobrado || 0),
      por_cobrar: Number(s.por_cobrar || 0),
    };
  });
}

router.get('/ocupacion', verificarToken, requireRol(...ROLES_GESTION), async (req, res) => {
  try {
    res.json(await calcularOcupacion(req));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar el reporte de ocupación' });
  }
});

// Mismo reporte en CSV (separado por punto y coma, que es lo que Excel en español abre en columnas)
const COLUMNAS = [
  ['nombre', 'Feria'], ['comuna', 'Comuna'], ['fecha_inicio', 'Inicio'], ['fecha_cierre', 'Cierre'],
  ['puestos_total', 'Puestos totales'], ['puestos_ocupados', 'Ocupados'], ['puestos_libres', 'Libres'],
  ['porcentaje_ocupacion', '% ocupación'], ['solicitudes_pendientes', 'Solicitudes pendientes'],
  ['solicitudes_confirmadas', 'Solicitudes confirmadas'], ['solicitudes_rechazadas', 'Solicitudes rechazadas'],
  ['cobrado', 'Cobrado'], ['por_cobrar', 'Por cobrar'], ['admin_feria_nombre', 'Administrador de Feria'],
];

function celdaCsv(valor) {
  if (valor === null || valor === undefined) return '';
  const texto = typeof valor === 'number' ? String(valor).replace('.', ',') : String(valor);
  return /[;"\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

router.get('/ocupacion.csv', verificarToken, requireRol(...ROLES_GESTION), async (req, res) => {
  try {
    const filas = await calcularOcupacion(req);
    const lineas = [COLUMNAS.map(([, titulo]) => titulo).join(';')]
      .concat(filas.map((f) => COLUMNAS.map(([clave]) => celdaCsv(f[clave])).join(';')));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="reporte-ocupacion.csv"');
    res.send('﻿' + lineas.join('\r\n'));  // BOM para que Excel lea bien las tildes
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar el reporte de ocupación' });
  }
});

// Datos del reporte completo. Cada persona ve solo sus ferias (la plataforma, todas).
async function datosReporte(req) {
  const filtro = filtroFerias(req);
  const [pagos] = await pool.query(
    `SELECT f.nombre AS feria, p.codigo AS puesto, u.nombre AS comerciante, s.rubro, s.monto, s.estado_pago,
            DATE_FORMAT(s.pagado_en, '%Y-%m-%d') AS pagado_en,
            CASE WHEN s.estado_pago <> 'pagado' THEN ''
                 WHEN EXISTS (SELECT 1 FROM pago_linea pl WHERE pl.tipo = 'puesto' AND pl.referencia_id = s.id AND pl.estado = 'aprobado') THEN 'En línea'
                 ELSE 'Manual' END AS forma
     FROM solicitud s
     JOIN feria f ON f.id = s.feria_id
     JOIN usuario u ON u.id = s.usuario_id
     LEFT JOIN puesto p ON p.id = s.puesto_id
     WHERE s.estado = 'confirmada' AND ${filtro.sql}
     ORDER BY f.nombre, p.codigo`,
    filtro.params
  );
  const [asistencia] = await pool.query(
    `SELECT DATE_FORMAT(a.fecha, '%Y-%m-%d') AS fecha, f.nombre AS feria, p.codigo AS puesto, u.nombre AS comerciante,
            DATE_FORMAT(a.creado_en, '%H:%i') AS hora, IF(a.metodo = 'qr', 'QR', 'A mano') AS metodo
     FROM asistencia a
     JOIN solicitud s ON s.id = a.solicitud_id
     JOIN feria f ON f.id = s.feria_id
     JOIN usuario u ON u.id = s.usuario_id
     LEFT JOIN puesto p ON p.id = s.puesto_id
     WHERE ${filtro.sql}
     ORDER BY a.fecha DESC, f.nombre, p.codigo`,
    filtro.params
  );
  return { ocupacion: await calcularOcupacion(req), pagos, asistencia };
}

function enviarArchivo(res, buffer, tipo, nombre) {
  res.setHeader('Content-Type', tipo);
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.send(buffer);
}

router.get('/completo.xlsx', verificarToken, requireRol(...ROLES_GESTION), async (req, res) => {
  try {
    enviarArchivo(res, await generarExcel(await datosReporte(req)),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'reporte-feriaplace.xlsx');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar el Excel' });
  }
});

router.get('/completo.pdf', verificarToken, requireRol(...ROLES_GESTION), async (req, res) => {
  try {
    enviarArchivo(res, await generarPdf(await datosReporte(req), req.usuario.nombre), 'application/pdf', 'reporte-feriaplace.pdf');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar el PDF' });
  }
});

module.exports = router;
