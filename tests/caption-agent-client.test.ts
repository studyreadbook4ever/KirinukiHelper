import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import {
  CAPTION_HARNESS_FINGERPRINT,
  CAPTION_QUALITY_PROFILE_ID
} from "../src/caption-agent/caption-quality-harness.js";
import {
  captionEditorialContextFingerprint
} from "../src/caption-agent/editorial-context.js";
import {
  AUDSEG_ENGINE_VERSION,
  AUDSEG_PIPELINE_FINGERPRINT
} from "../src/editor/audseg.js";
import {
  CAPTION_AGENT_CAPABILITY_SCHEMA,
  CAPTION_AGENT_REQUEST_SCHEMA,
  CAPTION_AGENT_RESPONSE_SCHEMA,
  CAPTION_AGENT_SETTINGS_KEY,
  DEFAULT_CAPTION_AGENT_SETTINGS,
  LEGACY_CAPTION_AGENT_SETTINGS_KEY,
  LOCAL_AUDSEG_CAPTION_MODEL,
  LOCAL_ENGINE_SESSION_REQUEST_SCHEMA,
  LOCAL_WHISPER_CAPTION_MODEL,
  REQUIRED_WHISPER_CUE_DURATION_POLICY,
  captionAgentAudioFootprint,
  captionAgentCapabilityReady,
  captionAgentResumePlan,
  captionAgentRunClipLimit,
  captionAgentRunEstimate,
  captionAgentRuntimeIdentity,
  captionAgentSessionEndpoint,
  clearLocalMediaEngineSessionState,
  createCaptionAgentCheckpoint,
  createCaptionAgentRequest,
  discardCaptionAgentCheckpointsForClips,
  encodePcm16WavBase64,
  ensureCaptionAgentSession,
  isAudSegCaptionModel,
  localEngineDocumentClientNonce,
  loadCaptionAgentSettings,
  normalizeCaptionAgentCues,
  normalizeCaptionAgentEndpoint,
  normalizeCaptionAgentSettings,
  pairCaptionAgent,
  probeCaptionAgent,
  requestCaptionAgent,
  requestCaptionAgentWithSessionRetry,
  sameCaptionMediaIdentity,
  saveCaptionAgentSettings,
  upsertCaptionAgentCheckpoint,
  type CaptionAgentSettings,
  type CaptionCheckpoint
} from "../src/editor/caption-agent.js";
import {
  LOCAL_MEDIA_ENGINE_TRUST_SCHEMA,
  type LocalMediaEngineDevicePin,
  type LocalMediaEngineTrustStore
} from "../src/editor/local-media-engine-trust.js";
import {
  LOCAL_MEDIA_ENGINE_ENCRYPTED_SESSION_RESPONSE_SCHEMA,
  LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
  encodeBase64Url,
  localMediaEnginePublicKeyId
} from "../src/lib/local-media-engine-auth.js";
import {
  LOCAL_MEDIA_ENGINE_TRANSPORT_COUNTER_HEADER,
  LOCAL_MEDIA_ENGINE_TRANSPORT_ID_HEADER,
  LOCAL_MEDIA_ENGINE_TRANSPORT_REQUEST_SCHEMA,
  LOCAL_MEDIA_ENGINE_TRANSPORT_RESPONSE_SCHEMA
} from "../src/lib/local-media-engine-transport.js";
import {
  KIRINUKI_PUBLIC_STUDIO_ORIGIN
} from "../src/lib/local-runtime-origin.js";
import {
  createCaptionGatewayServer
} from "../scripts/caption-gateway.js";
import {
  LOCAL_WHISPERCPP_TRANSCRIPTION_MODE
} from "../src/caption-agent/caption-gateway-core.js";
import {
  LOCAL_VOD_RUNTIME_SCHEMA,
  PINNED_YT_DLP
} from "../scripts/local-vod-runtime-core.js";

const EXPIRED_SESSION_TOKEN = encodeBase64Url(
  new Uint8Array(32).fill(0x42)
);
const SESSION_SOURCE_URL = "https://chzzk.naver.com/video/14252987";

type CaptionRequest = ReturnType<typeof createCaptionAgentRequest>;

interface V2WireRecord {
  readonly method: string;
  readonly path: string;
  readonly requestBody: string;
  readonly responseBody: string;
  readonly status: number;
  readonly headers: Headers;
}

interface V2GatewayFixture {
  readonly fetchImpl: typeof fetch;
  readonly records: V2WireRecord[];
  readonly trustStore: Readonly<LocalMediaEngineTrustStore>;
}

