import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { VitePlugin } from "@electron-forge/plugin-vite";
import path from "path";
import fs from "fs";

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

const config: ForgeConfig = {
  packagerConfig: {
    name: "Chorus",
    asar: {
      unpack: "{**/*.node,**/spawn-helper}",
    },
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
  makers: [new MakerZIP({}, ["darwin"]), new MakerDMG({ format: "ULFO" })],
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
