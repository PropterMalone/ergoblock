import esbuild from 'esbuild';
import { copyAssets } from './copy-assets.js';

async function build() {
  try {
    // Copy assets first
    copyAssets();

    // Build TypeScript files
    const entryPoints = ['src/background.ts', 'src/content.ts', 'src/popup.ts', 'src/options.ts'];

    for (const entry of entryPoints) {
      await esbuild.build({
        entryPoints: [entry],
        bundle: false,
        format: 'esm',
        target: 'es2020',
        outdir: 'dist',
        outExtension: { '.js': '.js' },
        sourcemap: false,
        minify: false,
        external: ['chrome'],
      });
    }

    console.log('Build completed successfully');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
