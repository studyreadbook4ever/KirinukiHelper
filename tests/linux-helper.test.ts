import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  APP_LIFECYCLE_MAX_REQUEST_BYTES,
  APP_LIFECYCLE_PROTOCOL,
  BROWSER_CANDIDATES,
  DEFAULT_SOURCE_URL,
  KIRINUKI_DEEP_LINK,
  LOCAL_STUDIO_URL,
  STUDIO_ORIGIN_IDENTITY_OPTION,
  STREAMING_COMPANION_PROTOCOL_OPTION,
  appBootstrapReasons,
  appLifecycleSocketName,
  browserProduct,
  browserLaunchArgs,
  browserLaunchCanOwnLifecycle,
  captionStartStrategy,
  claimAppLifecycle,
  companionBuildMatchesStudioOrigin,
  classifyDedicatedBrowserProcess,
  dedicatedBrowserPreparationDisposition,
  desktopDatabaseRefreshCommand,
  desktopEntryContent,
  desktopMimeRegistrationCommand,
  createIdempotentAsyncAction,
  createAppLifecycleRequestId,
  helpText,
  inspectBrowser,
  inspectPreferredBrowser,
  inspectUserEntrypoints,
  installUserEntrypoints,
  parseBrowserMajor,
  parseKirinukiDeepLink,
  parseLinuxHelperArgs,
  resolveLinuxHelperPaths,
  restoreLauncherPermissions,
  sameProcessIdentity,
  selectVerifiedBrowserRootAfterLauncherExit,
  shouldCycleForegroundCaption,
  shouldCycleStudioServer,
  studioServerMatchesOrigin,
  studioServerStartArgs,
  studioUrlForOrigin,
  summarizeDedicatedBrowserProcesses,
  userLauncherContent,
  validateSourceUrl,
  versionAtLeast
} from "../scripts/linux-helper.js";
import {
  STREAMING_BRIDGE_PROTOCOL
} from "../src/web/streaming-bridge-protocol.js";
import {
  KIRINUKI_LOCAL_STUDIO_ORIGIN,
  KIRINUKI_PUBLIC_STUDIO_ORIGIN
} from "../src/lib/local-runtime-origin.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const helperPath = path.join(packageRoot, "scripts", "linux-helper.ts");

interface NodeRunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

async function runNode(
  args: string[],
  { env = process.env }: { env?: NodeJS.ProcessEnv } = {}
) {
  return new Promise<NodeRunResult>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", helperPath, ...args],
      {
      cwd: packageRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"]
      }
    );
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

async function rawLifecycleRequest(
  socketName: string,
  payload: Buffer
): Promise<string> {
  const directoryHandle = Buffer.byteLength(socketName, "utf8") > 100
    ? await open(
      path.dirname(socketName),
      fsConstants.O_RDONLY
        | fsConstants.O_DIRECTORY
        | fsConstants.O_NOFOLLOW
    )
    : null;
  const transportSocketName = directoryHandle
    ? `/proc/self/fd/${directoryHandle.fd}/${path.basename(socketName)}`
    : socketName;
  try {
    return await new Promise<string>((resolve, reject) => {
      const socket = createConnection(transportSocketName);
      const chunks: Buffer[] = [];
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("lifecycle raw request timeout"));
      }, 3_000);
      socket.once("connect", () => socket.write(payload));
      socket.on("data", (chunk: Buffer) => chunks.push(chunk));
      socket.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      socket.once("close", () => {
        clearTimeout(timeout);
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
    });
  } finally {
    await directoryHandle?.close();
  }
}

test("버전 하한은 Node 22와 Chromium 120 경계를 정확히 구분한다", () => {
  assert.equal(versionAtLeast("21.99.9", "22.0.0"), false);
  assert.equal(versionAtLeast("22.0.0", "22.0.0"), true);
  assert.equal(versionAtLeast("23.0.0", "22.0.0"), true);
  assert.equal(parseBrowserMajor("Chromium 119.0.1"), 119);
  assert.equal(parseBrowserMajor("Google Chrome 120.0.1"), 120);
  assert.equal(parseBrowserMajor("unknown"), null);
  assert.equal(browserProduct("Chromium 150.0.1"), "chromium");
  assert.equal(browserProduct("Google Chrome 150.0.1"), "chrome");
  assert.equal(browserProduct("unknown"), "unknown");
  assert.deepEqual(BROWSER_CANDIDATES, [
    "chromium",
    "chromium-browser"
  ]);
});

test("CLI는 setup/doctor/open/status/stop 계약과 자막 방식을 파싱한다", () => {
  assert.deepEqual(
    parseLinuxHelperArgs([
      "setup",
      "--mode",
      "whisper",
      "--profile=light",
      "--backend",
      "cpu",
      "--yes",
      "--dry-run"
    ]),
    {
      command: "setup",
      options: {
        mode: "whisper",
        profile: "light",
        backend: "cpu",
        browser: null,
        yes: true,
        dryRun: true,
        json: false,
        url: null
      }
    }
  );
  assert.equal(
    parseLinuxHelperArgs([
      "open",
      "https://chzzk.naver.com/video/123"
    ]).options.url,
    "https://chzzk.naver.com/video/123"
  );
  assert.equal(
    parseLinuxHelperArgs(["start"]).command,
    "start"
  );
  assert.throws(
    () => parseLinuxHelperArgs(["setup", "--api-key", "secret"]),
    /비밀 값/u
  );
  assert.throws(
    () => parseLinuxHelperArgs(["setup", "--mode", "solar"]),
    /mode/u
  );
  assert.throws(
    () => parseLinuxHelperArgs(["status", "--profile", "quality"]),
    /setup에서만/u
  );
});

test("URL은 지원 서비스의 공개 HTTPS만 한 인자로 허용한다", () => {
  for (const [value, expected] of [
    ["https://chzzk.naver.com/video/14405514", "https://chzzk.naver.com/video/14405514"],
    ["https://www.youtube.com/watch?v=nixLJx1UhfY", "https://www.youtube.com/watch?v=nixLJx1UhfY"],
    ["https://youtu.be/nixLJx1UhfY", "https://www.youtube.com/watch?v=nixLJx1UhfY"],
    ["https://vod.sooplive.com/player/123456", "https://vod.sooplive.com/player/123456"],
    ["https://vod.sooplive.co.kr/player/123456", "https://vod.sooplive.com/player/123456"],
    ["https://vod.afreecatv.com/PLAYER/STATION/123456", "https://vod.sooplive.com/player/123456"]
  ]) {
    assert.equal(validateSourceUrl(value), expected);
  }
  assert.equal(validateSourceUrl(DEFAULT_SOURCE_URL), DEFAULT_SOURCE_URL);
  for (const value of [
    "",
    "https://naver.me/xJcAj1dV",
    "http://chzzk.naver.com/video/1",
    "https://example.com/video/1",
    "https://user:pass@youtube.com/watch?v=x",
    "javascript:alert(1)",
    "https://youtube.com/\n--remote-debugging-port=1"
  ]) {
    assert.throws(() => validateSourceUrl(value), /URL|HTTPS|제어/u);
  }
});

test("앱 자동 준비 판단은 빠진 구성만 정확한 이유로 반환한다", () => {
  const ready = {
    configured: true,
    buildCurrent: true,
    entrypointsCurrent: true,
    mediaEngineCurrent: true,
    captionEngineCurrent: true
  };
  assert.deepEqual(appBootstrapReasons(ready), []);
  assert.deepEqual(appBootstrapReasons({
    ...ready,
    configured: false,
    buildCurrent: false,
    mediaEngineCurrent: false
  }), ["configuration", "build", "media-engine"]);
  assert.deepEqual(appBootstrapReasons({
    ...ready,
    entrypointsCurrent: false,
    captionEngineCurrent: false
  }), ["entrypoints", "caption-engine"]);
});

test("fresh와 orphan browser만 앱 생명주기 claim 후보이고 정리는 멱등이다", async () => {
  assert.equal(browserLaunchCanOwnLifecycle("stopped"), true);
  assert.equal(browserLaunchCanOwnLifecycle("ready"), true);
  for (const state of [
    "clean",
    "update-required",
    "legacy-extension",
    "conflict",
    "unavailable"
  ] as const) {
    assert.equal(browserLaunchCanOwnLifecycle(state), false);
  }
  let calls = 0;
  const cleanup = createIdempotentAsyncAction(async () => {
    calls += 1;
    await Promise.resolve();
    return "done";
  });
  const [first, second, third] = await Promise.all([
    cleanup(),
    cleanup(),
    cleanup()
  ]);
  assert.deepEqual([first, second, third], ["done", "done", "done"]);
  assert.equal(calls, 1);
  assert.equal(await cleanup(), "done");
  assert.equal(calls, 1);
});

test("동시 open은 같은 프로필의 primary 생명주기를 하나만 획득한다", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "kirinuki-lifecycle-claim-")
  );
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const profile = path.join(tempRoot, "same profile");
  const [first, second] = await Promise.all([
    claimAppLifecycle(profile, tempRoot),
    claimAppLifecycle(profile, tempRoot)
  ]);
  assert.equal(Number(first.owned) + Number(second.owned), 1);
  const primary = first.owned ? first : second;
  const secondary = first.owned ? second : first;
  const socketName = appLifecycleSocketName(profile, tempRoot);
  const socketDirectoryMetadata = await lstat(path.dirname(socketName));
  const socketMetadata = await lstat(socketName);
  assert.equal(socketName.includes("\0"), false);
  assert.equal(path.dirname(path.dirname(socketName)), path.resolve(tempRoot));
  const stateRootMetadata = await lstat(tempRoot);
  assert.equal(stateRootMetadata.isDirectory(), true);
  assert.equal(stateRootMetadata.isSymbolicLink(), false);
  assert.equal(stateRootMetadata.mode & 0o777, 0o700);
  assert.equal(socketDirectoryMetadata.isDirectory(), true);
  assert.equal(socketDirectoryMetadata.isSymbolicLink(), false);
  assert.equal(socketDirectoryMetadata.mode & 0o777, 0o700);
  assert.equal(socketMetadata.isSocket(), true);
  assert.equal(socketMetadata.isSymbolicLink(), false);
  assert.equal(socketMetadata.mode & 0o777, 0o600);
  if (typeof process.getuid === "function") {
    assert.equal(socketDirectoryMetadata.uid, process.getuid());
    assert.equal(socketMetadata.uid, process.getuid());
  }
  await secondary.release();
  const whileOwned = await claimAppLifecycle(profile, tempRoot);
  assert.equal(whileOwned.owned, false);
  await whileOwned.release();
  await primary.release();
  await primary.release();
  const afterRelease = await claimAppLifecycle(profile, tempRoot);
  assert.equal(afterRelease.owned, true);
  await afterRelease.release();
});

