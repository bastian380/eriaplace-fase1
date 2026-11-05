const express = require('express');
const pool = require('../db');
const { verificarToken, requireRol } = require('../middleware/auth');

const router = express.Router();

// Puestos de todas las ferias (o de una con ?feria_id=), solo lectura para cualquier usuario autenticado
router.get('/', verificarToken, async (req, res) => {
  const params = [];
  let sql = `SELECT p.id, p.feria_id, f.nombre AS feria_nombre, p.codigo, p.zona, p.tamano, p.estado
             FROM puesto p JOIN feria f ON f.id = p.feria_id`;
  if (req.query.feria_id) {
    sql += ' WHERE p.feria_id = ?';
    params.push(req.query.feria_id);
  }
  const [puestos] = await pool.query(`${sql} ORDER BY f.nombre, p.codigo`, params);
  res.json(puestos);
});

// Puestos libres, usado por el administrador al asignar una solicitud
router.get('/disponibles', verificarToken, requireRol('administrador'), async (req, res) => {
  const [puestos] = await pool.query(
    `SELECT p.id, p.feria_id, f.nombre AS feria_nombre, p.codigo, p.zona, p.tamano,
            COALESCE(p.precio, f.precio_puesto) AS precio
     FROM puesto p JOIN feria f ON f.id = p.feria_id
     WHERE p.estado = 'disponible' ORDER BY f.nombre, p.codigo`
  );
  res.json(puestos);
});

module.exports = router;
