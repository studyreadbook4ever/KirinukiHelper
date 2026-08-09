import assert from "node:assert/strict";
import {
  request as httpRequest,
  type IncomingHttpHeaders,
  type OutgoingHttpHeaders
} from "node:http";
import test, { type TestContext } from "node:test";
import type { AddressInfo } from "node:net";

import {
  CAPTION_AGENT_REQUEST_SCHEMA_ID,
  CAPTION_AGENT_RESPONSE_SCHEMA_ID,
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
  createCaptionGatewayServer,
  resolveCaptionGatewayConfig
} from "../scripts/caption-gateway.js";

const ALLOWED_ORIGIN = "chrome-extension://caption-agent-test";
const AGENT_TOKEN = "test-agent-token-123456";
const LOCAL_STT_ENDPOINT =
  "http://127.0.0.1:4318/kirinuki-test/inference";

const TEST_ENV = Object.freeze({
  KIRINUKI_STT_MODE: LOCAL_WHISPERCPP_TRANSCRIPTION_MODE,
  KIRINUKI_STT_ENDPOINT: LOCAL_STT_ENDPOINT,
  KIRINUKI_STT_MODEL: "tiny-q5_1",
  KIRINUKI_AGENT_TOKEN: AGENT_TOKEN,
  KIRINUKI_ALLOWED_ORIGIN: ALLOWED_ORIGIN,
  KIRINUKI_MAX_AUDIO_BYTES: "1048576"
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
  port: number;
  path?: string;
  method?: string;
  headers?: OutgoingHttpHeaders;
  body?: unknown;
}

interface LocalHttpJsonResult {
  status: number | undefined;
  headers: IncomingHttpHeaders;
  body: GatewayBody;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === code
  );
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
      maxCueDurationMs: 4_000,
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

function localHttpJson({
  port,
  path = "/v1/captions",
  method = "GET",
  headers = {},
  body
}: LocalHttpJsonOptions) {
  return new Promise<LocalHttpJsonResult>((resolve, reject) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      path,
      method,
      headers
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
    request.once("error", reject);
    if (body != null) {
      request.write(
        typeof body === "string" ? body : JSON.stringify(body)
      );
    }
    request.end();
  });
}

async function listenTestServer(
  t: TestContext,
  options: Parameters<typeof createCaptionGatewayServer>[0]
) {
  const { server, config } = createCaptionGatewayServer(options);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    server,
    config,
    port: (address as AddressInfo).port
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
    requestLocalWhisperTranscription(request, {
      sttEndpoint: LOCAL_STT_ENDPOINT,
      timeoutMs: 5,
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
        const signal = init?.signal;
        assert.ok(signal);
        signal.addEventListener("abort", () => {
          reject(signal.reason);
        }, { once: true });
      })
    }),
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
    runCaptionPipeline(captionRequest(), {
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
    }),
    (error) => hasErrorCode(error, "PIPELINE_TIMEOUT")
  );
  assert.equal(transcribeSignal.current?.aborted, true);
});

test("게이트웨이 설정은 exact Origin과 세션 인증을 강제한다", () => {
  const config = resolveCaptionGatewayConfig(TEST_ENV);
  assert.equal(config.allowedOrigin, ALLOWED_ORIGIN);
  assert.equal(config.agentToken, AGENT_TOKEN);
  assert.equal(config.pipeline.sttEndpoint, LOCAL_STT_ENDPOINT);

  assert.throws(
    () => resolveCaptionGatewayConfig({
      ...TEST_ENV,
      KIRINUKI_ALLOWED_ORIGIN: "*"
    }),
    (error) => hasErrorCode(error, "INVALID_CONFIGURATION")
  );
  assert.throws(
    () => resolveCaptionGatewayConfig({
      ...TEST_ENV,
      KIRINUKI_AGENT_TOKEN: "",
      KIRINUKI_AUTO_PAIR: "0"
    }),
    (error) => hasErrorCode(error, "MISSING_CONFIGURATION")
  );
});

test("관리형 gateway는 health·자동 pairing·Whisper-only capability를 제공한다", async (t) => {
  const { config, port } = await listenTestServer(t, {
    env: {
      ...TEST_ENV,
      KIRINUKI_AGENT_TOKEN: "",
      KIRINUKI_AUTO_PAIR: "1"
    },
    randomBytesImpl: () => Buffer.alloc(32, 7)
  });
  assert.equal(config.agentToken, Buffer.alloc(32, 7).toString("base64url"));

  const health = await localHttpJson({
    port,
    path: "/v1/health",
    headers: {
      Origin: ALLOWED_ORIGIN,
      "X-Kirinuki-Protocol": CAPTION_AGENT_REQUEST_SCHEMA_ID
    }
  });
  assert.equal(health.status, 200);
  assert.equal(health.body.schema, CAPTION_AGENT_HEALTH_SCHEMA_ID);
  assert.equal(health.body.transcriptionMode, "local-whispercpp");
  assert.equal(Object.hasOwn(health.body, "token"), false);

  const pairing = await localHttpJson({
    port,
    path: "/v1/session",
    method: "POST",
    headers: {
      Origin: ALLOWED_ORIGIN,
      "X-Kirinuki-Protocol": CAPTION_AGENT_REQUEST_SCHEMA_ID
    }
  });
  assert.equal(pairing.status, 200);
  assert.equal(pairing.body.schema, CAPTION_AGENT_SESSION_SCHEMA_ID);
  assert.equal(pairing.body.token, config.agentToken);
  assert.equal(pairing.headers["cache-control"], "no-store");

  const capability = await localHttpJson({
    port,
    headers: {
      Origin: ALLOWED_ORIGIN,
      Authorization: `Bearer ${pairing.body.token}`
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
  assert.equal(capability.body.qualityHarness.paidRepairCalls, 0);
  assert.doesNotMatch(
    JSON.stringify(capability.body),
    /api.?key|remote.?stt|provider.?override/iu
  );
});

test("gateway CORS에는 인증·프로토콜·JSON 헤더만 노출한다", async (t) => {
  const { port } = await listenTestServer(t, { env: TEST_ENV });
  const preflight = await localHttpJson({
    port,
    method: "OPTIONS",
    headers: { Origin: ALLOWED_ORIGIN }
  });
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers["access-control-allow-origin"],
    ALLOWED_ORIGIN
  );
  assert.equal(
    preflight.headers["access-control-allow-headers"],
    "Authorization, Content-Type, X-Kirinuki-Protocol"
  );
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

  const unauthorized = await localHttpJson({
    port,
    headers: { Origin: ALLOWED_ORIGIN }
  });
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.body.error.code, "UNAUTHORIZED");

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

test("자동 pairing은 exact Origin·프로토콜과 분당 상한을 지킨다", async (t) => {
  const { port } = await listenTestServer(t, {
    env: {
      ...TEST_ENV,
      KIRINUKI_AGENT_TOKEN: "",
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
    const response = await localHttpJson({
      port,
      path: "/v1/session",
      method: "POST",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "X-Kirinuki-Protocol": CAPTION_AGENT_REQUEST_SCHEMA_ID
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
      "X-Kirinuki-Protocol": CAPTION_AGENT_REQUEST_SCHEMA_ID
    }
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, "PAIRING_RATE_LIMITED");
  assert.equal(limited.headers["retry-after"], "60");
});