test("긴 상태 경로도 private directory FD alias로 lifecycle을 유지한다", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "kl-long-root-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const stateRootA = path.join(
    tempRoot,
    `state-a-${"s".repeat(72)}`
  );
  const stateRootB = path.join(
    tempRoot,
    `state-b-${"s".repeat(72)}`
  );
  const profileA = path.join(tempRoot, `profile-a-${"p".repeat(72)}`);
  const profileB = path.join(tempRoot, `profile-b-${"p".repeat(72)}`);
  const socketA = appLifecycleSocketName(profileA, stateRootA);
  const sameSocketA = appLifecycleSocketName(profileA, stateRootA);
  const otherStateSocket = appLifecycleSocketName(profileA, stateRootB);
  const otherProfileSocket = appLifecycleSocketName(profileB, stateRootA);
  assert.equal(socketA, sameSocketA);
  assert.notEqual(socketA, otherStateSocket);
  assert.notEqual(socketA, otherProfileSocket);
  assert.equal(Buffer.byteLength(socketA, "utf8") > 100, true);
  assert.equal(path.dirname(path.dirname(socketA)), path.resolve(stateRootA));

  const owner = await claimAppLifecycle(profileA, stateRootA);
  const secondary = await claimAppLifecycle(profileA, stateRootA);
  assert.equal(owner.owned, true);
  assert.equal(secondary.owned, false);
  const sources: Array<string | null> = [];
  owner.activateOpenRequests(async (sourceUrl) => {
    sources.push(sourceUrl);
  });
  const sourceUrl = "https://chzzk.naver.com/video/14514980";
  assert.deepEqual(await secondary.requestOpen(
    sourceUrl,
    createAppLifecycleRequestId()
  ), { status: "opened" });
  assert.deepEqual(sources, [sourceUrl]);
  for (const directory of [
    stateRootA,
    path.dirname(socketA)
  ]) {
    const metadata = await lstat(directory);
    assert.equal(metadata.isDirectory(), true);
    assert.equal(metadata.isSymbolicLink(), false);
    assert.equal(metadata.mode & 0o777, 0o700);
    if (typeof process.getuid === "function") {
      assert.equal(metadata.uid, process.getuid());
    }
  }
  const socketMetadata = await lstat(socketA);
  assert.equal(socketMetadata.isSocket(), true);
  assert.equal(socketMetadata.mode & 0o777, 0o600);
  await secondary.release();
  assert.deepEqual(await secondary.requestOpen(
    sourceUrl,
    createAppLifecycleRequestId()
  ), { status: "unavailable" });
  await owner.release();
  const takeover = await claimAppLifecycle(profileA, stateRootA);
  assert.equal(takeover.owned, true);
  await takeover.release();
});

test("lifecycle IPC는 symlink 상태 폴더와 비-socket endpoint를 삭제하지 않고 거부한다", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "kl-untrusted-")
  );
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const actualState = path.join(tempRoot, "actual-state");
  const linkedState = path.join(tempRoot, "linked-state");
  await mkdir(actualState, { mode: 0o700 });
  await symlink(actualState, linkedState);
  await assert.rejects(
    claimAppLifecycle(path.join(tempRoot, "profile-a"), linkedState),
    /상태 폴더|안전한 사용자 폴더/u
  );

  const stateRoot = path.join(tempRoot, "state");
  const profile = path.join(tempRoot, "profile-b");
  const socketName = appLifecycleSocketName(profile, stateRoot);
  await mkdir(path.dirname(socketName), { recursive: true, mode: 0o700 });
  await writeFile(socketName, "do-not-delete", { mode: 0o600 });
  await assert.rejects(
    claimAppLifecycle(profile, stateRoot),
    /private socket/u
  );
  assert.equal((await lstat(socketName)).isFile(), true);
  assert.equal(await readFile(socketName, "utf8"), "do-not-delete");
});

test("lifecycle IPC는 동일 사용자의 끊어진 socket inode만 회수한다", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "kirinuki-lifecycle-stale-")
  );
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const stateRoot = path.join(tempRoot, `state-${"s".repeat(72)}`);
  const profile = path.join(tempRoot, `profile-${"p".repeat(72)}`);
  const socketName = appLifecycleSocketName(profile, stateRoot);
  assert.equal(Buffer.byteLength(socketName, "utf8") > 100, true);
  await mkdir(path.dirname(socketName), { recursive: true, mode: 0o700 });
  const staleCreator = spawn(process.execPath, [
    "--import",
    "tsx",
    "--input-type=module",
    "-e",
    [
      `import { claimAppLifecycle } from ${JSON.stringify(pathToFileURL(helperPath).href)};`,
      `const owner = await claimAppLifecycle(${JSON.stringify(profile)}, ${JSON.stringify(stateRoot)});`,
      "process.exit(owner.owned ? 0 : 1);"
    ].join(" ")
  ], { stdio: "ignore" });
  const staleExit = await new Promise<number | null>((resolve, reject) => {
    staleCreator.once("error", reject);
    staleCreator.once("exit", (code) => resolve(code));
  });
  assert.equal(staleExit, 0);
  assert.equal((await lstat(socketName)).isSocket(), true);

  const owner = await claimAppLifecycle(profile, stateRoot);
  assert.equal(owner.owned, true);
  assert.equal((await lstat(socketName)).isSocket(), true);
  assert.equal((await lstat(socketName)).mode & 0o777, 0o600);
  await owner.release();
});

test("owner open IPC는 closing을 먼저 공개하고 수락 요청 drain 뒤에만 정리한다", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "kirinuki-lifecycle-open-drain-")
  );
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const profile = path.join(tempRoot, "same profile");
  const owner = await claimAppLifecycle(profile, tempRoot);
  const secondary = await claimAppLifecycle(profile, tempRoot);
  assert.equal(owner.owned, true);
  assert.equal(secondary.owned, false);

  const beforeActivation = await secondary.requestOpen(
    null,
    createAppLifecycleRequestId()
  );
  assert.equal(beforeActivation.status, "starting");

  let releaseFirstOpen!: () => void;
  let markFirstOpenStarted!: () => void;
  const firstOpenStarted = new Promise<void>((resolve) => {
    markFirstOpenStarted = resolve;
  });
  const firstOpenGate = new Promise<void>((resolve) => {
    releaseFirstOpen = resolve;
  });
  const events: string[] = [];
  const receivedSources: Array<string | null> = [];
  owner.activateOpenRequests(async (sourceUrl) => {
    receivedSources.push(sourceUrl);
    events.push(`open:${receivedSources.length}:start`);
    if (receivedSources.length === 1) {
      markFirstOpenStarted();
      await firstOpenGate;
    }
    events.push(`open:${receivedSources.length}:end`);
  });

  const sourceUrl = "https://chzzk.naver.com/video/14405514";
  const requestId = createAppLifecycleRequestId();
  const first = secondary.requestOpen(sourceUrl, requestId);
  await firstOpenStarted;
  const duplicate = secondary.requestOpen(sourceUrl, requestId);
  const drained = owner.beginClosing();
  let cleanupStarted = false;
  const cleanup = drained.then(() => {
    cleanupStarted = true;
    events.push("cleanup");
  });
  const rejectedDuringClose = await secondary.requestOpen(
    null,
    createAppLifecycleRequestId()
  );
  assert.equal(rejectedDuringClose.status, "closing");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(cleanupStarted, false);

  releaseFirstOpen();
  assert.deepEqual(await Promise.all([first, duplicate]), [
    { status: "opened" },
    { status: "opened" }
  ]);
  await cleanup;
  assert.deepEqual(receivedSources, [sourceUrl]);
  assert.deepEqual(events, ["open:1:start", "open:1:end", "cleanup"]);

  await owner.resumeOpenRequests();
  assert.deepEqual(await secondary.requestOpen(sourceUrl, requestId), {
    status: "opened"
  });
  assert.equal(receivedSources.length, 1);
  assert.deepEqual(await secondary.requestOpen(
    null,
    createAppLifecycleRequestId()
  ), { status: "opened" });
  assert.deepEqual(receivedSources, [sourceUrl, null]);

  await owner.beginClosing();
  assert.equal((await secondary.requestOpen(
    sourceUrl,
    createAppLifecycleRequestId()
  )).status, "closing");
  await secondary.release();
  await owner.release();
  await owner.release();
  const takeover = await claimAppLifecycle(profile, tempRoot);
  assert.equal(takeover.owned, true);
  await takeover.release();
});

