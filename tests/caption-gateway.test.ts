import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  KIRINUKI_GATEWAY_ORIGIN_BINDING,
  KIRINUKI_LOCAL_STUDIO_ORIGIN
} from "../src/lib/local-runtime-origin.js";
import {
  LOCAL_MEDIA_ENGINE_API_PROTOCOL,
  LOCAL_MEDIA_ENGINE_DEVELOPMENT_VERSION,
  LOCAL_MEDIA_ENGINE_HEALTH_PROTOCOL,
  LOCAL_MEDIA_ENGINE_PRODUCT
} from "../src/lib/local-media-engine-contract.js";
import {
  Agent,
  request as httpRequest,
  type ClientRequest,
  type IncomingHttpHeaders,
  type OutgoingHttpHeaders
} from "node:http";
import test, { type TestContext } from "node:test";
import {
  createConnection,
  createServer as createNetServer
} from "node:net";
import type { AddressInfo, Socket } from "node:net";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  CAPTION_AGENT_REQUEST_SCHEMA_ID,
  CAPTION_AGENT_RESPONSE_SCHEMA_ID,
  CAPTION_CUE_DURATION_POLICY,
  LOCAL_WHISPER_CAPTION_MODEL,
  SUPPORTED_CAPTION_MODELS,
  validateCaptionAgentRequest
} from "../src/caption-agent/protocol.js";
import {
  CAPTION_HARNESS_FINGERPRINT,
  CAPTION_QUALITY_PROFILE_ID
} from "../src/caption-agent/caption-quality-harness.js";
import {
  DEFAULT_PIPELINE_TIMEOUT_MS,
  LOCAL_WHISPERCPP_TRANSCRIPTION_MODE,
  MAX_STT_SEGMENTS,
  MAX_STT_WORDS,
  MAX_TRANSCRIPT_BYTES,
  buildLocalWhisperCaptionDraft,
  normalizeCaptionModel,
  normalizeSttTranscript,
  requestLocalWhisperTranscription,
  resolveCaptionPipelineConfig,
  resolveCaptionPipelineRequestConfig,
  runCaptionPipeline
} from "../src/caption-agent/caption-gateway-core.js";
import {
  CAPTION_AGENT_CAPABILITY_SCHEMA_ID,
  CAPTION_AGENT_HEALTH_SCHEMA_ID,
  CAPTION_AGENT_SESSION_SCHEMA_ID,
  DEFAULT_CAPTION_REQUEST_BODY_TIMEOUT_MS,
  DEFAULT_MAX_CONCURRENT_CAPTION_PIPELINES,
  KIRINUKI_PUBLIC_STUDIO_ORIGIN,
  LOCAL_ENGINE_CAPABILITY_ABSOLUTE_TTL_MS,
  LOCAL_ENGINE_CAPABILITY_IDLE_TTL_MS,
  LOCAL_ENGINE_SESSION_REQUEST_SCHEMA_ID,
  MAX_CAPTION_REQUEST_BODY_TIMEOUT_MS,
  MAX_CONCURRENT_CAPTION_PIPELINES,
  MAX_LOCAL_ENGINE_CAPABILITIES,
  MAX_LOCAL_ENGINE_SESSION_REQUEST_BYTES,
  createCaptionGatewayServer,
  resolveCaptionGatewayConfig,
  startCaptionGateway
} from "../scripts/caption-gateway.js";
import {
  LOCAL_VOD_RUNTIME_SCHEMA,
  PINNED_YT_DLP
} from "../scripts/local-vod-runtime-core.js";
import {
  CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA,
  CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
} from "../scripts/chzzk-vod-job-manager.js";

const ALLOWED_ORIGIN = KIRINUKI_LOCAL_STUDIO_ORIGIN;
const AGENT_TOKEN = Buffer.alloc(32, 5).toString("base64url");
const LOCAL_STT_ENDPOINT =
  "http://127.0.0.1:4318/kirinuki-test/inference";
const VOD_INSTANCE_NONCE =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

const TEST_ENV = Object.freeze({
  KIRINUKI_STT_MODE: LOCAL_WHISPERCPP_TRANSCRIPTION_MODE,
  KIRINUKI_STT_ENDPOINT: LOCAL_STT_ENDPOINT,
  KIRINUKI_STT_MODEL: "tiny-q5_1",
  KIRINUKI_AGENT_TOKEN: AGENT_TOKEN,
  KIRINUKI_ALLOWED_ORIGIN: ALLOWED_ORIGIN,
  KIRINUKI_MAX_AUDIO_BYTES: "1048576",
  KIRINUKI_VOD_RUNTIME_SCHEMA: LOCAL_VOD_RUNTIME_SCHEMA,
  KIRINUKI_VOD_RUNTIME_KIND: "caption-vod",
  KIRINUKI_VOD_RUNTIME_READY: "1",
  KIRINUKI_VOD_YT_DLP_VERSION: PINNED_YT_DLP.version,
  KIRINUKI_VOD_EJS_VERSION: PINNED_YT_DLP.bundledJavascript.version,
  KIRINUKI_VOD_INSTANCE_NONCE: VOD_INSTANCE_NONCE,
  KIRINUKI_VOD_STATE_DIR: path.join(
    tmpdir(),
    "kirinuki-caption-gateway-test-vod-state"
  )
});

interface GatewayBody {
  [key: string]: unknown;
  schema: string;
  token: string;
  provider: string;
  availableModels: string[];
  configured: Record<string, unknown>;
  transcription: Record<string, unknown>;
  qualityHarness: Record<string, unknown>;
  error: { code: string };
}

interface LocalHttpJsonOptions {
  agent?: Agent;
  port: number;
  path?: string;
  method?: string;
  headers?: OutgoingHttpHeaders;
  body?: unknown;
  onSocket?: (socket: Socket) => void;
}

interface LocalHttpJsonResult {
  status: number | undefined;
  headers: IncomingHttpHeaders;
  body: GatewayBody;
}

interface TestCapability {
  clientNonce: string;
  projectId: string;
  token: string;
}

let testCapabilityCounter = 0;
const testCapabilities = new Map<number, Map<string, TestCapability>>();
const testJobCapabilities = new Map<string, TestCapability>();

function testCapabilityNonce(label: string): string {
  testCapabilityCounter += 1;
  return createHash("sha256")
    .update(`${label}:${testCapabilityCounter}`, "utf8")
    .digest("base64url");
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === code
  );
}

async function withReferencedDeadline<T>(
  operation: Promise<T>,
  timeoutMs = 1_000
): Promise<T> {
  let watchdog: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    watchdog = setTimeout(() => {
      reject(new Error(`테스트 작업이 ${timeoutMs}ms 안에 끝나지 않았습니다.`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(watchdog);
  }
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 1_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`조건이 ${timeoutMs}ms 안에 충족되지 않았습니다.`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

function testWavBase64() {
  const wav = Buffer.alloc(44);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16_000, 24);
  wav.writeUInt32LE(32_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(0, 40);
  return wav.toString("base64");
}

function captionRequest(overrides: Record<string, unknown> = {}) {
  return {
    schema: CAPTION_AGENT_REQUEST_SCHEMA_ID,
    requestId: "gateway-request-1",
    model: LOCAL_WHISPER_CAPTION_MODEL,
    locale: "ko-KR",
    clip: {
      id: "gateway-clip-1",
      title: "게이트웨이 테스트 컷",
      durationMs: 8_000
    },
    source: {
      projectId: "gateway-project-1",
      projectName: "게이트웨이 테스트",
      streamerName: "테스트 VTuber"
    },
    policy: {
      audience: "korean-vtuber-kirinuki",
      includeAllRecognizableSpeech: true,
      uncertainSpeech: "keep-and-mark-for-review",
      cueDurationPolicy: CAPTION_CUE_DURATION_POLICY,
      terminalPeriod: "omit",
      questionAndExclamationMarks: "keep"
    },
    audio: {
      encoding: "base64",
      mimeType: "audio/wav",
      sampleRateHz: 16_000,
      channels: 1,
      data: testWavBase64()
    },
    ...overrides
  };
}

function normalizedCaptionRequest(overrides: Record<string, unknown> = {}) {
  return validateCaptionAgentRequest(captionRequest(overrides));
}

function jsonResponse(
  value: unknown,
  status = 200,
  headers: HeadersInit = {}
) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers
    }
  });
}

function rawLocalHttpJson({
  agent,
  port,
  path = "/v1/captions",
  method = "GET",
  headers = {},
  body,
  onSocket
}: LocalHttpJsonOptions) {
  return new Promise<LocalHttpJsonResult>((resolve, reject) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      path,
      method,
      headers,
      ...(agent ? { agent } : {})
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let payload = {} as GatewayBody;
        if (text) {
          try {
            payload = JSON.parse(text) as GatewayBody;
          } catch {
            payload = { raw: text } as unknown as GatewayBody;
          }
        }
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: payload
        });
      });
    });
    if (onSocket) {
      request.once("socket", onSocket);
    }
    request.once("error", reject);
    if (body != null) {
      request.write(
        typeof body === "string" ? body : JSON.stringify(body)
      );
    }
    request.end();
  });
}

async function rawSocketResponse(
  port: number,
  requestLines: readonly string[]
): Promise<string> {
  const socket = createConnection({ host: "127.0.0.1", port });
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const completed = new Promise<string>((resolve, reject) => {
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.once("error", reject);
    socket.once("close", () => resolve(
      Buffer.concat(chunks).toString("latin1")
    ));
  });
  socket.end([...requestLines, "", ""].join("\r\n"));
  return await completed;
}

function requestBodyRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    if (typeof value !== "string") {
      return null;
    }
    try {
      const parsed = JSON.parse(value) as unknown;
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
  return value as Record<string, unknown>;
}

