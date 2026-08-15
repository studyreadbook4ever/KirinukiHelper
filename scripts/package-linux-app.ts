import { spawn } from "node:child_process";
import { constants, createReadStream } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  acquireDevRunnerLock,
  failClosedOnDevRunnerOwnerLoss,
  releaseDevRunnerLock
} from "./dev-runner-lock.js";

export const LINUX_APP_ARCHIVE_ROOT = "KirinukiHelper";

export const LINUX_APP_PACKAGE_DIRECTORIES = Object.freeze([
  ".github",
  "AudSeg",
  "legal",
  "public-shell",
  "scripts",
  "skills",
  "src",
  "streaming-companion",
  "tests",
  "vendor",
  "web"
] as const);

export const LINUX_APP_PACKAGE_ROOT_FILES = Object.freeze([
  ".gitattributes",
  ".gitignore",
  "AGENTS.md",
  "HELP.md",
  "README.md",
  "UNLICENSE",
  "kirinuki.sh",
  "setup.sh",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.web.json",
  "tsconfig.web.source.json"
] as const);

export const LINUX_APP_REQUIRED_SYSTEM_PREREQUISITES = Object.freeze([
  "Linux",
  "Node.js 22.17.0 or newer",
  "npm",
  "Chromium 120 or newer",
  "Python 3.11 or newer",
  "FFmpeg",
  "ffprobe"
] as const);

export const LINUX_APP_OPTIONAL_WHISPER_PREREQUISITES = Object.freeze([
  "CMake",
  "tar",
  "C++ compiler"
] as const);

const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  "dist",
  "node_modules"
]);

const FORBIDDEN_SECRET_BASENAMES = new Set([
  ".netrc",
  ".npmrc",
  ".pypirc",
  "credentials",
  "credentials.json",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "secret",
  "secrets"
]);

const FORBIDDEN_SECRET_EXTENSIONS = new Set([
  ".jks",
  ".key",
  ".keystore",
  ".p12",
  ".pem",
  ".pfx"
]);

const PRIVATE_KEY_SIGNATURES = [
  ["-----BEGIN", "PRIVATE KEY-----"].join(" "),
  ["-----BEGIN RSA", "PRIVATE KEY-----"].join(" "),
  ["-----BEGIN EC", "PRIVATE KEY-----"].join(" "),
  ["-----BEGIN OPENSSH", "PRIVATE KEY-----"].join(" "),
  ["-----BEGIN PGP", "PRIVATE KEY BLOCK-----"].join(" ")
].map((value) => Buffer.from(value, "utf8"));

export interface GitIndexEntry {
  readonly mode: string;
  readonly objectId: string;
  readonly objectType?: "blob";
  readonly repositoryPath: string;
  readonly stage: number;
}

export interface LinuxAppPackageFile {
  readonly mode: 0o644 | 0o755;
  readonly objectId: string;
  readonly repositoryPath: string;
}

export interface LinuxAppPackageMetadata {
  readonly archive: string;
  readonly bytes: number;
  readonly checksum: string;
  readonly files: number;
  readonly format: "linux-source-app";
  readonly optionalWhisperPrerequisites: typeof LINUX_APP_OPTIONAL_WHISPER_PREREQUISITES;
  readonly requiredSystemPrerequisites: typeof LINUX_APP_REQUIRED_SYSTEM_PREREQUISITES;
  readonly selfContained: false;
  readonly sha256: string;
  readonly sourceRevision: string;
  readonly topLevelDirectory: "KirinukiHelper/";
}

export interface CreateLinuxAppPackageOptions {
  readonly distDirectory?: string;
  readonly repositoryRoot?: string;
  readonly sourceRevision?: string;
}

export interface LinuxAppPackageCommit {
  readonly files: readonly LinuxAppPackageFile[];
  readonly sourceRevision: string;
}

interface RunResult {
  readonly stderr: Buffer;
  readonly stdout: Buffer;
}

