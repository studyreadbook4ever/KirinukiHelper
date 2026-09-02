import assert from "node:assert/strict";
import test from "node:test";

import {
  CHZZK_VOD_HANDLE_MS,
  CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA,
  CHZZK_VOD_CACHE_PURGE_RESULT_SCHEMA,
  CHZZK_VOD_CONSUMER_CACHE_PURGE_REQUEST_SCHEMA,
  CHZZK_VOD_CONSUMER_CACHE_PURGE_RESULT_SCHEMA,
  CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA,
  CHZZK_VOD_MATERIALIZATION_STATUS_SCHEMA,
  KIRINUKI_MEDIA_ENGINE_ENDPOINT,
  ChzzkVodMaterializationClientError,
  cancelChzzkVodMaterialization,
  chzzkVodMaterializationEndpoint,
  normalizeChzzkVodMaterializationStatus,
  normalizeChzzkVodCachePurgeResult,
  normalizeChzzkVodConsumerCachePurgeResult,
  purgeChzzkVodConsumerSessionCache,
  purgeChzzkVodMaterializedCache,
  startChzzkVodMaterialization,
  waitForChzzkVodMaterialization
} from "../src/editor/chzzk-vod-client.js";
import {
  localEngineDocumentClientNonce
} from "../src/editor/caption-agent.js";
import {
  establishLocalMediaEngineTransport,
  forgetLocalMediaEngineTransport
} from "../src/editor/local-media-engine-transport.js";
import {
  decodeBase64Url,
  encodeBase64Url
} from "../src/lib/local-media-engine-auth.js";
import {
  LOCAL_MEDIA_ENGINE_TRANSPORT_COUNTER_HEADER,
  LOCAL_MEDIA_ENGINE_TRANSPORT_ID_HEADER,
  LOCAL_MEDIA_ENGINE_TRANSPORT_RESPONSE_SCHEMA,
  localMediaEngineTransportAad,
  parseLocalMediaEngineTransportRequest
} from "../src/lib/local-media-engine-transport.js";
import {
  SOOP_VOD_SOURCE_CLOCK_IDENTITY_SCHEMA
} from "../src/lib/soop-vod-source-clock.js";

const ENDPOINT = "http://127.0.0.1:4319/v1/captions";
const TOKEN = encodeBase64Url(new Uint8Array(32).fill(0x31));
const TRANSPORT_ID = encodeBase64Url(new Uint8Array(32).fill(0x32));
const TRANSPORT_KEY = new Uint8Array(32).fill(0x33);
const JOB_ID = "job_0123456789abcdef";
const CONSUMER_ID = "project-client-test";

type PlaintextFetch = (
  input: URL | RequestInfo,
  init?: RequestInit
) => Promise<Response>;

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

