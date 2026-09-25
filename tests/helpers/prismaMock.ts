import { vi } from 'vitest';
import jwt from 'jsonwebtoken';

// In-memory stand-in for the Prisma client: only the delegates the routes touch.
export const prismaMock = {
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  refreshToken: {
    findUnique: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  template: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  generationJob: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};

export const pdfQueueMock = {
  add: vi.fn(),
  on: vi.fn(),
};

export const USER = { id: 'user_1', email: 'owner@example.test', role: 'USER' };
export const OTHER_USER = { id: 'user_2', email: 'other@example.test', role: 'USER' };

export const tokenFor = (user: { id: string; email: string; role: string }) =>
  jwt.sign({ sub: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET!, { expiresIn: 900 });

export const bearer = (user = USER) => `Bearer ${tokenFor(user)}`;