interface RunOptions {
  readonly cwd?: string;
  readonly environment?: NodeJS.ProcessEnv;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function comparePaths(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function assertSafeRepositoryPath(repositoryPath: string): void {
  invariant(repositoryPath.length > 0, "패키지 경로가 비어 있습니다.");
  invariant(
    !path.posix.isAbsolute(repositoryPath),
    `패키지에 절대 경로를 넣을 수 없습니다: ${repositoryPath}`
  );
  invariant(
    !repositoryPath.includes("\\"),
    `패키지 경로에는 역슬래시를 사용할 수 없습니다: ${repositoryPath}`
  );
  invariant(
    !/[\u0000-\u001f\u007f]/u.test(repositoryPath),
    `패키지 경로에는 제어 문자를 사용할 수 없습니다: ${JSON.stringify(repositoryPath)}`
  );
  invariant(
    path.posix.normalize(repositoryPath) === repositoryPath,
    `정규화되지 않은 패키지 경로입니다: ${repositoryPath}`
  );
  const components = repositoryPath.split("/");
  invariant(
    components.every((component) => component !== "" && component !== "." && component !== ".."),
    `패키지 경로 이탈을 허용하지 않습니다: ${repositoryPath}`
  );
}

export function isPotentialSecretPath(repositoryPath: string): boolean {
  assertSafeRepositoryPath(repositoryPath);
  const basename = path.posix.basename(repositoryPath).toLowerCase();
  if (
    basename === ".env"
    || basename.startsWith(".env.")
    || basename.startsWith("credentials.")
    || basename.startsWith("secret.")
    || basename.startsWith("secrets.")
    || /^service-account(?:[._-].*)?\.json$/u.test(basename)
    || /^id_(?:dsa|ecdsa|ed25519|rsa)(?:\..*)?$/u.test(basename)
  ) {
    return true;
  }
  return FORBIDDEN_SECRET_BASENAMES.has(basename)
    || FORBIDDEN_SECRET_EXTENSIONS.has(path.posix.extname(basename));
}

export function assertNoEmbeddedPrivateKey(
  repositoryPath: string,
  content: Uint8Array
): void {
  for (const signature of PRIVATE_KEY_SIGNATURES) {
    invariant(
      !Buffer.from(content.buffer, content.byteOffset, content.byteLength).includes(signature),
      `비밀키로 보이는 내용이 있어 패키지를 중단했습니다: ${repositoryPath}`
    );
  }
}

export function parseGitIndexEntries(output: Uint8Array | string): readonly GitIndexEntry[] {
  const text = typeof output === "string"
    ? output
    : Buffer.from(output.buffer, output.byteOffset, output.byteLength).toString("utf8");
  if (text.length === 0) {
    return [];
  }
  invariant(text.endsWith("\0"), "git ls-files 결과가 NUL로 끝나지 않습니다.");
  const entries: GitIndexEntry[] = [];
  const seenPaths = new Set<string>();
  for (const record of text.slice(0, -1).split("\0")) {
    const tabIndex = record.indexOf("\t");
    invariant(tabIndex > 0, "git ls-files 레코드 형식이 올바르지 않습니다.");
    const metadata = record.slice(0, tabIndex);
    const repositoryPath = record.slice(tabIndex + 1);
    const match = /^(\d{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-3])$/u.exec(metadata);
    invariant(match, `git ls-files 메타데이터 형식이 올바르지 않습니다: ${metadata}`);
    assertSafeRepositoryPath(repositoryPath);
    invariant(
      !seenPaths.has(repositoryPath),
      `git 인덱스에 경로가 중복됐습니다: ${repositoryPath}`
    );
    seenPaths.add(repositoryPath);
    entries.push({
      mode: match[1]!,
      objectId: match[2]!,
      repositoryPath,
      stage: Number(match[3])
    });
  }
  return entries;
}

export function parseGitTreeEntries(output: Uint8Array | string): readonly GitIndexEntry[] {
  const text = typeof output === "string"
    ? output
    : Buffer.from(output.buffer, output.byteOffset, output.byteLength).toString("utf8");
  if (text.length === 0) {
    return [];
  }
  invariant(text.endsWith("\0"), "git ls-tree 결과가 NUL로 끝나지 않습니다.");
  const entries: GitIndexEntry[] = [];
  const seenPaths = new Set<string>();
  for (const record of text.slice(0, -1).split("\0")) {
    const tabIndex = record.indexOf("\t");
    invariant(tabIndex > 0, "git ls-tree 레코드 형식이 올바르지 않습니다.");
    const metadata = record.slice(0, tabIndex);
    const repositoryPath = record.slice(tabIndex + 1);
    const match = /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40}|[0-9a-f]{64})$/u.exec(metadata);
    invariant(match, `git ls-tree 메타데이터 형식이 올바르지 않습니다: ${metadata}`);
    assertSafeRepositoryPath(repositoryPath);
    invariant(
      !seenPaths.has(repositoryPath),
      `release commit tree에 경로가 중복됐습니다: ${repositoryPath}`
    );
    seenPaths.add(repositoryPath);
    invariant(
      match[2] === "blob",
      `release commit tree의 일반 blob이 아닌 항목을 패키지할 수 없습니다: ${repositoryPath} (${match[2]})`
    );
    entries.push({
      mode: match[1]!,
      objectId: match[3]!,
      objectType: "blob",
      repositoryPath,
      stage: 0
    });
  }
  return entries;
}

