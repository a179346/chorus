import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { VitePlugin } from "@electron-forge/plugin-vite";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";

function copyNativeModules(buildPath: string) {
  const modulesToCopy = ["node-pty"];
  for (const mod of modulesToCopy) {
    const src = path.join(__dirname, "node_modules", mod);
    const dest = path.join(buildPath, "node_modules", mod);
    if (fs.existsSync(src)) {
      fs.cpSync(src, dest, { recursive: true });
    }
  }
}

/**
 * After packaging, extract spawn-helper from the asar into the unpacked
 * directory. AutoUnpackNativesPlugin only unpacks .node files, but node-pty
 * also needs the spawn-helper executable at runtime.
 */
function extractSpawnHelper(
  _config: ForgeConfig,
  packageResult: { outputPaths: string[] },
): void {
  for (const outputPath of packageResult.outputPaths) {
    // outputPath is e.g. out/Chorus-darwin-arm64, app bundle is inside it
    const appBundle = fs.readdirSync(outputPath).find((f) => f.endsWith(".app"));
    if (!appBundle) continue;
    const resourcesDir = path.join(outputPath, appBundle, "Contents", "Resources");
    const asarPath = path.join(resourcesDir, "app.asar");
    const unpackedDir = path.join(resourcesDir, "app.asar.unpacked");

    if (!fs.existsSync(asarPath)) continue;

    // Paths inside the asar where spawn-helper lives
    const spawnHelperPaths = [
      "node_modules/node-pty/build/Release/spawn-helper",
      "node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
      "node_modules/node-pty/prebuilds/darwin-x64/spawn-helper",
    ];

    // Extract full asar to a temp dir, then copy spawn-helper files
    const tmpDir = path.join(outputPath, "_asar_tmp");
    try {
      execSync(`npx asar extract "${asarPath}" "${tmpDir}"`, { stdio: "pipe" });

      for (const relPath of spawnHelperPaths) {
        const srcPath = path.join(tmpDir, relPath);
        if (!fs.existsSync(srcPath)) continue;

        const destPath = path.join(unpackedDir, relPath);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
        fs.chmodSync(destPath, 0o755);
        console.log(`[postPackage] Extracted ${relPath}`);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

const config: ForgeConfig = {
  packagerConfig: {
    name: "Chorus",
    asar: true,
    icon: "./assets/icons/icon",
    osxSign: {},
    osxNotarize: {
      appleId: process.env.APPLE_ID!,
      appleIdPassword: process.env.APPLE_ID_PASSWORD!,
      teamId: process.env.APPLE_TEAM_ID!,
    },
    afterCopy: [
      (
        buildPath: string,
        _electronVersion: string,
        _platform: string,
        _arch: string,
        callback: (err?: Error) => void,
      ) => {
        try {
          copyNativeModules(buildPath);
          callback();
        } catch (err) {
          callback(err as Error);
        }
      },
    ],
  },
  hooks: {
    postPackage: async (_config, packageResult) => {
      extractSpawnHelper(_config, packageResult);
    },
  },
  makers: [
    new MakerZIP({}, ["darwin"]),
    new MakerDMG({ format: "ULFO" }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: "src/main/index.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/main/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
  ],
};

export default config;
