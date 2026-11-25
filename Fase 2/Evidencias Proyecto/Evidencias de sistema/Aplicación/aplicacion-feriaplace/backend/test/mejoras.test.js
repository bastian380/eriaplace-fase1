// Pruebas de las mejoras nuevas (pago en línea en modo prueba y las siguientes).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { prepararBase, levantarServidor, ADMIN } = require('./preparar');
const pool = require('../src/db');

let api;
let cerrar;
let baseUrl;
let tokenAdmin;
let feria;
const cuentas = {};

// Registra y aprueba una cuenta, y devuelve su token
async function crearCuenta(nombre, rol = 'comerciante') {
  const email = `${nombre}@prueba.cl`;
  const password = 'ClavePrueba2026';
  const cuerpo = { nombre, email, password, motivo_registro: 'Quiero participar en la feria de prueba.' };
  const registro = await api('/auth/registro', { metodo: 'POST', cuerpo });
  assert.equal(registro.status, 201, JSON.stringify(registro.datos));
  await pool.query("UPDATE usuario SET estado = 'aprobado', rol = ? WHERE email = ?", [rol, email]);
  const [[fila]] = await pool.query('SELECT id FROM usuario WHERE email = ?', [email]);
  const login = await api('/auth/login', { metodo: 'POST', cuerpo: { email, password } });
  assert.equal(login.status, 200);
  cuentas[nombre] = { token: login.datos.token, id: fila.id };
  return cuentas[nombre];
}

async function solicitarYAsignar(token, puestoId, feriaId = feria.id) {
  const s = await api('/solicitudes', { metodo: 'POST', token, cuerpo: { feria_id: feriaId, rubro: 'Verduras' } });
  assert.equal(s.status, 201);
  const a = await api(`/solicitudes/${s.datos.id}/asignar`, { metodo: 'PUT', token: tokenAdmin, cuerpo: { puesto_id: puestoId } });
  assert.equal(a.status, 200);
  return s.datos.id;
}

async function crearFeria(token, nombre, puestos = 3) {
  const creada = await api('/ferias', {
    metodo: 'POST', token,
    cuerpo: {
      nombre, comuna: 'Maipú', ancho: 24, alto: 14, publicada: true, precio_puesto: 20000,
      fecha_inicio: '2026-12-01', fecha_cierre: '2026-12-24',
      cantidad_puestos: puestos, tamano_puestos: 'mediano', zona_puestos: 'Centro', prefijo_puestos: 'P',
    },
  });
  assert.equal(creada.status, 201, JSON.stringify(creada.datos));
  const detalle = await api(`/ferias/${creada.datos.id}`, { token });
  return detalle.datos;
}

before(async () => {
  await prepararBase();
  ({ api, cerrar, base: baseUrl } = await levantarServidor());
  const login = await api('/auth/login', { metodo: 'POST', cuerpo: ADMIN });
  tokenAdmin = login.datos.token;
  await crearCuenta('ana');
  await crearCuenta('beto');
  feria = await crearFeria(tokenAdmin, 'Feria de mejoras');
  assert.equal(feria.puestos.length, 3);
});

after(async () => {
  await cerrar();
});

