import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import * as xlsx from 'xlsx';
import { app } from '../src/app';
import { prismaMock, pdfQueueMock, USER, OTHER_USER, bearer } from './helpers/prismaMock';

const BASE = '/api/v1/jobs';
const UPLOAD_ID = 'students.xlsx';
const userDataDir = path.join(process.env.STORAGE_LOCAL_PATH!, 'data', USER.id);
const uploadPath = path.join(userDataDir, UPLOAD_ID);

const job = (overrides: Record<string, unknown> = {}) => ({
  id: 'job_1',
  userId: USER.id,
  templateId: 'tpl_1',
  dataFilePath: uploadPath,
  columnMapping: { Name: 'student_name' },
  totalRows: 4,
  processedRows: 1,
  failedRows: 0,
  status: 'PROCESSING',
  zipFilePath: null,
  errorMessage: null,
  startedAt: null,
  completedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  template: { name: 'Semester Marksheet' },
  ...overrides,
});

const validJobBody = {
  templateId: 'tpl_1',
  uploadId: UPLOAD_ID,
  columnMapping: { Name: 'student_name' },
  preflightAcknowledged: true,
};

beforeAll(() => {
  // A real 3-row spreadsheet on a temp path, so the controller's row count is exercised for real.
  fs.mkdirSync(userDataDir, { recursive: true });
  const sheet = xlsx.utils.json_to_sheet([{ Name: 'A' }, { Name: 'B' }, { Name: 'C' }]);
  const book = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(book, sheet, 'Sheet1');
  xlsx.writeFile(book, uploadPath);
});

afterAll(() => {
  fs.rmSync(process.env.STORAGE_LOCAL_PATH!, { recursive: true, force: true });
});

