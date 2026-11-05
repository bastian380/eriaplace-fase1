// Pruebas de rechazo y de concurrencia de FeriaPlace.
// Comprueban lo que el informe declaraba solo como "protección implementada":
//  - dos asignaciones simultáneas del mismo puesto: solo una gana y la base queda consistente;
//  - el bloqueo de fila (SELECT ... FOR UPDATE) hace esperar a la segunda transacción;
//  - rechazos por falta de permisos (401 y 403), por cuenta pendiente y por puesto ocupado (409).
// Uso: dentro de backend/, `npm test` (necesita MySQL y la base feriaplace_test; ver README).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { prepararBase, levantarServidor, ADMIN } = require('./preparar');
const pool = require('../src/db');

let api;
let cerrar;
let tokenAdmin;
let feria;
let puestos;
const comerciantes = [];

const RONDAS = 10;

// Registra una cuenta de comerciante; si `aprobar` es verdadero, el administrador la aprueba e inicia sesión
async function crearComerciante(n, aprobar = true) {
  const datos = {
    nombre: `Comerciante ${n}`, email: `comerciante${n}@prueba.cl`, password: `Clave${n}Segura2026`,
    motivo_registro: 'Vendo artesanía navideña y busco un puesto.',
  };
  const registro = await api('/auth/registro', { metodo: 'POST', cuerpo: datos });
  assert.equal(registro.status, 201);
  if (!aprobar) return { ...datos, id: registro.datos.id };
  const aprobado = await api(`/usuarios/${registro.datos.id}/aprobar`, { metodo: 'PUT', cuerpo: {}, token: tokenAdmin });
  assert.equal(aprobado.status, 200);
  const login = await api('/auth/login', { metodo: 'POST', cuerpo: datos });
  assert.equal(login.status, 200);
  return { ...datos, id: registro.datos.id, token: login.datos.token };
}

async function solicitar(comerciante, extra = {}) {
  const r = await api('/solicitudes', {
    metodo: 'POST', token: comerciante.token, cuerpo: { feria_id: feria.id, rubro: 'Artesanía', ...extra },
  });
  assert.equal(r.status, 201);
  return r.datos.id;
}

const asignar = (solicitudId, puestoId) => api(`/solicitudes/${solicitudId}/asignar`, {
  metodo: 'PUT', cuerpo: { puesto_id: puestoId }, token: tokenAdmin,
});

before(async () => {
  await prepararBase();
  ({ api, cerrar } = await levantarServidor());
  tokenAdmin = (await api('/auth/login', { metodo: 'POST', cuerpo: ADMIN })).datos.token;
  const creada = await api('/ferias', {
    metodo: 'POST',
    token: tokenAdmin,
    cuerpo: {
      nombre: 'Feria de concurrencia', comuna: 'Maipú', ancho: 30, alto: 20,
      fecha_inicio: '2026-12-01', fecha_cierre: '2026-12-24', precio_puesto: 150000, cantidad_puestos: RONDAS * 2 + 4,
    },
  });
  assert.equal(creada.status, 201);
  feria = creada.datos;
  puestos = (await api(`/ferias/${feria.id}`)).datos.puestos;
  comerciantes.push(await crearComerciante(1), await crearComerciante(2));
});

after(async () => {
  await cerrar();
});

test('concurrencia: dos solicitudes que piden el mismo puesto al mismo tiempo, solo una lo obtiene', async () => {
  // Se repite varias veces para no depender de un solo orden de llegada
  for (let ronda = 0; ronda < RONDAS; ronda += 1) {
    const puesto = puestos[ronda];
    const s1 = await solicitar(comerciantes[0], { puesto_preferido_id: puesto.id });
    const s2 = await solicitar(comerciantes[1], { puesto_preferido_id: puesto.id });

    // Las dos asignaciones salen a la vez, cada una por su propia conexión a MySQL
    const respuestas = await Promise.all([asignar(s1, puesto.id), asignar(s2, puesto.id)]);
    const codigos = respuestas.map((r) => r.status).sort();
    assert.deepEqual(codigos, [200, 409], `ronda ${ronda + 1}: una asignación gana y la otra recibe 409`);
    const perdedora = respuestas.find((r) => r.status === 409);
    assert.equal(perdedora.datos.error, 'Ese puesto ya no está disponible');

    // En la base: el puesto queda ocupado una sola vez y la otra solicitud sigue pendiente
    const [[fila]] = await pool.query(
      `SELECT p.estado,
              (SELECT COUNT(*) FROM solicitud WHERE puesto_id = p.id AND estado = 'confirmada') AS confirmadas,
              (SELECT COUNT(*) FROM solicitud WHERE id IN (?, ?) AND estado = 'pendiente') AS pendientes
       FROM puesto p WHERE p.id = ?`,
      [s1, s2, puesto.id]
    );
    assert.deepEqual({ ...fila }, { estado: 'ocupado', confirmadas: 1, pendientes: 1 });

    // Se rechaza la que quedó pendiente para empezar la ronda siguiente limpia
    const pendiente = respuestas[0].status === 409 ? s1 : s2;
    await api(`/solicitudes/${pendiente}/rechazar`, { metodo: 'PUT', cuerpo: { comentario_admin: 'Sin cupo' }, token: tokenAdmin });
  }
});

