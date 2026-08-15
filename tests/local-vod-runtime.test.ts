import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  KIRINUKI_GATEWAY_ORIGIN_BINDING,
  KIRINUKI_LOCAL_STUDIO_ORIGIN
} from "../src/lib/local-runtime-origin.js";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_VOD_GATEWAY_PORT,
  LOCAL_VOD_PID_SCHEMA,
  LOCAL_VOD_RUNTIME_SCHEMA,
  MINIMUM_VOD_NODE_VERSION,
  MINIMUM_VOD_PYTHON_VERSION,
  PINNED_YT_DLP,
  VOD_HEALTH_SCHEMA,
  VOD_LOOPBACK_HOST,
  VOD_REQUEST_SCHEMA,
  commandLineRunsExactVodCli,
  createVodInstanceNonce,
  createVodRuntimeConfig,
  inspectArtifactFile,
  isManagedVodHealthPayload,
  managedVodRuntimeEnvironment,
  parseProcStartTime,
  parsePythonVersion,
  parseVodRuntimeArgs,
  readVodRuntimeConfig,
  resolveVodRuntimePaths,
  secretFreeVodConfigJson,
  supportedSemanticVersion,
  supportedVodNodeVersion,
  supportedVodPythonVersion,
  validVodPidRecord,
  validateVodRuntimeConfig,
  vodGatewayOwnedByPid,
  vodHealthRequest,
  vodManagerEnvironment,
  vodRuntimeConfigNeedsPackageRootMigration
} from "../scripts/local-vod-runtime-core.js";
import {
  helpText,
  inspectVodToolchain,
  vodRuntimeOriginMatchesRequestedStudio
} from "../scripts/local-vod-runtime.js";

const TEST_INSTANCE_NONCE =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const TEST_NOTICES = Object.freeze({
  size: 1234,
  sha256: "a".repeat(64)
});

function fixturePaths() {
  return resolveVodRuntimePaths({
    env: {
      XDG_DATA_HOME: "/tmp/kirinuki-vod-test/data",
      XDG_CONFIG_HOME: "/tmp/kirinuki-vod-test/config",
      XDG_STATE_HOME: "/tmp/kirinuki-vod-test/state",
      XDG_RUNTIME_DIR: "/tmp/kirinuki-vod-test/run"
    },
    homeDir: "/tmp/kirinuki-vod-test/home",
    packageRoot: "/opt/kirinuki"
  });
}

function fixtureConfig() {
  return createVodRuntimeConfig(fixturePaths(), {
    node: { path: "/opt/node/bin/node", version: "22.18.0" },
    python: { path: "/opt/python/bin/python3", version: "3.12.4" },
    ffmpeg: { path: "/opt/media/bin/ffmpeg", version: "7.1.1" },
    ffprobe: { path: "/opt/media/bin/ffprobe", version: "7.1.1" }
  }, {
    installedAt: "2026-08-10T00:00:00.000Z",
    notices: TEST_NOTICES
  });
}

test("yt-dlp는 공식 2026.07.04 zipimport와 bundled EJS를 불변 pin한다", () => {
  assert.equal(PINNED_YT_DLP.version, "2026.07.04");
  assert.equal(
    PINNED_YT_DLP.url,
    "https://github.com/yt-dlp/yt-dlp/releases/download/2026.07.04/yt-dlp"
  );
  assert.equal(PINNED_YT_DLP.size, 3_071_553);
  assert.equal(
    PINNED_YT_DLP.sha256,
    "495be29ff4d9d4e9be7eabdfef225221e5d5282e77f2f505abc6dca80349f3fd"
  );
  assert.equal(PINNED_YT_DLP.bundledJavascript.version, "0.8.0");
  assert.deepEqual(
    PINNED_YT_DLP.bundledJavascript.dependencies,
    ["Meriyah", "Astring"]
  );
});

