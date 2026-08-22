import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { packager } from "@electron/packager";
import {
  FuseState,
  FuseV1Options,
  FuseVersion,
  flipFuses,
  getCurrentFuseWire
} from "@electron/fuses";

import {
  DESKTOP_PACKAGED_TARGETS,
  desktopToolTargetManifest
} from "../src/desktop/tool-manifest.js";
import type { DesktopBundleTarget } from "../src/desktop/runtime-spec.js";
import {
  DESKTOP_STAGE_ROOT,
  buildDesktopApplication
} from "./build-desktop.js";
import {
  DESKTOP_ASAR_PACKAGE_FILES,
  assertExactRegularFileTreeSnapshot,
  copyExactRegularFileTree,
  snapshotRegularFileTree,
  snapshotExactRegularFileTree,
  verifyDesktopAsar
} from "./desktop-package-files.js";
import type {
  DesktopPackageFileIdentity,
  DesktopPackageTreeSnapshot
} from "./desktop-package-files.js";
import {
  expectedDesktopToolArtifactMode,
  prepareDesktopTools
} from "./prepare-desktop-tools.js";
import type { DesktopToolArtifactRole } from "./prepare-desktop-tools.js";
import {
  prepareWindowsJobLauncher
} from "./prepare-windows-job-launcher.js";
import {
  WINDOWS_JOB_LAUNCHER_FILE_NAME,
  WINDOWS_JOB_LAUNCHER_MANIFEST_FILE_NAME,
  verifyPackagedWindowsJobLauncher
} from "../src/desktop/windows-job-object.js";
import { pinnedElectronArchiveChecksums } from "./electron-archive-checksums.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const ELECTRON_VERSION = "43.4.1";
export const DESKTOP_DARWIN_MINIMUM_SYSTEM_VERSION = "15.0";
const DESKTOP_ICON_PATHS = Object.freeze({
  darwin: path.join(root, "build", "icon.icns"),
  linux: path.join(root, "build", "icon.svg"),
  win32: path.join(root, "build", "icon.ico")
});

const DESKTOP_FUSE_CONFIG = Object.freeze({
  version: FuseVersion.V1,
  strictlyRequireAllFuses: true,
  [FuseV1Options.RunAsNode]: true,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  [FuseV1Options.WasmTrapHandlers]: true
});

async function hardenPackagedElectron(
  executable: string,
  resetAdHocDarwinSignature: boolean
): Promise<void> {
  await flipFuses(executable, {
    ...DESKTOP_FUSE_CONFIG,
    resetAdHocDarwinSignature
  });
  const actual = await getCurrentFuseWire(executable);
  for (const [option, enabled] of Object.entries(DESKTOP_FUSE_CONFIG)) {
    if (option === "version" || option === "strictlyRequireAllFuses") {
      continue;
    }
    const expected = enabled ? FuseState.ENABLE : FuseState.DISABLE;
    if (actual[Number(option) as FuseV1Options] !== expected) {
      throw new Error(`Electron fuse 검증 실패: ${FuseV1Options[Number(option)]}`);
    }
  }
}

function currentTarget(): DesktopBundleTarget {
  const target = `${process.platform}-${process.arch}`;
  if (!(DESKTOP_PACKAGED_TARGETS as readonly string[]).includes(target)) {
    throw new Error(
      `현재 OS/architecture는 데스크톱 패키징 대상이 아닙니다: ${target}`
    );
  }
  return target as DesktopBundleTarget;
}

async function desktopBrandAssetIdentity(
  filePath: string,
  relativePath: string
): Promise<Readonly<DesktopPackageFileIdentity>> {
  const pathMetadata = await lstat(filePath);
  if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink()) {
    throw new Error(`데스크톱 상표 파일이 regular file이 아닙니다: ${filePath}`);
  }
  const handle = await open(
    filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)
  );
  try {
    const before = await handle.stat();
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      !before.isFile()
      || before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs
      || before.size !== bytes.byteLength
    ) {
      throw new Error(`데스크톱 상표 파일이 검증 중 바뀌었습니다: ${filePath}`);
    }
    return Object.freeze({
      relativePath,
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      executable: (before.mode & 0o111) !== 0
    });
  } finally {
    await handle.close();
  }
}

