import esbuild from 'esbuild';
import { copyAssets } from './copy-assets.js';
import fs from 'fs';
import path from 'path';

async function build() {
  try {
    // Parse CLI arguments
    const args = process.argv.slice(2);
    const targetArg = args.find((arg) => arg.startsWith('--target='));
    const target = targetArg ? targetArg.split('=')[1] : 'chrome';

    // Validate target
    if (!['chrome', 'firefox'].includes(target)) {
      console.error('Invalid target. Use --target=chrome or --target=firefox');
      process.exit(1);
    }

    console.log(`Building for ${target}...`);

    // Copy assets first
    copyAssets();

    // Dynamically find all entry points in src/
    // We want background.ts, content.ts, popup.ts, and options.ts
    // but not types.ts or tests
    const srcDir = './src';

    // Find all entry points, preferring .tsx over .ts when both exist
    const tsFiles = fs
      .readdirSync(srcDir)
      .filter(
        (file) =>
          (file.endsWith('.ts') || file.endsWith('.tsx')) &&
          !file.endsWith('.test.ts') &&
          !file.endsWith('.test.tsx') &&
          file !== 'types.ts'
      );

    // Build a map of base names to prefer .tsx files
    const entryMap = new Map();
    for (const file of tsFiles) {
      const baseName = file.replace(/\.tsx?$/, '');
      const isTsx = file.endsWith('.tsx');
      // Prefer .tsx over .ts
      if (!entryMap.has(baseName) || isTsx) {
        entryMap.set(baseName, file);
      }
    }

    const entryPoints = Array.from(entryMap.values()).map((file) => path.join(srcDir, file));

    console.log('Building entry points:', entryPoints);

    await esbuild.build({
      entryPoints,
      bundle: true,
      format: 'esm',
      target: 'es2020',
      outdir: 'dist',
      outExtension: { '.js': '.js' },
      sourcemap: process.env.NODE_ENV === 'development',
      minify: process.env.NODE_ENV === 'production',
      external: ['chrome'],
      jsx: 'automatic',
      jsxImportSource: 'preact',
      loader: {
        '.ts': 'ts',
        '.tsx': 'tsx',
      },
    });

    // Copy the appropriate manifest to dist/
    const manifestSource = target === 'firefox' ? './manifest.firefox.json' : './manifest.json';
    const manifestDest = './dist/manifest.json';
    const manifestContent = fs.readFileSync(manifestSource, 'utf-8');
    fs.writeFileSync(manifestDest, manifestContent);

    console.log(`Build completed successfully for ${target}`);
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
