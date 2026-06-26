import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middlewares/auth.middleware';
import path from 'path';

export const upload = async (req: AuthRequest, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, error: { code: 'UPLOAD_FAILED', message: 'No file uploaded', details: [] } });
    }

    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Template name is required', details: [] } });
    }

    let fileType: 'PDF' | 'PNG' | 'JPG';
    if (file.mimetype === 'application/pdf') fileType = 'PDF';
    else if (file.mimetype === 'image/png') fileType = 'PNG';
    else if (file.mimetype === 'image/jpeg') fileType = 'JPG';
    else return res.status(422).json({ success: false, error: { code: 'INVALID_FILE_TYPE', message: 'Unsupported file type', details: [] } });

    const relativePath = path.join('storage/templates', req.user!.id, file.filename).replace(/\\/g, '/');

    // Basic dimensions (In a real app, use pdf-lib or image-size to extract real dimensions)
    const pageWidth = 595.28;
    const pageHeight = 841.89;

    const template = await prisma.template.create({
      data: {
        userId: req.user!.id,
        name,
        description,
        fileType,
        filePath: `/${relativePath}`,
        fileSize: file.size,
        pageWidth,
        pageHeight,
        thumbnailPath: null // Optionally generate later
      }
    });

    res.status(201).json({
      success: true,
      data: {
        template: {
          id: template.id,
          name: template.name,
          fileType: template.fileType,
          pageWidth: template.pageWidth,
          pageHeight: template.pageHeight,
          thumbnailUrl: template.thumbnailPath,
          createdAt: template.createdAt
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Upload failed', details: [] } });
  }
};

export const list = async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = req.query.search as string;

    const skip = (page - 1) * limit;

    const where: any = {
      userId: req.user!.id,
      isDeleted: false
    };

    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const [templates, total] = await Promise.all([
      prisma.template.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { components: { where: { fieldKey: { not: null } } } }
          }
        }
      }),
      prisma.template.count({ where })
    ]);

    const formattedTemplates = templates.map((t: any) => {
      return {
        id: t.id,
        name: t.name,
        fileType: t.fileType,
        thumbnailUrl: t.thumbnailPath,
        fieldCount: t._count?.components || 0,
        createdAt: t.createdAt
      };
    });

    res.json({
      success: true,
      data: {
        templates: formattedTemplates,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to list templates', details: [] } });
  }
};

export const getOne = async (req: AuthRequest, res: Response) => {
  try {
    const template = await prisma.template.findUnique({
      where: { id: req.params.id, userId: req.user!.id },
      include: {
        components: true
      }
    });

    if (!template) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Template not found', details: [] } });
    }

    const fields = template.components
      .filter(c => c.fieldKey)
      .map(c => ({
        id: c.id,
        fieldKey: c.fieldKey,
        type: c.type
      }));

    res.json({
      success: true,
      data: {
        template: {
          ...template,
          fileUrl: template.filePath,
          thumbnailUrl: template.thumbnailPath,
          fields
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to get template', details: [] } });
  }
};

export const update = async (req: AuthRequest, res: Response) => {
  try {
    const { name, description } = req.body;
    
    const template = await prisma.template.update({
      where: { id: req.params.id },
      data: { name, description }
    });

    res.json({ success: true, data: { template } });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Update failed', details: [] } });
  }
};

export const remove = async (req: AuthRequest, res: Response) => {
  try {
    await prisma.template.update({
      where: { id: req.params.id },
      data: { isDeleted: true }
    });

    res.json({ success: true, data: { message: 'Template deleted' } });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Delete failed', details: [] } });
  }
};