async function encryptedTransportFixture(
  plaintextFetch: PlaintextFetch
): Promise<typeof fetch> {
  const clientNonce = localEngineDocumentClientNonce();
  await establishLocalMediaEngineTransport({
    transportId: TRANSPORT_ID,
    clientNonce,
    sharedKey: TRANSPORT_KEY
  });
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    ownedArrayBuffer(TRANSPORT_KEY),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  return (async (
    input: URL | RequestInfo,
    init: RequestInit = {}
  ): Promise<Response> => {
    const url = new URL(String(input));
    assert.equal(url.origin, "http://127.0.0.1:4319");
    const method = String(init.method || "GET").toUpperCase();
    const path = `${url.pathname}${url.search}`;
    const headers = new Headers(init.headers);
    const protocol = headers.get("X-Kirinuki-Protocol") || "";
    assert.equal(headers.get("X-Kirinuki-Client-Nonce"), clientNonce);
    assert.equal(headers.get("Authorization"), null);
    assert.equal(headers.get("X-Kirinuki-Media-Access"), null);
    assert.equal(headers.get(LOCAL_MEDIA_ENGINE_TRANSPORT_ID_HEADER), TRANSPORT_ID);
    const requestBody = String(init.body || "");
    assert.doesNotMatch(requestBody, new RegExp(TOKEN, "u"));
    const encrypted = parseLocalMediaEngineTransportRequest(
      JSON.parse(requestBody)
    );
    assert.ok(encrypted);
    assert.equal(encrypted.transportId, TRANSPORT_ID);
    assert.equal(
      headers.get(LOCAL_MEDIA_ENGINE_TRANSPORT_COUNTER_HEADER),
      String(encrypted.counter)
    );
    const requestIv = decodeBase64Url(encrypted.iv);
    assert.ok(requestIv);
    const plaintextBytes = await globalThis.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: ownedArrayBuffer(requestIv),
        additionalData: ownedArrayBuffer(localMediaEngineTransportAad({
          direction: "request",
          transportId: TRANSPORT_ID,
          counter: encrypted.counter,
          method,
          path,
          protocol,
          clientNonce,
          iv: encrypted.iv
        })),
        tagLength: 128
      },
      key,
      ownedArrayBuffer(decodeBase64Url(encrypted.ciphertext) || new Uint8Array())
    );
    const plaintext = JSON.parse(
      new TextDecoder().decode(plaintextBytes)
    ) as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(plaintext).sort(),
      ["bodyText", "mediaAccess", "token"]
    );
    assert.equal(plaintext.token, TOKEN);
    assert.ok(
      plaintext.mediaAccess === null
        || typeof plaintext.mediaAccess === "string"
    );
    assert.ok(
      plaintext.bodyText === null || typeof plaintext.bodyText === "string"
    );
    const plaintextHeaders = new Headers(headers);
    plaintextHeaders.delete(LOCAL_MEDIA_ENGINE_TRANSPORT_ID_HEADER);
    plaintextHeaders.delete(LOCAL_MEDIA_ENGINE_TRANSPORT_COUNTER_HEADER);
    plaintextHeaders.set("Authorization", `Bearer ${TOKEN}`);
    if (typeof plaintext.mediaAccess === "string") {
      plaintextHeaders.set("X-Kirinuki-Media-Access", plaintext.mediaAccess);
    }
    const plaintextInit: RequestInit = {
      ...init,
      method,
      headers: plaintextHeaders
    };
    delete plaintextInit.body;
    if (typeof plaintext.bodyText === "string") {
      plaintextInit.body = plaintext.bodyText;
    }
    const plaintextResponse = await plaintextFetch(input, plaintextInit);
    const responseText = await plaintextResponse.text();
    const responseIvBytes = new Uint8Array(12);
    globalThis.crypto.getRandomValues(responseIvBytes);
    const responseIv = encodeBase64Url(responseIvBytes);
    const responseCiphertext = new Uint8Array(
      await globalThis.crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: ownedArrayBuffer(responseIvBytes),
          additionalData: ownedArrayBuffer(localMediaEngineTransportAad({
            direction: "response",
            transportId: TRANSPORT_ID,
            counter: encrypted.counter,
            method,
            path,
            protocol,
            clientNonce,
            iv: responseIv,
            status: plaintextResponse.status
          })),
          tagLength: 128
        },
        key,
        ownedArrayBuffer(new TextEncoder().encode(responseText))
      )
    );
    const responseBody = JSON.stringify({
      schema: LOCAL_MEDIA_ENGINE_TRANSPORT_RESPONSE_SCHEMA,
      transportId: TRANSPORT_ID,
      counter: encrypted.counter,
      iv: responseIv,
      ciphertext: encodeBase64Url(responseCiphertext)
    });
    assert.doesNotMatch(responseBody, new RegExp(TOKEN, "u"));
    assert.equal(responseBody.includes(responseText), false);
    return new Response(responseBody, {
      status: plaintextResponse.status,
      statusText: plaintextResponse.statusText,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }) as typeof fetch;
}

test.afterEach(() => {
  forgetLocalMediaEngineTransport();
});

const SOOP_SOURCE_CLOCK_IDENTITY = Object.freeze({
  schema: SOOP_VOD_SOURCE_CLOCK_IDENTITY_SCHEMA,
  platform: "SOOP" as const,
  contentId: "169475287",
  totalDurationSeconds: 180,
  parts: Object.freeze([Object.freeze({
    id: "20260814_TEST_169475287_1",
    index: 0,
    order: 1,
    durationSeconds: 180
  })])
});

function purgeMaterialization() {
  const planFingerprint = `${"a".repeat(32)}${"b".repeat(32)}`;
  return {
    schema: "chzzk-kirinuki-chzzk-vod-materialization/v2",
    materializationId: planFingerprint.slice(0, 32),
    planFingerprint,
    source: {
      platform: "CHZZK",
      contentType: "vod",
      contentId: "14252987",
      sourceVersionId: "c".repeat(64)
    },
    sourceDurationMs: 200_000,
    handleMs: 10_000,
    mediaDurationMs: 30_000,
    windows: [{
      id: "window-1",
      editableSourceStartMs: 60_000,
      editableSourceEndMs: 90_000,
      fetchedSourceStartMs: 60_000,
      fetchedSourceEndMs: 90_000,
      mediaStartMs: 0,
      mediaEndMs: 30_000,
      clipIds: ["clip-a"]
    }],
    clipRanges: [{
      clipId: "clip-a",
      sourceStartMs: 70_000,
      sourceEndMs: 80_000,
      editableSourceStartMs: 60_000,
      editableSourceEndMs: 90_000
    }],
    preparedAt: "2026-08-10T00:00:00.000Z",
    localOnly: true
  };
}

