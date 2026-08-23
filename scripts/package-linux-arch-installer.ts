#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdtemp,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  LINUX_PREVIEW_ARCH_SOURCE_INSTALLER_FILE,
  LINUX_PREVIEW_ARCH_SOURCE_MANIFEST_FILE,
  LINUX_PREVIEW_ARCH_SOURCE_MANIFEST_SCHEMA
} from "../src/desktop/installer-contract.js";
import { LOCAL_MEDIA_ENGINE_COMPATIBILITY_POLICY } from "../src/lib/local-media-engine-contract.js";
import {
  verifyPackagedDesktopTools
} from "./package-desktop.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const execFileAsync = promisify(execFile);
const BUILD_TIMEOUT_MS = 30 * 60 * 1_000;
const outputDirectory = path.join(root, "dist", "installers", "arch-linux-x64");

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function run(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd = root
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      env,
      stdio: "inherit",
      shell: false,
      windowsHide: true
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Arch Linux installer build가 시간 제한을 넘었습니다."));
    }, BUILD_TIMEOUT_MS);
    timer.unref?.();
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && signal === null) {
        resolve();
      } else {
        reject(new Error(
          `Arch Linux installer build 실패: code=${code ?? "null"}, signal=${signal ?? "none"}`
        ));
      }
    });
  });
}

async function stableFileIdentity(filePath: string): Promise<Readonly<{
  bytes: number;
  sha256: string;
}>> {
  const metadata = await lstat(filePath);
  invariant(
    metadata.isFile()
      && !metadata.isSymbolicLink()
      && metadata.nlink === 1
      && metadata.size > 100_000
      && metadata.size <= 2 * 1024 * 1024 * 1024,
    "Arch Linux installer가 안전한 regular file이 아닙니다."
  );
  const handle = await open(
    filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)
  );
  try {
    const before = await handle.stat();
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    while (offset < before.size) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.byteLength, before.size - offset),
        offset
      );
      invariant(bytesRead > 0, "Arch Linux installer를 끝까지 읽지 못했습니다.");
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const after = await handle.stat();
    invariant(
      before.dev === after.dev
        && before.ino === after.ino
        && before.size === after.size
        && before.mtimeMs === after.mtimeMs
        && before.ctimeMs === after.ctimeMs,
      "Arch Linux installer가 hash 중 바뀌었습니다."
    );
    return Object.freeze({ bytes: before.size, sha256: hash.digest("hex") });
  } finally {
    await handle.close();
  }
}

async function verifyArchPackage(artifactPath: string): Promise<Readonly<{
  packageName: string;
  version: string;
}>> {
  const canonical = await realpath(artifactPath);
  invariant(canonical === artifactPath, "Arch Linux installer path가 canonical하지 않습니다.");
  const archive = await execFileAsync("bsdtar", ["-tf", artifactPath], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 60_000
  });
  const entries = archive.stdout
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((entry) => entry.replace(/^\.\//u, ""));
  invariant(entries.includes(".PKGINFO"), "Arch package에 .PKGINFO가 없습니다.");
  invariant(entries.includes(".MTREE"), "Arch package에 .MTREE가 없습니다.");
  invariant(
    entries.filter((entry) => entry === "usr/share/applications/kr.eff0rtchung.kirinuki.desktop").length === 1,
    "Arch package desktop entry가 exact path에 유일하지 않습니다."
  );
  invariant(
    entries.filter((entry) => entry === "opt/Kirinuki/resources/app.asar").length === 1,
    "Arch package app.asar가 exact path에 유일하지 않습니다."
  );
  invariant(
    entries.filter((entry) => entry === "opt/Kirinuki/Kirinuki").length === 1,
    "Arch package executable이 exact path에 유일하지 않습니다."
  );
  invariant(
    entries.every((entry) => !entry.startsWith("/") && !entry.split("/").includes("..")),
    "Arch package에 absolute 또는 traversal entry가 있습니다."
  );
  const packageInfo = await execFileAsync("bsdtar", ["-xOf", artifactPath, ".PKGINFO"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024,
    timeout: 60_000
  });
  const field = (name: string): string[] => packageInfo.stdout
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(`${name} = `))
    .map((line) => line.slice(name.length + 3));
  const packageNames = field("pkgname");
  const versions = field("pkgver");
  invariant(
    JSON.stringify(packageNames) === JSON.stringify(["kirinuki-engine"]),
    "Arch package name이 exact contract와 다릅니다."
  );
  invariant(
    versions.length === 1 && /^\d+\.\d+\.\d+-\d+$/u.test(versions[0]!),
    "Arch package version이 올바르지 않습니다."
  );
  return Object.freeze({ packageName: packageNames[0]!, version: versions[0]! });
}

