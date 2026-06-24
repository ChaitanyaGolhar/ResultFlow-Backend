import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../utils/prisma';
import path from 'path';
import fs from 'fs';
import * as xlsx from 'xlsx';
import { pdfQueue } from '../utils/queue';

export const create = async (req: AuthRequest, res: Response) => {
  try {
    const { templateId, uploadId, columnMapping } = req.body;
    const userId = req.user!.id;

    // Validate template
    const template = await prisma.template.findFirst({
      where: { id: templateId, userId }
    });
    if (!template) {
      return res.status(404).json({ success: false, error: { code: 'TEMPLATE_NOT_FOUND', message: 'Template not found', details: [] } });
    }

    // Validate upload
    const filePath = path.join(process.env.STORAGE_LOCAL_PATH || './storage', 'data', userId, uploadId);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: { code: 'UPLOAD_NOT_FOUND', message: 'Data file not found', details: [] } });
    }

    // Count rows
    const workbook = xlsx.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = xlsx.utils.sheet_to_json<any>(sheet, { defval: "" });
    const totalRows = jsonData.length;

    // Create DB Job
    const job = await prisma.generationJob.create({
      data: {
        userId,
        templateId,
        dataFilePath: filePath,
        columnMapping,
        totalRows,
        status: 'PENDING'
      }
    });

    // Enqueue
    await pdfQueue.add('generate-pdf', {
      generationJobId: job.id,
      userId,
      templateId,
      dataFilePath: filePath,
      columnMapping
    });

    res.status(202).json({
      success: true,
      data: {
        job: {
          id: job.id,
          status: job.status,
          totalRows: job.totalRows,
          processedRows: job.processedRows,
          createdAt: job.createdAt
        }
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create job', details: [] } });
  }
};

export const list = async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const status = req.query.status as any;
    
    const skip = (page - 1) * limit;
    
    const where: any = { userId: req.user!.id };
    if (status) where.status = status;

    const [jobs, total] = await Promise.all([
      prisma.generationJob.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { template: { select: { name: true } } }
      }),
      prisma.generationJob.count({ where })
    ]);

    const formattedJobs = jobs.map(j => ({
      id: j.id,
      templateName: j.template.name,
      status: j.status,
      totalRows: j.totalRows,
      processedRows: j.processedRows,
      failedRows: j.failedRows,
      createdAt: j.createdAt,
      completedAt: j.completedAt
    }));

    res.json({
      success: true,
      data: {
        jobs: formattedJobs,
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to list jobs', details: [] } });
  }
};

export const getOne = async (req: AuthRequest, res: Response) => {
  try {
    const job = await prisma.generationJob.findUnique({
      where: { id: req.params.id },
      include: { template: { select: { name: true } } }
    });

    if (!job) {
      return res.status(404).json({ success: false, error: { code: 'JOB_NOT_FOUND', message: 'Job not found', details: [] } });
    }

    const progressPercent = job.totalRows > 0 ? Math.round((job.processedRows / job.totalRows) * 100) : 0;

    res.json({
      success: true,
      data: {
        job: {
          id: job.id,
          status: job.status,
          totalRows: job.totalRows,
          processedRows: job.processedRows,
          failedRows: job.failedRows,
          progressPercent,
          templateId: job.templateId,
          templateName: job.template.name,
          columnMapping: job.columnMapping,
          zipFileUrl: job.zipFilePath ? `/api/v1/jobs/${job.id}/download/zip` : null,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          createdAt: job.createdAt
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to get job', details: [] } });
  }
};

export const retry = async (req: AuthRequest, res: Response) => {
  try {
    const job = await prisma.generationJob.findUnique({ where: { id: req.params.id } });
    
    if (job?.status !== 'FAILED') {
      return res.status(422).json({ success: false, error: { code: 'JOB_NOT_FAILED', message: 'Can only retry failed jobs', details: [] } });
    }

    await prisma.generationJob.update({
      where: { id: job.id },
      data: { status: 'PENDING', errorMessage: null }
    });

    await pdfQueue.add('generate-pdf', {
      generationJobId: job.id,
      userId: job.userId,
      templateId: job.templateId,
      dataFilePath: job.dataFilePath,
      columnMapping: job.columnMapping
    });

    res.status(202).json({ success: true, data: { message: 'Job re-enqueued' } });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to retry job', details: [] } });
  }
};

export const remove = async (req: AuthRequest, res: Response) => {
  try {
    await prisma.generationJob.delete({ where: { id: req.params.id } });
    res.json({ success: true, data: { message: 'Job deleted' } });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to delete job', details: [] } });
  }
};

export const downloadZip = async (req: AuthRequest, res: Response) => {
  try {
    const job = await prisma.generationJob.findUnique({ where: { id: req.params.id } });

    if (!job || job.status !== 'COMPLETED' || !job.zipFilePath) {
      return res.status(404).json({ success: false, error: { code: 'ZIP_NOT_READY', message: 'ZIP file not ready or job not completed', details: [] } });
    }

    const fullPath = path.resolve(job.zipFilePath);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ success: false, error: { code: 'ZIP_NOT_FOUND', message: 'ZIP file missing on disk', details: [] } });
    }

    res.download(fullPath, `results_${job.id}.zip`);
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to download zip', details: [] } });
  }
};

export const listDocuments = async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as any;
    
    const skip = (page - 1) * limit;
    
    const where: any = { jobId: req.params.id };
    if (status) where.status = status;

    const [documents, total] = await Promise.all([
      prisma.generatedDocument.findMany({ where, skip, take: limit, orderBy: { rowIndex: 'asc' } }),
      prisma.generatedDocument.count({ where })
    ]);

    const formattedDocs = documents.map(d => ({
      id: d.id,
      rowIndex: d.rowIndex,
      identifier: d.identifier,
      status: d.status,
      fileSize: d.fileSize,
      downloadUrl: `/api/v1/jobs/${req.params.id}/documents/${d.id}/download`
    }));

    res.json({
      success: true,
      data: {
        documents: formattedDocs,
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to list documents', details: [] } });
  }
};

export const downloadDocument = async (req: AuthRequest, res: Response) => {
  try {
    const doc = await prisma.generatedDocument.findFirst({
      where: { id: req.params.docId, jobId: req.params.id }
    });

    if (!doc || doc.status !== 'SUCCESS') {
      return res.status(404).json({ success: false, error: { code: 'DOC_NOT_FOUND', message: 'Document not found or failed', details: [] } });
    }

    const fullPath = path.resolve(doc.filePath);
    res.download(fullPath);
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to download document', details: [] } });
  }
};
