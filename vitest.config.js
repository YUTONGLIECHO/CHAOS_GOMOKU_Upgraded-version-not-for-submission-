import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', include: ['web-app/tests/**/*.test.js'], reporters: 'verbose' },
});