function isAllowlistedPath(repositoryPath: string): boolean {
  if ((LINUX_APP_PACKAGE_ROOT_FILES as readonly string[]).includes(repositoryPath)) {
    return true;
  }
  return LINUX_APP_PACKAGE_DIRECTORIES.some(
    (directory) => repositoryPath.startsWith(`${directory}/`)
  );
}

function isExcludedPath(repositoryPath: string): boolean {
  const components = repositoryPath.split("/");
  const basename = components.at(-1)!;
  return components.some((component) => EXCLUDED_DIRECTORY_NAMES.has(component))
    || basename === ".dev-editor.lock"
    || /^\.dev-.*\.lock$/u.test(basename);
}

export function selectLinuxAppPackageFiles(
  entries: readonly GitIndexEntry[]
): readonly LinuxAppPackageFile[] {
  const selected: LinuxAppPackageFile[] = [];
  const selectedPaths = new Set<string>();
  for (const entry of entries) {
    assertSafeRepositoryPath(entry.repositoryPath);
    invariant(entry.stage === 0, `병합되지 않은 git 경로가 있습니다: ${entry.repositoryPath}`);
    invariant(
      entry.objectType === undefined || entry.objectType === "blob",
      `일반 blob이 아닌 git 항목을 패키지에 넣을 수 없습니다: ${entry.repositoryPath}`
    );
    if (isExcludedPath(entry.repositoryPath)) {
      continue;
    }
    invariant(
      isAllowlistedPath(entry.repositoryPath),
      `새 tracked 경로가 Linux 소스 앱 allowlist 밖에 있습니다: ${entry.repositoryPath}`
    );
    invariant(
      !isPotentialSecretPath(entry.repositoryPath),
      `비밀정보 파일로 보이는 경로가 있어 패키지를 중단했습니다: ${entry.repositoryPath}`
    );
    invariant(
      entry.mode === "100644" || entry.mode === "100755",
      `일반 파일이 아닌 git 항목을 패키지에 넣을 수 없습니다: ${entry.repositoryPath} (${entry.mode})`
    );
    if (entry.repositoryPath === "kirinuki.sh" || entry.repositoryPath === "setup.sh") {
      invariant(
        entry.mode === "100755",
        `Linux 앱 실행 진입점은 git mode 100755여야 합니다: ${entry.repositoryPath} (${entry.mode})`
      );
    }
    invariant(
      !selectedPaths.has(entry.repositoryPath),
      `패키지 파일 경로가 중복됐습니다: ${entry.repositoryPath}`
    );
    selectedPaths.add(entry.repositoryPath);
    selected.push({
      mode: entry.mode === "100755" ? 0o755 : 0o644,
      objectId: entry.objectId,
      repositoryPath: entry.repositoryPath
    });
  }
  return selected.sort((left, right) => comparePaths(
    left.repositoryPath,
    right.repositoryPath
  ));
}

