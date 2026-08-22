#!/usr/bin/env node

import { createHash, webcrypto } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { createCaptionGatewayServer } from "./caption-gateway.js";
import {
  CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
} from "./chzzk-vod-job-manager.js";
import type {
  ChzzkVodMaterializationRunner
} from "./chzzk-vod-job-manager.js";
import {
  LOCAL_VOD_RUNTIME_SCHEMA,
  PINNED_YT_DLP
} from "./local-vod-runtime-core.js";
import {
  isLocalMediaEngineVersion
} from "../src/lib/local-media-engine-contract.js";
import {
  LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
  encodeBase64Url,
  localMediaEnginePublicKeyId
} from "../src/lib/local-media-engine-auth.js";
import {
  captionAgentRequestHeaders,
  clearLocalMediaEngineSessionState,
  pairCaptionAgent
} from "../src/editor/caption-agent.js";
import {
  localMediaEngineTransportFetch
} from "../src/editor/local-media-engine-transport.js";
import {
  LOCAL_MEDIA_ENGINE_TRUST_SCHEMA,
  currentAuthenticatedLocalMediaEngine
} from "../src/editor/local-media-engine-trust.js";
import type {
  LocalMediaEngineDevicePin,
  LocalMediaEngineTrustStore
} from "../src/editor/local-media-engine-trust.js";
import {
  KIRINUKI_PUBLIC_STUDIO_ORIGIN
} from "../src/lib/local-runtime-origin.js";
import {
  CHZZK_VOD_MATERIALIZATION_SCHEMA,
  createMaterializationClipCoverages,
  mergeMaterializationClipCoverages
} from "../src/lib/chzzk-vod-materialization.js";
import {
  inferSourceIdentifiers
} from "../src/lib/source-platform.js";
import {
  SOOP_VOD_SOURCE_CLOCK_IDENTITY_SCHEMA
} from "../src/lib/soop-vod-source-clock.js";

const MAXIMUM_RESPONSE_BYTES = 2 * 1024 * 1024;
const ENGINE_VERSION = "3.0.1";
const INSTANCE_NONCE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const FIXED_ENGINE_ORIGIN = "http://127.0.0.1:4319";
const FIXED_CAPTION_ENDPOINT = `${FIXED_ENGINE_ORIGIN}/v1/captions`;

interface JsonResult {
  readonly body: Record<string, unknown>;
  readonly headers: Headers;
  readonly status: number;
}

interface SemanticSourceCase {
  readonly contentId: string;
  readonly platform: "CHZZK" | "YOUTUBE" | "SOOP";
  readonly sourceUrl: string;
}

interface SemanticDeviceFixture {
  readonly pin: Readonly<LocalMediaEngineDevicePin>;
  readonly signer: Readonly<{
    algorithm: typeof LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM;
    keyId: string;
    sign: (transcript: Uint8Array) => Promise<string>;
  }>;
  readonly trustStore: Readonly<LocalMediaEngineTrustStore>;
}

