// Datos de demostración del modelo de negocio con el caso de las ferias navideñas del informe.
// Crea (si no existen):
//   - Carla Soto, Administradora de Feria de la "Feria Navideña de Peñalolén" (01 al 24-12-2026, 12 puestos, $150.000),
//     con su cobro de publicación pagado: la feria queda publicada.
//   - Pedro Rojas, Administrador de Feria de la "Feria Navideña Plaza de Maipú" (8 puestos), con el cobro pendiente:
//     la feria queda en borrador hasta que la plataforma registre el pago.
// Las dos cuentas usan la contraseña DEMO_PASSWORD (por defecto Demo2026!). No se ejecuta con NODE_ENV=production.
// Uso: dentro de backend/, `npm run demo` (después de `npm run migrar` o `npm run instalar`).
require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('./db');
const { ubicarEnFilas } = require('./plano');
const { tarifaPorPuesto } = require('./permisos');

const CLAVE = process.env.DEMO_PASSWORD || 'Demo2026!';

const CASOS = [
  {
    cuenta: {
      nombre: 'Carla Soto', email: 'carla@navidad-penalolen.cl', organizacion: 'Feria Navideña de Peñalolén',
      motivo: 'Organizo la Feria Navideña de Peñalolén y quiero publicar sus 12 puestos.',
    },
    feria: {
      nombre: 'Feria Navideña de Peñalolén', lugar: 'Parque Peñalolén', comuna: 'Peñalolén',
      fecha_inicio: '2026-12-01', fecha_cierre: '2026-12-24', fecha_texto: 'Todos los días de 11:00 a 21:00',
      precio_puesto: 150000, puestos: 12,
      descripcion: 'Feria navideña de regalos, artesanía y comida, con escenario y juegos para niños.',
    },
    pagado: true,
  },
  {
    cuenta: {
      nombre: 'Pedro Rojas', email: 'pedro@navidad-maipu.cl', organizacion: 'Feria Navideña Plaza de Maipú',
      motivo: 'Organizo la feria navideña de la Plaza de Maipú y quiero publicar sus 8 puestos.',
    },
    feria: {
      nombre: 'Feria Navideña Plaza de Maipú', lugar: 'Plaza de Maipú', comuna: 'Maipú',
      fecha_inicio: '2026-12-05', fecha_cierre: '2026-12-24', fecha_texto: 'Viernes a domingo de 12:00 a 22:00',
      precio_puesto: 120000, puestos: 8, descripcion: 'Feria navideña de emprendedores de Maipú.',
    },
    pagado: false,
  },
];

async function crearCaso({ cuenta, feria, pagado }, tarifa) {
  let [[usuario]] = await pool.query('SELECT id FROM usuario WHERE email = ?', [cuenta.email]);
  if (!usuario) {
    const [r] = await pool.query(
      `INSERT INTO usuario (nombre, email, password_hash, rol, estado, motivo_registro, organizacion, revisado_en)
       VALUES (?, ?, ?, 'admin_feria', 'aprobado', ?, ?, NOW())`,
      [cuenta.nombre, cuenta.email, await bcrypt.hash(CLAVE, 10), cuenta.motivo, cuenta.organizacion]
    );
    usuario = { id: r.insertId };
    console.log(`  + Administrador de Feria ${cuenta.email}`);
  } else {
    console.log(`  = ${cuenta.email} (ya existía)`);
  }
  const [[existente]] = await pool.query('SELECT id FROM feria WHERE nombre = ?', [feria.nombre]);
  if (existente) {
    console.log(`  = ${feria.nombre} (ya existía)`);
    return;
  }
  const lista = Array.from({ length: feria.puestos }, (_, i) => ({ codigo: `A${i + 1}`, zona: 'General', tamano: 'mediano' }));
  const { puestos, altoUsado } = ubicarEnFilas(lista, 24);
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const [f] = await conexion.query(
      `INSERT INTO feria (admin_feria_id, nombre, lugar, comuna, fecha_texto, fecha_inicio, fecha_cierre, precio_puesto,
         descripcion, ancho, alto, publicada) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 24, ?, ?)`,
      [usuario.id, feria.nombre, feria.lugar, feria.comuna, feria.fecha_texto, feria.fecha_inicio, feria.fecha_cierre,
        feria.precio_puesto, feria.descripcion, Math.max(14, altoUsado + 1), pagado ? 1 : 0]
    );
    for (const p of puestos) {
      await conexion.query(
        'INSERT INTO puesto (feria_id, codigo, zona, tamano, pos_x, pos_y, ancho, alto) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [f.insertId, p.codigo, p.zona, p.tamano, p.pos_x, p.pos_y, p.ancho, p.alto]
      );
    }
    await conexion.query(
      `INSERT INTO cobro_publicacion (feria_id, admin_feria_id, puestos, tarifa, monto, estado, pagado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [f.insertId, usuario.id, feria.puestos, tarifa, feria.puestos * tarifa, pagado ? 'pagado' : 'pendiente',
        pagado ? new Date() : null]
    );
    await conexion.commit();
    console.log(`  + ${feria.nombre}: ${feria.puestos} puestos, cobro ${pagado ? 'pagado (publicada)' : 'pendiente (borrador)'}`);
  } catch (err) {
    await conexion.rollback();
    throw err;
  } finally {
    conexion.release();
  }
}

(async () => {
  try {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Los datos de demostración no se cargan con NODE_ENV=production');
    }
    const tarifa = await tarifaPorPuesto();
    console.log(`Datos de demostración: ferias navideñas (tarifa de la plataforma $${tarifa.toLocaleString('es-CL')} por puesto)`);
    for (const caso of CASOS) await crearCaso(caso, tarifa);
    console.log(`Listo. Las cuentas de demostración entran con la contraseña ${CLAVE}`);
  } catch (err) {
    console.error('Error al cargar los datos de demostración:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