function localCapability(overrides: Record<string, unknown> = {}) {
  return {
    schema: CAPTION_AGENT_CAPABILITY_SCHEMA,
    status: "ok",
    provider: "local-whispercpp",
    models: {
      stt: "ggml-tiny-q5_1.bin",
      captions: LOCAL_WHISPER_CAPTION_MODEL
    },
    availableModels: [LOCAL_WHISPER_CAPTION_MODEL],
    requestSchema: CAPTION_AGENT_REQUEST_SCHEMA,
    responseSchema: CAPTION_AGENT_RESPONSE_SCHEMA,
    cueDurationPolicy: REQUIRED_WHISPER_CUE_DURATION_POLICY,
    qualityHarness: {
      profile: CAPTION_QUALITY_PROFILE_ID,
      harnessFingerprint: CAPTION_HARNESS_FINGERPRINT
    },
    transcription: {
      mode: "local-whispercpp",
      vad: false,
      timestampClock: "original-audio",
      timingRevision: "vad-off-original-clock-v1"
    },
    ...overrides
  };
}

function project() {
  return {
    id: "project-1",
    name: "테스트 프로젝트",
    source: { streamerName: "테스트 스트리머" },
    clips: []
  };
}

function clip(overrides: Record<string, unknown> = {}) {
  return {
    id: "clip-1",
    note: "첫 컷",
    sourceStartMs: 1_000,
    sourceEndMs: 3_000,
    enabled: true,
    ...overrides
  };
}

function captionRequest() {
  return createCaptionAgentRequest({
    project: project(),
    clip: clip(),
    model: LOCAL_WHISPER_CAPTION_MODEL,
    audioBase64: encodePcm16WavBase64(new Float32Array(32_000))
  });
}

function completedResponse(
  request: CaptionRequest,
  overrides: Record<string, unknown> = {}
) {
  return {
    schema: CAPTION_AGENT_RESPONSE_SCHEMA,
    requestId: request.requestId,
    clipId: request.clip.id,
    language: "ko",
    sttModel: "ggml-tiny-q5_1.bin",
    captionModel: LOCAL_WHISPER_CAPTION_MODEL,
    model: LOCAL_WHISPER_CAPTION_MODEL,
    resolvedModel: "ggml-tiny-q5_1.bin",
    provider: "local-whispercpp",
    status: "completed",
    cues: [],
    warnings: [],
    qualityProfile: CAPTION_QUALITY_PROFILE_ID,
    harnessFingerprint: CAPTION_HARNESS_FINGERPRINT,
    editorialContextFingerprint: captionEditorialContextFingerprint(
      request.editorialContext
    ),
    qualityReport: {
      profileId: CAPTION_QUALITY_PROFILE_ID,
      harnessFingerprint: CAPTION_HARNESS_FINGERPRINT,
      valid: true,
      disposition: "accepted",
      violations: [],
      cueReviews: [],
      metrics: {}
    },
    ...overrides
  };
}

