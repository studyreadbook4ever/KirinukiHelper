import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { spawnSync } from "node:child_process";

import {
  buildKirinukiReleaseRecord,
  inspectChecksummedArtifact,
  parseKirinukiPackageIdentity,
  parseSha256Sidecar,
  serializeKirinukiReleaseRecord,
  sha256Bytes,
  writeKirinukiReleaseRecord
} from "../scripts/release-record.js";
import {
  createVerificationEnvironment,
  decodeBufferedProcessOutput,
  validateLinuxArchiveMemberPaths,
  verifyLinuxAppPackage
} from "../scripts/verify-linux-app-package.js";
import { runReleaseCommand } from "../scripts/release-command-runner.js";

const VERSION = "1.2.3";
const SOURCE_REVISION = "a".repeat(40);

function packageJson(version = VERSION): string {
  return `${JSON.stringify({
    name: "kirinuki-app",
    version
  }, null, 2)}\n`;
}

function packageLock(version = VERSION): string {
  return `${JSON.stringify({
    name: "kirinuki-app",
    version,
    lockfileVersion: 3,
    packages: {
      "": {
        name: "kirinuki-app",
        version
      }
    }
  }, null, 2)}\n`;
}

async function writeArtifact(
  distDirectory: string,
  filename: string,
  content: string
): Promise<string> {
  const digest = sha256Bytes(content);
  await writeFile(path.join(distDirectory, filename), content);
  await writeFile(path.join(distDirectory, `${filename}.sha256`), `${digest}  ${filename}\n`);
  return digest;
}

function git(root: string, args: readonly string[]): string {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_NO_REPLACE_OBJECTS: "1"
    },
    shell: false
  });
  assert.equal(result.status, 0, String(result.stderr || result.error || "git 실패"));
  return String(result.stdout || "").trim();
}

test("package.json과 package-lock.json의 Kirinuki identity는 정확히 일치해야 한다", () => {
  assert.deepEqual(
    parseKirinukiPackageIdentity(packageJson(), packageLock()),
    { name: "kirinuki-app", version: VERSION }
  );
  assert.throws(
    () => parseKirinukiPackageIdentity(
      packageJson(),
      packageLock("1.2.4")
    ),
    /정확히 일치/u
  );
  assert.throws(
    () => parseKirinukiPackageIdentity(
      JSON.stringify({ name: "not-kirinuki", version: VERSION }),
      packageLock()
    ),
    /kirinuki-app/u
  );
  assert.throws(
    () => parseKirinukiPackageIdentity("{}", "{}"),
    /package\.json name/u
  );
});

test("SHA-256 sidecar는 digest, 두 칸, basename, LF를 정확히 검증한다", () => {
  const digest = "b".repeat(64);
  const filename = "kirinuki-web-v1.2.3.zip";
  assert.equal(
    parseSha256Sidecar(`${digest}  ${filename}\n`, filename),
    digest
  );
  for (const invalid of [
    `${digest} ${filename}\n`,
    `${digest}  wrong.zip\n`,
    `${digest.toUpperCase()}  ${filename}\n`,
    `${digest}  ${filename}`,
    `${digest}  ${filename}\r\n`,
    `${digest}  ${filename}\nextra\n`
  ]) {
    assert.throws(() => parseSha256Sidecar(invalid, filename));
  }
  assert.throws(
    () => parseSha256Sidecar(`${digest}  ../archive.zip\n`, "../archive.zip"),
    /basename/u
  );
});

