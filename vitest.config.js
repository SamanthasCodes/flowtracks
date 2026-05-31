import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environmentMatchGlobs: [
      ['tests/integration/**', 'jsdom'],
      ['tests/unit/**', 'node']
    ],
    reporters: 'default',
    include: ['tests/**/*.test.js']
  }
});
