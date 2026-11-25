// Pruebas del modelo de negocio con Administrador de Feria, usando el caso de las ferias navideñas del informe:
//  - el organizador de una feria navideña se registra como Administrador de Feria y la plataforma lo aprueba;
//  - crea su feria, que queda en borrador hasta pagar a la plataforma la publicación de sus puestos (puestos x tarifa);
//  - la plataforma registra el pago y la feria se publica sola;
//  - el Administrador de Feria asigna los puestos y registra los pagos de los comerciantes, solo en sus ferias.
// Uso: dentro de backend/, `npm test` (necesita MySQL y la base feriaplace_test; ver README).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { prepararBase, levantarServidor, ADMIN } = require('./preparar');

let api;
let cerrar;
let tokenAdmin;
const penalolen = { cuenta: null, feria: null };
const maipu = { cuenta: null, feria: null };
let comerciante;
let solicitudId;

const TARIFA = 5000;

async function registrarYAprobar(datos) {
  const registro = await api('/auth/registro', { metodo: 'POST', cuerpo: datos });
  assert.equal(registro.status, 201, JSON.stringify(registro.datos));
  const aprobado = await api(`/usuarios/${registro.datos.id}/aprobar`, { metodo: 'PUT', cuerpo: {}, token: tokenAdmin });
  assert.equal(aprobado.status, 200);
  const login = await api('/auth/login', { metodo: 'POST', cuerpo: datos });
  assert.equal(login.status, 200);
  return { ...datos, id: registro.datos.id, token: login.datos.token, rol: login.datos.usuario.rol };
}

const avisos = async (token) => (await api('/notificaciones', { token })).datos.avisos;

before(async () => {
  await prepararBase();
  ({ api, cerrar } = await levantarServidor());
  tokenAdmin = (await api('/auth/login', { metodo: 'POST', cuerpo: ADMIN })).datos.token;
});

after(async () => {
  await cerrar();
});

test('el Administrador de Feria se registra con su organización y queda pendiente hasta que la plataforma lo aprueba', async () => {
  const datos = {
    nombre: 'Carla Soto', email: 'carla@navidad-penalolen.cl', password: 'ClaveCarla2026', tipo_cuenta: 'admin_feria',
    motivo_registro: 'Organizo la Feria Navideña de Peñalolén y quiero publicar sus 12 puestos.',
  };
  const sinOrganizacion = await api('/auth/registro', { metodo: 'POST', cuerpo: datos });
  assert.equal(sinOrganizacion.status, 400);
  const rolInventado = await api('/auth/registro', { metodo: 'POST', cuerpo: { ...datos, tipo_cuenta: 'administrador', organizacion: 'X' } });
  assert.equal(rolInventado.status, 400, 'nadie puede registrarse como administrador de la plataforma');

  const registro = await api('/auth/registro', { metodo: 'POST', cuerpo: { ...datos, organizacion: 'Feria Navideña de Peñalolén' } });
  assert.equal(registro.status, 201);
  assert.equal(registro.datos.rol, 'admin_feria');
  assert.equal(registro.datos.estado, 'pendiente');
  const antes = await api('/auth/login', { metodo: 'POST', cuerpo: datos });
  assert.equal(antes.status, 403);

  const pendientes = await api('/usuarios?estado=pendiente&rol=admin_feria', { token: tokenAdmin });
  const carla = pendientes.datos.find((u) => u.email === datos.email);
  assert.equal(carla.organizacion, 'Feria Navideña de Peñalolén');
  await api(`/usuarios/${carla.id}/aprobar`, { metodo: 'PUT', cuerpo: {}, token: tokenAdmin });
  const login = await api('/auth/login', { metodo: 'POST', cuerpo: datos });
  assert.equal(login.status, 200);
  assert.equal(login.datos.usuario.rol, 'admin_feria');
  penalolen.cuenta = { ...datos, id: carla.id, token: login.datos.token };

  maipu.cuenta = await registrarYAprobar({
    nombre: 'Pedro Rojas', email: 'pedro@navidad-maipu.cl', password: 'ClavePedro2026', tipo_cuenta: 'admin_feria',
    organizacion: 'Feria Navideña Plaza de Maipú', motivo_registro: 'Organizo la feria navideña de la Plaza de Maipú.',
  });
  comerciante = await registrarYAprobar({
    nombre: 'Juana Pérez', email: 'juana@prueba.cl', password: 'ClaveJuana2026',
    motivo_registro: 'Vendo adornos navideños hechos a mano.',
  });
  assert.equal(comerciante.rol, 'comerciante');
});

