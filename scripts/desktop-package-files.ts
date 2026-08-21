import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import {
  extractFile,
  listPackage,
  statFile
} from "@electron/asar";

export const DESKTOP_LEGAL_PACKAGE_FILES = Object.freeze([
  "COMMERCIAL_USE_POLICY.md",
  "DESKTOP_BINARY_RELEASE_GATE.md",
  "FIRST_PARTY_RIGHTS_REVIEW.md",
  "OPEN_SOURCE_INVENTORY.md",
  "RUNTIME_DEPENDENCIES.md",
  "THIRD_PARTY_NOTICES.md",
  "WEB_DEPLOYMENT_CHECKLIST.md",
  "WEB_THIRD_PARTY_NOTICES.md"
].sort());

export const DESKTOP_ASAR_PACKAGE_FILES = Object.freeze([
  "UNLICENSE",
  "main.mjs",
  "package.json",
  ...DESKTOP_LEGAL_PACKAGE_FILES.map((relativePath) => `legal/${relativePath}`)
].sort());

export interface DesktopPackageFileIdentity {
  readonly relativePath: string;
  readonly size: number;
  readonly sha256: string;
  readonly executable: boolean;
}

export interface DesktopPackageTreeSnapshot {
  readonly files: readonly DesktopPackageFileIdentity[];
  readonly directories: readonly string[];
}

export interface ExactRegularFileTreeOptions {
  readonly rejectUnexpectedDirectories?: boolean;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeExpectedFiles(
  expectedFiles: readonly string[]
): readonly string[] {
  const normalized = expectedFiles.map((relativePath) => {
    invariant(
      relativePath.length > 0
        && !path.isAbsolute(relativePath)
        && !relativePath.includes("\\")
        && !relativePath.includes("\0")
        && !relativePath.includes("\n")
        && relativePath.split("/").every((part) => (
          part.length > 0 && part !== "." && part !== ".."
        )),
      `데스크톱 패키지 allowlist 경로가 안전하지 않습니다: ${relativePath}`
    );
    return relativePath;
  }).sort();
  invariant(
    new Set(normalized).size === normalized.length,
    "데스크톱 패키지 allowlist에 중복 경로가 있습니다."
  );
  return normalized;
}

function expectedDirectories(expectedFiles: readonly string[]): readonly string[] {
  const directories = new Set<string>();
  for (const relativePath of expectedFiles) {
    const parts = relativePath.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join("/"));
    }
  }
  return [...directories].sort();
}

function normalizeExpectedDirectories(
  expectedDirectoryPaths: readonly string[]
): readonly string[] {
  const normalized = expectedDirectoryPaths.map((relativePath) => {
    invariant(
      relativePath.length > 0
        && !path.isAbsolute(relativePath)
        && !relativePath.includes("\\")
        && !relativePath.includes("\0")
        && !relativePath.includes("\n")
        && relativePath.split("/").every((part) => (
          part.length > 0 && part !== "." && part !== ".."
        )),
      `데스크톱 패키지 디렉터리 경로가 안전하지 않습니다: ${relativePath}`
    );
    return relativePath;
  }).sort();
  invariant(
    new Set(normalized).size === normalized.length,
    "데스크톱 패키지 디렉터리 목록에 중복 경로가 있습니다."
  );
  return normalized;
}

