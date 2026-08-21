import assert from "node:assert/strict";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MACOS_CODESIGN_EXECUTABLE,
  MACOS_CODESIGN_TIMEOUT_MS,
  createMacosSealedToolManifest,
  verifyMacosOuterCodeSeal,
  verifyMacosSealedDesktopTools,
  writeMacosSealedToolManifest
} from "../src/desktop/macos-sealed-tools.js";
import type {
  MacosCodeSealEvidence
} from "../src/desktop/macos-sealed-tools.js";
import { desktopToolTargetManifest } from "../src/desktop/tool-manifest.js";

const TEAM_IDENTIFIER = "ABCDE12345";
const AUTHORITY = `Developer ID Application: Kirinuki Test (${TEAM_IDENTIFIER})`;
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const SEAL = Object.freeze({
  authority: AUTHORITY,
  teamIdentifier: TEAM_IDENTIFIER,
  hardenedRuntime: true,
  timestamped: true
} satisfies MacosCodeSealEvidence);

async function fixture(): Promise<Readonly<{
  root: string;
  resourcesRoot: string;
  toolsRoot: string;
}>> {
  const root = await mkdtemp(path.join(os.tmpdir(), "kirinuki-mac-seal-"));
  const resourcesRoot = path.join(
    root,
    "Kirinuki 테스트 한글.app",
    "Contents",
    "Resources"
  );
  const toolsRoot = path.join(
    resourcesRoot,
    "desktop-tools",
    "darwin-arm64"
  );
  await mkdir(toolsRoot, { recursive: true, mode: 0o755 });
  const manifest = desktopToolTargetManifest("darwin-arm64");
  await writeFile(
    path.join(toolsRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: "utf8", mode: 0o644 }
  );
  await Promise.all([
    manifest.ffmpeg.fileName,
    manifest.ffprobe.fileName,
    manifest.ytDlp.fileName
  ].map((fileName, index) => writeFile(
    path.join(toolsRoot, fileName),
    Buffer.alloc(100_000 + index, index + 1),
    { mode: 0o755 }
  )));
  const sealed = await createMacosSealedToolManifest({
    resourcesRoot,
    authority: AUTHORITY,
    teamIdentifier: TEAM_IDENTIFIER
  });
  await writeMacosSealedToolManifest(resourcesRoot, sealed);
  return Object.freeze({ root, resourcesRoot, toolsRoot });
}

test("codesign verifier는 절대 binary·배열 인자·bounded timeout으로 outer seal을 읽는다", async () => {
  const calls: Array<Readonly<{
    command: string;
    args: readonly string[];
    timeoutMs: number;
  }>> = [];
  const appPath = "/Applications/Kirinuki 테스트 한글.app";
  const evidence = await verifyMacosOuterCodeSeal(
    appPath,
    async (command, args, timeoutMs) => {
      calls.push(Object.freeze({ command, args: [...args], timeoutMs }));
      if (args[0] === "--display") {
        return Object.freeze({
          stdout: "",
          stderr: [
            "CodeDirectory v=20500 size=123 flags=0x10000(runtime) hashes=1+7 location=embedded",
            `Authority=${AUTHORITY}`,
            "Authority=Developer ID Certification Authority",
            "Authority=Apple Root CA",
            `TeamIdentifier=${TEAM_IDENTIFIER}`,
            "Timestamp=21 Aug 2026 at 12:00:00"
          ].join("\n")
        });
      }
      return Object.freeze({ stdout: "", stderr: "valid on disk\n" });
    }
  );
  assert.deepEqual(evidence, SEAL);
  assert.deepEqual(calls, [
    {
      command: MACOS_CODESIGN_EXECUTABLE,
      args: ["--verify", "--deep", "--strict", "--verbose=4", appPath],
      timeoutMs: MACOS_CODESIGN_TIMEOUT_MS
    },
    {
      command: MACOS_CODESIGN_EXECUTABLE,
      args: ["--display", "--verbose=4", appPath],
      timeoutMs: MACOS_CODESIGN_TIMEOUT_MS
    }
  ]);
});