async function issueTestCapability(
  port: number,
  projectId: string = "gateway-project-1",
  actions: readonly string[] = ["vod", "captions", "cache-delete"],
  sourceUrl?: string
): Promise<TestCapability> {
  const resolvedSourceUrl = sourceUrl ?? (
    actions.includes("vod")
      ? "https://chzzk.naver.com/video/14252987"
      : undefined
  );
  let byProject = testCapabilities.get(port);
  if (!byProject) {
    byProject = new Map();
    testCapabilities.set(port, byProject);
  }
  const key = `${projectId}\0${actions.join(",")}\0${resolvedSourceUrl || ""}`;
  const existing = byProject.get(key);
  if (existing) {
    return existing;
  }
  const clientNonce = testCapabilityNonce(`${port}:${projectId}`);
  const response = await rawLocalHttpJson({
    port,
    path: "/v1/session",
    method: "POST",
    headers: {
      Origin: ALLOWED_ORIGIN,
      "Content-Type": "application/json",
      "X-Kirinuki-Client-Nonce": clientNonce,
      "X-Kirinuki-Protocol": LOCAL_ENGINE_SESSION_REQUEST_SCHEMA_ID
    },
    body: {
      schema: LOCAL_ENGINE_SESSION_REQUEST_SCHEMA_ID,
      clientNonce,
      projectId,
      actions,
      ...(resolvedSourceUrl === undefined
        ? {}
        : { sourceUrl: resolvedSourceUrl })
    }
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const capability = {
    clientNonce,
    projectId,
    token: String(response.body.token || "")
  };
  byProject.set(key, capability);
  return capability;
}

async function localHttpJson(
  options: LocalHttpJsonOptions
): Promise<LocalHttpJsonResult> {
  const headers = { ...(options.headers || {}) };
  const suppliedAuthorization = String(
    headers.Authorization ?? headers.authorization ?? ""
  );
  let selectedCapability: TestCapability | null = null;
  if (suppliedAuthorization === `Bearer ${AGENT_TOKEN}`) {
    const jobMatch = /^\/v1\/(?:chzzk-vod|vod)\/materializations\/([a-zA-Z0-9_-]{16,128})/u
      .exec(options.path || "/v1/captions");
    const record = requestBodyRecord(options.body);
    const source = record?.source;
    const projectId = typeof record?.consumerId === "string"
      ? record.consumerId
      : typeof source === "object"
        && source !== null
        && !Array.isArray(source)
        && typeof (source as Record<string, unknown>).projectId === "string"
        ? String((source as Record<string, unknown>).projectId)
        : jobMatch
          ? testJobCapabilities.get(`${options.port}:${jobMatch[1]}`)?.projectId
            || "gateway-project-1"
          : "gateway-project-1";
    selectedCapability = jobMatch
      ? testJobCapabilities.get(`${options.port}:${jobMatch[1]}`) || null
      : null;
    selectedCapability ??= await issueTestCapability(options.port, projectId);
    if (Object.hasOwn(headers, "authorization")) {
      headers.authorization = `Bearer ${selectedCapability.token}`;
    } else {
      headers.Authorization = `Bearer ${selectedCapability.token}`;
    }
    headers["X-Kirinuki-Client-Nonce"] = selectedCapability.clientNonce;
  }
  const result = await rawLocalHttpJson({ ...options, headers });
  if (
    selectedCapability
    && options.method === "POST"
    && /^\/v1\/(?:chzzk-vod|vod)\/materializations$/u.test(
      options.path || ""
    )
    && result.status === 202
    && typeof result.body.jobId === "string"
  ) {
    testJobCapabilities.set(
      `${options.port}:${result.body.jobId}`,
      selectedCapability
    );
  }
  return result;
}

async function partialCaptionHttpRequest(
  port: number,
  partialBody: string = "{"
) {
  const capability = await issueTestCapability(port);
  // Promise executors run synchronously, so this is assigned before return.
  let pendingRequest!: ClientRequest;
  const response = new Promise<LocalHttpJsonResult>((resolve, reject) => {
    pendingRequest = httpRequest({
      host: "127.0.0.1",
      port,
      path: "/v1/captions",
      method: "POST",
      headers: {
        Origin: ALLOWED_ORIGIN,
        Authorization: `Bearer ${capability.token}`,
        "Content-Type": "application/json",
        "Content-Length": "4096",
        "X-Kirinuki-Client-Nonce": capability.clientNonce
      }
    }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk) => chunks.push(chunk));
      incoming.once("error", reject);
      incoming.once("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: incoming.statusCode,
          headers: incoming.headers,
          body: text
            ? JSON.parse(text) as GatewayBody
            : {} as GatewayBody
        });
      });
    });
    pendingRequest.once("error", reject);
    pendingRequest.write(partialBody);
  });
  return { request: pendingRequest, response };
}

async function listenTestServer(
  t: TestContext,
  options: Parameters<typeof createCaptionGatewayServer>[0]
) {
  const runtime = createCaptionGatewayServer(options);
  const { server, config } = runtime;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = (address as AddressInfo).port;
  t.after(() => {
    testCapabilities.delete(port);
    for (const key of testJobCapabilities.keys()) {
      if (key.startsWith(`${port}:`)) {
        testJobCapabilities.delete(key);
      }
    }
  });
  return {
    runtime,
    server,
    config,
    port
  };
}

test("프로토콜과 게이트웨이는 로컬 Whisper 모델 하나만 지원한다", () => {
  assert.deepEqual(SUPPORTED_CAPTION_MODELS, ["whisper-tiny"]);
  assert.equal(normalizeCaptionModel(undefined), "whisper-tiny");
  assert.equal(normalizeCaptionModel("whisper-tiny"), "whisper-tiny");
  assert.throws(
    () => normalizeCaptionModel("remote-model"),
    (error) => hasErrorCode(error, "UNSUPPORTED_CAPTION_MODEL")
  );
});

test("파이프라인 설정은 loopback whisper.cpp 주소만 허용한다", () => {
  const config = resolveCaptionPipelineConfig(TEST_ENV);
  assert.equal(
    config.transcriptionMode,
    LOCAL_WHISPERCPP_TRANSCRIPTION_MODE
  );
  assert.equal(config.sttEndpoint, LOCAL_STT_ENDPOINT);
  assert.equal(config.sttModel, "tiny-q5_1");
  assert.equal(config.pipelineTimeoutMs, DEFAULT_PIPELINE_TIMEOUT_MS);
  assert.equal(
    resolveCaptionPipelineRequestConfig(config).sttEndpoint,
    LOCAL_STT_ENDPOINT
  );

  for (const invalidEndpoint of [
    "https://stt.example/v1/transcriptions",
    "http://192.168.0.10:4318/inference",
    "http://user:pass@127.0.0.1:4318/inference",
    "http://127.0.0.1:4318/inference?key=value",
    "http://127.0.0.1:4318/inference#fragment"
  ]) {
    assert.throws(
      () => resolveCaptionPipelineConfig({
        ...TEST_ENV,
        KIRINUKI_STT_ENDPOINT: invalidEndpoint
      }),
      (error) => hasErrorCode(error, "INVALID_CONFIGURATION")
    );
  }
  assert.throws(
    () => resolveCaptionPipelineConfig({
      ...TEST_ENV,
      KIRINUKI_STT_MODE: "remote-stt"
    }),
    (error) => hasErrorCode(error, "UNSUPPORTED_TRANSCRIPTION_MODE")
  );
});

test("브라우저 요청은 전사 제공자 설정을 덮어쓸 수 없다", () => {
  const config = resolveCaptionPipelineConfig(TEST_ENV);
  for (const overrides of [
    { sttEndpoint: LOCAL_STT_ENDPOINT },
    { sttModel: "different-model" },
    { sttApiKey: "not-supported" },
    { providerKey: "not-supported" }
  ]) {
    assert.throws(
      () => resolveCaptionPipelineRequestConfig(config, overrides),
      (error) => (
        hasErrorCode(error, "RUNTIME_PROVIDER_OVERRIDE_UNSUPPORTED")
      )
    );
  }
});

test("Whisper segment·word 시각을 클립 기준 정수 밀리초로 정규화한다", () => {
  const transcript = normalizeSttTranscript({
    text: "안녕 반가워",
    words: [
      { start_ms: 120, end_ms: 610, word: "안녕" },
      { start_ms: 3_950, end_ms: 4_500, word: "반가워" }
    ],
    segments: [{
      start: -0.1,
      end: 3.9,
      text: " 안녕 ",
      speaker: "main"
    }, {
      start: 3.9,
      end: 9.2,
      text: "반가워"
    }]
  }, {
    clipDurationMs: 8_000
  });

  assert.deepEqual(transcript.segments, [
    {
      startMs: 0,
      endMs: 3_900,
      text: "안녕",
      speaker: "main"
    },
    { startMs: 3_900, endMs: 8_000, text: "반가워" }
  ]);
  assert.deepEqual(transcript.words, [
    { startMs: 120, endMs: 610, text: "안녕" },
    { startMs: 3_950, endMs: 4_500, text: "반가워" }
  ]);
});

test("Whisper segment와 nested word가 다른 시간축이면 조용히 보정하지 않는다", () => {
  assert.throws(
    () => normalizeSttTranscript({
      text: "시간축 충돌",
      segments: [{
        start: 8,
        end: 9,
        text: "시간축 충돌",
        words: [{ start: 1, end: 2, word: "시간축 충돌" }]
      }]
    }, {
      clipDurationMs: 10_000
    }),
    (error) => hasErrorCode(error, "STT_TIMESTAMP_CLOCK_MISMATCH")
  );

  const transcript = normalizeSttTranscript({
    text: "같은 시간축",
    segments: [{
      start: 1,
      end: 2,
      text: "같은 시간축",
      words: [{ start: 1.1, end: 1.9, word: "같은 시간축" }]
    }]
  }, {
    clipDurationMs: 10_000
  });
  assert.equal(transcript.segments.length, 1);
  assert.equal(transcript.words.length, 1);
});

