import { spawn } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  LINUX_APP_ARCHIVE_ROOT,
  archiveEntriesForFiles,
  gitBlobObjectId,
  loadLinuxAppPackageCommit,
  readLinuxAppCommitBlob,
  validateArchiveEntryModes
} from "./package-linux-app.js";
import {
  inspectChecksummedArtifact,
  parseKirinukiPackageIdentity,
  sha256File
} from "./release-record.js";

interface RunOptions {
  readonly capture?: boolean;
  readonly cwd?: string;
  readonly environment?: NodeJS.ProcessEnv;
}

interface RunResult {
  readonly stderr: string;
  readonly stdout: string;
}

export interface VerifyLinuxAppPackageOptions {
  readonly archivePath: string;
  readonly expectedArchiveBytes: number;
  readonly expectedArchiveSha256: string;
  readonly expectedPackageLockSha256: string;
  readonly expectedSourceRevision?: string;
  readonly expectedVersion: string;
  readonly repositoryRoot?: string;
}

export interface VerifiedLinuxAppPackage {
  readonly archive: string;
  readonly bytes: number;
  readonly files: number;
  readonly packageLockSha256: string;
  readonly sha256: string;
  readonly sourceRevision: string;
  readonly version: string;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function decodeBufferedProcessOutput(chunks: readonly Buffer[]): string {
  return Buffer.concat(chunks).toString("utf8");
}

async function run(
  command: string,
  args: readonly string[],
  { capture = false, cwd, environment }: RunOptions = {}
): Promise<RunResult> {
  return await new Promise<RunResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      shell: false,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit"
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    if (capture) {
      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdoutChunks.push(Buffer.from(chunk));
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderrChunks.push(Buffer.from(chunk));
      });
    }
    child.once("error", reject);
    child.once("close", (code, signal) => {
      const stdout = decodeBufferedProcessOutput(stdoutChunks);
      const stderr = decodeBufferedProcessOutput(stderrChunks);
      if (code === 0) {
        resolve({ stderr, stdout });
        return;
      }
      reject(new Error(
        signal
          ? `${command}가 ${signal} 신호로 종료됐습니다.`
          : `${command}가 종료 코드 ${String(code)}로 끝났습니다.`
            + (stderr ? `\n${stderr.trim()}` : "")
      ));
    });
  });
}

export function validateLinuxArchiveMemberPaths(
  entries: readonly string[]
): readonly string[] {
  invariant(entries.length > 0, "Linux 소스 archive가 비어 있습니다.");
  const seen = new Set<string>();
  const validated = entries.map((entry) => {
    invariant(
      entry.length > 0
        && !path.posix.isAbsolute(entry)
        && !entry.includes("\\")
        && !/[\u0000-\u001f\u007f]/u.test(entry)
        && path.posix.normalize(entry) === entry,
      `Linux 소스 archive에 안전하지 않은 경로가 있습니다: ${JSON.stringify(entry)}`
    );
    invariant(
      entry.startsWith(`${LINUX_APP_ARCHIVE_ROOT}/`),
      `Linux 소스 archive의 최상위 폴더가 올바르지 않습니다: ${entry}`
    );
    const repositoryPath = entry.slice(LINUX_APP_ARCHIVE_ROOT.length + 1);
    invariant(
      repositoryPath.length > 0
        && repositoryPath.split("/").every(
          (component) => component.length > 0 && component !== "." && component !== ".."
        ),
      `Linux 소스 archive 경로가 최상위 폴더를 이탈합니다: ${entry}`
    );
    invariant(!seen.has(entry), `Linux 소스 archive 경로가 중복됐습니다: ${entry}`);
    seen.add(entry);
    return entry;
  });
  return validated.sort();
}

async function listExtractedFiles(directory: string, prefix = ""): Promise<readonly string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await listExtractedFiles(path.join(directory, entry.name), relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`Linux 소스 archive에 링크나 특수 파일이 있습니다: ${relativePath}`);
    }
  }
  return files.sort();
}