test("release record 직렬화는 고정 순서와 LF로 결정적이다", () => {
  const web = {
    bytes: 10,
    checksumFile: `kirinuki-web-v${VERSION}.zip.sha256`,
    file: `kirinuki-web-v${VERSION}.zip`,
    sha256: "c".repeat(64)
  };
  const linux = {
    bytes: 20,
    checksumFile: `kirinuki-linux-v${VERSION}.tar.gz.sha256`,
    file: `kirinuki-linux-v${VERSION}.tar.gz`,
    sha256: "d".repeat(64)
  };
  const record = buildKirinukiReleaseRecord({
    identity: { name: "kirinuki-app", version: VERSION },
    linux,
    packageLockSha256: "e".repeat(64),
    sourceRevision: SOURCE_REVISION,
    web
  });
  const first = serializeKirinukiReleaseRecord(record);
  const second = serializeKirinukiReleaseRecord(buildKirinukiReleaseRecord({
    identity: { name: "kirinuki-app", version: VERSION },
    linux,
    packageLockSha256: "e".repeat(64),
    sourceRevision: SOURCE_REVISION,
    web
  }));
  assert.equal(first, second);
  assert.equal(first.endsWith("\n"), true);
  assert.equal(first.includes("generatedAt"), false);
  assert.deepEqual(JSON.parse(first), record);
  assert.throws(
    () => buildKirinukiReleaseRecord({
      identity: { name: "kirinuki-app", version: VERSION },
      linux,
      packageLockSha256: "e".repeat(64),
      sourceRevision: "short",
      web
    }),
    /commit SHA/u
  );
});

