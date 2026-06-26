import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { renderDocument } from '../services/rendering/renderEngine';
import fs from 'fs/promises';
import path from 'path';

export const getDocument = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const templateDoc = await prisma.templateDocument.findUnique({
      where: { templateId: id }
    });

    const template = await prisma.template.findUnique({ where: { id } });
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    if (!templateDoc) {
      return res.json({
        success: true,
        data: {
          documentModel: {
            version: 2,
            canvas: { width: template.pageWidth, height: template.pageHeight, background: "#FFFFFF", grid: { enabled: false, size: 10, snap: false, visible: false } },
            components: []
          },
          templateFileUrl: template.filePath,
          availableFields: []
        }
      });
    }

    return res.json({
      success: true,
      data: {
        documentModel: templateDoc.document,
        templateFileUrl: template.filePath,
        availableFields: []
      }
    });
  } catch (error: any) {
    logger.error('Error fetching document model:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch document model' });
  }
};

export const saveDocument = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { documentModel, saveVersion } = req.body;

    await prisma.$transaction(async (tx) => {
      await tx.templateDocument.upsert({
        where: { templateId: id },
        update: { document: documentModel },
        create: { templateId: id, document: documentModel }
      });

      await tx.templateComponent.deleteMany({ where: { templateId: id } });
      
      const components = documentModel.components.map((c: any) => ({
        id: c.id,
        templateId: id,
        type: c.type,
        fieldKey: c.fieldKey,
        label: c.label,
        properties: c,
        zIndex: c.zIndex,
        pageNumber: c.pageNumber,
        isVisible: c.isVisible,
        isLocked: c.isLocked
      }));

      if (components.length > 0) {
        await tx.templateComponent.createMany({ data: components });
      }

      await tx.template.update({
        where: { id },
        data: { editorVersion: 'v2' }
      });

      if (saveVersion) {
        const lastVersion = await tx.templateVersion.findFirst({
          where: { templateId: id },
          orderBy: { version: 'desc' }
        });
        const nextVersion = lastVersion ? lastVersion.version + 1 : 1;

        await tx.templateVersion.create({
          data: {
            templateId: id,
            version: nextVersion,
            snapshot: documentModel,
            createdBy: (req as any).user.id
          }
        });
      }
    });

    res.json({ success: true, data: { savedAt: new Date() } });
  } catch (error: any) {
    logger.error('Error saving document model:', error);
    res.status(500).json({ success: false, message: 'Failed to save document model' });
  }
};

export const previewDocument = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { documentModel, previewMode } = req.body;

    const template = await prisma.template.findUnique({ where: { id } });
    if (!template) return res.status(404).json({ success: false, message: 'Template not found' });

    const templateBytes = await fs.readFile(path.join(process.cwd(), template.filePath));

    const dataMap: any = {};
    documentModel.components.forEach((c: any) => {
      if (c.fieldKey) {
        dataMap[c.fieldKey] = previewMode === 'dummy' ? (c.sampleValue || 'Sample') : `{${c.fieldKey}}`;
      }
    });

    const pdfBytes = await renderDocument(documentModel, dataMap, {
      target: 'png-preview',
      templateBytes,
      templateType: template.fileType as 'PDF' | 'PNG' | 'JPG',
    });

    res.json({
      success: true,
      data: {
        previewImage: `data:application/pdf;base64,${Buffer.from(pdfBytes).toString('base64')}`,
        warnings: []
      }
    });

  } catch (error: any) {
    logger.error('Error previewing document:', error);
    res.status(500).json({ success: false, message: 'Failed to preview document' });
  }
};

export const getVersions = async (req: Request, res: Response) => { res.json({ success: true, data: { versions: [] } }); };
export const restoreVersion = async (req: Request, res: Response) => { res.json({ success: true, data: null }); };
export const validateDocument = async (req: Request, res: Response) => { res.json({ success: true, data: { isValid: true, componentWarnings: [], dataWarnings: [] } }); };
