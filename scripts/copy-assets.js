import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');

// Ensure dist exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy and transform manifest.json
const manifestPath = path.join(__dirname, '..', 'manifest.json');
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

// Sync version
manifest.version = packageJson.version;

// Update content scripts to use bundled file
if (manifest.content_scripts) {
  manifest.content_scripts = manifest.content_scripts.map(script => ({
    ...script,
    js: ['content.js']
  }));
}

fs.writeFileSync(
  path.join(distDir, 'manifest.json'),
  JSON.stringify(manifest, null, 2)
);

// Copy popup.html
fs.copyFileSync(path.join(__dirname, '..', 'popup.html'), path.join(distDir, 'popup.html'));

// Copy options.html
fs.copyFileSync(path.join(__dirname, '..', 'options.html'), path.join(distDir, 'options.html'));

// Copy icons folder
const iconsDir = path.join(__dirname, '..', 'icons');
const distIconsDir = path.join(distDir, 'icons');

if (!fs.existsSync(distIconsDir)) {
  fs.mkdirSync(distIconsDir, { recursive: true });
}

fs.readdirSync(iconsDir).forEach((file) => {
  if (file.endsWith('.png')) {
    fs.copyFileSync(path.join(iconsDir, file), path.join(distIconsDir, file));
  }
});

console.log('Assets copied to dist/');

export function copyAssets() {
  // Function for importing
}