test("실제 artifact와 sidecar를 읽어 결정적 release manifest를 쓰고 readback한다", async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-release-record-test-"));
  const distDirectory = path.join(repositoryRoot, "dist");
  try {
    await mkdir(distDirectory);
    const lockContent = packageLock();
    await Promise.all([
      writeFile(path.join(repositoryRoot, "package.json"), packageJson()),
      writeFile(path.join(repositoryRoot, "package-lock.json"), lockContent)
    ]);
    git(repositoryRoot, ["init", "-q"]);
    git(repositoryRoot, ["config", "user.name", "Kirinuki Test"]);
    git(repositoryRoot, ["config", "user.email", "kirinuki-test@example.invalid"]);
    git(repositoryRoot, ["add", "package.json", "package-lock.json"]);
    git(repositoryRoot, ["commit", "-q", "-m", "fixture"]);
    const sourceRevision = git(repositoryRoot, ["rev-parse", "HEAD"]);
    const webFilename = `kirinuki-web-v${VERSION}.zip`;
    const linuxFilename = `kirinuki-linux-v${VERSION}.tar.gz`;
    const webDigest = await writeArtifact(distDirectory, webFilename, "web archive\n");
    const linuxDigest = await writeArtifact(distDirectory, linuxFilename, "linux archive\n");

    const webArtifact = await inspectChecksummedArtifact(distDirectory, webFilename);
    const linuxArtifact = await inspectChecksummedArtifact(distDirectory, linuxFilename);
    assert.deepEqual(webArtifact, {
      bytes: Buffer.byteLength("web archive\n"),
      checksumFile: `${webFilename}.sha256`,
      file: webFilename,
      sha256: webDigest
    });
    const first = await writeKirinukiReleaseRecord({
      distDirectory,
      expectedArtifacts: {
        linux: linuxArtifact,
        web: webArtifact
      },
      expectedPackageLockSha256: sha256Bytes(lockContent),
      repositoryRoot,
      sourceRevision
    });
    const firstManifest = await readFile(path.join(repositoryRoot, first.manifest));
    const firstSidecar = await readFile(path.join(repositoryRoot, first.checksum), "utf8");
    assert.equal(first.manifest, `dist/kirinuki-release-v${VERSION}.json`);
    assert.equal(first.checksum, `${first.manifest}.sha256`);
    assert.equal(first.sha256, sha256Bytes(firstManifest));
    assert.equal(
      firstSidecar,
      `${first.sha256}  kirinuki-release-v${VERSION}.json\n`
    );
    assert.equal((await stat(path.join(repositoryRoot, first.manifest))).mode & 0o777, 0o644);
    assert.equal((await stat(path.join(repositoryRoot, first.checksum))).mode & 0o777, 0o644);
    assert.equal(first.record.source.gitCommit, sourceRevision);
    assert.equal(first.record.source.packageLockSha256, sha256Bytes(lockContent));
    assert.equal(first.record.artifacts.web.sha256, webDigest);
    assert.equal(first.record.artifacts.linux.sha256, linuxDigest);
    assert.equal(first.record.artifacts.web.bytes, Buffer.byteLength("web archive\n"));
    assert.equal(first.record.artifacts.linux.bytes, Buffer.byteLength("linux archive\n"));

    const previousUmask = process.umask(0o077);
    let second;
    try {
      second = await writeKirinukiReleaseRecord({
        distDirectory,
        expectedArtifacts: {
          linux: linuxArtifact,
          web: webArtifact
        },
        expectedPackageLockSha256: sha256Bytes(lockContent),
        repositoryRoot,
        sourceRevision
      });
    } finally {
      process.umask(previousUmask);
    }
    assert.deepEqual(second.record, first.record);
    assert.equal(second.sha256, first.sha256);
    assert.deepEqual(
      await readFile(path.join(repositoryRoot, second.manifest)),
      firstManifest
    );
    assert.equal((await stat(path.join(repositoryRoot, second.manifest))).mode & 0o777, 0o644);
    assert.equal((await stat(path.join(repositoryRoot, second.checksum))).mode & 0o777, 0o644);

    await writeFile(path.join(repositoryRoot, "package-lock.json"), `${lockContent}\n`);
    const commitBound = await writeKirinukiReleaseRecord({
      distDirectory,
      expectedArtifacts: {
        linux: linuxArtifact,
        web: webArtifact
      },
      expectedPackageLockSha256: sha256Bytes(lockContent),
      repositoryRoot,
      sourceRevision
    });
    assert.equal(commitBound.sha256, first.sha256);
    await assert.rejects(
      writeKirinukiReleaseRecord({
        distDirectory,
        expectedArtifacts: {
          linux: linuxArtifact,
          web: webArtifact
        },
        expectedPackageLockSha256: "0".repeat(64),
        repositoryRoot,
        sourceRevision
      }),
      /release commit의 package-lock/u
    );

    const unrelatedOutputPath = path.join(distDirectory, "unrelated-output.txt");
    await writeFile(unrelatedOutputPath, "must not publish\n");
    await assert.rejects(
      writeKirinukiReleaseRecord({
        distDirectory,
        expectedArtifacts: {
          linux: linuxArtifact,
          web: webArtifact
        },
        expectedPackageLockSha256: sha256Bytes(lockContent),
        repositoryRoot,
        sourceRevision
      }),
      /정확히 닫혀 있지 않습니다/u
    );
    await rm(unrelatedOutputPath);

    await assert.rejects(
      writeKirinukiReleaseRecord({
        distDirectory,
        expectedArtifacts: {
          linux: {
            ...linuxArtifact,
            sha256: webDigest
          },
          web: webArtifact
        },
        expectedPackageLockSha256: sha256Bytes(lockContent),
        repositoryRoot,
        sourceRevision
      }),
      /packager가 보고한 bytes\/SHA-256/u
    );

    await writeFile(
      path.join(distDirectory, `${linuxFilename}.sha256`),
      `${webDigest}  ${linuxFilename}\n`
    );
    await assert.rejects(
      writeKirinukiReleaseRecord({
        distDirectory,
        expectedArtifacts: {
          linux: linuxArtifact,
          web: webArtifact
        },
        expectedPackageLockSha256: sha256Bytes(lockContent),
        repositoryRoot,
        sourceRevision
      }),
      /artifact와 SHA-256 sidecar/u
    );
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("Linux verifier는 packager SHA와 다른 archive를 tar 또는 npm 실행 전에 거절한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kirinuki-release-verify-test-"));
  try {
    const filename = `kirinuki-linux-v${VERSION}.tar.gz`;
    const archivePath = path.join(root, filename);
    const content = "not even a tar archive\n";
    const actualDigest = sha256Bytes(content);
    await writeFile(archivePath, content);
    await writeFile(
      `${archivePath}.sha256`,
      `${actualDigest}  ${filename}\n`
    );
    await assert.rejects(
      verifyLinuxAppPackage({
        archivePath,
        expectedArchiveBytes: Buffer.byteLength(content),
        expectedArchiveSha256: "f".repeat(64),
        expectedPackageLockSha256: "e".repeat(64),
        expectedVersion: VERSION
      }),
      /packager가 보고한 bytes\/SHA-256/u
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("archive 검증 환경은 실행 주입 변수를 버리고 전용 HOME/npm config만 사용한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kirinuki-release-env-test-"));
  try {
    const environment = await createVerificationEnvironment(root, {
      PATH: "/usr/bin:/bin",
      HTTPS_PROXY: "http://proxy.example.invalid:8080",
      GIT_DIR: "/tmp/other.git",
      KIRINUKI_LIVE_VOD_SMOKE: "1",
      NODE_OPTIONS: "--import=/tmp/inject.mjs",
      NODE_PATH: "/tmp/injected-modules",
      npm_config_userconfig: "/tmp/host-npmrc",
      TAR_OPTIONS: "--checkpoint-action=exec=sh payload"
    });
    assert.equal(environment.PATH, "/usr/bin:/bin");
    assert.equal(environment.HTTPS_PROXY, "http://proxy.example.invalid:8080");
    assert.equal(environment.HOME, path.join(root, "home"));
    assert.equal(environment.NODE_OPTIONS, undefined);
    assert.equal(environment.NODE_PATH, undefined);
    assert.equal(environment.GIT_DIR, undefined);
    assert.equal(environment.KIRINUKI_LIVE_VOD_SMOKE, undefined);
    assert.equal(environment.TAR_OPTIONS, undefined);
    assert.equal(environment.npm_config_userconfig, path.join(root, "config", "npm-user.conf"));
    assert.equal(
      await readFile(environment.npm_config_userconfig!, "utf8"),
      "\n"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Linux verifier 출력은 잘린 UTF-8 chunk를 모두 모은 뒤 한 번만 decode한다", () => {
  const expected = "준비 완료 😀 자막";
  const encoded = Buffer.from(expected, "utf8");
  const emojiStart = encoded.indexOf(Buffer.from("😀", "utf8"));
  assert.notEqual(emojiStart, -1);
  assert.equal(
    decodeBufferedProcessOutput([
      encoded.subarray(0, emojiStart + 1),
      encoded.subarray(emojiStart + 1, emojiStart + 3),
      encoded.subarray(emojiStart + 3)
    ]),
    expected
  );
});

test("릴리스 명령은 signal 실패와 close 부재에도 최종 기한 안에 한 번만 거절한다", async () => {
  let child: import("node:child_process").ChildProcess | null = null;
  let childClosed: Promise<void> | null = null;
  let signalAttempts = 0;
  const startedAt = Date.now();
  try {
    await assert.rejects(
      runReleaseCommand(process.execPath, [
        "-e",
        "setInterval(() => undefined, 1000)"
      ], {
        capture: true,
        cwd: process.cwd(),
        environment: { ...process.env },
        finalizationGraceMs: 20,
        onChildStarted: (startedChild) => {
          child = startedChild;
          childClosed = new Promise<void>((resolve) => {
            startedChild.once("close", () => resolve());
          });
        },
        signalChild: () => {
          signalAttempts += 1;
          throw new Error("테스트 signal 거부");
        },
        terminationGraceMs: 20,
        timeoutMs: 20
      }),
      (error: unknown) => {
        assert.match(String(error), /20ms 제한/u);
        assert.match(String(error), /테스트 signal 거부/u);
        return true;
      }
    );
    assert.equal(signalAttempts, 2);
    assert.ok(Date.now() - startedAt < 1_000, "최종 거절 기한이 bounded여야 합니다.");
  } finally {
    const startedChild = child as import("node:child_process").ChildProcess | null;
    if (
      startedChild !== null
      && startedChild.exitCode === null
      && startedChild.signalCode === null
    ) {
      startedChild.kill("SIGKILL");
    }
    if (childClosed !== null) {
      await Promise.race([
        childClosed,
        new Promise<void>((resolve) => setTimeout(resolve, 1_000))
      ]);
    }
  }
});

test("Linux archive 사전검증은 단일 최상위 폴더와 유일한 안전 경로만 허용한다", () => {
  assert.deepEqual(validateLinuxArchiveMemberPaths([
    "KirinukiHelper/src/main.ts",
    "KirinukiHelper/package.json"
  ]), [
    "KirinukiHelper/package.json",
    "KirinukiHelper/src/main.ts"
  ]);
  for (const entries of [
    ["package.json"],
    ["KirinukiHelper/../outside"],
    ["KirinukiHelper/src\\main.ts"],
    ["/KirinukiHelper/package.json"],
    ["KirinukiHelper/package.json", "KirinukiHelper/package.json"]
  ]) {
    assert.throws(() => validateLinuxArchiveMemberPaths(entries));
  }
});
