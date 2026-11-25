// Buscador público: "¿dónde venden verduras este sábado?". No pide sesión y no muestra quién atiende cada puesto.
const express = require('express');
const pool = require('../db');
const { hoyEnChile } = require('../credencial');

const router = express.Router();

router.get('/', async (req, res) => {
  const texto = String(req.query.q || '').trim().slice(0, 60);
  const fecha = String(req.query.fecha || '').trim();
  if (texto.length < 2) return res.status(400).json({ error: 'Escribe al menos 2 letras para buscar' });
  if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'La fecha no es válida' });

  // Sin la "s" final, para que "verduras" también encuentre "verdura"
  const raiz = texto.length > 3 ? texto.replace(/s$/i, '') : texto;
  const patron = `%${raiz.replace(/[\\%_]/g, '\\$&')}%`;
  // Con fecha, solo ferias abiertas ese día; sin fecha, las que no han terminado
  const filtroFecha = fecha
    ? 'AND f.fecha_inicio <= ? AND f.fecha_cierre >= ?'
    : 'AND (f.fecha_cierre IS NULL OR f.fecha_cierre >= ?)';
  const params = fecha ? [patron, fecha, fecha] : [patron, hoyEnChile()];
  try {
    const [filas] = await pool.query(
      `SELECT f.id AS feria_id, f.nombre, f.lugar, f.comuna,
              DATE_FORMAT(f.fecha_inicio, '%Y-%m-%d') AS fecha_inicio,
              DATE_FORMAT(f.fecha_cierre, '%Y-%m-%d') AS fecha_cierre,
              p.id AS puesto_id, p.codigo, p.zona, s.rubro,
              (SELECT AVG(r.estrellas) FROM resena r WHERE r.solicitud_id = s.id AND r.oculta = 0) AS promedio,
              (SELECT COUNT(*) FROM resena r WHERE r.solicitud_id = s.id AND r.oculta = 0) AS total_resenas
       FROM solicitud s
       JOIN puesto p ON p.id = s.puesto_id
       JOIN feria f ON f.id = s.feria_id
       WHERE s.estado = 'confirmada' AND f.publicada = 1 AND s.rubro LIKE ? ${filtroFecha}
       ORDER BY f.fecha_inicio IS NULL, f.fecha_inicio, f.nombre, p.codigo
       LIMIT 200`,
      params
    );
    const porFeria = new Map();
    for (const f of filas) {
      if (!porFeria.has(f.feria_id)) {
        porFeria.set(f.feria_id, {
          id: f.feria_id, nombre: f.nombre, lugar: f.lugar, comuna: f.comuna,
          fecha_inicio: f.fecha_inicio, fecha_cierre: f.fecha_cierre, puestos: [],
        });
      }
      porFeria.get(f.feria_id).puestos.push({
        id: f.puesto_id, codigo: f.codigo, zona: f.zona, rubro: f.rubro,
        promedio: f.promedio === null ? null : Math.round(Number(f.promedio) * 10) / 10,
        total_resenas: Number(f.total_resenas),
      });
    }
    return res.json({ total: filas.length, ferias: [...porFeria.values()] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error al buscar' });
  }
});

module.exports = router;
