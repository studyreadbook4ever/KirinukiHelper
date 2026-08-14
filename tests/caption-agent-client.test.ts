import assert from "node:assert/strict";
import test from "node:test";

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
  CAPTION_AGENT_SESSION_SCHEMA,
  CAPTION_AGENT_SETTINGS_KEY,
  DEFAULT_CAPTION_AGENT_SETTINGS,
  LEGACY_CAPTION_AGENT_SETTINGS_KEY,
  LOCAL_AUDSEG_CAPTION_MODEL,
  LOCAL_WHISPER_CAPTION_MODEL,
  REQUIRED_WHISPER_CUE_DURATION_POLICY,
  captionAgentAudioFootprint,
  captionAgentCapabilityReady,
  captionAgentResumePlan,
  captionAgentRunClipLimit,
  captionAgentRunEstimate,
  captionAgentRuntimeIdentity,
  captionAgentSessionEndpoint,
  createCaptionAgentCheckpoint,
  createCaptionAgentRequest,
  discardCaptionAgentCheckpointsForClips,
  encodePcm16WavBase64,
  ensureCaptionAgentSession,
  isAudSegCaptionModel,
  loadCaptionAgentSettings,
  normalizeCaptionAgentCues,
  normalizeCaptionAgentEndpoint,
  normalizeCaptionAgentSettings,
  pairCaptionAgent,
  requestCaptionAgent,
  requestCaptionAgentWithSessionRetry,
  sameCaptionMediaIdentity,
  saveCaptionAgentSettings,
  upsertCaptionAgentCheckpoint,
  type CaptionAgentSettings,
  type CaptionCheckpoint
} from "../src/editor/caption-agent.js";

type CaptionRequest = ReturnType<typeof createCaptionAgentRequest>;

interface FetchCall {
  url: URL | RequestInfo;
  options: RequestInit;
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
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

test("companion 주소는 loopback HTTP만 허용하고 URL 자격정보를 거부한다", () => {
  assert.equal(
    normalizeCaptionAgentEndpoint("http://127.0.0.1:4319/v1/captions"),
    "http://127.0.0.1:4319/v1/captions"
  );
  assert.throws(
    () => normalizeCaptionAgentEndpoint("https://captions.example/v1/captions"),
    /127\.0\.0\.1/u
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

test("pairing은 process-memory session 응답만 받는다", async () => {
  const calls: FetchCall[] = [];
  const token = await pairCaptionAgent({
    endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
    fetchImpl: async (url, options) => {
      assert.ok(options);
      calls.push({ url, options });
      return jsonResponse({
        schema: CAPTION_AGENT_SESSION_SCHEMA,
        status: "ok",
        authentication: "bearer-process-memory",
        expires: "companion-restart",
        token: "local-session-token"
      });
    }
  });
  assert.equal(token, "local-session-token");
  const [pairCall] = calls;
  assert.ok(pairCall);
  assert.equal(pairCall.url, "http://127.0.0.1:4319/v1/session");
  assert.equal(pairCall.options.method, "POST");
});

test("Whisper 요청은 session bearer만 보내고 완료 응답을 검증한다", async () => {
  const request = captionRequest();
  const calls: FetchCall[] = [];
  const payload = await requestCaptionAgent({
    endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
    token: "local-session-token",
    request,
    fetchImpl: async (url, options) => {
      assert.ok(options);
      calls.push({ url, options });
      return jsonResponse(completedResponse(request));
    }
  });
  assert.equal(payload.provider, "local-whispercpp");
  const [captionCall] = calls;
  assert.ok(captionCall);
  assert.equal(
    new Headers(captionCall.options.headers).get("Authorization"),
    "Bearer local-session-token"
  );
  assert.equal(
    [...new Headers(captionCall.options.headers).keys()].some(
      (name) => /key|credential/iu.test(name)
    ),
    false
  );
});

test("만료 session은 한 번 다시 pair한 뒤 같은 Whisper 요청을 재시도한다", async () => {
  const request = captionRequest();
  let captionCalls = 0;
  let sessionCalls = 0;
  let refreshedToken = "";
  const payload = await requestCaptionAgentWithSessionRetry({
    endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
    token: "expired-token",
    request,
    onSessionToken(value: string) {
      refreshedToken = value;
    },
    fetchImpl: async (url, options) => {
      if (String(url).endsWith("/v1/session")) {
        sessionCalls += 1;
        return jsonResponse({
          schema: CAPTION_AGENT_SESSION_SCHEMA,
          status: "ok",
          authentication: "bearer-process-memory",
          expires: "companion-restart",
          token: "fresh-token"
        });
      }
      captionCalls += 1;
      if (captionCalls === 1) {
        return jsonResponse({
          error: { code: "SESSION_EXPIRED" }
        }, 401);
      }
      assert.equal(
        new Headers(options?.headers).get("Authorization"),
        "Bearer fresh-token"
      );
      return jsonResponse(completedResponse(request));
    }
  });
  assert.equal(payload.status, "completed");
  assert.equal(sessionCalls, 1);
  assert.equal(captionCalls, 2);
  assert.equal(refreshedToken, "fresh-token");
});

test("유효한 session이면 probe 성공 후 그대로 재사용한다", async () => {
  const token = await ensureCaptionAgentSession({
    endpoint: DEFAULT_CAPTION_AGENT_SETTINGS.endpoint,
    token: "current-token",
    fetchImpl: async (_url, options) => {
      assert.equal(
        new Headers(options?.headers).get("Authorization"),
        "Bearer current-token"
      );
      return jsonResponse(localCapability());
    }
  });
  assert.equal(token, "current-token");
});