test("lifecycle IPC는 초과·비정형 payload와 requestId를 fail-closed한다", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "kirinuki-lifecycle-bounds-")
  );
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const profile = path.join(tempRoot, "bounded profile");
  const owner = await claimAppLifecycle(profile, tempRoot);
  assert.equal(owner.owned, true);
  let calls = 0;
  owner.activateOpenRequests(async () => {
    calls += 1;
  });
  const socketName = appLifecycleSocketName(profile, tempRoot);
  const malformed = Buffer.from(`${JSON.stringify({
    schema: APP_LIFECYCLE_PROTOCOL,
    type: "open",
    requestId: "request-1",
    sourceUrl: null,
    extra: true
  })}\n`, "utf8");
  assert.deepEqual(JSON.parse(await rawLifecycleRequest(
    socketName,
    malformed
  )), {
    schema: APP_LIFECYCLE_PROTOCOL,
    status: "failed"
  });
  assert.deepEqual(JSON.parse(await rawLifecycleRequest(
    socketName,
    Buffer.alloc(APP_LIFECYCLE_MAX_REQUEST_BYTES + 1, 0x61)
  )), {
    schema: APP_LIFECYCLE_PROTOCOL,
    status: "failed"
  });
  const secondary = await claimAppLifecycle(profile, tempRoot);
  await assert.rejects(
    secondary.requestOpen(null, "bad request id"),
    /requestId/u
  );
  await assert.rejects(
    secondary.requestOpen(
      `https://chzzk.naver.com/video/${"a".repeat(5_000)}`,
      createAppLifecycleRequestId()
    ),
    /원본 URL|크기/u
  );
  assert.equal(calls, 0);
  await secondary.release();
  await owner.release();
});

test("브라우저 인자는 전용 profile과 앱 내부 origin만 사용한다", () => {
  const args = browserLaunchArgs({
    profileRoot: "/tmp/Kirinuki Profile",
    streamingCompanionRoot: "/opt/Kirinuki Helper/streaming-companion",
    sourceUrl: "https://chzzk.naver.com/video/1"
  });
  assert.deepEqual(args, [
    "--user-data-dir=/tmp/Kirinuki Profile",
    "--disable-extensions-except=/opt/Kirinuki Helper/streaming-companion",
    "--load-extension=/opt/Kirinuki Helper/streaming-companion",
    `${STREAMING_COMPANION_PROTOCOL_OPTION}=${STREAMING_BRIDGE_PROTOCOL}`,
    `${STUDIO_ORIGIN_IDENTITY_OPTION}=${KIRINUKI_LOCAL_STUDIO_ORIGIN}`,
    "--no-first-run",
    "--no-default-browser-check",
    "http://127.0.0.1:4320/?source=https%3A%2F%2Fchzzk.naver.com%2Fvideo%2F1"
  ]);
  assert.ok(!args.some((value) => /remote-debugging/iu.test(value)));
  assert.deepEqual(browserLaunchArgs({
    profileRoot: "/tmp/Kirinuki Profile",
    streamingCompanionRoot: "/opt/Kirinuki Helper/streaming-companion"
  }), [
    "--user-data-dir=/tmp/Kirinuki Profile",
    "--disable-extensions-except=/opt/Kirinuki Helper/streaming-companion",
    "--load-extension=/opt/Kirinuki Helper/streaming-companion",
    `${STREAMING_COMPANION_PROTOCOL_OPTION}=${STREAMING_BRIDGE_PROTOCOL}`,
    `${STUDIO_ORIGIN_IDENTITY_OPTION}=${KIRINUKI_LOCAL_STUDIO_ORIGIN}`,
    "--no-first-run",
    "--no-default-browser-check",
    LOCAL_STUDIO_URL
  ]);
  assert.equal(
    studioUrlForOrigin(KIRINUKI_LOCAL_STUDIO_ORIGIN),
    LOCAL_STUDIO_URL
  );
  assert.throws(
    () => studioUrlForOrigin(KIRINUKI_PUBLIC_STUDIO_ORIGIN),
    /앱 내부/u
  );
  assert.doesNotMatch(
    studioServerStartArgs(KIRINUKI_LOCAL_STUDIO_ORIGIN).join(" "),
    /--public-origin/u
  );
  assert.throws(
    () => studioServerStartArgs(KIRINUKI_PUBLIC_STUDIO_ORIGIN),
    /앱 내부/u
  );
  assert.equal(companionBuildMatchesStudioOrigin(
    `allowed=${KIRINUKI_LOCAL_STUDIO_ORIGIN}`,
    KIRINUKI_LOCAL_STUDIO_ORIGIN
  ), true);
  assert.equal(companionBuildMatchesStudioOrigin(
    `allowed=${KIRINUKI_LOCAL_STUDIO_ORIGIN},${KIRINUKI_PUBLIC_STUDIO_ORIGIN}`,
    KIRINUKI_LOCAL_STUDIO_ORIGIN
  ), false);
  assert.throws(() => browserLaunchArgs({
    profileRoot: "/tmp/Kirinuki Profile",
    streamingCompanionRoot: "/opt/Kirinuki Helper/streaming-companion",
    studioOrigin: KIRINUKI_PUBLIC_STUDIO_ORIGIN
  }), /앱 내부/u);
});

test("Kirinuki 앱 링크는 open과 지원 원본 하나만 엄격하게 허용한다", () => {
  assert.deepEqual(parseKirinukiDeepLink(KIRINUKI_DEEP_LINK), {
    sourceUrl: null
  });
  const sourceUrl = "https://chzzk.naver.com/video/14405514";
  const link = `${KIRINUKI_DEEP_LINK}?${new URLSearchParams({
    source: sourceUrl
  })}`;
  assert.deepEqual(parseKirinukiDeepLink(link), { sourceUrl });
  assert.equal(parseLinuxHelperArgs([link]).command, "open");
  assert.equal(parseLinuxHelperArgs([link]).options.url, sourceUrl);
  for (const invalid of [
    "KIRINUKI://open",
    "kirinuki://open/",
    "kirinuki://other",
    "kirinuki://user@open",
    "kirinuki://open:99",
    "kirinuki://open#fragment",
    "kirinuki://open?unknown=1",
    "kirinuki://open?source=",
    "kirinuki://open?source=https%3A%2F%2Fexample.com%2Fvideo",
    "kirinuki://open?source=https%3A%2F%2Fchzzk.naver.com%3A443%2Fvideo%2F1",
    "kirinuki://open?source=https%3A%2F%2Fchzzk.naver.com%2Fvideo%2F1%23x",
    "kirinuki://open?source=https%3A%2F%2Fyoutu.be%2FnixLJx1UhfY&source=https%3A%2F%2Fyoutu.be%2FnixLJx1UhfY"
  ]) {
    assert.throws(() => parseKirinukiDeepLink(invalid), /앱 링크|source/u);
  }
  assert.throws(
    () => parseLinuxHelperArgs([KIRINUKI_DEEP_LINK, "--dry-run"]),
    /다른 옵션/u
  );
});