function packagedExecutable(
  packageRoot: string,
  platform: NodeJS.Platform
): string {
  if (platform === "darwin") {
    return path.join(
      packageRoot,
      "Kirinuki.app",
      "Contents",
      "MacOS",
      "Kirinuki"
    );
  }
  return path.join(
    packageRoot,
    platform === "win32" ? "Kirinuki.exe" : "Kirinuki"
  );
}

function packagedResourcesRoot(
  packageRoot: string,
  platform: NodeJS.Platform
): string {
  return platform === "darwin"
    ? path.join(packageRoot, "Kirinuki.app", "Contents", "Resources")
    : path.join(packageRoot, "resources");
}

async function assertExactDirectoryEntries(
  directory: string,
  expectedNames: readonly string[]
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  const actualNames = entries.map((entry) => entry.name).sort();
  const expected = [...expectedNames].sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expected)) {
    throw new Error(`데스크톱 도구 디렉터리에 예상하지 않은 항목이 있습니다: ${directory}`);
  }
  if (entries.some((entry) => entry.isSymbolicLink())) {
    throw new Error(`데스크톱 도구 디렉터리에 심볼릭 링크가 있습니다: ${directory}`);
  }
}

export async function assertDesktopToolDirectoryModes(
  directory: string,
  target: DesktopBundleTarget,
  label: string
): Promise<void> {
  if (target.startsWith("win32-")) {
    return;
  }
  const manifest = desktopToolTargetManifest(target);
  const artifacts: readonly Readonly<{
    role: DesktopToolArtifactRole;
    fileName: string;
  }>[] = [
    { role: "ffmpeg", fileName: manifest.ffmpeg.fileName },
    { role: "ffprobe", fileName: manifest.ffprobe.fileName },
    { role: "ffmpegLicense", fileName: manifest.ffmpegLicense.fileName },
    { role: "ytDlp", fileName: manifest.ytDlp.fileName }
  ];
  for (const { role, fileName } of artifacts) {
    const expectedMode = expectedDesktopToolArtifactMode(target, role);
    if (expectedMode === undefined) {
      throw new Error(`${label}의 POSIX mode 계약을 만들지 못했습니다: ${fileName}`);
    }
    const metadata = await lstat(path.join(directory, fileName));
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`${label}의 도구 파일 형식이 올바르지 않습니다: ${fileName}`);
    }
    if ((metadata.mode & 0o777) !== expectedMode) {
      throw new Error(
        `${label}의 POSIX mode가 올바르지 않습니다: ${fileName}`
      );
    }
  }
}

function expectedPackagedDesktopToolArtifactMode(
  target: DesktopBundleTarget,
  role: DesktopToolArtifactRole
): number | undefined {
  if (target === "linux-x64") {
    return role === "ffmpegLicense" ? 0o644 : 0o755;
  }
  return expectedDesktopToolArtifactMode(target, role);
}

async function setExactOpenPathMode(
  filePath: string,
  type: "file" | "directory",
  mode: number,
  label: string
): Promise<void> {
  const handle = await open(
    filePath,
    fsConstants.O_RDONLY
      | (fsConstants.O_NOFOLLOW || 0)
      | (type === "directory" ? fsConstants.O_DIRECTORY : 0)
  );
  try {
    const before = await handle.stat();
    if (type === "file" ? !before.isFile() : !before.isDirectory()) {
      throw new Error(`${label} 형식이 올바르지 않습니다.`);
    }
    await handle.chmod(mode);
    const after = await handle.stat();
    if (
      before.dev !== after.dev
      || before.ino !== after.ino
      || (after.mode & 0o777) !== mode
    ) {
      throw new Error(`${label} POSIX mode를 exact하게 고정하지 못했습니다.`);
    }
  } finally {
    await handle.close();
  }
}

/**
 * A deb is installed root-owned under /opt, so its immutable application tree
 * must be traversable/readable by the desktop user. The private download cache
 * remains 0700/0600; only the copied Linux package input is normalized here.
 */
