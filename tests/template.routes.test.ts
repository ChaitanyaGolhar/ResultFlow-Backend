import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prismaMock, USER, OTHER_USER, bearer } from './helpers/prismaMock';

const BASE = '/api/v1/templates';

const template = (overrides: Record<string, unknown> = {}) => ({
  id: 'tpl_1',
  userId: USER.id,
  name: 'Semester Marksheet',
  description: null,
  fileType: 'PDF',
  filePath: '/storage/templates/user_1/sheet.pdf',
  thumbnailPath: null,
  isDeleted: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('authentication on /api/v1/templates', () => {
  it.each([
    ['get', BASE],
    ['get', `${BASE}/tpl_1`],
    ['put', `${BASE}/tpl_1`],
    ['delete', `${BASE}/tpl_1`],
  ] as const)('%s %s returns 401 without a token', async (method, url) => {
    const res = await request(app)[method](url);

    expect(res.status).toBe(401);
    expect(prismaMock.template.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.template.findMany).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/templates', () => {
  it("lists only the caller's non-deleted templates with default pagination", async () => {
    prismaMock.template.findMany.mockResolvedValue([template({ _count: { components: 3 } })]);
    prismaMock.template.count.mockResolvedValue(1);

    const res = await request(app).get(BASE).set('Authorization', bearer());

    expect(res.status).toBe(200);
    expect(res.body.data.templates).toEqual([
      {
        id: 'tpl_1',
        name: 'Semester Marksheet',
        fileType: 'PDF',
        thumbnailUrl: null,
        fieldCount: 3,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    expect(res.body.data.pagination).toEqual({ total: 1, page: 1, limit: 10, totalPages: 1 });
    const query = prismaMock.template.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ userId: USER.id, isDeleted: false });
    expect(query).toMatchObject({ skip: 0, take: 10 });
  });

  it('applies page, limit and a case-insensitive name search', async () => {
    prismaMock.template.findMany.mockResolvedValue([]);
    prismaMock.template.count.mockResolvedValue(25);

    const res = await request(app).get(`${BASE}?page=3&limit=5&search=mark`).set('Authorization', bearer());

    expect(res.body.data.pagination).toEqual({ total: 25, page: 3, limit: 5, totalPages: 5 });
    const query = prismaMock.template.findMany.mock.calls[0][0];
    expect(query).toMatchObject({ skip: 10, take: 5 });
    expect(query.where.name).toEqual({ contains: 'mark', mode: 'insensitive' });
    expect(prismaMock.template.count.mock.calls[0][0].where).toEqual(query.where);
  });

  it('returns 500 when the query fails', async () => {
    prismaMock.template.findMany.mockRejectedValue(new Error('db down'));
    prismaMock.template.count.mockResolvedValue(0);

    const res = await request(app).get(BASE).set('Authorization', bearer());

    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe('Failed to list templates');
  });
});

describe('GET /api/v1/templates/:id', () => {
  it('returns the template with only data-bound components exposed as fields', async () => {
    prismaMock.template.findUnique
      .mockResolvedValueOnce(template()) // ownership check
      .mockResolvedValueOnce(
        template({
          components: [
            { id: 'c1', fieldKey: 'student_name', type: 'TEXT' },
            { id: 'c2', fieldKey: null, type: 'STATIC_TEXT' },
          ],
        })
      );

    const res = await request(app).get(`${BASE}/tpl_1`).set('Authorization', bearer());

    expect(res.status).toBe(200);
    expect(res.body.data.template.fileUrl).toBe('/storage/templates/user_1/sheet.pdf');
    expect(res.body.data.template.fields).toEqual([{ id: 'c1', fieldKey: 'student_name', type: 'TEXT' }]);
  });

  it('returns 404 when the template does not exist', async () => {
    prismaMock.template.findUnique.mockResolvedValue(null);

    const res = await request(app).get(`${BASE}/missing`).set('Authorization', bearer());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it("returns 403 for another user's template", async () => {
    prismaMock.template.findUnique.mockResolvedValue(template({ userId: OTHER_USER.id }));

    const res = await request(app).get(`${BASE}/tpl_1`).set('Authorization', bearer());

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(prismaMock.template.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('PUT /api/v1/templates/:id', () => {
  it('updates name and description for the owner', async () => {
    prismaMock.template.findUnique.mockResolvedValue(template());
    prismaMock.template.update.mockImplementation(async ({ data }: any) => template(data));

    const res = await request(app)
      .put(`${BASE}/tpl_1`)
      .set('Authorization', bearer())
      .send({ name: 'Final Marksheet', description: 'Term 2' });

    expect(res.status).toBe(200);
    expect(res.body.data.template).toMatchObject({ name: 'Final Marksheet', description: 'Term 2' });
    expect(prismaMock.template.update).toHaveBeenCalledWith({
      where: { id: 'tpl_1' },
      data: { name: 'Final Marksheet', description: 'Term 2' },
    });
  });

  it.each([
    ['an empty name', { name: '' }],
    ['a name over 200 characters', { name: 'x'.repeat(201) }],
    ['a description over 1000 characters', { description: 'x'.repeat(1001) }],
    ['a non-string name', { name: 42 }],
  ])('rejects %s with 400 and does not update', async (_label, body) => {
    prismaMock.template.findUnique.mockResolvedValue(template());

    const res = await request(app).put(`${BASE}/tpl_1`).set('Authorization', bearer()).send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(prismaMock.template.update).not.toHaveBeenCalled();
  });

  it("does not let a user update someone else's template", async () => {
    prismaMock.template.findUnique.mockResolvedValue(template({ userId: OTHER_USER.id }));

    const res = await request(app).put(`${BASE}/tpl_1`).set('Authorization', bearer()).send({ name: 'Hijacked' });

    expect(res.status).toBe(403);
    expect(prismaMock.template.update).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/v1/templates/:id', () => {
  it('soft-deletes the template instead of removing the row', async () => {
    prismaMock.template.findUnique.mockResolvedValue(template());
    prismaMock.template.update.mockResolvedValue(template({ isDeleted: true }));

    const res = await request(app).delete(`${BASE}/tpl_1`).set('Authorization', bearer());

    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe('Template deleted');
    expect(prismaMock.template.update).toHaveBeenCalledWith({ where: { id: 'tpl_1' }, data: { isDeleted: true } });
  });

  it("returns 403 for another user's template", async () => {
    prismaMock.template.findUnique.mockResolvedValue(template({ userId: OTHER_USER.id }));

    const res = await request(app).delete(`${BASE}/tpl_1`).set('Authorization', bearer());

    expect(res.status).toBe(403);
    expect(prismaMock.template.update).not.toHaveBeenCalled();
  });

  it('returns 500 when the update fails', async () => {
    prismaMock.template.findUnique.mockResolvedValue(template());
    prismaMock.template.update.mockRejectedValue(new Error('db down'));

    const res = await request(app).delete(`${BASE}/tpl_1`).set('Authorization', bearer());

    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe('Delete failed');
  });
});