test("시간 없는 텍스트와 과도한 전사 배열·본문은 거절한다", () => {
  assert.throws(
    () => normalizeSttTranscript(
      { text: "시간 없는 텍스트" },
      { clipDurationMs: 1_000 }
    ),
    (error) => hasErrorCode(error, "TIMED_TRANSCRIPT_REQUIRED")
  );
  assert.throws(
    () => normalizeSttTranscript({
      segments: Array.from(
        { length: MAX_STT_SEGMENTS + 1 },
        () => ({ start: 0, end: 0.1, text: "어" })
      )
    }, {
      clipDurationMs: 1_000
    }),
    (error) => hasErrorCode(error, "STT_RESPONSE_TOO_LARGE")
  );
  assert.throws(
    () => normalizeSttTranscript({
      words: Array.from(
        { length: MAX_STT_WORDS + 1 },
        () => ({ start: 0, end: 0.1, word: "어" })
      )
    }, {
      clipDurationMs: 1_000
    }),
    (error) => hasErrorCode(error, "STT_RESPONSE_TOO_LARGE")
  );
  assert.throws(
    () => normalizeSttTranscript({
      segments: [{
        start: 0,
        end: 1,
        text: "가".repeat(MAX_TRANSCRIPT_BYTES)
      }]
    }, {
      clipDurationMs: 1_000
    }),
    (error) => hasErrorCode(error, "STT_TRANSCRIPT_TOO_LARGE")
  );
});

test("로컬 Whisper 요청은 loopback에 WAV를 한 번 보내고 인증 헤더를 만들지 않는다", async () => {
  let calls = 0;
  const transcript = await requestLocalWhisperTranscription(
    normalizedCaptionRequest(),
    {
      sttEndpoint: LOCAL_STT_ENDPOINT,
      sttModel: "tiny-q5_1",
      wavBytes: Buffer.from(testWavBase64(), "base64"),
      fetchImpl: async (url, init) => {
        calls += 1;
        assert.ok(init);
        assert.equal(String(url), LOCAL_STT_ENDPOINT);
        assert.equal(init.method, "POST");
        assert.equal(init.redirect, "error");
        assert.equal(
          new Headers(init.headers).has("authorization"),
          false
        );
        assert(init.body instanceof FormData);
        assert.equal(init.body.get("model"), "tiny-q5_1");
        assert.equal(init.body.get("language"), "ko");
        assert.equal(init.body.get("vad"), "false");
        assert.deepEqual(
          init.body.getAll("timestamp_granularities[]"),
          ["segment", "word"]
        );
        return jsonResponse({
          text: "로컬 전사",
          segments: [{
            start: 0.1,
            end: 0.8,
            text: "로컬 전사"
          }]
        });
      }
    }
  );
  assert.equal(calls, 1);
  const [segment] = transcript.segments;
  assert.ok(segment);
  assert.equal(segment.text, "로컬 전사");

  let remoteCalls = 0;
  await assert.rejects(
    requestLocalWhisperTranscription(
      normalizedCaptionRequest(),
      {
        sttEndpoint: "https://stt.example/v1/transcriptions",
        fetchImpl: async () => {
          remoteCalls += 1;
          return jsonResponse({});
        }
      }
    ),
    (error) => hasErrorCode(error, "INVALID_CONFIGURATION")
  );
  assert.equal(remoteCalls, 0);
});

test("로컬 Whisper 응답 오류·큰 본문·timeout을 안전한 코드로 바꾼다", async () => {
  const request = normalizedCaptionRequest();
  await assert.rejects(
    requestLocalWhisperTranscription(request, {
      sttEndpoint: LOCAL_STT_ENDPOINT,
      fetchImpl: async () => jsonResponse(
        { error: "failed" },
        500
      )
    }),
    (error) => hasErrorCode(error, "STT_REQUEST_FAILED")
  );
  await assert.rejects(
    requestLocalWhisperTranscription(request, {
      sttEndpoint: LOCAL_STT_ENDPOINT,
      fetchImpl: async () => jsonResponse(
        { ok: true },
        200,
        { "content-length": String(20 * 1024 * 1024) }
      )
    }),
    (error) => hasErrorCode(error, "STT_RESPONSE_TOO_LARGE")
  );
  await assert.rejects(
    withReferencedDeadline(requestLocalWhisperTranscription(request, {
      sttEndpoint: LOCAL_STT_ENDPOINT,
      timeoutMs: 5,
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
        const signal = init?.signal;
        assert.ok(signal);
        signal.addEventListener("abort", () => {
          reject(signal.reason);
        }, { once: true });
      })
    })),
    (error) => hasErrorCode(error, "STT_TIMEOUT")
  );
});

test("로컬 초벌은 STT 경계와 품질 하네스 계약을 보존한다", () => {
  const request = normalizedCaptionRequest();
  const result = buildLocalWhisperCaptionDraft(request, {
    text: "안녕 반가워?",
    segments: [{
      startMs: 100,
      endMs: 1_100,
      text: "안녕"
    }, {
      startMs: 1_200,
      endMs: 2_500,
      text: "반가워?"
    }],
    words: []
  });
  assert.equal(result.cues.length, 2);
  assert.deepEqual(
    result.cues.map(({ startMs, endMs, text }) => ({
      startMs,
      endMs,
      text
    })),
    [
      { startMs: 100, endMs: 1_100, text: "안녕" },
      { startMs: 1_200, endMs: 2_500, text: "반가워?" }
    ]
  );
  assert(result.cues.every((cue) => cue.placement === "bottom"));
  assert.equal(result.qualityProfile, CAPTION_QUALITY_PROFILE_ID);
  assert.equal(
    result.harnessFingerprint,
    CAPTION_HARNESS_FINGERPRINT
  );
});

test("로컬 초벌은 4초를 넘는 Whisper 원본 segment를 그대로 보존한다", () => {
  const text = "한식비페에서 제육볶음 먹고 왔어. 잘했지?";
  const wordRanges: Array<[number, number, string]> = [
    [0, 420, "한"],
    [420, 840, "식"],
    [840, 1_260, "비"],
    [1_260, 1_680, "페"],
    [1_680, 2_530, "에서"],
    [2_530, 2_950, "제"],
    [2_950, 3_360, "육"],
    [3_370, 3_540, "�"],
    [3_660, 3_790, "�"],
    [3_790, 4_210, "음"],
    [4_210, 5_060, "먹고"],
    [5_060, 5_480, "왔"],
    [5_480, 5_840, "어"],
    [6_410, 6_560, "잘"],
    [6_560, 6_690, "했"],
    [6_890, 7_120, "지"],
    [7_120, 7_440, "?"]
  ];
  const request = normalizedCaptionRequest({
    clip: {
      id: "gateway-clip-duration-regression",
      title: "실제 Whisper 경계 회귀 컷",
      durationMs: 8_911
    }
  });
  const result = buildLocalWhisperCaptionDraft(request, {
    text,
    segments: [{ startMs: 140, endMs: 7_940, text }],
    words: wordRanges.map(([startMs, endMs, word]) => ({
      startMs,
      endMs,
      text: word
    }))
  });

  assert.deepEqual(
    result.cues.map(({ startMs, endMs }) => ({ startMs, endMs })),
    [{ startMs: 140, endMs: 7_940 }]
  );
  const [longCue] = result.cues;
  assert.ok(longCue);
  assert.equal(longCue.endMs - longCue.startMs, 7_800);
  assert.equal(result.qualityReport.disposition, "accepted");
});

test("파이프라인은 로컬 전사를 한 번 실행하고 Whisper 응답만 만든다", async () => {
  let calls = 0;
  const observed: {
    options?: Record<string, unknown>;
  } = {};
  const result = await runCaptionPipeline(captionRequest(), {
    ...resolveCaptionPipelineConfig(TEST_ENV),
    transcribeAudio: async (_request, options) => {
      calls += 1;
      observed.options = options as unknown as Record<string, unknown>;
      return {
        text: "테스트입니다",
        segments: [{
          start: 0.25,
          end: 1.5,
          text: "테스트입니다."
        }]
      };
    }
  });
  assert.equal(calls, 1);
  assert.ok(observed.options);
  assert.equal(observed.options.sttEndpoint, LOCAL_STT_ENDPOINT);
  assert.equal(Object.hasOwn(observed.options, "sttApiKey"), false);
  assert.equal(result.schema, CAPTION_AGENT_RESPONSE_SCHEMA_ID);
  assert.equal(result.captionModel, "whisper-tiny");
  assert.equal(result.provider, "local-whispercpp");
  assert.equal(result.sttModel, "tiny-q5_1");
  assert.equal(result.resolvedModel, "tiny-q5_1");
  const [cue] = result.cues;
  assert.ok(cue);
  assert.equal(cue.text, "테스트입니다");
  assert.equal(cue.placement, "bottom");
});

test("발화가 없는 로컬 전사는 review-required 빈 결과로 완료한다", async () => {
  const result = await runCaptionPipeline(captionRequest(), {
    ...resolveCaptionPipelineConfig(TEST_ENV),
    transcribeAudio: async () => ({
      text: "",
      segments: [],
      words: []
    })
  });
  assert.deepEqual(result.cues, []);
  assert.deepEqual(result.warnings, [{
    code: "NO_RECOGNIZABLE_SPEECH",
    cueIndex: 0
  }]);
  assert.equal(result.qualityReport.disposition, "review-required");
  assert.equal(result.provider, "local-whispercpp");
});

test("잘못된 모델은 전사 전에 막고 전체 deadline은 진행 중 전사를 중단한다", async () => {
  let transcribeCalls = 0;
  await assert.rejects(
    runCaptionPipeline(captionRequest({
      model: "unsupported-model"
    }), {
      transcribeAudio: async () => {
        transcribeCalls += 1;
      }
    }),
    (error) => hasErrorCode(error, "INVALID_REQUEST_FIELD")
  );
  assert.equal(transcribeCalls, 0);

  const transcribeSignal: { current?: AbortSignal } = {};
  await assert.rejects(
    withReferencedDeadline(runCaptionPipeline(captionRequest(), {
      pipelineTimeoutMs: 5,
      transcribeAudio: async (_request, options) => {
        const { signal } = options;
        assert.ok(signal);
        transcribeSignal.current = signal;
        await new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(signal.reason);
          }, { once: true });
        });
      }
    })),
    (error) => hasErrorCode(error, "PIPELINE_TIMEOUT")
  );
  assert.equal(transcribeSignal.current?.aborted, true);
});

