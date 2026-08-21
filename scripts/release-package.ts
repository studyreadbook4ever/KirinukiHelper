import type { ChildProcess } from "node:child_process";
import type { Dirent } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  acquireDevRunnerLock,
  releaseDevRunnerLock,
  releaseDevRunnerLockSync
} from "./dev-runner-lock.js";
import {
  inspectChecksummedArtifact,
  parseKirinukiPackageIdentity,
  sha256Bytes,
  writeKirinukiReleaseRecord
} from "./release-record.js";
import type { KirinukiReleaseArtifact } from "./release-record.js";
import {
  runReleaseCommand,
  signalReleaseChild
} from "./release-command-runner.js";
import { typescriptCommandArgs } from "./typescript-runtime.js";

const root = fileURLToPath(new URL("..", import.meta.url));
if (process.argv.slice(2).length > 0) {
  throw new TypeError("사용법: release-package.ts");
}
const lockPath = path.join(root, ".dev-editor.lock");
const releaseLease = await acquireDevRunnerLock(lockPath, {
  pid: process.pid,
  role: "package"
});
const blockedEnvironmentNames = new Set([
  "BASH_ENV",
  "CDPATH",
  "ENV",
  "GZIP",
  "IFS",
  "PERL5OPT",
  "RUBYOPT",
  "SHELLOPTS",
  "TAR_OPTIONS",
  "UNZIPOPT",
  "ZIPOPT"
]);
const sanitizedProcessEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => (
    !blockedEnvironmentNames.has(name)
      && !name.startsWith("DYLD_")
      && !name.startsWith("GIT_")
      && !name.startsWith("KIRINUKI_")
      && !name.startsWith("LD_")
      && !name.startsWith("NODE_")
      && !name.startsWith("NPM_CONFIG_")
      && !name.startsWith("PYTHON")
      && !name.startsWith("npm_config_")
      && !name.startsWith("TSX_")
  ))
) satisfies NodeJS.ProcessEnv;
const childEnvironment: NodeJS.ProcessEnv = {
  ...sanitizedProcessEnvironment,
  KIRINUKI_RELEASE_LOCK_TOKEN: releaseLease.lock.token
};
const gitEnvironment: NodeJS.ProcessEnv = {
  ...sanitizedProcessEnvironment
};
const signalExitCodes = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143
} as const;
let activeChild: ChildProcess | null = null;
let stopping = false;

interface RunOptions {
  readonly capture?: boolean;
  readonly environment?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
}

function run(
  command: string,
  args: readonly string[],
  {
    capture = false,
    environment = childEnvironment,
    timeoutMs = 20 * 60_000
  }: RunOptions = {}
): Promise<Buffer> {
  return runReleaseCommand(command, args, {
    capture,
    cwd: root,
    environment,
    onChildFinished: (child) => {
      if (activeChild === child) {
        activeChild = null;
      }
    },
    onChildStarted: (child) => {
      activeChild = child;
    },
    timeoutMs
  });
}

async function assertRepositoryClean(expectedRevision?: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  const repositoryTopLevel = (await run("git", [
    "rev-parse",
    "--show-toplevel"
  ], {
    capture: true,
    environment: gitEnvironment,
    timeoutMs: 30_000
  })).toString("utf8").trim();
  if (await realpath(repositoryTopLevel) !== canonicalRoot) {
    throw new Error(
      `릴리스 git top-level이 Kirinuki repository와 다릅니다: ${repositoryTopLevel}`
    );
  }
  const revision = (await run("git", [
    "rev-parse",
    "--verify",
    "HEAD^{commit}"
  ], {
    capture: true,
    environment: gitEnvironment,
    timeoutMs: 30_000
  })).toString("utf8").trim();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(revision)) {
    throw new Error("릴리스할 git commit SHA를 확인하지 못했습니다.");
  }
  if (expectedRevision !== undefined && revision !== expectedRevision) {
    throw new Error(
      `릴리스 검증 중 HEAD가 변경되었습니다: ${expectedRevision} -> ${revision}`
    );
  }
  const status = await run("git", [
    "-c",
    "core.quotepath=false",
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all"
  ], {
    capture: true,
    environment: gitEnvironment,
    timeoutMs: 30_000
  });
  if (status.byteLength > 0) {
    const paths = status.toString("utf8").split("\0").filter(Boolean).join("\n");
    throw new Error(
      "릴리스는 ignored 파일을 제외한 전체 repository가 clean일 때만 만들 수 있습니다. "
        + "변경·staged·untracked 파일을 모두 commit하거나 제거하세요."
        + (paths ? `\n${paths}` : "")
    );
  }
  return revision;
}