export async function normalizeLinuxPackagedApplicationModes(
  packageRoot: string
): Promise<void> {
  const target = "linux-x64" as const;
  const resourcesRoot = packagedResourcesRoot(packageRoot, "linux");
  const toolsRoot = path.join(resourcesRoot, "desktop-tools");
  const targetRoot = path.join(toolsRoot, target);
  const manifest = desktopToolTargetManifest(target);
  await Promise.all([
    setExactOpenPathMode(packageRoot, "directory", 0o755, "Linux package root"),
    setExactOpenPathMode(toolsRoot, "directory", 0o755, "Linux tools root"),
    setExactOpenPathMode(targetRoot, "directory", 0o755, "Linux target tools root"),
    setExactOpenPathMode(
      path.join(targetRoot, manifest.ffmpeg.fileName),
      "file",
      0o755,
      "Linux ffmpeg"
    ),
    setExactOpenPathMode(
      path.join(targetRoot, manifest.ffprobe.fileName),
      "file",
      0o755,
      "Linux ffprobe"
    ),
    setExactOpenPathMode(
      path.join(targetRoot, manifest.ytDlp.fileName),
      "file",
      0o755,
      "Linux yt-dlp"
    ),
    setExactOpenPathMode(
      path.join(targetRoot, manifest.ffmpegLicense.fileName),
      "file",
      0o644,
      "Linux ffmpeg license"
    ),
    setExactOpenPathMode(
      path.join(targetRoot, "manifest.json"),
      "file",
      0o644,
      "Linux tool manifest"
    )
  ]);
}

async function verifyPackagedToolArtifact(
  filePath: string,
  expectedSize: number,
  expectedSha256: string,
  expectedMode: number | undefined
): Promise<void> {
  const metadata = await lstat(filePath, { bigint: true });
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || metadata.size !== BigInt(expectedSize)
  ) {
    throw new Error(`패키지 미디어 도구 파일 identity가 다릅니다: ${filePath}`);
  }
  if (
    expectedMode !== undefined
    && Number(metadata.mode & 0o777n) !== expectedMode
  ) {
    throw new Error(`패키지 미디어 도구 POSIX mode가 다릅니다: ${filePath}`);
  }
  const handle = await open(
    filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)
  );
  try {
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < expectedSize) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, expectedSize - position),
        position
      );
      if (bytesRead <= 0) {
        throw new Error(`패키지 미디어 도구를 끝까지 읽지 못했습니다: ${filePath}`);
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    if (hash.digest("hex") !== expectedSha256) {
      throw new Error(`패키지 미디어 도구 SHA-256이 다릅니다: ${filePath}`);
    }
  } finally {
    await handle.close();
  }
}

