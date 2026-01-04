import esbuild from 'esbuild';
import { copyAssets } from './copy-assets.js';

async function build() {
  try {
    // Copy assets first
    copyAssets();

    // Build TypeScript files
    const entryPoints = ['src/background.ts', 'src/content.ts', 'src/popup.ts', 'src/options.ts'];

    for (const entry of entryPoints) {
      // Use IIFE for background/content (Chrome isolated contexts)
      // Use ESM for popup/options (HTML pages support ES modules)
      const isBackgroundOrContent = entry.includes('background') || entry.includes('content');

      await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        format: isBackgroundOrContent ? 'iife' : 'esm',
        target: 'es2020',
        outdir: 'dist',
        outExtension: { '.js': '.js' },
        sourcemap: false,
        minify: false,
        platform: 'browser',
      });
    }

    console.log('Build completed successfully');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