export async function createVerificationEnvironment(
  verificationRoot: string,
  hostEnvironment: NodeJS.ProcessEnv = process.env
): Promise<NodeJS.ProcessEnv> {
  invariant(typeof hostEnvironment.PATH === "string", "archive 검증용 PATH가 없습니다.");
  const homeDirectory = path.join(verificationRoot, "home");
  const cacheDirectory = path.join(verificationRoot, "cache");
  const configDirectory = path.join(verificationRoot, "config");
  const temporaryDirectory = path.join(verificationRoot, "tmp");
  await Promise.all([
    mkdir(homeDirectory),
    mkdir(cacheDirectory),
    mkdir(configDirectory),
    mkdir(temporaryDirectory)
  ]);
  const userConfigPath = path.join(configDirectory, "npm-user.conf");
  const globalConfigPath = path.join(configDirectory, "npm-global.conf");
  await Promise.all([
    writeFile(userConfigPath, "\n", { flag: "wx", mode: 0o600 }),
    writeFile(globalConfigPath, "\n", { flag: "wx", mode: 0o600 })
  ]);
  const environment: NodeJS.ProcessEnv = {
    CI: "1",
    FORCE_COLOR: "0",
    HOME: homeDirectory,
    LANG: "C",
    LC_ALL: "C",
    PATH: hostEnvironment.PATH,
    SOURCE_DATE_EPOCH: "0",
    TMPDIR: temporaryDirectory,
    TZ: "UTC",
    XDG_CACHE_HOME: cacheDirectory,
    XDG_CONFIG_HOME: configDirectory,
    npm_config_audit: "false",
    npm_config_cache: cacheDirectory,
    npm_config_fund: "false",
    npm_config_globalconfig: globalConfigPath,
    npm_config_update_notifier: "false",
    npm_config_userconfig: userConfigPath
  };
  for (const name of [
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
    "https_proxy",
    "http_proxy",
    "no_proxy",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE"
  ]) {
    if (hostEnvironment[name] !== undefined) {
      environment[name] = hostEnvironment[name];
    }
  }
  return environment;
}

export async function verifyLinuxAppPackage({
  archivePath,
  expectedArchiveBytes,
  expectedArchiveSha256,
  expectedPackageLockSha256,
  expectedSourceRevision,
  expectedVersion,
  repositoryRoot = fileURLToPath(new URL("..", import.meta.url))
}: VerifyLinuxAppPackageOptions): Promise<VerifiedLinuxAppPackage> {
  invariant(
    Number.isSafeInteger(expectedArchiveBytes) && expectedArchiveBytes > 0,
    "기대 Linux archive 크기가 올바르지 않습니다."
  );
  invariant(/^[0-9a-f]{64}$/u.test(expectedArchiveSha256), "기대 Linux archive SHA-256이 올바르지 않습니다.");
  invariant(/^[0-9a-f]{64}$/u.test(expectedPackageLockSha256), "기대 package-lock SHA-256이 올바르지 않습니다.");
  invariant(
    expectedSourceRevision === undefined
      || /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(expectedSourceRevision),
    "기대 Linux 앱 source commit이 올바르지 않습니다."
  );
  invariant(
    /^\d+\.\d+\.\d+$/u.test(expectedVersion),
    "기대 package version이 유효한 semver가 아닙니다."
  );
  const requestedArchivePath = path.resolve(archivePath);
  const canonicalArchivePath = await realpath(requestedArchivePath);
  invariant(
    canonicalArchivePath === requestedArchivePath,
    `Linux 소스 archive 경로에 심볼릭 링크가 포함되어 있습니다: ${requestedArchivePath}`
  );
  const archiveMetadata = await lstat(canonicalArchivePath);
  invariant(archiveMetadata.isFile(), "Linux 소스 archive가 일반 파일이 아닙니다.");
  invariant(
    path.basename(canonicalArchivePath) === `kirinuki-linux-v${expectedVersion}.tar.gz`,
    "Linux 소스 archive 파일명과 package version이 다릅니다."
  );
  const checksummedArchive = await inspectChecksummedArtifact(
    path.dirname(canonicalArchivePath),
    path.basename(canonicalArchivePath)
  );
  invariant(
    checksummedArchive.bytes === archiveMetadata.size
      && checksummedArchive.bytes === expectedArchiveBytes
      && checksummedArchive.sha256 === expectedArchiveSha256,
    "Linux 소스 archive가 packager가 보고한 bytes/SHA-256과 다릅니다."
  );
  const canonicalRepositoryRoot = await realpath(repositoryRoot);
  const packageCommit = await loadLinuxAppPackageCommit(
    canonicalRepositoryRoot,
    expectedSourceRevision
  );
  const expectedMembers = archiveEntriesForFiles(packageCommit.files);

  const verificationRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-release-verify-"));
  try {
    const deterministicEnvironment = await createVerificationEnvironment(verificationRoot);
    const verifiedArchivePath = path.join(verificationRoot, "verified-source.tar.gz");
    await copyFile(canonicalArchivePath, verifiedArchivePath);
    invariant(
      await sha256File(verifiedArchivePath) === checksummedArchive.sha256,
      "checksum 검증 뒤 만든 Linux 소스 archive snapshot이 원본과 다릅니다."
    );
    const memberOutput = await run("tar", [
      "--list",
      "--gzip",
      "--file",
      verifiedArchivePath
    ], { capture: true, environment: deterministicEnvironment });
    const archiveOrderMembers = memberOutput.stdout
      .split("\n")
      .filter((entry) => entry.length > 0);
    const members = validateLinuxArchiveMemberPaths(archiveOrderMembers);
    invariant(
      JSON.stringify(members) === JSON.stringify(expectedMembers),
      "Linux 소스 archive 파일 목록이 release commit allowlist와 정확히 일치하지 않습니다."
    );
    const verboseOutput = await run("tar", [
      "--list",
      "--verbose",
      "--gzip",
      "--file",
      verifiedArchivePath
    ], { capture: true, environment: deterministicEnvironment });
    const verboseEntries = verboseOutput.stdout.split("\n").filter((entry) => entry.length > 0);
    validateArchiveEntryModes(
      archiveOrderMembers,
      verboseEntries,
      packageCommit.files
    );

    const extractionRoot = path.join(verificationRoot, "extracted");
    await mkdir(extractionRoot);
    await run("tar", [
      "--extract",
      "--gzip",
      "--file",
      verifiedArchivePath,
      "--directory",
      extractionRoot,
      "--no-same-owner",
      "--no-same-permissions"
    ], { environment: deterministicEnvironment });
    const extractedFiles = await listExtractedFiles(extractionRoot);
    invariant(
      JSON.stringify(extractedFiles) === JSON.stringify(members),
      "Linux 소스 archive의 추출 결과가 사전 검증한 파일 목록과 다릅니다."
    );
    const applicationRoot = path.join(extractionRoot, LINUX_APP_ARCHIVE_ROOT);
    for (const file of packageCommit.files) {
      const archiveContent = await readFile(path.join(
        applicationRoot,
        ...file.repositoryPath.split("/")
      ));
      invariant(
        gitBlobObjectId(
          archiveContent,
          file.objectId.length as 40 | 64
        ) === file.objectId,
        `Linux 소스 archive의 blob identity가 release commit과 다릅니다: ${file.repositoryPath}`
      );
      const commitContent = await readLinuxAppCommitBlob(
        canonicalRepositoryRoot,
        packageCommit.sourceRevision,
        file
      );
      invariant(
        archiveContent.equals(commitContent),
        `Linux 소스 archive의 파일 bytes가 release commit과 다릅니다: ${file.repositoryPath}`
      );
    }
    const packageJsonPath = path.join(applicationRoot, "package.json");
    const packageLockPath = path.join(applicationRoot, "package-lock.json");
    const [packageJsonContent, packageLockContent] = await Promise.all([
      readFile(packageJsonPath),
      readFile(packageLockPath)
    ]);
    const identity = parseKirinukiPackageIdentity(packageJsonContent, packageLockContent);
    invariant(identity.version === expectedVersion, "추출한 package version이 릴리스 버전과 다릅니다.");
    invariant(
      await sha256File(packageLockPath) === expectedPackageLockSha256,
      "추출한 package-lock.json이 release commit의 package-lock.json과 다릅니다."
    );

    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    await run(npmCommand, ["ci", "--ignore-scripts"], {
      cwd: applicationRoot,
      environment: deterministicEnvironment
    });
    await run(npmCommand, ["run", "build"], {
      cwd: applicationRoot,
      environment: deterministicEnvironment
    });
    await run(npmCommand, ["run", "validate"], {
      cwd: applicationRoot,
      environment: deterministicEnvironment
    });
    await run(npmCommand, ["test"], {
      cwd: applicationRoot,
      environment: deterministicEnvironment
    });
    invariant(
      await sha256File(packageLockPath) === expectedPackageLockSha256,
      "archive 검증 명령이 package-lock.json을 변경했습니다."
    );
    invariant(
      await sha256File(canonicalArchivePath) === checksummedArchive.sha256,
      "Linux 소스 archive가 검증 도중 변경되었습니다."
    );

    return {
      archive: canonicalArchivePath,
      bytes: expectedArchiveBytes,
      files: members.length,
      packageLockSha256: expectedPackageLockSha256,
      sha256: expectedArchiveSha256,
      sourceRevision: packageCommit.sourceRevision,
      version: identity.version
    };
  } finally {
    await rm(verificationRoot, { recursive: true, force: true });
  }
}