test("전용 브라우저 identity는 clean·최소 companion·정확한 legacy를 구분한다", () => {
  const profileRoot = "/tmp/Kirinuki Profile";
  const streamingCompanionRoot = "/opt/Kirinuki Helper/streaming-companion";
  const legacyExtensionRoot = "/opt/Kirinuki Helper/extension";
  const processSnapshot = (argv: readonly string[], overrides: Partial<{
    pid: number;
    parentPid: number;
    ownerUid: number;
    startTimeTicks: string;
    executable: string;
  }> = {}) => ({
    pid: overrides.pid ?? 4123,
    parentPid: overrides.parentPid ?? 1,
    ownerUid: overrides.ownerUid ?? 1000,
    startTimeTicks: overrides.startTimeTicks ?? "987654",
    executable: overrides.executable ?? "/usr/lib/chromium/chromium",
    argv
  });
  const classify = (
    argv: readonly string[],
    overrides: Parameters<typeof processSnapshot>[1] = {}
  ) => classifyDedicatedBrowserProcess(
    processSnapshot(argv, overrides),
    {
      profileRoot,
      streamingCompanionRoot,
      legacyExtensionRoot,
      product: "chromium",
      expectedUid: 1000
    }
  );
  const executable = "/usr/lib/chromium/chromium";
  const protocolArgument = (
    `${STREAMING_COMPANION_PROTOCOL_OPTION}=${STREAMING_BRIDGE_PROTOCOL}`
  );
  const originArgument = (
    `${STUDIO_ORIGIN_IDENTITY_OPTION}=${KIRINUKI_LOCAL_STUDIO_ORIGIN}`
  );
  assert.equal(classify([
    executable,
    `--user-data-dir=${profileRoot}`,
    "--no-first-run",
    LOCAL_STUDIO_URL
  ]), "clean-root");
  assert.equal(classify([
    executable,
    `--user-data-dir=${profileRoot}`,
    `--disable-extensions-except=${streamingCompanionRoot}`,
    `--load-extension=${streamingCompanionRoot}`,
    protocolArgument,
    originArgument,
    "--no-first-run"
  ]), "app-runtime-root");
  for (const dangerousFlag of [
    "--remote-debugging-address=0.0.0.0",
    "--remote-debugging-port=9222",
    "--remote-debugging-pipe",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-web-security",
    "--allow-running-insecure-content",
    "--ignore-certificate-errors",
    "--proxy-server=http://127.0.0.1:8080"
  ]) {
    assert.equal(classify([
      executable,
      `--user-data-dir=${profileRoot}`,
      `--disable-extensions-except=${streamingCompanionRoot}`,
      `--load-extension=${streamingCompanionRoot}`,
      protocolArgument,
      originArgument,
      dangerousFlag
    ]), "conflict", `${dangerousFlag}를 app runtime으로 인계했습니다.`);
  }
  const snapRuntimeExecutable = (
    "/snap/chromium/3217/usr/lib/chromium-browser/chrome"
  );
  const snapRuntimeArgv0 = (
    "/snap/chromium/current/usr/lib/chromium-browser/chrome"
  );
  assert.equal(classify([
    snapRuntimeArgv0,
    `--user-data-dir=${profileRoot}`,
    `--disable-extensions-except=${streamingCompanionRoot}`,
    `--load-extension=${streamingCompanionRoot}`,
    protocolArgument,
    originArgument
  ], { executable: snapRuntimeExecutable }), "app-runtime-root");
  assert.equal(classify([
    snapRuntimeArgv0,
    `--user-data-dir=${profileRoot}`
  ], { executable: snapRuntimeExecutable }), "conflict");
  assert.equal(classify([
    snapRuntimeArgv0,
    `--user-data-dir=${profileRoot}`,
    `--disable-extensions-except=${streamingCompanionRoot}`,
    `--load-extension=${streamingCompanionRoot}`,
    `${STREAMING_COMPANION_PROTOCOL_OPTION}=old-protocol`,
    originArgument
  ], { executable: snapRuntimeExecutable }), "conflict");
  assert.equal(classify([
    "/opt/google/chrome/chrome",
    `--user-data-dir=${profileRoot}`,
    `--disable-extensions-except=${streamingCompanionRoot}`,
    `--load-extension=${streamingCompanionRoot}`,
    protocolArgument,
    originArgument
  ], { executable: "/opt/google/chrome/chrome" }), "conflict");
  assert.equal(classify([
    executable,
    `--user-data-dir=${profileRoot}`,
    `--disable-extensions-except=${streamingCompanionRoot}`,
    `--load-extension=${streamingCompanionRoot}`,
    protocolArgument,
    `${STUDIO_ORIGIN_IDENTITY_OPTION}=${KIRINUKI_PUBLIC_STUDIO_ORIGIN}`
  ]), "stale-app-runtime-root");
  assert.equal(classifyDedicatedBrowserProcess(processSnapshot([
    executable,
    `--user-data-dir=${profileRoot}`,
    `--disable-extensions-except=${streamingCompanionRoot}`,
    `--load-extension=${streamingCompanionRoot}`,
    protocolArgument,
    originArgument
  ]), {
    profileRoot,
    streamingCompanionRoot,
    legacyExtensionRoot,
    product: "chromium",
    expectedUid: 1000,
    streamingCompanionProtocol: "future-protocol"
  }), "stale-app-runtime-root");
  assert.equal(classify([
    executable,
    `--user-data-dir=${profileRoot}`,
    `--disable-extensions-except=${streamingCompanionRoot}`,
    `--load-extension=${streamingCompanionRoot}`
  ]), "stale-app-runtime-root");
  assert.equal(classify([
    executable,
    `--user-data-dir=${profileRoot}`,
    `--disable-extensions-except=${streamingCompanionRoot}`,
    `--load-extension=${streamingCompanionRoot}`,
    `${STREAMING_COMPANION_PROTOCOL_OPTION}=old-protocol`,
    originArgument
  ]), "stale-app-runtime-root");
  assert.equal(classify([
    executable,
    `--user-data-dir=${profileRoot}`,
    `--disable-extensions-except=${streamingCompanionRoot}`,
    `--load-extension=${streamingCompanionRoot}`,
    protocolArgument,
    protocolArgument,
    originArgument
  ]), "stale-app-runtime-root");
  assert.equal(classify([
    executable,
    `--user-data-dir=${profileRoot}`,
    `--disable-extensions-except=${legacyExtensionRoot}`,
    `--load-extension=${legacyExtensionRoot}`,
    "--no-first-run"
  ]), "legacy-extension-root");
  assert.equal(classify([
    executable,
    `--user-data-dir=${profileRoot}`,
    `--disable-extensions-except=${legacyExtensionRoot}`,
    `--load-extension=${legacyExtensionRoot}`,
    protocolArgument
  ]), "conflict");
  assert.equal(classify([
    executable,
    `--user-data-dir=${profileRoot}`,
    `--disable-extensions-except=${legacyExtensionRoot}`,
    "--load-extension=/opt/unrelated-extension"
  ]), "conflict");
  assert.equal(classify([
    executable,
    `--user-data-dir=${profileRoot}`,
    `--user-data-dir=${profileRoot}`
  ]), "conflict");
  assert.equal(classify([
    executable,
    `--user-data-dir=${profileRoot}`,
    "--disable-extensions"
  ]), "conflict");
  assert.equal(classify([
    executable,
    `--user-data-dir=${profileRoot}`,
    "--type=renderer"
  ]), "profile-child");
  assert.equal(classify([
    executable,
    "--user-data-dir=/tmp/Other Profile"
  ]), "unrelated");
  assert.equal(classify([
    executable,
    `--user-data-dir=${profileRoot}`
  ], { ownerUid: 1001 }), "conflict");
  assert.equal(classify([
    executable,
    `--user-data-dir=${profileRoot}`
  ], { executable: "/usr/bin/node" }), "conflict");

  const reportFor = (argv: readonly string[]) => (
    summarizeDedicatedBrowserProcesses([processSnapshot(argv)], {
      profileRoot,
      streamingCompanionRoot,
      legacyExtensionRoot,
      product: "chromium",
      expectedUid: 1000
    })
  );
  const clean = reportFor([
    executable,
    `--user-data-dir=${profileRoot}`
  ]);
  assert.equal(clean.state, "clean");
  assert.equal(clean.transitionRequired, true);
  assert.equal(
    dedicatedBrowserPreparationDisposition(clean),
    "reject-clean-without-signal"
  );
  const companion = reportFor([
    executable,
    `--user-data-dir=${profileRoot}`,
    `--disable-extensions-except=${streamingCompanionRoot}`,
    `--load-extension=${streamingCompanionRoot}`,
    protocolArgument,
    originArgument
  ]);
  assert.equal(companion.state, "ready");
  assert.equal(companion.transitionRequired, false);
  assert.equal(
    dedicatedBrowserPreparationDisposition(companion),
    "reuse-app-runtime"
  );
  const staleCompanion = reportFor([
    executable,
    `--user-data-dir=${profileRoot}`,
    `--disable-extensions-except=${streamingCompanionRoot}`,
    `--load-extension=${streamingCompanionRoot}`,
    `${STREAMING_COMPANION_PROTOCOL_OPTION}=old-protocol`,
    originArgument
  ]);
  assert.equal(staleCompanion.state, "update-required");
  assert.equal(staleCompanion.transitionRequired, true);
  assert.match(staleCompanion.reason, /현재 앱 버전/u);
  assert.equal(
    dedicatedBrowserPreparationDisposition(staleCompanion),
    "reject-stale-minimal-without-signal"
  );
});

test("Chromium wrapper 종료는 새로 파생된 정확한 Snap app root에만 감독을 인계한다", () => {
  const profileRoot = "/tmp/Kirinuki Profile";
  const streamingCompanionRoot = "/opt/Kirinuki Helper/streaming-companion";
  const legacyExtensionRoot = "/opt/Kirinuki Helper/extension";
  const options = {
    profileRoot,
    streamingCompanionRoot,
    legacyExtensionRoot,
    product: "chromium" as const,
    expectedUid: 1000
  };
  const launcher = {
    pid: 7000,
    ownerUid: 1000,
    startTimeTicks: "800000"
  };
  const root = {
    pid: 7001,
    parentPid: 1,
    ownerUid: 1000,
    startTimeTicks: "800001",
    executable: "/snap/chromium/3217/usr/lib/chromium-browser/chrome",
    argv: [
      "/snap/chromium/current/usr/lib/chromium-browser/chrome",
      `--user-data-dir=${profileRoot}`,
      `--disable-extensions-except=${streamingCompanionRoot}`,
      `--load-extension=${streamingCompanionRoot}`,
      `${STREAMING_COMPANION_PROTOCOL_OPTION}=${STREAMING_BRIDGE_PROTOCOL}`,
      `${STUDIO_ORIGIN_IDENTITY_OPTION}=${KIRINUKI_LOCAL_STUDIO_ORIGIN}`,
      "--no-first-run",
      LOCAL_STUDIO_URL
    ]
  };

  assert.equal(
    selectVerifiedBrowserRootAfterLauncherExit([root], options, launcher),
    root
  );
  assert.equal(
    summarizeDedicatedBrowserProcesses([root], options).state,
    "ready"
  );
  assert.equal(
    summarizeDedicatedBrowserProcesses([root], options).mainPid,
    root.pid
  );
  assert.equal(
    sameProcessIdentity(root, { ...root }),
    true
  );
  assert.equal(
    sameProcessIdentity(root, { ...root, parentPid: launcher.pid }),
    true
  );
  assert.equal(
    sameProcessIdentity(root, {
      ...root,
      startTimeTicks: "800002"
    }),
    false
  );
  assert.equal(
    selectVerifiedBrowserRootAfterLauncherExit([], options, launcher),
    null
  );
  assert.throws(
    () => selectVerifiedBrowserRootAfterLauncherExit([
      { ...root, startTimeTicks: "799999" }
    ], options, launcher),
    /시작 identity/u
  );
  assert.throws(
    () => selectVerifiedBrowserRootAfterLauncherExit([
      { ...root, pid: launcher.pid, startTimeTicks: launcher.startTimeTicks }
    ], options, launcher),
    /PID·UID·시작 identity/u
  );
  assert.throws(
    () => selectVerifiedBrowserRootAfterLauncherExit([
      { ...root, ownerUid: 1001 }
    ], options, launcher),
    /검증하지 못했습니다/u
  );
  assert.throws(
    () => selectVerifiedBrowserRootAfterLauncherExit([
      {
        ...root,
        executable: "/opt/google/chrome/chrome",
        argv: ["/opt/google/chrome/chrome", ...root.argv.slice(1)]
      }
    ], options, launcher),
    /검증하지 못했습니다/u
  );
  assert.throws(
    () => selectVerifiedBrowserRootAfterLauncherExit([
      root,
      {
        ...root,
        pid: 7002,
        startTimeTicks: "800002"
      }
    ], options, launcher),
    /둘 이상/u
  );
});