export function archiveEntriesForFiles(
  files: readonly Pick<LinuxAppPackageFile, "repositoryPath">[]
): readonly string[] {
  return files.map(({ repositoryPath }) => {
    assertSafeRepositoryPath(repositoryPath);
    return `${LINUX_APP_ARCHIVE_ROOT}/${repositoryPath}`;
  }).sort(comparePaths);
}

export function validateArchiveEntries(
  actualEntries: readonly string[],
  expectedRepositoryPaths: readonly string[]
): readonly string[] {
  const expectedEntries = expectedRepositoryPaths.map((repositoryPath) => {
    assertSafeRepositoryPath(repositoryPath);
    invariant(
      !isPotentialSecretPath(repositoryPath),
      `비밀정보 파일로 보이는 경로는 패키지할 수 없습니다: ${repositoryPath}`
    );
    return `${LINUX_APP_ARCHIVE_ROOT}/${repositoryPath}`;
  }).sort(comparePaths);
  const seenEntries = new Set<string>();
  const normalizedActual = actualEntries.map((archiveEntry) => {
    invariant(
      archiveEntry.startsWith(`${LINUX_APP_ARCHIVE_ROOT}/`),
      `압축 파일의 최상위 폴더가 올바르지 않습니다: ${archiveEntry}`
    );
    const repositoryPath = archiveEntry.slice(LINUX_APP_ARCHIVE_ROOT.length + 1);
    assertSafeRepositoryPath(repositoryPath);
    invariant(
      !isPotentialSecretPath(repositoryPath),
      `압축 파일에 비밀정보 경로가 있습니다: ${archiveEntry}`
    );
    invariant(!seenEntries.has(archiveEntry), `압축 파일 경로가 중복됐습니다: ${archiveEntry}`);
    seenEntries.add(archiveEntry);
    return archiveEntry;
  }).sort(comparePaths);
  invariant(
    JSON.stringify(normalizedActual) === JSON.stringify(expectedEntries),
    "압축 파일 목록이 Linux 앱 allowlist와 정확히 일치하지 않습니다.\n"
      + `expected=${JSON.stringify(expectedEntries, null, 2)}\n`
      + `actual=${JSON.stringify(normalizedActual, null, 2)}`
  );
  return normalizedActual;
}

export function validateArchiveEntryModes(
  archiveEntries: readonly string[],
  verboseEntries: readonly string[],
  files: readonly LinuxAppPackageFile[]
): void {
  invariant(
    archiveEntries.length === verboseEntries.length,
    "압축 파일의 일반 목록과 verbose 목록 길이가 다릅니다."
  );
  const expectedModes = new Map(files.map((file) => [
    `${LINUX_APP_ARCHIVE_ROOT}/${file.repositoryPath}`,
    file.mode === 0o755 ? "-rwxr-xr-x" : "-rw-r--r--"
  ]));
  for (let index = 0; index < archiveEntries.length; index += 1) {
    const archiveEntry = archiveEntries[index]!;
    const verboseEntry = verboseEntries[index]!;
    const expectedMode = expectedModes.get(archiveEntry);
    invariant(expectedMode !== undefined, `압축 파일 mode allowlist에 없는 경로입니다: ${archiveEntry}`);
    invariant(
      verboseEntry.length > 10
        && verboseEntry.slice(0, 10) === expectedMode
        && verboseEntry[10] === " ",
      `압축 파일 mode가 release commit과 다릅니다: ${archiveEntry} (expected=${expectedMode}, actual=${verboseEntry.slice(0, 10)})`
    );
  }
}

