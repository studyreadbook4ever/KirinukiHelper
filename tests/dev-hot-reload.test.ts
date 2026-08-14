import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  DEV_RELOAD_SCHEMA,
  classifyWebDevReload,
  createDevReloadMarker,
  isDevReloadMarker,
  readDevReloadMarker,
  removeOwnedDevReloadMarker,
  webDevChangeNeedsBuild,
  writeDevReloadMarker
} from "../scripts/dev-hot-reload-core.js";
import {
  DEV_RUNNER_LOCK_SCHEMA,
  acquireDevRunnerLock,
  createDevRunnerLock,
  isDevRunnerLock,
  readDevRunnerLock,
  releaseDevRunnerLock
} from "../scripts/dev-runner-lock.js";

interface NodeScriptResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

function runNodeScript(
  scriptPath: string,
  { env = process.env }: { env?: NodeJS.ProcessEnv } = {}
) {
  return new Promise<NodeScriptResult>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", scriptPath], {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

test("localhost web 개발 변경만 안전한 편집기 리로드로 분류한다", () => {
  const editorOnlyDependencies = [
    "src/lib/caption-properties-sheet.ts",
    "src/lib/chzzk-vod-materialization.ts",
    "src/lib/session-archive.ts",
    "src/lib/session-cleanup.ts",
    "src/lib/whisper-connection.ts"
  ];
  assert.equal(classifyWebDevReload(["web/editor/editor.css"]), "style");
  assert.equal(classifyWebDevReload(["web/editor.html"]), "editor");
  assert.equal(classifyWebDevReload(["web/index.html"]), "editor");
  assert.equal(classifyWebDevReload(["src/web/main.ts"]), "editor");
  assert.equal(classifyWebDevReload(["src/editor/main.ts"]), "editor");
  assert.equal(classifyWebDevReload(["src/caption-agent/protocol.ts"]), "editor");
  for (const dependency of editorOnlyDependencies) {
    assert.equal(classifyWebDevReload([dependency]), "editor", dependency);
  }
  assert.equal(classifyWebDevReload(["src/lib/editor-core.ts"]), "editor");
  assert.equal(classifyWebDevReload(["src/lib/usage-policy.ts"]), "editor");
  assert.equal(
    classifyWebDevReload(["web/editor/editor.css", "src/editor/audseg-worker.ts"]),
    "editor"
  );
  assert.equal(classifyWebDevReload(["src/content-script.ts"]), "none");
  assert.equal(classifyWebDevReload(["extension/editor/editor.css"]), "none");
  assert.equal(classifyWebDevReload(["extension/manifest.json"]), "none");
  assert.equal(classifyWebDevReload(["README.md"]), "none");
});

test("localhost web 번들이 필요한 변경만 빌드 대상으로 분리한다", () => {
  const newlyWatchedDependencies = [
    "src/lib/caption-properties-sheet.ts",
    "src/lib/chzzk-vod-materialization.ts",
    "src/lib/session-archive.ts",
    "src/lib/session-cleanup.ts",
    "src/lib/usage-policy.ts",
    "src/lib/whisper-connection.ts"
  ];
  assert.equal(webDevChangeNeedsBuild(["src/editor/main.ts"]), true);
  assert.equal(webDevChangeNeedsBuild(["src/caption-agent/protocol.ts"]), true);
  assert.equal(webDevChangeNeedsBuild(["src/web/main.ts"]), true);
  for (const dependency of newlyWatchedDependencies) {
    assert.equal(webDevChangeNeedsBuild([dependency]), true, dependency);
  }
  assert.equal(webDevChangeNeedsBuild(["src/lib/editor-core.ts"]), true);
  assert.equal(webDevChangeNeedsBuild(["src/lib/keyboard-shortcuts.ts"]), true);
  assert.equal(webDevChangeNeedsBuild(["src/lib/serial-operation-gate.ts"]), true);
  assert.equal(webDevChangeNeedsBuild(["src/lib/short-form.ts"]), true);
  assert.equal(webDevChangeNeedsBuild(["src/content-script.ts"]), false);
  assert.equal(webDevChangeNeedsBuild(["web/editor/editor.css"]), false);
  assert.equal(webDevChangeNeedsBuild(["extension/editor.html"]), false);
});

test("개발 marker를 원자적으로 기록하고 소유자만 지운다", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-dev-reload-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const markerPath = path.join(temporaryRoot, "web", "dev-reload.json");
  const marker = createDevReloadMarker({
    revision: "revision-7",
    kind: "editor",
    changedFiles: ["src/editor/main.ts", "src/editor/main.ts"],
    pid: 777,
    createdAt: new Date("2026-07-30T00:00:00.000Z")
  });

  assert.deepEqual(marker, {
    schema: DEV_RELOAD_SCHEMA,
    revision: "revision-7",
    kind: "editor",
    changedFiles: ["src/editor/main.ts"],
    pid: 777,
    createdAt: "2026-07-30T00:00:00.000Z"
  });
  assert.equal(isDevReloadMarker(marker), true);
  await writeDevReloadMarker(markerPath, marker);
  assert.deepEqual(await readDevReloadMarker(markerPath), marker);
  assert.equal((await readFile(markerPath, "utf8")).endsWith("\n"), true);
  assert.equal(await removeOwnedDevReloadMarker(markerPath, 778), false);
  assert.deepEqual(await readDevReloadMarker(markerPath), marker);
  assert.equal(await removeOwnedDevReloadMarker(markerPath, 777), true);
  assert.equal(await readDevReloadMarker(markerPath), null);
});