test("게이트웨이 설정은 exact Origin과 세션 인증을 강제한다", () => {
  const config = resolveCaptionGatewayConfig(TEST_ENV);
  assert.equal(config.allowedOrigin, ALLOWED_ORIGIN);
  assert.equal(config.engineVersion, LOCAL_MEDIA_ENGINE_DEVELOPMENT_VERSION);
  assert.equal(config.backgroundStart, "ready");
  assert.equal(config.pipeline.sttEndpoint, LOCAL_STT_ENDPOINT);
  assert.equal(
    config.maxConcurrentCaptionPipelines,
    DEFAULT_MAX_CONCURRENT_CAPTION_PIPELINES
  );
  assert.equal(
    config.captionRequestBodyTimeoutMs,
    DEFAULT_CAPTION_REQUEST_BODY_TIMEOUT_MS
  );

  const maximumConfig = resolveCaptionGatewayConfig({
    ...TEST_ENV,
    KIRINUKI_MAX_CONCURRENT_CAPTION_PIPELINES: String(
      MAX_CONCURRENT_CAPTION_PIPELINES
    )
  });
  assert.equal(maximumConfig.allowedOrigin, KIRINUKI_LOCAL_STUDIO_ORIGIN);
  assert.equal(
    maximumConfig.maxConcurrentCaptionPipelines,
    MAX_CONCURRENT_CAPTION_PIPELINES
  );
  assert.equal(
    resolveCaptionGatewayConfig({
      ...TEST_ENV,
      KIRINUKI_CAPTION_REQUEST_BODY_TIMEOUT_MS: String(
        MAX_CAPTION_REQUEST_BODY_TIMEOUT_MS
      )
    }).captionRequestBodyTimeoutMs,
    MAX_CAPTION_REQUEST_BODY_TIMEOUT_MS
  );
  assert.equal(
    resolveCaptionGatewayConfig({
      ...TEST_ENV,
      KIRINUKI_ALLOWED_ORIGIN: KIRINUKI_PUBLIC_STUDIO_ORIGIN
    }).allowedOrigin,
    KIRINUKI_PUBLIC_STUDIO_ORIGIN
  );
  const {
    KIRINUKI_ALLOWED_ORIGIN: _configuredOrigin,
    ...defaultOriginEnvironment
  } = TEST_ENV;
  assert.equal(
    resolveCaptionGatewayConfig(defaultOriginEnvironment).allowedOrigin,
    KIRINUKI_LOCAL_STUDIO_ORIGIN
  );

  for (const invalidOrigin of [
    "*",
    "https://kirinuki.eff0rtchung.kr/",
    "https://kirinuki.eff0rtchung.kr.attacker.example",
    " https://kirinuki.eff0rtchung.kr",
    "https://kirinuki.eff0rtchung.kr\n"
  ]) {
    assert.throws(
      () => resolveCaptionGatewayConfig({
        ...TEST_ENV,
        KIRINUKI_ALLOWED_ORIGIN: invalidOrigin
      }),
      (error) => hasErrorCode(error, "INVALID_CONFIGURATION")
    );
  }
  for (const invalidConcurrency of ["", "0", "3", "01", "1.0", " 1"]) {
    assert.throws(
      () => resolveCaptionGatewayConfig({
        ...TEST_ENV,
        KIRINUKI_MAX_CONCURRENT_CAPTION_PIPELINES: invalidConcurrency
      }),
      (error) => hasErrorCode(error, "INVALID_CONFIGURATION")
    );
  }
  for (const invalidBodyTimeout of [
    "",
    "0",
    String(MAX_CAPTION_REQUEST_BODY_TIMEOUT_MS + 1),
    "01",
    "1.0",
    " 1000"
  ]) {
    assert.throws(
      () => resolveCaptionGatewayConfig({
        ...TEST_ENV,
        KIRINUKI_CAPTION_REQUEST_BODY_TIMEOUT_MS: invalidBodyTimeout
      }),
      (error) => hasErrorCode(error, "INVALID_CONFIGURATION")
    );
  }
  for (const invalidVersion of ["", "latest", "03.0.0", "3.0", " 3.0.0"]) {
    assert.throws(
      () => resolveCaptionGatewayConfig({
        ...TEST_ENV,
        KIRINUKI_LOCAL_ENGINE_VERSION: invalidVersion
      }),
      (error) => hasErrorCode(error, "INVALID_CONFIGURATION")
    );
  }
  assert.throws(
    () => resolveCaptionGatewayConfig({
      ...TEST_ENV,
      KIRINUKI_LOCAL_ENGINE_BACKGROUND_START: "pending"
    }),
    (error) => hasErrorCode(error, "INVALID_CONFIGURATION")
  );
  for (const invalidEnvironment of [
    {
      ...TEST_ENV,
      KIRINUKI_VOD_RUNTIME_SCHEMA: "foreign-runtime/v1"
    },
    {
      ...TEST_ENV,
      KIRINUKI_VOD_YT_DLP_VERSION: "latest"
    },
    {
      ...TEST_ENV,
      KIRINUKI_VOD_EJS_VERSION: "latest"
    },
    {
      ...TEST_ENV,
      KIRINUKI_VOD_INSTANCE_NONCE: "generic"
    },
    {
      ...TEST_ENV,
      KIRINUKI_VOD_RUNTIME_READY: undefined
    }
  ]) {
    assert.throws(
      () => resolveCaptionGatewayConfig(invalidEnvironment),
      (error) => hasErrorCode(error, "INVALID_CONFIGURATION")
    );
  }
});

test("내부 자막 엔진은 허용된 웹 Origin으로 127.0.0.1에만 bind한다", async (t) => {
  const reservation = createNetServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const reservedAddress = reservation.address();
  assert.ok(reservedAddress && typeof reservedAddress !== "string");
  const port = reservedAddress.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));

  const runtime = await startCaptionGateway({
    env: {
      ...TEST_ENV,
      KIRINUKI_AGENT_PORT: String(port)
    }
  });
  t.after(() => runtime.shutdown());
  const address = runtime.server.address();
  assert.ok(address && typeof address !== "string");
  assert.equal(address.address, "127.0.0.1");
  assert.equal(address.port, port);
  assert.equal(runtime.config.allowedOrigin, KIRINUKI_LOCAL_STUDIO_ORIGIN);
});

test("관리형 gateway는 health·문서 capability·Whisper-only 기능을 제공한다", async (t) => {
  const { port } = await listenTestServer(t, {
    env: {
      ...TEST_ENV,
      KIRINUKI_AUTO_PAIR: "1"
    },
    randomBytesImpl: () => Buffer.alloc(32, 7)
  });

  const health = await localHttpJson({
    port,
    path: "/v1/health",
    headers: {
      Origin: ALLOWED_ORIGIN,
      "X-Kirinuki-Protocol": LOCAL_MEDIA_ENGINE_HEALTH_PROTOCOL
    }
  });
  assert.equal(health.status, 200);
  assert.equal(health.body.schema, CAPTION_AGENT_HEALTH_SCHEMA_ID);
  assert.equal(
    health.body.originBinding,
    KIRINUKI_GATEWAY_ORIGIN_BINDING
  );
  assert.equal(health.body.transcriptionMode, "local-whispercpp");
  assert.deepEqual(health.body.engine, {
    backgroundStart: "ready",
    product: LOCAL_MEDIA_ENGINE_PRODUCT,
    protocol: LOCAL_MEDIA_ENGINE_API_PROTOCOL,
    version: LOCAL_MEDIA_ENGINE_DEVELOPMENT_VERSION
  });
  assert.deepEqual(health.body.vodRuntime, {
    schema: LOCAL_VOD_RUNTIME_SCHEMA,
    kind: "caption-vod",
    ready: true,
    ytDlp: { version: "2026.07.04" },
    ejs: { version: "0.8.0" },
    instanceNonce: VOD_INSTANCE_NONCE
  });
  assert.equal(Object.hasOwn(health.body, "token"), false);

  const legacyCaptionProtocolHealth = await localHttpJson({
    port,
    path: "/v1/health",
    headers: {
      Origin: ALLOWED_ORIGIN,
      "X-Kirinuki-Protocol": CAPTION_AGENT_REQUEST_SCHEMA_ID
    }
  });
  assert.equal(legacyCaptionProtocolHealth.status, 403);
  assert.equal(
    legacyCaptionProtocolHealth.body.error.code,
    "HEALTH_PROBE_NOT_ALLOWED"
  );

  const clientNonce = testCapabilityNonce("managed-session");
  const pairing = await rawLocalHttpJson({
    port,
    path: "/v1/session",
    method: "POST",
    headers: {
      Origin: ALLOWED_ORIGIN,
      "Content-Type": "application/json",
      "X-Kirinuki-Client-Nonce": clientNonce,
      "X-Kirinuki-Protocol": LOCAL_ENGINE_SESSION_REQUEST_SCHEMA_ID
    },
    body: {
      schema: LOCAL_ENGINE_SESSION_REQUEST_SCHEMA_ID,
      clientNonce,
      projectId: "gateway-project-1",
      actions: ["captions"]
    }
  });
  assert.equal(pairing.status, 200);
  assert.equal(pairing.body.schema, CAPTION_AGENT_SESSION_SCHEMA_ID);
  assert.equal(pairing.body.token, Buffer.alloc(32, 7).toString("base64url"));
  assert.equal(pairing.body.authentication, "bearer-memory-capability");
  const remainingLifetime = Date.parse(String(pairing.body.expiresAt))
    - Date.now();
  assert.ok(remainingLifetime <= LOCAL_ENGINE_CAPABILITY_ABSOLUTE_TTL_MS);
  assert.ok(
    remainingLifetime >= LOCAL_ENGINE_CAPABILITY_ABSOLUTE_TTL_MS - 1_000
  );
  assert.equal(pairing.headers["cache-control"], "no-store");

  const capability = await localHttpJson({
    port,
    headers: {
      Origin: ALLOWED_ORIGIN,
      Authorization: `Bearer ${pairing.body.token}`,
      "X-Kirinuki-Client-Nonce": clientNonce
    }
  });
  assert.equal(capability.status, 200);
  assert.equal(
    capability.body.schema,
    CAPTION_AGENT_CAPABILITY_SCHEMA_ID
  );
  assert.equal(capability.body.provider, "local-whispercpp");
  assert.deepEqual(capability.body.availableModels, ["whisper-tiny"]);
  assert.deepEqual(capability.body.configured, {
    localWhisperReady: true
  });
  assert.equal(capability.body.transcription.authentication, "none-loopback");
  assert.equal(capability.body.transcription.vad, false);
  assert.equal(
    capability.body.transcription.timestampClock,
    "original-audio"
  );
  assert.equal(
    capability.body.transcription.timingRevision,
    "vad-off-original-clock-v1"
  );
  assert.equal(
    capability.body.cueDurationPolicy,
    CAPTION_CUE_DURATION_POLICY
  );
  assert.equal(
    capability.body.qualityHarness.profile,
    CAPTION_QUALITY_PROFILE_ID
  );
  assert.equal(
    capability.body.qualityHarness.harnessFingerprint,
    CAPTION_HARNESS_FINGERPRINT
  );
  assert.equal(capability.body.qualityHarness.paidRepairCalls, 0);
  assert.doesNotMatch(
    JSON.stringify(capability.body),
    /api.?key|remote.?stt|provider.?override/iu
  );
});

