import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LINUX_APP_PACKAGE_DIRECTORIES,
  LINUX_APP_PACKAGE_ROOT_FILES,
  LINUX_APP_OPTIONAL_WHISPER_PREREQUISITES,
  LINUX_APP_REQUIRED_SYSTEM_PREREQUISITES,
  archiveEntriesForFiles,
  assertNoEmbeddedPrivateKey,
  assertSafeRepositoryPath,
  createLinuxAppPackage,
  gitBlobObjectId,
  isPotentialSecretPath,
  loadLinuxAppPackageCommit,
  parseGitIndexEntries,
  parseGitTreeEntries,
  readLinuxAppCommitBlob,
  selectLinuxAppPackageFiles,
  validateArchiveEntryModes,
  validateArchiveEntries
} from "../scripts/package-linux-app.js";
import type { GitIndexEntry } from "../scripts/package-linux-app.js";
import { verifyLinuxAppPackage } from "../scripts/verify-linux-app-package.js";

interface CommandResult {
  readonly stderr: string;
  readonly stdout: string;
}

async function run(
  command: string,
  args: readonly string[],
  cwd: string
): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, LANG: "C", LC_ALL: "C", TZ: "UTC" },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve({ stderr, stdout });
        return;
      }
      reject(new Error(
        signal
          ? `${command} received ${signal}`
          : `${command} exited with ${String(code)}: ${stderr}`
      ));
    });
  });
}

function fakeIndexEntry(
  repositoryPath: string,
  mode = "100644",
  stage = 0
): GitIndexEntry {
  return {
    mode,
    objectId: "0".repeat(40),
    repositoryPath,
    stage
  };
}

async function writeFixtureFile(
  root: string,
  repositoryPath: string,
  content = `${repositoryPath}\n`
): Promise<void> {
  const destination = path.join(root, ...repositoryPath.split("/"));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

async function createPackageFixture(): Promise<{
  readonly expectedRepositoryPaths: readonly string[];
  readonly root: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "kirinuki-linux-package-test-"));
  await run("git", ["init", "--quiet"], root);

  for (const repositoryPath of LINUX_APP_PACKAGE_ROOT_FILES) {
    await writeFixtureFile(
      root,
      repositoryPath,
      repositoryPath === "package.json"
        ? `${JSON.stringify({ name: "kirinuki-app", version: "9.8.7" }, null, 2)}\n`
        : repositoryPath === "package-lock.json"
          ? `${JSON.stringify({
            name: "kirinuki-app",
            version: "9.8.7",
            lockfileVersion: 3,
            packages: { "": { name: "kirinuki-app", version: "9.8.7" } }
          }, null, 2)}\n`
          : undefined
    );
  }
  await chmod(path.join(root, "kirinuki.sh"), 0o755);
  await chmod(path.join(root, "setup.sh"), 0o755);

  const directoryPayloads = LINUX_APP_PACKAGE_DIRECTORIES.map(
    (directory) => `${directory}/package-payload.txt`
  );
  for (const repositoryPath of directoryPayloads) {
    await writeFixtureFile(root, repositoryPath);
  }
  for (const repositoryPath of [
    "src/node_modules/unwanted.js",
    "web/dist/unwanted.js",
    "scripts/.dev-editor.lock"
  ]) {
    await writeFixtureFile(root, repositoryPath, "must not ship\n");
  }
  await run("git", ["add", "--force", "."], root);
  await run("git", [
    "-c",
    "user.name=Kirinuki Test",
    "-c",
    "user.email=kirinuki-test@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture"
  ], root);

  return {
    expectedRepositoryPaths: [
      ...LINUX_APP_PACKAGE_ROOT_FILES,
      ...directoryPayloads
    ].sort(),
    root
  };
}