async function run(
  command: string,
  args: readonly string[],
  { cwd, environment }: RunOptions = {}
): Promise<RunResult> {
  return await new Promise<RunResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      const stdout = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks);
      if (code === 0) {
        resolve({ stderr, stdout });
        return;
      }
      reject(new Error(
        signal
          ? `${command}가 ${signal} 신호로 종료됐습니다.`
          : `${command}가 종료 코드 ${String(code)}로 끝났습니다.`
            + (stderr.length > 0 ? `\n${stderr.toString("utf8").trim()}` : "")
      ));
    });
  });
}

async function runWithStdoutFile(
  command: string,
  args: readonly string[],
  outputPath: string,
  { cwd, environment }: RunOptions = {}
): Promise<void> {
  const output = await open(outputPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: environment,
        shell: false,
        stdio: ["ignore", output.fd, "pipe"]
      });
      const stderrChunks: Buffer[] = [];
      child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(
          signal
            ? `${command}가 ${signal} 신호로 종료됐습니다.`
            : `${command}가 종료 코드 ${String(code)}로 끝났습니다.`
              + (stderr ? `\n${stderr}` : "")
        ));
      });
    });
  } finally {
    await output.close();
  }
}

async function sha256File(filePath: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    digest.update(chunk as Buffer);
  }
  return digest.digest("hex");
}

export function gitBlobObjectId(
  content: Uint8Array,
  objectIdLength: 40 | 64
): string {
  const bytes = Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  const digest = createHash(objectIdLength === 40 ? "sha1" : "sha256");
  digest.update(`blob ${String(bytes.byteLength)}\0`, "utf8");
  digest.update(bytes);
  return digest.digest("hex");
}

function assertFullGitObjectId(value: string, label: string): void {
  invariant(
    /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(value),
    `${label} git object ID가 올바르지 않습니다: ${value}`
  );
}

export async function resolveLinuxAppSourceRevision(
  repositoryRoot: string,
  requestedRevision?: string
): Promise<string> {
  if (requestedRevision !== undefined) {
    assertFullGitObjectId(requestedRevision, "요청한 Linux 앱 source commit");
  }
  const revision = (await run("git", [
    "rev-parse",
    "--verify",
    `${requestedRevision ?? "HEAD"}^{commit}`
  ], { cwd: repositoryRoot })).stdout.toString("utf8").trim();
  assertFullGitObjectId(revision, "Linux 앱 source commit");
  invariant(
    requestedRevision === undefined || revision === requestedRevision,
    "요청한 Linux 앱 source commit이 정확한 commit object로 해석되지 않았습니다."
  );
  return revision;
}

export async function loadLinuxAppPackageCommit(
  repositoryRoot: string,
  requestedRevision?: string
): Promise<LinuxAppPackageCommit> {
  const sourceRevision = await resolveLinuxAppSourceRevision(
    repositoryRoot,
    requestedRevision
  );
  const gitOutput = await run("git", [
    "-c",
    "core.quotepath=false",
    "ls-tree",
    "--full-tree",
    "-r",
    "-z",
    sourceRevision
  ], { cwd: repositoryRoot });
  const files = selectLinuxAppPackageFiles(parseGitTreeEntries(gitOutput.stdout));
  invariant(files.length > 0, "Linux 앱 패키지 allowlist가 비어 있습니다.");
  invariant(
    files.every((file) => file.objectId.length === sourceRevision.length),
    "release commit과 blob의 git object 형식이 일치하지 않습니다."
  );
  for (const requiredPath of ["kirinuki.sh", "setup.sh", "package.json", "package-lock.json"]) {
    invariant(
      files.some(({ repositoryPath }) => repositoryPath === requiredPath),
      `Linux 앱 패키지 필수 파일이 release commit에 없습니다: ${requiredPath}`
    );
  }
  return { files, sourceRevision };
}