describe('authentication on /api/v1/jobs', () => {
  it.each([
    ['get', BASE],
    ['post', BASE],
    ['get', `${BASE}/job_1`],
    ['post', `${BASE}/job_1/retry`],
    ['delete', `${BASE}/job_1`],
  ] as const)('%s %s returns 401 without a token', async (method, url) => {
    const res = await request(app)[method](url);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('POST /api/v1/jobs', () => {
  it('counts the rows, persists a PENDING job and enqueues it', async () => {
    prismaMock.template.findFirst.mockResolvedValue({ id: 'tpl_1', userId: USER.id });
    prismaMock.generationJob.create.mockImplementation(async ({ data }: any) => ({
      id: 'job_new',
      processedRows: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      ...data,
    }));
    pdfQueueMock.add.mockResolvedValue({});

    const res = await request(app).post(BASE).set('Authorization', bearer()).send(validJobBody);

    expect(res.status).toBe(202);
    expect(res.body.data.job).toEqual({
      id: 'job_new',
      status: 'PENDING',
      totalRows: 3,
      processedRows: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(prismaMock.template.findFirst).toHaveBeenCalledWith({ where: { id: 'tpl_1', userId: USER.id } });
    expect(pdfQueueMock.add).toHaveBeenCalledWith('generate-pdf', {
      generationJobId: 'job_new',
      userId: USER.id,
      templateId: 'tpl_1',
      dataFilePath: uploadPath,
      columnMapping: { Name: 'student_name' },
    });
  });

  it.each([
    ['missing templateId', { ...validJobBody, templateId: undefined }],
    ['missing uploadId', { ...validJobBody, uploadId: '' }],
    ['empty columnMapping', { ...validJobBody, columnMapping: {} }],
    ['non-boolean preflightAcknowledged', { ...validJobBody, preflightAcknowledged: 'yes' }],
  ])('rejects %s with 400 VALIDATION_ERROR', async (_label, body) => {
    const res = await request(app).post(BASE).set('Authorization', bearer()).send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(prismaMock.generationJob.create).not.toHaveBeenCalled();
  });

  it('refuses to generate until preflight is acknowledged', async () => {
    const res = await request(app)
      .post(BASE)
      .set('Authorization', bearer())
      .send({ ...validJobBody, preflightAcknowledged: false });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PREFLIGHT_NOT_ACKNOWLEDGED');
    expect(prismaMock.template.findFirst).not.toHaveBeenCalled();
  });

  it("returns 404 when the template is missing or belongs to someone else", async () => {
    prismaMock.template.findFirst.mockResolvedValue(null);

    const res = await request(app).post(BASE).set('Authorization', bearer()).send(validJobBody);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TEMPLATE_NOT_FOUND');
    expect(pdfQueueMock.add).not.toHaveBeenCalled();
  });

  it('returns 404 when the uploaded data file does not exist', async () => {
    prismaMock.template.findFirst.mockResolvedValue({ id: 'tpl_1', userId: USER.id });

    const res = await request(app)
      .post(BASE)
      .set('Authorization', bearer())
      .send({ ...validJobBody, uploadId: 'never-uploaded.xlsx' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('UPLOAD_NOT_FOUND');
    expect(prismaMock.generationJob.create).not.toHaveBeenCalled();
  });

  it('returns 500 when enqueueing fails', async () => {
    prismaMock.template.findFirst.mockResolvedValue({ id: 'tpl_1', userId: USER.id });
    prismaMock.generationJob.create.mockResolvedValue(job({ status: 'PENDING' }));
    pdfQueueMock.add.mockRejectedValue(new Error('redis unavailable'));

    const res = await request(app).post(BASE).set('Authorization', bearer()).send(validJobBody);

    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe('Failed to create job');
  });
});

describe('GET /api/v1/jobs', () => {
  it("lists the caller's jobs with template names and an optional status filter", async () => {
    prismaMock.generationJob.findMany.mockResolvedValue([job({ status: 'COMPLETED' })]);
    prismaMock.generationJob.count.mockResolvedValue(11);

    const res = await request(app).get(`${BASE}?status=COMPLETED&page=2`).set('Authorization', bearer());

    expect(res.status).toBe(200);
    expect(res.body.data.jobs[0]).toMatchObject({ id: 'job_1', templateName: 'Semester Marksheet', status: 'COMPLETED' });
    expect(res.body.data.pagination).toEqual({ total: 11, page: 2, limit: 10, totalPages: 2 });
    const query = prismaMock.generationJob.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ userId: USER.id, status: 'COMPLETED' });
    expect(query.skip).toBe(10);
  });
});

describe('GET /api/v1/jobs/:id', () => {
  it('returns progress as a percentage and no zip URL while processing', async () => {
    prismaMock.generationJob.findUnique.mockResolvedValue(job());

    const res = await request(app).get(`${BASE}/job_1`).set('Authorization', bearer());

    expect(res.status).toBe(200);
    expect(res.body.data.job).toMatchObject({ progressPercent: 25, templateName: 'Semester Marksheet', zipFileUrl: null });
  });

  it('exposes the zip download URL once a zip exists', async () => {
    prismaMock.generationJob.findUnique.mockResolvedValue(
      job({ status: 'COMPLETED', processedRows: 4, zipFilePath: 'storage/zips/job_1/results.zip' })
    );

    const res = await request(app).get(`${BASE}/job_1`).set('Authorization', bearer());

    expect(res.body.data.job.progressPercent).toBe(100);
    expect(res.body.data.job.zipFileUrl).toBe('/api/v1/jobs/job_1/download/zip');
  });

  it("returns 403 for another user's job and 404 for an unknown job", async () => {
    prismaMock.generationJob.findUnique
      .mockResolvedValueOnce(job({ userId: OTHER_USER.id }))
      .mockResolvedValueOnce(null);

    const forbidden = await request(app).get(`${BASE}/job_1`).set('Authorization', bearer());
    const missing = await request(app).get(`${BASE}/nope`).set('Authorization', bearer());

    expect(forbidden.status).toBe(403);
    expect(missing.status).toBe(404);
  });
});

describe('POST /api/v1/jobs/:id/retry', () => {
  it('resets a FAILED job to PENDING and re-enqueues it', async () => {
    prismaMock.generationJob.findUnique.mockResolvedValue(job({ status: 'FAILED', errorMessage: 'boom' }));
    prismaMock.generationJob.update.mockResolvedValue({});
    pdfQueueMock.add.mockResolvedValue({});

    const res = await request(app).post(`${BASE}/job_1/retry`).set('Authorization', bearer());

    expect(res.status).toBe(202);
    expect(prismaMock.generationJob.update).toHaveBeenCalledWith({
      where: { id: 'job_1' },
      data: { status: 'PENDING', errorMessage: null },
    });
    expect(pdfQueueMock.add.mock.calls[0][1]).toMatchObject({ generationJobId: 'job_1', userId: USER.id });
  });

  it.each(['PENDING', 'PROCESSING', 'COMPLETED'])('returns 422 for a %s job', async status => {
    prismaMock.generationJob.findUnique.mockResolvedValue(job({ status }));

    const res = await request(app).post(`${BASE}/job_1/retry`).set('Authorization', bearer());

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('JOB_NOT_FAILED');
    expect(pdfQueueMock.add).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/v1/jobs/:id', () => {
  it('deletes a job the caller owns', async () => {
    prismaMock.generationJob.findUnique.mockResolvedValue(job());
    prismaMock.generationJob.delete.mockResolvedValue({});

    const res = await request(app).delete(`${BASE}/job_1`).set('Authorization', bearer());

    expect(res.status).toBe(200);
    expect(prismaMock.generationJob.delete).toHaveBeenCalledWith({ where: { id: 'job_1' } });
  });

  it("does not delete another user's job", async () => {
    prismaMock.generationJob.findUnique.mockResolvedValue(job({ userId: OTHER_USER.id }));

    const res = await request(app).delete(`${BASE}/job_1`).set('Authorization', bearer());

    expect(res.status).toBe(403);
    expect(prismaMock.generationJob.delete).not.toHaveBeenCalled();
  });

  it('returns 500 when the delete fails', async () => {
    prismaMock.generationJob.findUnique.mockResolvedValue(job());
    prismaMock.generationJob.delete.mockRejectedValue(new Error('foreign key violation'));

    const res = await request(app).delete(`${BASE}/job_1`).set('Authorization', bearer());

    expect(res.status).toBe(500);
  });
});

describe('GET /api/v1/health', () => {
  it('responds without authentication', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
