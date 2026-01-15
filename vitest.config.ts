import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      'webextension-polyfill': path.resolve(__dirname, './vitest.polyfill-mock.ts'),
    },
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      all: true,
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/content.ts',
        'src/content.tsx',
        'src/popup.ts',
        'src/popup.tsx',
        'src/options.ts',
        'src/options.tsx',
        'src/manager.tsx',
        'src/browser.ts',
        'src/components/**',
        'src/hooks/**',
        'src/signals/**',
        'src/styles/**',
      ],
      thresholds: {
        // Global thresholds - lowered due to complex service worker code in background.ts
        lines: 35,
        functions: 40,
        branches: 30,
        statements: 35,
        // Per-file thresholds for core logic files
        'src/storage.ts': {
          lines: 65,
          functions: 50,
          branches: 55,
          statements: 65,
        },
        'src/post-context.ts': {
          lines: 75,
          functions: 90,
          branches: 70,
          statements: 75,
        },
        'src/types.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/carRepo.ts': {
          lines: 85,
          functions: 90,
          branches: 70,
          statements: 85,
        },
      },
    },
  },
});