export async function readLinuxAppCommitBlob(
  repositoryRoot: string,
  sourceRevision: string,
  file: LinuxAppPackageFile
): Promise<Buffer> {
  assertFullGitObjectId(sourceRevision, "Linux 앱 source commit");
  assertSafeRepositoryPath(file.repositoryPath);
  assertFullGitObjectId(file.objectId, `Linux 앱 blob ${file.repositoryPath}`);
  const content = (await run("git", [
    "cat-file",
    "blob",
    `${sourceRevision}:${file.repositoryPath}`
  ], { cwd: repositoryRoot })).stdout;
  invariant(
    gitBlobObjectId(content, file.objectId.length as 40 | 64) === file.objectId,
    `release commit 경로의 blob 내용과 object ID가 다릅니다: ${file.repositoryPath}`
  );
  assertNoEmbeddedPrivateKey(file.repositoryPath, content);
  return content;
}

async function copyVerifiedCommitBlob(
  repositoryRoot: string,
  sourceRevision: string,
  stagingRoot: string,
  file: LinuxAppPackageFile
): Promise<void> {
  const content = await readLinuxAppCommitBlob(
    repositoryRoot,
    sourceRevision,
    file
  );

  const destinationPath = path.join(stagingRoot, ...file.repositoryPath.split("/"));
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, content, { flag: "wx", mode: file.mode });
  await chmod(destinationPath, file.mode);
}

async function listExtractedRegularFiles(
  directory: string,
  prefix = ""
): Promise<readonly string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await listExtractedRegularFiles(
        path.join(directory, entry.name),
        relativePath
      ));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`압축 파일에 심볼릭 링크나 특수 파일이 있습니다: ${relativePath}`);
    }
  }
  return files.sort(comparePaths);
}

function validateVersion(version: unknown): asserts version is string {
  invariant(
    typeof version === "string"
      && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version),
    "package.json version이 유효한 semver가 아닙니다."
  );
}

function relativeOutputPath(repositoryRoot: string, outputPath: string): string {
  return path.relative(repositoryRoot, outputPath).split(path.sep).join("/");
}

function releaseScopePathspec(): readonly string[] {
  return [
    ...LINUX_APP_PACKAGE_ROOT_FILES,
    ...LINUX_APP_PACKAGE_DIRECTORIES
  ];
}

async function assertCleanPackageSource(repositoryRoot: string): Promise<string> {
  const revision = await resolveLinuxAppSourceRevision(repositoryRoot);
  const status = (await run("git", [
    "-c",
    "core.quotepath=false",
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--",
    ...releaseScopePathspec()
  ], { cwd: repositoryRoot })).stdout;
  invariant(
    status.byteLength === 0,
    "Linux 앱 패키지 범위에 commit되지 않은 변경이나 새 파일이 있습니다. 먼저 정확한 release commit을 만드세요."
  );
  invariant(
    await resolveLinuxAppSourceRevision(repositoryRoot) === revision,
    "Linux 앱 패키지 source commit이 준비 확인 도중 변경되었습니다."
  );
  return revision;
}