test("Whisper 시작은 설치·Origin·ready 뒤 systemd/foreground를 정확히 고른다", () => {
  assert.equal(captionStartStrategy(null), "setup-required");
  assert.equal(captionStartStrategy({
    configured: true,
    originMatchesCurrentPath: false
  }), "origin-mismatch");
  assert.equal(captionStartStrategy({
    configured: true,
    originMatchesCurrentPath: true,
    endpoints: { stt: true, gateway: true },
    systemdUser: false
  }), "ready");
  assert.equal(captionStartStrategy({
    configured: true,
    originMatchesCurrentPath: true,
    endpoints: { stt: false, gateway: false },
    systemdUser: true
  }), "systemd");
  assert.equal(captionStartStrategy({
    configured: true,
    originMatchesCurrentPath: true,
    endpoints: { stt: false, gateway: false },
    systemdUser: false
  }), "foreground");
  assert.equal(shouldCycleForegroundCaption({
    configured: true,
    runtime: {
      manager: "foreground",
      managedForeground: true
    }
  }), true);
  assert.equal(shouldCycleForegroundCaption({
    configured: true,
    runtime: {
      manager: "systemd",
      managedForeground: false
    }
  }), false);
  assert.equal(shouldCycleStudioServer({
    ready: true,
    ownership: "managed",
    managerPid: 123
  }), true);
  assert.equal(shouldCycleStudioServer({
    ready: false,
    ownership: "foreign",
    managerPid: null
  }), false);
  assert.equal(studioServerMatchesOrigin({
    ready: true,
    ownership: "managed",
    managerPid: 123,
    studioOrigin: KIRINUKI_PUBLIC_STUDIO_ORIGIN
  }, KIRINUKI_PUBLIC_STUDIO_ORIGIN), true);
  assert.equal(studioServerMatchesOrigin({
    ready: true,
    ownership: "managed",
    managerPid: 123,
    studioOrigin: KIRINUKI_LOCAL_STUDIO_ORIGIN
  }, KIRINUKI_PUBLIC_STUDIO_ORIGIN), false);
});

test("XDG 경로는 repository 밖의 안정적인 사용자 profile을 고른다", () => {
  const defaultPaths = resolveLinuxHelperPaths({
    env: {},
    homeDir: "/home/kirinuki-user",
    packageDir: "/opt/KirinukiHelper"
  });
  assert.equal(
    defaultPaths.browserProfileRoot,
    "/home/kirinuki-user/Kirinuki/browser-profile",
    "Ubuntu Snap Chromium이 접근할 수 없는 숨김 XDG 경로를 기본 profile로 골랐습니다."
  );
  const paths = resolveLinuxHelperPaths({
    env: {
      XDG_CONFIG_HOME: "/tmp/config root",
      XDG_STATE_HOME: "/tmp/state root",
      XDG_DATA_HOME: "/tmp/data root",
      KIRINUKI_PACKAGE_ROOT: "/srv/kirinuki runtime",
      KIRINUKI_EXTENSION_ROOT: "/srv/kirinuki runtime/extension",
      KIRINUKI_STREAMING_COMPANION_ROOT: "/srv/kirinuki runtime/streaming-companion",
      KIRINUKI_BROWSER_PROFILE_ROOT: "/srv/kirinuki profile"
    },
    homeDir: "/tmp/home",
    packageDir: "/opt/KirinukiHelper"
  });
  assert.equal(
    paths.browserProfileRoot,
    "/srv/kirinuki profile"
  );
  assert.equal(
    paths.streamingCompanionRoot,
    "/srv/kirinuki runtime/streaming-companion"
  );
  assert.equal(
    paths.legacyExtensionRoot,
    "/srv/kirinuki runtime/extension"
  );
  assert.equal(paths.packageRoot, "/srv/kirinuki runtime");
  assert.equal(
    paths.captionLogPath,
    "/tmp/state root/kirinuki-studio/caption-stack.log"
  );
  assert.equal(paths.userLauncherPath, "/tmp/home/.local/bin/kirinuki");
  assert.equal(
    paths.desktopEntryPath,
    "/tmp/data root/applications/kirinuki-helper.desktop"
  );
  assert.equal(
    paths.legacyDesktopEntryPath,
    "/tmp/data root/applications/chromium-kirinuki.desktop"
  );
  const invalidOverrides: ReadonlyArray<readonly [string, string]> = [
    ["KIRINUKI_PACKAGE_ROOT", "relative/package"],
    ["KIRINUKI_EXTENSION_ROOT", "relative/extension"],
    ["KIRINUKI_EXTENSION_ROOT", ""],
    ["KIRINUKI_STREAMING_COMPANION_ROOT", "relative/companion"],
    ["KIRINUKI_BROWSER_PROFILE_ROOT", "/tmp/profile\nother"]
  ];
  for (const [name, value] of invalidOverrides) {
    assert.throws(
      () => resolveLinuxHelperPaths({
        env: { [name]: value },
        homeDir: "/tmp/home"
      }),
      /절대경로/u
    );
  }
});

