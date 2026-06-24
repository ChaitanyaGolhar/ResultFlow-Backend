import { Queue } from 'bullmq';

const redisUrl = new URL(process.env.REDIS_URL || 'redis://localhost:6379');

export const redisOptions: any = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379', 10),
  username: redisUrl.username ? decodeURIComponent(redisUrl.username) : undefined,
  password: redisUrl.password ? decodeURIComponent(redisUrl.password) : undefined,
  maxRetriesPerRequest: null,
};

if (redisUrl.protocol === 'rediss:') {
  redisOptions.tls = {};
}

export const pdfQueue = new Queue('pdf-generation', {
  connection: redisOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { age: 86400 * 7 },  // Keep 7 days
    removeOnFail: { age: 86400 * 30 }      // Keep 30 days
  }
});

pdfQueue.on('error', (err) => {
  console.error('BullMQ Queue Error:', err.message);
});
