import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import type { DesktopBundleTarget } from "./runtime-spec.js";

export const WINDOWS_JOB_LAUNCHER_SCHEMA =
  "kirinuki/windows-job-launcher-manifest/v1" as const;
export const WINDOWS_JOB_LAUNCHER_CONTRACT =
  "kirinuki/windows-job-launcher/v1" as const;
export const WINDOWS_JOB_LAUNCHER_FILE_NAME =
  "kirinuki-job-launcher.exe" as const;
export const WINDOWS_JOB_LAUNCHER_MANIFEST_FILE_NAME = "manifest.json" as const;
export const WINDOWS_JOB_LAUNCHER_SOURCE_PATH =
  "native/windows/kirinuki-job-launcher.c" as const;
export const WINDOWS_JOB_LAUNCHER_RESOURCE_DIRECTORY =
  "desktop-native/win32-x64" as const;

export const WINDOWS_JOB_LAUNCHER_SECURITY_CONTRACT = Object.freeze([
  "create-suspended-before-job-assignment",
  "kill-entire-job-when-launcher-handle-closes",
  "verify-and-monitor-exact-parent-process",
  "inherit-node-stdio-and-explicit-fd3-only",
  "return-exact-root-child-exit-code"
] as const);

export const WINDOWS_JOB_LAUNCHER_MSVC_FLAGS = Object.freeze([
  "/nologo",
  "/std:c17",
  "/W4",
  "/WX",
  "/O2",
  "/guard:cf",
  "/utf-8",
  "/DUNICODE",
  "/D_UNICODE"
] as const);
export const WINDOWS_JOB_LAUNCHER_LINK_FLAGS = Object.freeze([
  "/SUBSYSTEM:CONSOLE",
  "/INCREMENTAL:NO",
  "/DYNAMICBASE",
  "/NXCOMPAT",
  "/CETCOMPAT",
  "/GUARD:CF"
] as const);

export interface WindowsJobLauncherManifest {
  readonly schema: typeof WINDOWS_JOB_LAUNCHER_SCHEMA;
  readonly target: "win32-x64";
  readonly fileName: typeof WINDOWS_JOB_LAUNCHER_FILE_NAME;
  readonly contract: typeof WINDOWS_JOB_LAUNCHER_CONTRACT;
  readonly source: Readonly<{
    path: typeof WINDOWS_JOB_LAUNCHER_SOURCE_PATH;
    sha256: string;
  }>;
  readonly build: Readonly<{
    compiler: "msvc-x64";
    toolsetVersion: string;
    compilerSha256: string;
    linkerSha256: string;
    flags: typeof WINDOWS_JOB_LAUNCHER_MSVC_FLAGS;
    linkFlags: typeof WINDOWS_JOB_LAUNCHER_LINK_FLAGS;
  }>;
  readonly artifact: Readonly<{
    bytes: number;
    sha256: string;
  }>;
  readonly securityContract: typeof WINDOWS_JOB_LAUNCHER_SECURITY_CONTRACT;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function safeWindowsAbsolutePath(value: string, label: string): string {
  invariant(
    typeof value === "string"
      && value.trim() === value
      && value.length > 0
      && path.win32.isAbsolute(value)
      && !/[\u0000-\u001f\u007f]/u.test(value),
    `${label}는 안전한 Windows 절대 경로여야 합니다.`
  );
  return path.win32.normalize(value);
}

function safeNativeArgument(value: string): string {
  invariant(
    typeof value === "string" && !value.includes("\0"),
    "Windows native child 인자에 NUL을 넣을 수 없습니다."
  );
  return value;
}

export function windowsJobObjectLauncherInvocation(
  launcherPath: string,
  childCommand: string,
  childArguments: readonly string[],
  parentProcessId: number
): Readonly<{ command: string; args: readonly string[] }> {
  const launcher = safeWindowsAbsolutePath(
    launcherPath,
    "Windows Job Object launcher"
  );
  const child = safeWindowsAbsolutePath(childCommand, "Windows native child");
  invariant(
    Number.isSafeInteger(parentProcessId)
      && parentProcessId > 0
      && parentProcessId <= 0xffff_ffff,
    "Windows Job Object launcher parent PID가 올바르지 않습니다."
  );
  invariant(
    Array.isArray(childArguments) && childArguments.length <= 8_192,
    "Windows native child 인자 수가 안전 상한을 넘었습니다."
  );
  return Object.freeze({
    command: launcher,
    args: Object.freeze([
      "--parent-pid",
      String(parentProcessId),
      "--",
      child,
      ...childArguments.map(safeNativeArgument)
    ])
  });
}

/**
 * Adapts the existing shell-free process runners without changing their
 * timeout, output, cancellation, fd-3, or taskkill defense-in-depth logic.
 */
export function createWindowsJobObjectSpawn({
  launcherPath,
  parentProcessId = process.pid,
  spawnImpl = spawn
}: {
  readonly launcherPath: string;
  readonly parentProcessId?: number;
  readonly spawnImpl?: typeof spawn;
}): typeof spawn {
  const verifiedLauncherPath = safeWindowsAbsolutePath(
    launcherPath,
    "Windows Job Object launcher"
  );
  const adapter = (
    childCommand: string,
    childArguments: readonly string[],
    options: Parameters<typeof spawn>[2]
  ) => {
    invariant(
      options !== undefined
        && options !== null
        && options.shell === false,
      "Windows Job Object launcher는 shell 없는 spawn만 감쌀 수 있습니다."
    );
    const invocation = windowsJobObjectLauncherInvocation(
      verifiedLauncherPath,
      childCommand,
      childArguments,
      parentProcessId
    );
    return spawnImpl(invocation.command, [...invocation.args], {
      ...options,
      shell: false,
      windowsVerbatimArguments: false
    });
  };
  return adapter as typeof spawn;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort())
    === JSON.stringify([...expected].sort());
}