function statusPayload(
  state: "queued" | "downloading" | "completed" | "failed" | "cancelled",
  overrides: Record<string, unknown> = {}
) {
  return {
    schema: CHZZK_VOD_MATERIALIZATION_STATUS_SCHEMA,
    jobId: JOB_ID,
    state,
    progress: state === "completed" ? 1 : 0.25,
    message: state === "completed" ? "준비 완료" : "필요한 조각을 받는 중",
    reused: false,
    continuationPolicy: "bounded-persistent-editor",
    observation: {
      state: ["completed", "failed", "cancelled"].includes(state)
        ? "detached"
        : "attached",
      lastActivityAt: "2026-09-02T10:00:00.000Z"
    },
    ...(state === "completed"
      ? {
        materialization: { schema: "chzzk-kirinuki-materialization/v1" },
        media: {
          url: `http://127.0.0.1:4319/v1/vod/media/${JOB_ID}?access=ephemeral`,
          name: "선택 구간.mp4",
          size: 123_456,
          type: "video/mp4",
          lastModified: 1_800_000_000_000
        }
      }
      : {}),
    ...(state === "failed"
      ? { error: { code: "DOWNLOAD_FAILED", message: "조각 확인 실패" } }
      : {}),
    ...(state === "cancelled"
      ? {
        cancellation: {
          reason: "user-requested",
          phase: "downloading",
          elapsedMs: 4_000
        }
      }
      : {}),
    ...overrides
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

test("내부 미디어 엔진 주소에서 플랫폼 중립 VOD materialization 주소만 파생한다", () => {
  assert.equal(KIRINUKI_MEDIA_ENGINE_ENDPOINT, ENDPOINT);
  assert.equal(
    chzzkVodMaterializationEndpoint(ENDPOINT),
    "http://127.0.0.1:4319/v1/vod/materializations"
  );
  assert.throws(
    () => chzzkVodMaterializationEndpoint("https://remote.example/v1/captions"),
    /내부 자막 엔진|로컬 연결/
  );
});

test("시작 요청은 고정 ±10초와 권리 확인, 원본 좌표만 전송한다", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const result = await startChzzkVodMaterialization({
    endpoint: ENDPOINT,
    token: TOKEN,
    consumerId: CONSUMER_ID,
    sourceUrl: "https://chzzk.naver.com/video/14252987",
    clips: [{ id: "clip-1", startMs: 70_000, endMs: 80_000 }],
    rightsConfirmed: true,
    continuationPolicy: "bounded-persistent-editor",
    fetchImpl: await encryptedTransportFixture(async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return jsonResponse(statusPayload("queued"));
    })
  });

  assert.equal(requestUrl, chzzkVodMaterializationEndpoint(ENDPOINT));
  assert.equal(requestInit?.method, "POST");
  const headers = new Headers(requestInit?.headers);
  assert.equal(headers.get("authorization"), `Bearer ${TOKEN}`);
  assert.equal(
    headers.get("x-kirinuki-client-nonce"),
    localEngineDocumentClientNonce()
  );
  assert.equal(
    headers.get("x-kirinuki-protocol"),
    CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
  );
  const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
  assert.equal(body.consumerId, CONSUMER_ID);
  assert.equal(body.handleMs, CHZZK_VOD_HANDLE_MS);
  assert.equal(body.continuationPolicy, "bounded-persistent-editor");
  assert.deepEqual(body.clips, [
    { id: "clip-1", startMs: 70_000, endMs: 80_000 }
  ]);
  assert.deepEqual(body.permission, {
    confirmed: true,
    scope: "owned-or-authorized-public-vod"
  });
  assert.equal(result.state, "queued");
  assert.equal(result.continuationPolicy, "bounded-persistent-editor");
  assert.deepEqual(result.observation, {
    state: "attached",
    lastActivityAt: "2026-09-02T10:00:00.000Z"
  });
});

test("미리보기 요청은 브라우저 관찰 수명 정책을 명시해 전송한다", async () => {
  let body: Record<string, unknown> = {};
  await startChzzkVodMaterialization({
    endpoint: ENDPOINT,
    token: TOKEN,
    consumerId: CONSUMER_ID,
    sourceUrl: "https://chzzk.naver.com/video/14252987",
    clips: [{ id: "preview-1", startMs: 70_000, endMs: 80_000 }],
    rightsConfirmed: true,
    continuationPolicy: "ephemeral-preview",
    fetchImpl: await encryptedTransportFixture(async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(statusPayload("queued", {
        continuationPolicy: "ephemeral-preview"
      }));
    })
  });
  assert.equal(body.continuationPolicy, "ephemeral-preview");
});

