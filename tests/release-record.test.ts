import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
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
  const record = buildKirinukiReleaseRecord({
    identity: { name: "kirinuki-app", version: VERSION },
    packageLockSha256: "e".repeat(64),
    sourceRevision: SOURCE_REVISION,
    web
  });
  const first = serializeKirinukiReleaseRecord(record);
  const second = serializeKirinukiReleaseRecord(buildKirinukiReleaseRecord({
    identity: { name: "kirinuki-app", version: VERSION },
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
      packageLockSha256: "e".repeat(64),
      sourceRevision: "short",
      web
    }),
    /commit SHA/u
  );
});

// This integration asserts the web release manifest's exact 0644 file modes.
test("실제 artifact와 sidecar를 읽어 결정적 release manifest를 쓰고 readback한다", {
  skip: process.platform === "win32"
}, async () => {
  const repositoryRoot = await realpath(await mkdtemp(path.join(
    os.tmpdir(),
    "kirinuki-release-record-test-"
  )));
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
    const webDigest = await writeArtifact(distDirectory, webFilename, "web archive\n");

    const webArtifact = await inspectChecksummedArtifact(distDirectory, webFilename);
    assert.deepEqual(webArtifact, {
      bytes: Buffer.byteLength("web archive\n"),
      checksumFile: `${webFilename}.sha256`,
      file: webFilename,
      sha256: webDigest
    });
    const first = await writeKirinukiReleaseRecord({
      distDirectory,
      expectedArtifacts: {
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
    assert.equal(first.record.artifacts.web.bytes, Buffer.byteLength("web archive\n"));

    const previousUmask = process.umask(0o077);
    let second;
    try {
      second = await writeKirinukiReleaseRecord({
        distDirectory,
        expectedArtifacts: {
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
          web: {
            ...webArtifact,
            sha256: "f".repeat(64)
          }
        },
        expectedPackageLockSha256: sha256Bytes(lockContent),
        repositoryRoot,
        sourceRevision
      }),
      /packager가 보고한 bytes\/SHA-256/u
    );

    await writeFile(
      path.join(distDirectory, `${webFilename}.sha256`),
      `${"f".repeat(64)}  ${webFilename}\n`
    );
    await assert.rejects(
      writeKirinukiReleaseRecord({
        distDirectory,
        expectedArtifacts: {
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