test("setup용 사용자 명령과 desktop entry는 원자적으로 최신 경로만 가리킨다", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "kirinuki-entrypoints-")
  );
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const paths = resolveLinuxHelperPaths({
    env: {
      XDG_DATA_HOME: path.join(tempRoot, "data"),
      KIRINUKI_BROWSER_PROFILE_ROOT: path.join(tempRoot, "browser profile")
    },
    homeDir: path.join(tempRoot, "home"),
    packageDir: "/opt/Kirinuki Helper"
  });
  const updaterRoot = path.join(tempRoot, "bin");
  const updater = path.join(updaterRoot, "update-desktop-database");
  const xdgMime = path.join(updaterRoot, "xdg-mime");
  await mkdir(updaterRoot, { recursive: true });
  await Promise.all([
    writeFile(updater, "#!/bin/sh\nexit 0\n"),
    writeFile(xdgMime, "#!/bin/sh\nexit 0\n")
  ]);
  await Promise.all([chmod(updater, 0o755), chmod(xdgMime, 0o755)]);
  assert.deepEqual(
    desktopDatabaseRefreshCommand(paths, { PATH: updaterRoot }),
    {
      file: updater,
      args: [path.dirname(paths.desktopEntryPath)]
    }
  );
  assert.equal(
    desktopDatabaseRefreshCommand(paths, { PATH: "" }),
    null
  );
  assert.deepEqual(
    desktopMimeRegistrationCommand(paths, { PATH: updaterRoot }),
    {
      file: xdgMime,
      args: [
        "default",
        "kirinuki-helper.desktop",
        "x-scheme-handler/kirinuki"
      ]
    }
  );
  assert.equal(desktopMimeRegistrationCommand(paths, { PATH: "" }), null);
  const firstInstall = await installUserEntrypoints(
    paths,
    "/opt/Kirinuki Helper"
  );
  assert.deepEqual(firstInstall.replacedEntrypointBackups, []);
  const launcher = await readFile(paths.userLauncherPath, "utf8");
  const desktop = await readFile(paths.desktopEntryPath, "utf8");
  assert.equal(
    launcher,
    userLauncherContent(paths, "/opt/Kirinuki Helper")
  );
  assert.doesNotMatch(launcher, /KIRINUKI_EXTENSION_ROOT/u);
  assert.match(launcher, /KIRINUKI_STREAMING_COMPANION_ROOT/u);
  assert.match(
    launcher,
    /KIRINUKI_PACKAGE_ROOT='\/opt\/Kirinuki Helper'/u
  );
  assert.match(
    launcher,
    /KIRINUKI_BROWSER_PROFILE_ROOT='\/.+browser profile'/u
  );
  assert.match(
    launcher,
    /exec '\/opt\/Kirinuki Helper\/kirinuki\.sh' "\$@"/u
  );
  assert.match(launcher, /if \[ "\$#" -eq 0 \]; then\n  set -- open\nfi/u);
  assert.equal((await stat(paths.userLauncherPath)).mode & 0o777, 0o755);
  assert.equal(
    desktop,
    desktopEntryContent(paths)
  );
  assert.match(desktop, /^Name=Kirinuki$/mu);
  assert.match(
    desktop,
    /^Exec=\/usr\/bin\/env KIRINUKI_DESKTOP_LAUNCH=1 "\/.+\/kirinuki" %u$/mu
  );
  assert.match(
    desktop,
    /^MimeType=x-scheme-handler\/kirinuki;$/mu
  );
  assert.doesNotMatch(
    desktop,
    /x-scheme-handler\/(?:http|https)|text\/html/iu
  );
  assert.match(desktop, /^Terminal=false$/mu);
  assert.equal((await stat(paths.desktopEntryPath)).mode & 0o777, 0o644);

  const launcherBefore = await lstat(paths.userLauncherPath);
  const desktopBefore = await lstat(paths.desktopEntryPath);
  const secondInstall = await installUserEntrypoints(
    paths,
    "/opt/Kirinuki Helper"
  );
  assert.deepEqual(secondInstall.replacedEntrypointBackups, []);
  assert.equal((await lstat(paths.userLauncherPath)).ino, launcherBefore.ino);
  assert.equal((await lstat(paths.desktopEntryPath)).ino, desktopBefore.ino);
  assert.deepEqual(
    (await readdir(path.dirname(paths.userLauncherPath)))
      .filter((name) => name.includes(".backup-")),
    []
  );

  let report = await inspectUserEntrypoints(
    paths,
    "/opt/Kirinuki Helper"
  );
  assert.equal(report.current, true);
  const legacyBody = [
    "[Desktop Entry]",
    "Version=1.0",
    "Name=Chromium - 치지직 키리누키",
    "GenericName=CHZZK Kirinuki Browser",
    `Exec=${path.join(path.dirname(paths.userLauncherPath), "chromium-kirinuki")} %U`,
    "Type=Application",
    "MimeType=x-scheme-handler/http;x-scheme-handler/https;text/html;",
    ""
  ].join("\n");
  await writeFile(paths.legacyDesktopEntryPath, legacyBody);
  report = await inspectUserEntrypoints(paths, "/opt/Kirinuki Helper");
  assert.equal(report.legacyDesktop.recognized, true);
  assert.equal(report.current, false);
  const retired = await installUserEntrypoints(
    paths,
    "/opt/Kirinuki Helper"
  );
  assert.ok(retired.retiredLegacyPath);
  await assert.rejects(stat(paths.legacyDesktopEntryPath));
  assert.equal(
    await readFile(retired.retiredLegacyPath, "utf8"),
    legacyBody
  );

  const unrelated = [
    "[Desktop Entry]",
    "Name=사용자의 별도 앱",
    "Exec=/opt/unrelated",
    "Type=Application",
    ""
  ].join("\n");
  await writeFile(paths.legacyDesktopEntryPath, unrelated);
  const untouched = await installUserEntrypoints(
    paths,
    "/opt/Kirinuki Helper"
  );
  assert.equal(untouched.retiredLegacyPath, null);
  assert.equal(
    await readFile(paths.legacyDesktopEntryPath, "utf8"),
    unrelated
  );
  report = await inspectUserEntrypoints(paths, "/opt/Kirinuki Helper");
  assert.equal(report.legacyDesktop.present, true);
  assert.equal(report.legacyDesktop.recognized, false);
  assert.equal(report.current, true);

  const knownLegacyLauncher = [
    "#!/bin/sh",
    "",
    "set -eu",
    "",
    `LAUNCHER="${path.join(path.dirname(paths.userLauncherPath), "chromium-kirinuki")}"`,
    "",
    "if [ ! -x \"$LAUNCHER\" ]; then",
    "  printf '%s\\n' \"치지직 키리누키 전용 Chromium 실행기를 찾지 못했습니다: $LAUNCHER\" >&2",
    "  exit 1",
    "fi",
    "",
    "exec \"$LAUNCHER\" \"$@\"",
    ""
  ].join("\n");
  await writeFile(paths.userLauncherPath, knownLegacyLauncher);
  await chmod(paths.userLauncherPath, 0o755);
  const migratedLegacy = await installUserEntrypoints(
    paths,
    "/opt/Kirinuki Helper"
  );
  assert.equal(migratedLegacy.replacedEntrypointBackups.length, 1);
  const [backupPath] = migratedLegacy.replacedEntrypointBackups;
  assert.ok(backupPath);
  assert.equal(
    await readFile(backupPath, "utf8"),
    knownLegacyLauncher
  );
  assert.equal(
    await readFile(paths.userLauncherPath, "utf8"),
    userLauncherContent(paths, "/opt/Kirinuki Helper")
  );

  const previousWebLauncher = [
    "#!/usr/bin/env sh",
    "set -eu",
    `# kirinuki-helper-config=${JSON.stringify({
      packageRoot: "/opt/Kirinuki Helper",
      browserProfileRoot: paths.browserProfileRoot
    })}`,
    `export KIRINUKI_BROWSER_PROFILE_ROOT='${paths.browserProfileRoot}'`,
    "if [ \"$#\" -eq 0 ]; then",
    "  set -- open",
    "fi",
    "exec '/opt/Kirinuki Helper/kirinuki.sh' \"$@\"",
    ""
  ].join("\n");
  await writeFile(paths.userLauncherPath, previousWebLauncher);
  await chmod(paths.userLauncherPath, 0o755);
  const migratedPreviousWeb = await installUserEntrypoints(
    paths,
    "/opt/Kirinuki Helper"
  );
  assert.equal(migratedPreviousWeb.replacedEntrypointBackups.length, 1);
  assert.equal(
    await readFile(paths.userLauncherPath, "utf8"),
    userLauncherContent(paths, "/opt/Kirinuki Helper")
  );

  const previousWebLauncherWithPackageRoot = [
    "#!/usr/bin/env sh",
    "set -eu",
    `# kirinuki-helper-config=${JSON.stringify({
      packageRoot: "/opt/Kirinuki Helper",
      browserProfileRoot: paths.browserProfileRoot
    })}`,
    "export KIRINUKI_PACKAGE_ROOT='/opt/Kirinuki Helper'",
    `export KIRINUKI_BROWSER_PROFILE_ROOT='${paths.browserProfileRoot}'`,
    "if [ \"$#\" -eq 0 ]; then",
    "  set -- open",
    "fi",
    "exec '/opt/Kirinuki Helper/kirinuki.sh' \"$@\"",
    ""
  ].join("\n");
  await writeFile(paths.userLauncherPath, previousWebLauncherWithPackageRoot);
  await chmod(paths.userLauncherPath, 0o755);
  const migratedPreviousWebWithPackageRoot = await installUserEntrypoints(
    paths,
    "/opt/Kirinuki Helper"
  );
  assert.equal(
    migratedPreviousWebWithPackageRoot.replacedEntrypointBackups.length,
    1
  );
  assert.equal(
    await readFile(paths.userLauncherPath, "utf8"),
    userLauncherContent(paths, "/opt/Kirinuki Helper")
  );

  const previousExtensionLauncher = [
    "#!/usr/bin/env sh",
    "set -eu",
    `# kirinuki-helper-config=${JSON.stringify({
      packageRoot: "/opt/Kirinuki Helper",
      extensionRoot: paths.legacyExtensionRoot,
      browserProfileRoot: paths.browserProfileRoot
    })}`,
    "export KIRINUKI_PACKAGE_ROOT='/opt/Kirinuki Helper'",
    `export KIRINUKI_EXTENSION_ROOT='${paths.legacyExtensionRoot}'`,
    `export KIRINUKI_BROWSER_PROFILE_ROOT='${paths.browserProfileRoot}'`,
    "if [ \"$#\" -eq 0 ]; then",
    "  set -- open",
    "fi",
    "exec '/opt/Kirinuki Helper/kirinuki.sh' \"$@\"",
    ""
  ].join("\n");
  await writeFile(paths.userLauncherPath, previousExtensionLauncher);
  await chmod(paths.userLauncherPath, 0o755);
  const migratedPreviousManaged = await installUserEntrypoints(
    paths,
    "/opt/Kirinuki Helper"
  );
  assert.equal(
    migratedPreviousManaged.replacedEntrypointBackups.length,
    1
  );
  assert.equal(
    await readFile(paths.userLauncherPath, "utf8"),
    userLauncherContent(paths, "/opt/Kirinuki Helper")
  );

  await writeFile(
    paths.userLauncherPath,
    "#!/bin/sh\nexec /opt/old-kirinuki/kirinuki.sh \"$@\"\n"
  );
  await chmod(paths.userLauncherPath, 0o755);
  report = await inspectUserEntrypoints(paths, "/opt/Kirinuki Helper");
  assert.equal(report.current, false);
  assert.equal(
    report.launcher.actualTarget,
    "/opt/old-kirinuki/kirinuki.sh"
  );
});

