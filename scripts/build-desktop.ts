import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import {
  DESKTOP_ASAR_PACKAGE_FILES,
  DESKTOP_LEGAL_PACKAGE_FILES,
  copyExactRegularFileTree,
  snapshotExactRegularFileTree
} from "./desktop-package-files.js";
import { readPackageSourceFile } from "./package-source-reader.js";
import { normalizeDesktopBuildChannel } from "../src/desktop/build-channel.js";

const root = fileURLToPath(new URL("..", import.meta.url));
export const DESKTOP_STAGE_ROOT = path.join(
  root,
  ".artifacts",
  "desktop-app"
);

async function buildStreamingFrameActionSource(): Promise<string> {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["src/streaming-electron-frame-action.ts"],
    bundle: true,
    platform: "browser",
    format: "iife",
    globalName: "KirinukiStreamingFrameAction",
    target: "chrome120",
    write: false,
    sourcemap: false,
    minify: true,
    legalComments: "none",
    logLevel: "silent"
  });
  const output = result.outputFiles?.[0]?.text;
  if (!output || output.length > 256 * 1024) {
    throw new Error("Electron streaming frame action bundle이 없거나 너무 큽니다.");
  }
  return output;
}

async function buildStreamingShortcutGuardSource(): Promise<string> {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["src/desktop/cut-window-shortcut-guard.ts"],
    bundle: true,
    platform: "browser",
    format: "iife",
    globalName: "KirinukiStreamingShortcutGuard",
    target: "chrome120",
    write: false,
    sourcemap: false,
    minify: true,
    legalComments: "none",
    logLevel: "silent"
  });
  const output = result.outputFiles?.[0]?.text;
  if (!output || output.length > 64 * 1024) {
    throw new Error("Electron streaming shortcut guard bundle이 없거나 너무 큽니다.");
  }
  return output;
}

export async function buildDesktopApplication(): Promise<string> {
  const buildChannel = normalizeDesktopBuildChannel(
    process.env.KIRINUKI_INSTALLER_CHANNEL
  );
  const [streamingFrameActionSource, streamingShortcutGuardSource] =
    await Promise.all([
      buildStreamingFrameActionSource(),
      buildStreamingShortcutGuardSource()
    ]);
  await rm(DESKTOP_STAGE_ROOT, { recursive: true, force: true });
  await mkdir(DESKTOP_STAGE_ROOT, { recursive: true, mode: 0o700 });
  await Promise.all([
    build({
      absWorkingDir: root,
      entryPoints: ["src/desktop/main.ts"],
      outfile: path.join(DESKTOP_STAGE_ROOT, "main.mjs"),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      external: ["electron"],
      define: {
        __KIRINUKI_DESKTOP_BUILD_CHANNEL__: JSON.stringify(buildChannel),
        __KIRINUKI_STREAMING_FRAME_ACTION_SOURCE__: JSON.stringify(
          streamingFrameActionSource
        ),
        __KIRINUKI_STREAMING_SHORTCUT_GUARD_SOURCE__: JSON.stringify(
          streamingShortcutGuardSource
        )
      },
      sourcemap: false,
      minify: false,
      legalComments: "eof",
      logLevel: "info"
    }),
    build({
      absWorkingDir: root,
      entryPoints: ["src/desktop/cut-window-preload.ts"],
      outfile: path.join(DESKTOP_STAGE_ROOT, "preload.cjs"),
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node24",
      external: ["electron"],
      sourcemap: false,
      minify: false,
      legalComments: "eof",
      logLevel: "info"
    })
  ]);
  const sourcePackage = JSON.parse((await readPackageSourceFile({
    repositoryRoot: root,
    repositoryPath: "package.json"
  })).toString("utf8")) as { version?: unknown };
  if (
    typeof sourcePackage.version !== "string"
    || !/^\d+\.\d+\.\d+$/u.test(sourcePackage.version)
  ) {
    throw new Error("데스크톱 앱 package version이 올바르지 않습니다.");
  }
  const desktopPackage = {
    name: "kirinuki",
    productName: "Kirinuki",
    version: sourcePackage.version,
    license: "Unlicense",
    type: "module",
    main: "main.mjs"
  };
  const unlicense = await readPackageSourceFile({
    repositoryRoot: root,
    repositoryPath: "UNLICENSE"
  });
  await Promise.all([
    copyExactRegularFileTree({
      sourceRoot: path.join(root, "legal"),
      destinationRoot: path.join(DESKTOP_STAGE_ROOT, "legal"),
      expectedFiles: DESKTOP_LEGAL_PACKAGE_FILES,
      label: "desktop legal"
    }),
    writeFile(
      path.join(DESKTOP_STAGE_ROOT, "UNLICENSE"),
      unlicense,
      { flag: "wx", mode: 0o644 }
    ),
    writeFile(
      path.join(DESKTOP_STAGE_ROOT, "package.json"),
      `${JSON.stringify(desktopPackage, null, 2)}\n`,
      { flag: "wx", mode: 0o644 }
    )
  ]);
  await snapshotExactRegularFileTree(
    DESKTOP_STAGE_ROOT,
    DESKTOP_ASAR_PACKAGE_FILES,
    "desktop application stage"
  );
  return DESKTOP_STAGE_ROOT;
}

const invokedPath = process.argv[1];
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) {
    throw new TypeError("사용법: build-desktop.ts");
  }
  console.log(await buildDesktopApplication());
}
