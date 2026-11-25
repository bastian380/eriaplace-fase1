// Quién puede gestionar qué feria.
//   - administrador (dueño de la plataforma): todas las ferias.
//   - admin_feria (Administrador de Feria): solo las ferias de las que es dueño (feria.admin_feria_id).
// También calcula cuántos puestos de una feria están cubiertos por cobros de publicación pagados.
const pool = require('./db');

const ROLES_GESTION = ['administrador', 'admin_feria'];
const TARIFA_POR_DEFECTO = 5000;

const esPlataforma = (req) => Boolean(req.usuario && req.usuario.rol === 'administrador');
const esAdminFeria = (req) => Boolean(req.usuario && req.usuario.rol === 'admin_feria');

function puedeGestionar(req, feria) {
  if (!feria) return false;
  if (esPlataforma(req)) return true;
  return esAdminFeria(req) && feria.admin_feria_id === req.usuario.id;
}

// Busca la feria y revisa el permiso. Devuelve { feria } o { status, error } para responder.
async function feriaGestionable(req, feriaId, conexion = pool, bloquear = false) {
  const [filas] = await conexion.query(`SELECT * FROM feria WHERE id = ?${bloquear ? ' FOR UPDATE' : ''}`, [feriaId]);
  if (filas.length === 0) return { status: 404, error: 'Feria no encontrada' };
  if (!puedeGestionar(req, filas[0])) return { status: 403, error: 'Esta feria la administra otra persona' };
  return { feria: filas[0] };
}

// Filtro SQL para listar solo lo que el usuario puede gestionar (alias de la tabla feria como parámetro)
function filtroFerias(req, alias = 'f') {
  if (esPlataforma(req)) return { sql: '1 = 1', params: [] };
  return { sql: `${alias}.admin_feria_id = ?`, params: [req.usuario.id] };
}

// Puestos pagados y pendientes de pago de una feria de un Administrador de Feria
async function cobertura(feriaId, conexion = pool) {
  const [[fila]] = await conexion.query(
    `SELECT (SELECT COUNT(*) FROM puesto WHERE feria_id = ?) AS total,
            COALESCE((SELECT SUM(puestos) FROM cobro_publicacion WHERE feria_id = ? AND estado = 'pagado'), 0) AS pagados,
            COALESCE((SELECT SUM(puestos) FROM cobro_publicacion WHERE feria_id = ? AND estado = 'pendiente'), 0) AS pendientes`,
    [feriaId, feriaId, feriaId]
  );
  return { total: Number(fila.total), pagados: Number(fila.pagados), pendientes: Number(fila.pendientes) };
}

// Una feria de Administrador de Feria se puede publicar si tiene puestos y todos están pagados.
// Las ferias de la plataforma (sin dueño) no pagan publicación.
async function puedePublicarse(feria, conexion = pool) {
  if (!feria.admin_feria_id) return { ok: true };
  const c = await cobertura(feria.id, conexion);
  if (c.total === 0) return { ok: false, ...c, error: 'Agrega puestos al plano antes de publicar la feria' };
  if (c.total > c.pagados) {
    return {
      ok: false, ...c,
      error: `Para publicar faltan pagar ${c.total - c.pagados} de ${c.total} puestos. Solicita la publicación y paga el cobro de la plataforma.`,
    };
  }
  return { ok: true, ...c };
}

// Después de registrar o anular un pago de publicación: publica la feria si quedó cubierta, o la vuelve a borrador si dejó de estarlo.
async function recalcularPublicacion(conexion, feriaId, estado) {
  const [[feria]] = await conexion.query('SELECT id, nombre, publicada FROM feria WHERE id = ? FOR UPDATE', [feriaId]);
  const c = await cobertura(feria.id, conexion);
  const cubierta = c.total > 0 && c.pagados >= c.total;
  let publicada = Boolean(feria.publicada);
  if (estado === 'pagado' && cubierta && !publicada) publicada = true;
  if (estado === 'pendiente' && !cubierta && publicada) publicada = false;
  if (publicada !== Boolean(feria.publicada)) {
    await conexion.query('UPDATE feria SET publicada = ? WHERE id = ?', [publicada ? 1 : 0, feria.id]);
  }
  return { feria, publicada };
}

async function tarifaPorPuesto(conexion = pool) {
  const [filas] = await conexion.query("SELECT valor FROM configuracion WHERE clave = 'tarifa_puesto'");
  const valor = filas.length ? Number(filas[0].valor) : Number(process.env.TARIFA_PUESTO || TARIFA_POR_DEFECTO);
  return Number.isInteger(valor) && valor >= 0 ? valor : TARIFA_POR_DEFECTO;
}

// Ids de los administradores de la plataforma, para avisarles de cobros nuevos
async function idsPlataforma() {
  const [filas] = await pool.query("SELECT id FROM usuario WHERE rol = 'administrador'");
  return filas.map((f) => f.id);
}

module.exports = {
  ROLES_GESTION, TARIFA_POR_DEFECTO, esPlataforma, esAdminFeria, puedeGestionar, feriaGestionable,
  filtroFerias, cobertura, puedePublicarse, tarifaPorPuesto, idsPlataforma, recalcularPublicacion,
};