test("gateway CORS에는 허용된 웹 Origin과 필요한 접근 헤더만 노출한다", async (t) => {
  const { port } = await listenTestServer(t, { env: TEST_ENV });
  const preflight = await localHttpJson({
    port,
    method: "OPTIONS",
    headers: {
      Origin: KIRINUKI_LOCAL_STUDIO_ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": [
        "authorization",
        "content-type",
        "x-kirinuki-client-nonce",
        "x-kirinuki-protocol"
      ].join(", "),
      "Access-Control-Request-Private-Network": "true"
    }
  });
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers["access-control-allow-origin"],
    KIRINUKI_LOCAL_STUDIO_ORIGIN
  );
  assert.equal(
    preflight.headers["access-control-allow-headers"],
    "Authorization, Content-Type, X-Kirinuki-Client-Nonce, X-Kirinuki-Media-Access, X-Kirinuki-Protocol, X-Kirinuki-Pairing-State, X-Kirinuki-Server-Challenge, X-Kirinuki-Transport, X-Kirinuki-Transport-Counter"
  );
  assert.equal(
    preflight.headers["access-control-allow-private-network"],
    "true"
  );
  assert.equal(
    preflight.headers.vary,
    "Origin, Access-Control-Request-Private-Network"
  );

  const wrongOrigin = await localHttpJson({
    port,
    method: "OPTIONS",
    headers: {
      Origin: "https://kirinuki.eff0rtchung.kr.attacker.example",
      "Access-Control-Request-Private-Network": "true"
    }
  });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(wrongOrigin.headers["access-control-allow-origin"], undefined);
  assert.equal(
    wrongOrigin.headers["access-control-allow-private-network"],
    undefined
  );

  const unknownHeader = await localHttpJson({
    port,
    method: "OPTIONS",
    headers: {
      Origin: KIRINUKI_LOCAL_STUDIO_ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "x-kirinuki-protocol, x-evil",
      "Access-Control-Request-Private-Network": "true"
    }
  });
  assert.equal(unknownHeader.status, 400);
  assert.equal(unknownHeader.body.error.code, "INVALID_CORS_PREFLIGHT");
  assert.equal(unknownHeader.headers["access-control-allow-origin"], undefined);
  assert.equal(
    unknownHeader.headers["access-control-allow-private-network"],
    undefined
  );
});

test("gateway는 raw Host를 Origin보다 먼저 검증하고 forwarding authority를 거절한다", async (t) => {
  const { port } = await listenTestServer(t, { env: TEST_ENV });
  const invalidAuthorities: readonly (readonly string[])[] = [
    [`Host: localhost:${port}`],
    ["Host: 127.0.0.1"],
    [`Host: [::1]:${port}`],
    [`Host: 127.0.0.1:${port}`, `Host: 127.0.0.1:${port}`],
    [`Host: 127.0.0.1:${port}`, "Forwarded: host=attacker.example"],
    [`Host: 127.0.0.1:${port}`, "X-Forwarded-Host: attacker.example"],
    [`Host: 127.0.0.1:${port}`, "X-Forwarded-Proto: https"]
  ];
  for (const authorityHeaders of invalidAuthorities) {
    const response = await rawSocketResponse(port, [
      "GET /v1/health HTTP/1.1",
      ...authorityHeaders,
      "Origin: https://attacker.example",
      `X-Kirinuki-Protocol: ${LOCAL_MEDIA_ENGINE_HEALTH_PROTOCOL}`,
      "Connection: close"
    ]);
    assert.match(response, /^HTTP\/1\.1 421 /u, response);
    assert.match(response, /"code":"MISDIRECTED_REQUEST"/u, response);
    assert.doesNotMatch(response, /access-control-allow-origin/iu, response);
    assert.doesNotMatch(response, /ORIGIN_NOT_ALLOWED/u, response);
  }

  const duplicatedOrigin = await rawSocketResponse(port, [
    "GET /v1/health HTTP/1.1",
    `Host: 127.0.0.1:${port}`,
    `Origin: ${ALLOWED_ORIGIN}`,
    `Origin: ${ALLOWED_ORIGIN}`,
    `X-Kirinuki-Protocol: ${LOCAL_MEDIA_ENGINE_HEALTH_PROTOCOL}`,
    "Connection: close"
  ]);
  assert.match(duplicatedOrigin, /^HTTP\/1\.1 403 /u, duplicatedOrigin);
  assert.match(duplicatedOrigin, /ORIGIN_NOT_ALLOWED/u, duplicatedOrigin);

  const duplicatedProtocol = await rawSocketResponse(port, [
    "GET /v1/health HTTP/1.1",
    `Host: 127.0.0.1:${port}`,
    `Origin: ${ALLOWED_ORIGIN}`,
    `X-Kirinuki-Protocol: ${LOCAL_MEDIA_ENGINE_HEALTH_PROTOCOL}`,
    `X-Kirinuki-Protocol: ${LOCAL_MEDIA_ENGINE_HEALTH_PROTOCOL}`,
    "Connection: close"
  ]);
  assert.match(duplicatedProtocol, /^HTTP\/1\.1 403 /u, duplicatedProtocol);
  assert.match(duplicatedProtocol, /HEALTH_PROBE_NOT_ALLOWED/u, duplicatedProtocol);
});

test("공개 HTTPS Origin은 legacy plaintext health/session downgrade도 거부한다", async (t) => {
  const { port } = await listenTestServer(t, {
    env: {
      ...TEST_ENV,
      KIRINUKI_ALLOWED_ORIGIN: KIRINUKI_PUBLIC_STUDIO_ORIGIN
    }
  });
  const health = await rawLocalHttpJson({
    port,
    path: "/v1/health",
    headers: {
      Origin: KIRINUKI_PUBLIC_STUDIO_ORIGIN,
      "X-Kirinuki-Protocol": LOCAL_MEDIA_ENGINE_HEALTH_PROTOCOL
    }
  });
  assert.equal(health.status, 403);
  assert.equal(health.body.error.code, "HEALTH_PROBE_NOT_ALLOWED");

  const clientNonce = testCapabilityNonce("public-origin");
  const sessionBody = {
    schema: LOCAL_ENGINE_SESSION_REQUEST_SCHEMA_ID,
    clientNonce,
    projectId: "project-public-origin",
    actions: ["vod", "cache-delete"],
    sourceUrl: "https://chzzk.naver.com/video/14252987"
  };
  const session = await rawLocalHttpJson({
    port,
    path: "/v1/session",
    method: "POST",
    headers: {
      Origin: KIRINUKI_PUBLIC_STUDIO_ORIGIN,
      "Content-Type": "application/json",
      "X-Kirinuki-Client-Nonce": clientNonce,
      "X-Kirinuki-Protocol": LOCAL_ENGINE_SESSION_REQUEST_SCHEMA_ID
    },
    body: sessionBody
  });
  assert.equal(session.status, 400);
  assert.equal(session.body.error.code, "PROTOCOL_REQUIRED");
  assert.equal(session.body.token, undefined);

  for (const origin of [
    "https://kirinuki.eff0rtchung.kr.attacker.example",
    "null",
    ""
  ]) {
    const rejected = await rawLocalHttpJson({
      port,
      path: "/v1/health",
      headers: {
        ...(origin ? { Origin: origin } : {}),
        "X-Kirinuki-Protocol": LOCAL_MEDIA_ENGINE_HEALTH_PROTOCOL
      }
    });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.body.error.code, "ORIGIN_NOT_ALLOWED");
  }
});