test('pago en línea: el comerciante paga su puesto y queda pagado una sola vez', async () => {
  const id = await solicitarYAsignar(cuentas.ana.token, feria.puestos[0].id);

  const ajeno = await api('/pagos/iniciar', { metodo: 'POST', token: cuentas.beto.token, cuerpo: { tipo: 'puesto', id } });
  assert.equal(ajeno.status, 404, 'no se puede pagar el cobro de otra persona');

  const rechazo = await api('/pagos/iniciar', { metodo: 'POST', token: cuentas.ana.token, cuerpo: { tipo: 'puesto', id } });
  assert.equal(rechazo.status, 201);
  const r1 = await api(`/pagos/${rechazo.datos.token}/resultado`, { metodo: 'POST', token: cuentas.ana.token, cuerpo: { resultado: 'rechazar' } });
  assert.equal(r1.datos.estado, 'rechazado');
  let mias = await api('/solicitudes/mias', { token: cuentas.ana.token });
  assert.equal(mias.datos[0].estado_pago, 'pendiente');

  const antiguo = await api('/pagos/iniciar', { metodo: 'POST', token: cuentas.ana.token, cuerpo: { tipo: 'puesto', id } });
  const inicio = await api('/pagos/iniciar', { metodo: 'POST', token: cuentas.ana.token, cuerpo: { tipo: 'puesto', id } });
  const vencido = await api(`/pagos/${antiguo.datos.token}/resultado`, { metodo: 'POST', token: cuentas.ana.token, cuerpo: { resultado: 'aprobar' } });
  assert.equal(vencido.status, 409, 'solo vale el último intento');

  const ok = await api(`/pagos/${inicio.datos.token}/resultado`, { metodo: 'POST', token: cuentas.ana.token, cuerpo: { resultado: 'aprobar' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.datos.estado, 'aprobado');
  assert.match(ok.datos.codigo_autorizacion, /^\d{6}$/);

  mias = await api('/solicitudes/mias', { token: cuentas.ana.token });
  assert.equal(mias.datos[0].estado_pago, 'pagado');
  assert.equal(mias.datos[0].pago_autorizacion, ok.datos.codigo_autorizacion);

  const repetido = await api(`/pagos/${inicio.datos.token}/resultado`, { metodo: 'POST', token: cuentas.ana.token, cuerpo: { resultado: 'aprobar' } });
  assert.equal(repetido.status, 409);
  const otraVez = await api('/pagos/iniciar', { metodo: 'POST', token: cuentas.ana.token, cuerpo: { tipo: 'puesto', id } });
  assert.equal(otraVez.status, 409);
});

test('pago en línea: si el administrador cambia el monto, el intento anterior no se cobra', async () => {
  const id = await solicitarYAsignar(cuentas.beto.token, feria.puestos[1].id);
  const inicio = await api('/pagos/iniciar', { metodo: 'POST', token: cuentas.beto.token, cuerpo: { tipo: 'puesto', id } });
  await api(`/solicitudes/${id}/pago`, { metodo: 'PUT', token: tokenAdmin, cuerpo: { estado_pago: 'pendiente', monto: 999 } });
  const r = await api(`/pagos/${inicio.datos.token}/resultado`, { metodo: 'POST', token: cuentas.beto.token, cuerpo: { resultado: 'aprobar' } });
  assert.equal(r.status, 409);
  const mias = await api('/solicitudes/mias', { token: cuentas.beto.token });
  assert.equal(mias.datos[0].estado_pago, 'pendiente');
});

test('pago en línea: el Administrador de Feria paga la publicación y su feria se publica sola', async () => {
  const carla = await crearCuenta('carla', 'admin_feria');
  const propia = await crearFeria(carla.token, 'Feria de Carla', 2);
  const pedir = await api(`/ferias/${propia.id}/publicacion`, { metodo: 'POST', token: carla.token, cuerpo: {} });
  assert.equal(pedir.status, 201, JSON.stringify(pedir.datos));
  const { datos } = await api('/cobros', { token: carla.token });
  const cobro = datos.cobros[0];
  assert.equal(cobro.estado, 'pendiente');

  const inicio = await api('/pagos/iniciar', { metodo: 'POST', token: carla.token, cuerpo: { tipo: 'publicacion', id: cobro.id } });
  assert.equal(inicio.status, 201);
  const ok = await api(`/pagos/${inicio.datos.token}/resultado`, { metodo: 'POST', token: carla.token, cuerpo: { resultado: 'aprobar' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.datos.feria_publicada, true);

  const despues = await api('/cobros', { token: carla.token });
  assert.equal(despues.datos.cobros[0].estado, 'pagado');
  assert.equal(despues.datos.cobros[0].publicada, true);
});

test('notificaciones: cada aviso sale por los canales elegidos y queda en la bandeja', async () => {
  const sinTelefono = await api('/notificaciones/preferencias', {
    metodo: 'PUT', token: cuentas.beto.token, cuerpo: { avisar_correo: true, avisar_whatsapp: true, telefono: '' },
  });
  assert.equal(sinTelefono.status, 400);
  const ok = await api('/notificaciones/preferencias', {
    metodo: 'PUT', token: cuentas.beto.token, cuerpo: { avisar_correo: false, avisar_whatsapp: true, telefono: '+56 9 1234 5678' },
  });
  assert.equal(ok.status, 200);

  const prohibido = await api('/notificaciones/envios', { token: cuentas.beto.token });
  assert.equal(prohibido.status, 403);

  // Pagar deja un aviso: Beto eligió solo WhatsApp
  await api(`/solicitudes/${(await api('/solicitudes/mias', { token: cuentas.beto.token })).datos[0].id}/pago`, {
    metodo: 'PUT', token: tokenAdmin, cuerpo: { estado_pago: 'pagado' },
  });
  const { datos: envios } = await api('/notificaciones/envios', { token: tokenAdmin });
  const deBeto = envios.filter((e) => e.nombre === 'beto');
  assert.equal(deBeto[0].canal, 'whatsapp');
  assert.equal(deBeto[0].estado, 'simulado');
  assert.ok(!deBeto.slice(0, 1).some((e) => e.canal === 'correo'));
  await api(`/solicitudes/${(await api('/solicitudes/mias', { token: cuentas.beto.token })).datos[0].id}/pago`, {
    metodo: 'PUT', token: tokenAdmin, cuerpo: { estado_pago: 'pendiente' },
  });
});

test('notificaciones: recordatorio de pago una sola vez cada 3 días, solo si la feria está cerca', async () => {
  const lejos = await api('/notificaciones/recordatorios', { metodo: 'POST', token: tokenAdmin, cuerpo: {} });
  assert.equal(lejos.datos.enviados, 0, 'la feria todavía no está cerca');

  await pool.query('UPDATE feria SET fecha_inicio = CURDATE() + INTERVAL 2 DAY, fecha_cierre = CURDATE() + INTERVAL 9 DAY WHERE id = ?', [feria.id]);
  const primero = await api('/notificaciones/recordatorios', { metodo: 'POST', token: tokenAdmin, cuerpo: {} });
  assert.equal(primero.datos.enviados, 1);
  const avisos = await api('/notificaciones', { token: cuentas.beto.token });
  assert.match(avisos.datos.avisos[0].titulo, /Recuerda pagar/);

  const segundo = await api('/notificaciones/recordatorios', { metodo: 'POST', token: tokenAdmin, cuerpo: {} });
  assert.equal(segundo.datos.enviados, 0);
  const comerciante = await api('/notificaciones/recordatorios', { metodo: 'POST', token: cuentas.beto.token, cuerpo: {} });
  assert.equal(comerciante.status, 403);
});

test('lista de espera: la feria llena recibe filas y el puesto liberado pasa en orden', async () => {
  const chica = await crearFeria(tokenAdmin, 'Feria chica', 1);
  const dani = await crearCuenta('dani');
  const eli = await crearCuenta('eli');
  const fer = await crearCuenta('fer');
  const anotar = (cuenta) => api('/lista-espera', { metodo: 'POST', token: cuenta.token, cuerpo: { feria_id: chica.id, rubro: 'Ropa' } });

  const conLibres = await anotar(eli);
  assert.equal(conLibres.status, 409, 'con puestos libres se usa la solicitud normal');

  const idDani = await solicitarYAsignar(dani.token, chica.puestos[0].id, chica.id);
  const primero = await anotar(eli);
  assert.equal(primero.status, 201);
  assert.equal(primero.datos.posicion, 1);
  assert.equal((await anotar(eli)).status, 409, 'no se puede anotar dos veces');
  assert.equal((await anotar(fer)).datos.posicion, 2);

  const prohibido = await api(`/solicitudes/${idDani}/liberar`, { metodo: 'PUT', token: fer.token, cuerpo: {} });
  assert.equal(prohibido.status, 403);
  const liberado = await api(`/solicitudes/${idDani}/liberar`, { metodo: 'PUT', token: tokenAdmin, cuerpo: { comentario_admin: 'No pagó' } });
  assert.equal(liberado.status, 200);
  assert.equal(liberado.datos.ofrecido_a_lista, true);

  // Mientras dura la oferta el puesto no queda libre para otros
  const detalle = await api(`/ferias/${chica.id}`, { token: tokenAdmin });
  assert.equal(detalle.datos.puestos[0].estado, 'ocupado');

  let filaEli = (await api('/lista-espera/mias', { token: eli.token })).datos[0];
  assert.equal(filaEli.estado, 'ofrecido');
  let filaFer = (await api('/lista-espera/mias', { token: fer.token })).datos[0];
  assert.equal(filaFer.posicion, 1, 'Fer sube al primer lugar de los que esperan');

  // Eli la rechaza: pasa a Fer. Fer deja vencer y luego vuelve a estar libre.
  await api(`/lista-espera/${filaEli.id}/salir`, { metodo: 'POST', token: eli.token, cuerpo: {} });
  filaFer = (await api('/lista-espera/mias', { token: fer.token })).datos[0];
  assert.equal(filaFer.estado, 'ofrecido');
  const robo = await api(`/lista-espera/${filaFer.id}/aceptar`, { metodo: 'POST', token: eli.token, cuerpo: {} });
  assert.equal(robo.status, 404);

  const acepta = await api(`/lista-espera/${filaFer.id}/aceptar`, { metodo: 'POST', token: fer.token, cuerpo: {} });
  assert.equal(acepta.status, 200);
  const mias = await api('/solicitudes/mias', { token: fer.token });
  assert.equal(mias.datos[0].estado, 'confirmada');
  assert.equal(mias.datos[0].puesto_codigo, chica.puestos[0].codigo);
  assert.equal(mias.datos[0].estado_pago, 'pendiente');
  assert.equal(mias.datos[0].monto, 20000);
});

test('lista de espera: una oferta vencida vuelve a estar libre', async () => {
  const feriaV = await crearFeria(tokenAdmin, 'Feria vence', 1);
  const gabi = await crearCuenta('gabi');
  const hugo = await crearCuenta('hugo');
  const id = await solicitarYAsignar(gabi.token, feriaV.puestos[0].id, feriaV.id);
  await api('/lista-espera', { metodo: 'POST', token: hugo.token, cuerpo: { feria_id: feriaV.id, rubro: 'Flores' } });
  await api(`/solicitudes/${id}/liberar`, { metodo: 'PUT', token: tokenAdmin, cuerpo: {} });
  await pool.query("UPDATE lista_espera SET oferta_vence = NOW() - INTERVAL 1 MINUTE WHERE usuario_id = ?", [hugo.id]);

  const lista = await api('/lista-espera/mias', { token: hugo.token });
  assert.equal(lista.datos.length, 0, 'la oferta vencida ya no aparece');
  const detalle = await api(`/ferias/${feriaV.id}`, { token: tokenAdmin });
  assert.equal(detalle.datos.puestos[0].estado, 'disponible');
});

test('buscador: encuentra por rubro y día, sin sesión y sin mostrar quién atiende', async () => {
  const f = await crearFeria(tokenAdmin, 'Feria buscable', 2);
  const iris = await crearCuenta('iris');
  const s = await api('/solicitudes', { metodo: 'POST', token: iris.token, cuerpo: { feria_id: f.id, rubro: 'Frutas y verdura orgánica' } });
  await api(`/solicitudes/${s.datos.id}/asignar`, { metodo: 'PUT', token: tokenAdmin, cuerpo: { puesto_id: f.puestos[0].id } });

  assert.equal((await api('/buscar?q=a')).status, 400);
  const ok = await api('/buscar?q=VERDURAS');
  assert.equal(ok.status, 200);
  const hallada = ok.datos.ferias.find((x) => x.id === f.id);
  assert.equal(hallada.puestos[0].codigo, f.puestos[0].codigo);
  assert.ok(!JSON.stringify(ok.datos).includes('iris'), 'no expone datos de la persona');

  assert.ok((await api('/buscar?q=verduras&fecha=2026-12-10')).datos.ferias.some((x) => x.id === f.id));
  assert.ok(!(await api('/buscar?q=verduras&fecha=2027-03-01')).datos.ferias.some((x) => x.id === f.id));
  assert.equal((await api('/buscar?q=%25%25')).datos.total, 0, 'el % se busca como texto, no como comodín');
});

test('calificaciones: una por persona, no al propio puesto, y se pueden ocultar', async () => {
  const f = await crearFeria(tokenAdmin, 'Feria reseñas', 1);
  const juli = await crearCuenta('juli');
  const kim = await crearCuenta('kim');
  const id = await solicitarYAsignar(juli.token, f.puestos[0].id, f.id);
  const calificar = (token, estrellas, comentario) => api('/resenas', { metodo: 'POST', token, cuerpo: { solicitud_id: id, estrellas, comentario } });

  assert.equal((await calificar(kim.token, 5)).status, 409, 'la feria todavía no empieza');
  await pool.query('UPDATE feria SET fecha_inicio = CURDATE() - INTERVAL 1 DAY WHERE id = ?', [f.id]);

  assert.equal((await calificar(kim.token, 9)).status, 400);
  assert.equal((await calificar(juli.token, 5)).status, 403, 'no puede calificarse a sí misma');
  assert.equal((await api('/resenas', { metodo: 'POST', cuerpo: { solicitud_id: id, estrellas: 5 } })).status, 401);
  assert.equal((await calificar(kim.token, 5, 'Muy buena atención')).status, 201);
  assert.equal((await calificar(kim.token, 3, 'Regular')).status, 201);

  const puestoId = f.puestos[0].id;
  let publico = await api(`/resenas/puesto/${puestoId}`);
  assert.equal(publico.datos.total, 1, 'la segunda reemplaza a la primera');
  assert.equal(publico.datos.promedio, 3);
  assert.equal(publico.datos.resenas[0].autor, 'kim');
  assert.equal(publico.datos.puede_calificar, false);

  const resenaId = publico.datos.resenas[0].id;
  assert.equal((await api(`/resenas/${resenaId}/oculta`, { metodo: 'PUT', token: kim.token, cuerpo: { oculta: true } })).status, 403);
  await api(`/resenas/${resenaId}/oculta`, { metodo: 'PUT', token: tokenAdmin, cuerpo: { oculta: true } });
  publico = await api(`/resenas/puesto/${puestoId}`);
  assert.equal(publico.datos.total, 0);
  assert.equal(publico.datos.resenas.length, 0);
  const admin = await api(`/resenas/puesto/${puestoId}`, { token: tokenAdmin });
  assert.equal(admin.datos.resenas[0].oculta, true);
});

test('asistencia: el QR marca una vez al día y respeta permisos y fechas', async () => {
  const f = await crearFeria(tokenAdmin, 'Feria asistencia', 1);
  const leo = await crearCuenta('leo');
  const mara = await crearCuenta('mara', 'admin_feria');
  const id = await solicitarYAsignar(leo.token, f.puestos[0].id, f.id);
  const credencial = await api(`/credenciales/${id}`, { token: leo.token });
  const qr = credencial.datos.url;
  const escanear = (token, codigo) => api('/asistencia/qr', { metodo: 'POST', token, cuerpo: { codigo } });

  assert.equal((await escanear(leo.token, qr)).status, 403, 'un comerciante no puede pasar asistencia');
  assert.equal((await escanear(mara.token, qr)).status, 403, 'otro Administrador de Feria tampoco');
  assert.equal((await escanear(tokenAdmin, `${id}-00000000000000000000`)).status, 404, 'no acepta códigos inventados');
  assert.equal((await escanear(tokenAdmin, qr)).status, 409, 'la feria todavía no empieza');

  await pool.query('UPDATE feria SET fecha_inicio = CURDATE(), fecha_cierre = CURDATE() + INTERVAL 1 DAY WHERE id = ?', [f.id]);
  const primero = await escanear(tokenAdmin, qr);
  assert.equal(primero.status, 201);
  assert.equal(primero.datos.ya_registrada, false);
  assert.equal(primero.datos.pagado, false);
  assert.equal((await escanear(tokenAdmin, credencial.datos.codigo)).datos.ya_registrada, true, 'el código escrito a mano también sirve');

  let lista = await api(`/asistencia?feria_id=${f.id}`, { token: tokenAdmin });
  assert.equal(lista.datos.presentes, 1);
  assert.equal(lista.datos.puestos[0].metodo, 'qr');

  await api(`/asistencia/${id}`, { metodo: 'DELETE', token: tokenAdmin });
  await api('/asistencia/manual', { metodo: 'POST', token: tokenAdmin, cuerpo: { solicitud_id: id } });
  lista = await api(`/asistencia?feria_id=${f.id}`, { token: tokenAdmin });
  assert.equal(lista.datos.puestos[0].metodo, 'manual');
});

test('reportes: Excel y PDF válidos, cada uno con sus ferias', async () => {
  const ExcelJS = require('exceljs');
  const descargar = (ruta, token) => fetch(`${baseUrl}/reportes/${ruta}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

  assert.equal((await descargar('completo.xlsx')).status, 401);
  assert.equal((await descargar('completo.pdf', cuentas.ana.token)).status, 403);

  const pdf = Buffer.from(await (await descargar('completo.pdf', tokenAdmin)).arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');

  const leerExcel = async (token) => {
    const respuesta = await descargar('completo.xlsx', token);
    assert.equal(respuesta.status, 200);
    assert.match(respuesta.headers.get('content-disposition'), /reporte-feriaplace\.xlsx/);
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(Buffer.from(await respuesta.arrayBuffer()));
    return libro;
  };
  const libro = await leerExcel(tokenAdmin);
  assert.deepEqual(libro.worksheets.map((h) => h.name), ['Ocupación', 'Pagos', 'Asistencia']);
  const textoFerias = (l) => l.getWorksheet('Ocupación').getColumn(1).values.join('|');
  assert.match(textoFerias(libro), /Feria asistencia/);
  assert.ok(libro.getWorksheet('Asistencia').rowCount >= 2, 'incluye la asistencia registrada');

  const deCarla = await leerExcel(cuentas.carla.token);
  assert.match(textoFerias(deCarla), /Feria de Carla/);
  assert.doesNotMatch(textoFerias(deCarla), /Feria asistencia/, 'un Administrador de Feria solo ve sus ferias');
});

module.exports = { crearCuenta, solicitarYAsignar, crearFeria };