test("시작 응답은 요청한 지속 정책과 정확히 같아야 한다", async () => {
  await assert.rejects(
    startChzzkVodMaterialization({
      endpoint: ENDPOINT,
      token: TOKEN,
      consumerId: CONSUMER_ID,
      sourceUrl: "https://chzzk.naver.com/video/14252987",
      clips: [{ id: "preview-1", startMs: 70_000, endMs: 80_000 }],
      rightsConfirmed: true,
      continuationPolicy: "ephemeral-preview",
      fetchImpl: await encryptedTransportFixture(async () => jsonResponse(
        statusPayload("queued")
      ))
    }),
    /유지 정책이 요청과 다릅니다/u
  );
});

test("저장된 materialization 참조는 비밀 경로 없이 로컬 재개 힌트로 보낸다", async () => {
  let body: Record<string, unknown> = {};
  const resume = {
    materializationId: "a".repeat(32),
    planFingerprint: `${"a".repeat(32)}${"b".repeat(32)}`,
    contentId: "14252987"
  };
  await startChzzkVodMaterialization({
    endpoint: ENDPOINT,
    token: TOKEN,
    consumerId: CONSUMER_ID,
    sourceUrl: "https://chzzk.naver.com/video/14252987",
    clips: [{ id: "clip-1", startMs: 70_000, endMs: 80_000 }],
    rightsConfirmed: true,
    continuationPolicy: "bounded-persistent-editor",
    resume,
    fetchImpl: await encryptedTransportFixture(async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(statusPayload("queued"));
    })
  });
  assert.deepEqual(body.resume, resume);
  assert.equal(JSON.stringify(body).includes("artifactPath"), false);
  assert.equal(JSON.stringify(body).includes("access"), false);
});

test("SOOP 준비 요청은 legacy part 시계를 선택 검증값으로만 보내고 로컬 엔진 유도를 허용한다", async () => {
  let body: Record<string, unknown> = {};
  await startChzzkVodMaterialization({
    endpoint: ENDPOINT,
    token: TOKEN,
    consumerId: CONSUMER_ID,
    sourceUrl: "https://vod.sooplive.com/player/169475287",
    sourceClockIdentity: SOOP_SOURCE_CLOCK_IDENTITY,
    clips: [{ id: "clip-1", startMs: 70_000, endMs: 80_000 }],
    rightsConfirmed: true,
    continuationPolicy: "bounded-persistent-editor",
    fetchImpl: await encryptedTransportFixture(async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(statusPayload("queued"));
    })
  });
  assert.deepEqual(body.sourceClockIdentity, SOOP_SOURCE_CLOCK_IDENTITY);
  assert.doesNotMatch(
    JSON.stringify(body.sourceClockIdentity),
    /https?:|cookie|authorization|token|signature|hmac/iu
  );
  let extensionFreeBody: Record<string, unknown> = {};
  await startChzzkVodMaterialization({
    endpoint: ENDPOINT,
    token: TOKEN,
    consumerId: CONSUMER_ID,
    sourceUrl: "https://vod.sooplive.com/player/169475287",
    clips: [{ id: "clip-1", startMs: 70_000, endMs: 80_000 }],
    rightsConfirmed: true,
    continuationPolicy: "bounded-persistent-editor",
    fetchImpl: await encryptedTransportFixture(async (_input, init) => {
      extensionFreeBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(statusPayload("queued"));
    })
  });
  assert.equal(Object.hasOwn(extensionFreeBody, "sourceClockIdentity"), false);
  await assert.rejects(startChzzkVodMaterialization({
    endpoint: ENDPOINT,
    token: TOKEN,
    consumerId: CONSUMER_ID,
    sourceUrl: "https://vod.sooplive.com/player/169475287",
    sourceClockIdentity: { ...SOOP_SOURCE_CLOCK_IDENTITY, contentId: "wrong" },
    clips: [{ id: "clip-1", startMs: 70_000, endMs: 80_000 }],
    rightsConfirmed: true,
    continuationPolicy: "bounded-persistent-editor",
    fetchImpl: async () => jsonResponse(statusPayload("queued"))
  }), /part 시계 증명/u);
});

