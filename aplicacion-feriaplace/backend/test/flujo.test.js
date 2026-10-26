// Pruebas automáticas del caso de uso principal de FeriaPlace:
// registro -> aprobación -> feria con puestos -> solicitud -> asignación -> pago -> reporte de ocupación.
// Uso: dentro de backend/, `npm test` (necesita MySQL y la base feriaplace_test; ver README).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { prepararBase, levantarServidor, ADMIN } = require('./preparar');

let api;
let cerrar;
let tokenAdmin;
let tokenComerciante;
let feria;
let puestos;
let solicitudId;

const COMERCIANTE = {
  nombre: 'Juana Pérez', email: 'juana@prueba.cl', password: 'ClaveJuana2026',
  motivo_registro: 'Vendo verduras de mi huerta y busco un puesto para diciembre.',
};

before(async () => {
  await prepararBase();
  ({ api, cerrar } = await levantarServidor());
  const login = await api('/auth/login', { metodo: 'POST', cuerpo: ADMIN });
  tokenAdmin = login.datos.token;
});

after(async () => {
  await cerrar();
});

test('el registro valida los datos y deja la cuenta pendiente', async () => {
  const corta = await api('/auth/registro', { metodo: 'POST', cuerpo: { ...COMERCIANTE, password: '123' } });
  assert.equal(corta.status, 400);

  const ok = await api('/auth/registro', { metodo: 'POST', cuerpo: COMERCIANTE });
  assert.equal(ok.status, 201);
  assert.equal(ok.datos.estado, 'pendiente');

  const repetido = await api('/auth/registro', { metodo: 'POST', cuerpo: COMERCIANTE });
  assert.equal(repetido.status, 409);
});

test('una cuenta pendiente no puede iniciar sesión hasta que el administrador la aprueba', async () => {
  const antes = await api('/auth/login', { metodo: 'POST', cuerpo: COMERCIANTE });
  assert.equal(antes.status, 403);

  const pendientes = await api('/usuarios?estado=pendiente', { token: tokenAdmin });
  const juana = pendientes.datos.find((u) => u.email === COMERCIANTE.email);
  assert.ok(juana, 'la cuenta nueva aparece en la lista de pendientes');
  const aprobar = await api(`/usuarios/${juana.id}/aprobar`, { metodo: 'PUT', cuerpo: {}, token: tokenAdmin });
  assert.equal(aprobar.status, 200);

  const despues = await api('/auth/login', { metodo: 'POST', cuerpo: COMERCIANTE });
  assert.equal(despues.status, 200);
  assert.equal(despues.datos.usuario.rol, 'comerciante');
  tokenComerciante = despues.datos.token;
});

test('el administrador crea una feria y sus puestos se generan solos', async () => {
  const sinPermiso = await api('/ferias', {
    metodo: 'POST', cuerpo: { nombre: 'X', ancho: 24, alto: 14 }, token: tokenComerciante,
  });
  assert.equal(sinPermiso.status, 403);

  const creada = await api('/ferias', {
    metodo: 'POST',
    token: tokenAdmin,
    cuerpo: {
      nombre: 'Feria Navideña de prueba', comuna: 'Maipú', ancho: 24, alto: 14,
      fecha_inicio: '2026-12-01', fecha_cierre: '2026-12-24', precio_puesto: '150.000', cantidad_puestos: 4,
    },
  });
  assert.equal(creada.status, 201);
  assert.equal(creada.datos.total_puestos, 4);
  assert.equal(creada.datos.precio_puesto, 150000);
  feria = creada.datos;

  const detalle = await api(`/ferias/${feria.id}`);
  assert.equal(detalle.status, 200);
  puestos = detalle.datos.puestos;
  assert.equal(puestos.length, 4);
  assert.ok(puestos.every((p) => p.estado === 'disponible'));
});

