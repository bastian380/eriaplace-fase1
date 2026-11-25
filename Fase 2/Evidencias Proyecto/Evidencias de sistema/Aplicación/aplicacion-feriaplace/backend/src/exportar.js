// Arma el reporte de gestión en Excel (exceljs) y en PDF (pdfkit). Las dos salidas usan las mismas tablas.
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const pesos = (n) => (n === null || n === undefined ? '' : `$${Number(n).toLocaleString('es-CL')}`);
const fecha = (texto) => (texto ? texto.split('-').reverse().join('-') : '');

// Cada tabla: título, columnas (título, clave, ancho relativo y tipo) y filas
function armarTablas({ ocupacion, pagos, asistencia }) {
  return [
    {
      titulo: 'Ocupación por feria',
      hoja: 'Ocupación',
      columnas: [
        { t: 'Feria', k: 'nombre', a: 26 }, { t: 'Comuna', k: 'comuna', a: 14 },
        { t: 'Inicio', k: 'fecha_inicio', a: 11, tipo: 'fecha' }, { t: 'Cierre', k: 'fecha_cierre', a: 11, tipo: 'fecha' },
        { t: 'Puestos', k: 'puestos_total', a: 8, tipo: 'num' }, { t: 'Ocupados', k: 'puestos_ocupados', a: 9, tipo: 'num' },
        { t: 'Libres', k: 'puestos_libres', a: 7, tipo: 'num' }, { t: '% Ocup.', k: 'porcentaje_ocupacion', a: 8, tipo: 'pct' },
        { t: 'Pendientes', k: 'solicitudes_pendientes', a: 10, tipo: 'num' },
        { t: 'Cobrado', k: 'cobrado', a: 12, tipo: 'pesos' }, { t: 'Por cobrar', k: 'por_cobrar', a: 12, tipo: 'pesos' },
      ],
      filas: ocupacion,
    },
    {
      titulo: 'Pagos de puestos',
      hoja: 'Pagos',
      columnas: [
        { t: 'Feria', k: 'feria', a: 24 }, { t: 'Puesto', k: 'puesto', a: 8 }, { t: 'Comerciante', k: 'comerciante', a: 22 },
        { t: 'Rubro', k: 'rubro', a: 20 }, { t: 'Monto', k: 'monto', a: 12, tipo: 'pesos' }, { t: 'Estado', k: 'estado_pago', a: 11 },
        { t: 'Pagado el', k: 'pagado_en', a: 11, tipo: 'fecha' }, { t: 'Forma', k: 'forma', a: 10 },
      ],
      filas: pagos,
    },
    {
      titulo: 'Asistencia',
      hoja: 'Asistencia',
      columnas: [
        { t: 'Día', k: 'fecha', a: 11, tipo: 'fecha' }, { t: 'Feria', k: 'feria', a: 26 }, { t: 'Puesto', k: 'puesto', a: 8 },
        { t: 'Comerciante', k: 'comerciante', a: 24 }, { t: 'Hora', k: 'hora', a: 7 }, { t: 'Registro', k: 'metodo', a: 9 },
      ],
      filas: asistencia,
    },
  ];
}

const FORMATO_EXCEL = { pesos: '"$"#,##0', num: '0', pct: '0.0' };

async function generarExcel(datos) {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'FeriaPlace';
  for (const tabla of armarTablas(datos)) {
    const hoja = libro.addWorksheet(tabla.hoja);
    hoja.columns = tabla.columnas.map((c) => ({ header: c.t, key: c.k, width: c.a + 2, style: FORMATO_EXCEL[c.tipo] ? { numFmt: FORMATO_EXCEL[c.tipo] } : {} }));
    hoja.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    hoja.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F6F4F' } };
    hoja.views = [{ state: 'frozen', ySplit: 1 }];
    tabla.filas.forEach((f) => {
      const fila = {};
      for (const c of tabla.columnas) fila[c.k] = c.tipo === 'fecha' ? fecha(f[c.k]) : f[c.k] ?? '';
      hoja.addRow(fila);
    });
  }
  return Buffer.from(await libro.xlsx.writeBuffer());
}

function dibujarTabla(doc, tabla) {
  const izquierda = doc.page.margins.left;
  const anchoTotal = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const unidad = anchoTotal / tabla.columnas.reduce((s, c) => s + c.a, 0);
  const alto = 18;
  const limite = doc.page.height - doc.page.margins.bottom - 20;

  const celdas = (y, valores) => {
    let x = izquierda;
    tabla.columnas.forEach((c, i) => {
      doc.text(valores[i], x + 3, y + 5, {
        width: c.a * unidad - 6, height: 10, ellipsis: true, lineBreak: false,
        align: ['num', 'pesos', 'pct'].includes(c.tipo) ? 'right' : 'left',
      });
      x += c.a * unidad;
    });
  };
  const encabezado = (y) => {
    doc.save().rect(izquierda, y, anchoTotal, alto).fill('#1f6f4f').restore();
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
    celdas(y, tabla.columnas.map((c) => c.t));
    doc.fillColor('#111827').font('Helvetica').fontSize(8);
  };

  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(13).text(tabla.titulo, izquierda, doc.y, { lineBreak: true });
  doc.moveDown(0.4);
  let y = doc.y;
  if (tabla.filas.length === 0) {
    doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text('Sin datos.', izquierda, y);
    doc.moveDown(1.5);
    return;
  }
  encabezado(y);
  y += alto;
  tabla.filas.forEach((f, i) => {
    if (y + alto > limite) {
      doc.addPage();
      y = doc.page.margins.top;
      encabezado(y);
      y += alto;
    }
    if (i % 2 === 1) doc.save().rect(izquierda, y, anchoTotal, alto).fill('#f3f4f6').restore();
    doc.fillColor('#111827').font('Helvetica').fontSize(8);
    celdas(y, tabla.columnas.map((c) => {
      const v = f[c.k];
      if (c.tipo === 'pesos') return pesos(v);
      if (c.tipo === 'fecha') return fecha(v);
      if (c.tipo === 'pct') return `${String(v).replace('.', ',')} %`;
      return v === null || v === undefined ? '' : String(v);
    }));
    y += alto;
  });
  doc.y = y + 18;
  doc.x = izquierda;
}

function generarPdf(datos, autor) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, info: { Title: 'Reporte FeriaPlace', Author: 'FeriaPlace' } });
    const partes = [];
    doc.on('data', (p) => partes.push(p));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(18).fillColor('#1f6f4f').text('FeriaPlace · Reporte de gestión');
    doc.font('Helvetica').fontSize(9).fillColor('#6b7280')
      .text(`Generado el ${new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })} por ${autor}`);
    doc.moveDown(1);
    for (const tabla of armarTablas(datos)) {
      if (doc.y + 80 > doc.page.height - doc.page.margins.bottom) doc.addPage();
      dibujarTabla(doc, tabla);
    }
    doc.end();
  });
}

module.exports = { generarExcel, generarPdf };
