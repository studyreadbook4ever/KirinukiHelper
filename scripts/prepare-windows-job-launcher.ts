import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import type { DesktopBundleTarget } from "../src/desktop/runtime-spec.js";
import {
  WINDOWS_JOB_LAUNCHER_CONTRACT,
  WINDOWS_JOB_LAUNCHER_FILE_NAME,
  WINDOWS_JOB_LAUNCHER_LINK_FLAGS,
  WINDOWS_JOB_LAUNCHER_MSVC_FLAGS,
  WINDOWS_JOB_LAUNCHER_SCHEMA,
  WINDOWS_JOB_LAUNCHER_SECURITY_CONTRACT,
  WINDOWS_JOB_LAUNCHER_SOURCE_PATH,
  parseWindowsJobLauncherManifest,
  windowsJobLauncherResourcePaths
} from "../src/desktop/windows-job-object.js";
import type {
  WindowsJobLauncherManifest
} from "../src/desktop/windows-job-object.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 2 * 60 * 1_000;
const MAX_COMMAND_OUTPUT_BYTES = 4 * 1_024 * 1_024;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function regularFileIdentity(filePath: string): Promise<Readonly<{
  bytes: number;
  sha256: string;
}>> {
  const pathMetadata = await lstat(filePath, { bigint: true });
  invariant(
    pathMetadata.isFile()
      && !pathMetadata.isSymbolicLink()
      && pathMetadata.size > 0n
      && pathMetadata.size <= BigInt(4 * 1_024 * 1_024),
    `Windows native build input/output이 bounded regular file이 아닙니다: ${filePath}`
  );
  const handle = await open(
    filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)
  );
  try {
    const before = await handle.stat({ bigint: true });
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    invariant(
      before.dev === after.dev
        && before.ino === after.ino
        && before.size === after.size
        && before.mtimeNs === after.mtimeNs
        && before.ctimeNs === after.ctimeNs
        && before.size === BigInt(bytes.byteLength),
      `Windows native 파일이 identity 검사 중 바뀌었습니다: ${filePath}`
    );
    return Object.freeze({
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex")
    });
  } finally {
    await handle.close();
  }
}

function safeWindowsSystemFile(filePath: string, label: string): string {
  invariant(
    path.win32.isAbsolute(filePath)
      && filePath.trim() === filePath
      && !/[\u0000-\u001f\u007f]/u.test(filePath),
    `${label} 경로가 안전한 Windows 절대 경로가 아닙니다.`
  );
  return path.win32.normalize(filePath);
}

async function visualStudioEnvironment(): Promise<Readonly<{
  compiler: string;
  compilerSha256: string;
  linkerSha256: string;
  toolsetVersion: string;
  environment: NodeJS.ProcessEnv;
}>> {
  invariant(
    process.platform === "win32" && process.arch === "x64",
    "Windows Job Object launcher는 native win32-x64에서만 빌드할 수 있습니다."
  );
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  invariant(
    typeof programFilesX86 === "string" && programFilesX86.trim() !== "",
    "ProgramFiles(x86)를 확인하지 못했습니다."
  );
  invariant(
    typeof systemRoot === "string" && systemRoot.trim() !== "",
    "SystemRoot를 확인하지 못했습니다."
  );
  const vswhere = safeWindowsSystemFile(path.win32.join(
    programFilesX86,
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe"
  ), "vswhere");
  await regularFileIdentity(vswhere);
  const installation = await execFileAsync(vswhere, [
    "-latest",
    "-products",
    "*",
    "-requires",
    "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
    "-property",
    "installationPath"
  ], {
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    timeout: COMMAND_TIMEOUT_MS
  });
  const installationLines = installation.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  invariant(
    installationLines.length === 1,
    "Visual Studio C++ toolchain을 정확히 하나 선택하지 못했습니다."
  );
  const installationRoot = safeWindowsSystemFile(
    installationLines[0]!,
    "Visual Studio"
  );
  const vcvars = safeWindowsSystemFile(path.win32.join(
    installationRoot,
    "VC",
    "Auxiliary",
    "Build",
    "vcvars64.bat"
  ), "vcvars64");
  await regularFileIdentity(vcvars);
  const commandProcessor = safeWindowsSystemFile(
    path.win32.join(systemRoot, "System32", "cmd.exe"),
    "cmd.exe"
  );
  await regularFileIdentity(commandProcessor);
  const initialized = await execFileAsync(commandProcessor, [
    "/d",
    "/s",
    "/c",
    `call "${vcvars}" >nul && set`
  ], {
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    timeout: COMMAND_TIMEOUT_MS
  });
  const environment: NodeJS.ProcessEnv = {};
  for (const line of initialized.stdout.split(/\r?\n/u)) {
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (/^[A-Za-z_][A-Za-z0-9_()]*$/u.test(key) && !value.includes("\0")) {
      environment[key] = value;
    }
  }
  const toolsRoot = environment.VCToolsInstallDir;
  invariant(
    typeof toolsRoot === "string" && toolsRoot.trim() !== "",
    "vcvars64가 VCToolsInstallDir를 만들지 못했습니다."
  );
  const compiler = safeWindowsSystemFile(path.win32.join(
    toolsRoot,
    "bin",
    "Hostx64",
    "x64",
    "cl.exe"
  ), "MSVC cl.exe");
  const linker = safeWindowsSystemFile(path.win32.join(
    toolsRoot,
    "bin",
    "Hostx64",
    "x64",
    "link.exe"
  ), "MSVC link.exe");
  const toolsetVersion = path.win32.basename(path.win32.normalize(toolsRoot));
  invariant(
    /^14\.\d{2}\.\d{5}$/u.test(toolsetVersion),
    "MSVC toolset version identity가 올바르지 않습니다."
  );
  const [compilerIdentity, linkerIdentity] = await Promise.all([
    regularFileIdentity(compiler),
    regularFileIdentity(linker)
  ]);
  return Object.freeze({
    compiler,
    compilerSha256: compilerIdentity.sha256,
    linkerSha256: linkerIdentity.sha256,
    toolsetVersion,
    environment: Object.freeze(environment)
  });
}

