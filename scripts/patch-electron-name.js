#!/usr/bin/env node
// Patches the dev-mode Electron.app so macOS shows "Chorus" name and icon.
// Runs automatically via postinstall. Safe to re-run.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const APP_NAME = 'Chorus';

const electronAppDir = path.join(
  __dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents'
);
const plistPath = path.join(electronAppDir, 'Info.plist');
const iconSrc = path.join(__dirname, '..', 'assets', 'icons', 'icon.icns');
const iconDest = path.join(electronAppDir, 'Resources', 'Electron.icns');

if (!fs.existsSync(plistPath)) {
  console.log('[patch-electron] Electron.app not found, skipping.');
  process.exit(0);
}

try {
  // Patch app name
  execSync(`plutil -replace CFBundleDisplayName -string "${APP_NAME}" "${plistPath}"`);
  execSync(`plutil -replace CFBundleName -string "${APP_NAME}" "${plistPath}"`);
  console.log(`[patch-electron] Patched display name to "${APP_NAME}".`);

  // Patch icon
  if (fs.existsSync(iconSrc)) {
    fs.copyFileSync(iconSrc, iconDest);
    console.log('[patch-electron] Patched app icon.');
  }
} catch (err) {
  console.warn('[patch-electron] Failed to patch:', err.message);
}