test("손상되거나 불완전한 marker는 활성화하지 않는다", () => {
  assert.equal(isDevReloadMarker(null), false);
  assert.equal(isDevReloadMarker({
    schema: DEV_RELOAD_SCHEMA,
    revision: "",
    kind: "editor",
    changedFiles: [],
    pid: 1,
    createdAt: new Date().toISOString()
  }), false);
  assert.equal(isDevReloadMarker({
    schema: DEV_RELOAD_SCHEMA,
    revision: "x",
    kind: "editor",
    changedFiles: [],
    pid: 0,
    createdAt: new Date().toISOString()
  }), false);
  assert.throws(
    () => createDevReloadMarker({
      revision: "x",
      kind: "remote",
      changedFiles: []
    }),
    /지원하지 않는/
  );
});

test("개발 runner 잠금은 역할과 생성 시각까지 엄격히 검증한다", () => {
  const lock = createDevRunnerLock({
    pid: 777,
    role: "package",
    createdAt: new Date("2026-07-30T00:00:00.000Z"),
    token: "123e4567-e89b-42d3-a456-426614174001"
  });
  assert.deepEqual(lock, {
    schema: DEV_RUNNER_LOCK_SCHEMA,
    pid: 777,
    role: "package",
    createdAt: "2026-07-30T00:00:00.000Z",
    token: "123e4567-e89b-42d3-a456-426614174001"
  });
  assert.equal(isDevRunnerLock(lock), true);
  assert.equal(isDevRunnerLock({ pid: 777, createdAt: lock.createdAt }), true);
  assert.equal(isDevRunnerLock({ ...lock, pid: 0 }), false);
  assert.equal(isDevRunnerLock({ ...lock, role: "unknown" }), false);
  assert.equal(isDevRunnerLock({ ...lock, createdAt: "not-a-date" }), false);
  assert.equal(isDevRunnerLock({ ...lock, token: "short" }), false);
});

test("개발 runner 잠금은 커널에서 원자적으로 상호 배제한다", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-dev-lock-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const lockPath = path.join(temporaryRoot, ".dev-editor.lock");

  const editorLease = await acquireDevRunnerLock(lockPath, {
    pid: process.pid,
    role: "editor",
    createdAt: new Date("2026-07-30T00:00:00.000Z")
  });
  const editorLock = await readDevRunnerLock(lockPath);
  assert.ok(editorLock);
  assert.equal(editorLock.role, "editor");
  await assert.rejects(
    acquireDevRunnerLock(lockPath, {
      pid: process.pid,
      role: "package"
    }),
    /개발 편집 runner.*잠금을 사용 중/
  );
  assert.equal(await releaseDevRunnerLock(editorLease), true);
  assert.equal(await releaseDevRunnerLock(editorLease), false);

  const packageLease = await acquireDevRunnerLock(lockPath, {
    pid: process.pid,
    role: "package"
  });
  const packageLock = await readDevRunnerLock(lockPath);
  assert.ok(packageLock);
  assert.equal(packageLock.role, "package");
  assert.equal(await releaseDevRunnerLock(packageLease), true);
});

