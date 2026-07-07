import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const AZUL = [44, 102, 147];
const VERDE = [14, 125, 109];
const OSCURO = [59, 74, 95];
const GRIS = [107, 110, 120];

function cabecera(doc, titulo, subtitulo, color, extraDer) {
  doc.setFontSize(19);
  doc.setTextColor(...color);
  doc.setFont(undefined, "bold");
  doc.text(titulo, 14, 20);
  if (extraDer) {
    doc.setFontSize(11);
    doc.text(extraDer, 196, 20, { align: "right" });
  }
  doc.setFontSize(10);
  doc.setTextColor(...GRIS);
  doc.setFont(undefined, "italic");
  doc.text(subtitulo, 14, 27);
  doc.setDrawColor(...color);
  doc.setLineWidth(1);
  doc.line(14, 31, 196, 31);
  doc.setFont(undefined, "normal");
}

function cajas(doc, y, izq, der, color) {
  const alto = 10 + Math.max(izq.lineas.length, der.lineas.length) * 7 + 4;
  const caja = (x, c) => {
    doc.setFillColor(246, 248, 250);
    doc.setDrawColor(218, 223, 230);
    doc.roundedRect(x, y, 88, alto, 2, 2, "FD");
    doc.setFontSize(10);
    doc.setTextColor(...color);
    doc.setFont(undefined, "bold");
    doc.text(c.titulo, x + 4, y + 7);
    doc.setDrawColor(200, 206, 214);
    doc.line(x + 4, y + 9.5, x + 84, y + 9.5);
    doc.setFontSize(9);
    c.lineas.forEach((l, i) => {
      doc.setTextColor(40, 42, 48);
      doc.setFont(undefined, "bold");
      doc.text(l[0] + ":", x + 4, y + 16 + i * 7);
      doc.setFont(undefined, "normal");
      doc.text(String(l[1] ?? "—"), x + 5 + doc.getTextWidth(l[0] + ": "), y + 16 + i * 7);
    });
  };
  caja(14, izq);
  caja(108, der);
  return y + alto + 8;
}

function seccion(doc, y, titulo, color) {
  doc.setFillColor(...color);
  doc.rect(14, y, 182, 8, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont(undefined, "bold");
  doc.text(titulo.toUpperCase(), 17, y + 5.6);
  doc.setFont(undefined, "normal");
  return y + 9;
}

function tabla(doc, y, head, body, anchos) {
  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    theme: "grid",
    headStyles: { fillColor: OSCURO, textColor: 255, fontSize: 9, fontStyle: "bold" },
    bodyStyles: { fontSize: 9, textColor: [40, 42, 48] },
    columnStyles: anchos || {},
    margin: { left: 14, right: 14 },
  });
  return doc.lastAutoTable.finalY + 8;
}

function parrafo(doc, y, texto) {
  const lineas = doc.splitTextToSize(texto, 172);
  const h = lineas.length * 5 + 9;
  doc.setFillColor(249, 250, 251);
  doc.setDrawColor(222, 226, 232);
  doc.roundedRect(14, y, 182, h, 2, 2, "FD");
  doc.setFontSize(9);
  doc.setTextColor(50, 52, 58);
  doc.text(lineas, 18, y + 7);
  return y + h + 8;
}

function firmas(doc, izq, der) {
  const y = 262;
  doc.setDrawColor(130);
  doc.setLineWidth(0.4);
  doc.line(24, y, 92, y);
  doc.line(118, y, 186, y);
  doc.setFontSize(9);
  doc.setTextColor(60, 65, 75);
  doc.setFont(undefined, "bold");
  doc.text(izq, 58, y + 5, { align: "center" });
  doc.text(der, 152, y + 5, { align: "center" });
  doc.setFont(undefined, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...GRIS);
  doc.text("Página 1 de 1", 196, 288, { align: "right" });
}

