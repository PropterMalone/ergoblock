import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      'webextension-polyfill': path.resolve(__dirname, './vitest.polyfill-mock.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      all: true,
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/content.ts',
        'src/popup.ts',
        'src/options.ts'
      ],
      thresholds: {
        lines: 75,
        functions: 70,
        branches: 65,
        statements: 75,
      }
    },
  },
});