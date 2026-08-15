import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { buildWebDistribution } from "./build-web.js";
import {
  DESKTOP_ASAR_PACKAGE_FILES,
  DESKTOP_LEGAL_PACKAGE_FILES,
  copyExactRegularFileTree,
  snapshotExactRegularFileTree
} from "./desktop-package-files.js";
import { readPackageSourceFile } from "./package-source-reader.js";
import { WEB_PACKAGE_FILES } from "./web-package-files.js";

const root = fileURLToPath(new URL("..", import.meta.url));
export const DESKTOP_STAGE_ROOT = path.join(
  root,
  ".artifacts",
  "desktop-app"
);

export async function buildDesktopApplication(): Promise<string> {
  await buildWebDistribution();
  await rm(DESKTOP_STAGE_ROOT, { recursive: true, force: true });
  await mkdir(DESKTOP_STAGE_ROOT, { recursive: true, mode: 0o700 });
  await build({
    absWorkingDir: root,
    entryPoints: ["src/desktop/main.ts"],
    outfile: path.join(DESKTOP_STAGE_ROOT, "main.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["electron"],
    sourcemap: false,
    minify: false,
    legalComments: "eof",
    logLevel: "info"
  });
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
      sourceRoot: path.join(root, "web"),
      destinationRoot: path.join(DESKTOP_STAGE_ROOT, "web"),
      expectedFiles: WEB_PACKAGE_FILES,
      label: "desktop web",
      // Historical local runs can leave empty directories in web/. They carry
      // no bytes and are never copied; every file and every symlink still fails
      // closed against WEB_PACKAGE_FILES.
      sourceOptions: { rejectUnexpectedDirectories: false }
    }),
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
