// Asistencia con QR: lee la credencial con la cámara (librería jsQR incluida en el proyecto) o por código.
(async () => {
  const sesion = requerirSesion(ROLES_GESTION);
  if (!sesion) return;
  const $ = (id) => document.getElementById(id);
  const hoy = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  let datos = null;

  function mostrarResultado(tipo, titulo, detalle) {
    $('resultado').innerHTML = `<div class="verificacion ${tipo}"><strong>${esc(titulo)}</strong>${detalle ? `<span>${esc(detalle)}</span>` : ''}</div>`;
  }

  async function cargar() {
    if (!$('feria').value) return;
    datos = await apiFetch(`/asistencia?feria_id=${$('feria').value}&fecha=${$('fecha').value}`);
    $('titulo-lista').textContent = `Puestos del ${new Date(`${datos.fecha}T12:00:00`).toLocaleDateString('es-CL', { dateStyle: 'long' })}`;
    $('resumen').innerHTML = `
      <div>Llegaron<strong>${datos.presentes} de ${datos.total}</strong></div>
      <div>Faltan<strong>${datos.total - datos.presentes}</strong></div>`;
    $('tabla-asistencia').innerHTML = datos.puestos.length === 0
      ? '<tr><td colspan="6">Esta feria todavía no tiene puestos asignados.</td></tr>'
      : datos.puestos.map((p) => `
        <tr data-id="${p.solicitud_id}">
          <td>${esc(p.puesto)}</td>
          <td>${esc(p.titular)}</td>
          <td>${esc(p.rubro)}</td>
          <td><span class="badge ${p.pagado ? 'pagado' : 'pendiente'}">${p.pagado ? 'pagado' : 'pendiente'}</span></td>
          <td>${p.presente ? `<span class="badge confirmada">llegó ${esc(p.hora)}</span><br><small>${p.metodo === 'qr' ? 'con QR' : 'a mano'}</small>` : '<span class="badge sin-pago">sin registrar</span>'}</td>
          <td>${!datos.es_hoy ? '-' : (p.presente
    ? '<button type="button" class="btn-quitar secundario sin-margen boton-chico" style="margin-left:0">Quitar</button>'
    : '<button type="button" class="btn-marcar sin-margen boton-chico" style="margin-left:0">Marcar</button>')}</td>
        </tr>`).join('');
    $('tabla-asistencia').querySelectorAll('.btn-marcar').forEach((b) => b.addEventListener('click', () => {
      registrar('/asistencia/manual', { solicitud_id: Number(b.closest('tr').dataset.id) });
    }));
    $('tabla-asistencia').querySelectorAll('.btn-quitar').forEach((b) => b.addEventListener('click', async () => {
      try {
        await apiFetch(`/asistencia/${b.closest('tr').dataset.id}`, { method: 'DELETE' });
        await cargar();
      } catch (err) {
        mostrarResultado('alerta', 'No se pudo corregir', err.message);
      }
    }));
  }

  async function registrar(ruta, cuerpo) {
    try {
      const r = await apiFetch(ruta, { method: 'POST', body: JSON.stringify(cuerpo) });
      const detalle = `${r.titular} · Puesto ${r.puesto} · ${r.feria}`;
      if (r.ya_registrada) mostrarResultado('alerta', 'Ya estaba registrado hoy', detalle);
      else if (r.pagado) mostrarResultado('ok', 'Asistencia registrada', detalle);
      else mostrarResultado('alerta', 'Asistencia registrada, pero tiene el pago pendiente', detalle);
      await cargar();
    } catch (err) {
      mostrarResultado('alerta', 'No se registró', err.message);
    }
  }

  // ---------- Cámara ----------
  let flujo = null;
  let ultimoCodigo = '';
  let ultimoMomento = 0;

  function apagarCamara() {
    if (flujo) flujo.getTracks().forEach((t) => t.stop());
    flujo = null;
    $('caja-camara').classList.add('oculto');
    $('btn-camara').textContent = 'Abrir cámara';
  }

  function leerCuadro() {
    if (!flujo) return;
    const video = $('video');
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const lienzo = $('lienzo');
      lienzo.width = video.videoWidth;
      lienzo.height = video.videoHeight;
      const ctx = lienzo.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0);
      const qr = jsQR(ctx.getImageData(0, 0, lienzo.width, lienzo.height).data, lienzo.width, lienzo.height, { inversionAttempts: 'dontInvert' });
      // El mismo código no se vuelve a enviar por 4 segundos, aunque siga frente a la cámara
      if (qr && qr.data && (qr.data !== ultimoCodigo || Date.now() - ultimoMomento > 4000)) {
        ultimoCodigo = qr.data;
        ultimoMomento = Date.now();
        registrar('/asistencia/qr', { codigo: qr.data });
      }
    }
    requestAnimationFrame(leerCuadro);
  }

  $('btn-camara').addEventListener('click', async () => {
    if (flujo) {
      apagarCamara();
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      mostrarResultado('alerta', 'Este navegador no permite usar la cámara aquí', 'La cámara funciona en http://localhost o en una dirección https. Puedes pegar el código abajo.');
      return;
    }
    try {
      flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch (err) {
      mostrarResultado('alerta', 'No se pudo abrir la cámara', 'Revisa el permiso de cámara del navegador. También puedes pegar el código abajo.');
      return;
    }
    $('video').srcObject = flujo;
    await $('video').play();
    $('caja-camara').classList.remove('oculto');
    $('btn-camara').textContent = 'Cerrar cámara';
    requestAnimationFrame(leerCuadro);
  });

  $('form-codigo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const codigo = $('codigo').value.trim();
    if (!codigo) return;
    await registrar('/asistencia/qr', { codigo });
    $('codigo').value = '';
  });

  // ---------- Inicio ----------
  $('fecha').value = hoy();
  try {
    const ferias = await apiFetch('/ferias?todas=1');
    if (ferias.length === 0) {
      mostrarResultado('alerta', 'Todavía no tienes ferias');
      return;
    }
    $('feria').innerHTML = ferias.map((f) => `<option value="${f.id}">${esc(f.nombre)}</option>`).join('');
    const ver = () => cargar().catch((err) => mostrarResultado('alerta', 'Error', err.message));
    $('feria').addEventListener('change', ver);
    $('fecha').addEventListener('change', ver);
    await cargar();
  } catch (err) {
    mostrarResultado('alerta', 'Error', err.message);
  }
})();
