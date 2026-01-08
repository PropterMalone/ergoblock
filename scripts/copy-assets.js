import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');

export function copyAssets() {
  // Ensure dist exists
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // Build manager.css by concatenating Open Props + custom styles
  const openPropsPath = path.join(__dirname, '..', 'node_modules', 'open-props', 'open-props.min.css');
  const customCssPath = path.join(__dirname, '..', 'src', 'styles', 'manager.css');

  if (fs.existsSync(openPropsPath) && fs.existsSync(customCssPath)) {
    const openPropsCSS = fs.readFileSync(openPropsPath, 'utf8');
    let customCSS = fs.readFileSync(customCssPath, 'utf8');

    // Remove @import statements since we're concatenating
    customCSS = customCSS.replace(/@import\s+['"][^'"]+['"];?\s*/g, '');

    const combinedCSS = `/* Open Props */\n${openPropsCSS}\n\n/* ErgoBlock Custom Styles */\n${customCSS}`;
    fs.writeFileSync(path.join(distDir, 'manager.css'), combinedCSS);
    console.log('Built manager.css with Open Props');
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
    manifest.content_scripts = manifest.content_scripts.map((script) => ({
      ...script,
      js: ['content.js'],
    }));
  }

  fs.writeFileSync(path.join(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Copy popup.html
  fs.copyFileSync(path.join(__dirname, '..', 'popup.html'), path.join(distDir, 'popup.html'));

  // Copy options.html
  fs.copyFileSync(path.join(__dirname, '..', 'options.html'), path.join(distDir, 'options.html'));

  // Copy manager.html
  const managerHtmlPath = path.join(__dirname, '..', 'src', 'manager.html');
  if (fs.existsSync(managerHtmlPath)) {
    fs.copyFileSync(managerHtmlPath, path.join(distDir, 'manager.html'));
  }

  // Copy icons folder
  const iconsDir = path.join(__dirname, '..', 'icons');
  const distIconsDir = path.join(distDir, 'icons');

  if (!fs.existsSync(distIconsDir)) {
    fs.mkdirSync(distIconsDir, { recursive: true });
  }

  fs.readdirSync(iconsDir).forEach((file) => {
    if (path.extname(file).toLowerCase() === '.png') {
      fs.copyFileSync(path.join(iconsDir, file), path.join(distIconsDir, file));
    }
  });

  console.log('Assets copied to dist/');
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  copyAssets();
}