async function isolatedDesktopResources(
  toolsDirectory: string,
  target: DesktopBundleTarget,
  windowsNativeDirectory?: string
): Promise<Readonly<{
  parent: string;
  toolsRoot: string;
  toolIdentities: readonly DesktopPackageFileIdentity[];
  nativeRoot?: string;
  nativeIdentities?: readonly DesktopPackageFileIdentity[];
}>> {
  const manifest = desktopToolTargetManifest(target);
  const parent = await mkdtemp(path.join(os.tmpdir(), "kirinuki-desktop-package-"));
  const toolsRoot = path.join(parent, "desktop-tools");
  const targetRoot = path.join(toolsRoot, target);
  const nativeRoot = path.join(parent, "desktop-native");
  const nativeTargetRoot = path.join(nativeRoot, target);
  const fileNames = [
    manifest.ffmpeg.fileName,
    manifest.ffprobe.fileName,
    manifest.ffmpegLicense.fileName,
    manifest.ytDlp.fileName,
    "manifest.json"
  ];
  try {
    if (target === "win32-x64" && !windowsNativeDirectory) {
      throw new Error("Windows Job Object launcher resource가 준비되지 않았습니다.");
    }
    if (target !== "win32-x64" && windowsNativeDirectory !== undefined) {
      throw new Error("Windows가 아닌 package에 Job Object launcher가 결합되었습니다.");
    }
    await assertDesktopToolDirectoryModes(
      toolsDirectory,
      target,
      `desktop tools ${target} source`
    );
    const toolIdentities = await copyExactRegularFileTree({
      sourceRoot: toolsDirectory,
      destinationRoot: targetRoot,
      expectedFiles: fileNames,
      label: `desktop tools ${target}`
    });
    await assertDesktopToolDirectoryModes(
      targetRoot,
      target,
      `isolated desktop tools ${target}`
    );
    await assertExactDirectoryEntries(toolsRoot, [target]);
    await assertExactDirectoryEntries(targetRoot, fileNames);
    const nativeFiles = [
      WINDOWS_JOB_LAUNCHER_FILE_NAME,
      WINDOWS_JOB_LAUNCHER_MANIFEST_FILE_NAME
    ];
    const nativeIdentities = target === "win32-x64"
      ? await copyExactRegularFileTree({
        sourceRoot: windowsNativeDirectory!,
        destinationRoot: nativeTargetRoot,
        expectedFiles: nativeFiles,
        label: "Windows Job Object launcher"
      })
      : undefined;
    if (target === "win32-x64") {
      if (!nativeIdentities) {
        throw new Error("Windows Job Object launcher copy가 완료되지 않았습니다.");
      }
      await assertExactDirectoryEntries(nativeRoot, [target]);
      await assertExactDirectoryEntries(nativeTargetRoot, nativeFiles);
    }
    return Object.freeze({
      parent,
      toolsRoot,
      toolIdentities,
      ...(nativeIdentities
        ? { nativeRoot, nativeIdentities }
        : {})
    });
  } catch (error) {
    await rm(parent, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyPackagedDesktopTools(
  resourcesRoot: string,
  target: DesktopBundleTarget
): Promise<void> {
  const manifest = desktopToolTargetManifest(target);
  const toolsRoot = path.join(resourcesRoot, "desktop-tools");
  const targetRoot = path.join(toolsRoot, target);
  const artifacts: readonly Readonly<{
    role: DesktopToolArtifactRole;
    artifact: typeof manifest.ffmpeg;
  }>[] = [
    { role: "ffmpeg", artifact: manifest.ffmpeg },
    { role: "ffprobe", artifact: manifest.ffprobe },
    { role: "ffmpegLicense", artifact: manifest.ffmpegLicense },
    { role: "ytDlp", artifact: manifest.ytDlp }
  ];
  await assertExactDirectoryEntries(toolsRoot, [target]);
  await assertExactDirectoryEntries(targetRoot, [
    ...artifacts.map(({ artifact }) => artifact.fileName),
    "manifest.json"
  ]);
  const recorded = JSON.parse(await readFile(
    path.join(targetRoot, "manifest.json"),
    "utf8"
  ));
  if (JSON.stringify(recorded) !== JSON.stringify(manifest)) {
    throw new Error("패키지 미디어 도구 manifest가 현재 target과 다릅니다.");
  }
  if (target === "linux-x64") {
    const [toolsMode, targetMode, manifestMode] = await Promise.all([
      lstat(toolsRoot),
      lstat(targetRoot),
      lstat(path.join(targetRoot, "manifest.json"))
    ]);
    if (
      !toolsMode.isDirectory()
      || toolsMode.isSymbolicLink()
      || (toolsMode.mode & 0o777) !== 0o755
      || !targetMode.isDirectory()
      || targetMode.isSymbolicLink()
      || (targetMode.mode & 0o777) !== 0o755
      || !manifestMode.isFile()
      || manifestMode.isSymbolicLink()
      || (manifestMode.mode & 0o777) !== 0o644
    ) {
      throw new Error("Linux 설치형 미디어 도구의 공개 read/execute mode가 올바르지 않습니다.");
    }
  }
  await Promise.all(artifacts.map(({ role, artifact }) => verifyPackagedToolArtifact(
    path.join(targetRoot, artifact.fileName),
    artifact.size,
    artifact.sha256,
    expectedPackagedDesktopToolArtifactMode(target, role)
  )));
}

export async function packageDesktopApplication(): Promise<Readonly<{
  target: DesktopBundleTarget;
  outputDirectory: string;
  executable: string;
}>> {
  const target = currentTarget();
  const [platform, arch] = target.split("-") as [
    "linux" | "darwin" | "win32",
    "x64" | "arm64"
  ];
  const iconPath = DESKTOP_ICON_PATHS[platform];
  const brandAssetIdentity = await desktopBrandAssetIdentity(
    iconPath,
    platform === "darwin" ? "Kirinuki.icns" : path.basename(iconPath)
  );
  const toolsDirectory = await prepareDesktopTools(target);
  const windowsJobLauncher = target === "win32-x64"
    ? await prepareWindowsJobLauncher(target)
    : undefined;
  const electronArchiveChecksums = await pinnedElectronArchiveChecksums({
    electronPackageRoot: path.dirname(require.resolve("electron/package.json")),
    version: ELECTRON_VERSION,
    platform,
    arch
  });
  await buildDesktopApplication();
  const asarIdentities = await snapshotExactRegularFileTree(
    DESKTOP_STAGE_ROOT,
    DESKTOP_ASAR_PACKAGE_FILES,
    "desktop application stage"
  );
  const isolatedResources = await isolatedDesktopResources(
    toolsDirectory,
    target,
    windowsJobLauncher?.targetDirectory
  );
  const runtimeResourceBaseline: {
    snapshot?: Readonly<DesktopPackageTreeSnapshot>;
  } = {};
  try {
    const outputRoot = path.join(root, "dist", "desktop", target);
    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(outputRoot, { recursive: true, mode: 0o700 });
    const outputDirectories = await packager({
      dir: DESKTOP_STAGE_ROOT,
      out: outputRoot,
      name: "Kirinuki",
      executableName: "Kirinuki",
      electronVersion: ELECTRON_VERSION,
      download: { checksums: electronArchiveChecksums },
      platform,
      arch,
      overwrite: false,
      asar: true,
      appBundleId: "kr.eff0rtchung.kirinuki",
      appCategoryType: "public.app-category.video",
      ...(platform === "darwin" || platform === "win32"
        ? { icon: iconPath }
        : {}),
      ...(platform === "darwin"
        ? {
          extendInfo: {
            CFBundleIconFile: "Kirinuki.icns",
            CFBundleURLTypes: [{
              CFBundleTypeRole: "Viewer",
              CFBundleURLName: "Kirinuki Local Engine",
              CFBundleURLSchemes: ["kirinuki-engine"]
            }],
            LSMinimumSystemVersion: DESKTOP_DARWIN_MINIMUM_SYSTEM_VERSION,
            LSUIElement: true
          }
        }
        : {}),
      extraResource: [
        isolatedResources.toolsRoot,
        ...(isolatedResources.nativeRoot ? [isolatedResources.nativeRoot] : [])
      ],
      afterInitialize: [async ({
        buildPath,
        electronVersion,
        platform: initializedPlatform,
        arch: initializedArch
      }) => {
        if (
          runtimeResourceBaseline.snapshot !== undefined
          || electronVersion !== ELECTRON_VERSION
          || initializedPlatform !== platform
          || initializedArch !== arch
        ) {
          throw new Error(
            "Electron pinned runtime resource baseline identity가 packaging target과 다릅니다."
          );
        }
        const resourcesRoot = path.dirname(buildPath);
        const snapshot = await snapshotRegularFileTree(
          resourcesRoot,
          "pinned Electron runtime resources"
        );
        const paths = snapshot.files.map(({ relativePath }) => relativePath);
        const directories = snapshot.directories;
        const reservedResource = (relativePath: string): boolean => (
          relativePath === "default_app"
          || relativePath.startsWith("default_app/")
          || relativePath === "desktop-tools"
          || relativePath.startsWith("desktop-tools/")
          || relativePath === "desktop-native"
          || relativePath.startsWith("desktop-native/")
        );
        if (
          paths.filter((relativePath) => relativePath === "app.asar").length !== 1
          || paths.some((relativePath) => (
            relativePath === "default_app.asar"
            || reservedResource(relativePath)
          ))
          || directories.some(reservedResource)
        ) {
          throw new Error(
            "Electron pinned runtime baseline에 app-owned 또는 default resource가 섞였습니다."
          );
        }
        runtimeResourceBaseline.snapshot = snapshot;
      }],
      prune: true,
      win32metadata: {
        CompanyName: "Kirinuki",
        FileDescription: "Kirinuki local VOD engine",
        InternalName: "Kirinuki",
        OriginalFilename: "Kirinuki.exe",
        ProductName: "Kirinuki"
      }
    });
    if (outputDirectories.length !== 1 || !outputDirectories[0]) {
      throw new Error("Electron packager가 정확히 하나의 앱 디렉터리를 만들지 않았습니다.");
    }
    const packageRoot = path.resolve(outputDirectories[0]);
    if (platform === "darwin") {
      const infoPlist = await readFile(path.join(
        packageRoot,
        "Kirinuki.app",
        "Contents",
        "Info.plist"
      ), "utf8");
      const minimumVersionEntries = infoPlist.match(
        /<key>LSMinimumSystemVersion<\/key>/gu
      ) ?? [];
      const uiElementEntries = infoPlist.match(
        /<key>LSUIElement<\/key>/gu
      ) ?? [];
      const iconEntries = infoPlist.match(
        /<key>CFBundleIconFile<\/key>/gu
      ) ?? [];
      const protocolEntries = infoPlist.match(
        /<key>CFBundleURLTypes<\/key>/gu
      ) ?? [];
      if (
        minimumVersionEntries.length !== 1
        || !new RegExp(
          `<key>LSMinimumSystemVersion</key>\\s*<string>${DESKTOP_DARWIN_MINIMUM_SYSTEM_VERSION.replace(".", "\\.")}</string>`,
          "u"
        ).test(infoPlist)
      ) {
        throw new Error("macOS 최소 버전 package metadata가 올바르지 않습니다.");
      }
      if (
        uiElementEntries.length !== 1
        || !/<key>LSUIElement<\/key>\s*<true\s*\/>/u.test(infoPlist)
      ) {
        throw new Error("macOS package가 Dock 없는 background agent로 표시되지 않습니다.");
      }
      if (
        iconEntries.length !== 1
        || !/<key>CFBundleIconFile<\/key>\s*<string>Kirinuki\.icns<\/string>/u.test(infoPlist)
      ) {
        throw new Error("macOS package 상표 icon metadata가 올바르지 않습니다.");
      }
      if (
        protocolEntries.length !== 1
        || !/<key>CFBundleURLSchemes<\/key>[\s\S]*?<string>kirinuki-engine<\/string>/u.test(infoPlist)
        || !/<key>CFBundleTypeRole<\/key>\s*<string>Viewer<\/string>/u.test(infoPlist)
      ) {
        throw new Error("macOS package의 Kirinuki pairing protocol metadata가 올바르지 않습니다.");
      }
    }
    const executable = packagedExecutable(packageRoot, process.platform);
    await hardenPackagedElectron(
      executable,
      platform === "darwin" && arch === "arm64"
    );
    if (target === "linux-x64") {
      await normalizeLinuxPackagedApplicationModes(packageRoot);
    }
    const executableMetadata = await lstat(executable);
    if (!executableMetadata.isFile() || executableMetadata.isSymbolicLink()) {
      throw new Error("패키지의 Kirinuki 실행 파일이 올바르지 않습니다.");
    }
    const resourcesRoot = packagedResourcesRoot(packageRoot, process.platform);
    const pinnedRuntimeResources = runtimeResourceBaseline.snapshot;
    if (pinnedRuntimeResources === undefined) {
      throw new Error("Electron pinned runtime resource baseline을 만들지 못했습니다.");
    }
    const prefixIdentities = (
      prefix: string,
      identities: readonly DesktopPackageFileIdentity[]
    ): readonly DesktopPackageFileIdentity[] => identities.map((entry) => ({
      ...entry,
      relativePath: `${prefix}/${entry.relativePath}`
    }));
    await assertExactRegularFileTreeSnapshot(
      resourcesRoot,
      {
        files: [
          ...pinnedRuntimeResources.files,
          ...(platform === "darwin" ? [brandAssetIdentity] : []),
          ...prefixIdentities(
            `desktop-tools/${target}`,
            isolatedResources.toolIdentities
          ),
          ...(isolatedResources.nativeIdentities
            ? prefixIdentities(
              `desktop-native/${target}`,
              isolatedResources.nativeIdentities
            )
            : [])
        ],
        directories: [
          ...pinnedRuntimeResources.directories,
          "desktop-tools",
          `desktop-tools/${target}`,
          ...(isolatedResources.nativeIdentities
            ? ["desktop-native", `desktop-native/${target}`]
            : [])
        ].sort()
      },
      "packaged desktop resources"
    );
    verifyDesktopAsar(path.join(resourcesRoot, "app.asar"), asarIdentities);
    await verifyPackagedDesktopTools(resourcesRoot, target);
    if (target === "win32-x64") {
      await verifyPackagedWindowsJobLauncher(resourcesRoot, target);
    }
    return Object.freeze({
      target,
      outputDirectory: packageRoot,
      executable
    });
  } finally {
    await rm(isolatedResources.parent, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1];
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) {
    throw new TypeError("사용법: package-desktop.ts");
  }
  console.log(JSON.stringify(await packageDesktopApplication(), null, 2));
}
