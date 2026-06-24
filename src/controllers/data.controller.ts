import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import * as xlsx from 'xlsx';
import path from 'path';
import fs from 'fs';
import prisma from '../utils/prisma';

const MAX_ROWS = parseInt(process.env.MAX_DATA_ROWS || '10000');

export const upload = async (req: AuthRequest, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, error: { code: 'UPLOAD_FAILED', message: 'No file uploaded', details: [] } });
    }

    const relativePath = path.join('storage/data', req.user!.id, file.filename).replace(/\\/g, '/');

    // Parse with SheetJS
    const workbook = xlsx.readFile(file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    const jsonData = xlsx.utils.sheet_to_json<any>(sheet, { defval: "" });
    const totalRows = jsonData.length;

    if (totalRows > MAX_ROWS) {
      // Clean up file if too large
      fs.unlinkSync(file.path);
      return res.status(422).json({ success: false, error: { code: 'ROW_LIMIT_EXCEEDED', message: `Excel has more than ${MAX_ROWS} rows`, details: [] } });
    }

    const headers = jsonData.length > 0 ? Object.keys(jsonData[0]) : [];
    const previewRows = jsonData.slice(0, 5);

    res.status(201).json({
      success: true,
      data: {
        uploadId: file.filename, // Using filename as uploadId for simplicity
        filePath: `/${relativePath}`,
        headers,
        totalRows,
        previewRows
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Upload or parse failed', details: [] } });
  }
};

export const validateData = async (req: AuthRequest, res: Response) => {
  try {
    const { uploadId, templateId, columnMapping } = req.body;
    const userId = req.user!.id;

    // Load template fields
    const template = await prisma.template.findFirst({
      where: { id: templateId, userId },
      include: { fields: true }
    });

    if (!template) {
      return res.status(404).json({ success: false, error: { code: 'TEMPLATE_NOT_FOUND', message: 'Template not found', details: [] } });
    }

    // Check if uploaded file exists
    const filePath = path.join(process.env.STORAGE_LOCAL_PATH || './storage', 'data', userId, uploadId);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: { code: 'UPLOAD_NOT_FOUND', message: 'Uploaded file not found', details: [] } });
    }

    const workbook = xlsx.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = xlsx.utils.sheet_to_json<any>(sheet, { defval: "" });

    const errors: any[] = [];
    let validRows = 0;
    let invalidRows = 0;

    const templateFieldKeys = template.fields.map(f => f.fieldKey);
    const mappedExcelColumns = Object.keys(columnMapping);
    
    // Reverse mapping: templateKey -> excelColumn
    const reverseMapping: Record<string, string> = {};
    for (const [excelCol, tmplKey] of Object.entries(columnMapping)) {
      reverseMapping[tmplKey as string] = excelCol;
    }

    // Check mapping completeness (basic check, can be expanded)
    for (const tmplKey of templateFieldKeys) {
      if (!reverseMapping[tmplKey]) {
        // Warning: template field not mapped
      }
    }

    // Validate rows
    const identifiers = new Set();
    
    jsonData.forEach((row, index) => {
      let rowValid = true;
      const rowIndex = index + 2; // +1 for 0-index, +1 for header

      // Example validation: Check if identifier exists and is unique
      // Assuming 'Roll No' or similar is mapped to 'rollNumber'. Need a way to identify the identifier.
      // For now, let's just do a basic duplicate check if 'rollNumber' is in the mapping.
      const idColumn = reverseMapping['rollNumber'];
      if (idColumn) {
        const idValue = row[idColumn];
        if (!idValue) {
          errors.push({ row: rowIndex, column: idColumn, errorCode: 'MISSING_REQUIRED', message: 'Identifier is missing' });
          rowValid = false;
        } else if (identifiers.has(idValue)) {
          errors.push({ row: rowIndex, column: idColumn, errorCode: 'DUPLICATE_IDENTIFIER', message: `Identifier ${idValue} appears more than once` });
          rowValid = false;
        } else {
          identifiers.add(idValue);
        }
      }

      if (rowValid) validRows++;
      else invalidRows++;
    });

    res.json({
      success: true,
      data: {
        isValid: invalidRows === 0,
        summary: {
          totalRows: jsonData.length,
          validRows,
          invalidRows
        },
        errors
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Validation failed', details: [] } });
  }
};