export function parseWindowsJobLauncherManifest(
  value: unknown
): Readonly<WindowsJobLauncherManifest> {
  const manifest = asRecord(value);
  const source = asRecord(manifest?.source);
  const build = asRecord(manifest?.build);
  const artifact = asRecord(manifest?.artifact);
  invariant(
    manifest !== null
      && source !== null
      && build !== null
      && artifact !== null
      && exactKeys(manifest, [
        "schema",
        "target",
        "fileName",
        "contract",
        "source",
        "build",
        "artifact",
        "securityContract"
      ])
      && exactKeys(source, ["path", "sha256"])
      && exactKeys(build, [
        "compiler",
        "toolsetVersion",
        "compilerSha256",
        "linkerSha256",
        "flags",
        "linkFlags"
      ])
      && exactKeys(artifact, ["bytes", "sha256"])
      && manifest.schema === WINDOWS_JOB_LAUNCHER_SCHEMA
      && manifest.target === "win32-x64"
      && manifest.fileName === WINDOWS_JOB_LAUNCHER_FILE_NAME
      && manifest.contract === WINDOWS_JOB_LAUNCHER_CONTRACT
      && source.path === WINDOWS_JOB_LAUNCHER_SOURCE_PATH
      && typeof source.sha256 === "string"
      && /^[0-9a-f]{64}$/u.test(source.sha256)
      && build.compiler === "msvc-x64"
      && typeof build.toolsetVersion === "string"
      && /^14\.\d{2}\.\d{5}$/u.test(build.toolsetVersion)
      && typeof build.compilerSha256 === "string"
      && /^[0-9a-f]{64}$/u.test(build.compilerSha256)
      && typeof build.linkerSha256 === "string"
      && /^[0-9a-f]{64}$/u.test(build.linkerSha256)
      && JSON.stringify(build.flags) === JSON.stringify(WINDOWS_JOB_LAUNCHER_MSVC_FLAGS)
      && JSON.stringify(build.linkFlags) === JSON.stringify(WINDOWS_JOB_LAUNCHER_LINK_FLAGS)
      && Number.isSafeInteger(artifact.bytes)
      && Number(artifact.bytes) >= 4_096
      && Number(artifact.bytes) <= 4 * 1_024 * 1_024
      && typeof artifact.sha256 === "string"
      && /^[0-9a-f]{64}$/u.test(artifact.sha256)
      && JSON.stringify(manifest.securityContract)
        === JSON.stringify(WINDOWS_JOB_LAUNCHER_SECURITY_CONTRACT),
    "Windows Job Object launcher manifest가 exact contract와 다릅니다."
  );
  return Object.freeze({
    schema: WINDOWS_JOB_LAUNCHER_SCHEMA,
    target: "win32-x64",
    fileName: WINDOWS_JOB_LAUNCHER_FILE_NAME,
    contract: WINDOWS_JOB_LAUNCHER_CONTRACT,
    source: Object.freeze({
      path: WINDOWS_JOB_LAUNCHER_SOURCE_PATH,
      sha256: source.sha256
    }),
    build: Object.freeze({
      compiler: "msvc-x64",
      toolsetVersion: build.toolsetVersion,
      compilerSha256: build.compilerSha256,
      linkerSha256: build.linkerSha256,
      flags: WINDOWS_JOB_LAUNCHER_MSVC_FLAGS,
      linkFlags: WINDOWS_JOB_LAUNCHER_LINK_FLAGS
    }),
    artifact: Object.freeze({
      bytes: Number(artifact.bytes),
      sha256: artifact.sha256
    }),
    securityContract: WINDOWS_JOB_LAUNCHER_SECURITY_CONTRACT
  });
}

