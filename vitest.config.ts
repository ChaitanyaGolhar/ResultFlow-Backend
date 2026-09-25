import { defineConfig } from 'vitest/config';
import os from 'os';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Test-only values: never real credentials. Logs and storage are kept out of the repo.
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-only-jwt-secret-not-used-anywhere-else',
      FRONTEND_URL: 'http://localhost:3000',
      LOG_FILE_PATH: path.join(os.tmpdir(), 'resultflow-test-logs'),
      STORAGE_LOCAL_PATH: path.join(os.tmpdir(), 'resultflow-test-storage'),
    },
  },
});