test("설치된 bare kirinuki는 open으로, 명시 인자는 그대로 전달한다", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "kirinuki-wrapper-forwarding-")
  );
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const packageDir = path.join(tempRoot, "package root");
  await mkdir(packageDir, { recursive: true });
  const target = path.join(packageDir, "kirinuki.sh");
  await writeFile(
    target,
    [
      "#!/bin/sh",
      "printf 'args=%s\\n' \"$*\"",
      "printf 'package=%s\\n' \"$KIRINUKI_PACKAGE_ROOT\"",
      "printf 'profile=%s\\n' \"$KIRINUKI_BROWSER_PROFILE_ROOT\"",
      ""
    ].join("\n")
  );
  await chmod(target, 0o755);
  const paths = resolveLinuxHelperPaths({
    env: {
      XDG_DATA_HOME: path.join(tempRoot, "data"),
      KIRINUKI_BROWSER_PROFILE_ROOT: path.join(tempRoot, "browser profile")
    },
    homeDir: path.join(tempRoot, "home"),
    packageDir
  });
  await installUserEntrypoints(paths, packageDir);

  const runWrapper = (args: string[]) => new Promise<NodeRunResult>((
    resolve,
    reject
  ) => {
    const child = spawn(paths.userLauncherPath, args, {
      env: process.env,
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
  const bare = await runWrapper([]);
  assert.equal(bare.code, 0, bare.stderr);
  assert.match(bare.stdout, /^args=open$/mu);
  assert.match(
    bare.stdout,
    new RegExp(`^package=${paths.packageRoot}$`, "mu")
  );
  assert.match(
    bare.stdout,
    new RegExp(`^profile=${paths.browserProfileRoot}$`, "mu")
  );

  const explicit = await runWrapper(["status", "--json"]);
  assert.equal(explicit.code, 0, explicit.stderr);
  assert.match(explicit.stdout, /^args=status --json$/mu);
});

test("사용자의 unrelated 파일과 symlink는 setup이 절대 덮어쓰지 않는다", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "kirinuki-entrypoint-ownership-")
  );
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const makePaths = (name: string) => resolveLinuxHelperPaths({
    env: {
      XDG_DATA_HOME: path.join(tempRoot, name, "data")
    },
    homeDir: path.join(tempRoot, name, "home"),
    packageDir: "/opt/Kirinuki Helper"
  });

  const unrelatedPaths = makePaths("unrelated");
  await Promise.all([
    mkdir(path.dirname(unrelatedPaths.userLauncherPath), {
      recursive: true
    }),
    mkdir(path.dirname(unrelatedPaths.desktopEntryPath), {
      recursive: true
    })
  ]);
  const unrelatedLauncher = "#!/bin/sh\nexec /opt/my-own-tool \"$@\"\n";
  const unrelatedDesktop = [
    "[Desktop Entry]",
    "Name=내 앱",
    "Exec=/opt/my-own-tool",
    "Type=Application",
    ""
  ].join("\n");
  await Promise.all([
    writeFile(unrelatedPaths.userLauncherPath, unrelatedLauncher),
    writeFile(unrelatedPaths.desktopEntryPath, unrelatedDesktop)
  ]);
  const unrelatedLauncherInode = (
    await lstat(unrelatedPaths.userLauncherPath)
  ).ino;
  const unrelatedDesktopInode = (
    await lstat(unrelatedPaths.desktopEntryPath)
  ).ino;
  await assert.rejects(
    installUserEntrypoints(
      unrelatedPaths,
      "/opt/Kirinuki Helper"
    ),
    /소유 marker가 없는 기존 사용자 파일/u
  );
  assert.equal(
    await readFile(unrelatedPaths.userLauncherPath, "utf8"),
    unrelatedLauncher
  );
  assert.equal(
    await readFile(unrelatedPaths.desktopEntryPath, "utf8"),
    unrelatedDesktop
  );
  assert.equal(
    (await lstat(unrelatedPaths.userLauncherPath)).ino,
    unrelatedLauncherInode
  );
  assert.equal(
    (await lstat(unrelatedPaths.desktopEntryPath)).ino,
    unrelatedDesktopInode
  );

  const symlinkPaths = makePaths("symlink");
  await Promise.all([
    mkdir(path.dirname(symlinkPaths.userLauncherPath), {
      recursive: true
    }),
    mkdir(path.dirname(symlinkPaths.desktopEntryPath), {
      recursive: true
    })
  ]);
  const launcherTarget = path.join(tempRoot, "launcher-target");
  const desktopTarget = path.join(tempRoot, "desktop-target");
  await Promise.all([
    writeFile(launcherTarget, "launcher target bytes"),
    writeFile(desktopTarget, "desktop target bytes")
  ]);
  await Promise.all([
    symlink(launcherTarget, symlinkPaths.userLauncherPath),
    symlink(desktopTarget, symlinkPaths.desktopEntryPath)
  ]);
  await assert.rejects(
    installUserEntrypoints(
      symlinkPaths,
      "/opt/Kirinuki Helper"
    ),
    /심볼릭 링크/u
  );
  assert.equal(
    await readlink(symlinkPaths.userLauncherPath),
    launcherTarget
  );
  assert.equal(
    await readlink(symlinkPaths.desktopEntryPath),
    desktopTarget
  );
  assert.equal(
    await readFile(launcherTarget, "utf8"),
    "launcher target bytes"
  );
  assert.equal(
    await readFile(desktopTarget, "utf8"),
    "desktop target bytes"
  );
  assert.equal(
    (await lstat(symlinkPaths.userLauncherPath)).isSymbolicLink(),
    true
  );
  assert.equal(
    (await lstat(symlinkPaths.desktopEntryPath)).isSymbolicLink(),
    true
  );

  const report = await inspectUserEntrypoints(
    symlinkPaths,
    "/opt/Kirinuki Helper"
  );
  assert.equal(report.launcher.installed, true);
  assert.match(report.launcher.actualTarget || "", /symlink/u);
  assert.equal(report.desktop.installed, true);
  assert.match(report.desktop.actualTarget || "", /symlink/u);

  const unreadablePaths = makePaths("unreadable");
  await Promise.all([
    mkdir(path.dirname(unreadablePaths.userLauncherPath), {
      recursive: true
    }),
    mkdir(path.dirname(unreadablePaths.desktopEntryPath), {
      recursive: true
    })
  ]);
  await Promise.all([
    writeFile(unreadablePaths.userLauncherPath, "private launcher"),
    writeFile(
      unreadablePaths.desktopEntryPath,
      desktopEntryContent(unreadablePaths)
    )
  ]);
  await chmod(unreadablePaths.userLauncherPath, 0o000);
  t.after(() => chmod(
    unreadablePaths.userLauncherPath,
    0o600
  ).catch(() => {}));
  const unreadableReport = await inspectUserEntrypoints(
    unreadablePaths,
    "/opt/Kirinuki Helper"
  );
  assert.equal(unreadableReport.launcher.installed, true);
  assert.match(unreadableReport.launcher.actualTarget || "", /읽기 실패/u);
  await assert.rejects(
    installUserEntrypoints(
      unreadablePaths,
      "/opt/Kirinuki Helper"
    ),
    /안전하게 읽지 못해/u
  );
  assert.equal(
    (await lstat(unreadablePaths.userLauncherPath)).mode & 0o777,
    0o000
  );

  const unreadableLegacyPaths = makePaths("unreadable-legacy");
  await mkdir(
    path.dirname(unreadableLegacyPaths.legacyDesktopEntryPath),
    { recursive: true }
  );
  await writeFile(
    unreadableLegacyPaths.legacyDesktopEntryPath,
    "unreadable legacy candidate"
  );
  await chmod(unreadableLegacyPaths.legacyDesktopEntryPath, 0o000);
  t.after(() => chmod(
    unreadableLegacyPaths.legacyDesktopEntryPath,
    0o600
  ).catch(() => {}));
  const unreadableLegacyReport = await inspectUserEntrypoints(
    unreadableLegacyPaths,
    "/opt/Kirinuki Helper"
  );
  assert.equal(
    unreadableLegacyReport.legacyDesktop.present,
    true
  );
  assert.match(
    unreadableLegacyReport.legacyDesktop.actualTarget || "",
    /읽기 실패/u
  );
  await assert.rejects(
    installUserEntrypoints(
      unreadableLegacyPaths,
      "/opt/Kirinuki Helper"
    ),
    /레거시 Kirinuki 앱 메뉴를 안전하게 검사하지 못해/u
  );
  await assert.rejects(
    lstat(unreadableLegacyPaths.userLauncherPath),
    { code: "ENOENT" }
  );
});

test("도움말은 사람이 쓸 모든 명령과 안전 경계를 노출한다", () => {
  const text = helpText();
  for (const command of [
    "setup",
    "doctor",
    "open",
    "start",
    "status",
    "stop"
  ]) {
    assert.match(text, new RegExp(`\\b${command}\\b`, "u"));
  }
  assert.match(text, /audseg/u);
  assert.match(text, /whisper/u);
  assert.match(text, /강제 종료하지 않음/u);
  assert.match(text, /\.local\/bin\/kirinuki/u);
  assert.match(text, /kirinuki:\/\/open/u);
  assert.match(text, /최초 실행[\s\S]*자동으로 준비/u);
  assert.match(text, /HTTP·HTTPS 기본 앱 연결은 변경하지 않습니다/u);
  assert.match(text, /KIRINUKI_BROWSER_PROFILE_ROOT/u);
  assert.match(
    text,
    /기본:[^\n]*Node\.js 22\+[^\n]*FFmpeg[^\n]*ffprobe/u
  );
  assert.match(
    text,
    /Whisper 선택 시 추가: CMake, tar, C\+\+ 컴파일러/u
  );
  assert.doesNotMatch(text, /companion|gateway|localhost|127\.0\.0\.1/u);
  assert.doesNotMatch(text, /curl\s*\|\s*(?:ba)?sh/iu);
});

test("fresh Linux dry-run은 외부 변경 없이 정확한 setup과 open 명령을 보여준다", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "kirinuki-linux-helper-")
  );
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const browser = path.join(tempRoot, "chromium");
  const npm = path.join(tempRoot, "npm");
  const ffmpeg = path.join(tempRoot, "ffmpeg");
  const ffprobe = path.join(tempRoot, "ffprobe");
  await Promise.all([
    writeFile(
      browser,
      "#!/bin/sh\nprintf '%s\\n' 'Chromium 120.0.0.0'\n"
    ),
    writeFile(npm, "#!/bin/sh\nexit 0\n"),
    writeFile(ffmpeg, "#!/bin/sh\nexit 0\n"),
    writeFile(ffprobe, "#!/bin/sh\nexit 0\n")
  ]);
  await Promise.all([
    chmod(browser, 0o755),
    chmod(npm, 0o755),
    chmod(ffmpeg, 0o755),
    chmod(ffprobe, 0o755)
  ]);
  const env = {
    ...process.env,
    HOME: path.join(tempRoot, "home"),
    PATH: `${tempRoot}:${process.env.PATH || ""}`,
    KIRINUKI_BROWSER_BINARY: browser,
    KIRINUKI_NPM_BINARY: npm,
    XDG_CONFIG_HOME: path.join(tempRoot, "config"),
    XDG_STATE_HOME: path.join(tempRoot, "state")
  };

  const setup = await runNode([
    "setup",
    "--mode",
    "audseg",
    "--yes",
    "--dry-run"
  ], { env });
  assert.equal(setup.code, 0, setup.stderr);
  assert.match(setup.stdout, /ci" "--ignore-scripts/u);
  assert.match(setup.stdout, /run" "build/u);
  assert.match(setup.stdout, /run" "validate/u);
  assert.match(setup.stdout, /run" "license:check/u);
  assert.match(setup.stdout, /사용자 명령 설치:/u);
  assert.match(setup.stdout, /앱 메뉴 설치 및 Kirinuki 링크 연결/u);
  assert.doesNotMatch(setup.stdout, /caption-stack\.ts" "setup/u);

  const publicSetup = await runNode([
    "setup",
    "--mode",
    "audseg",
    "--yes",
    "--dry-run"
  ], {
    env: {
      ...env,
      KIRINUKI_ALLOWED_ORIGIN: KIRINUKI_PUBLIC_STUDIO_ORIGIN
    }
  });
  assert.equal(publicSetup.code, 0, publicSetup.stderr);
  assert.match(publicSetup.stdout, /앱 연결 범위: 이 기기 내부 전용/u);
  assert.doesNotMatch(publicSetup.stdout, /kirinuki\.eff0rtchung\.kr/u);
  assert.doesNotMatch(publicSetup.stdout, /--public-origin/u);

  const invalidOrigin = await runNode(["help"], {
    env: {
      ...env,
      KIRINUKI_ALLOWED_ORIGIN: "https://example.com"
    }
  });
  assert.equal(invalidOrigin.code, 0, invalidOrigin.stderr);
  assert.match(invalidOrigin.stdout, /Kirinuki 앱 \(Linux\)/u);
  assert.doesNotMatch(invalidOrigin.stdout, /example\.com/u);

  const whisperSetup = await runNode([
    "setup",
    "--mode",
    "whisper",
    "--profile",
    "draft",
    "--backend",
    "cpu",
    "--yes",
    "--dry-run"
  ], { env });
  assert.equal(whisperSetup.code, 0, whisperSetup.stderr);
  assert.match(whisperSetup.stdout, /local-caption-stack\.ts" "doctor/u);
  assert.match(whisperSetup.stdout, /local-caption-stack\.ts" "setup/u);
  assert.match(whisperSetup.stdout, /"--profile" "draft"/u);
  assert.match(whisperSetup.stdout, /"--backend" "cpu"/u);

  const open = await runNode([
    "open",
    "--mode",
    "audseg",
    "--dry-run",
    "https://chzzk.naver.com/video/14514980"
  ], { env });
  assert.equal(open.code, 0, open.stderr);
  assert.match(open.stdout, /자동으로 준비합니다/u);
  assert.match(open.stdout, /local-studio-server\.ts" "status" "--json/u);
  assert.match(open.stdout, /local-studio-server\.ts" "start/u);
  assert.match(open.stdout, /Kirinuki 전용 브라우저를 열 예정/u);
  assert.doesNotMatch(
    open.stdout,
    /companion|gateway|localhost|127\.0\.0\.1/u
  );
  assert.match(open.stdout, /https:\/\/chzzk\.naver\.com\/video\/14514980/u);
  assert.equal(
    await readFile(browser, "utf8"),
    "#!/bin/sh\nprintf '%s\\n' 'Chromium 120.0.0.0'\n"
  );
});

