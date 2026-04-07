#!/bin/bash
# Patches Electron's Info.plist in dev mode so the dock shows "Chorus" instead of "Electron".
# Run before `electron-forge start`.

PLIST="node_modules/electron/dist/Electron.app/Contents/Info.plist"

if [ ! -f "$PLIST" ]; then
  exit 0
fi

if grep -q '<string>Electron</string>' "$PLIST"; then
  sed -i '' 's/<string>Electron<\/string>/<string>Chorus<\/string>/g' "$PLIST"
  echo "Patched Electron Info.plist → Chorus"
fi