test('la feria guarda el perímetro de su terreno y lo valida', async () => {
  // Un rectángulo de unas dos cuadras en Maipú
  const perimetro = [[-33.5100, -70.7580], [-33.5100, -70.7560], [-33.5115, -70.7560], [-33.5115, -70.7580]];
  const datos = {
    nombre: feria.nombre, ancho: 24, alto: 14, fecha_inicio: '2026-12-01', fecha_cierre: '2026-12-24',
    precio_puesto: 150000, perimetro,
  };
  const pocos = await api(`/ferias/${feria.id}`, { metodo: 'PUT', token: tokenAdmin, cuerpo: { ...datos, perimetro: perimetro.slice(0, 2) } });
  assert.equal(pocos.status, 400);
  const afuera = await api(`/ferias/${feria.id}`, { metodo: 'PUT', token: tokenAdmin, cuerpo: { ...datos, perimetro: [...perimetro.slice(0, 3), [-20, -70]] } });
  assert.equal(afuera.status, 400);

  const ok = await api(`/ferias/${feria.id}`, { metodo: 'PUT', token: tokenAdmin, cuerpo: datos });
  assert.equal(ok.status, 200);
  const guardada = (await api(`/ferias/${feria.id}`)).datos;
  assert.deepEqual(guardada.perimetro, perimetro);
  // Sin punto marcado, la ubicación queda en el centro del terreno
  assert.equal(guardada.latitud, -33.51075);
  assert.equal(guardada.longitud, -70.757);
  assert.equal(guardada.comuna, 'Maipú');

  // Si al editar no se manda el perímetro, se conserva
  const { perimetro: _, ...sinPerimetro } = datos;
  await api(`/ferias/${feria.id}`, { metodo: 'PUT', token: tokenAdmin, cuerpo: { ...sinPerimetro, latitud: guardada.latitud, longitud: guardada.longitud } });
  assert.deepEqual((await api(`/ferias/${feria.id}`)).datos.perimetro, perimetro);
});

test('el comerciante solicita un puesto y el administrador se lo asigna con su monto', async () => {
  const solicitud = await api('/solicitudes', {
    metodo: 'POST',
    token: tokenComerciante,
    cuerpo: { feria_id: feria.id, puesto_preferido_id: puestos[0].id, rubro: 'Verduras', tamano_preferido: 'mediano' },
  });
  assert.equal(solicitud.status, 201);
  solicitudId = solicitud.datos.id;

  const asignada = await api(`/solicitudes/${solicitudId}/asignar`, {
    metodo: 'PUT', cuerpo: { puesto_id: puestos[0].id }, token: tokenAdmin,
  });
  assert.equal(asignada.status, 200);
  assert.equal(asignada.datos.estado, 'confirmada');
  assert.equal(asignada.datos.monto, 150000);
  assert.equal(asignada.datos.estado_pago, 'pendiente');

  const mias = await api('/solicitudes/mias', { token: tokenComerciante });
  assert.equal(mias.datos[0].puesto_codigo, puestos[0].codigo);
});

test('un puesto ocupado no se puede asignar dos veces', async () => {
  const otra = await api('/solicitudes', {
    metodo: 'POST', token: tokenComerciante, cuerpo: { feria_id: feria.id, rubro: 'Artesanía' },
  });
  const repetida = await api(`/solicitudes/${otra.datos.id}/asignar`, {
    metodo: 'PUT', cuerpo: { puesto_id: puestos[0].id }, token: tokenAdmin,
  });
  assert.equal(repetida.status, 409);

  // Se rechaza para que no cuente en el resto de las pruebas como pendiente
  const rechazada = await api(`/solicitudes/${otra.datos.id}/rechazar`, {
    metodo: 'PUT', cuerpo: { comentario_admin: 'Sin cupo' }, token: tokenAdmin,
  });
  assert.equal(rechazada.status, 200);
});

test('el administrador registra el pago y acepta montos escritos a la chilena', async () => {
  const malo = await api(`/solicitudes/${solicitudId}/pago`, {
    metodo: 'PUT', cuerpo: { estado_pago: 'pagado', monto: 'mil' }, token: tokenAdmin,
  });
  assert.equal(malo.status, 400);

  const pagado = await api(`/solicitudes/${solicitudId}/pago`, {
    metodo: 'PUT', cuerpo: { estado_pago: 'pagado', monto: '$120.000' }, token: tokenAdmin,
  });
  assert.equal(pagado.status, 200);
  assert.equal(pagado.datos.estado_pago, 'pagado');
  assert.equal(pagado.datos.monto, 120000);
});

test('el comerciante recibe avisos de cada paso y puede marcarlos como leídos', async () => {
  const { datos } = await api('/notificaciones', { token: tokenComerciante });
  const titulos = datos.avisos.map((a) => a.titulo);
  assert.ok(titulos.includes('Tu cuenta fue aprobada'));
  assert.ok(titulos.includes(`Te asignamos el puesto ${puestos[0].codigo}`));
  assert.ok(titulos.includes('Tu solicitud de puesto fue rechazada'));
  assert.ok(titulos.includes('Recibimos tu pago'));
  assert.equal(datos.no_leidas, datos.avisos.length);

  await api('/notificaciones/leidas', { metodo: 'PUT', token: tokenComerciante });
  const despues = await api('/notificaciones', { token: tokenComerciante });
  assert.equal(despues.datos.no_leidas, 0);
});