async function startV2CaptionGateway(
  t: TestContext
): Promise<V2GatewayFixture> {
  clearLocalMediaEngineSessionState();
  const keys = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const publicKeySpki = encodeBase64Url(new Uint8Array(
    await webcrypto.subtle.exportKey("spki", keys.publicKey)
  ));
  const keyId = await localMediaEnginePublicKeyId(publicKeySpki);
  assert.ok(keyId);
  const pin: Readonly<LocalMediaEngineDevicePin> = Object.freeze({
    schema: LOCAL_MEDIA_ENGINE_TRUST_SCHEMA,
    algorithm: LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
    keyId,
    publicKeySpki,
    enrolledAt: new Date().toISOString(),
    maxSeenVersion: "3.0.0"
  });
  const trustStore: Readonly<LocalMediaEngineTrustStore> = Object.freeze({
    read: async () => pin,
    pin: async () => pin,
    observeVersion: async (expectedKeyId: string, engineVersion: string) => {
      assert.equal(expectedKeyId, keyId);
      return Object.freeze({ ...pin, maxSeenVersion: engineVersion });
    },
    reset: async () => undefined
  });
  const stateRoot = await mkdtemp(path.join(
    os.tmpdir(),
    "kirinuki-caption-client-v2-"
  ));
  const runtime = createCaptionGatewayServer({
    deviceProofSigner: {
      algorithm: LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
      keyId,
      sign: async (transcript: Uint8Array) => encodeBase64Url(new Uint8Array(
        await webcrypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          keys.privateKey,
          Uint8Array.from(transcript).buffer
        )
      ))
    },
    pipelineRunner: async (body) => completedResponse(body as CaptionRequest),
    env: {
      KIRINUKI_STT_MODE: LOCAL_WHISPERCPP_TRANSCRIPTION_MODE,
      KIRINUKI_STT_ENDPOINT: "http://127.0.0.1:4318/test/inference",
      KIRINUKI_STT_MODEL: "tiny-q5_1",
      KIRINUKI_AGENT_TOKEN: encodeBase64Url(
        new Uint8Array(32).fill(0x61)
      ),
      KIRINUKI_ALLOWED_ORIGIN: KIRINUKI_PUBLIC_STUDIO_ORIGIN,
      KIRINUKI_LOCAL_ENGINE_VERSION: "3.0.0",
      KIRINUKI_MAX_AUDIO_BYTES: "1048576",
      KIRINUKI_VOD_RUNTIME_SCHEMA: LOCAL_VOD_RUNTIME_SCHEMA,
      KIRINUKI_VOD_RUNTIME_KIND: "vod-only",
      KIRINUKI_VOD_RUNTIME_READY: "1",
      KIRINUKI_VOD_YT_DLP_VERSION: PINNED_YT_DLP.version,
      KIRINUKI_VOD_EJS_VERSION: PINNED_YT_DLP.bundledJavascript.version,
      KIRINUKI_VOD_INSTANCE_NONCE: encodeBase64Url(
        new Uint8Array(32).fill(0x62)
      ),
      KIRINUKI_VOD_STATE_DIR: stateRoot
    }
  });
  await runtime.ready;
  await new Promise<void>((resolve, reject) => {
    runtime.server.once("error", reject);
    runtime.server.listen(0, "127.0.0.1", resolve);
  });
  const address = runtime.server.address();
  assert.ok(address && typeof address !== "string");
  const port = (address as AddressInfo).port;
  const records: V2WireRecord[] = [];
  const fetchImpl = (async (
    input: URL | RequestInfo,
    options: RequestInit = {}
  ) => {
    const originalUrl = new URL(String(input));
    assert.equal(originalUrl.origin, "http://127.0.0.1:4319");
    const mappedUrl = new URL(originalUrl);
    mappedUrl.port = String(port);
    const headers = new Headers(options.headers);
    headers.set("Origin", KIRINUKI_PUBLIC_STUDIO_ORIGIN);
    const response = await fetch(mappedUrl, { ...options, headers });
    records.push(Object.freeze({
      method: String(options.method || "GET").toUpperCase(),
      path: `${originalUrl.pathname}${originalUrl.search}`,
      requestBody: typeof options.body === "string" ? options.body : "",
      responseBody: await response.clone().text(),
      status: response.status,
      headers: new Headers(options.headers)
    }));
    return response;
  }) as typeof fetch;
  t.after(async () => {
    clearLocalMediaEngineSessionState();
    await runtime.shutdown({ graceMs: 0, deadlineMs: 2_000 });
    await rm(stateRoot, { recursive: true, force: true });
  });
  return { fetchImpl, records, trustStore };
}

test("자막 설정은 Whisper와 AudSeg 두 방식 및 loopback 주소만 허용한다", () => {
  assert.deepEqual(
    normalizeCaptionAgentSettings({
      endpoint: "http://localhost:4319/v1/captions",
      model: LOCAL_AUDSEG_CAPTION_MODEL,
      ignoredCredential: "discard-me"
    } as unknown as Partial<CaptionAgentSettings>),
    {
      endpoint: "http://localhost:4319/v1/captions",
      model: LOCAL_AUDSEG_CAPTION_MODEL
    }
  );
  assert.deepEqual(
    normalizeCaptionAgentSettings({
      endpoint: "https://captions.example/v1/captions",
      model: "removed-model"
    } as unknown as Partial<CaptionAgentSettings>),
    DEFAULT_CAPTION_AGENT_SETTINGS
  );
  assert.equal(isAudSegCaptionModel(LOCAL_AUDSEG_CAPTION_MODEL), true);
  assert.equal(isAudSegCaptionModel(LOCAL_WHISPER_CAPTION_MODEL), false);
});

test("내부 자막 엔진 주소는 앱의 로컬 연결만 허용하고 URL 자격정보를 거부한다", () => {
  assert.equal(
    normalizeCaptionAgentEndpoint("http://127.0.0.1:4319/v1/captions"),
    "http://127.0.0.1:4319/v1/captions"
  );
  assert.throws(
    () => normalizeCaptionAgentEndpoint("https://captions.example/v1/captions"),
      /내부 자막 엔진|로컬 연결/u
  );
  assert.throws(
    () => normalizeCaptionAgentEndpoint(
      "http://user:secret@127.0.0.1:4319/v1/captions"
    ),
    /아이디나 비밀번호/u
  );
  assert.throws(
    () => normalizeCaptionAgentEndpoint(
      "http://127.0.0.1:4319/v1/captions?token=secret"
    ),
    /쿼리 문자열/u
  );
});

test("세션 주소는 같은 loopback origin의 고정 경로다", () => {
  assert.equal(
    captionAgentSessionEndpoint(
      "http://localhost:4319/custom/captions"
    ),
    "http://localhost:4319/v1/session"
  );
});