function launcherManifest(
  sourceSha256: string,
  artifact: Readonly<{ bytes: number; sha256: string }>,
  build: Readonly<WindowsJobLauncherManifest["build"]>
): Readonly<WindowsJobLauncherManifest> {
  return Object.freeze({
    schema: WINDOWS_JOB_LAUNCHER_SCHEMA,
    target: "win32-x64",
    fileName: WINDOWS_JOB_LAUNCHER_FILE_NAME,
    contract: WINDOWS_JOB_LAUNCHER_CONTRACT,
    source: Object.freeze({
      path: WINDOWS_JOB_LAUNCHER_SOURCE_PATH,
      sha256: sourceSha256
    }),
    build: Object.freeze({ ...build }),
    artifact: Object.freeze({ ...artifact }),
    securityContract: WINDOWS_JOB_LAUNCHER_SECURITY_CONTRACT
  });
}

export async function prepareWindowsJobLauncher(
  target: DesktopBundleTarget
): Promise<Readonly<{
  resourcesRoot: string;
  targetDirectory: string;
  executable: string;
  manifest: string;
  sourceSha256: string;
}>> {
  invariant(target === "win32-x64", "Windows native launcher target이 다릅니다.");
  invariant(
    process.platform === "win32" && process.arch === "x64",
    "Windows native launcher는 win32-x64 runner에서만 준비할 수 있습니다."
  );
  const sourcePath = path.join(
    root,
    ...WINDOWS_JOB_LAUNCHER_SOURCE_PATH.split("/")
  );
  invariant(
    await realpath(sourcePath) === sourcePath,
    "Windows Job Object launcher source 경로에 symlink가 있습니다."
  );
  const source = await regularFileIdentity(sourcePath);
  const resourcesRoot = path.join(root, ".artifacts");
  const paths = windowsJobLauncherResourcePaths(resourcesRoot, target);
  await rm(path.join(resourcesRoot, "desktop-native"), {
    recursive: true,
    force: true
  });
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  const toolchain = await visualStudioEnvironment();
  const objectPath = path.join(paths.directory, "kirinuki-job-launcher.obj");
  await execFileAsync(toolchain.compiler, [
    ...WINDOWS_JOB_LAUNCHER_MSVC_FLAGS,
    sourcePath,
    `/Fe:${paths.executable}`,
    `/Fo:${objectPath}`,
    "/link",
    ...WINDOWS_JOB_LAUNCHER_LINK_FLAGS
  ], {
    cwd: root,
    env: toolchain.environment,
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    timeout: COMMAND_TIMEOUT_MS
  });
  await rm(objectPath, { force: true });
  const artifact = await regularFileIdentity(paths.executable);
  invariant(
    artifact.bytes >= 4_096,
    "Windows Job Object launcher 출력이 비정상적으로 작습니다."
  );
  const manifest = launcherManifest(source.sha256, artifact, {
    compiler: "msvc-x64",
    toolsetVersion: toolchain.toolsetVersion,
    compilerSha256: toolchain.compilerSha256,
    linkerSha256: toolchain.linkerSha256,
    flags: WINDOWS_JOB_LAUNCHER_MSVC_FLAGS,
    linkFlags: WINDOWS_JOB_LAUNCHER_LINK_FLAGS
  });
  await writeFile(
    paths.manifest,
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx", mode: 0o600 }
  );
  parseWindowsJobLauncherManifest(JSON.parse(await readFile(paths.manifest, "utf8")));
  return Object.freeze({
    resourcesRoot,
    targetDirectory: paths.directory,
    executable: paths.executable,
    manifest: paths.manifest,
    sourceSha256: source.sha256
  });
}

/** Refreshes the exact binary identity after Authenticode mutates the PE. */
export async function refreshPackagedWindowsJobLauncherManifest(
  resourcesRoot: string
): Promise<Readonly<WindowsJobLauncherManifest>> {
  const paths = windowsJobLauncherResourcePaths(resourcesRoot, "win32-x64");
  const current = parseWindowsJobLauncherManifest(
    JSON.parse(await readFile(paths.manifest, "utf8"))
  );
  const artifact = await regularFileIdentity(paths.executable);
  const refreshed = launcherManifest(
    current.source.sha256,
    artifact,
    current.build
  );
  const manifestMetadata = await lstat(paths.manifest);
  invariant(
    manifestMetadata.isFile() && !manifestMetadata.isSymbolicLink(),
    "Windows Job Object launcher manifest가 regular file이 아닙니다."
  );
  const handle = await open(
    paths.manifest,
    fsConstants.O_WRONLY
      | fsConstants.O_TRUNC
      | (fsConstants.O_NOFOLLOW || 0)
  );
  try {
    await handle.writeFile(`${JSON.stringify(refreshed, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return parseWindowsJobLauncherManifest(
    JSON.parse(await readFile(paths.manifest, "utf8"))
  );
}

const invokedPath = process.argv[1];
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    throw new TypeError("사용법: prepare-windows-job-launcher.ts");
  }
  const target = `${process.platform}-${process.arch}` as DesktopBundleTarget;
  console.log(JSON.stringify(await prepareWindowsJobLauncher(target), null, 2));
}