const SOURCE_CASES = Object.freeze<readonly SemanticSourceCase[]>([
  Object.freeze({
    contentId: "14252987",
    platform: "CHZZK",
    sourceUrl: "https://chzzk.naver.com/video/14252987"
  }),
  Object.freeze({
    contentId: "abcdefghijk",
    platform: "YOUTUBE",
    sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk"
  }),
  Object.freeze({
    contentId: "123456789",
    platform: "SOOP",
    sourceUrl: "https://vod.sooplive.com/player/123456789"
  })
]);

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  invariant(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label}가 JSON 객체가 아닙니다.`
  );
  return value as Record<string, unknown>;
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function jsonRequest(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch
): Promise<JsonResult> {
  const response = await fetchImpl(url, {
    ...init,
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(10_000)
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  invariant(
    bytes.byteLength <= MAXIMUM_RESPONSE_BYTES,
    `응답이 허용 크기를 넘었습니다: ${url}`
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`JSON 응답을 읽지 못했습니다: ${url}`, { cause: error });
  }
  return Object.freeze({
    body: record(parsed, url),
    headers: response.headers,
    status: response.status
  });
}

async function createSemanticDeviceFixture(): Promise<SemanticDeviceFixture> {
  const keys = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const publicKeySpki = encodeBase64Url(new Uint8Array(
    await webcrypto.subtle.exportKey("spki", keys.publicKey)
  ));
  const keyId = await localMediaEnginePublicKeyId(publicKeySpki);
  invariant(keyId, "semantic fixture device identity를 만들지 못했습니다.");
  const sign = async (transcript: Uint8Array): Promise<string> => (
    encodeBase64Url(new Uint8Array(await webcrypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keys.privateKey,
      Uint8Array.from(transcript).buffer
    )))
  );
  const initialPin = Object.freeze({
    schema: LOCAL_MEDIA_ENGINE_TRUST_SCHEMA,
    algorithm: LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
    keyId,
    publicKeySpki,
    enrolledAt: new Date().toISOString(),
    maxSeenVersion: ENGINE_VERSION
  });
  let storedPin: Readonly<LocalMediaEngineDevicePin> | null = initialPin;
  const readPin: LocalMediaEngineTrustStore["read"] = async () => storedPin;
  const pinDevice: LocalMediaEngineTrustStore["pin"] = async (candidate) => {
    if (
      storedPin
      && (
        storedPin.keyId !== candidate.keyId
        || storedPin.publicKeySpki !== candidate.publicKeySpki
      )
    ) {
      throw new Error("semantic fixture의 고정된 device identity가 바뀌었습니다.");
    }
    const pinned: Readonly<LocalMediaEngineDevicePin> = Object.freeze({
      ...candidate
    });
    storedPin = pinned;
    return pinned;
  };
  const observeVersion: LocalMediaEngineTrustStore["observeVersion"] = async (
    expectedKeyId,
    engineVersion
  ) => {
    const current = storedPin;
    invariant(
      current?.keyId === expectedKeyId,
      "semantic fixture의 device identity 관찰 대상이 다릅니다."
    );
    invariant(
      isLocalMediaEngineVersion(engineVersion),
      "semantic fixture가 올바르지 않은 engine version을 관찰했습니다."
    );
    const observed: Readonly<LocalMediaEngineDevicePin> = Object.freeze({
      ...current,
      maxSeenVersion: engineVersion
    });
    storedPin = observed;
    return observed;
  };
  const resetPin: LocalMediaEngineTrustStore["reset"] = async (
    expectedKeyId
  ) => {
    invariant(
      storedPin?.keyId === expectedKeyId,
      "semantic fixture의 device identity reset 대상이 다릅니다."
    );
    storedPin = null;
  };
  const trustStore: Readonly<LocalMediaEngineTrustStore> = Object.freeze({
    read: readPin,
    pin: pinDevice,
    observeVersion,
    reset: resetPin
  });
  return Object.freeze({
    pin: initialPin,
    signer: Object.freeze({
      algorithm: LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
      keyId,
      sign
    }),
    trustStore
  });
}

function mappedLoopbackFetch(port: number): typeof fetch {
  return (async (input: URL | RequestInfo, init: RequestInit = {}) => {
    const requested = new URL(
      input instanceof Request ? input.url : String(input)
    );
    invariant(
      requested.origin === FIXED_ENGINE_ORIGIN,
      `semantic fixture가 고정되지 않은 loopback origin을 요청했습니다: ${requested.origin}`
    );
    requested.port = String(port);
    const headers = new Headers(init.headers);
    headers.set("Origin", KIRINUKI_PUBLIC_STUDIO_ORIGIN);
    return fetch(requested, { ...init, headers });
  }) as typeof fetch;
}

function corsHeaders(extra: Readonly<Record<string, string>> = {}): HeadersInit {
  return {
    Origin: KIRINUKI_PUBLIC_STUDIO_ORIGIN,
    ...extra
  };
}

function assertExactCors(result: JsonResult, label: string): void {
  invariant(
    result.headers.get("access-control-allow-origin")
      === KIRINUKI_PUBLIC_STUDIO_ORIGIN,
    `${label} 응답의 공개 Origin CORS가 정확하지 않습니다.`
  );
  invariant(
    result.headers.get("set-cookie") === null,
    `${label} 응답이 쿠키를 만들었습니다.`
  );
}

function createFixtureRunner(
  fixtureRoot: string,
  calls: SemanticSourceCase[]
): ChzzkVodMaterializationRunner {
  let artifactCounter = 0;
  return async ({ clips, editableRanges, onProgress, sourceUrl }) => {
    const identifiers = inferSourceIdentifiers(sourceUrl);
    const selected = SOURCE_CASES.find((candidate) => (
      candidate.platform === identifiers.platform
      && candidate.contentId === identifiers.contentId
      && candidate.sourceUrl === sourceUrl
    ));
    invariant(selected, `fixture가 허용하지 않은 VOD입니다: ${sourceUrl}`);
    calls.push(selected);
    onProgress({
      stage: "downloading",
      progress: 0.5,
      message: "격리된 native semantic fixture를 준비하는 중"
    });

    const clipRanges = createMaterializationClipCoverages(
      clips.map((clip) => ({
        clipId: clip.id,
        sourceStartMs: clip.startMs,
        sourceEndMs: clip.endMs
      })),
      600_000,
      10_000,
      editableRanges?.map((range) => ({
        clipId: range.id,
        editableSourceStartMs: range.startMs,
        editableSourceEndMs: range.endMs
      }))
    );
    let mediaCursorMs = 0;
    const windows = mergeMaterializationClipCoverages(clipRanges).map(
      (window, index) => {
        const durationMs = window.editableSourceEndMs
          - window.editableSourceStartMs;
        const mapped = {
          id: `semantic-window-${index + 1}`,
          editableSourceStartMs: window.editableSourceStartMs,
          editableSourceEndMs: window.editableSourceEndMs,
          fetchedSourceStartMs: window.editableSourceStartMs,
          fetchedSourceEndMs: window.editableSourceEndMs,
          mediaStartMs: mediaCursorMs,
          mediaEndMs: mediaCursorMs + durationMs,
          clipIds: [...window.clipIds]
        };
        mediaCursorMs += durationMs;
        return mapped;
      }
    );
    const planFingerprint = createHash("sha256").update(JSON.stringify({
      clipRanges,
      contentId: selected.contentId,
      platform: selected.platform
    })).digest("hex");
    artifactCounter += 1;
    const artifact = Buffer.from(
      `kirinuki-semantic-fixture\0${selected.platform}\0${selected.contentId}\0`
        .repeat(64),
      "utf8"
    );
    const artifactPath = path.join(
      fixtureRoot,
      `materialized-${artifactCounter}-${selected.platform.toLowerCase()}.mp4`
    );
    await writeFile(artifactPath, artifact, { flag: "wx", mode: 0o600 });
    return {
      manifest: {
        schema: CHZZK_VOD_MATERIALIZATION_SCHEMA,
        materializationId: planFingerprint.slice(0, 32),
        planFingerprint,
        source: {
          platform: selected.platform,
          contentType: "vod",
          contentId: selected.contentId,
          sourceVersionId: digest(Buffer.from(`fixture:${selected.sourceUrl}`))
        },
        sourceDurationMs: 600_000,
        handleMs: 10_000,
        mediaDurationMs: mediaCursorMs,
        windows,
        clipRanges,
        preparedAt: "2026-08-21T00:00:00.000Z",
        localOnly: true
      },
      artifactPath,
      artifact: {
        hashSha256: digest(artifact),
        sizeBytes: artifact.byteLength
      },
      reused: false
    };
  };
}

async function waitForCompleted(
  jobId: string,
  authorization: Readonly<Record<string, string>>,
  fetchImpl: typeof fetch
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await jsonRequest(
      `${FIXED_ENGINE_ORIGIN}/v1/vod/materializations/${encodeURIComponent(jobId)}`,
      {
        method: "POST",
        headers: corsHeaders({
          ...authorization,
          "X-Kirinuki-Protocol": CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
        })
      },
      fetchImpl
    );
    assertExactCors(result, "materialization status");
    invariant(result.status === 200, "materialization status가 200이 아닙니다.");
    if (result.body.state === "completed") {
      return result.body;
    }
    invariant(
      !["failed", "cancelled"].includes(String(result.body.state || "")),
      `materialization이 완료 전에 종료했습니다: ${JSON.stringify(result.body)}`
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("materialization fixture가 제한 시간 안에 완료되지 않았습니다.");
}

async function proveSource(
  actualBaseUrl: string,
  source: SemanticSourceCase,
  _index: number,
  gatewayFetch: typeof fetch,
  device: Readonly<SemanticDeviceFixture>
): Promise<Readonly<Record<string, unknown>>> {
  const projectId = `semantic-project-${source.platform.toLowerCase()}`;
  clearLocalMediaEngineSessionState();
  const token = await pairCaptionAgent({
    endpoint: FIXED_CAPTION_ENDPOINT,
    purpose: "vod",
    projectId,
    sourceUrl: source.sourceUrl,
    fetchImpl: gatewayFetch,
    trustStore: device.trustStore
  });
  const authenticatedEngine = currentAuthenticatedLocalMediaEngine();
  invariant(
    /^[A-Za-z0-9_-]{43}$/u.test(token)
      && authenticatedEngine?.keyId === device.pin.keyId
      && authenticatedEngine.instanceNonce === INSTANCE_NONCE
      && isLocalMediaEngineVersion(authenticatedEngine.engineVersion),
    `${source.platform} signed health/session identity가 올바르지 않습니다.`
  );
  const authorization = captionAgentRequestHeaders(token);
  const encryptedGatewayFetch = ((
    input: URL | RequestInfo,
    init: RequestInit = {}
  ) => localMediaEngineTransportFetch(
    input,
    init,
    gatewayFetch
  )) as typeof fetch;
  const clipId = `semantic-clip-${source.platform.toLowerCase()}`;
  const materialization = await jsonRequest(
    `${FIXED_ENGINE_ORIGIN}/v1/vod/materializations`,
    {
      method: "POST",
      headers: corsHeaders({
        ...authorization,
        "Content-Type": "application/json",
        "X-Kirinuki-Protocol": CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
      }),
      body: JSON.stringify({
        schema: CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA,
        consumerId: projectId,
        sourceUrl: source.sourceUrl,
        ...(source.platform === "SOOP"
          ? {
            sourceClockIdentity: {
              schema: SOOP_VOD_SOURCE_CLOCK_IDENTITY_SCHEMA,
              platform: "SOOP",
              contentId: source.contentId,
              totalDurationSeconds: 600,
              parts: [{
                id: "20260821_SEMANTIC_123456789_1",
                index: 0,
                order: 1,
                durationSeconds: 600
              }]
            }
          }
          : {}),
        clips: [{ id: clipId, startMs: 70_000, endMs: 80_000 }],
        handleMs: 10_000,
        permission: {
          confirmed: true,
          scope: "owned-or-authorized-public-vod"
        }
      })
    },
    encryptedGatewayFetch
  );
  assertExactCors(materialization, `${source.platform} materialization create`);
  invariant(
    materialization.status === 202
      && typeof materialization.body.jobId === "string",
    `${source.platform} materialization을 시작하지 못했습니다.`
  );
  const completed = await waitForCompleted(
    String(materialization.body.jobId),
    authorization,
    encryptedGatewayFetch
  );
  const manifest = record(completed.materialization, "completed materialization");
  const sourceIdentity = record(manifest.source, "materialization source");
  const media = record(completed.media, "completed media");
  invariant(
    completed.state === "completed"
      && manifest.schema === CHZZK_VOD_MATERIALIZATION_SCHEMA
      && sourceIdentity.platform === source.platform
      && sourceIdentity.contentId === source.contentId
      && manifest.handleMs === 10_000
      && Array.isArray(manifest.clipRanges)
      && manifest.clipRanges.length === 1,
    `${source.platform} completed materialization identity가 다릅니다.`
  );
  const mediaUrl = new URL(String(media.url || ""));
  invariant(
    mediaUrl.origin === actualBaseUrl
      && /^\/v1\/vod\/media\/[A-Za-z0-9_-]{16,128}$/u.test(mediaUrl.pathname)
      && mediaUrl.searchParams.has("access"),
    `${source.platform} 로컬 미디어 URL이 exact loopback capability URL이 아닙니다.`
  );
  const ranged = await fetch(mediaUrl, {
    method: "GET",
    headers: corsHeaders({ Range: "bytes=2-9" }),
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(10_000)
  });
  const rangedBytes = Buffer.from(await ranged.arrayBuffer());
  invariant(
    ranged.status === 206
      && rangedBytes.byteLength === 8
      && ranged.headers.get("content-range")?.startsWith("bytes 2-9/")
      && ranged.headers.get("access-control-allow-origin")
        === KIRINUKI_PUBLIC_STUDIO_ORIGIN
      && ranged.headers.get("set-cookie") === null,
    `${source.platform} 로컬 미디어 Range 제공이 올바르지 않습니다.`
  );
  return Object.freeze({
    platform: source.platform,
    session: "signed-health+ecdh+encrypted-memory-capability",
    materialization: "completed-mock-fixture",
    mediaRange: "bytes=2-9"
  });
}

async function main(): Promise<void> {
  const fixtureRoot = await mkdtemp(path.join(
    tmpdir(),
    "kirinuki-semantic-engine-smoke-"
  ));
  const calls: SemanticSourceCase[] = [];
  const device = await createSemanticDeviceFixture();
  const runtime = createCaptionGatewayServer({
    deviceProofSigner: device.signer,
    env: {
      KIRINUKI_AGENT_PORT: "4319",
      KIRINUKI_ALLOWED_ORIGIN: KIRINUKI_PUBLIC_STUDIO_ORIGIN,
      KIRINUKI_LOCAL_ENGINE_BACKGROUND_START: "ready",
      KIRINUKI_LOCAL_ENGINE_VERSION: ENGINE_VERSION,
      KIRINUKI_MAX_AUDIO_BYTES: "1048576",
      KIRINUKI_STT_ENDPOINT: "http://127.0.0.1:4318/inference",
      KIRINUKI_STT_MODE: "local-whispercpp",
      KIRINUKI_STT_MODEL: "tiny-q5_1",
      KIRINUKI_VOD_EJS_VERSION: PINNED_YT_DLP.bundledJavascript.version,
      KIRINUKI_VOD_INSTANCE_NONCE: INSTANCE_NONCE,
      KIRINUKI_VOD_RUNTIME_KIND: "vod-only",
      KIRINUKI_VOD_RUNTIME_READY: "1",
      KIRINUKI_VOD_RUNTIME_SCHEMA: LOCAL_VOD_RUNTIME_SCHEMA,
      KIRINUKI_VOD_STATE_DIR: path.join(fixtureRoot, "managed-vod"),
      KIRINUKI_VOD_YT_DLP_VERSION: PINNED_YT_DLP.version
    },
    materializationRunner: createFixtureRunner(fixtureRoot, calls)
  });
  let failure: unknown;
  try {
    await runtime.ready;
    await new Promise<void>((resolve, reject) => {
      runtime.server.once("error", reject);
      runtime.server.listen(0, "127.0.0.1", resolve);
    });
    const address = runtime.server.address() as AddressInfo | null;
    invariant(
      address?.address === "127.0.0.1" && Number.isSafeInteger(address.port),
      "semantic gateway가 exact loopback에 bind되지 않았습니다."
    );
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const gatewayFetch = mappedLoopbackFetch(address.port);

    const results = [];
    for (const [index, source] of SOURCE_CASES.entries()) {
      results.push(await proveSource(
        baseUrl,
        source,
        index,
        gatewayFetch,
        device
      ));
    }
    invariant(
      JSON.stringify(calls.map(({ platform }) => platform))
        === JSON.stringify(SOURCE_CASES.map(({ platform }) => platform)),
      "세 플랫폼 fixture materializer 호출 순서가 정확하지 않습니다."
    );
    process.stdout.write(`${JSON.stringify({
      schema: "kirinuki-local-media-engine-semantic-smoke/v1",
      status: "ok",
      nativeRuntime: `${process.platform}-${process.arch}`,
      installedEngineBoundary: "covered-by-separate-native-package-and-installer-smokes",
      gateway: "real-runtime-with-isolated-materializer-fixture",
      trust: "ephemeral-pre-pinned-device-identity",
      transport: "signed-health+ecdh-p256+aes-256-gcm",
      results
    }, null, 2)}\n`);
  } catch (error) {
    failure = error;
  } finally {
    clearLocalMediaEngineSessionState();
    try {
      await runtime.shutdown({ graceMs: 100, deadlineMs: 5_000 });
    } catch (error) {
      failure ??= error;
    }
    try {
      await rm(fixtureRoot, { recursive: true, force: true });
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) {
    throw failure;
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `로컬 영상 엔진 semantic smoke 실패: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