async function rewriteFixtureArchive(
  fixtureRoot: string,
  archivePath: string,
  repositoryPaths: readonly string[],
  mutate: (applicationRoot: string) => Promise<void>
): Promise<{ readonly bytes: number; readonly sha256: string }> {
  const rewriteRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-linux-archive-rewrite-"));
  try {
    await run("tar", ["--extract", "--gzip", "--file", archivePath, "--directory", rewriteRoot], fixtureRoot);
    await mutate(path.join(rewriteRoot, "KirinukiHelper"));
    await rm(archivePath, { force: true });
    await run("tar", [
      "--create",
      "--gzip",
      "--format=ustar",
      "--sort=name",
      "--mtime=@0",
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "--no-recursion",
      "--file",
      archivePath,
      "--directory",
      rewriteRoot,
      ...repositoryPaths.map((repositoryPath) => `KirinukiHelper/${repositoryPath}`)
    ], fixtureRoot);
    const archive = await readFile(archivePath);
    const sha256 = createHash("sha256").update(archive).digest("hex");
    await writeFile(
      `${archivePath}.sha256`,
      `${sha256}  ${path.basename(archivePath)}\n`
    );
    return { bytes: archive.byteLength, sha256 };
  } finally {
    await rm(rewriteRoot, { recursive: true, force: true });
  }
}

test("git 인덱스 파서와 Linux 소스 앱 allowlist는 순서와 모드를 고정한다", () => {
  const objectId = "a".repeat(40);
  const parsed = parseGitIndexEntries(
    `100755 ${objectId} 0\tkirinuki.sh\0`
      + `100644 ${objectId} 0\tsrc/main.ts\0`
      + `100644 ${objectId} 0\tAudSeg/tests/test.py\0`
      + `100644 ${objectId} 0\ttests/app.test.ts\0`
  );
  assert.deepEqual(selectLinuxAppPackageFiles(parsed), [
    { mode: 0o644, objectId, repositoryPath: "AudSeg/tests/test.py" },
    { mode: 0o755, objectId, repositoryPath: "kirinuki.sh" },
    { mode: 0o644, objectId, repositoryPath: "src/main.ts" },
    { mode: 0o644, objectId, repositoryPath: "tests/app.test.ts" }
  ]);
  assert.deepEqual(archiveEntriesForFiles([
    { repositoryPath: "src/z.ts" },
    { repositoryPath: "README.md" }
  ]), [
    "KirinukiHelper/README.md",
    "KirinukiHelper/src/z.ts"
  ]);
});

test("release commit tree 파서는 blob과 object ID를 직접 고정한다", () => {
  const objectId = "b".repeat(40);
  assert.deepEqual(parseGitTreeEntries(
    `100755 blob ${objectId}\tkirinuki.sh\0`
      + `100644 blob ${objectId}\tsrc/main.ts\0`
  ), [
    {
      mode: "100755",
      objectId,
      objectType: "blob",
      repositoryPath: "kirinuki.sh",
      stage: 0
    },
    {
      mode: "100644",
      objectId,
      objectType: "blob",
      repositoryPath: "src/main.ts",
      stage: 0
    }
  ]);
  assert.throws(
    () => parseGitTreeEntries(`160000 commit ${objectId}\tvendor/submodule\0`),
    /일반 blob/u
  );
});

test("git blob object ID 검증은 SHA-1과 SHA-256 repository 형식을 모두 지원한다", () => {
  const content = Buffer.from("Kirinuki release bytes\n", "utf8");
  assert.equal(gitBlobObjectId(content, 40).length, 40);
  assert.equal(gitBlobObjectId(content, 64).length, 64);
  assert.notEqual(gitBlobObjectId(content, 40), gitBlobObjectId(Buffer.from("changed"), 40));
});