export async function createLinuxAppPackage({
  repositoryRoot = fileURLToPath(new URL("..", import.meta.url)),
  distDirectory,
  sourceRevision: requestedSourceRevision
}: CreateLinuxAppPackageOptions = {}): Promise<LinuxAppPackageMetadata> {
  const canonicalRepositoryRoot = await realpath(repositoryRoot);
  const sourceRevision = requestedSourceRevision === undefined
    ? await assertCleanPackageSource(canonicalRepositoryRoot)
    : await resolveLinuxAppSourceRevision(
      canonicalRepositoryRoot,
      requestedSourceRevision
    );
  const { files } = await loadLinuxAppPackageCommit(
    canonicalRepositoryRoot,
    sourceRevision
  );
  const packageManifestFile = files.find(
    ({ repositoryPath }) => repositoryPath === "package.json"
  );
  invariant(packageManifestFile, "Linux 앱 패키지에 package.json이 없습니다.");
  const packageMetadata = JSON.parse(
    (await readLinuxAppCommitBlob(
      canonicalRepositoryRoot,
      sourceRevision,
      packageManifestFile
    )).toString("utf8")
  ) as { readonly name?: unknown; readonly version?: unknown };
  invariant(
    packageMetadata.name === "kirinuki-app",
    "Linux 앱 package.json name이 kirinuki-app이 아닙니다."
  );
  validateVersion(packageMetadata.version);
  const packageLockFile = files.find(
    ({ repositoryPath }) => repositoryPath === "package-lock.json"
  );
  invariant(packageLockFile, "Linux 앱 패키지에 package-lock.json이 없습니다.");
  const packageLockMetadata = JSON.parse(
    (await readLinuxAppCommitBlob(
      canonicalRepositoryRoot,
      sourceRevision,
      packageLockFile
    )).toString("utf8")
  ) as {
    readonly name?: unknown;
    readonly version?: unknown;
    readonly packages?: Readonly<Record<string, {
      readonly name?: unknown;
      readonly version?: unknown;
    }>>;
  };
  invariant(
    packageLockMetadata.name === packageMetadata.name
      && packageLockMetadata.version === packageMetadata.version
      && packageLockMetadata.packages?.[""]?.name === packageMetadata.name
      && packageLockMetadata.packages?.[""]?.version === packageMetadata.version,
    "package-lock.json의 root name/version이 package.json과 다릅니다."
  );

  const requestedDistRoot = path.resolve(
    distDirectory ?? path.join(canonicalRepositoryRoot, "dist")
  );
  await mkdir(requestedDistRoot, { recursive: true });
  const distMetadata = await lstat(requestedDistRoot);
  invariant(distMetadata.isDirectory(), `dist 경로가 디렉터리가 아닙니다: ${requestedDistRoot}`);
  invariant(
    await realpath(requestedDistRoot) === requestedDistRoot,
    `dist 경로에 심볼릭 링크가 포함되어 있습니다: ${requestedDistRoot}`
  );

  const archiveName = `kirinuki-linux-v${packageMetadata.version}.tar.gz`;
  const archivePath = path.join(requestedDistRoot, archiveName);
  const checksumPath = `${archivePath}.sha256`;
  const temporaryRoot = await mkdtemp(path.join(requestedDistRoot, ".kirinuki-linux-package-"));
  const stagingParent = path.join(temporaryRoot, "staging");
  const stagingRoot = path.join(stagingParent, LINUX_APP_ARCHIVE_ROOT);
  const tarPath = path.join(temporaryRoot, "archive.tar");
  const temporaryArchivePath = path.join(temporaryRoot, archiveName);
  const temporaryChecksumPath = `${temporaryArchivePath}.sha256`;
  const deterministicEnvironment = {
    ...process.env,
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC"
  };

  try {
    await mkdir(stagingRoot, { recursive: true });
    for (const file of files) {
      await copyVerifiedCommitBlob(
        canonicalRepositoryRoot,
        sourceRevision,
        stagingRoot,
        file
      );
    }

    const expectedArchiveEntries = archiveEntriesForFiles(files);
    const fileListPath = path.join(temporaryRoot, "files.list");
    await writeFile(fileListPath, `${expectedArchiveEntries.join("\0")}\0`, {
      flag: "wx",
      mode: 0o600
    });
    await run("tar", [
      "--create",
      "--format=ustar",
      "--sort=name",
      "--mtime=@0",
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "--no-recursion",
      "--null",
      "--files-from",
      fileListPath,
      "--file",
      tarPath
    ], { cwd: stagingParent, environment: deterministicEnvironment });
    await runWithStdoutFile(
      "gzip",
      ["-n", "-9", "-c", tarPath],
      temporaryArchivePath,
      { environment: deterministicEnvironment }
    );

    const listedEntries = (await run("tar", [
      "--list",
      "--gzip",
      "--file",
      temporaryArchivePath
    ], { environment: deterministicEnvironment })).stdout
      .toString("utf8")
      .split("\n")
      .filter((entry) => entry.length > 0);
    validateArchiveEntries(
      listedEntries,
      files.map(({ repositoryPath }) => repositoryPath)
    );
    const verboseEntries = (await run("tar", [
      "--list",
      "--verbose",
      "--gzip",
      "--file",
      temporaryArchivePath
    ], { environment: deterministicEnvironment })).stdout
      .toString("utf8")
      .split("\n")
      .filter((entry) => entry.length > 0);
    validateArchiveEntryModes(listedEntries, verboseEntries, files);

    const extractionRoot = path.join(temporaryRoot, "extracted");
    await mkdir(extractionRoot);
    await run("tar", [
      "--extract",
      "--gzip",
      "--file",
      temporaryArchivePath,
      "--directory",
      extractionRoot,
      "--no-same-owner",
      "--no-same-permissions"
    ], { environment: deterministicEnvironment });
    const extractedEntries = await listExtractedRegularFiles(extractionRoot);
    validateArchiveEntries(
      extractedEntries,
      files.map(({ repositoryPath }) => repositoryPath)
    );
    for (const file of files) {
      const extractedContent = await open(
        path.join(extractionRoot, LINUX_APP_ARCHIVE_ROOT, ...file.repositoryPath.split("/")),
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
      try {
        const content = await extractedContent.readFile();
        invariant(
          gitBlobObjectId(content, file.objectId.length as 40 | 64) === file.objectId,
          `압축 파일의 blob 내용이 release commit과 다릅니다: ${file.repositoryPath}`
        );
      } finally {
        await extractedContent.close();
      }
    }

    const digest = await sha256File(temporaryArchivePath);
    await chmod(temporaryArchivePath, 0o644);
    await writeFile(
      temporaryChecksumPath,
      `${digest}  ${archiveName}\n`,
      { flag: "wx", mode: 0o644 }
    );
    await chmod(temporaryChecksumPath, 0o644);
    await rename(temporaryArchivePath, archivePath);
    await rename(temporaryChecksumPath, checksumPath);
    const archiveMetadata = await stat(archivePath);

    return {
      archive: relativeOutputPath(canonicalRepositoryRoot, archivePath),
      bytes: archiveMetadata.size,
      checksum: relativeOutputPath(canonicalRepositoryRoot, checksumPath),
      files: files.length,
      format: "linux-source-app",
      optionalWhisperPrerequisites: LINUX_APP_OPTIONAL_WHISPER_PREREQUISITES,
      requiredSystemPrerequisites: LINUX_APP_REQUIRED_SYSTEM_PREREQUISITES,
      selfContained: false,
      sha256: digest,
      sourceRevision,
      topLevelDirectory: "KirinukiHelper/"
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function isDirectExecution(moduleUrl: string, argvEntry: string | undefined): boolean {
  return argvEntry !== undefined && path.resolve(argvEntry) === fileURLToPath(moduleUrl);
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  if (process.argv.slice(2).length > 0) {
    throw new TypeError("사용법: package-linux-app.ts");
  }
  const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
  const lease = await acquireDevRunnerLock(
    path.join(repositoryRoot, ".dev-editor.lock"),
    {
      pid: process.pid,
      role: "package",
      ...(process.env.KIRINUKI_RELEASE_LOCK_TOKEN === undefined
        ? {}
        : { inheritedToken: process.env.KIRINUKI_RELEASE_LOCK_TOKEN }),
      onOwnerLost: failClosedOnDevRunnerOwnerLoss("package:linux")
    }
  );
  try {
    console.log(JSON.stringify(await createLinuxAppPackage({ repositoryRoot }), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  } finally {
    await releaseDevRunnerLock(lease);
  }
}