test("hot-load 요청은 clip별 확장 범위와 비밀 없는 base identity만 전송한다", async () => {
  let body: Record<string, unknown> = {};
  const base = {
    materializationId: "a".repeat(32),
    planFingerprint: `${"a".repeat(32)}${"b".repeat(32)}`,
    contentId: "14252987"
  };
  await startChzzkVodMaterialization({
    endpoint: ENDPOINT,
    token: TOKEN,
    consumerId: CONSUMER_ID,
    sourceUrl: "https://chzzk.naver.com/video/14252987",
    clips: [{ id: "clip-1", startMs: 70_000, endMs: 80_000 }],
    editableRanges: [{ id: "clip-1", startMs: 30_000, endMs: 120_000 }],
    rightsConfirmed: true,
    continuationPolicy: "bounded-persistent-editor",
    base,
    fetchImpl: await encryptedTransportFixture(async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(statusPayload("queued"));
    })
  });
  assert.deepEqual(body.editableRanges, [
    { id: "clip-1", startMs: 30_000, endMs: 120_000 }
  ]);
  assert.deepEqual(body.base, base);
  assert.equal(JSON.stringify(body).includes("artifactPath"), false);
  assert.equal(JSON.stringify(body).includes("access"), false);
});

test("권리 확인 누락과 10초가 아닌 핸들은 요청 전에 거부한다", async () => {
  const base = {
    endpoint: ENDPOINT,
    token: TOKEN,
    consumerId: CONSUMER_ID,
    sourceUrl: "https://chzzk.naver.com/video/14252987",
    clips: [{ id: "clip-1", startMs: 70_000, endMs: 80_000 }],
    continuationPolicy: "bounded-persistent-editor" as const,
    fetchImpl: async () => jsonResponse(statusPayload("queued"))
  };
  await assert.rejects(
    startChzzkVodMaterialization({ ...base, rightsConfirmed: false }),
    /편집 허가/
  );
  await assert.rejects(
    startChzzkVodMaterialization({
      ...base,
      rightsConfirmed: true,
      continuationPolicy: "keep-running-forever" as never
    }),
    /유지 정책/u
  );
  await assert.rejects(
    startChzzkVodMaterialization({
      ...base,
      consumerId: "project\u0000escape",
      rightsConfirmed: true
    }),
    /세션 ID/u
  );
  await assert.rejects(
    startChzzkVodMaterialization({
      ...base,
      rightsConfirmed: true,
      handleMs: 5_000
    }),
    /앞뒤 10초/
  );
  await assert.rejects(
    startChzzkVodMaterialization({
      ...base,
      rightsConfirmed: true,
      handleMs: 10_000.4
    }),
    /앞뒤 10초/
  );
  await assert.rejects(
    startChzzkVodMaterialization({
      ...base,
      rightsConfirmed: true,
      clips: [{ id: "clip-1", startMs: 70_000.5, endMs: 80_000 }]
    }),
    /범위/u
  );
  await assert.rejects(
    startChzzkVodMaterialization({
      ...base,
      rightsConfirmed: true,
      editableRanges: [{ id: "clip-1", startMs: 60_000.5, endMs: 90_000 }]
    }),
    /확장 편집 범위/u
  );
});