test("문서 capability 요청은 엄격한 JSON scope와 단일사용 nonce를 요구한다", async (t) => {
  const fixedNow = Date.parse("2026-08-21T00:00:00.000Z");
  const { port } = await listenTestServer(t, {
    env: TEST_ENV,
    now: () => fixedNow
  });
  const validNonce = testCapabilityNonce("strict-session");
  const validBody = {
    schema: LOCAL_ENGINE_SESSION_REQUEST_SCHEMA_ID,
    clientNonce: validNonce,
    projectId: "project-5915fbee-dd21-4f07-953c-8c50d62ccbb7",
    actions: ["vod", "captions"],
    sourceUrl: "https://chzzk.naver.com/video/14252987"
  };
  const requestSession = (
    body: unknown,
    clientNonce: string = validNonce
  ) => rawLocalHttpJson({
    port,
    path: "/v1/session",
    method: "POST",
    headers: {
      Origin: ALLOWED_ORIGIN,
      "Content-Type": "application/json",
      "X-Kirinuki-Client-Nonce": clientNonce,
      "X-Kirinuki-Protocol": LOCAL_ENGINE_SESSION_REQUEST_SCHEMA_ID
    },
    body
  });

  const issued = await requestSession(validBody);
  assert.equal(issued.status, 200);
  assert.equal(issued.body.schema, CAPTION_AGENT_SESSION_SCHEMA_ID);
  assert.equal(issued.body.authentication, "bearer-memory-capability");
  assert.equal(
    issued.body.expiresAt,
    new Date(fixedNow + LOCAL_ENGINE_CAPABILITY_ABSOLUTE_TTL_MS).toISOString()
  );
  assert.equal(issued.headers["cache-control"], "no-store");

  const replay = await requestSession(validBody);
  assert.equal(replay.status, 409);
  assert.equal(replay.body.error.code, "CLIENT_NONCE_REPLAYED");

  const invalidRequests = [
    { ...validBody, schema: "foreign-session/v1" },
    { ...validBody, projectId: " project-with-whitespace" },
    { ...validBody, projectId: "x".repeat(257) },
    { ...validBody, actions: [] },
    { ...validBody, actions: ["vod", "vod"] },
    { ...validBody, actions: ["shell"] },
    { ...validBody, unexpected: true }
  ];
  for (const [index, invalidBody] of invalidRequests.entries()) {
    const nonce = testCapabilityNonce(`invalid-session-${index}`);
    const response = await requestSession({
      ...invalidBody,
      clientNonce: nonce
    }, nonce);
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.equal(response.body.error.code, "INVALID_SESSION_REQUEST");
  }

  const invalidNonce = await requestSession({
    ...validBody,
    clientNonce: "short"
  }, "short");
  assert.equal(invalidNonce.status, 400);
  assert.equal(invalidNonce.body.error.code, "INVALID_SESSION_REQUEST");

  const headerMismatch = await requestSession({
    ...validBody,
    clientNonce: testCapabilityNonce("body-nonce")
  }, testCapabilityNonce("header-nonce"));
  assert.equal(headerMismatch.status, 400);
  assert.equal(headerMismatch.body.error.code, "CLIENT_NONCE_REQUIRED");

  const oversizedNonce = testCapabilityNonce("oversized-session");
  const oversized = await requestSession(
    "x".repeat(MAX_LOCAL_ENGINE_SESSION_REQUEST_BYTES + 1),
    oversizedNonce
  );
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body.error.code, "REQUEST_TOO_LARGE");
});

test("vod capability는 세 플랫폼의 정규 VOD URL을 필수로 하고 alias·live URL을 거절한다", async (t) => {
  const { port } = await listenTestServer(t, { env: TEST_ENV });
  const requestSession = async (
    label: string,
    sourceUrl?: string
  ): Promise<LocalHttpJsonResult> => {
    const clientNonce = testCapabilityNonce(label);
    return await rawLocalHttpJson({
      port,
      path: "/v1/session",
      method: "POST",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Content-Type": "application/json",
        "X-Kirinuki-Client-Nonce": clientNonce,
        "X-Kirinuki-Protocol": LOCAL_ENGINE_SESSION_REQUEST_SCHEMA_ID
      },
      body: {
        schema: LOCAL_ENGINE_SESSION_REQUEST_SCHEMA_ID,
        clientNonce,
        projectId: `project-${label}`,
        actions: ["vod"],
        ...(sourceUrl === undefined ? {} : { sourceUrl })
      }
    });
  };

  for (const [label, sourceUrl] of [
    ["missing", undefined],
    ["youtube-alias", "https://youtu.be/abcdefghijk"],
    ["soop-alias", "https://vod.sooplive.com/PLAYER/STATION/123456789"],
    ["chzzk-live", "https://chzzk.naver.com/live/0123456789abcdef0123456789abcdef"]
  ] as const) {
    const rejected = await requestSession(label, sourceUrl);
    assert.equal(rejected.status, 400, JSON.stringify(rejected.body));
    assert.equal(rejected.body.error.code, "INVALID_SESSION_REQUEST");
  }

  for (const [label, sourceUrl] of [
    ["chzzk-vod", "https://chzzk.naver.com/video/14252987"],
    ["youtube-vod", "https://www.youtube.com/watch?v=abcdefghijk"],
    ["soop-vod", "https://vod.sooplive.com/player/123456789"]
  ] as const) {
    const issued = await requestSession(label, sourceUrl);
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    assert.match(String(issued.body.token), /^[a-zA-Z0-9_-]{43}$/u);
  }
});

test("문서 capability는 action·project·source와 client nonce를 API 전에 제한한다", async (t) => {
  let pipelineCalls = 0;
  const { port } = await listenTestServer(t, {
    env: TEST_ENV,
    pipelineRunner: async () => {
      pipelineCalls += 1;
      return { ok: true };
    }
  });
  const sourceA = "https://chzzk.naver.com/video/14252987";
  const sourceB = "https://www.youtube.com/watch?v=abcdefghijk";
  const captionsOnly = await issueTestCapability(
    port,
    "project-a",
    ["captions"]
  );
  const vodOnly = await issueTestCapability(
    port,
    "project-a",
    ["vod"],
    sourceA
  );
  const authorizedHeaders = (
    capability: TestCapability,
    protocol?: string
  ) => ({
    Origin: ALLOWED_ORIGIN,
    Authorization: `Bearer ${capability.token}`,
    "Content-Type": "application/json",
    "X-Kirinuki-Client-Nonce": capability.clientNonce,
    ...(protocol ? { "X-Kirinuki-Protocol": protocol } : {})
  });

  const wrongAction = await rawLocalHttpJson({
    port,
    path: "/v1/vod/materializations",
    method: "POST",
    headers: authorizedHeaders(
      captionsOnly,
      CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
    ),
    body: {}
  });
  assert.equal(wrongAction.status, 403);
  assert.equal(wrongAction.body.error.code, "CAPABILITY_ACTION_NOT_ALLOWED");

  for (const body of [
    { consumerId: "project-b", sourceUrl: sourceA },
    { consumerId: "project-a", sourceUrl: sourceB }
  ]) {
    const mismatch = await rawLocalHttpJson({
      port,
      path: "/v1/vod/materializations",
      method: "POST",
      headers: authorizedHeaders(
        vodOnly,
        CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
      ),
      body
    });
    assert.equal(mismatch.status, 403, JSON.stringify(mismatch.body));
    assert.equal(mismatch.body.error.code, "CAPABILITY_SCOPE_MISMATCH");
  }

  const wrongCaptionProject = await rawLocalHttpJson({
    port,
    path: "/v1/captions",
    method: "POST",
    headers: authorizedHeaders(captionsOnly),
    body: captionRequest({
      source: {
        projectId: "project-b",
        projectName: "B",
        streamerName: "B"
      }
    })
  });
  assert.equal(wrongCaptionProject.status, 403);
  assert.equal(
    wrongCaptionProject.body.error.code,
    "CAPABILITY_SCOPE_MISMATCH"
  );
  assert.equal(pipelineCalls, 0);

  const validCaption = await rawLocalHttpJson({
    port,
    path: "/v1/captions",
    method: "POST",
    headers: authorizedHeaders(captionsOnly),
    body: captionRequest({
      source: {
        projectId: "project-a",
        projectName: "A",
        streamerName: "A"
      }
    })
  });
  assert.equal(validCaption.status, 200);
  assert.equal(pipelineCalls, 1);

  const wrongNonce = await rawLocalHttpJson({
    port,
    headers: {
      Origin: ALLOWED_ORIGIN,
      Authorization: `Bearer ${captionsOnly.token}`,
      "X-Kirinuki-Client-Nonce": vodOnly.clientNonce
    }
  });
  assert.equal(wrongNonce.status, 401);

  const deleteWithoutAction = await rawLocalHttpJson({
    port,
    path: "/v1/vod/materializations/abcdefghijklmnop/cache",
    method: "DELETE",
    headers: authorizedHeaders(vodOnly, CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA)
  });
  assert.equal(
    deleteWithoutAction.status,
    403,
    JSON.stringify(deleteWithoutAction.body)
  );
  assert.equal(
    deleteWithoutAction.body.error.code,
    "CAPABILITY_ACTION_NOT_ALLOWED"
  );
});

test("문서 capability는 idle 30분과 absolute 12시간 경계에서 메모리에서 폐기된다", async (t) => {
  let currentTime = Date.parse("2026-08-21T00:00:00.000Z");
  const { port } = await listenTestServer(t, {
    env: TEST_ENV,
    now: () => currentTime
  });
  const requestCapability = (capability: TestCapability) => rawLocalHttpJson({
    port,
    headers: {
      Origin: ALLOWED_ORIGIN,
      Authorization: `Bearer ${capability.token}`,
      "X-Kirinuki-Client-Nonce": capability.clientNonce
    }
  });

  const idleCapability = await issueTestCapability(
    port,
    "project-idle",
    ["captions"]
  );
  assert.equal((await requestCapability(idleCapability)).status, 200);
  currentTime += LOCAL_ENGINE_CAPABILITY_IDLE_TTL_MS;
  const idleExpired = await requestCapability(idleCapability);
  assert.equal(idleExpired.status, 401);
  assert.equal(idleExpired.body.error.code, "UNAUTHORIZED");

  const absoluteCapability = await issueTestCapability(
    port,
    "project-absolute",
    ["captions"]
  );
  currentTime += LOCAL_ENGINE_CAPABILITY_ABSOLUTE_TTL_MS;
  const absoluteExpired = await requestCapability(absoluteCapability);
  assert.equal(absoluteExpired.status, 401);
  assert.equal(absoluteExpired.body.error.code, "UNAUTHORIZED");
});

