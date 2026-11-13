import { defineConfig } from 'vitest/config';

// Firestore security-rules tests. Run via `npm run test:rules` (starts the emulator).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
