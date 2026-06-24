import { Worker, Job } from 'bullmq';
import { PDFDocument } from 'pdf-lib';
const { rgb, StandardFonts } = require('pdf-lib');
import * as xlsx from 'xlsx';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import archiver from 'archiver';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { redisOptions } from '../utils/queue';
import dotenv from 'dotenv';

dotenv.config();

const storageDir = process.env.STORAGE_LOCAL_PATH || './storage';

// Ensure directories exist
const ensureDir = (dir: string) => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
};

// Helper to convert hex to RGB for pdf-lib
const hexToRgb = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255
  } : { r: 0, g: 0, b: 0 };
};

const createZip = async (sourceDir: string, outPath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const output = require('fs').createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve());
    archive.on('error', (err) => reject(err));

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
};

const processJob = async (job: Job) => {
  const { generationJobId, userId, templateId, dataFilePath, columnMapping } = job.data;
  logger.info(`Starting job ${generationJobId}`);

  await prisma.generationJob.update({
    where: { id: generationJobId },
    data: { status: 'PROCESSING', startedAt: new Date() }
  });

  try {
    const template = await prisma.template.findUnique({
      where: { id: templateId },
      include: { fields: true }
    });

    if (!template) throw new Error('Template not found');

    const templateAbsPath = path.join(process.cwd(), template.filePath);
    const dataAbsPath = path.resolve(dataFilePath);

    const templateBytes = await fs.readFile(templateAbsPath);

    const workbook = xlsx.readFile(dataAbsPath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rowDataArray = xlsx.utils.sheet_to_json<any>(sheet, { defval: "" });

    const jobOutDir = path.join(storageDir, 'generated', generationJobId);
    ensureDir(jobOutDir);

    let processedCount = 0;
    let failedCount = 0;

    // Reverse mapping
    const reverseMap: Record<string, string> = {};
    for (const [excelCol, tmplKey] of Object.entries(columnMapping)) {
      reverseMap[tmplKey as string] = excelCol;
    }

    // Assuming we use 'rollNumber' as identifier, or default to row index
    const identifierKey = reverseMap['rollNumber'] || Object.keys(rowDataArray[0] || {})[0];

    for (let i = 0; i < rowDataArray.length; i++) {
      const row = rowDataArray[i];
      const identifier = row[identifierKey] ? String(row[identifierKey]) : `row_${i + 1}`;

      try {
        const pdfDoc = await PDFDocument.load(templateBytes);
        const pages = pdfDoc.getPages();
        const firstPage = pages[0];

        // For simplicity, embed standard font. In prod, load from template config
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

        const { height } = firstPage.getSize();

        for (const field of template.fields) {
          const excelCol = reverseMap[field.fieldKey];
          if (!excelCol) continue;

          const value = row[excelCol] ? String(row[excelCol]) : '';
          const color = hexToRgb(field.fontColor);

          firstPage.drawText(value, {
            x: field.x,
            y: height - field.y - field.fontSize,
            size: field.fontSize,
            font,
            color: rgb(color.r, color.g, color.b)
          });
        }

        const pdfBytes = await pdfDoc.save();
        const outPdfPath = path.join(jobOutDir, `${identifier}.pdf`);
        await fs.writeFile(outPdfPath, pdfBytes);

        await prisma.generatedDocument.create({
          data: {
            jobId: generationJobId,
            rowIndex: i,
            identifier,
            filePath: outPdfPath,
            fileSize: pdfBytes.length,
            status: 'SUCCESS'
          }
        });

        processedCount++;
      } catch (err: any) {
        logger.error(`Error generating PDF for row ${i}`, err);
        failedCount++;
        await prisma.generatedDocument.create({
          data: {
            jobId: generationJobId,
            rowIndex: i,
            identifier,
            filePath: '',
            fileSize: 0,
            status: 'FAILED',
            errorMessage: err.message
          }
        });
      }

      // Update progress every 10 rows
      if (i % 10 === 0) {
        await prisma.generationJob.update({
          where: { id: generationJobId },
          data: { processedRows: processedCount, failedRows: failedCount }
        });
        await job.updateProgress(Math.round(((i + 1) / rowDataArray.length) * 100));
      }
    }

    // Zip creation
    const zipDir = path.join(storageDir, 'zips', generationJobId);
    ensureDir(zipDir);
    const zipPath = path.join(zipDir, 'results.zip');

    await createZip(jobOutDir, zipPath);

    await prisma.generationJob.update({
      where: { id: generationJobId },
      data: {
        status: 'COMPLETED',
        processedRows: processedCount,
        failedRows: failedCount,
        zipFilePath: zipPath,
        completedAt: new Date()
      }
    });

    logger.info(`Job ${generationJobId} completed successfully`);

  } catch (error: any) {
    logger.error(`Job ${generationJobId} failed`, error);
    await prisma.generationJob.update({
      where: { id: generationJobId },
      data: {
        status: 'FAILED',
        errorMessage: error.message
      }
    });
    throw error;
  }
};

const worker = new Worker('pdf-generation', processJob, {
  connection: redisOptions,
  concurrency: parseInt(process.env.PDF_WORKER_CONCURRENCY || '3')
});

worker.on('ready', () => {
  logger.info('PDF Worker is ready and listening for jobs...');
});

worker.on('failed', (job, err) => {
  logger.error(`Job ${job?.id} failed in worker`, err);
});
