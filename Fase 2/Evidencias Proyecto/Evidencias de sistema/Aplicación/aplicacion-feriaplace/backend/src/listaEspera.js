// Lista de espera de una feria llena. Cuando se libera un puesto se le ofrece al primero de la fila por 48 horas.
// Mientras dura la oferta el puesto queda ocupado, para que nadie más lo tome; si la oferta se rechaza o vence, pasa al siguiente.
const pool = require('./db');
const { notificar } = require('./notificar');

const HORAS_OFERTA = 48;

// Ofrece los puestos libres de la feria a quienes esperan, en orden de llegada
async function ofrecerPuestosLibres(feriaId) {
  const conexion = await pool.getConnection();
  const ofertas = [];
  let nombreFeria = '';
  try {
    await conexion.beginTransaction();
    const [[feria]] = await conexion.query('SELECT id, nombre FROM feria WHERE id = ? FOR UPDATE', [feriaId]);
    if (!feria) {
      await conexion.rollback();
      return 0;
    }
    nombreFeria = feria.nombre;
    const [esperando] = await conexion.query(
      "SELECT id, usuario_id FROM lista_espera WHERE feria_id = ? AND estado = 'esperando' ORDER BY id FOR UPDATE", [feriaId]);
    if (esperando.length > 0) {
      const [libres] = await conexion.query(
        "SELECT id, codigo FROM puesto WHERE feria_id = ? AND estado = 'disponible' ORDER BY id LIMIT ? FOR UPDATE",
        [feriaId, esperando.length]
      );
      for (let i = 0; i < libres.length; i += 1) {
        await conexion.query("UPDATE puesto SET estado = 'ocupado' WHERE id = ?", [libres[i].id]);
        await conexion.query(
          `UPDATE lista_espera SET estado = 'ofrecido', puesto_id = ?, oferta_vence = NOW() + INTERVAL ${HORAS_OFERTA} HOUR WHERE id = ?`,
          [libres[i].id, esperando[i].id]
        );
        ofertas.push({ usuarioId: esperando[i].usuario_id, codigo: libres[i].codigo });
      }
    }
    await conexion.commit();
  } catch (err) {
    await conexion.rollback();
    throw err;
  } finally {
    conexion.release();
  }
  for (const o of ofertas) {
    await notificar(o.usuarioId, {
      titulo: `Se liberó un puesto en "${nombreFeria}"`,
      mensaje: `Te toca en la lista de espera: tienes el puesto ${o.codigo} reservado por ${HORAS_OFERTA} horas. Acéptalo en "Mis solicitudes".`,
      enlace: 'mis-solicitudes.html',
    });
  }
  return ofertas.length;
}

// Saca a alguien de la lista (oferta rechazada, oferta vencida o salida voluntaria). Si tenía un puesto reservado, lo devuelve.
// Devuelve false si la inscripción ya había cambiado de estado.
async function cerrarInscripcion(id, estadoFinal, soloVencida = false) {
  const conexion = await pool.getConnection();
  let inscripcion = null;
  try {
    await conexion.beginTransaction();
    const [[fila]] = await conexion.query(
      `SELECT id, feria_id, usuario_id, estado, puesto_id, oferta_vence <= NOW() AS vencida FROM lista_espera WHERE id = ? FOR UPDATE`, [id]);
    const activa = fila && ['esperando', 'ofrecido'].includes(fila.estado);
    if (!activa || (soloVencida && !(fila.estado === 'ofrecido' && fila.vencida))) {
      await conexion.rollback();
      return false;
    }
    inscripcion = fila;
    if (fila.estado === 'ofrecido') {
      await conexion.query("UPDATE puesto SET estado = 'disponible' WHERE id = ?", [fila.puesto_id]);
    }
    await conexion.query('UPDATE lista_espera SET estado = ?, oferta_vence = NULL WHERE id = ?', [estadoFinal, id]);
    await conexion.commit();
  } catch (err) {
    await conexion.rollback();
    throw err;
  } finally {
    conexion.release();
  }
  if (inscripcion.estado === 'ofrecido') await ofrecerPuestosLibres(inscripcion.feria_id);
  return true;
}

// Cierra las ofertas que pasaron su plazo y le ofrece el puesto al siguiente
async function vencerOfertas() {
  const [vencidas] = await pool.query(
    "SELECT id, usuario_id FROM lista_espera WHERE estado = 'ofrecido' AND oferta_vence <= NOW()");
  for (const v of vencidas) {
    if (await cerrarInscripcion(v.id, 'vencido', true)) {
      await notificar(v.usuario_id, {
        titulo: 'Tu oferta de puesto venció',
        mensaje: `Pasaron ${HORAS_OFERTA} horas sin que aceptaras el puesto, así que se le ofreció a la siguiente persona.`,
        enlace: 'mis-solicitudes.html',
      });
    }
  }
}

module.exports = { HORAS_OFERTA, ofrecerPuestosLibres, cerrarInscripcion, vencerOfertas };
