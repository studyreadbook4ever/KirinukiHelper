import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  KIRINUKI_LOCAL_STUDIO_ORIGIN,
  KIRINUKI_PUBLIC_STUDIO_ORIGIN,
  KIRINUKI_STUDIO_ORIGIN_PLACEHOLDER,
  assertKirinukiStudioDocumentOrigin,
  isKirinukiPublicStudioOrigin,
  resolveKirinukiAppOrigin,
  resolveKirinukiStudioOrigin
} from "../src/lib/local-runtime-origin.js";
import {
  KIRINUKI_WHISPER_CONNECTION_FILENAME,
  KIRINUKI_WHISPER_CONNECTION_SCHEMA,
  MAX_WHISPER_CONNECTION_JSON_BYTES,
  WHISPER_MODEL_CATALOG,
  WHISPER_MODEL_IDS,
  createWhisperConnectionDescriptor,
  parseWhisperConnectionDescriptor,
  parseWhisperConnectionJson,
  serializeWhisperConnectionDescriptor,
  whisperCaptionEndpoint
} from "../src/lib/whisper-connection.js";
import {
  PINNED_MODELS,
  createInstallConfig,
  resolveSemanticProfile,
  resolveStackPaths
} from "../scripts/local-caption-stack-core.js";
import { writeWhisperConnectionFile } from "../scripts/local-caption-stack.js";

const origin = KIRINUKI_LOCAL_STUDIO_ORIGIN;

test("Studio Origin 설정은 loopback 기본과 단 하나의 공개 opt-in만 허용한다", () => {
  assert.equal(resolveKirinukiStudioOrigin(), KIRINUKI_LOCAL_STUDIO_ORIGIN);
  assert.equal(
    resolveKirinukiStudioOrigin(KIRINUKI_PUBLIC_STUDIO_ORIGIN),
    KIRINUKI_PUBLIC_STUDIO_ORIGIN
  );
  for (const rejected of [
    "*",
    "https://eff0rtchung.kr",
    "https://kirinuki.eff0rtchung.kr/",
    "https://kirinuki.eff0rtchung.kr.attacker.example"
  ]) {
    assert.throws(() => resolveKirinukiStudioOrigin(rejected), /Origin/u);
  }
  assert.equal(
    assertKirinukiStudioDocumentOrigin(
      KIRINUKI_PUBLIC_STUDIO_ORIGIN,
      KIRINUKI_PUBLIC_STUDIO_ORIGIN
    ),
    KIRINUKI_PUBLIC_STUDIO_ORIGIN
  );
  assert.throws(
    () => assertKirinukiStudioDocumentOrigin(
      KIRINUKI_PUBLIC_STUDIO_ORIGIN,
      KIRINUKI_LOCAL_STUDIO_ORIGIN
    ),
    /설정이 다릅니다/u
  );
  assert.equal(
    assertKirinukiStudioDocumentOrigin(
      KIRINUKI_PUBLIC_STUDIO_ORIGIN,
      KIRINUKI_STUDIO_ORIGIN_PLACEHOLDER
    ),
    KIRINUKI_PUBLIC_STUDIO_ORIGIN,
    "Popovic 같은 정적 서버의 tracked web/은 exact 공개 Origin에서만 토큰을 자체 해석합니다."
  );
  assert.equal(
    assertKirinukiStudioDocumentOrigin(
      KIRINUKI_LOCAL_STUDIO_ORIGIN,
      KIRINUKI_STUDIO_ORIGIN_PLACEHOLDER
    ),
    KIRINUKI_LOCAL_STUDIO_ORIGIN
  );
  assert.throws(
    () => assertKirinukiStudioDocumentOrigin(
      "https://kirinuki.eff0rtchung.kr.attacker.example",
      KIRINUKI_STUDIO_ORIGIN_PLACEHOLDER
    ),
    /Origin/u
  );
  assert.equal(
    isKirinukiPublicStudioOrigin(KIRINUKI_PUBLIC_STUDIO_ORIGIN),
    true
  );
  assert.equal(
    isKirinukiPublicStudioOrigin(KIRINUKI_LOCAL_STUDIO_ORIGIN),
    false
  );
});

test("내부 미디어 엔진은 공개 문서 Origin을 절대 허용하지 않는다", () => {
  assert.equal(resolveKirinukiAppOrigin(), KIRINUKI_LOCAL_STUDIO_ORIGIN);
  assert.equal(
    resolveKirinukiAppOrigin(KIRINUKI_LOCAL_STUDIO_ORIGIN),
    KIRINUKI_LOCAL_STUDIO_ORIGIN
  );
  assert.throws(
    () => resolveKirinukiAppOrigin(KIRINUKI_PUBLIC_STUDIO_ORIGIN),
    /앱.*Origin/u
  );
});

function descriptor() {
  return createWhisperConnectionDescriptor({
    gatewayPort: 4319,
    origin,
    requestedProfile: "draft",
    effectiveProfile: "draft",
    backend: "cpu",
    modelId: "tiny-q5_1"
  });
}

test("Whisper 모델 catalog는 설치 가능한 네 모델의 이름과 실제 크기를 한곳에서 제공한다", () => {
  assert.deepEqual(WHISPER_MODEL_IDS, [
    "tiny-q5_1",
    "base-q5_1",
    "small-q5_1",
    "medium-q5_0"
  ]);
  for (const [profile, model] of Object.entries(PINNED_MODELS)) {
    const entry = WHISPER_MODEL_CATALOG[model.id];
    assert.equal(entry.profile, profile);
    assert.equal(entry.downloadSizeBytes, model.size);
    assert.match(entry.label, /Tiny|Base|Small|Medium/u);
    assert.match(entry.downloadSizeLabel, /^약 \d+ MB$/u);
    assert.ok(entry.purpose.length > 10);
  }
});