test("릴리스 자식은 일치하는 live package token으로만 잠금을 빌린다", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-dev-lock-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const lockPath = path.join(temporaryRoot, ".dev-editor.lock");
  const ownerLease = await acquireDevRunnerLock(lockPath, {
    role: "package",
    token: "release-lock-token-0002"
  });
  try {
    const borrowedLease = await acquireDevRunnerLock(lockPath, {
      role: "validate",
      inheritedToken: "release-lock-token-0002",
      onOwnerLost: () => {}
    });
    assert.equal(borrowedLease.borrowed, true);
    assert.equal(await releaseDevRunnerLock(borrowedLease), true);
    await assert.rejects(
      acquireDevRunnerLock(lockPath, {
        role: "validate",
        inheritedToken: "release-lock-token-wrong",
        onOwnerLost: () => {}
      }),
      /token이 현재 소유자와 일치하지 않습니다/
    );
  } finally {
    await releaseDevRunnerLock(ownerLease);
  }
  await assert.rejects(
    acquireDevRunnerLock(lockPath, {
      role: "validate",
      inheritedToken: "release-lock-token-0002",
      onOwnerLost: () => {}
    }),
    /더 이상 실행 중이지 않습니다/
  );
});

test("owner는 인증된 borrower가 끝나기 전 mutex를 해제하지 않는다", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-dev-lock-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const lockPath = path.join(temporaryRoot, ".dev-editor.lock");
  const ownerLease = await acquireDevRunnerLock(lockPath, {
    role: "package",
    token: "release-lock-token-0003"
  });
  const borrowedLease = await acquireDevRunnerLock(lockPath, {
    role: "validate",
    inheritedToken: "release-lock-token-0003",
    onOwnerLost: () => {}
  });
  let ownerReleased = false;
  const ownerRelease = releaseDevRunnerLock(ownerLease).then(() => {
    ownerReleased = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ownerReleased, false);
  await assert.rejects(
    acquireDevRunnerLock(lockPath, { role: "editor" }),
    /릴리스 패키징.*잠금을 사용 중/
  );
  await releaseDevRunnerLock(borrowedLease);
  await ownerRelease;
  assert.equal(ownerReleased, true);
});

test("mutex probe 연결이 들어와도 lease 해제가 대기하지 않는다", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-dev-lock-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const lease = await acquireDevRunnerLock(
    path.join(temporaryRoot, ".dev-editor.lock"),
    { role: "editor" }
  );
  const client = typeof lease.endpoint === "string"
    ? createConnection(lease.endpoint)
    : createConnection({
      host: lease.endpoint.host,
      port: lease.endpoint.port
    });
  context.after(() => client.destroy());
  await new Promise<void>((resolve, reject) => {
    client.once("connect", resolve);
    client.once("error", reject);
  });
  let timeout;
  try {
    await Promise.race([
      releaseDevRunnerLock(lease),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("mutex lease 해제 시간 초과")),
          1_000
        );
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
});

test("stale 또는 손상된 메타데이터는 새 커널 잠금에서 안전하게 교체한다", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-dev-lock-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const lockPath = path.join(temporaryRoot, ".dev-editor.lock");

  await writeFile(lockPath, "{\"pid\":", "utf8");
  assert.equal(await readDevRunnerLock(lockPath), null);
  const lease = await acquireDevRunnerLock(lockPath, {
    pid: process.pid,
    role: "validate"
  });
  const recoveredLock = await readDevRunnerLock(lockPath);
  assert.ok(recoveredLock);
  assert.equal(recoveredLock.role, "validate");
  assert.equal(await releaseDevRunnerLock(lease), true);
});