async function inspectRegularFileTree(
  rootDirectory: string,
  label: string
): Promise<Readonly<{ files: readonly string[]; directories: readonly string[] }>> {
  const rootMetadata = await lstat(rootDirectory);
  invariant(
    rootMetadata.isDirectory()
      && !rootMetadata.isSymbolicLink(),
    `${label} root는 심볼릭 링크가 아닌 실제 디렉터리여야 합니다.`
  );
  const files: string[] = [];
  const directories: string[] = [];
  const visit = async (relativeDirectory: string): Promise<void> => {
    const directory = relativeDirectory
      ? path.join(rootDirectory, ...relativeDirectory.split("/"))
      : rootDirectory;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      if (entry.isSymbolicLink()) {
        throw new Error(`${label}에 심볼릭 링크가 있습니다: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        directories.push(relativePath);
        await visit(relativePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`${label}에 특수 파일이 있습니다: ${relativePath}`);
      }
      files.push(relativePath);
    }
  };
  await visit("");
  return Object.freeze({
    files: Object.freeze(files.sort()),
    directories: Object.freeze(directories.sort())
  });
}

export async function assertExactRegularFileTree(
  rootDirectory: string,
  expectedFiles: readonly string[],
  label: string,
  { rejectUnexpectedDirectories = true }: ExactRegularFileTreeOptions = {}
): Promise<void> {
  const expected = normalizeExpectedFiles(expectedFiles);
  const actual = await inspectRegularFileTree(rootDirectory, label);
  invariant(
    JSON.stringify(actual.files) === JSON.stringify(expected),
    `${label} 파일 목록이 allowlist와 다릅니다.\n`
      + `expected=${JSON.stringify(expected)}\nactual=${JSON.stringify(actual.files)}`
  );
  if (rejectUnexpectedDirectories) {
    const directories = expectedDirectories(expected);
    invariant(
      JSON.stringify(actual.directories) === JSON.stringify(directories),
      `${label} 디렉터리 목록이 allowlist와 다릅니다.\n`
        + `expected=${JSON.stringify(directories)}\n`
        + `actual=${JSON.stringify(actual.directories)}`
    );
  }
}

async function readExactRegularFile(
  rootDirectory: string,
  relativePath: string,
  label: string
): Promise<Readonly<{ bytes: Buffer; mode: number }>> {
  const sourcePath = path.join(rootDirectory, ...relativePath.split("/"));
  const canonicalRoot = await realpath(rootDirectory);
  const canonicalSource = await realpath(sourcePath);
  invariant(
    canonicalSource === path.join(canonicalRoot, ...relativePath.split("/")),
    `${label} 경로에 심볼릭 링크가 있습니다: ${relativePath}`
  );
  const handle = await open(
    sourcePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)
  );
  try {
    const metadata = await handle.stat();
    invariant(
      metadata.isFile(),
      `${label}가 regular file이 아닙니다: ${relativePath}`
    );
    return Object.freeze({
      bytes: await handle.readFile(),
      mode: metadata.mode & 0o777
    });
  } finally {
    await handle.close();
  }
}

function identity(
  relativePath: string,
  bytes: Uint8Array,
  mode: number
): DesktopPackageFileIdentity {
  return Object.freeze({
    relativePath,
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    executable: (mode & 0o111) !== 0
  });
}

export async function snapshotExactRegularFileTree(
  rootDirectory: string,
  expectedFiles: readonly string[],
  label: string,
  options?: ExactRegularFileTreeOptions
): Promise<readonly DesktopPackageFileIdentity[]> {
  const expected = normalizeExpectedFiles(expectedFiles);
  await assertExactRegularFileTree(rootDirectory, expected, label, options);
  return Object.freeze(await Promise.all(expected.map(async (relativePath) => {
    const { bytes, mode } = await readExactRegularFile(
      rootDirectory,
      relativePath,
      label
    );
    return identity(relativePath, bytes, mode);
  })));
}

/**
 * Captures every regular file identity and directory name in a runtime-owned
 * resource tree. This is used for Electron's pinned native template, whose
 * exact macOS Resources layout includes platform-owned empty `.lproj`
 * directories in addition to regular files.
 */
export async function snapshotRegularFileTree(
  rootDirectory: string,
  label: string
): Promise<Readonly<DesktopPackageTreeSnapshot>> {
  const before = await inspectRegularFileTree(rootDirectory, label);
  const files = Object.freeze(await Promise.all(before.files.map(
    async (relativePath) => {
      const { bytes, mode } = await readExactRegularFile(
        rootDirectory,
        relativePath,
        label
      );
      return identity(relativePath, bytes, mode);
    }
  )));
  const after = await inspectRegularFileTree(rootDirectory, label);
  invariant(
    JSON.stringify(after.files) === JSON.stringify(before.files)
      && JSON.stringify(after.directories) === JSON.stringify(before.directories),
    `${label} tree가 identity snapshot 중 바뀌었습니다.`
  );
  return Object.freeze({
    files,
    directories: Object.freeze([...before.directories])
  });
}

/** Verifies a complete tree against a previously captured exact snapshot. */
export async function assertExactRegularFileTreeSnapshot(
  rootDirectory: string,
  expectedSnapshot: Readonly<DesktopPackageTreeSnapshot>,
  label: string
): Promise<void> {
  const expectedPaths = normalizeExpectedFiles(
    expectedSnapshot.files.map(({ relativePath }) => relativePath)
  );
  const expectedByPath = new Map(expectedSnapshot.files.map((entry) => (
    [entry.relativePath, entry] as const
  )));
  const expectedFiles = expectedPaths.map((relativePath) => {
    const entry = expectedByPath.get(relativePath);
    invariant(entry !== undefined, `${label} snapshot 파일 identity가 빠졌습니다.`);
    return entry;
  });
  const expectedDirectoryPaths = normalizeExpectedDirectories(
    expectedSnapshot.directories
  );
  const requiredDirectories = expectedDirectories(expectedPaths);
  invariant(
    requiredDirectories.every((directory) => (
      expectedDirectoryPaths.includes(directory)
    )),
    `${label} snapshot에 파일의 상위 디렉터리가 빠졌습니다.`
  );
  const actual = await snapshotRegularFileTree(rootDirectory, label);
  invariant(
    JSON.stringify(actual.directories) === JSON.stringify(expectedDirectoryPaths),
    `${label} 디렉터리 목록이 pinned snapshot과 다릅니다.\n`
      + `expected=${JSON.stringify(expectedDirectoryPaths)}\n`
      + `actual=${JSON.stringify(actual.directories)}`
  );
  invariant(
    JSON.stringify(actual.files) === JSON.stringify(expectedFiles),
    `${label} 파일 identity가 pinned snapshot과 다릅니다.`
  );
}

export async function copyExactRegularFileTree({
  sourceRoot,
  destinationRoot,
  expectedFiles,
  label,
  sourceOptions
}: {
  readonly sourceRoot: string;
  readonly destinationRoot: string;
  readonly expectedFiles: readonly string[];
  readonly label: string;
  readonly sourceOptions?: ExactRegularFileTreeOptions;
}): Promise<readonly DesktopPackageFileIdentity[]> {
  const expected = normalizeExpectedFiles(expectedFiles);
  await assertExactRegularFileTree(sourceRoot, expected, `${label} source`, sourceOptions);
  const copied = await Promise.all(expected.map(async (relativePath) => {
    const { bytes, mode } = await readExactRegularFile(
      sourceRoot,
      relativePath,
      `${label} source`
    );
    const destination = path.join(
      destinationRoot,
      ...relativePath.split("/")
    );
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, bytes, { flag: "wx", mode });
    await chmod(destination, mode);
    return identity(relativePath, bytes, mode);
  }));
  await assertExactRegularFileTree(
    destinationRoot,
    expected,
    `${label} destination`
  );
  return Object.freeze(copied.sort((left, right) => (
    left.relativePath.localeCompare(right.relativePath, "en")
  )));
}

function asarRelativePath(entry: string): string {
  return entry.replace(/^[/\\]+/u, "").split(path.sep).join("/");
}

export function desktopAsarLookupPath(
  canonicalRelativePath: string,
  separator: "/" | "\\" = path.sep as "/" | "\\"
): string {
  invariant(
    separator === "/" || separator === "\\",
    "ASAR 조회 경로 구분자가 올바르지 않습니다."
  );
  const [normalized] = normalizeExpectedFiles([canonicalRelativePath]);
  invariant(normalized !== undefined, "ASAR 조회 경로가 비어 있습니다.");
  return normalized.split("/").join(separator);
}

export function verifyDesktopAsar(
  archivePath: string,
  expectedIdentities: readonly DesktopPackageFileIdentity[]
): void {
  const expectedFiles = normalizeExpectedFiles(
    expectedIdentities.map(({ relativePath }) => relativePath)
  );
  const actualFiles: string[] = [];
  const actualDirectories: string[] = [];
  for (const entry of listPackage(archivePath, { isPack: false })) {
    const relativePath = asarRelativePath(entry);
    const metadata = statFile(
      archivePath,
      desktopAsarLookupPath(relativePath),
      false
    );
    if ("link" in metadata) {
      throw new Error(`데스크톱 ASAR에 심볼릭 링크가 있습니다: ${relativePath}`);
    }
    if ("files" in metadata) {
      actualDirectories.push(relativePath);
    } else {
      actualFiles.push(relativePath);
    }
  }
  actualFiles.sort();
  actualDirectories.sort();
  invariant(
    JSON.stringify(actualFiles) === JSON.stringify(expectedFiles),
    "데스크톱 ASAR 파일 목록이 검증된 stage와 다릅니다.\n"
      + `expected=${JSON.stringify(expectedFiles)}\nactual=${JSON.stringify(actualFiles)}`
  );
  const directories = expectedDirectories(expectedFiles);
  invariant(
    JSON.stringify(actualDirectories) === JSON.stringify(directories),
    "데스크톱 ASAR 디렉터리 목록이 검증된 stage와 다릅니다.\n"
      + `expected=${JSON.stringify(directories)}\n`
      + `actual=${JSON.stringify(actualDirectories)}`
  );
  for (const expected of expectedIdentities) {
    const lookupPath = desktopAsarLookupPath(expected.relativePath);
    const metadata = statFile(archivePath, lookupPath, false);
    invariant(
      !("link" in metadata)
        && !("files" in metadata)
        && metadata.size === expected.size
        && Boolean(metadata.executable) === expected.executable,
      `데스크톱 ASAR 파일 metadata가 다릅니다: ${expected.relativePath}`
    );
    const bytes = extractFile(archivePath, lookupPath, false);
    invariant(
      createHash("sha256").update(bytes).digest("hex") === expected.sha256,
      `데스크톱 ASAR 파일 SHA-256이 다릅니다: ${expected.relativePath}`
    );
  }
}
