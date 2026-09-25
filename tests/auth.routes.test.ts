import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { app } from '../src/app';
import { prismaMock, USER, bearer } from './helpers/prismaMock';

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/refresh';
const LOGOUT = '/api/v1/auth/logout';
const ME = '/api/v1/auth/me';

const validRegistration = { name: 'Ada Lovelace', email: 'ada@example.test', password: 'Analytical1' };

const cookieHeader = (res: request.Response): string[] => {
  const raw = res.headers['set-cookie'] as unknown;
  return Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
};

const refreshCookieValue = (res: request.Response) => {
  const cookie = cookieHeader(res).find(c => c.startsWith('refreshToken='));
  return cookie?.split(';')[0].split('=')[1];
};

describe('POST /api/v1/auth/register', () => {
  const mockSuccessfulCreate = () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockImplementation(async ({ data }: any) => ({ id: 'user_new', role: 'USER', ...data }));
    prismaMock.refreshToken.create.mockResolvedValue({});
  };

  it('creates the user and returns 201 with the public profile and an access token', async () => {
    mockSuccessfulCreate();

    const res = await request(app).post(REGISTER).send(validRegistration);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toEqual({ id: 'user_new', name: 'Ada Lovelace', email: 'ada@example.test' });

    const decoded = jwt.verify(res.body.data.accessToken, process.env.JWT_SECRET!) as jwt.JwtPayload;
    expect(decoded.sub).toBe('user_new');
    expect(decoded.email).toBe('ada@example.test');
    expect(decoded.role).toBe('USER');
  });

  it('stores a bcrypt hash, never the plaintext password, and never returns the hash', async () => {
    mockSuccessfulCreate();

    const res = await request(app).post(REGISTER).send(validRegistration);

    const { data } = prismaMock.user.create.mock.calls[0][0];
    expect(data.password).toBeUndefined();
    expect(data.passwordHash).not.toBe(validRegistration.password);
    expect(await bcrypt.compare(validRegistration.password, data.passwordHash)).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(data.passwordHash);
  });

  it('persists the refresh token and sets it as an httpOnly strict cookie', async () => {
    mockSuccessfulCreate();

    const res = await request(app).post(REGISTER).send(validRegistration);

    const cookie = cookieHeader(res).find(c => c.startsWith('refreshToken='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);

    const stored = prismaMock.refreshToken.create.mock.calls[0][0].data;
    expect(stored.userId).toBe('user_new');
    expect(stored.token).toBe(refreshCookieValue(res));
    const daysAhead = (stored.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(daysAhead).toBeGreaterThan(29);
    expect(daysAhead).toBeLessThanOrEqual(30);
  });

  it('issues an access token that expires after 900 seconds when no expiry is configured', async () => {
    mockSuccessfulCreate();

    const res = await request(app).post(REGISTER).send(validRegistration);

    const decoded = jwt.decode(res.body.data.accessToken) as jwt.JwtPayload;
    expect(decoded.exp! - decoded.iat!).toBe(900);
  });

  it('returns 409 and creates nothing when the email is already registered', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'existing', email: validRegistration.email });

    const res = await request(app).post(REGISTER).send(validRegistration);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    expect(cookieHeader(res)).toHaveLength(0);
  });

  it.each([
    ['missing body', {}, ['name', 'email', 'password']],
    ['name too short', { ...validRegistration, name: 'A' }, ['name']],
    ['malformed email', { ...validRegistration, email: 'not-an-email' }, ['email']],
    ['password shorter than 8', { ...validRegistration, password: 'Ab1' }, ['password']],
    ['password without an uppercase letter', { ...validRegistration, password: 'analytical1' }, ['password']],
    ['password without a digit', { ...validRegistration, password: 'Analytical' }, ['password']],
    ['non-string name', { ...validRegistration, name: 12345 }, ['name']],
  ])('rejects %s with 400 VALIDATION_ERROR before touching the database', async (_label, body, fields) => {
    const res = await request(app).post(REGISTER).send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const failedFields = res.body.error.details.map((d: any) => d.path[1]);
    expect(failedFields.sort()).toEqual([...fields].sort());
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('returns 500 INTERNAL_ERROR without leaking details when the database fails', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockRejectedValue(new Error('connection refused on 5432'));

    const res = await request(app).post(REGISTER).send(validRegistration);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Registration failed', details: [] },
    });
  });
});