test("과거 설정은 AudSeg 기본값으로 다시 시작하고 새 설정은 두 필드만 저장한다", async () => {
  const writes: unknown[] = [];
  const removals: unknown[] = [];
  const storage = {
    async get() {
      return {
        [LEGACY_CAPTION_AGENT_SETTINGS_KEY]: {
          endpoint: "https://old.example/v1/captions",
          model: "removed-model",
          obsoleteSecret: "must-not-survive"
        }
      };
    },
    async set(value: Record<string, unknown>) {
      writes.push(value);
    },
    async remove(keys: string | string[]) {
      removals.push(keys);
    }
  };
  const migrated = {
    endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
    model: LOCAL_AUDSEG_CAPTION_MODEL
  };
  assert.deepEqual(await loadCaptionAgentSettings(storage), migrated);
  const saved = await saveCaptionAgentSettings({
    endpoint: "http://localhost:4319/v1/captions",
    model: LOCAL_AUDSEG_CAPTION_MODEL,
    obsoleteSecret: "must-not-survive"
  } as unknown as Partial<CaptionAgentSettings>, storage);
  assert.deepEqual(saved, {
    endpoint: "http://localhost:4319/v1/captions",
    model: LOCAL_AUDSEG_CAPTION_MODEL
  });
  assert.deepEqual(writes, [
    { [CAPTION_AGENT_SETTINGS_KEY]: migrated },
    { [CAPTION_AGENT_SETTINGS_KEY]: saved }
  ]);
  assert.deepEqual(removals, [
    [
      "chzzk-kirinuki-caption-agent-settings-v3",
      LEGACY_CAPTION_AGENT_SETTINGS_KEY,
      "chzzk-kirinuki-caption-agent-settings-v1"
    ],
    [
      "chzzk-kirinuki-caption-agent-settings-v3",
      LEGACY_CAPTION_AGENT_SETTINGS_KEY,
      "chzzk-kirinuki-caption-agent-settings-v1"
    ]
  ]);
  assert.equal(JSON.stringify(writes).includes("must-not-survive"), false);
});

test("이전 세션에서 Whisper를 연결했어도 새 편집기 화면은 AudSeg로 시작한다", async () => {
  const writes: unknown[] = [];
  const storage = {
    async get() {
      return {
        [CAPTION_AGENT_SETTINGS_KEY]: {
          endpoint: "http://localhost:5432/v1/captions",
          model: LOCAL_WHISPER_CAPTION_MODEL
        }
      };
    },
    async set(value: Record<string, unknown>) {
      writes.push(value);
    },
    async remove() {}
  };

  const loaded = await loadCaptionAgentSettings(storage);

  assert.deepEqual(loaded, {
    endpoint: "http://localhost:5432/v1/captions",
    model: LOCAL_AUDSEG_CAPTION_MODEL
  });
  assert.deepEqual(writes, [{
    [CAPTION_AGENT_SETTINGS_KEY]: loaded
  }]);
});

test("AudSeg 설정 저장은 사용하지 않는 malformed Whisper endpoint에 막히지 않는다", async () => {
  const writes: unknown[] = [];
  const storage = {
    async get() {
      return {};
    },
    async set(value: Record<string, unknown>) {
      writes.push(value);
    },
    async remove() {}
  };
  const saved = await saveCaptionAgentSettings({
    endpoint: "not-a-loopback-url",
    model: LOCAL_AUDSEG_CAPTION_MODEL,
    obsoleteSecret: "must-not-survive"
  } as unknown as Partial<CaptionAgentSettings>, storage);
  assert.deepEqual(saved, {
    endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
    model: LOCAL_AUDSEG_CAPTION_MODEL
  });
  assert.deepEqual(writes, [{
    [CAPTION_AGENT_SETTINGS_KEY]: saved
  }]);
  await assert.rejects(
    saveCaptionAgentSettings({
      endpoint: "not-a-loopback-url",
      model: LOCAL_WHISPER_CAPTION_MODEL
    }, storage),
    /올바른 URL/u
  );
});