test("연결 JSON은 path와 비밀값 없이 exact loopback·Origin·실제 모델만 담는다", () => {
  const created = descriptor();
  const json = serializeWhisperConnectionDescriptor(created, origin);
  const parsed = parseWhisperConnectionJson(json, origin);
  assert.deepEqual(parsed, {
    schema: KIRINUKI_WHISPER_CONNECTION_SCHEMA,
    endpoint: "http://127.0.0.1:4319/v1/captions",
    origin,
    requestedProfile: "draft",
    effectiveProfile: "draft",
    backend: "cpu",
    modelId: "tiny-q5_1"
  });
  assert.deepEqual(Object.keys(JSON.parse(json) as object).sort(), [
    "backend",
    "effectiveProfile",
    "endpoint",
    "modelId",
    "origin",
    "requestedProfile",
    "schema"
  ]);
  assert.doesNotMatch(
    json,
    /(?:binary|modelPath|sourceDir|buildRoot|sha256|api[_-]?key|token|secret|password)/iu
  );
  assert.doesNotMatch(json, /\/(?:home|opt|tmp|Users)\//u);
  assert.equal(Object.isFrozen(parsed), true);
});

test("공개 페이지는 Whisper 연결 파일을 만들 수 없다", () => {
  assert.throws(() => createWhisperConnectionDescriptor({
    gatewayPort: 4319,
    origin: KIRINUKI_PUBLIC_STUDIO_ORIGIN,
    requestedProfile: "draft",
    effectiveProfile: "draft",
    backend: "cpu",
    modelId: "tiny-q5_1"
  }), /설치된 Kirinuki 앱/u);
});

test("연결 parser는 외부 주소·다른 Origin·추가 필드·모델 불일치를 fail-closed한다", () => {
  const valid = descriptor();
  for (const endpoint of [
    "https://127.0.0.1:4319/v1/captions",
    "http://localhost:4319/v1/captions",
    "http://0.0.0.0:4319/v1/captions",
    "http://127.0.0.1:4319/v1/captions?token=x",
    "http://127.0.0.1:4319/v1/captions#x",
    "http://127.0.0.1:65536/v1/captions"
  ]) {
    assert.throws(
      () => parseWhisperConnectionDescriptor({ ...valid, endpoint }, origin),
      /127\.0\.0\.1/u
    );
  }
  assert.throws(
    () => parseWhisperConnectionDescriptor(
      valid,
      "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    ),
    /설치된 Kirinuki 앱/u
  );
  assert.throws(
    () => parseWhisperConnectionDescriptor({
      ...valid,
      token: "do-not-accept"
    }, origin),
    /필드 구성/u
  );
  assert.throws(
    () => parseWhisperConnectionDescriptor({
      ...valid,
      effectiveProfile: "quality"
    }, origin),
    /profile과 모델/u
  );
  assert.throws(
    () => parseWhisperConnectionDescriptor({
      ...valid,
      requestedProfile: "quality"
    }, origin),
    /요청 profile과 실제 profile/u
  );
});

test("연결 JSON parser는 잘못된 JSON과 과도한 파일을 읽지 않는다", () => {
  assert.throws(
    () => parseWhisperConnectionJson("{", origin),
    /올바른 JSON/u
  );
  assert.throws(
    () => parseWhisperConnectionJson(
      "x".repeat(MAX_WHISPER_CONNECTION_JSON_BYTES + 1),
      origin
    ),
    /크기를 초과/u
  );
  assert.throws(() => whisperCaptionEndpoint(0), /1~65535/u);
  assert.throws(() => whisperCaptionEndpoint(65_536), /1~65535/u);
});

test("setup용 writer는 config root의 안정된 이름에 연결 파일을 원자적으로 만든다", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-whisper-"));
  context.after(async () => {
    await rm(temporaryRoot, { recursive: true, force: true });
  });
  const paths = resolveStackPaths({
    env: {
      XDG_DATA_HOME: path.join(temporaryRoot, "data"),
      XDG_CONFIG_HOME: path.join(temporaryRoot, "config"),
      XDG_STATE_HOME: path.join(temporaryRoot, "state"),
      XDG_RUNTIME_DIR: path.join(temporaryRoot, "run")
    },
    homeDir: path.join(temporaryRoot, "home"),
    packageRoot: path.join(temporaryRoot, "package")
  });
  assert.equal(
    paths.connectionPath,
    path.join(
      temporaryRoot,
      "config",
      "kirinuki-caption-stack",
      KIRINUKI_WHISPER_CONNECTION_FILENAME
    )
  );
  const config = createInstallConfig(
    paths,
    resolveSemanticProfile("quality", {
      platform: "linux",
      cpuCount: 8,
      totalMemoryBytes: 16 * 1024 ** 3,
      nvidiaDetected: false,
      nvccAvailable: false
    }, "cpu")
  );
  await writeWhisperConnectionFile(paths, config);
  const json = await readFile(paths.connectionPath, "utf8");
  const parsed = parseWhisperConnectionJson(json, config.origin);
  assert.equal(parsed.modelId, "medium-q5_0");
  assert.equal(parsed.endpoint, whisperCaptionEndpoint(config.gatewayPort));
  const connectionMetadata = await stat(paths.connectionPath);
  assert.equal(connectionMetadata.isFile(), true);
  if (process.platform !== "win32") {
    assert.equal(connectionMetadata.mode & 0o777, 0o600);
  }
  assert.deepEqual(
    await readdir(paths.configRoot),
    [KIRINUKI_WHISPER_CONNECTION_FILENAME]
  );
});