test("완료 응답의 미디어 URL은 같은 loopback job 경로만 허용한다", () => {
  const valid = normalizeChzzkVodMaterializationStatus(
    statusPayload("completed"),
    ENDPOINT
  );
  assert.equal(valid.media?.size, 123_456);

  const localhostConfigured = normalizeChzzkVodMaterializationStatus(
    statusPayload("completed"),
    "http://localhost:4319/v1/captions"
  );
  assert.match(localhostConfigured.media?.url || "", /^http:\/\/127\.0\.0\.1:4319\//u);

  assert.throws(
    () => normalizeChzzkVodMaterializationStatus(
      statusPayload("completed", {
        media: {
          url: `https://attacker.example/v1/vod/media/${JOB_ID}?access=leak`,
          name: "bad.mp4",
          size: 1,
          type: "video/mp4",
          lastModified: 1
        }
      }),
      ENDPOINT
    ),
    /보안 범위/
  );
  assert.throws(
    () => normalizeChzzkVodMaterializationStatus(
      statusPayload("completed", {
        media: {
          url: `http://127.0.0.1:4320/v1/vod/media/${JOB_ID}?access=wrong-port`,
          name: "bad.mp4",
          size: 1,
          type: "video/mp4",
          lastModified: 1
        }
      }),
      ENDPOINT
    ),
    /보안 범위/
  );
  assert.throws(
    () => normalizeChzzkVodMaterializationStatus(
      statusPayload("completed", {
        media: {
          url: `http://127.0.0.1:4319/v1/chzzk-vod/media/${JOB_ID}?access=legacy`,
          name: "legacy.mp4",
          size: 1,
          type: "video/mp4",
          lastModified: 1
        }
      }),
      ENDPOINT
    ),
    /보안 범위/
  );
});

test("poll은 완료까지 진행 상태를 전달하고, 취소는 DELETE를 사용한다", async () => {
  const states = [statusPayload("downloading"), statusPayload("completed")];
  const observed: string[] = [];
  const polledUrls: string[] = [];
  const polledMethods: string[] = [];
  const completed = await waitForChzzkVodMaterialization({
    endpoint: ENDPOINT,
    token: TOKEN,
    jobId: JOB_ID,
    pollIntervalMs: 1,
    onProgress: (status) => observed.push(status.state),
    fetchImpl: await encryptedTransportFixture(async (input, init) => {
      polledUrls.push(String(input));
      polledMethods.push(String(init?.method));
      return jsonResponse(states.shift());
    })
  });
  assert.equal(completed.state, "completed");
  assert.deepEqual(observed, ["downloading", "completed"]);
  assert.deepEqual(polledUrls, [
    `http://127.0.0.1:4319/v1/vod/materializations/${JOB_ID}`,
    `http://127.0.0.1:4319/v1/vod/materializations/${JOB_ID}`
  ]);
  assert.deepEqual(polledMethods, ["POST", "POST"]);

  let method = "";
  let cancelledUrl = "";
  const cancelled = await cancelChzzkVodMaterialization({
    endpoint: ENDPOINT,
    token: TOKEN,
    jobId: JOB_ID,
    fetchImpl: await encryptedTransportFixture(async (input, init) => {
      cancelledUrl = String(input);
      method = String(init?.method);
      return jsonResponse(statusPayload("cancelled"));
    })
  });
  assert.equal(method, "DELETE");
  assert.equal(
    cancelledUrl,
    `http://127.0.0.1:4319/v1/vod/materializations/${JOB_ID}`
  );
  assert.equal(cancelled.state, "cancelled");
});

test("poll은 terminal 실패의 semantic 공개 오류 코드를 예외에 보존한다", async () => {
  const observed: string[] = [];
  await assert.rejects(
    waitForChzzkVodMaterialization({
      endpoint: ENDPOINT,
      token: TOKEN,
      jobId: JOB_ID,
      pollIntervalMs: 1,
      onProgress: (status) => observed.push(status.error?.code || ""),
      fetchImpl: await encryptedTransportFixture(async () => jsonResponse(statusPayload("failed", {
        error: {
          code: "SOURCE_CLOCK_VERIFICATION_FAILED",
          message: "원본 VOD의 정확한 재생 시간축을 확인하지 못했습니다."
        }
      })))
    }),
    (error: unknown) => Boolean(
      error instanceof ChzzkVodMaterializationClientError
      && error.code === "SOURCE_CLOCK_VERIFICATION_FAILED"
      && error.status === undefined
      && /정확한 재생 시간축/u.test(error.message)
    )
  );
  assert.deepEqual(observed, ["SOURCE_CLOCK_VERIFICATION_FAILED"]);
});

test("poll은 사용자 취소만 AbortError로, 실행 수명 취소는 typed 원인으로 보존한다", async () => {
  await assert.rejects(
    waitForChzzkVodMaterialization({
      endpoint: ENDPOINT,
      token: TOKEN,
      jobId: JOB_ID,
      pollIntervalMs: 1,
      fetchImpl: await encryptedTransportFixture(async () => jsonResponse(
        statusPayload("cancelled", {
          cancellation: {
            reason: "execution-deadline",
            phase: "muxing",
            elapsedMs: 43_200_000
          }
        })
      ))
    }),
    (error: unknown) => Boolean(
      error instanceof ChzzkVodMaterializationClientError
      && error.code === "EXECUTION_DEADLINE"
      && error.name !== "AbortError"
      && /시간 한도/u.test(error.message)
    )
  );

  await assert.rejects(
    waitForChzzkVodMaterialization({
      endpoint: ENDPOINT,
      token: TOKEN,
      jobId: JOB_ID,
      pollIntervalMs: 1,
      fetchImpl: await encryptedTransportFixture(async () => jsonResponse(
        statusPayload("cancelled", {
          continuationPolicy: "ephemeral-preview",
          cancellation: {
            reason: "ephemeral-observer-expired",
            phase: "downloading",
            elapsedMs: 5_000
          }
        })
      ))
    }),
    (error: unknown) => Boolean(
      error instanceof ChzzkVodMaterializationClientError
      && error.code === "EPHEMERAL_OBSERVER_EXPIRED"
      && error.name !== "AbortError"
    )
  );

  await assert.rejects(
    waitForChzzkVodMaterialization({
      endpoint: ENDPOINT,
      token: TOKEN,
      jobId: JOB_ID,
      pollIntervalMs: 1,
      fetchImpl: await encryptedTransportFixture(async () => jsonResponse(
        statusPayload("cancelled")
      ))
    }),
    (error: unknown) => Boolean(
      error instanceof DOMException
      && error.name === "AbortError"
    )
  );
});

test("취소 status는 redacted reason·phase·elapsedMs를 모두 요구한다", () => {
  const valid = normalizeChzzkVodMaterializationStatus(
    statusPayload("cancelled", {
      cancellation: {
        reason: "engine-shutdown",
        phase: "verifying",
        elapsedMs: 12_345
      }
    }),
    ENDPOINT
  );
  assert.deepEqual(valid.cancellation, {
    reason: "engine-shutdown",
    phase: "verifying",
    elapsedMs: 12_345
  });
  for (const cancellation of [
    undefined,
    { reason: "internal-path-leak", phase: "muxing", elapsedMs: 10 },
    { reason: "engine-shutdown", phase: "cancelled", elapsedMs: 10 },
    { reason: "engine-shutdown", phase: "muxing", elapsedMs: -1 }
  ]) {
    assert.throws(
      () => normalizeChzzkVodMaterializationStatus(
        statusPayload("cancelled", { cancellation }),
        ENDPOINT
      ),
      /취소/u
    );
  }
});

test("status v2는 실행 및 terminal 상태 모두 공개 observation을 요구한다", () => {
  assert.throws(
    () => normalizeChzzkVodMaterializationStatus(
      statusPayload("downloading", { observation: undefined }),
      ENDPOINT
    ),
    /관찰 상태/u
  );
  assert.deepEqual(
    normalizeChzzkVodMaterializationStatus(
      statusPayload("completed"),
      ENDPOINT
    ).observation,
    {
      state: "detached",
      lastActivityAt: "2026-09-02T10:00:00.000Z"
    }
  );
});

test("poll HTTP 실패도 안전한 내부 엔진 오류 코드와 상태를 보존한다", async () => {
  await assert.rejects(
    waitForChzzkVodMaterialization({
      endpoint: ENDPOINT,
      token: TOKEN,
      jobId: JOB_ID,
      pollIntervalMs: 1,
      fetchImpl: await encryptedTransportFixture(async () => jsonResponse({
        error: {
          code: "SOURCE_CHANGED",
          message: "원본 VOD 재생 정보가 변경되었습니다."
        }
      }, 409))
    }),
    (error: unknown) => Boolean(
      error instanceof ChzzkVodMaterializationClientError
      && error.code === "SOURCE_CHANGED"
      && error.status === 409
    )
  );
});

test("완료 VOD cache purge는 media access와 exact v2 source identity를 별도 DELETE에 보낸다", async () => {
  const materialization = purgeMaterialization();
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const result = await purgeChzzkVodMaterializedCache({
    endpoint: ENDPOINT,
    token: TOKEN,
    mediaUrl: `http://127.0.0.1:4319/v1/vod/media/${JOB_ID}?access=media-secret`,
    materialization,
    fetchImpl: await encryptedTransportFixture(async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return jsonResponse({
        schema: CHZZK_VOD_CACHE_PURGE_RESULT_SCHEMA,
        jobId: JOB_ID,
        state: "purged",
        alreadyPurged: false,
        releasedBytes: 123_456,
        materialization: {
          materializationId: materialization.materializationId,
          planFingerprint: materialization.planFingerprint
        },
        source: {
          platform: materialization.source.platform,
          contentId: materialization.source.contentId,
          sourceVersionId: materialization.source.sourceVersionId
        }
      });
    })
  });
  assert.equal(
    requestUrl,
    `http://127.0.0.1:4319/v1/vod/materializations/${JOB_ID}/cache`
  );
  assert.equal(requestInit?.method, "DELETE");
  const headers = new Headers(requestInit?.headers);
  assert.equal(headers.get("authorization"), `Bearer ${TOKEN}`);
  assert.equal(headers.get("x-kirinuki-media-access"), "media-secret");
  assert.equal(
    headers.get("x-kirinuki-protocol"),
    CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA
  );
  const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
  assert.deepEqual(body, {
    schema: CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA,
    jobId: JOB_ID,
    materialization: {
      materializationId: materialization.materializationId,
      planFingerprint: materialization.planFingerprint
    },
    source: {
      platform: materialization.source.platform,
      contentId: materialization.source.contentId,
      sourceVersionId: materialization.source.sourceVersionId
    }
  });
  assert.equal(result.state, "purged");
  assert.equal(result.releasedBytes, 123_456);
});