test("Whisper와 AudSeg runtime identity를 서로 다른 로컬 pipeline으로 고정한다", () => {
  const whisper = captionAgentRuntimeIdentity(localCapability(), {
    model: LOCAL_WHISPER_CAPTION_MODEL
  });
  assert.equal(whisper.provider, "local-whispercpp");
  assert.equal(whisper.transcriptionMode, "local-whispercpp");
  assert.match(whisper.fingerprint, /^caption-pipeline-v3-/u);

  const audseg = captionAgentRuntimeIdentity(null, {
    model: LOCAL_AUDSEG_CAPTION_MODEL
  });
  assert.deepEqual(
    {
      provider: audseg.provider,
      sttModel: audseg.sttModel,
      transcriptionMode: audseg.transcriptionMode
    },
    {
      provider: "local-audseg",
      sttModel: `audseg-${AUDSEG_ENGINE_VERSION}-dsp`,
      transcriptionMode: "browser-audio-activity"
    }
  );
  assert.equal(audseg.fingerprint, AUDSEG_PIPELINE_FINGERPRINT);
  assert.notEqual(whisper.fingerprint, audseg.fingerprint);
  assert.throws(
    () => captionAgentRuntimeIdentity(localCapability({
      provider: "unknown"
    }), { model: LOCAL_WHISPER_CAPTION_MODEL }),
    /STT 제공자/u
  );
  assert.throws(
    () => captionAgentRuntimeIdentity(localCapability({
      transcription: { mode: "local-whispercpp", vad: true }
    }), { model: LOCAL_WHISPER_CAPTION_MODEL }),
    /VAD-off/u
  );
  assert.throws(
    () => captionAgentRuntimeIdentity(localCapability({
      transcription: { mode: "local-whispercpp" }
    }), { model: LOCAL_WHISPER_CAPTION_MODEL }),
    /VAD-off/u
  );
  assert.throws(
    () => captionAgentRuntimeIdentity(localCapability({
      transcription: {
        mode: "local-whispercpp",
        vad: false,
        timestampClock: "vad-audio",
        timingRevision: "vad-off-original-clock-v1"
      }
    }), { model: LOCAL_WHISPER_CAPTION_MODEL }),
    /시간축 계약/u
  );
  assert.throws(
    () => captionAgentRuntimeIdentity(localCapability({
      transcription: {
        mode: "local-whispercpp",
        vad: false,
        timingRevision: "vad-off-original-clock-v1"
      }
    }), { model: LOCAL_WHISPER_CAPTION_MODEL }),
    /타임스탬프 시간축/u
  );
  assert.throws(
    () => captionAgentRuntimeIdentity(localCapability({
      transcription: {
        mode: "local-whispercpp",
        vad: false,
        timestampClock: "original-audio",
        timingRevision: "legacy-vad-clock"
      }
    }), { model: LOCAL_WHISPER_CAPTION_MODEL }),
    /시간축 계약/u
  );
  assert.throws(
    () => captionAgentRuntimeIdentity(localCapability({
      transcription: {
        mode: "local-whispercpp",
        vad: false,
        timestampClock: "original-audio"
      }
    }), { model: LOCAL_WHISPER_CAPTION_MODEL }),
    /타임스탬프 실행 버전/u
  );
  assert.throws(
    () => captionAgentRuntimeIdentity(localCapability({
      cueDurationPolicy: "maximum-4000ms"
    }), { model: LOCAL_WHISPER_CAPTION_MODEL }),
    /원본 시간축/u
  );
  assert.throws(
    () => captionAgentRuntimeIdentity(localCapability({
      qualityHarness: {
        profile: "kr-vtuber-clean-v1",
        harnessFingerprint: "legacy-four-second-harness"
      }
    }), { model: LOCAL_WHISPER_CAPTION_MODEL }),
    /품질 하네스/u
  );
});

test("Whisper capability 준비 상태는 gateway의 두 신호가 모두 true일 때만 통과한다", () => {
  const readyCapability = localCapability({
    configured: { localWhisperReady: true },
    transcription: {
      mode: "local-whispercpp",
      vad: false,
      timestampClock: "original-audio",
      timingRevision: "vad-off-original-clock-v1",
      ready: true
    }
  });
  assert.equal(captionAgentCapabilityReady(readyCapability), true);
  assert.equal(captionAgentCapabilityReady(localCapability({
    configured: { localWhisperReady: false },
    transcription: { ready: true }
  })), false);
  assert.equal(captionAgentCapabilityReady(localCapability({
    configured: { localWhisperReady: true },
    transcription: { ready: false }
  })), false);
  assert.equal(captionAgentCapabilityReady(localCapability({
    configured: { ready: true },
    transcription: { ready: true }
  })), false);
  assert.equal(captionAgentCapabilityReady(localCapability()), false);
  assert.equal(captionAgentCapabilityReady(null), false);
});

test("실행 예상량은 companion 요청과 브라우저 초벌을 구분한다", () => {
  const clips = [
    clip(),
    clip({ id: "clip-2", sourceStartMs: 5_000, sourceEndMs: 8_000 }),
    clip({ id: "disabled", enabled: false })
  ];
  assert.deepEqual(captionAgentRunEstimate(clips, {
    model: LOCAL_WHISPER_CAPTION_MODEL
  }), {
    clipCount: 2,
    totalDurationMs: 5_000,
    companionRequests: 2,
    browserDrafts: 0
  });
  assert.deepEqual(captionAgentRunEstimate(clips, {
    model: LOCAL_AUDSEG_CAPTION_MODEL
  }), {
    clipCount: 2,
    totalDurationMs: 5_000,
    companionRequests: 0,
    browserDrafts: 2
  });
});