test('la plataforma fija la tarifa por puesto y solo ella puede cambiarla', async () => {
  const intento = await api('/cobros/tarifa', { metodo: 'PUT', cuerpo: { tarifa_puesto: 1 }, token: penalolen.cuenta.token });
  assert.equal(intento.status, 403);
  const r = await api('/cobros/tarifa', { metodo: 'PUT', cuerpo: { tarifa_puesto: '$5.000' }, token: tokenAdmin });
  assert.equal(r.status, 200);
  assert.equal(r.datos.tarifa_puesto, TARIFA);
  const vista = await api('/cobros/tarifa', { token: penalolen.cuenta.token });
  assert.equal(vista.datos.tarifa_puesto, TARIFA);
});

test('la feria del Administrador de Feria nace en borrador y no se publica sin pagar', async () => {
  const creada = await api('/ferias', {
    metodo: 'POST',
    token: penalolen.cuenta.token,
    cuerpo: {
      nombre: 'Feria Navideña de Peñalolén', comuna: 'Peñalolén', ancho: 24, alto: 14, publicada: true,
      fecha_inicio: '2026-12-01', fecha_cierre: '2026-12-24', precio_puesto: '150.000', cantidad_puestos: 12,
    },
  });
  assert.equal(creada.status, 201);
  assert.equal(creada.datos.publicada, false, 'aunque pida publicarla, queda en borrador');
  assert.equal(creada.datos.admin_feria_id, penalolen.cuenta.id);
  penalolen.feria = creada.datos;

  const publicas = await api('/ferias');
  assert.ok(!publicas.datos.some((f) => f.id === penalolen.feria.id), 'no aparece a los visitantes');
  const mias = await api('/ferias?todas=1', { token: penalolen.cuenta.token });
  assert.deepEqual(mias.datos.map((f) => f.id), [penalolen.feria.id]);

  const publicar = await api(`/ferias/${penalolen.feria.id}`, {
    metodo: 'PUT', token: penalolen.cuenta.token, cuerpo: { ...creada.datos, publicada: true },
  });
  assert.equal(publicar.status, 402);
  assert.match(publicar.datos.error, /faltan pagar 12 de 12 puestos/);

  const pedir = await api('/solicitudes', {
    metodo: 'POST', token: comerciante.token, cuerpo: { feria_id: penalolen.feria.id, rubro: 'Adornos' },
  });
  assert.equal(pedir.status, 400, 'un comerciante no puede pedir puesto en una feria sin publicar');
});

test('pedir la publicación genera un cobro de puestos x tarifa y avisa a la plataforma', async () => {
  const r = await api(`/ferias/${penalolen.feria.id}/publicacion`, { metodo: 'POST', cuerpo: {}, token: penalolen.cuenta.token });
  assert.equal(r.status, 201);
  assert.equal(r.datos.cobro.puestos, 12);
  assert.equal(r.datos.cobro.monto, 12 * TARIFA);
  penalolen.cobro = r.datos.cobro;

  const repetido = await api(`/ferias/${penalolen.feria.id}/publicacion`, { metodo: 'POST', cuerpo: {}, token: penalolen.cuenta.token });
  assert.equal(repetido.status, 409);

  const deLaPlataforma = await avisos(tokenAdmin);
  assert.match(deLaPlataforma[0].titulo, /Cobro nuevo: "Feria Navideña de Peñalolén"/);

  const lista = await api('/cobros', { token: penalolen.cuenta.token });
  assert.equal(lista.datos.cobros.length, 1);
  assert.equal(lista.datos.resumen.por_cobrar, 60000);
});

test('solo la plataforma registra el pago, y al pagarse la feria se publica sola', async () => {
  const intento = await api(`/cobros/${penalolen.cobro.id}/pago`, {
    metodo: 'PUT', cuerpo: { estado: 'pagado' }, token: penalolen.cuenta.token,
  });
  assert.equal(intento.status, 403);

  const pago = await api(`/cobros/${penalolen.cobro.id}/pago`, { metodo: 'PUT', cuerpo: { estado: 'pagado' }, token: tokenAdmin });
  assert.equal(pago.status, 200);
  assert.equal(pago.datos.estado, 'pagado');
  assert.equal(pago.datos.feria_publicada, true);

  const publicas = await api('/ferias');
  const f = publicas.datos.find((x) => x.id === penalolen.feria.id);
  assert.ok(f, 'ya la ven los visitantes');
  assert.equal(f.puestos_pagados, 12);
  assert.match((await avisos(penalolen.cuenta.token))[0].titulo, /ya está publicada/);

  const resumen = await api('/cobros', { token: tokenAdmin });
  assert.equal(resumen.datos.resumen.cobrado, 60000);
  assert.equal(resumen.datos.resumen.por_cobrar, 0);
});

