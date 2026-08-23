#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  open,
  readFile,
  readdir,
  realpath
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  LINUX_PREVIEW_ARCH_SOURCE_INSTALLER_FILE,
  LINUX_PREVIEW_ARCH_SOURCE_MANIFEST_FILE,
  LINUX_PREVIEW_ARCH_SOURCE_MANIFEST_SCHEMA
} from "../src/desktop/installer-contract.js";
import { LOCAL_MEDIA_ENGINE_COMPATIBILITY_POLICY } from "../src/lib/local-media-engine-contract.js";
import {
  verifyLinuxDesktopEntryProtocol
} from "./desktop-installer-smoke.js";
import {
  runNativePackageSmoke
} from "./desktop-package-smoke.js";
import {
  runInstalledEngineBrowserSmoke
} from "./installed-engine-browser-smoke.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const outputDirectory = path.join(root, "dist", "installers", "arch-linux-x64");
const SYSTEM_SMOKE_ENV = "KIRINUKI_ARCH_INSTALLER_SYSTEM_SMOKE";
const INSTALLED_BROWSER_SMOKE_ENV = "KIRINUKI_INSTALLED_BROWSER_SMOKE";

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function run(
  command: string,
  args: readonly string[],
  { allowFailure = false }: { readonly allowFailure?: boolean } = {}
): Promise<Readonly<CommandResult>> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString("utf8")).slice(-8 * 1024 * 1024);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-8 * 1024 * 1024);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Arch installer smoke timeout: ${path.basename(command)}`));
    }, 10 * 60 * 1_000);
    timer.unref?.();
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      const numericCode = code ?? 1;
      if (signal !== null || (!allowFailure && numericCode !== 0)) {
        reject(new Error(
          `Arch installer smoke command failed: ${path.basename(command)} code=${numericCode} signal=${signal ?? "none"}\n${stderr}`
        ));
        return;
      }
      resolve(Object.freeze({ code: numericCode, stdout, stderr }));
    });
  });
}

async function fileIdentity(filePath: string): Promise<Readonly<{
  bytes: number;
  sha256: string;
}>> {
  const metadata = await lstat(filePath);
  invariant(
    metadata.isFile()
      && !metadata.isSymbolicLink()
      && metadata.nlink === 1
      && metadata.size > 100_000,
    "Arch installer smoke artifact가 regular file이 아닙니다."
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
      invariant(bytesRead > 0, "Arch installer smoke artifact를 끝까지 읽지 못했습니다.");
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    return Object.freeze({ bytes: before.size, sha256: hash.digest("hex") });
  } finally {
    await handle.close();
  }
}

async function assertAbsent(pathname: string): Promise<void> {
  try {
    await lstat(pathname);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error(`Arch package 제거 뒤 path가 남았습니다: ${pathname}`);
}

async function runSystemSmoke(artifactPath: string): Promise<void> {
  invariant(
    process.platform === "linux" && process.arch === "x64",
    "Arch installer system smoke는 Linux x64에서만 실행합니다."
  );
  const packageInfo = await run("bsdtar", ["-xOf", artifactPath, ".PKGINFO"]);
  const names = packageInfo.stdout
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("pkgname = "))
    .map((line) => line.slice("pkgname = ".length));
  invariant(
    JSON.stringify(names) === JSON.stringify(["kirinuki-engine"]),
    "Arch package name이 exact contract와 다릅니다."
  );
  const packageName = names[0]!;
  const existing = await run("pacman", ["-Q", packageName], {
    allowFailure: true
  });
  invariant(existing.code !== 0, "기존 Arch Kirinuki package를 덮어쓸 수 없습니다.");
  let installed = false;
  try {
    await run("sudo", ["pacman", "--noconfirm", "-U", artifactPath]);
    installed = true;
    const owned = (await run("pacman", ["-Qlq", packageName])).stdout
      .split(/\r?\n/u)
      .filter((entry) => entry.startsWith("/"));
    const desktopFiles = owned.filter((entry) => entry.endsWith(".desktop"));
    invariant(desktopFiles.length === 1, "Arch package desktop entry가 유일하지 않습니다.");
    verifyLinuxDesktopEntryProtocol(await readFile(desktopFiles[0]!, "utf8"));
    const appAsar = owned.filter((entry) => entry === "/opt/Kirinuki/resources/app.asar");
    invariant(appAsar.length === 1, "Arch package app.asar가 exact path에 없습니다.");
    const executable = "/opt/Kirinuki/Kirinuki";
    const [packageRoot, resourcesRoot] = await Promise.all([
      realpath("/opt/Kirinuki"),
      realpath("/opt/Kirinuki/resources")
    ]);
    invariant(packageRoot === "/opt/Kirinuki", "Arch package root가 canonical하지 않습니다.");
    await runNativePackageSmoke({
      target: "linux-x64",
      paths: { packageRoot, executable, resourcesRoot },
      autostartMode: "production",
      ...(process.env[INSTALLED_BROWSER_SMOKE_ENV] === "1"
        ? { browserSmoke: runInstalledEngineBrowserSmoke }
        : {}),
      terminateWhileRunning: async ({ executablePath }) => {
        invariant(executablePath === executable, "Arch removal executable identity가 바뀌었습니다.");
        await run("sudo", ["pacman", "--noconfirm", "-R", packageName]);
        installed = false;
      }
    });
  } finally {
    if (installed) {
      await run("sudo", ["pacman", "--noconfirm", "-R", packageName], {
        allowFailure: true
      });
    }
  }
  await assertAbsent("/opt/Kirinuki");
}

export async function runArchInstallerSmoke(): Promise<void> {
  const artifactPath = path.join(
    outputDirectory,
    LINUX_PREVIEW_ARCH_SOURCE_INSTALLER_FILE
  );
  const manifestPath = path.join(
    outputDirectory,
    LINUX_PREVIEW_ARCH_SOURCE_MANIFEST_FILE
  );
  const entries = (await readdir(outputDirectory, { withFileTypes: true }))
    .map((entry) => `${entry.isFile() && !entry.isSymbolicLink() ? "f" : "x"}:${entry.name}`)
    .sort();
  invariant(
    JSON.stringify(entries) === JSON.stringify([
      `f:${LINUX_PREVIEW_ARCH_SOURCE_INSTALLER_FILE}`,
      `f:${LINUX_PREVIEW_ARCH_SOURCE_MANIFEST_FILE}`
    ].sort()),
    "Arch installer smoke input tree가 exact contract와 다릅니다."
  );
  const [artifact, manifest] = await Promise.all([
    fileIdentity(artifactPath),
    readFile(manifestPath, "utf8").then((value) => JSON.parse(value) as Record<string, unknown>)
  ]);
  const manifestArtifact = manifest.artifact as Record<string, unknown> | undefined;
  const updater = manifest.updater as Record<string, unknown> | undefined;
  invariant(
    manifest.schema === LINUX_PREVIEW_ARCH_SOURCE_MANIFEST_SCHEMA
      && manifest.status === "unsigned-test-only"
      && manifest.channel === "ci-test-only"
      && manifest.target === "linux-x64"
      && manifest.distribution === "arch-linux-x64"
      && manifest.format === "pacman"
      && manifest.packageName === "kirinuki-engine"
      && manifestArtifact?.fileName === LINUX_PREVIEW_ARCH_SOURCE_INSTALLER_FILE
      && manifestArtifact.bytes === artifact.bytes
      && manifestArtifact.sha256 === artifact.sha256
      && updater?.bundled === false
      && updater.telemetry === false
      && updater.publicNetworkPolling === false
      && updater.unsignedUpdatesAllowed === false
      && updater.compatibilityPolicy === LOCAL_MEDIA_ENGINE_COMPATIBILITY_POLICY.id,
    "Arch installer manifest와 artifact identity가 다릅니다."
  );
  if (process.env[SYSTEM_SMOKE_ENV] === "1") {
    await runSystemSmoke(artifactPath);
  }
  console.log(JSON.stringify({
    schema: "kirinuki-arch-installer-smoke/v1",
    status: "ok",
    artifact: LINUX_PREVIEW_ARCH_SOURCE_INSTALLER_FILE,
    systemSmoke: process.env[SYSTEM_SMOKE_ENV] === "1"
  }, null, 2));
}

const invokedPath = process.argv[1];
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    throw new TypeError("사용법: arch-installer-smoke.ts");
  }
  await runArchInstallerSmoke();
}
