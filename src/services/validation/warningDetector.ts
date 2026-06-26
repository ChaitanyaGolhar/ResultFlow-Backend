import { PDFDocument } from 'pdf-lib';
import { DocumentModel, TextComponent } from '../../types/documentModel';

export interface RowWarning {
  componentId: string;
  fieldKey: string | null;
  type: WarningType;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  message: string;
}

export type WarningType =
  | 'TEXT_OVERFLOW'
  | 'TEXT_HEIGHT_OVERFLOW'
  | 'EMPTY_VALUE'
  | 'EMPTY_REQUIRED'
  | 'UNSUPPORTED_CHAR'
  | 'QR_VALUE_TOO_LONG';

// Load fonts once and reuse across all rows
let cachedFonts: Record<string, any> | null = null;

async function getFonts() {
  if (cachedFonts) return cachedFonts;
  const doc = await PDFDocument.create();
  const [h, hb, t, tb, c, cb] = await Promise.all([
    doc.embedFont('Helvetica' as any),
    doc.embedFont('Helvetica-Bold' as any),
    doc.embedFont('Times-Roman' as any),
    doc.embedFont('Times-Bold' as any),
    doc.embedFont('Courier' as any),
    doc.embedFont('Courier-Bold' as any),
  ]);
  cachedFonts = {
    'Helvetica': h, 'Helvetica-Bold': hb,
    'Times-Roman': t, 'Times-Bold': tb,
    'Courier': c, 'Courier-Bold': cb,
  };
  return cachedFonts;
}

export async function detectWarningsForRow(
  model: DocumentModel,
  rowData: Record<string, string>
): Promise<RowWarning[]> {
  const warnings: RowWarning[] = [];
  const fonts = await getFonts();

  for (const component of model.components) {
    if (!component.isVisible) continue;

    if (component.type === 'TEXT') {
      const textComp = component as TextComponent;
      const value = rowData[textComp.fieldKey] ?? '';

      // Check empty
      if (!value) {
        warnings.push({
          componentId: textComp.id,
          fieldKey: textComp.fieldKey,
          type: 'EMPTY_VALUE',
          severity: 'WARNING',
          message: `'${textComp.label}' has no value in this row`,
        });
        continue;
      }

      // Check text overflow
      const t = textComp.typography || { fontFamily: 'Helvetica', fontSize: 12, lineHeight: 1.2, textAlign: 'left', verticalAlign: 'top', color: '#000000' };
      const p = textComp.padding || { top: 0, right: 0, bottom: 0, left: 0 };
      const font = fonts[t.fontFamily];
      const availW = textComp.width - p.left - p.right;
      // const availH = textComp.height - p.top - p.bottom;

      if (font) {
        // Standard fonts in pdf-lib only support WinAnsi (Latin) characters.
        // Replace unsupported characters with '?' to prevent widthOfTextAtSize crashes.
        const safeValue = value.replace(/[^\u0000-\u00FF]/g, '?');
        const textWidth = font.widthOfTextAtSize(safeValue, t.fontSize);

        if (textWidth > availW && textComp.overflow === 'clip') {
          warnings.push({
            componentId: textComp.id,
            fieldKey: textComp.fieldKey,
            type: 'TEXT_OVERFLOW',
            severity: 'WARNING',
            message: `'${textComp.label}' value "${value}" overflows by ~${Math.round(textWidth - availW)}pt`,
          });
        }
      }

      // Check unsupported characters (basic check for Helvetica/Times/Courier)
      const hasNonLatin = /[^\u0000-\u00FF]/.test(value);
      if (hasNonLatin) {
        warnings.push({
          componentId: textComp.id,
          fieldKey: textComp.fieldKey,
          type: 'UNSUPPORTED_CHAR',
          severity: 'WARNING',
          message: `'${textComp.label}' contains characters that may not render correctly with ${t.fontFamily}`,
        });
      }
    }

    if (component.type === 'QR_CODE') {
      const qrComp = component as any;
      const value = rowData[qrComp.fieldKey ?? ''] ?? '';
      if (value.length > 2953) { // QR max for error correction L
        warnings.push({
          componentId: qrComp.id,
          fieldKey: qrComp.fieldKey ?? null,
          type: 'QR_VALUE_TOO_LONG',
          severity: 'ERROR',
          message: `QR code value is too long (${value.length} chars, max 2953)`,
        });
      }
    }
  }

  return warnings;
}

export async function scanAllRows(
  model: DocumentModel,
  rows: Record<string, string>[]
): Promise<{ rowIndex: number; identifier: string; warnings: RowWarning[] }[]> {
  const results = [];

  // Find identifier field (first TEXT component whose fieldKey contains 'roll', 'id', or 'number')
  const identifierComp = model.components.find(c =>
    c.type === 'TEXT' && (c as TextComponent).fieldKey && /roll|id|number|no/i.test((c as TextComponent).fieldKey)
  ) as TextComponent | undefined;

  for (let i = 0; i < rows.length; i++) {
    const warnings = await detectWarningsForRow(model, rows[i]);
    if (warnings.length > 0) {
      results.push({
        rowIndex: i,
        identifier: identifierComp ? (rows[i][identifierComp.fieldKey] ?? String(i + 1)) : String(i + 1),
        warnings,
      });
    }
  }

  return results;
}