test('un Administrador de Feria no puede tocar la feria de otro (403)', async () => {
  const creada = await api('/ferias', {
    metodo: 'POST',
    token: maipu.cuenta.token,
    cuerpo: { nombre: 'Feria Navideña Plaza de Maipú', comuna: 'Maipú', ancho: 24, alto: 14, cantidad_puestos: 8 },
  });
  assert.equal(creada.status, 201);
  maipu.feria = creada.datos;

  const token = maipu.cuenta.token;
  const id = penalolen.feria.id;
  const detalle = (await api(`/ferias/${id}`)).datos;
  const intentos = [
    api(`/ferias/${id}`, { metodo: 'PUT', cuerpo: { ...detalle, nombre: 'Robada' }, token }),
    api(`/ferias/${id}/plano`, { metodo: 'PUT', cuerpo: { puestos: [] }, token }),
    api(`/ferias/${id}`, { metodo: 'DELETE', token }),
    api(`/ferias/${id}/publicacion`, { metodo: 'POST', cuerpo: {}, token }),
  ];
  for (const r of await Promise.all(intentos)) assert.equal(r.status, 403);
  const sigue = (await api(`/ferias/${id}`)).datos;
  assert.equal(sigue.nombre, 'Feria Navideña de Peñalolén');
  assert.equal(sigue.total_puestos, 12);

  const suyas = await api('/ferias?todas=1', { token });
  assert.deepEqual(suyas.datos.map((f) => f.id), [maipu.feria.id]);
  const cobros = await api('/cobros', { token });
  assert.equal(cobros.datos.cobros.length, 0, 'no ve los cobros de otro');
});

test('el Administrador de Feria recibe la solicitud, asigna el puesto y registra el pago del comerciante', async () => {
  const puesto = (await api(`/ferias/${penalolen.feria.id}`)).datos.puestos[0];
  const s = await api('/solicitudes', {
    metodo: 'POST', token: comerciante.token,
    cuerpo: { feria_id: penalolen.feria.id, rubro: 'Adornos navideños', puesto_preferido_id: puesto.id },
  });
  assert.equal(s.status, 201);
  solicitudId = s.datos.id;
  assert.match((await avisos(penalolen.cuenta.token))[0].titulo, /Nueva solicitud en "Feria Navideña de Peñalolén"/);

  const deMaipu = await api('/solicitudes', { token: maipu.cuenta.token });
  assert.equal(deMaipu.datos.length, 0, 'el otro Administrador de Feria no ve la solicitud');
  const libresMaipu = await api('/puestos/disponibles', { token: maipu.cuenta.token });
  assert.ok(libresMaipu.datos.every((p) => p.feria_id === maipu.feria.id));
  const robo = await api(`/solicitudes/${solicitudId}/asignar`, { metodo: 'PUT', cuerpo: { puesto_id: puesto.id }, token: maipu.cuenta.token });
  assert.equal(robo.status, 403);

  const pendientes = await api('/solicitudes?estado=pendiente', { token: penalolen.cuenta.token });
  assert.deepEqual(pendientes.datos.map((x) => x.id), [solicitudId]);
  const asignar = await api(`/solicitudes/${solicitudId}/asignar`, {
    metodo: 'PUT', cuerpo: { puesto_id: puesto.id }, token: penalolen.cuenta.token,
  });
  assert.equal(asignar.status, 200);
  assert.equal(asignar.datos.monto, 150000);

  const pagoAjeno = await api(`/solicitudes/${solicitudId}/pago`, { metodo: 'PUT', cuerpo: { estado_pago: 'pagado' }, token: maipu.cuenta.token });
  assert.equal(pagoAjeno.status, 403);
  const pago = await api(`/solicitudes/${solicitudId}/pago`, { metodo: 'PUT', cuerpo: { estado_pago: 'pagado' }, token: penalolen.cuenta.token });
  assert.equal(pago.status, 200);

  const credencial = await api(`/credenciales/${solicitudId}`, { token: penalolen.cuenta.token });
  assert.equal(credencial.status, 200);
  assert.equal((await api(`/credenciales/${solicitudId}`, { token: maipu.cuenta.token })).status, 404);
});