test("consumer session cache purge는 consumer와 exact source capability를 별도 계약으로 보낸다", async () => {
  const materialization = purgeMaterialization();
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const result = await purgeChzzkVodConsumerSessionCache({
    endpoint: ENDPOINT,
    token: TOKEN,
    consumerId: CONSUMER_ID,
    mediaUrl: `http://127.0.0.1:4319/v1/vod/media/${JOB_ID}?access=media-secret`,
    materialization,
    fetchImpl: await encryptedTransportFixture(async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return jsonResponse({
        schema: CHZZK_VOD_CONSUMER_CACHE_PURGE_RESULT_SCHEMA,
        jobId: JOB_ID,
        consumerId: CONSUMER_ID,
        state: "purged",
        alreadyPurged: false,
        releasedBytes: 456_789,
        releasedFiles: 17,
        materialization: {
          materializationId: materialization.materializationId,
          planFingerprint: materialization.planFingerprint
        },
        source: {
          platform: materialization.source.platform,
          contentId: materialization.source.contentId,
          sourceVersionId: materialization.source.sourceVersionId
        }
      });
    })
  });
  assert.equal(
    requestUrl,
    `http://127.0.0.1:4319/v1/vod/materializations/${JOB_ID}/session-cache`
  );
  assert.equal(requestInit?.method, "DELETE");
  const headers = new Headers(requestInit?.headers);
  assert.equal(headers.get("authorization"), `Bearer ${TOKEN}`);
  assert.equal(headers.get("x-kirinuki-media-access"), "media-secret");
  assert.equal(
    headers.get("x-kirinuki-protocol"),
    CHZZK_VOD_CONSUMER_CACHE_PURGE_REQUEST_SCHEMA
  );
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    schema: CHZZK_VOD_CONSUMER_CACHE_PURGE_REQUEST_SCHEMA,
    jobId: JOB_ID,
    materialization: {
      materializationId: materialization.materializationId,
      planFingerprint: materialization.planFingerprint
    },
    source: {
      platform: materialization.source.platform,
      contentId: materialization.source.contentId,
      sourceVersionId: materialization.source.sourceVersionId
    },
    consumerId: CONSUMER_ID
  });
  assert.equal(result.releasedBytes, 456_789);
  assert.equal(result.releasedFiles, 17);

  assert.throws(() => normalizeChzzkVodConsumerCachePurgeResult({
    ...result,
    artifactPath: "/must/not/be-accepted.mp4"
  }), /응답 버전/u);
});