test("outer seal로 봉인된 signed 도구만 성공하고 seal을 앞뒤로 검증한다", async () => {
  const current = await fixture();
  let sealChecks = 0;
  try {
    const verified = await verifyMacosSealedDesktopTools({
      resourcesRoot: current.resourcesRoot,
      verifyOuterSeal: async () => {
        sealChecks += 1;
        return SEAL;
      }
    });
    assert.equal(sealChecks, 2);
    assert.equal(verified.appBundlePath, path.join(
      current.root,
      "Kirinuki 테스트 한글.app"
    ));
    assert.equal(verified.manifest.signing.authority, AUTHORITY);
    assert.equal(verified.ffmpeg, path.join(current.toolsRoot, "ffmpeg"));
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});

test("봉인 manifest 변조는 outer identity와 맞지 않아 거절한다", async () => {
  const current = await fixture();
  try {
    const manifestPath = path.join(current.toolsRoot, "codesigned-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      signing: { authority: string };
    };
    manifest.signing.authority =
      `Developer ID Application: Attacker (${TEAM_IDENTIFIER})`;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await assert.rejects(
      verifyMacosSealedDesktopTools({
        resourcesRoot: current.resourcesRoot,
        verifyOuterSeal: async () => SEAL
      }),
      /signing identity/u
    );
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});

test("봉인 뒤 도구 byte 변조는 signed hash 불일치로 거절한다", async () => {
  const current = await fixture();
  try {
    await appendFile(path.join(current.toolsRoot, "ffmpeg"), Buffer.from([0xff]));
    await assert.rejects(
      verifyMacosSealedDesktopTools({
        resourcesRoot: current.resourcesRoot,
        verifyOuterSeal: async () => SEAL
      }),
      /무결성 검증 실패/u
    );
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});

test("outer codesign 검증 실패는 manifest를 신뢰하지 않고 fail-closed한다", async () => {
  const current = await fixture();
  let sealChecks = 0;
  try {
    await assert.rejects(
      verifyMacosSealedDesktopTools({
        resourcesRoot: current.resourcesRoot,
        verifyOuterSeal: async () => {
          sealChecks += 1;
          throw new Error("codesign --verify failed");
        }
      }),
      /codesign --verify failed/u
    );
    assert.equal(sealChecks, 1);
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});

test("public mac packager는 nested 도구를 먼저 서명하고 outer seal로 manifest를 봉인한다", async () => {
  const [installer, runtime] = await Promise.all([
    readFile(path.join(repositoryRoot, "scripts/package-desktop-installer.ts"), "utf8"),
    readFile(path.join(repositoryRoot, "src/desktop/runtime-supervisor.ts"), "utf8")
  ]);
  const start = installer.indexOf("async function signMacPrepackaged");
  const end = installer.indexOf("async function notarizeAndVerifyMacDmg", start);
  assert.ok(start >= 0 && end > start);
  const signing = installer.slice(start, end);
  assert.match(signing, /"--timestamp"[\s\S]*"--options",\s*"runtime"/u);
  assert.match(signing, /createMacosSealedToolManifest/u);
  assert.match(signing, /writeMacosSealedToolManifest/u);
  assert.match(signing, /ignore:\s*\(filePath\)[\s\S]*ignoredBinaries/u);
  assert.doesNotMatch(signing, /\bbinaries,\s*\n\s*strictVerify/u);
  assert.ok(
    signing.indexOf("await verifyMacCodeSignature(binary")
      < signing.indexOf("createMacosSealedToolManifest")
  );
  assert.ok(
    signing.indexOf("writeMacosSealedToolManifest")
      < signing.indexOf("await sign({")
  );
  assert.ok(
    signing.indexOf("await sign({")
      < signing.indexOf("verifyMacosSealedDesktopTools")
  );
  assert.match(
    installer,
    /electron-builder[\s\S]*request\.channel === "public-release"[\s\S]*verifyMacosSealedDesktopTools/u
  );
  assert.match(
    runtime,
    /DESKTOP_BUILD_CHANNEL === "public-release"[\s\S]*verifyMacosSealedDesktopTools/u
  );
  assert.doesNotMatch(runtime, /hasMacosSealedToolManifest/u);
  assert.match(runtime, /verifyMacosSealedDesktopTools/u);
});

test("Electron 43.4.1 pin은 dependency·builder·packager·provenance가 모두 일치한다", async () => {
  const [packageJson, lock, testBuilder, releaseBuilder, packager, provenance] =
    await Promise.all([
      readFile(path.join(repositoryRoot, "package.json"), "utf8"),
      readFile(path.join(repositoryRoot, "package-lock.json"), "utf8"),
      readFile(path.join(repositoryRoot, "electron-builder.yml"), "utf8"),
      readFile(path.join(repositoryRoot, "electron-builder.release.yml"), "utf8"),
      readFile(path.join(repositoryRoot, "scripts/package-desktop.ts"), "utf8"),
      readFile(
        path.join(repositoryRoot, "scripts/verify-desktop-release-provenance.ts"),
        "utf8"
      )
    ]);
  const packageValue = JSON.parse(packageJson) as {
    devDependencies: { electron: string };
  };
  const lockValue = JSON.parse(lock) as {
    packages: Record<string, { version?: string; devDependencies?: { electron?: string } }>;
  };
  assert.equal(packageValue.devDependencies.electron, "43.4.1");
  assert.equal(lockValue.packages[""]?.devDependencies?.electron, "43.4.1");
  assert.equal(lockValue.packages["node_modules/electron"]?.version, "43.4.1");
  for (const source of [testBuilder, releaseBuilder]) {
    assert.match(source, /electronVersion:\s*43\.4\.1/u);
  }
  assert.match(packager, /ELECTRON_VERSION = "43\.4\.1"/u);
  assert.match(provenance, /id: "electron", version: "43\.4\.1"/u);
});
