import { vi, beforeEach } from 'vitest';
import { prismaMock, pdfQueueMock } from './helpers/prismaMock';

// Keep the suite offline: no Postgres (Prisma) and no Redis (BullMQ).
vi.mock('../src/utils/prisma', () => ({ default: prismaMock }));
vi.mock('../src/utils/queue', () => ({ pdfQueue: pdfQueueMock, redisOptions: {} }));

beforeEach(() => {
  vi.resetAllMocks();
});
