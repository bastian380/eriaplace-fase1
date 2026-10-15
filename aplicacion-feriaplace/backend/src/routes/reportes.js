const express = require('express');
const pool = require('../db');
const { verificarToken, requireRol } = require('../middleware/auth');

const router = express.Router();

// Reporte de ocupación por feria: puestos totales, ocupados y libres, solicitudes y lo cobrado.
// Los puestos y las solicitudes se cuentan en consultas separadas para que el JOIN no duplique filas.
async function calcularOcupacion() {
  const [ferias] = await pool.query(
    `SELECT f.id, f.nombre, f.comuna, f.publicada,
            DATE_FORMAT(f.fecha_inicio, '%Y-%m-%d') AS fecha_inicio,
            DATE_FORMAT(f.fecha_cierre, '%Y-%m-%d') AS fecha_cierre,
            COUNT(p.id) AS puestos_total,
            COALESCE(SUM(p.estado = 'ocupado'), 0) AS puestos_ocupados,
            COALESCE(SUM(p.estado = 'disponible'), 0) AS puestos_libres
     FROM feria f
     LEFT JOIN puesto p ON p.feria_id = f.id
     GROUP BY f.id
     ORDER BY f.fecha_inicio IS NULL, f.fecha_inicio, f.nombre`
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

router.get('/ocupacion', verificarToken, requireRol('administrador'), async (req, res) => {
  try {
    res.json(await calcularOcupacion());
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
  ['cobrado', 'Cobrado'], ['por_cobrar', 'Por cobrar'],
];

function celdaCsv(valor) {
  if (valor === null || valor === undefined) return '';
  const texto = typeof valor === 'number' ? String(valor).replace('.', ',') : String(valor);
  return /[;"\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

router.get('/ocupacion.csv', verificarToken, requireRol('administrador'), async (req, res) => {
  try {
    const filas = await calcularOcupacion();
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

module.exports = router;