test("잠금 소유자가 강제 종료돼도 커널 잠금이 자동 해제된다", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-dev-lock-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const lockPath = path.join(temporaryRoot, ".dev-editor.lock");
  const moduleUrl = pathToFileURL(
    path.resolve("scripts/dev-runner-lock.ts")
  ).href;
  const fixturePath = path.join(temporaryRoot, "hold-dev-runner-lock.ts");
  await writeFile(
    fixturePath,
    [
      "async function holdLock(): Promise<void> {",
      `  const { acquireDevRunnerLock } = await import(${JSON.stringify(moduleUrl)});`,
      `  await acquireDevRunnerLock(${JSON.stringify(lockPath)}, {`,
      "    role: \"package\",",
      "    token: \"release-lock-token-crash\"",
      "  });",
      "  process.stdout.write(\"READY\\n\");",
      "  setInterval(() => undefined, 1_000);",
      "}",
      "void holdLock();",
      ""
    ].join("\n"),
    "utf8"
  );
  const child = spawn(process.execPath, [
    "--import",
    "tsx",
    fixturePath
  ], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  context.after(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  });

  await new Promise<void>((resolve, reject) => {
    let childStderr = "";
    let ready = false;
    const timeout = setTimeout(
      () => reject(new Error(
        `자식 잠금 프로세스 준비 시간 초과: ${childStderr}`
      )),
      5_000
    );
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.stdout.once("data", (chunk) => {
      clearTimeout(timeout);
      assert.match(chunk.toString(), /READY/);
      ready = true;
      resolve();
    });
    child.stderr.on("data", (chunk) => {
      childStderr += chunk.toString();
    });
    child.once("exit", (code, signal) => {
      if (!ready) {
        clearTimeout(timeout);
        reject(new Error(
          `자식 잠금 프로세스가 준비 전에 종료됨 (${code ?? signal}): ${childStderr}`
        ));
      }
    });
  });
  await assert.rejects(
    acquireDevRunnerLock(lockPath, { role: "editor" }),
    /릴리스 패키징.*잠금을 사용 중/
  );
  let ownerLossResolve: (error: Error) => void = () => undefined;
  const ownerLoss = new Promise<Error>((resolve) => {
    ownerLossResolve = resolve;
  });
  const borrowedLease = await acquireDevRunnerLock(lockPath, {
    role: "validate",
    inheritedToken: "release-lock-token-crash",
    onOwnerLost: ownerLossResolve
  });

  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
  let ownerLossTimeout: NodeJS.Timeout | undefined;
  let lossError: Error;
  try {
    lossError = await Promise.race([
      ownerLoss,
      new Promise<never>((_, reject) => {
        ownerLossTimeout = setTimeout(
          () => reject(new Error("borrower owner-loss 감지 시간 초과")),
          1_000
        );
      })
    ]);
  } finally {
    clearTimeout(ownerLossTimeout);
  }
  assert.match(lossError.message, /mutex 연결이 종료/);
  await releaseDevRunnerLock(borrowedLease);
  const recoveredLease = await acquireDevRunnerLock(lockPath, {
    role: "package"
  });
  assert.equal(await releaseDevRunnerLock(recoveredLease), true);
});

test("활성 최상위 lease 중 web package가 fail closed한다", async () => {
  const root = path.resolve(".");
  const lockPath = path.join(root, ".dev-editor.lock");
  const inheritedToken = process.env.KIRINUKI_RELEASE_LOCK_TOKEN;
  const lease = inheritedToken
    ? null
    : await acquireDevRunnerLock(lockPath, { role: "editor" });
  const childEnvironment = { ...process.env };
  delete childEnvironment.KIRINUKI_RELEASE_LOCK_TOKEN;
  try {
    for (const script of ["scripts/package-web.ts"]) {
      const result = await runNodeScript(path.join(root, script), {
        env: childEnvironment
      });
      assert.notEqual(result.code, 0, `${script}가 잠금 중 성공하면 안 됩니다.`);
      assert.equal(result.signal, null);
      assert.match(
        `${result.stdout}\n${result.stderr}`,
        /(?:개발 편집 runner|릴리스 패키징).*잠금을 사용 중/
      );
    }
  } finally {
    if (lease) {
      await releaseDevRunnerLock(lease);
    }
  }
});

test("web package는 일치하는 최상위 release token만 자식 lease로 전달한다", async () => {
  const source = await readFile("scripts/package-web.ts", "utf8");
  assert.match(source, /process\.env\.KIRINUKI_RELEASE_LOCK_TOKEN/u);
  assert.match(source, /inheritedToken:/u);
  assert.match(source, /onOwnerLost: failClosedOnDevRunnerOwnerLoss\("package:web"\)/u);
});

test("web 릴리스 명령은 전체 검증부터 web ZIP까지 한 lease로 감싼다", async () => {
  const [packageJson, releaseScript] = await Promise.all([
    readFile("package.json", "utf8").then(JSON.parse),
    readFile("scripts/release-package.ts", "utf8")
  ]);
  assert.equal(
    packageJson.scripts.package,
    "node --import tsx scripts/release-package.ts"
  );
  assert.equal(packageJson.name, "kirinuki-local-web-studio");
  assert.equal(
    packageJson.scripts.build,
    "node --import tsx scripts/build-web.ts"
  );
  assert.equal(
    packageJson.scripts.validate,
    "node --import tsx scripts/validate-local-studio.ts"
  );
  assert.match(releaseScript, /acquireDevRunnerLock/);
  assert.match(releaseScript, /\["run", "check:full"\]/u);
  assert.doesNotMatch(releaseScript, /legacy-extension|package-extension/u);
  assert.match(releaseScript, /package-web\.ts/);
});