test('la credencial QR del puesto se verifica sin sesión y no se puede falsificar', async () => {
  const credencial = await api(`/credenciales/${solicitudId}`, { token: tokenComerciante });
  assert.equal(credencial.status, 200);
  assert.match(credencial.datos.qr, /^<svg/);
  assert.match(credencial.datos.url, /verificar\.html\?c=/);
  const { codigo } = credencial.datos;

  const verificada = await api(`/credenciales/verificar/${codigo}`);
  assert.equal(verificada.status, 200);
  assert.equal(verificada.datos.valida, true);
  assert.equal(verificada.datos.pagado, true);
  assert.equal(verificada.datos.titular, COMERCIANTE.nombre);
  assert.equal(verificada.datos.puesto, puestos[0].codigo);

  // Cambiar el número de la solicitud sin la firma correcta no sirve
  const falsa = codigo.replace(/^\d+/, String(solicitudId + 1));
  assert.equal((await api(`/credenciales/verificar/${falsa}`)).status, 404);
  assert.equal((await api('/credenciales/verificar/cualquier-cosa')).status, 404);
});

test('el reporte de ocupación calcula puestos, porcentaje y cobros', async () => {
  const sinPermiso = await api('/reportes/ocupacion', { token: tokenComerciante });
  assert.equal(sinPermiso.status, 403);

  const reporte = await api('/reportes/ocupacion', { token: tokenAdmin });
  assert.equal(reporte.status, 200);
  const fila = reporte.datos.find((f) => f.id === feria.id);
  assert.deepEqual(
    {
      total: fila.puestos_total, ocupados: fila.puestos_ocupados, libres: fila.puestos_libres,
      porcentaje: fila.porcentaje_ocupacion, rechazadas: fila.solicitudes_rechazadas,
      cobrado: fila.cobrado, porCobrar: fila.por_cobrar,
    },
    { total: 4, ocupados: 1, libres: 3, porcentaje: 25, rechazadas: 1, cobrado: 120000, porCobrar: 0 }
  );
});

test('el reporte también se descarga como CSV para Excel', async () => {
  const csv = await api('/reportes/ocupacion.csv', { token: tokenAdmin });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  const lineas = csv.datos.replace(/^﻿/, '').split('\r\n');
  assert.equal(lineas[0].split(';')[0], 'Feria');
  assert.match(lineas[1], /^Feria Navideña de prueba;Maipú;2026-12-01;2026-12-24;4;1;3;25;/);
});

test('se bloquea el inicio de sesión después de 5 intentos fallidos', async () => {
  const cuerpo = { email: COMERCIANTE.email, password: 'incorrecta' };
  for (let i = 0; i < 5; i += 1) {
    const r = await api('/auth/login', { metodo: 'POST', cuerpo });
    assert.equal(r.status, 401);
  }
  const bloqueado = await api('/auth/login', { metodo: 'POST', cuerpo });
  assert.equal(bloqueado.status, 429);
  // Bloqueado incluso con la clave correcta, hasta que pase el tiempo
  const correcta = await api('/auth/login', { metodo: 'POST', cuerpo: COMERCIANTE });
  assert.equal(correcta.status, 429);
});

test('cada usuario puede cambiar su contraseña', async () => {
  const mala = await api('/auth/password', {
    metodo: 'PUT', cuerpo: { actual: 'otra', nueva: 'NuevaClave2026' }, token: tokenAdmin,
  });
  assert.equal(mala.status, 400);

  const ejemplo = await api('/auth/password', {
    metodo: 'PUT', cuerpo: { actual: ADMIN.password, nueva: 'Admin123!' }, token: tokenAdmin,
  });
  assert.equal(ejemplo.status, 400);

  const ok = await api('/auth/password', {
    metodo: 'PUT', cuerpo: { actual: ADMIN.password, nueva: 'NuevaClave2026' }, token: tokenAdmin,
  });
  assert.equal(ok.status, 200);
  const login = await api('/auth/login', { metodo: 'POST', cuerpo: { email: ADMIN.email, password: 'NuevaClave2026' } });
  assert.equal(login.status, 200);
});
