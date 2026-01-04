import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');

// Ensure dist exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy manifest.json
fs.copyFileSync(path.join(__dirname, '..', 'manifest.json'), path.join(distDir, 'manifest.json'));

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