export async function packageLinuxArchInstaller(): Promise<Readonly<{
  artifactPath: string;
  manifestPath: string;
}>> {
  invariant(
    process.platform === "linux" && process.arch === "x64",
    "Arch Linux installer는 Linux x64에서만 만들 수 있습니다."
  );
  const packageJson = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8")
  ) as { version?: unknown };
  invariant(
    typeof packageJson.version === "string"
      && /^\d+\.\d+\.\d+$/u.test(packageJson.version),
    "package version이 올바르지 않습니다."
  );
  const prepackagedDirectory = path.join(
    root,
    "dist",
    "desktop",
    "linux-x64",
    "Kirinuki-linux-x64"
  );
  const prepackagedMetadata = await lstat(prepackagedDirectory);
  invariant(
    prepackagedMetadata.isDirectory()
      && !prepackagedMetadata.isSymbolicLink()
      && await realpath(prepackagedDirectory) === prepackagedDirectory,
    "Arch package의 prepackaged Linux x64 app이 없습니다. 먼저 package:desktop:installer를 실행하세요."
  );
  await verifyPackagedDesktopTools(
    path.join(prepackagedDirectory, "resources"),
    "linux-x64"
  );
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-arch-package-"));
  try {
    const desktopFilePath = path.join(buildRoot, "kr.eff0rtchung.kirinuki.desktop");
    await writeFile(desktopFilePath, [
      "[Desktop Entry]",
      "Name=Kirinuki 도우미",
      "Comment=Kirinuki 웹 편집기용 로컬 영상 도우미",
      "Exec=/opt/Kirinuki/Kirinuki %U",
      "Terminal=false",
      "Type=Application",
      "Icon=Kirinuki",
      "Categories=AudioVideo;Video;",
      "MimeType=x-scheme-handler/kirinuki-engine;",
      "StartupWMClass=Kirinuki",
      ""
    ].join("\n"), { mode: 0o644 });
    const dependencies = [
      "alsa-lib", "at-spi2-core", "cairo", "dbus", "expat", "gcc-libs",
      "glib2", "glibc", "gtk3", "libcups", "libdrm", "libnotify",
      "libsecret", "libx11", "libxcb", "libxcomposite", "libxdamage",
      "libxext", "libxfixes", "libxkbcommon", "libxrandr", "mesa",
      "nspr", "nss", "pango", "systemd-libs", "xdg-utils"
    ];
    const packageBuild = [
      "pkgname=kirinuki-engine",
      `pkgver=${packageJson.version}`,
      "pkgrel=1",
      "pkgdesc='Kirinuki web editor local video helper'",
      "arch=('x86_64')",
      "url='https://kirinuki.eff0rtchung.kr'",
      "license=('Unlicense')",
      `depends=(${dependencies.map((dependency) => `'${dependency}'`).join(" ")})`,
      "options=('!strip' '!debug' '!emptydirs')",
      "package() {",
      "  install -d -m755 \"$pkgdir/opt/Kirinuki\"",
      "  cp -a -- \"$KIRINUKI_PREPACKAGED_DIR/.\" \"$pkgdir/opt/Kirinuki/\"",
      "  chown -R 0:0 \"$pkgdir/opt/Kirinuki\"",
      "  chmod 0755 \"$pkgdir/opt/Kirinuki/Kirinuki\"",
      "  chmod 4755 \"$pkgdir/opt/Kirinuki/chrome-sandbox\"",
      "  install -Dm644 \"$KIRINUKI_ICON_PATH\" \"$pkgdir/usr/share/icons/hicolor/scalable/apps/Kirinuki.svg\"",
      "  install -Dm644 \"$KIRINUKI_DESKTOP_PATH\" \"$pkgdir/usr/share/applications/kr.eff0rtchung.kirinuki.desktop\"",
      "}",
      ""
    ].join("\n");
    await writeFile(path.join(buildRoot, "PKGBUILD"), packageBuild, { mode: 0o600 });
    await run("makepkg", ["--clean", "--cleanbuild", "--force", "--nodeps", "--noconfirm"], {
      ...process.env,
      KIRINUKI_PREPACKAGED_DIR: prepackagedDirectory,
      KIRINUKI_ICON_PATH: path.join(root, "build", "icon.svg"),
      KIRINUKI_DESKTOP_PATH: desktopFilePath,
      PKGDEST: outputDirectory,
      SRCDEST: path.join(buildRoot, "sources"),
      BUILDDIR: path.join(buildRoot, "build")
    }, buildRoot);
    const generatedArtifact = path.join(
      outputDirectory,
      `kirinuki-engine-${packageJson.version}-1-x86_64.pkg.tar.zst`
    );
    await rename(
      generatedArtifact,
      path.join(outputDirectory, LINUX_PREVIEW_ARCH_SOURCE_INSTALLER_FILE)
    );
  } finally {
    await rm(buildRoot, { recursive: true, force: true });
  }
  const artifactPath = path.join(
    outputDirectory,
    LINUX_PREVIEW_ARCH_SOURCE_INSTALLER_FILE
  );
  const artifact = await stableFileIdentity(artifactPath);
  const packageMetadata = await verifyArchPackage(artifactPath);
  const manifestPath = path.join(
    outputDirectory,
    LINUX_PREVIEW_ARCH_SOURCE_MANIFEST_FILE
  );
  const manifest = Object.freeze({
    schema: LINUX_PREVIEW_ARCH_SOURCE_MANIFEST_SCHEMA,
    status: "unsigned-test-only",
    channel: "ci-test-only",
    target: "linux-x64",
    distribution: "arch-linux-x64",
    format: "pacman",
    packageName: packageMetadata.packageName,
    packageVersion: packageMetadata.version,
    artifact: Object.freeze({
      fileName: LINUX_PREVIEW_ARCH_SOURCE_INSTALLER_FILE,
      bytes: artifact.bytes,
      sha256: artifact.sha256
    }),
    source: Object.freeze({ appVersion: packageJson.version }),
    release: null,
    updater: Object.freeze({
      bundled: false,
      telemetry: false,
      publicNetworkPolling: false,
      unsignedUpdatesAllowed: false,
      compatibilityPolicy: LOCAL_MEDIA_ENGINE_COMPATIBILITY_POLICY.id,
      replacement: "verified-github-preview-package-only"
    })
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
    mode: 0o644
  });
  const entries = (await readdir(outputDirectory, { withFileTypes: true }))
    .map((entry) => `${entry.isFile() && !entry.isSymbolicLink() ? "f" : "x"}:${entry.name}`)
    .sort();
  invariant(
    JSON.stringify(entries) === JSON.stringify([
      `f:${LINUX_PREVIEW_ARCH_SOURCE_INSTALLER_FILE}`,
      `f:${LINUX_PREVIEW_ARCH_SOURCE_MANIFEST_FILE}`
    ].sort()),
    "Arch installer output tree가 exact contract와 다릅니다."
  );
  return Object.freeze({ artifactPath, manifestPath });
}

const invokedPath = process.argv[1];
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    throw new TypeError("사용법: package-linux-arch-installer.ts");
  }
  console.log(JSON.stringify(await packageLinuxArchInstaller(), null, 2));
}