async function regularFileIdentity(filePath: string): Promise<Readonly<{
  bytes: number;
  sha256: string;
}>> {
  const metadata = await lstat(filePath, { bigint: true });
  invariant(
    metadata.isFile()
      && !metadata.isSymbolicLink()
      && metadata.size >= 4_096n
      && metadata.size <= BigInt(4 * 1_024 * 1_024),
    "Windows Job Object launcher가 bounded regular file이 아닙니다."
  );
  const handle = await open(
    filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)
  );
  try {
    const before = await handle.stat({ bigint: true });
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(128 * 1_024);
    let position = 0;
    while (position < Number(before.size)) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, Number(before.size) - position),
        position
      );
      invariant(bytesRead > 0, "Windows Job Object launcher를 끝까지 읽지 못했습니다.");
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    invariant(
      before.dev === after.dev
        && before.ino === after.ino
        && before.size === after.size
        && before.mtimeNs === after.mtimeNs
        && before.ctimeNs === after.ctimeNs,
      "Windows Job Object launcher가 identity 검증 중 바뀌었습니다."
    );
    return Object.freeze({
      bytes: Number(before.size),
      sha256: hash.digest("hex")
    });
  } finally {
    await handle.close();
  }
}

export function windowsJobLauncherResourcePaths(
  resourcesRoot: string,
  target: DesktopBundleTarget
): Readonly<{
  directory: string;
  executable: string;
  manifest: string;
}> {
  invariant(target === "win32-x64", "Job Object launcher는 win32-x64 전용입니다.");
  invariant(
    typeof resourcesRoot === "string"
      && resourcesRoot.trim() === resourcesRoot
      && path.isAbsolute(resourcesRoot)
      && !/[\u0000-\u001f\u007f]/u.test(resourcesRoot),
    "desktop resources root가 안전한 절대 경로가 아닙니다."
  );
  const directory = path.join(
    resourcesRoot,
    ...WINDOWS_JOB_LAUNCHER_RESOURCE_DIRECTORY.split("/")
  );
  return Object.freeze({
    directory,
    executable: path.join(directory, WINDOWS_JOB_LAUNCHER_FILE_NAME),
    manifest: path.join(directory, WINDOWS_JOB_LAUNCHER_MANIFEST_FILE_NAME)
  });
}

export async function verifyPackagedWindowsJobLauncher(
  resourcesRoot: string,
  target: DesktopBundleTarget
): Promise<Readonly<{
  executable: string;
  manifest: Readonly<WindowsJobLauncherManifest>;
}>> {
  const paths = windowsJobLauncherResourcePaths(resourcesRoot, target);
  const directoryMetadata = await lstat(paths.directory);
  invariant(
    directoryMetadata.isDirectory() && !directoryMetadata.isSymbolicLink(),
    "Windows Job Object launcher resource가 실제 디렉터리가 아닙니다."
  );
  const entries = await readdir(paths.directory, { withFileTypes: true });
  invariant(
    entries.every((entry) => entry.isFile() && !entry.isSymbolicLink())
      && JSON.stringify(entries.map(({ name }) => name).sort())
        === JSON.stringify([
          WINDOWS_JOB_LAUNCHER_FILE_NAME,
          WINDOWS_JOB_LAUNCHER_MANIFEST_FILE_NAME
        ].sort()),
    "Windows Job Object launcher resource allowlist가 다릅니다."
  );
  const manifest = parseWindowsJobLauncherManifest(
    JSON.parse(await readFile(paths.manifest, "utf8"))
  );
  const identity = await regularFileIdentity(paths.executable);
  invariant(
    identity.bytes === manifest.artifact.bytes
      && identity.sha256 === manifest.artifact.sha256,
    "Windows Job Object launcher binary가 build manifest와 다릅니다."
  );
  return Object.freeze({ executable: paths.executable, manifest });
}