test('concurrencia: una misma solicitud asignada a dos puestos a la vez ocupa un solo puesto', async () => {
  const a = puestos[RONDAS];
  const b = puestos[RONDAS + 1];
  const s = await solicitar(comerciantes[0]);
  const respuestas = await Promise.all([asignar(s, a.id), asignar(s, b.id)]);
  assert.deepEqual(respuestas.map((r) => r.status).sort(), [200, 409]);
  assert.equal(respuestas.find((r) => r.status === 409).datos.error, 'La solicitud ya fue resuelta');

  const [filas] = await pool.query("SELECT id FROM puesto WHERE id IN (?, ?) AND estado = 'ocupado'", [a.id, b.id]);
  assert.equal(filas.length, 1, 'solo uno de los dos puestos queda ocupado');
});

test('el bloqueo de fila hace esperar a la segunda transacción hasta que la primera termina', async () => {
  const puesto = puestos[RONDAS + 2];
  const s = await solicitar(comerciantes[1]);

  // Una transacción "externa" toma el puesto con FOR UPDATE, como lo haría otra asignación en curso
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    await conexion.query('SELECT * FROM puesto WHERE id = ? FOR UPDATE', [puesto.id]);

    let terminada = false;
    const pedido = asignar(s, puesto.id).then((r) => { terminada = true; return r; });
    await new Promise((resolve) => { setTimeout(resolve, 500); });
    assert.equal(terminada, false, 'la API espera mientras la fila del puesto está bloqueada');

    // La transacción externa ocupa el puesto y confirma: recién ahí la API continúa y ve el puesto ocupado
    await conexion.query("UPDATE puesto SET estado = 'ocupado' WHERE id = ?", [puesto.id]);
    await conexion.commit();
    const respuesta = await pedido;
    assert.equal(respuesta.status, 409);
    assert.equal(respuesta.datos.error, 'Ese puesto ya no está disponible');
  } finally {
    conexion.release();
  }

  const [[solicitud]] = await pool.query('SELECT estado, puesto_id FROM solicitud WHERE id = ?', [s]);
  assert.deepEqual({ ...solicitud }, { estado: 'pendiente', puesto_id: null });
});

test('permisos: sin sesión o con un token falso la API responde 401', async () => {
  const sinToken = await api('/solicitudes', { metodo: 'POST', cuerpo: { feria_id: feria.id, rubro: 'X' } });
  assert.equal(sinToken.status, 401);
  const falso = await api('/solicitudes/mias', { token: 'esto.no.es-un-token' });
  assert.equal(falso.status, 401);
  const sinSesionAdmin = await api('/reportes/ocupacion');
  assert.equal(sinSesionAdmin.status, 401);
});

test('permisos: un comerciante no puede usar acciones del administrador (403)', async () => {
  const { token } = comerciantes[0];
  const s = await solicitar(comerciantes[0]);
  const intentos = [
    api(`/solicitudes/${s}/asignar`, { metodo: 'PUT', cuerpo: { puesto_id: puestos[RONDAS + 3].id }, token }),
    api(`/solicitudes/${s}/rechazar`, { metodo: 'PUT', cuerpo: {}, token }),
    api(`/solicitudes/${s}/pago`, { metodo: 'PUT', cuerpo: { estado_pago: 'pagado' }, token }),
    api('/solicitudes', { token }),
    api(`/usuarios/${comerciantes[1].id}/aprobar`, { metodo: 'PUT', cuerpo: {}, token }),
    api('/reportes/ocupacion', { token }),
  ];
  for (const r of await Promise.all(intentos)) {
    assert.equal(r.status, 403);
    assert.equal(r.datos.error, 'No tienes permiso para esta acción');
  }
  // El intento fallido no cambió nada en la base
  const [[fila]] = await pool.query('SELECT estado FROM solicitud WHERE id = ?', [s]);
  assert.equal(fila.estado, 'pendiente');
});

test('permisos: el administrador no puede pedir puestos a nombre de un comerciante (403)', async () => {
  const r = await api('/solicitudes', { metodo: 'POST', token: tokenAdmin, cuerpo: { feria_id: feria.id, rubro: 'X' } });
  assert.equal(r.status, 403);
});

test('cuenta pendiente: no inicia sesión ni puede pedir un puesto', async () => {
  const pendiente = await crearComerciante(3, false);
  const login = await api('/auth/login', { metodo: 'POST', cuerpo: pendiente });
  assert.equal(login.status, 403);
  assert.match(login.datos.error, /esperando la aprobación/);

  // Aunque tuviera una sesión de antes (por ejemplo, si el administrador la volvió a dejar pendiente), la API la frena
  const aprobado = await crearComerciante(4);
  await pool.query("UPDATE usuario SET estado = 'pendiente' WHERE id = ?", [aprobado.id]);
  const r = await api('/solicitudes', {
    metodo: 'POST', token: aprobado.token, cuerpo: { feria_id: feria.id, rubro: 'Artesanía' },
  });
  assert.equal(r.status, 403);
  assert.equal(r.datos.error, 'Tu cuenta no está aprobada por el administrador');
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM solicitud WHERE usuario_id = ?', [aprobado.id]);
  assert.equal(total, 0, 'no se guardó ninguna solicitud');
});

test('puesto ocupado: no se puede pedir como preferido ni asignar a otra solicitud (409)', async () => {
  const ocupado = puestos[0];
  const preferido = await api('/solicitudes', {
    metodo: 'POST', token: comerciantes[1].token, cuerpo: { feria_id: feria.id, rubro: 'Dulces', puesto_preferido_id: ocupado.id },
  });
  assert.equal(preferido.status, 409);
  assert.equal(preferido.datos.error, 'El puesto preferido ya no está disponible');

  const s = await solicitar(comerciantes[1]);
  const r = await asignar(s, ocupado.id);
  assert.equal(r.status, 409);
  assert.equal(r.datos.error, 'Ese puesto ya no está disponible');
});