test("경로 이탈, 비밀정보 경로, 심볼릭 링크 git mode를 fail-closed로 거절한다", () => {
  for (const unsafePath of [
    "../README.md",
    "src/../../README.md",
    "/etc/passwd",
    "src\\escape.ts",
    "src//main.ts",
    "src/new\nline.ts"
  ]) {
    assert.throws(() => assertSafeRepositoryPath(unsafePath));
  }
  for (const secretPath of [
    "scripts/.env",
    "src/private.pem",
    "web/service-account-prod.json",
    "AudSeg/id_ed25519"
  ]) {
    assert.equal(isPotentialSecretPath(secretPath), true);
    assert.throws(
      () => selectLinuxAppPackageFiles([fakeIndexEntry(secretPath)]),
      /비밀정보/u
    );
  }
  assert.throws(
    () => selectLinuxAppPackageFiles([fakeIndexEntry("src/link.ts", "120000")]),
    /일반 파일/u
  );
  assert.throws(
    () => selectLinuxAppPackageFiles([fakeIndexEntry("src/main.ts", "100644", 2)]),
    /병합되지 않은/u
  );
  for (const launcher of ["kirinuki.sh", "setup.sh"]) {
    assert.throws(
      () => selectLinuxAppPackageFiles([fakeIndexEntry(launcher, "100644")]),
      /100755/u
    );
  }
  assert.throws(
    () => selectLinuxAppPackageFiles([fakeIndexEntry("unexpected-root.txt")]),
    /allowlist 밖/u
  );
  assert.throws(
    () => assertNoEmbeddedPrivateKey(
      "src/credential.ts",
      Buffer.from(["-----BEGIN", "PRIVATE KEY-----"].join(" "))
    ),
    /비밀키/u
  );
});

test("archive 검증은 한 top folder의 exact allowlist만 허용한다", () => {
  assert.deepEqual(validateArchiveEntries([
    "KirinukiHelper/src/main.ts",
    "KirinukiHelper/README.md"
  ], [
    "README.md",
    "src/main.ts"
  ]), [
    "KirinukiHelper/README.md",
    "KirinukiHelper/src/main.ts"
  ]);
  assert.throws(
    () => validateArchiveEntries(["README.md"], ["README.md"]),
    /최상위 폴더/u
  );
  assert.throws(
    () => validateArchiveEntries(
      ["KirinukiHelper/../outside"],
      ["README.md"]
    ),
    /정규화되지 않은|이탈/u
  );
  assert.throws(
    () => validateArchiveEntries(
      ["KirinukiHelper/README.md", "KirinukiHelper/src/extra.ts"],
      ["README.md"]
    ),
    /exact|allowlist/u
  );
});

test("archive mode 검증은 commit의 0644/0755와 다른 header를 거절한다", () => {
  const files = [
    { mode: 0o755 as const, objectId: "a".repeat(40), repositoryPath: "kirinuki.sh" },
    { mode: 0o644 as const, objectId: "b".repeat(40), repositoryPath: "src/main.ts" }
  ];
  validateArchiveEntryModes(
    ["KirinukiHelper/kirinuki.sh", "KirinukiHelper/src/main.ts"],
    [
      "-rwxr-xr-x 0/0 1 1970-01-01 00:00 KirinukiHelper/kirinuki.sh",
      "-rw-r--r-- 0/0 1 1970-01-01 00:00 KirinukiHelper/src/main.ts"
    ],
    files
  );
  assert.throws(
    () => validateArchiveEntryModes(
      ["KirinukiHelper/kirinuki.sh", "KirinukiHelper/src/main.ts"],
      [
        "-rw-r--r-- 0/0 1 1970-01-01 00:00 KirinukiHelper/kirinuki.sh",
        "-rw-r--r-- 0/0 1 1970-01-01 00:00 KirinukiHelper/src/main.ts"
      ],
      files
    ),
    /mode가 release commit과 다릅니다/u
  );
});