test("Linux XDG 경로는 자막 stack과 독립된 VOD runtime namespace를 쓴다", () => {
  const paths = fixturePaths();
  assert.equal(paths.dataRoot, "/tmp/kirinuki-vod-test/data/kirinuki-vod-runtime");
  assert.equal(paths.configPath, "/tmp/kirinuki-vod-test/config/kirinuki-vod-runtime/config.json");
  assert.equal(paths.stateRoot, "/tmp/kirinuki-vod-test/state/kirinuki-vod-runtime");
  assert.equal(paths.runtimeRoot, "/tmp/kirinuki-vod-test/run/kirinuki-vod-runtime");
  assert.equal(
    paths.ytDlpPath,
    "/tmp/kirinuki-vod-test/data/kirinuki-vod-runtime/bin/yt-dlp-2026.07.04"
  );
  assert.equal(paths.packageRoot, "/opt/kirinuki");
  for (const [key, value] of ([
    ["XDG_DATA_HOME", "relative/data"],
    ["XDG_CONFIG_HOME", " /tmp/config"],
    ["XDG_STATE_HOME", "/tmp/state\ninvalid"],
    ["XDG_RUNTIME_DIR", " "]
  ] as const)) {
    assert.throws(() => resolveVodRuntimePaths({
      env: { [key]: value },
      homeDir: "/tmp/home",
      packageRoot: "/opt/kirinuki"
    }), /절대 경로/u);
  }
  assert.equal(resolveVodRuntimePaths({
    env: { KIRINUKI_PACKAGE_ROOT: "/srv/kirinuki package" },
    homeDir: "/tmp/home",
    packageRoot: "/opt/kirinuki"
  }).packageRoot, "/srv/kirinuki package");
  assert.throws(() => resolveVodRuntimePaths({
    env: { KIRINUKI_PACKAGE_ROOT: "relative/package" },
    homeDir: "/tmp/home",
    packageRoot: "/opt/kirinuki"
  }), /절대 경로/u);
});

test("CLI는 setup/doctor/start/status/stop만 받고 command별 옵션을 제한한다", () => {
  assert.deepEqual(parseVodRuntimeArgs([]), {
    command: "help",
    options: { dryRun: false, foreground: false, json: false }
  });
  assert.deepEqual(parseVodRuntimeArgs(["setup", "--dry-run", "--json"]), {
    command: "setup",
    options: { dryRun: true, foreground: false, json: true }
  });
  assert.deepEqual(parseVodRuntimeArgs(["start", "--foreground"]), {
    command: "start",
    options: { dryRun: false, foreground: true, json: false }
  });
  assert.equal(parseVodRuntimeArgs(["--help"]).command, "help");
  assert.throws(
    () => parseVodRuntimeArgs(["status", "--dry-run"]),
    /setup에서만/u
  );
  assert.throws(
    () => parseVodRuntimeArgs(["setup", "--foreground"]),
    /start에서만/u
  );
  assert.throws(
    () => parseVodRuntimeArgs(["start", "--cookie=session"]),
    /인증 정보나 쿠키/u
  );
  assert.throws(() => parseVodRuntimeArgs(["unknown"]), /알 수 없는 명령/u);
});

test("Node 22와 Python 3.11 최소 버전을 semantic하게 검증한다", () => {
  assert.equal(MINIMUM_VOD_NODE_VERSION, "22.0.0");
  assert.equal(MINIMUM_VOD_PYTHON_VERSION, "3.11.0");
  assert.equal(supportedVodNodeVersion("21.99.99"), false);
  assert.equal(supportedVodNodeVersion("22.0.0"), true);
  assert.equal(supportedVodNodeVersion("v24.1.0"), true);
  assert.equal(supportedVodPythonVersion("Python 3.10.14"), false);
  assert.equal(supportedVodPythonVersion("Python 3.11.0"), true);
  assert.equal(supportedSemanticVersion("3.12", "3.11.9"), true);
  assert.equal(supportedSemanticVersion("invalid", "3.11.0"), false);
  assert.equal(parsePythonVersion("Python 3.12.8\n"), "3.12.8");
  assert.equal(parsePythonVersion("python unknown"), null);
});