test("문서 capability registry는 256개로 제한하고 만료 항목을 발급 전에 정리한다", async (t) => {
  let currentTime = Date.parse("2026-08-21T00:00:00.000Z");
  const { port } = await listenTestServer(t, {
    env: TEST_ENV,
    now: () => currentTime
  });
  const issue = async (index: number): Promise<LocalHttpJsonResult> => {
    const clientNonce = testCapabilityNonce(`registry-${index}`);
    return await rawLocalHttpJson({
      port,
      path: "/v1/session",
      method: "POST",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Content-Type": "application/json",
        "X-Kirinuki-Client-Nonce": clientNonce,
        "X-Kirinuki-Protocol": LOCAL_ENGINE_SESSION_REQUEST_SCHEMA_ID
      },
      body: {
        schema: LOCAL_ENGINE_SESSION_REQUEST_SCHEMA_ID,
        clientNonce,
        projectId: `project-registry-${index}`,
        actions: ["captions"]
      }
    });
  };

  for (let index = 0; index < MAX_LOCAL_ENGINE_CAPABILITIES; index += 1) {
    if (index > 0 && index % 12 === 0) {
      currentTime += 60_001;
    }
    const response = await issue(index);
    assert.equal(response.status, 200, `${index}: ${JSON.stringify(response.body)}`);
  }
  const full = await issue(MAX_LOCAL_ENGINE_CAPABILITIES);
  assert.equal(full.status, 429);
  assert.equal(full.body.error.code, "CAPABILITY_LIMIT_REACHED");

  currentTime += LOCAL_ENGINE_CAPABILITY_IDLE_TTL_MS;
  const afterPrune = await issue(MAX_LOCAL_ENGINE_CAPABILITIES + 1);
  assert.equal(afterPrune.status, 200, JSON.stringify(afterPrune.body));
});

test("gateway는 잘못된 Origin·인증·health probe를 거절한다", async (t) => {
  const { port } = await listenTestServer(t, { env: TEST_ENV });
  const wrongOrigin = await localHttpJson({
    port,
    headers: {
      Origin: "chrome-extension://wrong",
      Authorization: `Bearer ${AGENT_TOKEN}`
    }
  });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(wrongOrigin.body.error.code, "ORIGIN_NOT_ALLOWED");

  const missingOrigin = await localHttpJson({
    port,
    headers: {
      Authorization: `Bearer ${AGENT_TOKEN}`
    }
  });
  assert.equal(missingOrigin.status, 403);
  assert.equal(missingOrigin.body.error.code, "ORIGIN_NOT_ALLOWED");

  const unauthorized = await localHttpJson({
    port,
    headers: { Origin: ALLOWED_ORIGIN }
  });
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.body.error.code, "UNAUTHORIZED");

  const configuredLegacyToken = await rawLocalHttpJson({
    port,
    headers: {
      Origin: ALLOWED_ORIGIN,
      Authorization: `Bearer ${AGENT_TOKEN}`,
      "X-Kirinuki-Client-Nonce": testCapabilityNonce("legacy-global-token")
    }
  });
  assert.equal(configuredLegacyToken.status, 401);
  assert.equal(configuredLegacyToken.body.error.code, "UNAUTHORIZED");

  const badHealth = await localHttpJson({
    port,
    path: "/v1/health",
    headers: { Origin: ALLOWED_ORIGIN }
  });
  assert.equal(badHealth.status, 403);
  assert.equal(
    badHealth.body.error.code,
    "HEALTH_PROBE_NOT_ALLOWED"
  );
});

test("본문을 읽기 전 거절한 모든 gateway 경로는 keep-alive 연결을 닫아 후속 요청을 오염시키지 않는다", async (t) => {
  const { port } = await listenTestServer(t, {
    env: {
      ...TEST_ENV,
      KIRINUKI_AUTO_PAIR: "1"
    }
  });
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  t.after(() => agent.destroy());
  const rejectedCases = [
    {
      label: "origin",
      path: "/v1/captions",
      headers: { Origin: "chrome-extension://wrong" },
      status: 403,
      code: "ORIGIN_NOT_ALLOWED"
    },
    {
      label: "pairing protocol",
      path: "/v1/session",
      headers: { Origin: ALLOWED_ORIGIN },
      status: 400,
      code: "PROTOCOL_REQUIRED"
    },
    {
      label: "materialization protocol",
      path: "/v1/vod/materializations",
      headers: {
        Origin: ALLOWED_ORIGIN,
        Authorization: `Bearer ${AGENT_TOKEN}`
      },
      status: 400,
      code: "PROTOCOL_REQUIRED"
    },
    {
      label: "caption auth",
      path: "/v1/captions",
      headers: { Origin: ALLOWED_ORIGIN },
      status: 401,
      code: "UNAUTHORIZED"
    }
  ] as const;

  for (const rejectedCase of rejectedCases) {
    const body = JSON.stringify({
      case: rejectedCase.label,
      padding: "x".repeat(8_192)
    });
    let rejectedSocket: Socket | null = null;
    const rejected = await localHttpJson({
      agent,
      port,
      path: rejectedCase.path,
      method: "POST",
      headers: {
        ...rejectedCase.headers,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      },
      body,
      onSocket: (socket) => {
        rejectedSocket = socket;
      }
    });
    assert.equal(rejected.status, rejectedCase.status, rejectedCase.label);
    assert.equal(rejected.body.error.code, rejectedCase.code, rejectedCase.label);
    assert.equal(rejected.headers.connection, "close", rejectedCase.label);

    let healthSocket: Socket | null = null;
    const health = await localHttpJson({
      agent,
      port,
      path: "/v1/health",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "X-Kirinuki-Protocol": LOCAL_MEDIA_ENGINE_HEALTH_PROTOCOL
      },
      onSocket: (socket) => {
        healthSocket = socket;
      }
    });
    assert.equal(health.status, 200, rejectedCase.label);
    assert.ok(rejectedSocket, `${rejectedCase.label}: 거절 요청 socket 누락`);
    assert.ok(healthSocket, `${rejectedCase.label}: health 요청 socket 누락`);
    assert.notEqual(
      healthSocket,
      rejectedSocket,
      `${rejectedCase.label}: 읽지 않은 본문이 있는 socket을 재사용했습니다.`
    );
  }
});

