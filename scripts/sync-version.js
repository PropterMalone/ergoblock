import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(__dirname, '..', 'manifest.json');
const packageJsonPath = path.join(__dirname, '..', 'package.json');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

if (manifest.version !== packageJson.version) {
  console.log(
    `Syncing manifest.json version (${manifest.version}) to package.json version (${packageJson.version})`
  );
  manifest.version = packageJson.version;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  // Check if git is available before attempting to stage the file
  let gitAvailable = false;
  try {
    execSync('git --version', { stdio: 'ignore' });
    gitAvailable = true;
  } catch {
    console.warn('Skipping git stage: git not available');
  }

  if (gitAvailable) {
    try {
      execSync('git add manifest.json');
      console.log('Staged manifest.json');
    } catch (error) {
      const stderr = error.stderr ? error.stderr.toString().trim() : '';
      console.error('Failed to stage manifest.json:', stderr || error.message);
    }
  }
}