test("AudSeg는 21개 활성 컷을 보존해 재개하고 Whisper만 16개로 제한한다", () => {
  const clips = Array.from({ length: 21 }, (_, index) => clip({
    id: `clip-${index + 1}`,
    sourceStartMs: index * 2_000,
    sourceEndMs: index * 2_000 + 1_000
  }));
  assert.equal(captionAgentRunClipLimit(LOCAL_AUDSEG_CAPTION_MODEL), null);
  assert.equal(captionAgentRunClipLimit(LOCAL_WHISPER_CAPTION_MODEL), 16);
  assert.equal(captionAgentRunEstimate(clips, {
    model: LOCAL_AUDSEG_CAPTION_MODEL
  }).clipCount, 21);

  let checkpoints: CaptionCheckpoint[] = [];
  for (const target of clips) {
    checkpoints = upsertCaptionAgentCheckpoint(
      checkpoints,
      createCaptionAgentCheckpoint(
        target,
        LOCAL_AUDSEG_CAPTION_MODEL,
        {
          editorialContextFingerprint: "audseg-no-editorial-context-v1",
          pipelineFingerprint: AUDSEG_PIPELINE_FINGERPRINT
        }
      ),
      { maximum: clips.length }
    );
  }
  assert.equal(checkpoints.length, 21);
  assert.deepEqual(captionAgentResumePlan(
    clips,
    checkpoints,
    LOCAL_AUDSEG_CAPTION_MODEL,
    {
      resume: true,
      editorialContextFingerprint: "audseg-no-editorial-context-v1",
      pipelineFingerprint: AUDSEG_PIPELINE_FINGERPRINT
    }
  ), {
    clips: [],
    skippedClipIds: clips.map((target) => target.id)
  });
});

test("방식과 pipeline 지문이 같은 완료 컷만 재개한다", () => {
  const target = clip();
  const checkpoint = createCaptionAgentCheckpoint(
    target,
    LOCAL_AUDSEG_CAPTION_MODEL,
    {
      editorialContextFingerprint: "context-1",
      pipelineFingerprint: "audseg-pipeline-1"
    }
  );
  assert.deepEqual(captionAgentResumePlan(
    [target],
    [checkpoint],
    LOCAL_AUDSEG_CAPTION_MODEL,
    {
      resume: true,
      editorialContextFingerprint: "context-1",
      pipelineFingerprint: "audseg-pipeline-1"
    }
  ), {
    clips: [],
    skippedClipIds: ["clip-1"]
  });
  assert.equal(captionAgentResumePlan(
    [target],
    [checkpoint],
    LOCAL_WHISPER_CAPTION_MODEL,
    {
      resume: true,
      editorialContextFingerprint: "context-1",
      pipelineFingerprint: "whisper-pipeline-1"
    }
  ).clips.length, 1);

  const updated = upsertCaptionAgentCheckpoint([], checkpoint);
  assert.equal(updated.length, 1);
  assert.deepEqual(
    discardCaptionAgentCheckpointsForClips(updated, [target]),
    []
  );
});

test("VAD-on 구 pipeline 체크포인트는 VAD-off runtime에서 전부 다시 처리한다", () => {
  const clips = Array.from({ length: 15 }, (_, index) => clip({
    id: `clip-${index + 1}`,
    sourceStartMs: index * 3_000,
    sourceEndMs: index * 3_000 + 2_000
  }));
  const oldPipelineFingerprint = "caption-pipeline-v1-c333e46fcc847feb";
  const newPipelineFingerprint = captionAgentRuntimeIdentity(
    localCapability(),
    { model: LOCAL_WHISPER_CAPTION_MODEL }
  ).fingerprint;
  const checkpoints = clips.map((target) => createCaptionAgentCheckpoint(
    target,
    LOCAL_WHISPER_CAPTION_MODEL,
    {
      editorialContextFingerprint: "context-1",
      pipelineFingerprint: oldPipelineFingerprint
    }
  ));

  assert.notEqual(newPipelineFingerprint, oldPipelineFingerprint);
  assert.deepEqual(captionAgentResumePlan(
    clips,
    checkpoints,
    LOCAL_WHISPER_CAPTION_MODEL,
    {
      resume: true,
      editorialContextFingerprint: "context-1",
      pipelineFingerprint: newPipelineFingerprint
    }
  ), {
    clips,
    skippedClipIds: []
  });
});

test("미디어 identity는 모든 안정 필드가 같아야 한다", () => {
  const identity = {
    name: "source.webm",
    size: 100,
    lastModified: 200,
    durationMs: 3_000,
    mediaOriginMs: 0,
    width: 1920,
    height: 1080,
    codec: "vp9",
    audioCodec: "opus"
  };
  assert.equal(sameCaptionMediaIdentity(identity, { ...identity }), true);
  assert.equal(sameCaptionMediaIdentity(identity, {
    ...identity,
    size: 101
  }), false);
});