test("gateway POST는 고정된 로컬 pipeline 설정만 전달한다", async (t) => {
  const received: {
    body?: Record<string, unknown>;
    options?: Record<string, unknown>;
  } = {};
  const { port } = await listenTestServer(t, {
    env: TEST_ENV,
    pipelineRunner: (async (
      body: unknown,
      options: Record<string, unknown> = {}
    ) => {
      received.body = body as Record<string, unknown>;
      received.options = options;
      return { ok: true };
    }) as unknown as NonNullable<
      NonNullable<
        Parameters<typeof createCaptionGatewayServer>[0]
      >["pipelineRunner"]
    >
  });
  const response = await localHttpJson({
    port,
    method: "POST",
    headers: {
      Origin: ALLOWED_ORIGIN,
      Authorization: `Bearer ${AGENT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: captionRequest()
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true });
  assert.ok(received.body);
  assert.ok(received.options);
  assert.equal(received.body.requestId, "gateway-request-1");
  assert.equal(received.options.sttEndpoint, LOCAL_STT_ENDPOINT);
  assert.equal(received.options.sttModel, "tiny-q5_1");
  assert.equal(
    received.options.transcriptionMode,
    LOCAL_WHISPERCPP_TRANSCRIPTION_MODE
  );
  assert.equal(Object.hasOwn(received.options, "sttApiKey"), false);
  assert.equal(Object.hasOwn(received.options, "providerApiKey"), false);
});

test("자막 pipeline은 기본 동시 실행 1개를 넘으면 body를 버리고 429로 즉시 거절한다", async (t) => {
  let releaseFirst: (() => void) | undefined;
  let markFirstStarted: (() => void) | undefined;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  let executions = 0;
  const { port, runtime } = await listenTestServer(t, {
    env: TEST_ENV,
    pipelineRunner: (async () => {
      executions += 1;
      if (executions === 1) {
        markFirstStarted?.();
        await firstGate;
      }
      return { ok: true, executions };
    }) as NonNullable<
      NonNullable<
        Parameters<typeof createCaptionGatewayServer>[0]
      >["pipelineRunner"]
    >
  });
  t.after(() => releaseFirst?.());

  const firstResponse = localHttpJson({
    port,
    method: "POST",
    headers: {
      Origin: ALLOWED_ORIGIN,
      Authorization: `Bearer ${AGENT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: captionRequest({ requestId: "caption-concurrency-first" })
  });
  await withReferencedDeadline(firstStarted);
  assert.equal(runtime.activeCaptionPipelineCount, 1);

  const rejected = await localHttpJson({
    port,
    method: "POST",
    headers: {
      Origin: ALLOWED_ORIGIN,
      Authorization: `Bearer ${AGENT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...captionRequest({ requestId: "caption-concurrency-rejected" }),
      unreadPadding: "x".repeat(8_192)
    })
  });
  assert.equal(rejected.status, 429);
  assert.equal(rejected.body.error.code, "CAPTION_PIPELINE_BUSY");
  assert.equal(rejected.headers["retry-after"], "1");
  assert.equal(rejected.headers.connection, "close");
  assert.equal(executions, 1);

  releaseFirst?.();
  assert.equal((await firstResponse).status, 200);
  assert.equal(runtime.activeCaptionPipelineCount, 0);
  const next = await localHttpJson({
    port,
    method: "POST",
    headers: {
      Origin: ALLOWED_ORIGIN,
      Authorization: `Bearer ${AGENT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: captionRequest({ requestId: "caption-concurrency-next" })
  });
  assert.equal(next.status, 200);
  assert.equal(executions, 2);
  assert.equal(runtime.activeCaptionPipelineCount, 0);
});

test("자막 pipeline 동시성 2 설정은 두 작업만 허용하고 세 번째를 거절한다", async (t) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let executions = 0;
  const { port, runtime } = await listenTestServer(t, {
    env: {
      ...TEST_ENV,
      KIRINUKI_MAX_CONCURRENT_CAPTION_PIPELINES: "2"
    },
    pipelineRunner: (async () => {
      executions += 1;
      await gate;
      return { ok: true };
    }) as NonNullable<
      NonNullable<
        Parameters<typeof createCaptionGatewayServer>[0]
      >["pipelineRunner"]
    >
  });
  t.after(() => release?.());
  const request = (requestId: string) => localHttpJson({
    port,
    method: "POST",
    headers: {
      Origin: ALLOWED_ORIGIN,
      Authorization: `Bearer ${AGENT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: captionRequest({ requestId })
  });
  const first = request("caption-concurrency-two-first");
  const second = request("caption-concurrency-two-second");
  await waitForCondition(() => runtime.activeCaptionPipelineCount === 2);
  assert.equal(executions, 2);

  const third = await request("caption-concurrency-two-third");
  assert.equal(third.status, 429);
  assert.equal(third.body.error.code, "CAPTION_PIPELINE_BUSY");
  assert.equal(executions, 2);

  release?.();
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
  assert.equal(runtime.activeCaptionPipelineCount, 0);
});

test("부분 자막 body는 수신 기한 뒤 연결을 닫고 단일 pipeline 슬롯을 반환한다", async (t) => {
  let executions = 0;
  const { port, runtime } = await listenTestServer(t, {
    env: {
      ...TEST_ENV,
      KIRINUKI_CAPTION_REQUEST_BODY_TIMEOUT_MS: "250"
    },
    pipelineRunner: (async () => {
      executions += 1;
      return { ok: true, executions };
    }) as NonNullable<
      NonNullable<
        Parameters<typeof createCaptionGatewayServer>[0]
      >["pipelineRunner"]
    >
  });
  const partial = await partialCaptionHttpRequest(port);
  t.after(() => partial.request.destroy());
  await waitForCondition(() => runtime.activeCaptionPipelineCount === 1);

  const limited = await localHttpJson({
    port,
    method: "POST",
    headers: {
      Origin: ALLOWED_ORIGIN,
      Authorization: `Bearer ${AGENT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: captionRequest({ requestId: "caption-partial-body-limited" })
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, "CAPTION_PIPELINE_BUSY");
  assert.equal(executions, 0);

  const timedOut = await withReferencedDeadline(partial.response, 2_000);
  assert.equal(timedOut.status, 408);
  assert.equal(timedOut.body.error.code, "REQUEST_BODY_TIMEOUT");
  assert.equal(timedOut.headers.connection, "close");
  await waitForCondition(() => runtime.activeCaptionPipelineCount === 0);

  const next = await localHttpJson({
    port,
    method: "POST",
    headers: {
      Origin: ALLOWED_ORIGIN,
      Authorization: `Bearer ${AGENT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: captionRequest({ requestId: "caption-after-partial-timeout" })
  });
  assert.equal(next.status, 200);
  assert.equal(executions, 1);
});

test("잘못된 자막 JSON도 pipeline 슬롯을 반환해 다음 정상 요청을 막지 않는다", async (t) => {
  let executions = 0;
  const { port, runtime } = await listenTestServer(t, {
    env: TEST_ENV,
    pipelineRunner: (async () => {
      executions += 1;
      return { ok: true };
    }) as NonNullable<
      NonNullable<
        Parameters<typeof createCaptionGatewayServer>[0]
      >["pipelineRunner"]
    >
  });
  const invalid = await localHttpJson({
    port,
    method: "POST",
    headers: {
      Origin: ALLOWED_ORIGIN,
      Authorization: `Bearer ${AGENT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: "{"
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "INVALID_JSON");
  assert.equal(runtime.activeCaptionPipelineCount, 0);
  assert.equal(executions, 0);

  const next = await localHttpJson({
    port,
    method: "POST",
    headers: {
      Origin: ALLOWED_ORIGIN,
      Authorization: `Bearer ${AGENT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: captionRequest({ requestId: "caption-after-invalid-json" })
  });
  assert.equal(next.status, 200);
  assert.equal(executions, 1);
});

test("gateway shutdown은 수신 중인 부분 자막 body를 즉시 중단하고 슬롯을 반환한다", async (t) => {
  const { port, runtime } = await listenTestServer(t, {
    env: {
      ...TEST_ENV,
      KIRINUKI_CAPTION_REQUEST_BODY_TIMEOUT_MS: "60000"
    }
  });
  const partial = await partialCaptionHttpRequest(port);
  t.after(() => partial.request.destroy());
  await waitForCondition(() => runtime.activeCaptionPipelineCount === 1);

  await withReferencedDeadline(runtime.shutdown({
    graceMs: 100,
    deadlineMs: 1_000
  }), 2_000);
  const closing = await withReferencedDeadline(partial.response);
  assert.equal(closing.status, 503);
  assert.equal(closing.body.error.code, "GATEWAY_SHUTTING_DOWN");
  assert.equal(runtime.activeCaptionPipelineCount, 0);
  assert.equal(runtime.activeHandlerCount, 0);
});

test("gateway shutdown은 실행 중 자막 controller를 중단하고 슬롯을 반환한다", async (t) => {
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let observedAbort = false;
  const { port, runtime } = await listenTestServer(t, {
    env: TEST_ENV,
    pipelineRunner: (async (_body, options) => {
      markStarted?.();
      const signal = options.signal;
      assert.ok(signal);
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          observedAbort = true;
          reject(signal.reason);
        }, { once: true });
      });
    }) as NonNullable<
      NonNullable<
        Parameters<typeof createCaptionGatewayServer>[0]
      >["pipelineRunner"]
    >
  });
  const response = localHttpJson({
    port,
    method: "POST",
    headers: {
      Origin: ALLOWED_ORIGIN,
      Authorization: `Bearer ${AGENT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: captionRequest({ requestId: "caption-shutdown-active" })
  });
  await withReferencedDeadline(started);
  assert.equal(runtime.activeCaptionPipelineCount, 1);
  await withReferencedDeadline(runtime.shutdown({
    graceMs: 100,
    deadlineMs: 1_000
  }), 2_000);
  const closing = await withReferencedDeadline(response);
  assert.equal(closing.status, 503);
  assert.equal(closing.body.error.code, "GATEWAY_SHUTTING_DOWN");
  assert.equal(observedAbort, true);
  assert.equal(runtime.activeCaptionPipelineCount, 0);
  assert.equal(runtime.activeHandlerCount, 0);
});

test("gateway shutdown deadline은 abort를 무시하는 pipeline에서도 유한하게 실패한다", async (t) => {
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const never = new Promise<never>(() => {});
  const { port, runtime } = await listenTestServer(t, {
    env: TEST_ENV,
    pipelineRunner: (async () => {
      markStarted?.();
      return never;
    }) as NonNullable<
      NonNullable<
        Parameters<typeof createCaptionGatewayServer>[0]
      >["pipelineRunner"]
    >
  });
  const response = localHttpJson({
    port,
    method: "POST",
    headers: {
      Origin: ALLOWED_ORIGIN,
      Authorization: `Bearer ${AGENT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: captionRequest({ requestId: "caption-shutdown-ignores-abort" })
  });
  const responseSettlement = response.then(
    (value) => value,
    (error: unknown) => error
  );
  await withReferencedDeadline(started);

  await assert.rejects(
    withReferencedDeadline(runtime.shutdown({
      graceMs: 10,
      deadlineMs: 75
    }), 1_000),
    (error) => hasErrorCode(
      error,
      "GATEWAY_SHUTDOWN_DEADLINE_EXCEEDED"
    )
  );
  await withReferencedDeadline(responseSettlement);
  assert.equal(runtime.server.listening, false);
});

test("gateway shutdown은 VOD cleanup 실패를 성공으로 숨기지 않는다", async (t) => {
  const { runtime } = await listenTestServer(t, { env: TEST_ENV });
  const cleanupFailure = new Error("synthetic VOD cleanup failure");
  Object.defineProperty(runtime.chzzkVodJobs, "close", {
    configurable: true,
    value: () => Promise.reject(cleanupFailure)
  });

  await assert.rejects(
    withReferencedDeadline(runtime.shutdown({
      graceMs: 100,
      deadlineMs: 1_000
    }), 2_000),
    (error) => error === cleanupFailure
  );
  assert.equal(runtime.server.listening, false);
});

test("문서 capability 발급은 exact Origin·프로토콜과 분당 상한을 지킨다", async (t) => {
  const { port } = await listenTestServer(t, {
    env: {
      ...TEST_ENV,
      KIRINUKI_AUTO_PAIR: "1"
    }
  });
  const missingProtocol = await localHttpJson({
    port,
    path: "/v1/session",
    method: "POST",
    headers: { Origin: ALLOWED_ORIGIN }
  });
  assert.equal(missingProtocol.status, 400);
  assert.equal(missingProtocol.body.error.code, "PROTOCOL_REQUIRED");

  for (let index = 0; index < 12; index += 1) {
    const clientNonce = testCapabilityNonce(`rate-${index}`);
    const response = await localHttpJson({
      port,
      path: "/v1/session",
      method: "POST",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Content-Type": "application/json",
        "X-Kirinuki-Client-Nonce": clientNonce,
        "X-Kirinuki-Protocol": LOCAL_ENGINE_SESSION_REQUEST_SCHEMA_ID
      },
      body: {
        schema: LOCAL_ENGINE_SESSION_REQUEST_SCHEMA_ID,
        clientNonce,
        projectId: `gateway-project-${index}`,
        actions: ["captions"]
      }
    });
    assert.equal(response.status, 200);
  }
  const limited = await localHttpJson({
    port,
    path: "/v1/session",
    method: "POST",
    headers: {
      Origin: ALLOWED_ORIGIN,
      "X-Kirinuki-Protocol": LOCAL_ENGINE_SESSION_REQUEST_SCHEMA_ID
    }
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, "PAIRING_RATE_LIMITED");
  assert.equal(limited.headers["retry-after"], "60");
});
