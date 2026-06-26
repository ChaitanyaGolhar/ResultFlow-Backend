import { PDFDocument } from 'pdf-lib';
const { rgb } = require('pdf-lib');
import { DocumentModel, Component, TextComponent, StaticTextComponent } from '../../types/documentModel';

export interface RenderData {
  [fieldKey: string]: string;
}

export interface RenderOptions {
  target: 'pdf' | 'png-preview';
  templateBytes: Uint8Array;  // original template file bytes
  templateType: 'PDF' | 'PNG' | 'JPG';
}

export async function renderDocument(
  model: DocumentModel,
  data: RenderData,
  options: RenderOptions
): Promise<Uint8Array> {

  // 1. Initialize PDF from template background
  const pdfDoc = options.templateType === 'PDF'
    ? await PDFDocument.load(options.templateBytes)
    : await createPdfFromImage(options.templateBytes, options.templateType, model.canvas);

  // 2. Load fonts
  const fonts = await loadFonts(pdfDoc);

  // 3. Sort components by zIndex
  const sorted = [...model.components]
    .filter(c => c.isVisible)
    .sort((a, b) => a.zIndex - b.zIndex);

  // 4. Render each component
  for (const component of sorted) {
    const page = pdfDoc.getPages()[component.pageNumber - 1];
    if (!page) continue;

    await renderComponent(page, component, data, fonts, model.canvas);
  }

  // If target is png-preview, we will handle this in the controller by returning the PDF and having the frontend render it or convert it.
  // Actually, for simplicity and performance, the simplest is to return the PDF bytes and use pdf.js to render preview, 
  // or return pdf bytes directly and use an iframe or pdf viewer. 
  // We'll return the PDF bytes.
  return pdfDoc.save();
}

async function createPdfFromImage(imageBytes: Uint8Array, type: 'PNG' | 'JPG', canvas: any) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([canvas.width, canvas.height]);
  
  const image = type === 'PNG' 
    ? await pdfDoc.embedPng(imageBytes)
    : await pdfDoc.embedJpg(imageBytes);

  page.drawImage(image, {
    x: 0,
    y: 0,
    width: canvas.width,
    height: canvas.height,
  });

  return pdfDoc;
}

async function renderComponent(page: any, component: Component, data: RenderData, fonts: any, canvas: any) {
  const { width: pageW, height: pageH } = page.getSize();

  switch (component.type) {

    case 'TEXT': {
      const value = data[component.fieldKey] ?? '';
      drawTextInBounds(page, component, value, fonts, pageH);
      break;
    }

    case 'STATIC_TEXT': {
      drawTextInBounds(page, component, component.content ?? '', fonts, pageH);
      break;
    }

    case 'SHAPE_RECT': {
      const y = pageH - component.y - component.height;
      page.drawRectangle({
        x: component.x,
        y,
        width: component.width,
        height: component.height,
        color: hexToRgb(component.fill),
        borderColor: hexToRgb(component.stroke),
        borderWidth: component.strokeWidth,
        opacity: component.opacity,
      });
      break;
    }

    case 'SHAPE_ELLIPSE': {
      const centerX = component.x + component.width / 2;
      const centerY = pageH - component.y - component.height / 2;
      page.drawEllipse({
        x: centerX,
        y: centerY,
        xScale: component.width / 2,
        yScale: component.height / 2,
        color: hexToRgb(component.fill),
        borderColor: hexToRgb(component.stroke),
        borderWidth: component.strokeWidth,
        opacity: component.opacity,
      });
      break;
    }

    case 'LINE': {
      const y1 = pageH - component.y;
      const y2 = pageH - (component.y + component.height);
      page.drawLine({
        start: { x: component.x, y: y1 },
        end: { x: component.x + component.width, y: y2 },
        color: hexToRgb(component.stroke),
        thickness: component.strokeWidth,
        dashArray: component.strokeDashArray?.length ? component.strokeDashArray : undefined,
      });
      break;
    }
  }
}

function drawTextInBounds(page: any, component: TextComponent | StaticTextComponent, value: string, fonts: any, pageH: number) {
  // Standard fonts in pdf-lib only support WinAnsi (Latin) characters.
  // Replace unsupported characters with '?' to prevent rendering crashes.
  value = value.replace(/[^\u0000-\u00FF]/g, '?');

  const t = component.typography || { fontFamily: 'Helvetica', fontSize: 12, lineHeight: 1.2, textAlign: 'left', verticalAlign: 'top', color: '#000000' };
  const p = component.padding || { top: 0, right: 0, bottom: 0, left: 0 };

  const font = fonts[t.fontFamily] || fonts['Helvetica'];
  const color = hexToRgb(t.color);

  // Available area after padding
  const availW = component.width - p.left - p.right;
  const availH = component.height - p.top - p.bottom;

  // pdf-lib uses bottom-left origin; our model uses top-left
  const baseY = pageH - component.y - component.height;

  // Handle overflow behavior
  let displayValue = value;
  if (component.overflow === 'ellipsis') {
    displayValue = truncateWithEllipsis(value, availW, font, t.fontSize);
  } else if (component.overflow === 'auto-shrink') {
    // Basic auto-shrink: decrease font size until it fits
    let currentFontSize = t.fontSize;
    while (currentFontSize > 4 && font.widthOfTextAtSize(displayValue, currentFontSize) > availW) {
      currentFontSize -= 0.5;
    }
    t.fontSize = currentFontSize;
  }

  // Calculate y based on vertical align
  const textHeight = t.fontSize * t.lineHeight;
  let textY: number;
  if (t.verticalAlign === 'top') {
    textY = baseY + availH - textHeight + p.bottom;
  } else if (t.verticalAlign === 'middle') {
    textY = baseY + availH / 2 - textHeight / 2;
  } else {
    textY = baseY + p.bottom;
  }

  // Calculate x based on text align
  const textWidth = font.widthOfTextAtSize(displayValue, t.fontSize);
  let textX: number;
  if (t.textAlign === 'left') {
    textX = component.x + p.left;
  } else if (t.textAlign === 'center') {
    textX = component.x + p.left + (availW - textWidth) / 2;
  } else {
    textX = component.x + component.width - p.right - textWidth;
  }

  page.drawText(displayValue, {
    x: textX,
    y: textY,
    font,
    size: t.fontSize,
    color,
    maxWidth: component.overflow === 'wrap' ? availW : undefined,
    lineHeight: t.fontSize * t.lineHeight,
  });
}

async function loadFonts(pdfDoc: PDFDocument) {
  const [helvetica, helveticaBold, timesRoman, timesBold, courier, courierBold] = await Promise.all([
    pdfDoc.embedFont('Helvetica' as any),
    pdfDoc.embedFont('Helvetica-Bold' as any),
    pdfDoc.embedFont('Times-Roman' as any),
    pdfDoc.embedFont('Times-Bold' as any),
    pdfDoc.embedFont('Courier' as any),
    pdfDoc.embedFont('Courier-Bold' as any),
  ]);

  return {
    'Helvetica': helvetica,
    'Helvetica-Bold': helveticaBold,
    'Times-Roman': timesRoman,
    'Times-Bold': timesBold,
    'Courier': courier,
    'Courier-Bold': courierBold,
  };
}

function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? rgb(
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255
  ) : rgb(0, 0, 0);
}

function truncateWithEllipsis(text: string, maxWidth: number, font: any, fontSize: number): string {
  const ellipsis = '…';
  if (font.widthOfTextAtSize(text, fontSize) <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 0 && font.widthOfTextAtSize(truncated + ellipsis, fontSize) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + ellipsis;
}