test("16kHz PCM을 상한 내 WAV로 인코딩한다", () => {
  assert.deepEqual(captionAgentAudioFootprint(1_000), {
    durationMs: 1_000,
    sampleCount: 16_000,
    floatPcmBytes: 64_000,
    wavBytes: 32_044,
    base64Bytes: 42_728
  });
  const encoded = encodePcm16WavBase64(new Float32Array([0, 1, -1]));
  const decoded = Buffer.from(encoded, "base64");
  assert.equal(decoded.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(decoded.readUInt32LE(24), 16_000);
  assert.throws(
    () => captionAgentAudioFootprint(31 * 60 * 1_000),
    /30분/u
  );
});

test("companion 요청은 Whisper 전용이며 화면 분석 payload를 만들지 않는다", () => {
  const request = captionRequest();
  assert.equal(request.schema, CAPTION_AGENT_REQUEST_SCHEMA);
  assert.equal(request.model, LOCAL_WHISPER_CAPTION_MODEL);
  assert.equal(Object.hasOwn(request, "visual"), false);
  assert.equal(request.audio.sampleRateHz, 16_000);
  assert.equal(
    request.policy.cueDurationPolicy,
    REQUIRED_WHISPER_CUE_DURATION_POLICY
  );
  assert.throws(
    () => createCaptionAgentRequest({
      project: project(),
      clip: clip(),
      model: LOCAL_AUDSEG_CAPTION_MODEL,
      audioBase64: "AA=="
    }),
    /브라우저에서 직접/u
  );
});

test("수신 cue는 원본 표시 시간·하단 위치·마침표 계약을 적용한다", () => {
  assert.deepEqual(normalizeCaptionAgentCues([{
    startMs: 100,
    endMs: 5_000,
    text: "안녕하세요.",
    speakerId: "main",
    reviewRequired: false,
    placement: "top"
  }], 5_500), [{
    startOffsetMs: 100,
    endOffsetMs: 5_000,
    text: "안녕하세요",
    y: 0.84,
    remoteMeta: {
      speakerId: "main",
      reviewRequired: false,
      placement: "bottom"
    }
  }]);
  assert.equal(
    normalizeCaptionAgentCues([{
      startMs: 0,
      endMs: 9_000,
      text: "원본 발화가 길게 이어지는 자막",
      speakerId: "main",
      reviewRequired: false,
      placement: "bottom"
    }], 9_000)[0]?.endOffsetMs,
    9_000
  );
});

test("pairing은 현재 문서·프로젝트·원본에 묶인 memory capability만 받는다", async (t) => {
  const fixture = await startV2CaptionGateway(t);
  const token = await pairCaptionAgent({
    endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
    purpose: "vod",
    projectId: "project-1",
    sourceUrl: SESSION_SOURCE_URL,
    fetchImpl: fixture.fetchImpl,
    trustStore: fixture.trustStore
  });
  assert.match(token, /^[A-Za-z0-9_-]{43}$/u);
  const pairCall = fixture.records.find((record) => (
    record.path === "/v1/session" && record.method === "POST"
  ));
  assert.ok(pairCall);
  const headers = pairCall.headers;
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(
    headers.get("x-kirinuki-protocol"),
    LOCAL_ENGINE_SESSION_REQUEST_SCHEMA
  );
  assert.equal(
    headers.get("x-kirinuki-client-nonce"),
    localEngineDocumentClientNonce()
  );
  assert.deepEqual(
    Object.keys(JSON.parse(pairCall.requestBody) as object).sort(),
    ["ciphertext", "clientPublicKey", "grantId", "iv", "schema"]
  );
  assert.doesNotMatch(
    pairCall.requestBody,
    /project-1|chzzk|vod|cache-delete/u
  );
  assert.equal(
    (JSON.parse(pairCall.responseBody) as Record<string, unknown>).schema,
    LOCAL_MEDIA_ENGINE_ENCRYPTED_SESSION_RESPONSE_SCHEMA
  );
  assert.doesNotMatch(pairCall.responseBody, new RegExp(token, "u"));
});

test("Whisper 요청은 session bearer를 암호화해 보내고 완료 응답을 검증한다", async (t) => {
  const fixture = await startV2CaptionGateway(t);
  const token = await pairCaptionAgent({
    endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
    purpose: "captions",
    projectId: "project-1",
    fetchImpl: fixture.fetchImpl,
    trustStore: fixture.trustStore
  });
  fixture.records.length = 0;
  const request = captionRequest();
  const payload = await requestCaptionAgent({
    endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
    token,
    request,
    fetchImpl: fixture.fetchImpl
  });
  assert.equal(payload.provider, "local-whispercpp");
  const captionCall = fixture.records.find((record) => (
    record.path === "/v1/captions" && record.method === "POST"
  ));
  assert.ok(captionCall);
  assert.equal(captionCall.headers.get("Authorization"), null);
  assert.equal(
    captionCall.headers.get("X-Kirinuki-Client-Nonce"),
    localEngineDocumentClientNonce()
  );
  assert.match(
    String(captionCall.headers.get(LOCAL_MEDIA_ENGINE_TRANSPORT_ID_HEADER)),
    /^[A-Za-z0-9_-]{43}$/u
  );
  assert.equal(
    captionCall.headers.get(LOCAL_MEDIA_ENGINE_TRANSPORT_COUNTER_HEADER),
    "1"
  );
  assert.equal(
    (JSON.parse(captionCall.requestBody) as Record<string, unknown>).schema,
    LOCAL_MEDIA_ENGINE_TRANSPORT_REQUEST_SCHEMA
  );
  assert.equal(
    (JSON.parse(captionCall.responseBody) as Record<string, unknown>).schema,
    LOCAL_MEDIA_ENGINE_TRANSPORT_RESPONSE_SCHEMA
  );
  assert.doesNotMatch(captionCall.requestBody, new RegExp(token, "u"));
  assert.doesNotMatch(captionCall.requestBody, /project-1|wavBase64/u);
  assert.doesNotMatch(captionCall.responseBody, /local-whispercpp/u);
});

test("Whisper capability probe는 body가 가능한 encrypted POST만 사용한다", async (t) => {
  const fixture = await startV2CaptionGateway(t);
  const token = await pairCaptionAgent({
    endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
    purpose: "captions",
    projectId: "project-probe",
    fetchImpl: fixture.fetchImpl,
    trustStore: fixture.trustStore
  });
  fixture.records.length = 0;

  const payload = await probeCaptionAgent({
    endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
    token,
    fetchImpl: fixture.fetchImpl
  });

  assert.equal(payload.provider, "local-whispercpp");
  assert.equal(fixture.records.length, 1);
  const [probeCall] = fixture.records;
  assert.ok(probeCall);
  assert.equal(probeCall.path, "/v1/captions");
  assert.equal(probeCall.method, "POST");
  assert.equal(
    (JSON.parse(probeCall.requestBody) as Record<string, unknown>).schema,
    LOCAL_MEDIA_ENGINE_TRANSPORT_REQUEST_SCHEMA
  );
  assert.doesNotMatch(probeCall.requestBody, new RegExp(token, "u"));
});

test("만료 session은 한 번 다시 pair한 뒤 같은 Whisper 요청을 재시도한다", async (t) => {
  const fixture = await startV2CaptionGateway(t);
  await pairCaptionAgent({
    endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
    purpose: "captions",
    projectId: "project-1",
    fetchImpl: fixture.fetchImpl,
    trustStore: fixture.trustStore
  });
  fixture.records.length = 0;
  const request = captionRequest();
  let refreshedToken = "";
  const payload = await requestCaptionAgentWithSessionRetry({
    endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
    token: EXPIRED_SESSION_TOKEN,
    projectId: "project-1",
    request,
    onSessionToken(value: string) {
      refreshedToken = value;
    },
    fetchImpl: fixture.fetchImpl,
    trustStore: fixture.trustStore
  });
  assert.equal(payload.status, "completed");
  assert.equal(
    fixture.records.filter((record) => (
      record.path === "/v1/session" && record.method === "POST"
    )).length,
    1
  );
  const captionCalls = fixture.records.filter((record) => (
    record.path === "/v1/captions" && record.method === "POST"
  ));
  assert.equal(captionCalls.length, 2);
  assert.deepEqual(captionCalls.map((record) => record.status), [401, 200]);
  assert.match(refreshedToken, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(refreshedToken, EXPIRED_SESSION_TOKEN);
});

test("유효한 session이면 encrypted status 성공 후 그대로 재사용한다", async (t) => {
  const fixture = await startV2CaptionGateway(t);
  const currentToken = await pairCaptionAgent({
    endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
    purpose: "captions",
    projectId: "project-1",
    fetchImpl: fixture.fetchImpl,
    trustStore: fixture.trustStore
  });
  fixture.records.length = 0;
  const token = await ensureCaptionAgentSession({
    endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
    token: currentToken,
    purpose: "captions",
    projectId: "project-1",
    fetchImpl: fixture.fetchImpl,
    trustStore: fixture.trustStore
  });
  assert.equal(token, currentToken);
  assert.equal(fixture.records.length, 1);
  const [statusCall] = fixture.records;
  assert.ok(statusCall);
  assert.equal(statusCall.path, "/v1/session/status");
  assert.equal(statusCall.method, "POST");
  assert.equal(statusCall.status, 200);
  assert.equal(statusCall.headers.get("Authorization"), null);
  assert.equal(
    (JSON.parse(statusCall.requestBody) as Record<string, unknown>).schema,
    LOCAL_MEDIA_ENGINE_TRANSPORT_REQUEST_SCHEMA
  );
});