test("cache purge client는 수동 File/blob URL과 legacy·불일치 응답을 요청 전에 거부한다", async () => {
  let fetchCalls = 0;
  const attempt = (mediaUrl: string, materialization: unknown) => (
    purgeChzzkVodMaterializedCache({
      endpoint: ENDPOINT,
      token: TOKEN,
      mediaUrl,
      materialization,
      fetchImpl: async () => {
        fetchCalls += 1;
        return jsonResponse({});
      }
    })
  );
  await assert.rejects(
    attempt("blob:chrome-extension://local-user-file", purgeMaterialization()),
    /보안 범위|주소/u
  );
  await assert.rejects(
    attempt(
      `http://127.0.0.1:4319/v1/vod/media/${JOB_ID}?access=media-secret`,
      {
        ...purgeMaterialization(),
        schema: "chzzk-kirinuki-chzzk-vod-materialization/v1",
        source: {
          ...purgeMaterialization().source,
          sourceVersionId: undefined
        },
        clipRanges: undefined
      }
    ),
    /exact source identity/u
  );
  assert.equal(fetchCalls, 0);

  assert.throws(
    () => normalizeChzzkVodCachePurgeResult({
      schema: CHZZK_VOD_CACHE_PURGE_RESULT_SCHEMA,
      jobId: JOB_ID,
      state: "purged",
      alreadyPurged: false,
      releasedBytes: 1,
      materialization: {
        materializationId: "a".repeat(32),
        planFingerprint: `${"a".repeat(32)}${"b".repeat(32)}`
      },
      source: {
        platform: "CHZZK",
        contentId: "14252987",
        sourceVersionId: "c".repeat(64)
      },
      artifactPath: "/must/not/be/accepted.mp4"
    }),
    /응답 버전/u
  );
});