describe('POST /api/v1/auth/login', () => {
  const password = 'Correct-Horse9';
  let storedUser: any;

  beforeAll(async () => {
    storedUser = {
      id: USER.id,
      name: 'Owner',
      email: USER.email,
      role: 'USER',
      passwordHash: await bcrypt.hash(password, 4),
    };
  });

  it('returns 200 with the user (including role), an access token and a refresh cookie', async () => {
    prismaMock.user.findUnique.mockResolvedValue(storedUser);
    prismaMock.refreshToken.create.mockResolvedValue({});

    const res = await request(app).post(LOGIN).send({ email: USER.email, password });

    expect(res.status).toBe(200);
    expect(res.body.data.user).toEqual({ id: USER.id, name: 'Owner', email: USER.email, role: 'USER' });
    expect((jwt.verify(res.body.data.accessToken, process.env.JWT_SECRET!) as any).sub).toBe(USER.id);
    expect(refreshCookieValue(res)).toBe(prismaMock.refreshToken.create.mock.calls[0][0].data.token);
  });

  it('returns the same 401 for an unknown email and a wrong password', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(storedUser);

    const unknown = await request(app).post(LOGIN).send({ email: 'nobody@example.test', password });
    const wrong = await request(app).post(LOGIN).send({ email: USER.email, password: 'Wrong-Horse9' });

    for (const res of [unknown, wrong]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    }
    expect(unknown.body).toEqual(wrong.body);
    expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
  });

  it('rejects a malformed email or empty password with 400', async () => {
    const badEmail = await request(app).post(LOGIN).send({ email: 'nope', password });
    const noPassword = await request(app).post(LOGIN).send({ email: USER.email, password: '' });

    expect(badEmail.status).toBe(400);
    expect(noPassword.status).toBe(400);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('returns 500 when the user lookup throws', async () => {
    prismaMock.user.findUnique.mockRejectedValue(new Error('db down'));

    const res = await request(app).post(LOGIN).send({ email: USER.email, password });

    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe('Login failed');
  });
});

describe('POST /api/v1/auth/refresh', () => {
  const tokenRecord = (expiresAt: Date) => ({
    id: 'rt_1',
    token: 'old-refresh-token',
    userId: USER.id,
    expiresAt,
    user: { id: USER.id, email: USER.email, role: 'USER' },
  });

  it('rotates the refresh token and returns a new access token', async () => {
    prismaMock.refreshToken.findUnique.mockResolvedValue(tokenRecord(new Date(Date.now() + 60_000)));
    prismaMock.refreshToken.delete.mockResolvedValue({});
    prismaMock.refreshToken.create.mockResolvedValue({});

    const res = await request(app).post(REFRESH).set('Cookie', 'refreshToken=old-refresh-token');

    expect(res.status).toBe(200);
    expect((jwt.verify(res.body.data.accessToken, process.env.JWT_SECRET!) as any).sub).toBe(USER.id);
    expect(prismaMock.refreshToken.findUnique.mock.calls[0][0].where).toEqual({ token: 'old-refresh-token' });
    expect(prismaMock.refreshToken.delete).toHaveBeenCalledWith({ where: { id: 'rt_1' } });
    const newToken = refreshCookieValue(res);
    expect(newToken).toBeDefined();
    expect(newToken).not.toBe('old-refresh-token');
    expect(prismaMock.refreshToken.create.mock.calls[0][0].data.token).toBe(newToken);
  });

  it('returns 401 INVALID_REFRESH_TOKEN when no cookie is sent', async () => {
    const res = await request(app).post(REFRESH);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    expect(prismaMock.refreshToken.findUnique).not.toHaveBeenCalled();
  });

  it('returns 401 for an unknown token and for an expired token', async () => {
    prismaMock.refreshToken.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(tokenRecord(new Date(Date.now() - 1000)));

    const unknown = await request(app).post(REFRESH).set('Cookie', 'refreshToken=forged');
    const expired = await request(app).post(REFRESH).set('Cookie', 'refreshToken=old-refresh-token');

    expect(unknown.status).toBe(401);
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe('REFRESH_TOKEN_EXPIRED');
    expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('requires a bearer token', async () => {
    const res = await request(app).post(LOGOUT).set('Cookie', 'refreshToken=abc');

    expect(res.status).toBe(401);
    expect(prismaMock.refreshToken.deleteMany).not.toHaveBeenCalled();
  });

  it('revokes the refresh token from the cookie and clears it', async () => {
    prismaMock.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

    const res = await request(app).post(LOGOUT).set('Authorization', bearer()).set('Cookie', 'refreshToken=abc');

    expect(res.status).toBe(200);
    expect(prismaMock.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { token: 'abc' } });
    expect(cookieHeader(res).find(c => c.startsWith('refreshToken=;'))).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('succeeds without touching the database when there is no refresh cookie', async () => {
    const res = await request(app).post(LOGOUT).set('Authorization', bearer());

    expect(res.status).toBe(200);
    expect(prismaMock.refreshToken.deleteMany).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns the current user profile', async () => {
    const profile = { id: USER.id, name: 'Owner', email: USER.email, role: 'USER', createdAt: new Date().toISOString() };
    prismaMock.user.findUnique.mockResolvedValue(profile);

    const res = await request(app).get(ME).set('Authorization', bearer());

    expect(res.status).toBe(200);
    expect(res.body.data.user).toEqual(profile);
    const query = prismaMock.user.findUnique.mock.calls[0][0];
    expect(query.where).toEqual({ id: USER.id });
    expect(query.select.passwordHash).toBeUndefined();
  });

  it.each([
    ['no Authorization header', undefined],
    ['a non-Bearer scheme', `Basic ${Buffer.from('a:b').toString('base64')}`],
    ['an empty Bearer token', 'Bearer '],
    ['a token signed with another secret', `Bearer ${jwt.sign({ sub: USER.id }, 'some-other-secret')}`],
    ['an expired token', `Bearer ${jwt.sign({ sub: USER.id, exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET!)}`],
  ])('returns 401 UNAUTHORIZED for %s', async (_label, header) => {
    const req = request(app).get(ME);
    if (header !== undefined) req.set('Authorization', header);

    const res = await req;

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the token refers to a user that no longer exists', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await request(app).get(ME).set('Authorization', bearer());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });
});