test("자동 companion 로드는 Chromium만 허용하고 branded Chrome은 fail-closed한다", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "kirinuki-browser-brand-")
  );
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const chromium = path.join(tempRoot, "chromium");
  const chrome = path.join(tempRoot, "google-chrome");
  await Promise.all([
    writeFile(
      chromium,
      "#!/bin/sh\nprintf '%s\\n' 'Chromium 150.0.0.0'\n"
    ),
    writeFile(
      chrome,
      "#!/bin/sh\nprintf '%s\\n' 'Google Chrome 150.0.0.0'\n"
    )
  ]);
  await Promise.all([chmod(chromium, 0o755), chmod(chrome, 0o755)]);
  const env = {
    PATH: tempRoot
  };
  const branded = inspectBrowser({ requested: chrome, env });
  assert.equal(branded.available, true);
  assert.equal(branded.product, "chrome");
  assert.equal(branded.supported, false);
  assert.equal(
    inspectPreferredBrowser({ explicit: chrome, env }).supported,
    false
  );
  const stored = inspectPreferredBrowser({ stored: chrome, env });
  assert.equal(stored.supported, true);
  assert.equal(stored.product, "chromium");
  assert.equal(stored.binary, chromium);
});

test("누락된 fresh Linux 의존성은 변경 없이 실행 가능한 설치 안내로 실패한다", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "kirinuki-missing-dependencies-")
  );
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: "",
    HOME: path.join(tempRoot, "home"),
    XDG_CONFIG_HOME: path.join(tempRoot, "config"),
    XDG_STATE_HOME: path.join(tempRoot, "state"),
    XDG_DATA_HOME: path.join(tempRoot, "data")
  };
  delete env.KIRINUKI_BROWSER_BINARY;
  delete env.KIRINUKI_NPM_BINARY;
  delete env.KIRINUKI_EXTENSION_ROOT;
  delete env.KIRINUKI_STREAMING_COMPANION_ROOT;
  delete env.KIRINUKI_BROWSER_PROFILE_ROOT;
  const result = await runNode([
    "doctor",
    "--mode",
    "audseg"
  ], { env });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /npm: 없음/u);
  assert.match(result.stdout, /Chromium 계열 브라우저 없음/u);
  assert.match(result.stdout, /apt install nodejs npm chromium/u);
  assert.doesNotMatch(result.stdout, /chromium cmake c\+\+ tar/u);
  assert.match(result.stdout, /자동 실행하지 않습니다/u);
});

test("AudSeg status와 stop은 모든 앱 엔진 lifecycle을 함께 다룬다", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "kirinuki-audseg-status-")
  );
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const env = {
    ...process.env,
    HOME: path.join(tempRoot, "home"),
    XDG_CONFIG_HOME: path.join(tempRoot, "config"),
    XDG_STATE_HOME: path.join(tempRoot, "state")
  };
  const status = await runNode([
    "status",
    "--mode",
    "audseg",
    "--json"
  ], { env });
  assert.equal(status.code, 0, status.stderr);
  const parsed = JSON.parse(status.stdout);
  assert.equal(parsed.engines.captions.mode, "audseg");
  assert.equal(parsed.engines.captions.ready, true);
  assert.equal(parsed.app.browser.state, "stopped");
  assert.equal(parsed.app.browser.transitionRequired, false);
  assert.equal(parsed.engines.media.configured, false);
  assert.equal(parsed.engines.editor.available, true);
  assert.doesNotMatch(
    status.stdout,
    /companion|gateway|localhost|127\.0\.0\.1|4319|4320/u
  );

  const stopped = await runNode([
    "stop",
    "--mode",
    "audseg",
    "--dry-run"
  ], { env });
  assert.equal(stopped.code, 0, stopped.stderr);
  const studioIndex = stopped.stdout.indexOf("local-studio-server.ts");
  const vodIndex = stopped.stdout.indexOf("local-vod-runtime.ts");
  const captionIndex = stopped.stdout.indexOf("local-caption-stack.ts");
  assert.ok(studioIndex >= 0);
  assert.ok(vodIndex > studioIndex);
  assert.ok(captionIndex > vodIndex);
});

test("셸 진입점은 ZIP의 0644 권한에서도 setup을 열고 성공 뒤 실행권한을 복원한다", async (t) => {
  const [launcher, setup] = await Promise.all([
    readFile(path.join(packageRoot, "kirinuki.sh"), "utf8"),
    readFile(path.join(packageRoot, "setup.sh"), "utf8")
  ]);
  assert.match(launcher, /^#!\/usr\/bin\/env bash/u);
  assert.match(launcher, /scripts\/linux-helper\.ts/u);
  assert.match(launcher, /Node\.js 22/u);
  assert.doesNotMatch(launcher, /curl\s*\|\s*(?:ba)?sh/iu);
  assert.match(setup, /kirinuki\.sh" setup --yes/u);
  assert.doesNotMatch(setup, /rm\s+-rf/u);
  assert.match(setup, /exec bash .+kirinuki\.sh" setup --yes/u);
  const helper = await readFile(helperPath, "utf8");
  assert.match(helper, /process\.kill\([^\n]+, "SIGTERM"\)/u);
  assert.doesNotMatch(
    helper,
    /process\.kill\([^)]*,\s*["']SIGKILL["']|child\.kill/u
  );
  assert.match(helper, /APP_LIFECYCLE_PROTOCOL/u);
  assert.match(helper, /await lifecycleClaim\.beginClosing\(\)/u);
  assert.match(helper, /await lifecycleClaim\.resumeOpenRequests\(\)/u);
  assert.match(helper, /detached:\s*false/u);
  assert.match(helper, /detached:\s*true/u);
  assert.match(helper, /process\.on\("SIGINT"/u);
  assert.match(helper, /process\.on\("SIGTERM"/u);
  assert.match(helper, /await cleanup\(\)/u);
  assert.match(
    helper,
    /await superviseExistingBrowser\(/u
  );
  assert.match(helper, /sameProcessIdentity\(expectedMain, current\.main\)/u);

  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "kirinuki-source-zip-mode-")
  );
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const copiedLauncher = path.join(tempRoot, "kirinuki.sh");
  const copiedSetup = path.join(tempRoot, "setup.sh");
  const fakeNode = path.join(tempRoot, "node");
  const fakeTsxCli = path.join(
    tempRoot,
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs"
  );
  await mkdir(path.dirname(fakeTsxCli), { recursive: true });
  await Promise.all([
    writeFile(copiedLauncher, launcher),
    writeFile(copiedSetup, setup),
    writeFile(fakeTsxCli, ""),
    writeFile(
      fakeNode,
      [
        "#!/bin/sh",
        "if [ \"$1\" = \"--version\" ]; then",
        "  printf '%s\\n' 'v22.0.0'",
        "  exit 0",
        "fi",
        "printf '%s\\n' \"$@\"",
        ""
      ].join("\n")
    )
  ]);
  await Promise.all([
    chmod(copiedLauncher, 0o644),
    chmod(copiedSetup, 0o644),
    chmod(fakeNode, 0o755)
  ]);
  const entry = await new Promise<NodeRunResult>((resolve, reject) => {
    const child = spawn(
      "bash",
      [copiedSetup, "--mode", "audseg", "--dry-run"],
      {
        env: {
          ...process.env,
          KIRINUKI_NODE_BINARY: fakeNode
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => (
      resolve({ code, signal, stdout, stderr })
    ));
  });
  assert.equal(entry.code, 0, entry.stderr);
  assert.match(entry.stdout, /scripts\/linux-helper\.ts/u);
  assert.match(entry.stdout, /^setup$/mu);
  assert.match(entry.stdout, /^--yes$/mu);
  assert.equal((await stat(copiedLauncher)).mode & 0o777, 0o644);
  await restoreLauncherPermissions(tempRoot);
  assert.equal((await stat(copiedLauncher)).mode & 0o777, 0o755);
  assert.equal((await stat(copiedSetup)).mode & 0o777, 0o755);
});