/* ============ 1) ORDEN DE PEDIDO ============ */
export function pdfOrden(p) {
  const doc = new jsPDF();
  cabecera(doc, "ORDEN DE PEDIDO DE CONFECCIÓN", "Documento de control y producción textil", AZUL);
  let y = 33;
  if (p.esParcial !== undefined) {
    const color = p.esParcial ? [196, 90, 40] : VERDE;
    doc.setFillColor(...color);
    doc.rect(14, y, 182, 12, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont(undefined, "bold");
    doc.text(p.esParcial ? "ENTREGA PARCIAL" : "ENTREGA TOTAL", 18, y + 8.5);
    doc.setFontSize(11);
    doc.text("Orden N° " + p.numero, 192, y + 8.5, { align: "right" });
    y += 16;
    doc.setFontSize(9.5);
    doc.setTextColor(40, 42, 48);
    doc.setFont(undefined, "normal");
    doc.text(`Cantidad total de la orden: ${p.cantidadOriginal} u.   ·   Entregado ahora: ${p.cantidadEntregada} u.   ·   Falta entregar: ${p.faltanteOrden} u.`, 14, y);
    y += 6;
  }
  y = cajas(
    doc, y,
    {
      titulo: "Datos del Fabricante / Cliente",
      lineas: [["Empresa", p.fabricante || "Mi fábrica"], ["Fecha de emisión", p.fecha], ["Fecha de entrega pactada", p.fechaEntrega || "—"]],
    },
    {
      titulo: p.destino === "corte" ? "Datos del Taller de Corte" : "Datos del Taller de Confección",
      lineas: [["Taller / Responsable", p.taller], ["Nro. de Orden", "#" + p.numero], ["Estado", "Pendiente / En proceso"]],
    },
    AZUL
  );
  y = seccion(doc, y, "Detalle del modelo", AZUL);
  y = tabla(doc, y,
    ["Modelo / Artículo", "Colores", "Medidas", "Total Unidades"],
    [[p.producto, p.colores || "—", p.medida || "—", String(p.cantidad) + " u."]]
  );
  if (p.coloresSpec && p.coloresSpec.length > 0) {
    y = seccion(doc, y, "Desglose de colores y cantidades", AZUL);
    const filas = p.coloresSpec.map((c) => [c.color, String(c.cantidad) + " u."]);
    const total = p.coloresSpec.reduce((s, c) => s + (Number(c.cantidad) || 0), 0);
    filas.push(["TOTAL", total + " u."]);
    y = tabla(doc, y, ["Color", "Cantidad"], filas, { 1: { halign: "right", cellWidth: 40 } });
  }
  if (p.medidasSpec && p.medidasSpec.length > 0) {
    y = seccion(doc, y, "Medidas por pieza", AZUL);
    y = tabla(doc, y, ["Pieza", "Medida"], p.medidasSpec.map((m) => [m.nombre, m.medida]));
  }
  y = seccion(doc, y, "Insumos y materiales entregados al taller", AZUL);
  y = tabla(doc, y, ["Material / Insumo", "Cantidad Entregada", "Detalle / Notas"], p.insumos);
  y = seccion(doc, y, "Especificaciones técnicas y observaciones", AZUL);
  parrafo(doc, y, p.observaciones || "Sin observaciones.");
  firmas(doc, "Firma y aclaración Fabricante", "Firma y conformidad Taller");
  return doc;
}

/* ============ 2) RECIBO DE ENTREGA DE MERCADERÍA ============ */
export function pdfReciboEntrega(p) {
  const doc = new jsPDF();
  cabecera(doc, "RECIBO DE ENTREGA DE MERCADERÍA", "Constancia de entrega de prendas del taller", AZUL);
  let y = cajas(
    doc, 36,
    {
      titulo: "Datos del Taller (Quien Entrega)",
      lineas: [["Taller / Nombre", p.tallerEntrega], ["Fecha de Entrega", p.fecha]],
    },
    {
      titulo: "Datos de Quien Recibe",
      lineas: [["Recibido por", p.recibe], ["Nro. Recibo", p.nroRecibo], ["Vinculado a Orden Nro", "#" + p.numero]],
    },
    AZUL
  );
  y = seccion(doc, y, "Prendas e indumentaria entregada", AZUL);
  y = tabla(doc, y,
    ["Modelo / Artículo", "Colores", "Cantidad Entregada", "Pendiente en Taller"],
    [[p.producto, p.colores || "—", String(p.cantidad) + " u.", String(p.pendiente) + " u."]]
  );
  y = seccion(doc, y, "Estado de la entrega y observaciones", AZUL);
  parrafo(doc, y, p.observaciones || "Entrega registrada sin observaciones.");
  firmas(doc, "Entregó conforme (Taller)", "Recibió conforme");
  return doc;
}

/* ============ 3) COMPROBANTE DE PAGO A TALLER ============ */
export function pdfPago(p) {
  const doc = new jsPDF();
  cabecera(doc, "COMPROBANTE DE PAGO A TALLER", "Constancia de pago por servicios de confección", VERDE, "N° " + p.nro);
  let y = cajas(
    doc, 36,
    {
      titulo: "Emitido por (Fabricante)",
      lineas: [["Razón Social / Marca", p.fabricante || "Mi fábrica"], ["Fecha de Pago", p.fecha]],
    },
    {
      titulo: "Pagado a (Taller)",
      lineas: [["Taller / Responsable", p.taller], ["Tipo", p.tipoTaller || "—"]],
    },
    VERDE
  );
  y = parrafo(doc, y,
    "Declaración de Recepción: Por la presente, el taller declara haber recibido del fabricante el monto detallado abajo en concepto de pago (parcial o total) por los servicios prestados de corte, costura, ensamble y/o terminación de prendas."
  );
  y = tabla(doc, y,
    ["Descripción del Trabajo / Concepto", "Monto"],
    [[p.concepto || "Pago por servicios de confección", p.montoTexto]],
    { 1: { halign: "right", cellWidth: 45 } }
  );
  // Totales
  const fila = (label, valor, destacar) => {
    if (destacar) {
      doc.setFillColor(232, 244, 241);
      doc.rect(108, y - 4.5, 88, 8, "F");
    }
    doc.setFontSize(9.5);
    doc.setTextColor(40, 42, 48);
    doc.setFont(undefined, "bold");
    doc.text(label, 112, y);
    doc.setFont(undefined, destacar ? "bold" : "normal");
    doc.text(valor, 192, y, { align: "right" });
    doc.setDrawColor(210, 216, 222);
    doc.line(108, y + 2.5, 196, y + 2.5);
    y += 9;
  };
  fila("Total del Trabajo:", p.devengadoTexto);
  fila("Pagos Previos:", p.pagadoAntesTexto);
  fila("MONTO PAGADO HOY:", p.montoTexto, true);
  fila("Saldo Pendiente:", p.saldoTexto);
  y += 4;
  if (p.observaciones) y = parrafo(doc, y, "Detalle: " + p.observaciones);
  firmas(doc, "Entregué Dinero (Fabricante)", "Recibí Conforme Dinero (Taller)");
  return doc;
}

/* ============ Enviar el PDF por WhatsApp ============ */
export async function enviarPDF(doc, nombre, taller, texto) {
  const blob = doc.output("blob");
  const file = new File([blob], nombre, { type: "application/pdf" });
  // En celulares: abre la hoja de compartir con el PDF adjunto → elegís WhatsApp → enviar
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: texto });
      return "compartido";
    } catch (e) {
      if (e.name === "AbortError") return "cancelado";
    }
  }
  // En computadora: descarga el PDF y abre WhatsApp con el mensaje listo
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  a.click();
  const num = String(taller?.whatsapp || "").replace(/\D/g, "");
  if (num) window.open(`https://wa.me/${num}?text=${encodeURIComponent(texto + "\n\n(El PDF se descargó: adjuntalo al chat)")}`, "_blank");
  return "descargado";
}