test("commit snapshot은 index 변조와 worktree ABA 뒤에도 같은 tree/blob만 읽는다", {
  skip: process.platform !== "linux"
}, async () => {
  const fixture = await createPackageFixture();
  try {
    const revision = (await run("git", ["rev-parse", "HEAD"], fixture.root)).stdout.trim();
    const before = await loadLinuxAppPackageCommit(fixture.root, revision);
    const targetBefore = before.files.find(
      (file) => file.repositoryPath === "src/package-payload.txt"
    );
    assert.ok(targetBefore);
    const committedBytes = await readLinuxAppCommitBlob(fixture.root, revision, targetBefore);

    const targetPath = path.join(fixture.root, "src", "package-payload.txt");
    await writeFile(targetPath, "index-only replacement\n");
    await run("git", ["add", "--", "src/package-payload.txt"], fixture.root);
    await writeFile(targetPath, committedBytes);

    const stagedObjectId = (await run(
      "git",
      ["rev-parse", ":src/package-payload.txt"],
      fixture.root
    )).stdout.trim();
    assert.notEqual(stagedObjectId, targetBefore.objectId);
    assert.deepEqual(await readFile(targetPath), committedBytes);

    const after = await loadLinuxAppPackageCommit(fixture.root, revision);
    const targetAfter = after.files.find(
      (file) => file.repositoryPath === "src/package-payload.txt"
    );
    assert.deepEqual(targetAfter, targetBefore);
    assert.deepEqual(
      await readLinuxAppCommitBlob(fixture.root, revision, targetAfter!),
      committedBytes
    );

    const packaged = await createLinuxAppPackage({
      repositoryRoot: fixture.root,
      sourceRevision: revision
    });
    const archivedBytes = (await run("tar", [
      "--extract",
      "--gzip",
      "--to-stdout",
      "--file",
      path.join(fixture.root, packaged.archive),
      "KirinukiHelper/src/package-payload.txt"
    ], fixture.root)).stdout;
    assert.equal(archivedBytes, committedBytes.toString("utf8"));
    assert.equal(packaged.sourceRevision, revision);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("README와 HELP는 기본 요구사항과 Whisper 전용 빌드 도구를 분리한다", async () => {
  const documents = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../HELP.md", import.meta.url), "utf8")
  ]);
  for (const document of documents) {
    assert.match(
      document,
      /기본[^\n]*도구[\s\S]*Node\.js 22\.17\.0 이상[\s\S]*FFmpeg와 ffprobe/u
    );
    assert.match(
      document,
      /Whisper 자막 방식을 선택할 때만[^\n]*\n\n- CMake\n- tar\n- C\+\+ 컴파일러/u
    );
  }
});

test("Linux source-app tar.gz는 재현 가능하고 checksum 및 비독립형 metadata가 정확하다", {
  skip: process.platform !== "linux"
}, async () => {
  const fixture = await createPackageFixture();
  try {
    const first = await createLinuxAppPackage({ repositoryRoot: fixture.root });
    const archivePath = path.join(fixture.root, first.archive);
    const checksumPath = path.join(fixture.root, first.checksum);
    const firstArchive = await readFile(archivePath);
    const firstChecksum = await readFile(checksumPath, "utf8");
    const expectedSha256 = createHash("sha256").update(firstArchive).digest("hex");
    const listedEntries = (await run("tar", ["-tzf", archivePath], fixture.root))
      .stdout.trim().split("\n").filter(Boolean);

    assert.equal(first.archive, "dist/kirinuki-linux-v9.8.7.tar.gz");
    assert.equal(first.checksum, `${first.archive}.sha256`);
    assert.equal(first.sha256, expectedSha256);
    assert.equal(firstChecksum, `${expectedSha256}  kirinuki-linux-v9.8.7.tar.gz\n`);
    assert.equal(first.selfContained, false);
    assert.equal(first.format, "linux-source-app");
    assert.equal(first.topLevelDirectory, "KirinukiHelper/");
    assert.equal(
      first.sourceRevision,
      (await run("git", ["rev-parse", "HEAD"], fixture.root)).stdout.trim()
    );
    assert.deepEqual(
      first.optionalWhisperPrerequisites,
      LINUX_APP_OPTIONAL_WHISPER_PREREQUISITES
    );
    assert.deepEqual(first.optionalWhisperPrerequisites, [
      "CMake",
      "tar",
      "C++ compiler"
    ]);
    assert.equal(
      (first.requiredSystemPrerequisites as readonly string[]).includes("CMake"),
      false
    );
    assert.deepEqual(
      first.requiredSystemPrerequisites,
      LINUX_APP_REQUIRED_SYSTEM_PREREQUISITES
    );
    assert.equal(first.files, fixture.expectedRepositoryPaths.length);
    assert.deepEqual(
      listedEntries,
      fixture.expectedRepositoryPaths.map((entry) => `KirinukiHelper/${entry}`).sort()
    );
    assert.equal(
      listedEntries.some((entry) => (
        entry.includes("node_modules")
        || entry.includes("/dist/")
        || entry.includes(".dev-editor.lock")
      )),
      false
    );

    const second = await createLinuxAppPackage({ repositoryRoot: fixture.root });
    const secondArchive = await readFile(path.join(fixture.root, second.archive));
    assert.deepEqual(secondArchive, firstArchive);
    assert.equal(second.sha256, first.sha256);

    const trackedSource = path.join(fixture.root, "src", "package-payload.txt");
    await rm(trackedSource);
    await symlink("/etc/passwd", trackedSource);
    await assert.rejects(
      createLinuxAppPackage({ repositoryRoot: fixture.root }),
      /commit되지 않은 변경/u
    );

    await rm(trackedSource);
    await writeFixtureFile(fixture.root, "src/package-payload.txt");
    await writeFixtureFile(fixture.root, "src/untracked-release-file.ts", "untracked\n");
    await assert.rejects(
      createLinuxAppPackage({ repositoryRoot: fixture.root }),
      /commit되지 않은 변경/u
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Linux verifier는 archive의 실행 mode가 release commit과 다르면 npm 전에 거절한다", {
  skip: process.platform !== "linux"
}, async () => {
  const fixture = await createPackageFixture();
  try {
    const packaged = await createLinuxAppPackage({ repositoryRoot: fixture.root });
    const archivePath = path.join(fixture.root, packaged.archive);
    const rewritten = await rewriteFixtureArchive(
      fixture.root,
      archivePath,
      fixture.expectedRepositoryPaths,
      async (applicationRoot) => {
        await chmod(path.join(applicationRoot, "kirinuki.sh"), 0o644);
      }
    );
    const packageLock = await readFile(path.join(fixture.root, "package-lock.json"));
    await assert.rejects(
      verifyLinuxAppPackage({
        archivePath,
        expectedArchiveBytes: rewritten.bytes,
        expectedArchiveSha256: rewritten.sha256,
        expectedPackageLockSha256: createHash("sha256").update(packageLock).digest("hex"),
        expectedSourceRevision: packaged.sourceRevision,
        expectedVersion: "9.8.7",
        repositoryRoot: fixture.root
      }),
      /mode가 release commit과 다릅니다/u
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Linux verifier는 archive blob bytes가 release commit과 다르면 npm 전에 거절한다", {
  skip: process.platform !== "linux"
}, async () => {
  const fixture = await createPackageFixture();
  try {
    const packaged = await createLinuxAppPackage({ repositoryRoot: fixture.root });
    const archivePath = path.join(fixture.root, packaged.archive);
    const rewritten = await rewriteFixtureArchive(
      fixture.root,
      archivePath,
      fixture.expectedRepositoryPaths,
      async (applicationRoot) => {
        await writeFile(
          path.join(applicationRoot, "src", "package-payload.txt"),
          "archive-only replacement\n"
        );
      }
    );
    const packageLock = await readFile(path.join(fixture.root, "package-lock.json"));
    await assert.rejects(
      verifyLinuxAppPackage({
        archivePath,
        expectedArchiveBytes: rewritten.bytes,
        expectedArchiveSha256: rewritten.sha256,
        expectedPackageLockSha256: createHash("sha256").update(packageLock).digest("hex"),
        expectedSourceRevision: packaged.sourceRevision,
        expectedVersion: "9.8.7",
        repositoryRoot: fixture.root
      }),
      /blob identity가 release commit과 다릅니다/u
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