function parsePackagerArtifactReport(
  output: Uint8Array,
  {
    expectedFilename,
    expectedSourceRevision,
    label
  }: {
    readonly expectedFilename: string;
    readonly expectedSourceRevision?: string;
    readonly label: string;
  }
): KirinukiReleaseArtifact {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(output).toString("utf8"));
  } catch (error) {
    throw new Error(`${label} packager가 단 하나의 유효한 JSON report를 출력하지 않았습니다.`, {
      cause: error
    });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} packager report가 JSON object가 아닙니다.`);
  }
  const report = parsed as Record<string, unknown>;
  const expectedArchive = `dist/${expectedFilename}`;
  const expectedChecksum = `${expectedArchive}.sha256`;
  if (
    report.archive !== expectedArchive
    || report.checksum !== expectedChecksum
    || typeof report.bytes !== "number"
    || !Number.isSafeInteger(report.bytes)
    || report.bytes <= 0
    || typeof report.sha256 !== "string"
    || !/^[0-9a-f]{64}$/u.test(report.sha256)
  ) {
    throw new Error(`${label} packager report의 artifact identity/bytes/SHA-256이 올바르지 않습니다.`);
  }
  if (
    expectedSourceRevision !== undefined
    && report.sourceRevision !== expectedSourceRevision
  ) {
    throw new Error(`${label} packager report의 sourceRevision이 release commit과 다릅니다.`);
  }
  return {
    bytes: report.bytes,
    checksumFile: `${expectedFilename}.sha256`,
    file: expectedFilename,
    sha256: report.sha256
  };
}

async function assertReportedArtifactMatchesDisk(
  expected: KirinukiReleaseArtifact,
  label: string
): Promise<void> {
  const actual = await inspectChecksummedArtifact(path.join(root, "dist"), expected.file);
  if (
    actual.bytes !== expected.bytes
    || actual.checksumFile !== expected.checksumFile
    || actual.file !== expected.file
    || actual.sha256 !== expected.sha256
  ) {
    throw new Error(`${label} artifact가 packager JSON report와 다릅니다.`);
  }
}

async function assertNoStaleReleaseOutputs(version: string): Promise<void> {
  const distDirectory = path.join(root, "dist");
  let entries: Dirent[];
  try {
    entries = await readdir(distDirectory, { withFileTypes: true });
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
  const allowedFiles = new Set([
    `kirinuki-web-v${version}.zip`,
    `kirinuki-web-v${version}.zip.sha256`,
    `kirinuki-release-v${version}.json`,
    `kirinuki-release-v${version}.json.sha256`
  ]);
  for (const entry of entries) {
    if (!entry.isFile() || !allowedFiles.has(entry.name)) {
      throw new Error(
        `dist에 현재 ${version} 릴리스와 무관한 파일이 있습니다. `
          + `릴리스 전에 별도로 보관하거나 치우세요: dist/${entry.name}`
      );
    }
  }
}

function waitForChildExit(
  child: ChildProcess | null,
  timeoutMs: number
): Promise<boolean> {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

async function terminateActiveChild(
  signal: NodeJS.Signals = "SIGTERM"
) {
  const child = activeChild;
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  signalReleaseChild(child, signal);
  if (!await waitForChildExit(child, 5_000)) {
    signalReleaseChild(child, "SIGKILL");
    await waitForChildExit(child, 5_000);
  }
}

async function main() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const sourceRevision = await assertRepositoryClean();
  const [packageJsonContent, packageLockContent] = await Promise.all([
    run("git", ["show", `${sourceRevision}:package.json`], {
      capture: true,
      environment: gitEnvironment,
      timeoutMs: 30_000
    }),
    run("git", ["show", `${sourceRevision}:package-lock.json`], {
      capture: true,
      environment: gitEnvironment,
      timeoutMs: 30_000
    })
  ]);
  const identity = parseKirinukiPackageIdentity(packageJsonContent, packageLockContent);
  const packageLockSha256 = sha256Bytes(packageLockContent);
  await assertNoStaleReleaseOutputs(identity.version);
  await run(npmCommand, ["run", "check:full"], { timeoutMs: 20 * 60_000 });
  await assertRepositoryClean(sourceRevision);

  const webFilename = `kirinuki-web-v${identity.version}.zip`;
  const webPackageEnvironment: NodeJS.ProcessEnv = {
    ...childEnvironment,
    KIRINUKI_RELEASE_SOURCE_REVISION: sourceRevision
  };
  const webReport = await run(process.execPath, typescriptCommandArgs(
    path.join(root, "scripts", "package-web.ts")
  ), {
    capture: true,
    environment: webPackageEnvironment,
    timeoutMs: 5 * 60_000
  });
  const webArtifact = parsePackagerArtifactReport(webReport, {
    expectedFilename: webFilename,
    expectedSourceRevision: sourceRevision,
    label: "공개 web"
  });
  await assertReportedArtifactMatchesDisk(webArtifact, "공개 web");
  await run(npmCommand, ["run", "test:package:web:reproducibility"], {
    environment: webPackageEnvironment,
    timeoutMs: 5 * 60_000
  });
  await assertReportedArtifactMatchesDisk(
    webArtifact,
    "공개 web 재현성 검증 이후"
  );
  await run(npmCommand, ["run", "test:browser:public-shell"], {
    timeoutMs: 5 * 60_000
  });
  await assertReportedArtifactMatchesDisk(webArtifact, "공개 web browser smoke 이후");
  await assertRepositoryClean(sourceRevision);

  const releaseRecord = await writeKirinukiReleaseRecord({
    distDirectory: path.join(root, "dist"),
    expectedArtifacts: {
      web: webArtifact
    },
    expectedPackageLockSha256: packageLockSha256,
    repositoryRoot: root,
    sourceRevision
  });
  await assertRepositoryClean(sourceRevision);
  console.log(JSON.stringify({
    manifest: releaseRecord.manifest,
    bytes: releaseRecord.bytes,
    sha256: releaseRecord.sha256,
    checksum: releaseRecord.checksum,
    sourceRevision,
    packageLockSha256,
    artifacts: releaseRecord.record.artifacts
  }, null, 2));
}

for (const signal of [
  "SIGINT",
  "SIGTERM",
  "SIGHUP"
] satisfies NodeJS.Signals[]) {
  process.once(signal, () => {
    if (stopping) {
      return;
    }
    stopping = true;
    void terminateActiveChild(signal).finally(async () => {
      await releaseDevRunnerLock(releaseLease);
      process.exit(signalExitCodes[signal]);
    });
  });
}

process.once("exit", () => {
  if (
    activeChild
    && activeChild.exitCode === null
    && activeChild.signalCode === null
  ) {
    signalReleaseChild(activeChild, "SIGKILL");
  }
  releaseDevRunnerLockSync(releaseLease);
});

try {
  await main();
} catch (error) {
  if (!stopping) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
} finally {
  await releaseDevRunnerLock(releaseLease);
}