function isDirectExecution(moduleUrl: string, argvEntry: string | undefined): boolean {
  return argvEntry !== undefined && path.resolve(argvEntry) === fileURLToPath(moduleUrl);
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const [
    archivePath,
    expectedVersion,
    expectedPackageLockSha256,
    expectedArchiveSha256,
    expectedArchiveBytesText,
    expectedSourceRevision,
    ...extraArguments
  ]
    = process.argv.slice(2);
  if (
    archivePath === undefined
    || expectedVersion === undefined
    || expectedPackageLockSha256 === undefined
    || expectedArchiveSha256 === undefined
    || expectedArchiveBytesText === undefined
    || extraArguments.length > 0
  ) {
    throw new TypeError(
      "사용법: verify-linux-app-package.ts <archive.tar.gz> <version> "
        + "<package-lock-sha256> <archive-sha256> <archive-bytes> [source-revision]"
    );
  }
  const expectedArchiveBytes = Number(expectedArchiveBytesText);
  try {
    console.log(JSON.stringify(await verifyLinuxAppPackage({
      archivePath,
      expectedArchiveBytes,
      expectedArchiveSha256,
      expectedPackageLockSha256,
      ...(expectedSourceRevision === undefined ? {} : { expectedSourceRevision }),
      expectedVersion
    }), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}