test('el reporte de ocupación del Administrador de Feria muestra solo sus ferias', async () => {
  const suyo = await api('/reportes/ocupacion', { token: penalolen.cuenta.token });
  assert.equal(suyo.status, 200);
  assert.deepEqual(suyo.datos.map((f) => f.nombre), ['Feria Navideña de Peñalolén']);
  assert.equal(suyo.datos[0].puestos_ocupados, 1);
  assert.equal(suyo.datos[0].cobrado, 150000);
  const plataforma = await api('/reportes/ocupacion', { token: tokenAdmin });
  assert.equal(plataforma.datos.length, 2);
});

test('si agrega puestos a una feria publicada, vuelve a borrador y paga solo los nuevos', async () => {
  const detalle = (await api(`/ferias/${penalolen.feria.id}`)).datos;
  const puestos = [...detalle.puestos, { codigo: 'A13', zona: 'General', tamano: 'pequeno', pos_x: 0, pos_y: 12, ancho: 2, alto: 2 }];
  const guardado = await api(`/ferias/${penalolen.feria.id}/plano`, { metodo: 'PUT', cuerpo: { puestos }, token: penalolen.cuenta.token });
  assert.equal(guardado.status, 200, JSON.stringify(guardado.datos));
  assert.equal(guardado.datos.despublicada, true);
  assert.equal(guardado.datos.puestos_por_pagar, 1);

  const cobro = await api(`/ferias/${penalolen.feria.id}/publicacion`, { metodo: 'POST', cuerpo: {}, token: penalolen.cuenta.token });
  assert.equal(cobro.status, 201);
  assert.equal(cobro.datos.cobro.puestos, 1);
  assert.equal(cobro.datos.cobro.monto, TARIFA);
  const pago = await api(`/cobros/${cobro.datos.cobro.id}/pago`, { metodo: 'PUT', cuerpo: { estado: 'pagado' }, token: tokenAdmin });
  assert.equal(pago.datos.feria_publicada, true);
});

test('un comerciante no puede usar las acciones de la plataforma ni del Administrador de Feria (403)', async () => {
  const { token } = comerciante;
  const intentos = [
    api('/cobros', { token }),
    api('/ferias', { metodo: 'POST', cuerpo: { nombre: 'X', ancho: 24, alto: 14 }, token }),
    api(`/ferias/${penalolen.feria.id}/publicacion`, { metodo: 'POST', cuerpo: {}, token }),
    api(`/ferias/${penalolen.feria.id}/administrador`, { metodo: 'PUT', cuerpo: { admin_feria_id: comerciante.id }, token }),
  ];
  for (const r of await Promise.all(intentos)) assert.equal(r.status, 403);
  const usuarios = await api('/usuarios', { token: penalolen.cuenta.token });
  assert.equal(usuarios.status, 403, 'aprobar cuentas sigue siendo solo de la plataforma');
});

test('la plataforma puede entregar una feria suya a un Administrador de Feria', async () => {
  const propia = await api('/ferias', {
    metodo: 'POST', token: tokenAdmin, cuerpo: { nombre: 'Feria de la plataforma', ancho: 24, alto: 14, cantidad_puestos: 2 },
  });
  assert.equal(propia.datos.publicada, true, 'las ferias de la plataforma no pagan publicación');
  assert.equal(propia.datos.admin_feria_id, null);

  const aComerciante = await api(`/ferias/${propia.datos.id}/administrador`, {
    metodo: 'PUT', cuerpo: { admin_feria_id: comerciante.id }, token: tokenAdmin,
  });
  assert.equal(aComerciante.status, 400, 'solo se entrega a un Administrador de Feria aprobado');
  const entregada = await api(`/ferias/${propia.datos.id}/administrador`, {
    metodo: 'PUT', cuerpo: { admin_feria_id: maipu.cuenta.id }, token: tokenAdmin,
  });
  assert.equal(entregada.status, 200);
  const suyas = await api('/ferias?todas=1', { token: maipu.cuenta.token });
  assert.ok(suyas.datos.some((f) => f.id === propia.datos.id));
});