test("artifact 검증은 regular non-symlink·크기·SHA·실행 비트를 모두 요구한다", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kirinuki-vod-artifact-"));
  try {
    const bytes = Buffer.from("verified fixture\n", "utf8");
    const manifest = {
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex")
    };
    const artifact = path.join(directory, "artifact");
    await writeFile(artifact, bytes, { mode: 0o600 });
    const notExecutable = await inspectArtifactFile(artifact, manifest);
    assert.equal(notExecutable.regular, true);
    assert.equal(notExecutable.symlink, false);
    assert.equal(notExecutable.sha256Matches, true);
    assert.equal(notExecutable.executable, false);
    assert.equal(notExecutable.verified, false);

    await chmod(artifact, 0o700);
    assert.equal((await inspectArtifactFile(artifact, manifest)).verified, true);
    assert.equal((await inspectArtifactFile(artifact, {
      ...manifest,
      sha256: "0".repeat(64)
    })).verified, false);

    const link = path.join(directory, "artifact-link");
    await symlink(artifact, link);
    const linked = await inspectArtifactFile(link, manifest);
    assert.equal(linked.symlink, true);
    assert.equal(linked.verified, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("설정은 pin·절대 도구 경로·앱 Origin·VOD state를 강하게 묶는다", async () => {
  const paths = fixturePaths();
  const config = fixtureConfig();
  assert.equal(config.schema, LOCAL_VOD_RUNTIME_SCHEMA);
  assert.equal(config.host, VOD_LOOPBACK_HOST);
  assert.equal(config.gatewayPort, DEFAULT_VOD_GATEWAY_PORT);
  assert.equal(config.origin, KIRINUKI_LOCAL_STUDIO_ORIGIN);
  assert.equal(config.packageRoot, paths.packageRoot);
  assert.equal(config.ytDlp.path, paths.ytDlpPath);
  assert.equal(config.python.path, "/opt/python/bin/python3");
  assert.equal(config.ffmpeg.path, "/opt/media/bin/ffmpeg");
  assert.equal(config.ffprobe.path, "/opt/media/bin/ffprobe");
  assert.deepEqual(validateVodRuntimeConfig(config, paths), config);
  assert.equal(vodRuntimeOriginMatchesRequestedStudio(config, {}), true);
  assert.throws(
    () => vodRuntimeOriginMatchesRequestedStudio(config, {
      KIRINUKI_ALLOWED_ORIGIN: "https://kirinuki.eff0rtchung.kr"
    }),
    /Kirinuki 앱 Origin/u
  );
  assert.throws(() => createVodRuntimeConfig(paths, {
    node: config.node,
    python: config.python,
    ffmpeg: config.ffmpeg,
    ffprobe: config.ffprobe
  }, {
    installedAt: config.installedAt,
    notices: TEST_NOTICES,
    origin: "https://kirinuki.eff0rtchung.kr" as never
  }), /Kirinuki 앱 Origin/u);
  assert.throws(
    () => validateVodRuntimeConfig({
      ...config,
      origin: "https://kirinuki.eff0rtchung.kr.attacker.example"
    }, paths),
    /고정 artifact 또는 경로 계약/u
  );
  const serialized = secretFreeVodConfigJson(config);
  assert.doesNotMatch(serialized, /apiKey|password|cookie|token/iu);
  assert.doesNotMatch(serialized, /repoRoot|extensionRoot/u);

  const directory = await mkdtemp(path.join(os.tmpdir(), "kirinuki-vod-config-"));
  try {
    const localPaths = resolveVodRuntimePaths({
      env: {
        XDG_DATA_HOME: path.join(directory, "data"),
        XDG_CONFIG_HOME: path.join(directory, "config"),
        XDG_STATE_HOME: path.join(directory, "state"),
        XDG_RUNTIME_DIR: path.join(directory, "run")
      },
      homeDir: path.join(directory, "home"),
      packageRoot: "/opt/kirinuki"
    });
    const localConfig = createVodRuntimeConfig(localPaths, {
      node: { path: "/opt/node/bin/node", version: "22.2.0" },
      python: { path: "/opt/python/bin/python3", version: "3.11.9" },
      ffmpeg: { path: "/usr/bin/ffmpeg", version: "7.0.0" },
      ffprobe: { path: "/usr/bin/ffprobe", version: "7.0.0" }
    }, {
      notices: TEST_NOTICES
    });
    await mkdir(path.dirname(localPaths.configPath), { recursive: true });
    await writeFile(
      localPaths.configPath,
      secretFreeVodConfigJson(localConfig),
      "utf8"
    );
    assert.deepEqual(await readVodRuntimeConfig(localPaths), localConfig);
    const { packageRoot: _packageRoot, ...currentWithoutPackageRoot } =
      localConfig;
    const legacyConfig = {
      ...currentWithoutPackageRoot,
      repoRoot: localPaths.packageRoot,
      extensionRoot: "/previous/custom/extension-build"
    };
    const migratedLegacy = validateVodRuntimeConfig(
      legacyConfig,
      localPaths
    );
    assert.equal(migratedLegacy.packageRoot, localPaths.packageRoot);
    assert.equal("repoRoot" in migratedLegacy, false);
    assert.equal("extensionRoot" in migratedLegacy, false);
    assert.equal(
      vodRuntimeConfigNeedsPackageRootMigration(legacyConfig),
      true
    );
    assert.equal(
      vodRuntimeConfigNeedsPackageRootMigration(localConfig),
      false
    );
    assert.throws(
      () => validateVodRuntimeConfig({
        ...localConfig,
        ytDlp: { ...localConfig.ytDlp, version: "latest" }
      }, localPaths),
      /고정 artifact/u
    );
    assert.throws(
      () => validateVodRuntimeConfig({
        ...localConfig,
        gatewayPort: "4319"
      }, localPaths),
      /고정 artifact/u
    );
    assert.throws(
      () => validateVodRuntimeConfig({
        ...localConfig,
        installedAt: "2026-08-10"
      }, localPaths),
      /고정 artifact/u
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("gateway child 환경은 비밀을 제거하고 관리형 절대 도구와 Python PATH만 전달한다", () => {
  const config = fixtureConfig();
  const environment = managedVodRuntimeEnvironment(config, {
    baseEnvironment: {
      PATH: "/secret/path",
      HOME: "/home/private",
      NODE_OPTIONS: "--require /tmp/inject.js",
      YOUTUBE_COOKIE: "secret",
      PROVIDER_API_KEY: "secret",
      LANG: "ko_KR.UTF-8",
      TMPDIR: "/tmp"
    },
    nodeBinary: "/opt/node/bin/node",
    kind: "caption-vod",
    instanceNonce: TEST_INSTANCE_NONCE
  });
  assert.equal(environment.HOME, undefined);
  assert.equal(environment.NODE_OPTIONS, undefined);
  assert.equal(environment.YOUTUBE_COOKIE, undefined);
  assert.equal(environment.PROVIDER_API_KEY, undefined);
  assert.equal(environment.LANG, "ko_KR.UTF-8");
  assert.equal(environment.KIRINUKI_AUTO_PAIR, "1");
  assert.equal(environment.KIRINUKI_PACKAGE_ROOT, config.packageRoot);
  assert.equal(environment.KIRINUKI_EXTENSION_ROOT, undefined);
  assert.equal(environment.KIRINUKI_AGENT_PORT, "4319");
  assert.equal(environment.KIRINUKI_YT_DLP_BINARY, config.ytDlp.path);
  assert.equal(
    environment.KIRINUKI_YT_DLP_PYTHON_BINARY,
    config.python.path
  );
  assert.equal(environment.KIRINUKI_YT_DLP_NODE_BINARY, "/opt/node/bin/node");
  assert.equal(environment.KIRINUKI_FFMPEG_BINARY, config.ffmpeg.path);
  assert.equal(environment.KIRINUKI_FFPROBE_BINARY, config.ffprobe.path);
  assert.equal(environment.KIRINUKI_VOD_STATE_DIR, config.vodStateDir);
  assert.equal(environment.KIRINUKI_VOD_RUNTIME_SCHEMA, LOCAL_VOD_RUNTIME_SCHEMA);
  assert.equal(environment.KIRINUKI_VOD_RUNTIME_KIND, "caption-vod");
  assert.equal(environment.KIRINUKI_VOD_RUNTIME_READY, "1");
  assert.equal(environment.KIRINUKI_VOD_YT_DLP_VERSION, "2026.07.04");
  assert.equal(environment.KIRINUKI_VOD_EJS_VERSION, "0.8.0");
  assert.equal(environment.KIRINUKI_VOD_INSTANCE_NONCE, TEST_INSTANCE_NONCE);
  assert.match(String(environment.PATH), /^\/opt\/node\/bin:/u);
  assert.match(String(environment.PATH), /(?:^|:)\/opt\/python\/bin(?:$|:)/u);
  assert.doesNotMatch(String(environment.PATH), /secret/u);

  const manager = vodManagerEnvironment({
    XDG_DATA_HOME: "/tmp/kirinuki-vod-test/data",
    ACCESS_TOKEN: "secret",
    NODE_OPTIONS: "--inspect",
    LANG: "C.UTF-8"
  }, fixturePaths(), { instanceNonce: TEST_INSTANCE_NONCE });
  assert.equal(manager.XDG_DATA_HOME, "/tmp/kirinuki-vod-test/data");
  assert.equal(manager.ACCESS_TOKEN, undefined);
  assert.equal(manager.NODE_OPTIONS, undefined);
  assert.equal(manager.KIRINUKI_PACKAGE_ROOT, "/opt/kirinuki");
  assert.equal(manager.KIRINUKI_EXTENSION_ROOT, undefined);
  assert.equal(manager.KIRINUKI_VOD_INSTANCE_NONCE, TEST_INSTANCE_NONCE);
  assert.equal(createVodInstanceNonce().length, 43);
  assert.throws(
    () => managedVodRuntimeEnvironment(config, {
      instanceNonce: "short"
    }),
    /nonce/u
  );
});

test("health probe 계약은 exact Origin·protocol·schema·managed binding을 요구한다", () => {
  const config = fixtureConfig();
  const request = vodHealthRequest(config);
  assert.equal(request.host, "127.0.0.1");
  assert.equal(request.port, 4319);
  assert.equal(request.path, "/v1/health");
  assert.equal(request.headers.Origin, config.origin);
  assert.equal(request.headers["X-Kirinuki-Protocol"], VOD_REQUEST_SCHEMA);
  const payload = {
    schema: VOD_HEALTH_SCHEMA,
    status: "ok",
    managed: true,
    originBinding: KIRINUKI_GATEWAY_ORIGIN_BINDING,
    transcriptionMode: "local-whispercpp",
    vodRuntime: {
      schema: LOCAL_VOD_RUNTIME_SCHEMA,
      kind: "vod-only",
      ready: true,
      ytDlp: { version: PINNED_YT_DLP.version },
      ejs: { version: PINNED_YT_DLP.bundledJavascript.version },
      instanceNonce: TEST_INSTANCE_NONCE
    }
  };
  assert.equal(isManagedVodHealthPayload(payload), true);
  assert.equal(isManagedVodHealthPayload(payload, {
    instanceNonce: TEST_INSTANCE_NONCE,
    kind: "vod-only"
  }), true);
  for (const invalid of [
    { ...payload, schema: "foreign" },
    { ...payload, managed: false },
    { ...payload, originBinding: "wildcard" },
    { ...payload, status: "starting" },
    { ...payload, vodRuntime: undefined },
    {
      ...payload,
      vodRuntime: {
        ...payload.vodRuntime,
        schema: "foreign-runtime/v1"
      }
    },
    {
      ...payload,
      vodRuntime: {
        ...payload.vodRuntime,
        ytDlp: { version: "latest" }
      }
    },
    {
      ...payload,
      vodRuntime: {
        ...payload.vodRuntime,
        ejs: { version: "latest" }
      }
    },
    {
      ...payload,
      vodRuntime: {
        ...payload.vodRuntime,
        instanceNonce: "generic"
      }
    },
    null
  ]) {
    assert.equal(isManagedVodHealthPayload(invalid), false);
  }
  assert.equal(isManagedVodHealthPayload(payload, {
    instanceNonce: "ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210_-abcd"
  }), false);
  assert.equal(isManagedVodHealthPayload(payload, {
    kind: "caption-vod"
  }), false);
});

test("실제 toolchain probe 계약은 exact Python→yt-dlp와 ffmpeg 기능을 모두 요구한다", () => {
  const calls: Array<{ executable: string; args: readonly string[] }> = [];
  const runCommand = (executable: string, args: readonly string[]) => {
    calls.push({ executable, args });
    if (executable === "/opt/node/bin/node") {
      return { status: 0, stdout: "v22.18.0\n", stderr: "" };
    }
    if (executable === "/opt/python/bin/python3" && args.length === 1) {
      return { status: 0, stdout: "Python 3.12.4\n", stderr: "" };
    }
    if (executable === "/opt/python/bin/python3") {
      return { status: 0, stdout: "2026.07.04\n", stderr: "" };
    }
    if (executable === "/opt/media/bin/ffmpeg" && args[0] === "-version") {
      return { status: 0, stdout: "ffmpeg version 7.1.1\n", stderr: "" };
    }
    if (executable === "/opt/media/bin/ffmpeg" && args[1] === "-encoders") {
      return {
        status: 0,
        stdout: " V....D libx264 h264\n A....D aac AAC\n",
        stderr: ""
      };
    }
    if (executable === "/opt/media/bin/ffmpeg" && args[1] === "-muxers") {
      return { status: 0, stdout: "  E  mp4 MP4\n", stderr: "" };
    }
    return { status: 0, stdout: "ffprobe version 7.1.1\n", stderr: "" };
  };
  const inspection = inspectVodToolchain(fixtureConfig(), { runCommand });
  assert.equal(inspection.ready, true);
  assert.deepEqual(
    calls.find((call) => (
      call.executable === "/opt/python/bin/python3"
      && call.args.length === 3
    )),
    {
      executable: "/opt/python/bin/python3",
      args: ["-I", fixtureConfig().ytDlp.path, "--version"]
    }
  );

  const missingAac = inspectVodToolchain(fixtureConfig(), {
    runCommand: (executable, args) => {
      const result = runCommand(executable, args);
      return args[1] === "-encoders"
        ? { ...result, stdout: " V....D libx264 h264\n" }
        : result;
    }
  });
  assert.equal(missingAac.aacEncoder, false);
  assert.equal(missingAac.ready, false);
});

test("PID identity는 exact CLI·foreground·proc start tick·boot ID를 함께 요구한다", () => {
  const fields = ["S", ...Array.from({ length: 18 }, () => "0"), "987654", "0"];
  assert.equal(parseProcStartTime(`42 (node worker) ${fields.join(" ")}`), "987654");
  assert.equal(parseProcStartTime("invalid"), null);
  const expectedCli = "/opt/kirinuki/scripts/local-vod-runtime.ts";
  assert.equal(commandLineRunsExactVodCli({
    commandLine:
      `/usr/bin/node\0--import\0tsx\0${expectedCli}\0start\0--foreground\0`,
    processCwd: "/opt/kirinuki",
    expectedCliPath: expectedCli
  }), true);
  assert.equal(commandLineRunsExactVodCli({
    commandLine:
      `/usr/bin/node\0--import\0tsx\0${expectedCli}\0start\0`,
    processCwd: "/opt/kirinuki",
    expectedCliPath: expectedCli
  }), false);
  assert.equal(commandLineRunsExactVodCli({
    commandLine:
      "/usr/bin/node\0--import\0tsx\0/opt/foreign/local-vod-runtime.ts\0start\0--foreground\0",
    processCwd: "/opt/foreign",
    expectedCliPath: expectedCli
  }), false);

  const record = {
    schema: LOCAL_VOD_PID_SCHEMA,
    pid: 4242,
    command: "start",
    startedAt: "2026-08-10T00:00:00.000Z",
    procStartTime: "987654",
    bootId: "01234567-89ab-cdef-0123-456789abcdef",
    cliPath: expectedCli,
    instanceNonce: TEST_INSTANCE_NONCE
  } as const;
  assert.equal(validVodPidRecord(record, expectedCli), true);
  assert.equal(validVodPidRecord({ ...record, procStartTime: "bad" }, expectedCli), false);
  assert.equal(validVodPidRecord({ ...record, cliPath: "/opt/foreign.ts" }, expectedCli), false);
  assert.equal(validVodPidRecord({ ...record, instanceNonce: "generic" }, expectedCli), false);
  const identity = {
    schema: LOCAL_VOD_RUNTIME_SCHEMA,
    kind: "vod-only" as const,
    ready: true as const,
    ytDlp: { version: PINNED_YT_DLP.version },
    ejs: { version: PINNED_YT_DLP.bundledJavascript.version },
    instanceNonce: TEST_INSTANCE_NONCE
  } as const;
  assert.equal(vodGatewayOwnedByPid(identity, record), true);
  assert.equal(vodGatewayOwnedByPid({
    ...identity,
    kind: "caption-vod"
  }, record), false);
  assert.equal(vodGatewayOwnedByPid({
    ...identity,
    instanceNonce: "ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210_-abcd"
  }, record), false);
});

test("도움말은 managed artifact·loopback·무인증 계약을 드러낸다", () => {
  const text = helpText();
  assert.match(text, /yt-dlp 2026\.07\.04/u);
  assert.match(text, /127\.0\.0\.1:4319/u);
  assert.match(text, /쿠키·로그인·API 키/u);
  assert.match(text, /systemd 미사용/u);
});
