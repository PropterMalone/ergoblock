import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(__dirname, '..', 'manifest.json');
const firefoxManifestPath = path.join(__dirname, '..', 'manifest.firefox.json');
const packageJsonPath = path.join(__dirname, '..', 'package.json');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

const filesToStage = [];

if (manifest.version !== packageJson.version) {
  console.log(
    `Syncing manifest.json version (${manifest.version}) to package.json version (${packageJson.version})`
  );
  manifest.version = packageJson.version;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  filesToStage.push('manifest.json');
}

// Also sync Firefox manifest if it exists
if (fs.existsSync(firefoxManifestPath)) {
  const firefoxManifest = JSON.parse(fs.readFileSync(firefoxManifestPath, 'utf8'));
  if (firefoxManifest.version !== packageJson.version) {
    console.log(
      `Syncing manifest.firefox.json version (${firefoxManifest.version}) to package.json version (${packageJson.version})`
    );
    firefoxManifest.version = packageJson.version;
    fs.writeFileSync(firefoxManifestPath, JSON.stringify(firefoxManifest, null, 2) + '\n');
    filesToStage.push('manifest.firefox.json');
  }
}

if (filesToStage.length > 0) {
  // Check if git is available before attempting to stage files
  let gitAvailable = false;
  try {
    execSync('git --version', { stdio: 'ignore' });
    gitAvailable = true;
  } catch {
    console.warn('Skipping git stage: git not available');
  }

  if (gitAvailable) {
    try {
      execSync(`git add ${filesToStage.join(' ')}`);
      console.log(`Staged ${filesToStage.join(', ')}`);
    } catch (error) {
      const stderr = error.stderr ? error.stderr.toString().trim() : '';
      console.error('Failed to stage files:', stderr || error.message);
    }
  }
}
