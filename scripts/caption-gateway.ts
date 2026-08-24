#!/usr/bin/env node

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  webcrypto
} from "node:crypto";
import { constants as fsConstants } from "node:fs";
import type { BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { createServer } from "node:http";
import type {
  IncomingMessage,
  ServerResponse
} from "node:http";
import type { Socket } from "node:net";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  CAPTION_AGENT_REQUEST_SCHEMA_ID,
  CAPTION_AGENT_RESPONSE_SCHEMA_ID,
  CAPTION_CUE_DURATION_POLICY,
  LOCAL_WHISPER_CAPTION_MODEL,
  MAX_CLIP_DURATION_MS,
  SUPPORTED_CAPTION_MODELS,
  CaptionProtocolError
} from "../src/caption-agent/protocol.js";
import {
  CAPTION_HARNESS_FINGERPRINT,
  CAPTION_QUALITY_PROFILE_ID
} from "../src/caption-agent/caption-quality-harness.js";
import {
  CaptionGatewayError,
  LOCAL_WHISPER_TIMESTAMP_CLOCK,
  LOCAL_WHISPER_TIMING_REVISION,
  LOCAL_WHISPER_VAD_ENABLED,
  LOCAL_WHISPERCPP_TRANSCRIPTION_MODE,
  resolveCaptionPipelineConfig,
  resolveCaptionPipelineRequestConfig,
  runCaptionPipeline
} from "../src/caption-agent/caption-gateway-core.js";
import type {
  CaptionPipelineConfig
} from "../src/caption-agent/caption-gateway-core.js";
import {
  KIRINUKI_GATEWAY_ORIGIN_BINDING,
  KIRINUKI_LOCAL_STUDIO_ORIGIN,
  KIRINUKI_PUBLIC_STUDIO_ORIGIN,
  isKirinukiStudioOrigin
} from "../src/lib/local-runtime-origin.js";
import {
  LOCAL_MEDIA_ENGINE_API_PROTOCOL,
  LOCAL_MEDIA_ENGINE_DEVELOPMENT_VERSION,
  LOCAL_MEDIA_ENGINE_HEALTH_PROTOCOL,
  LOCAL_MEDIA_ENGINE_HEALTH_SCHEMA,
  LOCAL_MEDIA_ENGINE_PRODUCT,
  isLocalMediaEngineVersion
} from "../src/lib/local-media-engine-contract.js";
import {
  LOCAL_MEDIA_ENGINE_AUTHENTICATED_HEALTH_PROTOCOL,
  LOCAL_MEDIA_ENGINE_AUTHENTICATED_SESSION_PROTOCOL,
  LOCAL_MEDIA_ENGINE_DEVICE_PROOF_SCHEMA,
  LOCAL_MEDIA_ENGINE_PAIRING_POLL_PROTOCOL,
  LOCAL_MEDIA_ENGINE_PAIRING_POLL_STATUS_SCHEMA,
  LOCAL_MEDIA_ENGINE_PAIRING_STATE_HEADER,
  LOCAL_MEDIA_ENGINE_SESSION_ENCRYPTION_ALGORITHM,
  LOCAL_MEDIA_ENGINE_SESSION_ENCRYPTION_SCHEMA,
  LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER,
  LOCAL_MEDIA_ENGINE_SESSION_STATUS_PROTOCOL,
  LOCAL_MEDIA_ENGINE_SESSION_STATUS_SCHEMA,
  LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
  decryptLocalMediaEngineSessionRequest,
  deriveLocalMediaEngineSharedKey,
  encodeBase64Url,
  encryptLocalMediaEngineSessionResponse,
  localMediaEnginePublicKeyId,
  localMediaEngineProofTranscript,
  pairingResponseUnsignedPayload,
  parseLocalMediaEngineEncryptedSessionRequest,
  parseLocalMediaEnginePairingResponse,
  verifyLocalMediaEngineSignature
} from "../src/lib/local-media-engine-auth.js";
import type {
  LocalMediaEnginePairingResponse
} from "../src/lib/local-media-engine-auth.js";
import {
  LOCAL_MEDIA_ENGINE_TRANSPORT_COUNTER_HEADER,
  LOCAL_MEDIA_ENGINE_TRANSPORT_ID_HEADER,
  LOCAL_MEDIA_ENGINE_TRANSPORT_RESPONSE_SCHEMA,
  localMediaEngineTransportAad,
  parseLocalMediaEngineTransportRequest
} from "../src/lib/local-media-engine-transport.js";
import {
  canonicalSupportedVodSourceUrl
} from "../src/lib/source-embed.js";
import {
  LOCAL_VOD_PLAYBACK_CREATE_PROTOCOL,
  parseLocalVodPlaybackCreateRequest
} from "../src/lib/local-vod-playback.js";
import {
  SOURCE_PLATFORM_CHZZK,
  SOURCE_PLATFORM_SOOP,
  SOURCE_PLATFORM_YOUTUBE,
  inferSourceIdentifiers
} from "../src/lib/source-platform.js";
import {
  normalizeSoopVodSourceClockIdentity
} from "../src/lib/soop-vod-source-clock.js";
import type { SoopVodSourceClockIdentity } from "../src/lib/soop-vod-source-clock.js";
import {
  EDITOR_HANDOFF_ACKNOWLEDGEMENT_SCHEMA,
  EDITOR_HANDOFF_CAPABILITY_ACTION,
  EDITOR_HANDOFF_CONSUME_PROTOCOL,
  EDITOR_HANDOFF_CONSUME_REQUEST_SCHEMA
} from "../src/lib/editor-handoff.js";
import type { EditorHandoffBroker } from "../src/lib/editor-handoff.js";
import {
  CHZZK_VOD_HANDLE_MS,
  CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA,
  CHZZK_VOD_CONSUMER_CACHE_PURGE_REQUEST_SCHEMA,
  CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA,
  VOD_ARTIFACT_CHUNK_BYTES,
  ChzzkVodJobManagerError,
  createChzzkVodJobManager,
  normalizedChzzkVodArtifactDeviceId,
  sameChzzkVodArtifactObjectIdentity
} from "./chzzk-vod-job-manager.js";
import type {
  ChzzkVodArtifactIdentity,
  ChzzkVodArtifactVerification,
  ChzzkVodMaterializationRunner,
  ChzzkVodObserverLeaseScheduler,
  ChzzkVodRunnerResult,
  ChzzkVodPublicStatus
} from "./chzzk-vod-job-manager.js";
import {
  ChzzkVodMaterializationError,
  materializeChzzkVod
} from "./chzzk-vod-materializer.js";
import type {
  ChzzkVodMaterializationProgress
} from "./chzzk-vod-materializer.js";
import {
  EXTERNAL_PROCESS_KILL_GRACE_MS,
  ExternalVodMaterializationError,
  materializeExternalVod
} from "./external-vod-materializer.js";
import type {
  ExternalVodMaterializationProgress,
  ExternalVodMaterializationRequest
} from "./external-vod-materializer.js";
// Provenance boundary: this gateway/job orchestration is Kirinuki first-party;
// yt-dlp/EJS and FFmpeg are separately executed third-party runtimes. Keep the
// canonical registry and deployment obligations in
// src/lib/third-party-attributions.ts and legal/RUNTIME_DEPENDENCIES.md.
import {
  LOCAL_VOD_RUNTIME_SCHEMA,
  PINNED_YT_DLP,
  VOD_RUNTIME_KINDS,
  isValidVodInstanceNonce
} from "./local-vod-runtime-core.js";
import type {
  ManagedVodHealthIdentity,
  VodRuntimeKind
} from "./local-vod-runtime-core.js";
import {
  normalizeVodConsumerId
} from "./vod-consumer-scope.js";
import {
  createLocalVodPlaybackProxy
} from "./local-vod-playback-proxy.js";
import type {
  LocalVodPlaybackResolver
} from "./local-vod-playback-proxy.js";
import {
  resolveLocalVodPlayback
} from "./local-vod-playback-resolver.js";

export const CAPTION_AGENT_CAPABILITY_SCHEMA_ID =
  "chzzk-kirinuki-caption-agent/capability-v2";
export const LOCAL_ENGINE_SESSION_REQUEST_SCHEMA_ID =
  "kirinuki-local-engine-session-request/v1";
export const CAPTION_AGENT_SESSION_SCHEMA_ID =
  "kirinuki-local-engine-session/v1";
export const CAPTION_AGENT_HEALTH_SCHEMA_ID =
  LOCAL_MEDIA_ENGINE_HEALTH_SCHEMA;
export { KIRINUKI_PUBLIC_STUDIO_ORIGIN };
export const DEFAULT_CAPTION_GATEWAY_PORT = 4319;
export const DEFAULT_PAIRING_LIMIT_PER_MINUTE = 12;
export const LOCAL_MEDIA_ENGINE_PAIRING_RESPONSE_TTL_MS = 30_000;
export const MAX_LOCAL_MEDIA_ENGINE_PAIRING_RESPONSES = 8;
export const DEFAULT_MAX_CONCURRENT_CAPTION_PIPELINES = 1;
export const MAX_CONCURRENT_CAPTION_PIPELINES = 2;
export const CAPTION_PIPELINE_RETRY_AFTER_SECONDS = 1;
export const DEFAULT_CAPTION_REQUEST_BODY_TIMEOUT_MS = 15_000;
export const MAX_CAPTION_REQUEST_BODY_TIMEOUT_MS = 60_000;
export const MAX_CHZZK_VOD_REQUEST_BYTES = 256 * 1024;
export const MAX_CHZZK_VOD_CACHE_PURGE_REQUEST_BYTES = 16 * 1024;
export const MAX_LOCAL_ENGINE_SESSION_REQUEST_BYTES = 16 * 1024;
export const LOCAL_ENGINE_CAPABILITY_ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1_000;
export const LOCAL_ENGINE_CAPABILITY_IDLE_TTL_MS = 30 * 60 * 1_000;
export const MAX_LOCAL_ENGINE_CAPABILITIES = 256;
export const LOCAL_ENGINE_SESSION_ENCRYPTION_TTL_MS = 30_000;
export const MAX_LOCAL_ENGINE_SESSION_ENCRYPTION_GRANTS = 256;
export const DEFAULT_GATEWAY_SHUTDOWN_GRACE_MS = 1_500;
export const DEFAULT_GATEWAY_SHUTDOWN_DEADLINE_MS =
  EXTERNAL_PROCESS_KILL_GRACE_MS + 10_000;

interface CaptionGatewayConfig {
  allowedOrigin: string;
  backgroundStart: "ready" | "requires-approval";
  engineVersion: string;
  port: number;
  maxBodyBytes: number;
  maxConcurrentCaptionPipelines: number;
  captionRequestBodyTimeoutMs: number;
  pipeline: Required<CaptionPipelineConfig>;
  vodRuntime: Readonly<ManagedVodHealthIdentity> | null;
  vodStateDir: string | null;
}

interface PairingState {
  windowStartedAt: number;
  count: number;
}

const LOCAL_ENGINE_CAPABILITY_ACTIONS = Object.freeze([
  "vod",
  "captions",
  "cache-delete",
  EDITOR_HANDOFF_CAPABILITY_ACTION
] as const);

type LocalEngineCapabilityAction =
  typeof LOCAL_ENGINE_CAPABILITY_ACTIONS[number];

interface LocalEngineCapability {
  token: string;
  clientNonce: string;
  projectId: string;
  actions: ReadonlySet<LocalEngineCapabilityAction>;
  sourceUrl?: string;
  lastUsedAt: number;
  expiresAt: number;
  transportId?: string;
}

interface LocalEngineSessionEncryptionGrant {
  readonly privateKey: CryptoKey;
  readonly expiresAt: number;
}

interface LocalEngineEncryptedTransport {
  readonly key: Uint8Array;
  readonly clientNonce: string;
  readonly expiresAt: number;
  readonly seenCounters: Set<number>;
  maximumCounter: number;
}

interface PendingLocalMediaEnginePairingResponse {
  readonly response: Readonly<LocalMediaEnginePairingResponse>;
  readonly expiresAt: number;
}

interface DecryptedControlRequest {
  readonly token: string;
  readonly mediaAccess: string | null;
  readonly body: unknown;
  readonly transportId: string;
}

interface TransportResponseContext {
  readonly key: Uint8Array;
  readonly transportId: string;
  readonly counter: number;
  readonly method: string;
  readonly path: string;
  readonly protocol: string;
  readonly clientNonce: string;
}

const TRANSPORT_RESPONSE_CONTEXT = Symbol("kirinukiTransportResponse");

interface LocalEngineSessionRequest {
  schema:
    | typeof LOCAL_ENGINE_SESSION_REQUEST_SCHEMA_ID
    | typeof LOCAL_MEDIA_ENGINE_AUTHENTICATED_SESSION_PROTOCOL;
  clientNonce: string;
  projectId: string;
  actions: readonly LocalEngineCapabilityAction[];
  sourceUrl?: string;
}

export interface LocalMediaEngineDeviceProofSigner {
  readonly algorithm: typeof LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM;
  readonly keyId: string;
  readonly sign: (transcript: Uint8Array) => Promise<string>;
}

interface MaterializationJobOwner {
  projectId: string;
  sourceUrl: string;
}

type PipelineRunner = (
  body: unknown,
  options: CaptionPipelineConfig & {
    fetchImpl?: typeof globalThis.fetch;
    signal?: AbortSignal;
  }
) => Promise<unknown>;

interface NativeVodMaterializationResult {
  manifest: unknown;
  receipt: {
    artifact: {
      hashSha256: string;
      sizeBytes: number;
    };
  };
  artifactPath: string;
  reused: boolean;
}

export type ChzzkVodMaterializerImplementation = (
  request: Parameters<typeof materializeChzzkVod>[0]
) => Promise<NativeVodMaterializationResult>;

export type ExternalVodMaterializerImplementation = (
  request: ExternalVodMaterializationRequest & {
    sourceClockIdentity?: SoopVodSourceClockIdentity;
  }
) => Promise<NativeVodMaterializationResult>;

interface UnitMaterializationProgress {
  phase: ChzzkVodMaterializationProgress["phase"];
  completedUnits: number;
  totalUnits: number;
}

function materializationProgressFraction(
  progress: UnitMaterializationProgress
): number {
  const unitFraction = progress.totalUnits > 0
    ? Math.max(0, Math.min(1, progress.completedUnits / progress.totalUnits))
    : 0;
  if (progress.phase === "resolving") {
    return 0.03;
  }
  if (progress.phase === "planning") {
    return 0.08;
  }
  if (progress.phase === "downloading") {
    return 0.1 + unitFraction * 0.68;
  }
  if (progress.phase === "verifying") {
    return 0.8 + unitFraction * 0.08;
  }
  if (progress.phase === "muxing") {
    return 0.92;
  }
  return 0.999;
}

function materializationProgressMessage(
  progress: UnitMaterializationProgress
): string {
  if (progress.phase === "resolving") {
    return "공개 VOD 원본을 확인하는 중";
  }
  if (progress.phase === "planning") {
    return "현재 clip별 로컬 편집 범위와 필요한 디코딩 조각을 계산하는 중";
  }
  if (progress.phase === "downloading") {
    return progress.totalUnits > 0
      ? `필요한 VOD 구간 ${progress.completedUnits}/${progress.totalUnits} 받는 중`
      : "필요한 VOD 구간을 이 기기로 받는 중";
  }
  if (progress.phase === "verifying") {
    return "받은 VOD 구간의 코덱·무결성을 확인하는 중";
  }
  if (progress.phase === "muxing") {
    return "필요 구간을 로컬 편집 MP4로 구성하는 중";
  }
  return "VOD 편집 구간 준비를 마무리하는 중";
}

function reportMaterializationProgress(
  onProgress: Parameters<ChzzkVodMaterializationRunner>[0]["onProgress"],
  progress: UnitMaterializationProgress
): void {
  const phase = progress.phase === "completed"
    ? "muxing"
    : progress.phase;
  onProgress({
    stage: phase,
    progress: materializationProgressFraction(progress),
    message: materializationProgressMessage(progress)
  });
}

export function createPlatformMaterializationRunner({
  chzzkMaterializer = materializeChzzkVod,
  externalMaterializer = materializeExternalVod
}: {
  chzzkMaterializer?: ChzzkVodMaterializerImplementation;
  externalMaterializer?: ExternalVodMaterializerImplementation;
} = {}): ChzzkVodMaterializationRunner {
  return async ({
    consumerId,
    sourceUrl,
    sourceClockIdentity,
    clips,
    editableRanges,
    handleMs,
    resume,
    base,
    signal,
    onProgress
  }) => {
    const source = inferSourceIdentifiers(sourceUrl);
    const strictSoopSourceClockIdentity = (
      source.platform === SOURCE_PLATFORM_SOOP
      && sourceClockIdentity !== undefined
    )
      ? normalizeSoopVodSourceClockIdentity(sourceClockIdentity)
      : null;
    if (
      (source.platform === SOURCE_PLATFORM_SOOP
        && sourceClockIdentity !== undefined
        && (
          !strictSoopSourceClockIdentity
          || strictSoopSourceClockIdentity.contentId !== source.contentId
        ))
      || (source.platform !== SOURCE_PLATFORM_SOOP
        && sourceClockIdentity !== undefined)
    ) {
      throw new TypeError(
        "제공된 SOOP 공식 VOD part 시계 증명이 현재 원본과 맞지 않습니다."
      );
    }
    let result: NativeVodMaterializationResult;
    if (source.platform === SOURCE_PLATFORM_CHZZK) {
      try {
        result = await chzzkMaterializer({
          consumerId,
          sourceUrl,
          clips,
          ...(editableRanges ? { editableRanges } : {}),
          handleMs,
          ...(resume ? { resume } : {}),
          ...(base ? { base } : {}),
          signal,
          onProgress: (progress) => {
            reportMaterializationProgress(onProgress, {
              phase: progress.phase,
              completedUnits: progress.completedSegments,
              totalUnits: progress.totalSegments
            });
          }
        });
      } catch (error) {
        if (
          !(error instanceof ChzzkVodMaterializationError)
          || error.code !== "VOD_UNAVAILABLE"
        ) {
          throw error;
        }
        // Some completed, public CHZZK replays expose only the live-rewind
        // HLS/fMP4 playlist while `vodStatus` remains NONE. Preserve the
        // native MPD path for ABR_HLS, but use the same uncredentialed,
        // section-limited local acquisition path as YouTube/SOOP for this
        // public fallback instead of rejecting a browser-playable VOD.
        result = await externalMaterializer({
          consumerId,
          sourceUrl,
          clips,
          ...(editableRanges ? { editableRanges } : {}),
          handleMs,
          ...(resume ? { resume } : {}),
          ...(base ? { base } : {}),
          signal,
          onProgress: (progress: ExternalVodMaterializationProgress) => {
            reportMaterializationProgress(onProgress, {
              phase: progress.phase,
              completedUnits: progress.completedSections,
              totalUnits: progress.totalSections
            });
          }
        });
      }
    } else if (
      source.platform === SOURCE_PLATFORM_YOUTUBE
      || source.platform === SOURCE_PLATFORM_SOOP
    ) {
      try {
        result = await externalMaterializer({
          consumerId,
          sourceUrl,
          ...(strictSoopSourceClockIdentity
            ? { sourceClockIdentity: strictSoopSourceClockIdentity }
            : {}),
          clips,
          ...(editableRanges ? { editableRanges } : {}),
          handleMs,
          ...(resume ? { resume } : {}),
          ...(base ? { base } : {}),
          signal,
          onProgress: (progress: ExternalVodMaterializationProgress) => {
            reportMaterializationProgress(onProgress, {
              phase: progress.phase,
              completedUnits: progress.completedSections,
              totalUnits: progress.totalSections
            });
          }
        });
      } catch (error) {
        if (error instanceof ExternalVodMaterializationError) {
          throw error;
        }
        throw new Error("외부 VOD 로컬 준비 중 안전하게 처리하지 못한 오류가 발생했습니다.");
      }
    } else {
      throw new TypeError("지원하는 공개 VOD 원본 주소가 아닙니다.");
    }
    return {
      manifest: result.manifest,
      artifactPath: result.artifactPath,
      artifact: {
        hashSha256: result.receipt.artifact.hashSha256,
        sizeBytes: result.receipt.artifact.sizeBytes
      },
      reused: result.reused
    };
  };
}

type MaterializationRouteNamespace = "chzzk-vod" | "vod";

function statusForMaterializationNamespace(
  status: ChzzkVodPublicStatus,
  namespace: MaterializationRouteNamespace
): ChzzkVodPublicStatus {
  const neutralStatus = {
    ...status,
    message: status.message
      .replace(/CHZZK VOD/gu, "VOD")
      .replace(/CHZZK/gu, "VOD")
  };
  if (namespace !== "vod" || !neutralStatus.media) {
    return neutralStatus;
  }
  const mediaUrl = new URL(neutralStatus.media.url);
  mediaUrl.pathname = mediaUrl.pathname.replace(
    "/v1/chzzk-vod/media/",
    "/v1/vod/media/"
  );
  return {
    ...neutralStatus,
    media: {
      ...neutralStatus.media,
      url: mediaUrl.toString()
    }
  };
}

interface HttpByteRange {
  start: number;
  end: number;
}

const VOD_RUNTIME_ENVIRONMENT_KEYS = Object.freeze([
  "KIRINUKI_VOD_RUNTIME_SCHEMA",
  "KIRINUKI_VOD_RUNTIME_KIND",
  "KIRINUKI_VOD_RUNTIME_READY",
  "KIRINUKI_VOD_YT_DLP_VERSION",
  "KIRINUKI_VOD_EJS_VERSION",
  "KIRINUKI_VOD_INSTANCE_NONCE"
] as const);

function resolveManagedVodRuntimeIdentity(
  env: NodeJS.ProcessEnv
): Readonly<ManagedVodHealthIdentity> | null {
  const supplied = VOD_RUNTIME_ENVIRONMENT_KEYS.filter((key) => (
    env[key] !== undefined && env[key] !== ""
  ));
  if (supplied.length === 0) {
    return null;
  }
  const schema = env.KIRINUKI_VOD_RUNTIME_SCHEMA;
  const kind = env.KIRINUKI_VOD_RUNTIME_KIND;
  const ready = env.KIRINUKI_VOD_RUNTIME_READY;
  const ytDlpVersion = env.KIRINUKI_VOD_YT_DLP_VERSION;
  const ejsVersion = env.KIRINUKI_VOD_EJS_VERSION;
  const instanceNonce = env.KIRINUKI_VOD_INSTANCE_NONCE;
  if (
    supplied.length !== VOD_RUNTIME_ENVIRONMENT_KEYS.length
    || schema !== LOCAL_VOD_RUNTIME_SCHEMA
    || !VOD_RUNTIME_KINDS.includes(kind as VodRuntimeKind)
    || ready !== "1"
    || ytDlpVersion !== PINNED_YT_DLP.version
    || ejsVersion !== PINNED_YT_DLP.bundledJavascript.version
    || !isValidVodInstanceNonce(instanceNonce)
  ) {
    throw new CaptionGatewayError(
      "검증된 로컬 VOD runtime identity 환경이 필요합니다.",
      {
        code: "INVALID_CONFIGURATION",
        httpStatus: 500
      }
    );
  }
  return Object.freeze({
    schema: LOCAL_VOD_RUNTIME_SCHEMA,
    kind: kind as VodRuntimeKind,
    ready: true,
    ytDlp: Object.freeze({ version: PINNED_YT_DLP.version }),
    ejs: Object.freeze({
      version: PINNED_YT_DLP.bundledJavascript.version
    }),
    instanceNonce
  });
}

export function resolveCaptionGatewayConfig(
  env: NodeJS.ProcessEnv = process.env
): CaptionGatewayConfig {
  const pipeline = resolveCaptionPipelineConfig(env, {
    allowMissingProviderConfig: true
  });
  const configuredOriginValue = env.KIRINUKI_ALLOWED_ORIGIN;
  const allowedOrigin = configuredOriginValue === undefined
    ? KIRINUKI_LOCAL_STUDIO_ORIGIN
    : configuredOriginValue;
  if (
    !isKirinukiStudioOrigin(allowedOrigin)
  ) {
    throw new CaptionGatewayError(
      `KIRINUKI_ALLOWED_ORIGIN은 ${KIRINUKI_LOCAL_STUDIO_ORIGIN} 또는 ${KIRINUKI_PUBLIC_STUDIO_ORIGIN}이어야 합니다.`,
      {
        code: "INVALID_CONFIGURATION",
        httpStatus: 500
      }
    );
  }
  const configuredPipelineConcurrency =
    env.KIRINUKI_MAX_CONCURRENT_CAPTION_PIPELINES;
  const maxConcurrentCaptionPipelines = configuredPipelineConcurrency === undefined
    ? DEFAULT_MAX_CONCURRENT_CAPTION_PIPELINES
    : /^[1-9][0-9]*$/u.test(configuredPipelineConcurrency)
      ? Number(configuredPipelineConcurrency)
      : Number.NaN;
  if (
    !Number.isInteger(maxConcurrentCaptionPipelines)
    || maxConcurrentCaptionPipelines < 1
    || maxConcurrentCaptionPipelines > MAX_CONCURRENT_CAPTION_PIPELINES
  ) {
    throw new CaptionGatewayError(
      "KIRINUKI_MAX_CONCURRENT_CAPTION_PIPELINES는 1~2 정수여야 합니다.",
      {
        code: "INVALID_CONFIGURATION",
        httpStatus: 500
      }
    );
  }
  const configuredCaptionBodyTimeout =
    env.KIRINUKI_CAPTION_REQUEST_BODY_TIMEOUT_MS;
  const captionRequestBodyTimeoutMs = configuredCaptionBodyTimeout === undefined
    ? DEFAULT_CAPTION_REQUEST_BODY_TIMEOUT_MS
    : /^[1-9][0-9]*$/u.test(configuredCaptionBodyTimeout)
      ? Number(configuredCaptionBodyTimeout)
      : Number.NaN;
  if (
    !Number.isInteger(captionRequestBodyTimeoutMs)
    || captionRequestBodyTimeoutMs < 1
    || captionRequestBodyTimeoutMs > MAX_CAPTION_REQUEST_BODY_TIMEOUT_MS
  ) {
    throw new CaptionGatewayError(
      "KIRINUKI_CAPTION_REQUEST_BODY_TIMEOUT_MS는 1~60000 정수여야 합니다.",
      {
        code: "INVALID_CONFIGURATION",
        httpStatus: 500
      }
    );
  }
  const portValue = Number(
    env.KIRINUKI_AGENT_PORT || DEFAULT_CAPTION_GATEWAY_PORT
  );
  if (!Number.isInteger(portValue) || portValue < 1 || portValue > 65_535) {
    throw new CaptionGatewayError(
      "KIRINUKI_AGENT_PORT가 올바르지 않습니다.",
      {
        code: "INVALID_CONFIGURATION",
        httpStatus: 500
      }
    );
  }
  const requestedBodyBytes = Number(env.KIRINUKI_MAX_BODY_BYTES);
  const minimumBodyBytes =
    Math.ceil(pipeline.maxAudioBytes * 4 / 3) + 1_048_576;
  const vodRuntime = resolveManagedVodRuntimeIdentity(env);
  const engineVersion = env.KIRINUKI_LOCAL_ENGINE_VERSION
    ?? LOCAL_MEDIA_ENGINE_DEVELOPMENT_VERSION;
  if (!isLocalMediaEngineVersion(engineVersion)) {
    throw new CaptionGatewayError(
      "KIRINUKI_LOCAL_ENGINE_VERSION이 올바른 release identity가 아닙니다.",
      {
        code: "INVALID_CONFIGURATION",
        httpStatus: 500
      }
    );
  }
  const backgroundStart = env.KIRINUKI_LOCAL_ENGINE_BACKGROUND_START
    ?? "ready";
  if (!["ready", "requires-approval"].includes(backgroundStart)) {
    throw new CaptionGatewayError(
      "KIRINUKI_LOCAL_ENGINE_BACKGROUND_START 상태가 올바르지 않습니다.",
      {
        code: "INVALID_CONFIGURATION",
        httpStatus: 500
      }
    );
  }
  const configuredVodStateDir = String(
    env.KIRINUKI_VOD_STATE_DIR || ""
  ).trim();
  if (
    vodRuntime
    && (
      !configuredVodStateDir
      || !path.isAbsolute(configuredVodStateDir)
      || /[\u0000-\u001f\u007f]/u.test(configuredVodStateDir)
      || path.parse(configuredVodStateDir).root
        === path.resolve(configuredVodStateDir)
    )
  ) {
    throw new CaptionGatewayError(
      "관리형 VOD runtime에는 안전한 절대 KIRINUKI_VOD_STATE_DIR가 필요합니다.",
      {
        code: "INVALID_CONFIGURATION",
        httpStatus: 500
      }
    );
  }
  return {
    allowedOrigin,
    backgroundStart: backgroundStart as CaptionGatewayConfig["backgroundStart"],
    engineVersion,
    port: portValue,
    maxBodyBytes: Number.isFinite(requestedBodyBytes)
      && requestedBodyBytes > 0
      ? Math.max(Math.floor(requestedBodyBytes), minimumBodyBytes)
      : minimumBodyBytes,
    maxConcurrentCaptionPipelines,
    captionRequestBodyTimeoutMs,
    pipeline,
    vodRuntime,
    vodStateDir: configuredVodStateDir
      ? path.resolve(configuredVodStateDir)
      : null
  };
}

function rawHeaderValues(
  request: Pick<IncomingMessage, "rawHeaders">,
  headerName: string
): string[] {
  const normalizedName = headerName.toLowerCase();
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === normalizedName) {
      values.push(request.rawHeaders[index + 1] || "");
    }
  }
  return values;
}

function singleRawHeaderValue(
  request: Pick<IncomingMessage, "rawHeaders">,
  headerName: string
): string | null {
  const values = rawHeaderValues(request, headerName);
  return values.length === 1 ? values[0] || null : null;
}

function validGatewayAuthority(request: IncomingMessage): boolean {
  const localPort = request.socket.localPort;
  if (!Number.isInteger(localPort) || !localPort) {
    return false;
  }
  const hosts = rawHeaderValues(request, "host");
  if (
    hosts.length !== 1
    || hosts[0] !== `127.0.0.1:${localPort}`
  ) {
    return false;
  }
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = String(request.rawHeaders[index] || "").toLowerCase();
    if (name === "forwarded" || name.startsWith("x-forwarded-")) {
      return false;
    }
  }
  return true;
}

function exactBase64UrlBytes(value: unknown, byteLength: number): string | null {
  if (
    typeof value !== "string"
    || !/^[a-zA-Z0-9_-]+$/u.test(value)
  ) {
    return null;
  }
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.byteLength === byteLength
      && decoded.toString("base64url") === value
      ? value
      : null;
  } catch {
    return null;
  }
}

function requestBearerToken(request: IncomingMessage): string | null {
  const authorization = singleRawHeaderValue(request, "authorization");
  const match = authorization
    ? /^Bearer ([^\s]+)$/u.exec(authorization)
    : null;
  return exactBase64UrlBytes(match?.[1], 32);
}

function requestClientNonce(request: IncomingMessage): string | null {
  return exactBase64UrlBytes(
    singleRawHeaderValue(request, "x-kirinuki-client-nonce"),
    32
  );
}

function requestServerChallenge(request: IncomingMessage): string | null {
  return exactBase64UrlBytes(
    singleRawHeaderValue(
      request,
      LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER.toLowerCase()
    ),
    32
  );
}

function normalizeCapabilityProjectId(value: unknown): string {
  const projectId = normalizeVodConsumerId(value);
  if (projectId !== value) {
    throw new TypeError("로컬 엔진 세션 프로젝트 ID가 올바르지 않습니다.");
  }
  return projectId;
}

function normalizeCapabilitySourceUrl(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "string"
    || !value
    || value.trim() !== value
    || value.length > 8_192
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError("로컬 엔진 세션 원본 주소가 올바르지 않습니다.");
  }
  const canonicalUrl = canonicalSupportedVodSourceUrl(value);
  if (!canonicalUrl || canonicalUrl !== value) {
    throw new TypeError(
      "로컬 엔진 세션 원본 주소는 지원하는 VOD의 정규 URL이어야 합니다."
    );
  }
  return canonicalUrl;
}

function normalizeLocalEngineSessionRequest(
  value: unknown,
  expectedSchema:
    | typeof LOCAL_ENGINE_SESSION_REQUEST_SCHEMA_ID
    | typeof LOCAL_MEDIA_ENGINE_AUTHENTICATED_SESSION_PROTOCOL
): LocalEngineSessionRequest {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
  ) {
    throw new TypeError("로컬 엔진 세션 요청이 올바르지 않습니다.");
  }
  const record = value as Record<string, unknown>;
  if (
    record.schema !== expectedSchema
    || Object.keys(record).some((key) => ![
      "schema",
      "clientNonce",
      "projectId",
      "actions",
      "sourceUrl"
    ].includes(key))
  ) {
    throw new TypeError("로컬 엔진 세션 요청 버전이 맞지 않습니다.");
  }
  const clientNonce = exactBase64UrlBytes(record.clientNonce, 32);
  if (!clientNonce) {
    throw new TypeError("로컬 엔진 문서 nonce가 올바르지 않습니다.");
  }
  if (
    !Array.isArray(record.actions)
    || record.actions.length === 0
    || record.actions.length > LOCAL_ENGINE_CAPABILITY_ACTIONS.length
    || record.actions.some((action) => (
      typeof action !== "string"
      || !LOCAL_ENGINE_CAPABILITY_ACTIONS.includes(
        action as LocalEngineCapabilityAction
      )
    ))
    || new Set(record.actions).size !== record.actions.length
  ) {
    throw new TypeError("로컬 엔진 세션 작업 범위가 올바르지 않습니다.");
  }
  const sourceUrl = record.sourceUrl === undefined
    ? undefined
    : normalizeCapabilitySourceUrl(record.sourceUrl);
  if (record.actions.includes("vod") && sourceUrl === undefined) {
    throw new TypeError(
      "VOD 작업 capability에는 지원하는 VOD의 정규 원본 주소가 필요합니다."
    );
  }
  if (expectedSchema === LOCAL_MEDIA_ENGINE_AUTHENTICATED_SESSION_PROTOCOL) {
    const expectedActionSets: readonly (readonly LocalEngineCapabilityAction[])[] =
      sourceUrl === undefined
        ? [["captions"], [EDITOR_HANDOFF_CAPABILITY_ACTION]]
        : [["vod", "cache-delete"]];
    if (!expectedActionSets.some((expectedActions) => (
      JSON.stringify(record.actions) === JSON.stringify(expectedActions)
    ))) {
      throw new TypeError(
        sourceUrl === undefined
          ? "원본 없는 session은 자막 또는 편집기 인계 최소 권한 하나만 요청해야 합니다."
          : "VOD session은 vod/cache-delete 최소 권한만 요청해야 합니다."
      );
    }
  }
  return {
    schema: expectedSchema,
    clientNonce,
    projectId: normalizeCapabilityProjectId(record.projectId),
    actions: record.actions as LocalEngineCapabilityAction[],
    ...(sourceUrl === undefined ? {} : { sourceUrl })
  };
}

const CORS_REQUEST_HEADERS = Object.freeze([
  "authorization",
  "content-type",
  "x-kirinuki-client-nonce",
  "x-kirinuki-media-access",
  "x-kirinuki-protocol",
  LOCAL_MEDIA_ENGINE_PAIRING_STATE_HEADER.toLowerCase(),
  LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER.toLowerCase(),
  LOCAL_MEDIA_ENGINE_TRANSPORT_ID_HEADER.toLowerCase(),
  LOCAL_MEDIA_ENGINE_TRANSPORT_COUNTER_HEADER.toLowerCase()
] as const);

function validCorsPreflight(
  request: IncomingMessage,
  allowedMethods: readonly string[]
): boolean {
  const requestedMethod = String(
    request.headers["access-control-request-method"] || ""
  ).toUpperCase();
  if (!allowedMethods.includes(requestedMethod)) {
    return false;
  }
  const requestedHeadersValue = String(
    request.headers["access-control-request-headers"] || ""
  );
  const requestedHeaders = requestedHeadersValue
    ? requestedHeadersValue.split(",").map((value) => value.trim().toLowerCase())
    : [];
  if (
    requestedHeaders.some((value) => !value)
    || new Set(requestedHeaders).size !== requestedHeaders.length
    || requestedHeaders.some((value) => !CORS_REQUEST_HEADERS.includes(
      value as typeof CORS_REQUEST_HEADERS[number]
    ))
  ) {
    return false;
  }
  const privateNetwork = request.headers[
    "access-control-request-private-network"
  ];
  return privateNetwork === undefined || privateNetwork === "true";
}

function setCorsHeaders(
  request: IncomingMessage,
  response: ServerResponse,
  origin: string,
  allowedOrigin: string
): void {
  if (origin !== allowedOrigin) {
    return;
  }
  response.setHeader("access-control-allow-origin", allowedOrigin);
  response.setHeader(
    "access-control-allow-methods",
    "GET, HEAD, POST, DELETE, OPTIONS"
  );
  response.setHeader(
    "access-control-allow-headers",
    [
      "Authorization",
      "Content-Type",
      "X-Kirinuki-Client-Nonce",
      "X-Kirinuki-Media-Access",
      "X-Kirinuki-Protocol",
      LOCAL_MEDIA_ENGINE_PAIRING_STATE_HEADER,
      LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER,
      LOCAL_MEDIA_ENGINE_TRANSPORT_ID_HEADER,
      LOCAL_MEDIA_ENGINE_TRANSPORT_COUNTER_HEADER
    ].join(", ")
  );
  response.setHeader("access-control-max-age", "600");
  response.setHeader(
    "access-control-expose-headers",
    "Accept-Ranges, Content-Length, Content-Range, ETag"
  );
  // Chromium's current LNA model uses a user permission prompt. Keep the
  // older PNA response narrowly scoped to an exact-origin preflight for
  // clients that still send it; never advertise it on ordinary responses.
  const requestsPrivateNetwork = request.method === "OPTIONS"
    && request.headers["access-control-request-private-network"] === "true";
  if (requestsPrivateNetwork) {
    response.setHeader("access-control-allow-private-network", "true");
  }
  response.setHeader(
    "vary",
    "Origin, Access-Control-Request-Private-Network"
  );
}

function pairingAllowed(
  pairingState: PairingState,
  now = Date.now()
): boolean {
  const windowMs = 60_000;
  if (now - pairingState.windowStartedAt >= windowMs) {
    pairingState.windowStartedAt = now;
    pairingState.count = 0;
  }
  pairingState.count += 1;
  return pairingState.count <= DEFAULT_PAIRING_LIMIT_PER_MINUTE;
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown
): void {
  const plaintext = JSON.stringify(value);
  const transportContext = (
    response as ServerResponse & {
      [TRANSPORT_RESPONSE_CONTEXT]?: Readonly<TransportResponseContext>;
    }
  )[TRANSPORT_RESPONSE_CONTEXT];
  let body = plaintext;
  if (transportContext) {
    const ivBytes = randomBytes(12);
    const iv = ivBytes.toString("base64url");
    const aad = localMediaEngineTransportAad({
      direction: "response",
      transportId: transportContext.transportId,
      counter: transportContext.counter,
      method: transportContext.method,
      path: transportContext.path,
      protocol: transportContext.protocol,
      clientNonce: transportContext.clientNonce,
      iv,
      status: statusCode
    });
    const cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(transportContext.key),
      ivBytes,
      { authTagLength: 16 }
    );
    cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
      cipher.getAuthTag()
    ]);
    body = JSON.stringify({
      schema: LOCAL_MEDIA_ENGINE_TRANSPORT_RESPONSE_SCHEMA,
      transportId: transportContext.transportId,
      counter: transportContext.counter,
      iv,
      ciphertext: ciphertext.toString("base64url")
    });
  }
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-length", Buffer.byteLength(body));
  response.end(body);
}

function discardUnreadRequestBody(
  request: IncomingMessage,
  response: ServerResponse
): void {
  if (
    request.readableEnded
    || (
      request.complete
      && request.readableLength === 0
    )
  ) {
    return;
  }
  // Node 24+ may reuse the connection as soon as an early error response has
  // ended. Drain (without buffering) any body that authentication/protocol
  // checks rejected so its bytes cannot be parsed as the next keep-alive
  // request and turn that request into an empty HTTP 400.
  response.shouldKeepAlive = false;
  response.setHeader("connection", "close");
  request.on("error", () => {});
  request.resume();
}

function rejectJson(
  request: IncomingMessage,
  response: ServerResponse,
  statusCode: number,
  value: unknown
): void {
  discardUnreadRequestBody(request, response);
  sendJson(response, statusCode, value);
}

function sendGatewayClosing(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigin: string
): void {
  request.on("error", () => {});
  request.resume();
  response.shouldKeepAlive = false;
  response.setHeader("connection", "close");
  setCorsHeaders(
    request,
    response,
    singleRawHeaderValue(request, "origin") || "",
    allowedOrigin
  );
  sendJson(response, 503, {
    error: {
      code: "GATEWAY_SHUTTING_DOWN",
      message: "Kirinuki 내부 자막 엔진이 종료 중이라 새 요청을 받을 수 없습니다."
    }
  });
}

async function waitForResponseSettlement(
  response: ServerResponse
): Promise<void> {
  const requestSocket = response.req.socket;
  if (
    response.writableFinished
    || response.destroyed
    || response.closed
    || requestSocket.destroyed
  ) {
    return;
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    const cleanup = () => {
      response.removeListener("finish", finish);
      response.removeListener("close", finish);
      response.removeListener("error", finish);
      requestSocket.removeListener("close", finish);
    };
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };
    response.once("finish", finish);
    response.once("close", finish);
    response.once("error", finish);
    // Node 22 can detach a queued pipelined ServerResponse from its socket
    // without emitting `close` on that response when shutdown destroys the
    // connection. The request socket closing is the terminal fallback: no
    // response bytes can remain writable after that point.
    requestSocket.once("close", finish);
    if (
      response.writableFinished
      || response.destroyed
      || response.closed
      || requestSocket.destroyed
    ) {
      finish();
    }
  });
}

export function parseHttpByteRange(
  value: unknown,
  size: number
): HttpByteRange | null {
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new TypeError("미디어 파일 크기가 올바르지 않습니다.");
  }
  const header = String(value || "").trim();
  if (!header) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header);
  if (!match || (!match[1] && !match[2])) {
    throw new RangeError("단일 bytes 범위만 지원합니다.");
  }
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw new RangeError("요청한 미디어 범위가 올바르지 않습니다.");
    }
    return {
      start: Math.max(0, size - suffixLength),
      end: size - 1
    };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || start >= size
    || requestedEnd < start
  ) {
    throw new RangeError("요청한 미디어 범위가 파일 밖에 있습니다.");
  }
  return {
    start,
    end: Math.min(size - 1, requestedEnd)
  };
}

function sameMediaIdentity(
  metadata: BigIntStats,
  expectedIdentity: Readonly<ChzzkVodArtifactIdentity>
): boolean {
  return Boolean(
    metadata.isFile()
    && Number(metadata.size) === expectedIdentity.size
    && metadata.dev.toString() === expectedIdentity.rawDev
    && normalizedChzzkVodArtifactDeviceId(metadata.dev) === expectedIdentity.dev
    && metadata.ino.toString() === expectedIdentity.ino
    && metadata.nlink.toString() === expectedIdentity.nlink
    && metadata.mtimeNs.toString() === expectedIdentity.mtimeNs
    && metadata.ctimeNs.toString() === expectedIdentity.ctimeNs
  );
}

function mediaIdentityFromStats(
  metadata: BigIntStats,
  symlink: boolean
): ChzzkVodArtifactIdentity {
  return {
    size: Number(metadata.size),
    mtimeMs: Number(metadata.mtimeNs) / 1_000_000,
    rawDev: metadata.dev.toString(),
    dev: normalizedChzzkVodArtifactDeviceId(metadata.dev),
    ino: metadata.ino.toString(),
    nlink: metadata.nlink.toString(),
    mtimeNs: metadata.mtimeNs.toString(),
    ctimeNs: metadata.ctimeNs.toString(),
    regular: metadata.isFile(),
    symlink
  };
}

function mediaTransferAborted(): DOMException {
  return new DOMException("로컬 미디어 전송이 중단되었습니다.", "AbortError");
}

function assertMediaTransferActive(
  request: IncomingMessage,
  response: ServerResponse,
  signal: AbortSignal
): void {
  signal.throwIfAborted();
  if (request.aborted || response.destroyed || response.writableEnded) {
    throw mediaTransferAborted();
  }
}

async function writeMediaBuffer(
  request: IncomingMessage,
  response: ServerResponse,
  buffer: Buffer,
  signal: AbortSignal
): Promise<void> {
  assertMediaTransferActive(request, response, signal);
  if (response.write(buffer)) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      response.removeListener("drain", onDrain);
      response.removeListener("close", onClose);
      response.removeListener("error", onError);
      request.removeListener("aborted", onClose);
      signal.removeEventListener("abort", onAbort);
    };
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      error ? reject(error) : resolve();
    };
    const onDrain = () => finish();
    const onClose = () => finish(mediaTransferAborted());
    const onError = (error: Error) => finish(error);
    const onAbort = () => finish(mediaTransferAborted());
    response.once("drain", onDrain);
    response.once("close", onClose);
    response.once("error", onError);
    request.once("aborted", onClose);
    signal.addEventListener("abort", onAbort, { once: true });
    if (
      signal.aborted
      || request.aborted
      || response.destroyed
      || response.writableEnded
    ) {
      onAbort();
    }
  });
}

export async function sendLocalMedia(
  request: IncomingMessage,
  response: ServerResponse,
  artifactPath: string,
  expectedIdentity: Readonly<ChzzkVodArtifactIdentity>,
  expectedIntegrity: Readonly<ChzzkVodRunnerResult["artifact"]>,
  expectedVerification: Readonly<ChzzkVodArtifactVerification>,
  signal: AbortSignal
): Promise<void> {
  const handle = await open(
    artifactPath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)
  );
  try {
    const metadata = await handle.stat({ bigint: true });
    const pathMetadata = await lstat(artifactPath, { bigint: true });
    const handleIdentity = mediaIdentityFromStats(metadata, false);
    if (
      !sameChzzkVodArtifactObjectIdentity(handleIdentity, expectedIdentity)
      || !sameMediaIdentity(pathMetadata, expectedIdentity)
      || pathMetadata.isSymbolicLink()
      || expectedIntegrity.sizeBytes !== expectedIdentity.size
      || expectedVerification.hashSha256 !== expectedIntegrity.hashSha256
      || expectedVerification.chunkSizeBytes !== VOD_ARTIFACT_CHUNK_BYTES
      || expectedVerification.chunkHashesSha256.length !== Math.ceil(
        expectedIdentity.size / VOD_ARTIFACT_CHUNK_BYTES
      )
    ) {
      throw new Error("검증 뒤 로컬 편집 미디어 파일 identity가 바뀌었습니다.");
    }
    const size = expectedIdentity.size;
    const etag = `"sha256-${expectedIntegrity.hashSha256}"`;
    response.setHeader("accept-ranges", "bytes");
    response.setHeader("content-type", "video/mp4");
    response.setHeader("cache-control", "private, no-store");
    response.setHeader("etag", etag);
    if (
      !request.headers.range
      && String(request.headers["if-none-match"] || "") === etag
    ) {
      response.statusCode = 304;
      response.end();
      return;
    }
    let range: HttpByteRange | null;
    try {
      range = parseHttpByteRange(request.headers.range, size);
    } catch (error) {
      if (error instanceof RangeError) {
        response.statusCode = 416;
        response.setHeader("content-range", `bytes */${size}`);
        response.setHeader("content-length", "0");
        response.end();
        return;
      }
      throw error;
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    response.statusCode = range ? 206 : 200;
    response.setHeader("content-length", String(end - start + 1));
    if (range) {
      response.setHeader("content-range", `bytes ${start}-${end}/${size}`);
    }
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    const firstChunk = Math.floor(start / VOD_ARTIFACT_CHUNK_BYTES);
    const lastChunk = Math.floor(end / VOD_ARTIFACT_CHUNK_BYTES);
    for (let chunkIndex = firstChunk; chunkIndex <= lastChunk; chunkIndex += 1) {
      assertMediaTransferActive(request, response, signal);
      const chunkStart = chunkIndex * VOD_ARTIFACT_CHUNK_BYTES;
      const chunkLength = Math.min(
        VOD_ARTIFACT_CHUNK_BYTES,
        size - chunkStart
      );
      const buffer = Buffer.allocUnsafe(chunkLength);
      let chunkOffset = 0;
      while (chunkOffset < chunkLength) {
        assertMediaTransferActive(request, response, signal);
        const { bytesRead } = await handle.read(
          buffer,
          chunkOffset,
          chunkLength - chunkOffset,
          chunkStart + chunkOffset
        );
        if (bytesRead <= 0) {
          throw new Error("로컬 편집 미디어 청크를 끝까지 읽지 못했습니다.");
        }
        chunkOffset += bytesRead;
      }
      const expectedChunkHash = expectedVerification
        .chunkHashesSha256[chunkIndex];
      const actualChunkHash = createHash("sha256")
        .update(buffer)
        .digest("hex");
      if (!expectedChunkHash || actualChunkHash !== expectedChunkHash) {
        throw new Error("로컬 편집 미디어 청크 무결성이 receipt와 다릅니다.");
      }
      const sliceStart = Math.max(start, chunkStart) - chunkStart;
      const sliceEnd = Math.min(end + 1, chunkStart + chunkLength) - chunkStart;
      await writeMediaBuffer(
        request,
        response,
        buffer.subarray(sliceStart, sliceEnd),
        signal
      );
    }
    response.end();
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function readJsonRequest(
  request: IncomingMessage,
  maxBodyBytes: number,
  {
    signal,
    timeoutMs
  }: {
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {}
): Promise<unknown> {
  const [rawContentType = ""] = String(
    request.headers["content-type"] || ""
  ).split(";", 1);
  const contentType = rawContentType.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new CaptionGatewayError(
      "Content-Type은 application/json이어야 합니다.",
      {
        code: "UNSUPPORTED_MEDIA_TYPE",
        httpStatus: 415
      }
    );
  }
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const cleanup = (): void => {
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("aborted", onAborted);
      request.removeListener("error", onError);
      signal?.removeEventListener("abort", onSignalAbort);
      clearTimeout(timer);
    };
    const fail = (error: unknown, pause: boolean = false): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (pause && !request.readableEnded) {
        request.pause();
      }
      cleanup();
      reject(error);
    };
    const finish = (value: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };
    function onData(chunk: Buffer | string): void {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.byteLength;
      if (size > maxBodyBytes) {
        fail(new CaptionGatewayError("자막 요청 본문이 너무 큽니다.", {
          code: "REQUEST_TOO_LARGE",
          httpStatus: 413
        }), true);
        return;
      }
      chunks.push(bytes);
    }
    function onEnd(): void {
      try {
        finish(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        fail(new CaptionGatewayError(
          "요청 본문이 올바른 JSON이 아닙니다.",
          {
            code: "INVALID_JSON",
            httpStatus: 400
          }
        ));
      }
    }
    function onAborted(): void {
      fail(new DOMException("요청 본문 연결이 닫혔습니다.", "AbortError"));
    }
    function onError(error: Error): void {
      fail(error);
    }
    function onSignalAbort(): void {
      fail(
        signal?.reason
          ?? new DOMException("요청 본문 읽기가 중단되었습니다.", "AbortError"),
        true
      );
    }
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("aborted", onAborted);
    request.once("error", onError);
    signal?.addEventListener("abort", onSignalAbort, { once: true });
    if (signal?.aborted) {
      onSignalAbort();
      return;
    }
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        fail(new CaptionGatewayError(
          "자막 요청 본문을 제한 시간 안에 받지 못했습니다.",
          {
            code: "REQUEST_BODY_TIMEOUT",
            httpStatus: 408
          }
        ), true);
      }, timeoutMs);
      timer.unref();
    }
  });
}

function safeError(error: unknown): {
  status: number;
  code: string;
  message: string;
} {
  if (error instanceof CaptionProtocolError) {
    return {
      status: error.code === "WAV_TOO_LARGE" ? 413 : 400,
      code: error.code,
      message: error.message
    };
  }
  if (error instanceof CaptionGatewayError) {
    return {
      status: error.httpStatus,
      code: error.code,
      message: error.message
    };
  }
  if (error instanceof ExternalVodMaterializationError) {
    const clientErrorCodes = new Set([
      "INVALID_CLIPS",
      "INVALID_HANDLE",
      "INVALID_METADATA",
      "INVALID_SECTION",
      "INVALID_SOURCE_URL",
      "LIVE_SOURCE",
      "PLATFORM_MISMATCH",
      "RESTRICTED_SOURCE"
    ]);
    return {
      status: clientErrorCodes.has(error.code) ? 400 : 503,
      code: error.code,
      message: error.message
    };
  }
  if (error instanceof ChzzkVodJobManagerError) {
    if (
      error.code === "PURGE_IDENTITY_MISMATCH"
      || error.code === "PURGE_NOT_ALLOWED"
    ) {
      return {
        status: 409,
        code: error.code,
        message: error.message
      };
    }
    return {
      status: error.code === "BUSY"
        ? 429
        : error.code === "PURGE_FAILED"
          ? 500
          : 503,
      code: error.code,
      message: error.message
    };
  }
  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "자막 게이트웨이 내부 오류가 발생했습니다."
  };
}

function capabilityResponse(config: CaptionGatewayConfig) {
  const ready = Boolean(config.pipeline.sttEndpoint);
  return {
    schema: CAPTION_AGENT_CAPABILITY_SCHEMA_ID,
    status: "ok",
    provider: "local-whispercpp",
    models: {
      stt: config.pipeline.sttModel,
      captions: LOCAL_WHISPER_CAPTION_MODEL
    },
    model: LOCAL_WHISPER_CAPTION_MODEL,
    defaultModel: LOCAL_WHISPER_CAPTION_MODEL,
    availableModels: [...SUPPORTED_CAPTION_MODELS],
    transcription: {
      mode: LOCAL_WHISPERCPP_TRANSCRIPTION_MODE,
      requiresTimedTranscript: true,
      authentication: "none-loopback",
      vad: LOCAL_WHISPER_VAD_ENABLED,
      timestampClock: LOCAL_WHISPER_TIMESTAMP_CLOCK,
      timingRevision: LOCAL_WHISPER_TIMING_REVISION,
      ready
    },
    requestSchema: CAPTION_AGENT_REQUEST_SCHEMA_ID,
    responseSchema: CAPTION_AGENT_RESPONSE_SCHEMA_ID,
    qualityHarness: {
      profile: CAPTION_QUALITY_PROFILE_ID,
      harnessFingerprint: CAPTION_HARNESS_FINGERPRINT,
      automaticBodyLines: 1,
      placement: "bottom",
      paidRepairCalls: 0
    },
    cueDurationPolicy: CAPTION_CUE_DURATION_POLICY,
    maxClipDurationMs: MAX_CLIP_DURATION_MS,
    maxAudioBytes: config.pipeline.maxAudioBytes,
    pipelineTimeoutMs: config.pipeline.pipelineTimeoutMs,
    configured: {
      localWhisperReady: ready
    },
    vodMaterialization: {
      ready: Boolean(config.vodRuntime?.ready),
      runtime: config.vodRuntime,
      source: "public-vod",
      platforms: [
        SOURCE_PLATFORM_CHZZK,
        SOURCE_PLATFORM_YOUTUBE,
        SOURCE_PLATFORM_SOOP
      ],
      handleMs: CHZZK_VOD_HANDLE_MS,
      acquisition: "initial-selected-ranges-plus-10s-incremental-local-only",
      incremental: true,
      incrementMs: 30_000,
      loginOrCookies: false,
      drmBypass: false
    }
  };
}

export function createCaptionGatewayServer({
  env = process.env,
  deviceProofSigner,
  fetchImpl = globalThis.fetch,
  pipelineRunner = runCaptionPipeline,
  materializationRunner,
  chzzkMaterializer = materializeChzzkVod,
  externalMaterializer = materializeExternalVod,
  editorHandoffBroker,
  playbackResolver,
  vodObserverLeaseTtlMs,
  vodObserverLeaseScheduler,
  randomBytesImpl = randomBytes,
  now = Date.now
}: {
  env?: NodeJS.ProcessEnv;
  deviceProofSigner?: Readonly<LocalMediaEngineDeviceProofSigner>;
  fetchImpl?: typeof globalThis.fetch;
  pipelineRunner?: PipelineRunner;
  materializationRunner?: ChzzkVodMaterializationRunner;
  chzzkMaterializer?: ChzzkVodMaterializerImplementation;
  externalMaterializer?: ExternalVodMaterializerImplementation;
  editorHandoffBroker?: Readonly<EditorHandoffBroker>;
  playbackResolver?: LocalVodPlaybackResolver;
  vodObserverLeaseTtlMs?: number;
  vodObserverLeaseScheduler?: ChzzkVodObserverLeaseScheduler;
  randomBytesImpl?: typeof randomBytes;
  now?: () => number;
} = {}) {
  const config = resolveCaptionGatewayConfig(env);
  if (
    deviceProofSigner !== undefined
    && (
      deviceProofSigner.algorithm !== LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM
      || exactBase64UrlBytes(deviceProofSigner.keyId, 32) === null
      || typeof deviceProofSigner.sign !== "function"
    )
  ) {
    throw new CaptionGatewayError(
      "로컬 엔진 device proof signer가 올바르지 않습니다.",
      {
        code: "INVALID_CONFIGURATION",
        httpStatus: 500
      }
    );
  }
  const authenticatedPublicMode =
    config.allowedOrigin === KIRINUKI_PUBLIC_STUDIO_ORIGIN;
  const pairingState = {
    windowStartedAt: now(),
    count: 0
  };
  const selectedMaterializationRunner = materializationRunner
    ?? createPlatformMaterializationRunner({
      chzzkMaterializer,
      externalMaterializer
    });
  const localVodPlayback = createLocalVodPlaybackProxy({
    resolvePlayback: playbackResolver ?? ((sourceUrl, signal) => (
      resolveLocalVodPlayback(sourceUrl, {
        ytDlpBinary: String(env.KIRINUKI_YT_DLP_BINARY || ""),
        nodeBinary: String(env.KIRINUKI_YT_DLP_NODE_BINARY || process.execPath),
        processEnv: env,
        ...(signal ? { signal } : {})
      })
    )),
    fetchImpl,
    randomBytesImpl,
    now
  });
  const chzzkVodJobs = createChzzkVodJobManager({
    runner: selectedMaterializationRunner,
    ...(config.vodStateDir ? { artifactRoot: config.vodStateDir } : {}),
    ...(vodObserverLeaseTtlMs === undefined
      ? {}
      : { observerLeaseTtlMs: vodObserverLeaseTtlMs }),
    ...(vodObserverLeaseScheduler === undefined
      ? {}
      : { observerLeaseScheduler: vodObserverLeaseScheduler }),
    randomBytesImpl,
    now
  });
  const vodCacheRecovery = chzzkVodJobs.initialize();
  void vodCacheRecovery.catch(() => undefined);
  const activeMediaControllers = new Set<AbortController>();
  const activePipelineControllers = new Set<AbortController>();
  const activeHandlers = new Set<Promise<void>>();
  const sockets = new Set<Socket>();
  const gatewayShutdownController = new AbortController();
  const capabilitiesByToken = new Map<string, LocalEngineCapability>();
  const tokenByClientNonce = new Map<string, string>();
  const materializationJobOwners = new Map<string, MaterializationJobOwner>();
  const sessionEncryptionGrants = new Map<
    string,
    LocalEngineSessionEncryptionGrant
  >();
  const pendingPairingResponses = new Map<
    string,
    PendingLocalMediaEnginePairingResponse
  >();
  const encryptedTransports = new Map<string, LocalEngineEncryptedTransport>();
  const decryptedControlRequests = new WeakMap<
    IncomingMessage,
    DecryptedControlRequest
  >();

  const pruneEncryptedState = (timestamp: number): void => {
    for (const [state, pending] of pendingPairingResponses) {
      if (timestamp >= pending.expiresAt) {
        pendingPairingResponses.delete(state);
      }
    }
    for (const [grantId, grant] of sessionEncryptionGrants) {
      if (timestamp >= grant.expiresAt) {
        sessionEncryptionGrants.delete(grantId);
      }
    }
    for (const [transportId, transport] of encryptedTransports) {
      if (timestamp >= transport.expiresAt) {
        transport.key.fill(0);
        encryptedTransports.delete(transportId);
      }
    }
  };

  const publishPairingResponse = async (
    value: Readonly<LocalMediaEnginePairingResponse>
  ): Promise<void> => {
    const response = parseLocalMediaEnginePairingResponse(value);
    const timestamp = now();
    pruneEncryptedState(timestamp);
    const issuedAt = response ? Date.parse(response.issuedAt) : Number.NaN;
    if (
      !response
      || !deviceProofSigner
      || response.keyId !== deviceProofSigner.keyId
      || response.engineVersion !== config.engineVersion
      || !Number.isFinite(timestamp)
      || issuedAt > timestamp + 5_000
      || timestamp - issuedAt > LOCAL_MEDIA_ENGINE_PAIRING_RESPONSE_TTL_MS
      || pendingPairingResponses.has(response.state)
      || pendingPairingResponses.size >= MAX_LOCAL_MEDIA_ENGINE_PAIRING_RESPONSES
      || await localMediaEnginePublicKeyId(response.publicKeySpki)
        !== response.keyId
      || !await verifyLocalMediaEngineSignature({
        publicKeySpki: response.publicKeySpki,
        signature: response.signature,
        transcript: localMediaEngineProofTranscript({
          kind: "pairing",
          challenge: response.challenge,
          instanceNonce: "",
          requestBinding: response.state,
          payload: pairingResponseUnsignedPayload(response)
        })
      })
    ) {
      throw new TypeError("게시할 로컬 엔진 pairing response가 올바르지 않습니다.");
    }
    pendingPairingResponses.set(response.state, Object.freeze({
      response,
      expiresAt: issuedAt + LOCAL_MEDIA_ENGINE_PAIRING_RESPONSE_TTL_MS
    }));
  };

  const createSessionEncryptionOffer = async () => {
    const timestamp = now();
    pruneEncryptedState(timestamp);
    if (
      sessionEncryptionGrants.size
      >= MAX_LOCAL_ENGINE_SESSION_ENCRYPTION_GRANTS
    ) {
      throw new CaptionGatewayError(
        "활성 session encryption grant가 너무 많습니다.",
        { code: "SESSION_ENCRYPTION_LIMIT_REACHED", httpStatus: 429 }
      );
    }
    let grantId = "";
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = randomBytesImpl(32).toString("base64url");
      if (!sessionEncryptionGrants.has(candidate)) {
        grantId = candidate;
        break;
      }
    }
    if (!grantId) {
      throw new CaptionGatewayError(
        "session encryption grant identity를 만들지 못했습니다.",
        { code: "SESSION_ENCRYPTION_FAILED", httpStatus: 500 }
      );
    }
    const keys = await webcrypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"]
    );
    const serverPublicKey = encodeBase64Url(new Uint8Array(
      await webcrypto.subtle.exportKey("raw", keys.publicKey)
    ));
    const expiresAt = timestamp + LOCAL_ENGINE_SESSION_ENCRYPTION_TTL_MS;
    sessionEncryptionGrants.set(grantId, {
      privateKey: keys.privateKey,
      expiresAt
    });
    return Object.freeze({
      schema: LOCAL_MEDIA_ENGINE_SESSION_ENCRYPTION_SCHEMA,
      algorithm: LOCAL_MEDIA_ENGINE_SESSION_ENCRYPTION_ALGORITHM,
      grantId,
      serverPublicKey,
      expiresAt: new Date(expiresAt).toISOString()
    });
  };

  const signedDeviceProof = async ({
    kind,
    challenge,
    payload,
    requestBinding = ""
  }: {
    readonly kind: "health" | "session";
    readonly challenge: string;
    readonly payload: unknown;
    readonly requestBinding?: string;
  }) => {
    const instanceNonce = config.vodRuntime?.instanceNonce;
    if (!deviceProofSigner || !instanceNonce) {
      throw new CaptionGatewayError(
        "설치 identity와 관리형 runtime nonce가 준비되지 않았습니다.",
        {
          code: "DEVICE_PROOF_UNAVAILABLE",
          httpStatus: 503
        }
      );
    }
    const signature = await deviceProofSigner.sign(
      localMediaEngineProofTranscript({
        kind,
        challenge,
        instanceNonce,
        requestBinding,
        payload
      })
    );
    if (exactBase64UrlBytes(signature, 64) === null) {
      throw new CaptionGatewayError(
        "설치 identity가 올바른 device proof를 만들지 못했습니다.",
        {
          code: "DEVICE_PROOF_FAILED",
          httpStatus: 500
        }
      );
    }
    return Object.freeze({
      schema: LOCAL_MEDIA_ENGINE_DEVICE_PROOF_SCHEMA,
      algorithm: LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
      keyId: deviceProofSigner.keyId,
      challenge,
      instanceNonce,
      signature
    });
  };

  const removeCapability = (capability: LocalEngineCapability): void => {
    capabilitiesByToken.delete(capability.token);
    if (tokenByClientNonce.get(capability.clientNonce) === capability.token) {
      tokenByClientNonce.delete(capability.clientNonce);
    }
    if (capability.transportId) {
      const transport = encryptedTransports.get(capability.transportId);
      transport?.key.fill(0);
      encryptedTransports.delete(capability.transportId);
    }
  };
  const pruneCapabilities = (timestamp: number): void => {
    for (const capability of capabilitiesByToken.values()) {
      if (
        timestamp >= capability.expiresAt
        || timestamp - capability.lastUsedAt
          >= LOCAL_ENGINE_CAPABILITY_IDLE_TTL_MS
      ) {
        removeCapability(capability);
      }
    }
  };
  const freshCapabilityToken = (): string => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const token = exactBase64UrlBytes(
        randomBytesImpl(32).toString("base64url"),
        32
      );
      if (token && !capabilitiesByToken.has(token)) {
        return token;
      }
    }
    throw new CaptionGatewayError(
      "로컬 엔진 문서 capability를 안전하게 만들지 못했습니다.",
      {
        code: "CAPABILITY_GENERATION_FAILED",
        httpStatus: 500
      }
    );
  };
  const issueCapability = (
    sessionRequest: LocalEngineSessionRequest,
    timestamp: number,
    transportId?: string
  ): LocalEngineCapability => {
    pruneCapabilities(timestamp);
    if (tokenByClientNonce.has(sessionRequest.clientNonce)) {
      throw new CaptionGatewayError(
        "이미 사용한 로컬 엔진 문서 nonce입니다.",
        {
          code: "CLIENT_NONCE_REPLAYED",
          httpStatus: 409
        }
      );
    }
    if (capabilitiesByToken.size >= MAX_LOCAL_ENGINE_CAPABILITIES) {
      throw new CaptionGatewayError(
        "활성 로컬 엔진 문서가 너무 많습니다.",
        {
          code: "CAPABILITY_LIMIT_REACHED",
          httpStatus: 429
        }
      );
    }
    const token = freshCapabilityToken();
    const capability: LocalEngineCapability = {
      token,
      clientNonce: sessionRequest.clientNonce,
      projectId: sessionRequest.projectId,
      actions: new Set(sessionRequest.actions),
      ...(sessionRequest.sourceUrl === undefined
        ? {}
        : { sourceUrl: sessionRequest.sourceUrl }),
      lastUsedAt: timestamp,
      expiresAt: timestamp + LOCAL_ENGINE_CAPABILITY_ABSOLUTE_TTL_MS,
      ...(transportId === undefined ? {} : { transportId })
    };
    capabilitiesByToken.set(token, capability);
    tokenByClientNonce.set(capability.clientNonce, token);
    return capability;
  };
  const authenticateCapabilityIdentity = (
    request: IncomingMessage,
    response: ServerResponse
  ): LocalEngineCapability | null => {
    const timestamp = now();
    pruneCapabilities(timestamp);
    const decryptedControl = decryptedControlRequests.get(request);
    const token = decryptedControl?.token ?? requestBearerToken(request);
    const clientNonce = requestClientNonce(request);
    const capability = token ? capabilitiesByToken.get(token) : undefined;
    if (
      !capability
      || !clientNonce
      || capability.clientNonce !== clientNonce
      || (
        capability.transportId !== undefined
        && capability.transportId !== decryptedControl?.transportId
      )
      || (
        authenticatedPublicMode
        && capability.transportId === undefined
      )
    ) {
      response.setHeader("www-authenticate", "Bearer");
      rejectJson(request, response, 401, {
        error: {
          code: "UNAUTHORIZED",
          message: "현재 문서의 메모리 capability 인증이 필요합니다."
        }
      });
      return null;
    }
    return capability;
  };
  const authenticateCapability = (
    request: IncomingMessage,
    response: ServerResponse,
    action: LocalEngineCapabilityAction
  ): LocalEngineCapability | null => {
    const capability = authenticateCapabilityIdentity(request, response);
    if (!capability) {
      return null;
    }
    if (!capability.actions.has(action)) {
      rejectJson(request, response, 403, {
        error: {
          code: "CAPABILITY_ACTION_NOT_ALLOWED",
          message: "현재 문서에 이 로컬 엔진 작업 권한이 없습니다."
        }
      });
      return null;
    }
    return capability;
  };
  const touchCapability = (capability: LocalEngineCapability): void => {
    capability.lastUsedAt = now();
  };
  const readControlJsonRequest = async (
    request: IncomingMessage,
    maximumBytes: number,
    options?: Parameters<typeof readJsonRequest>[2]
  ): Promise<unknown> => {
    const decrypted = decryptedControlRequests.get(request);
    return decrypted
      ? decrypted.body
      : readJsonRequest(request, maximumBytes, options);
  };
  const requestMediaAccess = (request: IncomingMessage): string | null => (
    decryptedControlRequests.get(request)?.mediaAccess
      ?? exactBase64UrlBytes(
        request.headers["x-kirinuki-media-access"],
        32
      )
  );
  const authorizeCapabilityProject = (
    request: IncomingMessage,
    response: ServerResponse,
    capability: LocalEngineCapability,
    projectId: unknown,
    sourceUrl?: unknown,
    enforceSource: boolean = false
  ): boolean => {
    let normalizedProjectId: string;
    try {
      normalizedProjectId = normalizeCapabilityProjectId(projectId);
    } catch {
      rejectJson(request, response, 403, {
        error: {
          code: "CAPABILITY_SCOPE_MISMATCH",
          message: "현재 문서와 요청 프로젝트가 일치하지 않습니다."
        }
      });
      return false;
    }
    if (
      capability.projectId !== normalizedProjectId
      || (
        enforceSource
        && (
          capability.sourceUrl === undefined
          || capability.sourceUrl !== sourceUrl
        )
      )
    ) {
      rejectJson(request, response, 403, {
        error: {
          code: "CAPABILITY_SCOPE_MISMATCH",
          message: "현재 문서의 프로젝트 또는 원본 범위를 벗어난 요청입니다."
        }
      });
      return false;
    }
    const timestamp = now();
    if (
      timestamp >= capability.expiresAt
      || timestamp - capability.lastUsedAt
        >= LOCAL_ENGINE_CAPABILITY_IDLE_TTL_MS
    ) {
      removeCapability(capability);
      response.setHeader("www-authenticate", "Bearer");
      rejectJson(request, response, 401, {
        error: {
          code: "CAPABILITY_EXPIRED",
          message: "현재 문서의 로컬 엔진 연결이 만료되었습니다."
        }
      });
      return false;
    }
    capability.lastUsedAt = timestamp;
    return true;
  };
  const rememberMaterializationOwner = (
    jobId: string,
    capability: LocalEngineCapability
  ): void => {
    if (!capability.sourceUrl) {
      throw new CaptionGatewayError(
        "VOD 작업의 원본 소유권을 확인하지 못했습니다.",
        {
          code: "CAPABILITY_SCOPE_MISMATCH",
          httpStatus: 403
        }
      );
    }
    const current = materializationJobOwners.get(jobId);
    if (
      current
      && (
        current.projectId !== capability.projectId
        || current.sourceUrl !== capability.sourceUrl
      )
    ) {
      throw new CaptionGatewayError(
        "VOD 작업의 문서 또는 원본 소유권이 일치하지 않습니다.",
        {
          code: "CAPABILITY_SCOPE_MISMATCH",
          httpStatus: 403
        }
      );
    }
    if (!current) {
      materializationJobOwners.set(jobId, {
        projectId: capability.projectId,
        sourceUrl: capability.sourceUrl
      });
    }
    while (materializationJobOwners.size > 256) {
      const oldestJobId = materializationJobOwners.keys().next().value;
      if (typeof oldestJobId !== "string") {
        break;
      }
      materializationJobOwners.delete(oldestJobId);
    }
  };
  const materializationOwnerScope = (
    jobId: string
  ): Readonly<MaterializationJobOwner> | null => {
    const remembered = materializationJobOwners.get(jobId);
    if (remembered) {
      return remembered;
    }
    const job = chzzkVodJobs.get(jobId);
    return job
      ? Object.freeze({
        projectId: job.request.consumerId,
        sourceUrl: job.request.sourceUrl
      })
      : null;
  };
  const decryptControlRequest = async ({
    request,
    response,
    requestUrl,
    protocol,
    maximumPlaintextBytes
  }: {
    readonly request: IncomingMessage;
    readonly response: ServerResponse;
    readonly requestUrl: URL;
    readonly protocol: string;
    readonly maximumPlaintextBytes: number;
  }): Promise<boolean> => {
    const clientNonce = requestClientNonce(request);
    const transportId = singleRawHeaderValue(
      request,
      LOCAL_MEDIA_ENGINE_TRANSPORT_ID_HEADER.toLowerCase()
    );
    const counterText = singleRawHeaderValue(
      request,
      LOCAL_MEDIA_ENGINE_TRANSPORT_COUNTER_HEADER.toLowerCase()
    );
    const counter = counterText && /^[1-9][0-9]{0,15}$/u.test(counterText)
      ? Number(counterText)
      : Number.NaN;
    if (
      !clientNonce
      || exactBase64UrlBytes(transportId, 32) === null
      || !Number.isSafeInteger(counter)
    ) {
      rejectJson(request, response, 401, {
        error: {
          code: "ENCRYPTED_TRANSPORT_REQUIRED",
          message: "현재 문서의 encrypted transport가 필요합니다."
        }
      });
      return false;
    }
    const timestamp = now();
    pruneEncryptedState(timestamp);
    const transport = encryptedTransports.get(transportId!);
    if (
      !transport
      || transport.clientNonce !== clientNonce
      || counter > transport.maximumCounter + 1_024
      || counter <= transport.maximumCounter - 2_048
      || transport.seenCounters.has(counter)
    ) {
      rejectJson(request, response, 401, {
        error: {
          code: "ENCRYPTED_TRANSPORT_REPLAYED",
          message: "encrypted transport identity 또는 counter가 올바르지 않습니다."
        }
      });
      return false;
    }
    // Reserve before the first body-read await. Concurrent copies of one
    // authenticated envelope must never both pass the replay boundary.
    // A malformed request may consume its counter, but cannot be accepted.
    transport.seenCounters.add(counter);
    transport.maximumCounter = Math.max(transport.maximumCounter, counter);
    for (const seen of transport.seenCounters) {
      if (seen < transport.maximumCounter - 2_048) {
        transport.seenCounters.delete(seen);
      }
    }
    const outerLimit = Math.ceil(maximumPlaintextBytes * 4 / 3) + 8 * 1024;
    let encryptedValue: unknown;
    try {
      encryptedValue = await readJsonRequest(request, outerLimit);
    } catch (error) {
      const safe = error instanceof TypeError
        ? { status: 400, code: "INVALID_ENCRYPTED_REQUEST", message: error.message }
        : safeError(error);
      rejectJson(request, response, safe.status, {
        error: { code: safe.code, message: safe.message }
      });
      return false;
    }
    const encrypted = parseLocalMediaEngineTransportRequest(
      encryptedValue,
      outerLimit
    );
    if (
      !encrypted
      || encrypted.transportId !== transportId
      || encrypted.counter !== counter
    ) {
      rejectJson(request, response, 400, {
        error: {
          code: "INVALID_ENCRYPTED_REQUEST",
          message: "encrypted transport envelope가 header와 다릅니다."
        }
      });
      return false;
    }
    try {
      const ivBytes = Buffer.from(encrypted.iv, "base64url");
      const ciphertextWithTag = Buffer.from(encrypted.ciphertext, "base64url");
      if (
        ivBytes.toString("base64url") !== encrypted.iv
        || ciphertextWithTag.toString("base64url") !== encrypted.ciphertext
        || ciphertextWithTag.byteLength < 17
      ) {
        throw new Error("non-canonical-encryption");
      }
      const authenticationTag = ciphertextWithTag.subarray(-16);
      const ciphertext = ciphertextWithTag.subarray(0, -16);
      const pathWithQuery = `${requestUrl.pathname}${requestUrl.search}`;
      const aad = localMediaEngineTransportAad({
        direction: "request",
        transportId,
        counter,
        method: request.method || "",
        path: pathWithQuery,
        protocol,
        clientNonce,
        iv: encrypted.iv
      });
      const decipher = createDecipheriv(
        "aes-256-gcm",
        Buffer.from(transport.key),
        ivBytes,
        { authTagLength: 16 }
      );
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(authenticationTag);
      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final()
      ]).toString("utf8");
      if (Buffer.byteLength(plaintext, "utf8") > maximumPlaintextBytes) {
        throw new Error("plaintext-too-large");
      }
      const container = JSON.parse(plaintext) as unknown;
      if (!container || typeof container !== "object" || Array.isArray(container)) {
        throw new Error("invalid-container");
      }
      const record = container as Record<string, unknown>;
      const token = exactBase64UrlBytes(record.token, 32);
      const mediaAccess = record.mediaAccess;
      const bodyText = record.bodyText;
      if (
        Object.keys(record).sort().join(",") !== "bodyText,mediaAccess,token"
        || !token
        || (
          mediaAccess !== null
          && exactBase64UrlBytes(mediaAccess, 32) === null
        )
        || (bodyText !== null && typeof bodyText !== "string")
      ) {
        throw new Error("invalid-container-fields");
      }
      const body = bodyText === null ? null : JSON.parse(bodyText);
      decryptedControlRequests.set(request, {
        token,
        mediaAccess: mediaAccess as string | null,
        body,
        transportId
      });
      (
        response as ServerResponse & {
          [TRANSPORT_RESPONSE_CONTEXT]?: Readonly<TransportResponseContext>;
        }
      )[TRANSPORT_RESPONSE_CONTEXT] = Object.freeze({
        key: transport.key,
        transportId,
        counter,
        method: request.method || "",
        path: pathWithQuery,
        protocol,
        clientNonce
      });
      return true;
    } catch {
      rejectJson(request, response, 400, {
        error: {
          code: "ENCRYPTED_TRANSPORT_AUTH_FAILED",
          message: "encrypted transport request 인증에 실패했습니다."
        }
      });
      return false;
    }
  };
  let closing = false;
  const handleRequest = async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> => {
    const origin = singleRawHeaderValue(request, "origin") || "";
    const protocol = singleRawHeaderValue(
      request,
      "x-kirinuki-protocol"
    ) || "";
    if (origin !== config.allowedOrigin) {
      rejectJson(request, response, 403, {
        error: {
          code: "ORIGIN_NOT_ALLOWED",
          message: "허용되지 않은 Origin입니다."
        }
      });
      return;
    }
    if (request.method !== "OPTIONS") {
      setCorsHeaders(request, response, origin, config.allowedOrigin);
    }

    const requestUrl = new URL(
      request.url || "/",
      "http://127.0.0.1"
    );
    const isHealthRequest = requestUrl.pathname === "/v1/health";
    const isPairingPollRequest = requestUrl.pathname === "/v1/pairing";
    const isPairingRequest = requestUrl.pathname === "/v1/session";
    const isSessionStatusRequest =
      requestUrl.pathname === "/v1/session/status";
    const isCaptionRequest = requestUrl.pathname === "/v1/captions";
    const isEditorHandoffRequest =
      requestUrl.pathname === "/v1/editor-handoff";
    const isPlaybackCollection = requestUrl.pathname === "/v1/playback";
    const playbackSessionMatch =
      /^\/v1\/playback\/([A-Za-z0-9_-]{43})$/u.exec(requestUrl.pathname);
    const playbackManifestMatch =
      /^\/v1\/playback\/([A-Za-z0-9_-]{43})\/part\/(\d{1,3})\/index\.m3u8$/u
        .exec(requestUrl.pathname);
    const playbackResourceMatch =
      /^\/v1\/playback\/([A-Za-z0-9_-]{43})\/resource\/([0-9a-z]{1,8})$/u
        .exec(requestUrl.pathname);
    const materializationCollectionMatch =
      /^\/v1\/(chzzk-vod|vod)\/materializations$/u
        .exec(requestUrl.pathname);
    const isMaterializationCollection = Boolean(
      materializationCollectionMatch
    );
    const materializationJobMatch =
      /^\/v1\/(chzzk-vod|vod)\/materializations\/([a-zA-Z0-9_-]{16,128})$/u
        .exec(requestUrl.pathname);
    const materializationPurgeMatch =
      /^\/v1\/(chzzk-vod|vod)\/materializations\/([a-zA-Z0-9_-]{16,128})\/cache$/u
        .exec(requestUrl.pathname);
    const materializationSessionPurgeMatch =
      /^\/v1\/(chzzk-vod|vod)\/materializations\/([a-zA-Z0-9_-]{16,128})\/session-cache$/u
        .exec(requestUrl.pathname);
    const materializationMediaMatch =
      /^\/v1\/(chzzk-vod|vod)\/media\/([a-zA-Z0-9_-]{16,128})$/u
        .exec(requestUrl.pathname);
    const materializationNamespace = String(
      materializationCollectionMatch?.[1]
      || materializationJobMatch?.[1]
      || materializationPurgeMatch?.[1]
      || materializationSessionPurgeMatch?.[1]
      || materializationMediaMatch?.[1]
      || "chzzk-vod"
    ) as MaterializationRouteNamespace;
    if (
      !isHealthRequest
      && !isPairingPollRequest
      && !isPairingRequest
      && !isSessionStatusRequest
      && !isCaptionRequest
      && !isEditorHandoffRequest
      && !isPlaybackCollection
      && !playbackSessionMatch
      && !playbackManifestMatch
      && !playbackResourceMatch
      && !isMaterializationCollection
      && !materializationJobMatch
      && !materializationPurgeMatch
      && !materializationSessionPurgeMatch
      && !materializationMediaMatch
    ) {
      rejectJson(request, response, 404, {
        error: {
          code: "NOT_FOUND",
          message: "요청 경로를 찾지 못했습니다."
        }
      });
      return;
    }
    if (request.method === "OPTIONS") {
      const preflightMethods = isHealthRequest
        ? ["GET"]
        : isPlaybackCollection
          ? ["POST"]
          : playbackSessionMatch
            ? ["DELETE"]
          : playbackManifestMatch || playbackResourceMatch
            ? ["GET"]
        : isPairingPollRequest
          ? ["GET"]
        : isPairingRequest
            ? ["POST"]
          : isSessionStatusRequest
            ? ["POST"]
            : isCaptionRequest
              ? authenticatedPublicMode
                ? ["POST"]
                : ["GET", "POST"]
              : isEditorHandoffRequest
                ? ["POST"]
              : materializationMediaMatch
                ? ["GET", "HEAD"]
                : materializationPurgeMatch
                  || materializationSessionPurgeMatch
                  ? ["DELETE"]
                  : isMaterializationCollection
                    ? ["POST"]
                    : authenticatedPublicMode
                      ? ["POST", "DELETE"]
                      : ["GET", "POST", "DELETE"];
      if (!validCorsPreflight(request, preflightMethods)) {
        rejectJson(request, response, 400, {
          error: {
            code: "INVALID_CORS_PREFLIGHT",
            message: "지원하지 않는 CORS 사전 요청입니다."
          }
        });
        return;
      }
      setCorsHeaders(request, response, origin, config.allowedOrigin);
      discardUnreadRequestBody(request, response);
      response.statusCode = 204;
      response.setHeader("cache-control", "no-store");
      response.end();
      return;
    }
    if (
      isMaterializationCollection
      || materializationJobMatch
      || materializationPurgeMatch
      || materializationSessionPurgeMatch
      || materializationMediaMatch
    ) {
      try {
        await vodCacheRecovery;
      } catch {
        rejectJson(request, response, 503, {
          error: {
            code: "VOD_CACHE_RECOVERY_FAILED",
            message: "이전 실행의 VOD 캐시 격리본을 안전하게 확인하지 못해 VOD 기능을 시작하지 않았습니다."
          }
        });
        return;
      }
    }
    if (
      authenticatedPublicMode
      && !isHealthRequest
      && !isPairingPollRequest
      && !(isPairingRequest && request.method === "POST")
      && !materializationMediaMatch
      && !isPlaybackCollection
      && !playbackSessionMatch
      && !playbackManifestMatch
      && !playbackResourceMatch
    ) {
      const maximumPlaintextBytes = isCaptionRequest
        ? config.maxBodyBytes
        : isMaterializationCollection
          ? MAX_CHZZK_VOD_REQUEST_BYTES
          : materializationPurgeMatch || materializationSessionPurgeMatch
            ? MAX_CHZZK_VOD_CACHE_PURGE_REQUEST_BYTES
            : 64 * 1024;
      if (!await decryptControlRequest({
        request,
        response,
        requestUrl,
        protocol,
        maximumPlaintextBytes
      })) {
        return;
      }
    }
    if (playbackSessionMatch) {
      if (
        request.method !== "DELETE"
        || requestUrl.search !== ""
        || protocol !== ""
      ) {
        rejectJson(request, response, 404, {
          error: { code: "PLAYBACK_NOT_FOUND", message: "원본 재생 경로를 찾지 못했습니다." }
        });
        return;
      }
      discardUnreadRequestBody(request, response);
      if (!localVodPlayback.removeSession(playbackSessionMatch[1]!)) {
        rejectJson(request, response, 404, {
          error: { code: "PLAYBACK_NOT_FOUND", message: "원본 재생 경로를 찾지 못했습니다." }
        });
        return;
      }
      response.statusCode = 204;
      response.setHeader("cache-control", "no-store");
      response.end();
      return;
    }
    if (playbackManifestMatch || playbackResourceMatch) {
      if (requestUrl.search !== "" || protocol !== "") {
        rejectJson(request, response, 404, {
          error: { code: "PLAYBACK_NOT_FOUND", message: "원본 재생 경로를 찾지 못했습니다." }
        });
        return;
      }
      const served = playbackManifestMatch
        ? await localVodPlayback.serveManifest({
          accessToken: playbackManifestMatch[1]!,
          partIndex: Number(playbackManifestMatch[2]),
          request,
          response
        })
        : await localVodPlayback.serveResource({
          accessToken: playbackResourceMatch![1]!,
          resourceKey: playbackResourceMatch![2]!,
          request,
          response
        });
      if (!served) {
        rejectJson(request, response, 404, {
          error: { code: "PLAYBACK_NOT_FOUND", message: "원본 재생 경로를 찾지 못했습니다." }
        });
      }
      return;
    }
    if (isPlaybackCollection) {
      if (
        request.method !== "POST"
        || requestUrl.search !== ""
        || protocol !== LOCAL_VOD_PLAYBACK_CREATE_PROTOCOL
      ) {
        rejectJson(request, response, 404, {
          error: { code: "PLAYBACK_NOT_FOUND", message: "원본 재생 경로를 찾지 못했습니다." }
        });
        return;
      }
      const body = parseLocalVodPlaybackCreateRequest(
        await readJsonRequest(request, 4 * 1024)
      );
      if (!body) {
        rejectJson(request, response, 400, {
          error: { code: "INVALID_PLAYBACK_REQUEST", message: "원본 재생 요청이 올바르지 않습니다." }
        });
        return;
      }
      const controller = new AbortController();
      const abort = () => controller.abort();
      request.once("aborted", abort);
      try {
        const session = await localVodPlayback.createSession(
          body.sourceUrl,
          controller.signal
        );
        sendJson(response, 200, session);
      } catch {
        if (!response.headersSent && !response.writableEnded) {
          rejectJson(request, response, 502, {
            error: {
              code: "PLAYBACK_UNAVAILABLE",
              message: "공개 VOD 재생 정보를 준비하지 못했습니다."
            }
          });
        }
      } finally {
        request.removeListener("aborted", abort);
      }
      return;
    }
    if (isEditorHandoffRequest) {
      if (
        request.method !== "POST"
        || requestUrl.search !== ""
        || protocol !== EDITOR_HANDOFF_CONSUME_PROTOCOL
      ) {
        rejectJson(request, response, 404, {
          error: {
            code: "EDITOR_HANDOFF_NOT_AVAILABLE",
            message: "이 편집기 인계를 사용할 수 없습니다."
          }
        });
        return;
      }
      const capability = authenticateCapability(
        request,
        response,
        EDITOR_HANDOFF_CAPABILITY_ACTION
      );
      if (!capability) {
        return;
      }
      const body = decryptedControlRequests.get(request)?.body;
      const schema = body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).schema
        : null;
      try {
        if (schema === EDITOR_HANDOFF_CONSUME_REQUEST_SCHEMA) {
          const envelope = editorHandoffBroker?.claim(
            body,
            capability.projectId
          ) ?? null;
          if (envelope) {
            touchCapability(capability);
            sendJson(response, 200, envelope);
            return;
          }
        } else if (schema === EDITOR_HANDOFF_ACKNOWLEDGEMENT_SCHEMA) {
          const acknowledged = editorHandoffBroker?.acknowledge(
            body,
            capability.projectId
          ) ?? false;
          if (acknowledged) {
            touchCapability(capability);
            sendJson(response, 200, {
              schema: EDITOR_HANDOFF_ACKNOWLEDGEMENT_SCHEMA,
              status: "acknowledged"
            });
            return;
          }
        }
      } catch {
        // Malformed, expired, wrong-scope and wrong-claim requests deliberately
        // share one response so this endpoint cannot become a handoff oracle.
      }
      rejectJson(request, response, 404, {
        error: {
          code: "EDITOR_HANDOFF_NOT_AVAILABLE",
          message: "이 편집기 인계를 사용할 수 없습니다."
        }
      });
      return;
    }
    if (isPairingPollRequest) {
      const state = exactBase64UrlBytes(
        singleRawHeaderValue(
          request,
          LOCAL_MEDIA_ENGINE_PAIRING_STATE_HEADER.toLowerCase()
        ),
        32
      );
      const challenge = requestServerChallenge(request);
      if (
        request.method !== "GET"
        || requestUrl.search !== ""
        || protocol !== LOCAL_MEDIA_ENGINE_PAIRING_POLL_PROTOCOL
        || !state
        || !challenge
      ) {
        rejectJson(request, response, 400, {
          error: {
            code: "INVALID_PAIRING_POLL",
            message: "state/challenge에 묶인 로컬 엔진 pairing poll이 필요합니다."
          }
        });
        return;
      }
      discardUnreadRequestBody(request, response);
      pruneEncryptedState(now());
      const pending = pendingPairingResponses.get(state);
      if (!pending || pending.response.challenge !== challenge) {
        sendJson(response, 202, {
          schema: LOCAL_MEDIA_ENGINE_PAIRING_POLL_STATUS_SCHEMA,
          status: "pending"
        });
        return;
      }
      // Claim before writing so two racing polls cannot both enroll from one
      // custom-scheme activation.
      pendingPairingResponses.delete(state);
      sendJson(response, 200, pending.response);
      return;
    }
    if (isHealthRequest) {
      const authenticatedHealth =
        protocol === LOCAL_MEDIA_ENGINE_AUTHENTICATED_HEALTH_PROTOCOL;
      if (
        origin !== config.allowedOrigin
        || (
          protocol !== LOCAL_MEDIA_ENGINE_HEALTH_PROTOCOL
          && !authenticatedHealth
        )
        || (
          authenticatedPublicMode
          && !authenticatedHealth
        )
      ) {
        rejectJson(request, response, 403, {
          error: {
            code: "HEALTH_PROBE_NOT_ALLOWED",
            message: "정확한 Origin과 인증된 영상 준비 도구 확인 프로토콜이 필요합니다."
          }
        });
        return;
      }
      if (request.method !== "GET") {
        response.setHeader("allow", "GET, OPTIONS");
        rejectJson(request, response, 405, {
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: "GET 요청만 지원합니다."
          }
        });
        return;
      }
      const challenge = authenticatedHealth
        ? requestServerChallenge(request)
        : null;
      if (authenticatedHealth && challenge === null) {
        rejectJson(request, response, 400, {
          error: {
            code: "SERVER_CHALLENGE_REQUIRED",
            message: "인증된 health 요청에는 새 server challenge가 필요합니다."
          }
        });
        return;
      }
      discardUnreadRequestBody(request, response);
      const baseHealthPayload = {
        schema: CAPTION_AGENT_HEALTH_SCHEMA_ID,
        status: "ok",
        managed: true,
        engine: {
          backgroundStart: config.backgroundStart,
          product: LOCAL_MEDIA_ENGINE_PRODUCT,
          protocol: LOCAL_MEDIA_ENGINE_API_PROTOCOL,
          version: config.engineVersion
        },
        originBinding: config.allowedOrigin === KIRINUKI_LOCAL_STUDIO_ORIGIN
          ? KIRINUKI_GATEWAY_ORIGIN_BINDING
          : "exact-public-studio",
        authentication: "bearer-memory-capability",
        transcriptionMode: LOCAL_WHISPERCPP_TRANSCRIPTION_MODE,
        vodRuntime: config.vodRuntime
      };
      if (!authenticatedHealth) {
        sendJson(response, 200, baseHealthPayload);
        return;
      }
      let sessionEncryption: Awaited<
        ReturnType<typeof createSessionEncryptionOffer>
      > | null = null;
      try {
        sessionEncryption = await createSessionEncryptionOffer();
        const healthPayload = {
          ...baseHealthPayload,
          sessionEncryption
        };
        const deviceProof = await signedDeviceProof({
          kind: "health",
          challenge: challenge!,
          payload: healthPayload
        });
        sendJson(response, 200, {
          ...healthPayload,
          deviceProof
        });
      } catch (error) {
        if (sessionEncryption) {
          sessionEncryptionGrants.delete(sessionEncryption.grantId);
        }
        const safe = safeError(error);
        rejectJson(request, response, safe.status, {
          error: {
            code: safe.code,
            message: safe.message
          }
        });
      }
      return;
    }
    if (isSessionStatusRequest) {
      if (
        request.method !== "POST"
        || protocol !== LOCAL_MEDIA_ENGINE_SESSION_STATUS_PROTOCOL
        || decryptedControlRequests.get(request)?.body !== null
      ) {
        rejectJson(request, response, 400, {
          error: {
            code: "INVALID_SESSION_STATUS_REQUEST",
            message: "암호화된 memory session status 요청이 올바르지 않습니다."
          }
        });
        return;
      }
      const capability = authenticateCapabilityIdentity(request, response);
      if (!capability) {
        return;
      }
      touchCapability(capability);
      sendJson(response, 200, {
        schema: LOCAL_MEDIA_ENGINE_SESSION_STATUS_SCHEMA,
        status: "active",
        actions: [...capability.actions],
        sourceBound: capability.sourceUrl !== undefined,
        expiresAt: new Date(capability.expiresAt).toISOString()
      });
      return;
    }
    if (isPairingRequest) {
      if (request.method !== "POST") {
        response.setHeader("allow", "POST, OPTIONS");
        rejectJson(request, response, 405, {
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: "POST 요청만 지원합니다."
          }
        });
        return;
      }
      const authenticatedSession =
        protocol === LOCAL_MEDIA_ENGINE_AUTHENTICATED_SESSION_PROTOCOL;
      if (
        (
          protocol !== LOCAL_ENGINE_SESSION_REQUEST_SCHEMA_ID
          && !authenticatedSession
        )
        || (
          authenticatedPublicMode
          && !authenticatedSession
        )
      ) {
        rejectJson(request, response, 400, {
          error: {
            code: "PROTOCOL_REQUIRED",
            message: "지원하는 인증된 로컬 엔진 세션 프로토콜 헤더가 필요합니다."
          }
        });
        return;
      }
      const challenge = authenticatedSession
        ? requestServerChallenge(request)
        : null;
      if (authenticatedSession && challenge === null) {
        rejectJson(request, response, 400, {
          error: {
            code: "SERVER_CHALLENGE_REQUIRED",
            message: "인증된 세션 요청에는 새 server challenge가 필요합니다."
          }
        });
        return;
      }
      if (!pairingAllowed(pairingState, now())) {
        response.setHeader("retry-after", "60");
        rejectJson(request, response, 429, {
          error: {
            code: "PAIRING_RATE_LIMITED",
            message: "자동 연결 요청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요."
          }
        });
        return;
      }
      let pendingTransportKey: Uint8Array | undefined;
      let pendingTransportOwned = false;
      let authenticatedSessionInputAccepted = false;
      try {
        let sessionRequestValue: unknown;
        let transportId: string | undefined;
        let transportKey: Uint8Array | undefined;
        let encryptedSessionRequest: ReturnType<
          typeof parseLocalMediaEngineEncryptedSessionRequest
        > = null;
        if (authenticatedSession) {
          const encrypted = parseLocalMediaEngineEncryptedSessionRequest(
            await readJsonRequest(
              request,
              MAX_LOCAL_ENGINE_SESSION_REQUEST_BYTES * 2
            )
          );
          if (!encrypted) {
            throw new TypeError("암호화된 로컬 엔진 세션 요청이 올바르지 않습니다.");
          }
          encryptedSessionRequest = encrypted;
          const grant = sessionEncryptionGrants.get(encrypted.grantId);
          // One shot even when ECDH import, GCM authentication, or JSON parsing
          // fails. An attacker cannot use this endpoint as a grant oracle.
          sessionEncryptionGrants.delete(encrypted.grantId);
          if (!grant || now() >= grant.expiresAt) {
            throw new TypeError("로컬 엔진 session encryption grant가 만료됐습니다.");
          }
          const [plaintext, sharedKey] = await Promise.all([
            decryptLocalMediaEngineSessionRequest({
              privateKey: grant.privateKey,
              request: encrypted,
              responseChallenge: challenge!
            }),
            deriveLocalMediaEngineSharedKey({
              privateKey: grant.privateKey,
              peerPublicKey: encrypted.clientPublicKey
            })
          ]);
          try {
            sessionRequestValue = JSON.parse(plaintext);
          } catch {
            throw new TypeError("복호화한 로컬 엔진 세션 요청 JSON이 올바르지 않습니다.");
          }
          transportId = encrypted.grantId;
          transportKey = sharedKey;
          pendingTransportKey = sharedKey;
        } else {
          sessionRequestValue = await readJsonRequest(
            request,
            MAX_LOCAL_ENGINE_SESSION_REQUEST_BYTES
          );
        }
        const body = normalizeLocalEngineSessionRequest(
          sessionRequestValue,
          authenticatedSession
            ? LOCAL_MEDIA_ENGINE_AUTHENTICATED_SESSION_PROTOCOL
            : LOCAL_ENGINE_SESSION_REQUEST_SCHEMA_ID
        );
        if (requestClientNonce(request) !== body.clientNonce) {
          rejectJson(request, response, 400, {
            error: {
              code: "CLIENT_NONCE_REQUIRED",
              message: "요청 본문과 일치하는 문서 nonce 헤더가 필요합니다."
            }
          });
          return;
        }
        authenticatedSessionInputAccepted = true;
        const capability = issueCapability(body, now(), transportId);
        if (transportId && transportKey) {
          encryptedTransports.set(transportId, {
            key: transportKey,
            clientNonce: body.clientNonce,
            expiresAt: capability.expiresAt,
            seenCounters: new Set(),
            maximumCounter: 0
          });
          pendingTransportOwned = true;
        }
        const sessionPayload = {
          schema: CAPTION_AGENT_SESSION_SCHEMA_ID,
          authentication: "bearer-memory-capability",
          expiresAt: new Date(capability.expiresAt).toISOString(),
          token: capability.token
        };
        if (!authenticatedSession) {
          sendJson(response, 200, sessionPayload);
          return;
        }
        try {
          const deviceProof = await signedDeviceProof({
            kind: "session",
            challenge: challenge!,
            requestBinding: JSON.stringify(body),
            payload: sessionPayload
          });
          if (!transportKey || !encryptedSessionRequest) {
            throw new Error("인증된 session response encryption context가 없습니다.");
          }
          const encryptedSessionResponse = await encryptLocalMediaEngineSessionResponse({
            sharedKey: transportKey,
            request: encryptedSessionRequest,
            responseChallenge: challenge!,
            plaintext: JSON.stringify({
              ...sessionPayload,
              deviceProof
            })
          });
          sendJson(response, 200, encryptedSessionResponse);
        } catch (error) {
          removeCapability(capability);
          if (transportId) {
            const transport = encryptedTransports.get(transportId);
            transport?.key.fill(0);
            encryptedTransports.delete(transportId);
          }
          throw error;
        }
      } catch (error) {
        const safe = error instanceof TypeError
          || (authenticatedSession && !authenticatedSessionInputAccepted)
          ? {
            status: 400,
            code: "INVALID_SESSION_REQUEST",
            message: error instanceof Error
              ? error.message
              : "암호화된 로컬 엔진 session 요청이 올바르지 않습니다."
          }
          : safeError(error);
        rejectJson(request, response, safe.status, {
          error: {
            code: safe.code,
            message: safe.message
          }
        });
      } finally {
        if (!pendingTransportOwned) {
          pendingTransportKey?.fill(0);
        }
      }
      return;
    }
    if (materializationMediaMatch) {
      // The localhost studio uses CORS-enabled media elements, so every media
      // request must retain the same exact browser origin as the API calls.
      // The unguessable per-job access token remains mandatory below as a
      // second, independent boundary.
      if (origin !== config.allowedOrigin) {
        rejectJson(request, response, 403, {
          error: {
            code: "MEDIA_ORIGIN_REQUIRED",
            message: "정확한 Kirinuki 로컬 Studio Origin에서만 로컬 미디어를 읽을 수 있습니다."
          }
        });
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("allow", "GET, HEAD, OPTIONS");
        rejectJson(request, response, 405, {
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: "GET 또는 HEAD 요청만 지원합니다."
          }
        });
        return;
      }
      if (!config.vodRuntime) {
        rejectJson(request, response, 503, {
          error: {
            code: "VOD_RUNTIME_NOT_READY",
            message: "검증된 로컬 VOD runtime identity가 없어 VOD 기능을 사용할 수 없습니다."
          }
        });
        return;
      }
      discardUnreadRequestBody(request, response);
      const media = await chzzkVodJobs.acquireMedia(
        materializationMediaMatch[2] || "",
        requestUrl.searchParams.get("access")
      );
      if (closing) {
        media?.release();
        sendGatewayClosing(request, response, config.allowedOrigin);
        return;
      }
      if (!media) {
        rejectJson(request, response, 404, {
          error: {
            code: "MEDIA_NOT_FOUND",
            message: "로컬 편집 미디어를 찾지 못했거나 접근 세션이 만료되었습니다."
          }
        });
        return;
      }
      const mediaController = new AbortController();
      const abortMedia = () => {
        if (!mediaController.signal.aborted) {
          mediaController.abort(mediaTransferAborted());
        }
      };
      if (gatewayShutdownController.signal.aborted) {
        abortMedia();
      } else {
        gatewayShutdownController.signal.addEventListener(
          "abort",
          abortMedia,
          { once: true }
        );
      }
      request.once("aborted", abortMedia);
      const abortClosedResponse = () => {
        if (!response.writableEnded) {
          abortMedia();
        }
      };
      response.once("close", abortClosedResponse);
      activeMediaControllers.add(mediaController);
      try {
        await sendLocalMedia(
          request,
          response,
          media.artifactPath,
          media.artifactIdentity,
          media.artifactIntegrity,
          media.artifactVerification,
          mediaController.signal
        );
      } catch (error) {
        if (!response.headersSent) {
          if (closing) {
            sendGatewayClosing(request, response, config.allowedOrigin);
          } else {
            sendJson(response, 500, {
              error: {
                code: "MEDIA_READ_FAILED",
                message: "준비된 로컬 편집 미디어를 읽지 못했습니다."
              }
            });
          }
        } else if (!response.destroyed) {
          response.destroy(error instanceof Error ? error : undefined);
        }
      } finally {
        gatewayShutdownController.signal.removeEventListener(
          "abort",
          abortMedia
        );
        request.removeListener("aborted", abortMedia);
        response.removeListener("close", abortClosedResponse);
        activeMediaControllers.delete(mediaController);
        media.release();
      }
      return;
    }
    if (materializationSessionPurgeMatch) {
      if (request.method !== "DELETE") {
        response.setHeader("allow", "DELETE, OPTIONS");
        rejectJson(request, response, 405, {
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: "편집 세션 VOD 캐시는 DELETE 요청으로만 지울 수 있습니다."
          }
        });
        return;
      }
      if (
        protocol !== CHZZK_VOD_CONSUMER_CACHE_PURGE_REQUEST_SCHEMA
      ) {
        rejectJson(request, response, 400, {
          error: {
            code: "PROTOCOL_REQUIRED",
            message: "지원하는 VOD 세션 캐시 삭제 프로토콜 헤더가 필요합니다."
          }
        });
        return;
      }
      const capability = authenticateCapability(
        request,
        response,
        "cache-delete"
      );
      if (!capability) {
        return;
      }
      if (!config.vodRuntime || !config.vodStateDir) {
        rejectJson(request, response, 503, {
          error: {
            code: "VOD_RUNTIME_NOT_READY",
            message: "검증된 관리형 VOD cache root가 없어 세션 캐시를 삭제할 수 없습니다."
          }
        });
        return;
      }
      try {
        const body = await readControlJsonRequest(
          request,
          MAX_CHZZK_VOD_CACHE_PURGE_REQUEST_BYTES
        );
        const bodyRecord = typeof body === "object"
          && body !== null
          && !Array.isArray(body)
          ? body as Record<string, unknown>
          : null;
        const owner = materializationOwnerScope(
          materializationSessionPurgeMatch[2] || ""
        );
        if (!owner) {
          rejectJson(request, response, 404, {
            error: {
              code: "SESSION_CACHE_NOT_FOUND",
              message: "정확히 일치하는 완료 VOD 편집 세션을 찾지 못했습니다."
            }
          });
          return;
        }
        if (
          !authorizeCapabilityProject(
            request,
            response,
            capability,
            owner.projectId,
            owner.sourceUrl,
            true
          )
          || !authorizeCapabilityProject(
            request,
            response,
            capability,
            bodyRecord?.consumerId
          )
        ) {
          return;
        }
        if (closing) {
          sendGatewayClosing(request, response, config.allowedOrigin);
          return;
        }
        const result = await chzzkVodJobs.purgeConsumerCache(
          materializationSessionPurgeMatch[2] || "",
          requestMediaAccess(request),
          body
        );
        if (closing) {
          sendGatewayClosing(request, response, config.allowedOrigin);
          return;
        }
        if (!result) {
          sendJson(response, 404, {
            error: {
              code: "SESSION_CACHE_NOT_FOUND",
              message: "정확히 일치하는 완료 VOD 편집 세션을 찾지 못했습니다."
            }
          });
          return;
        }
        sendJson(response, 200, result);
      } catch (error) {
        const invalidRequest = error instanceof TypeError;
        const safe = invalidRequest
          ? {
            status: 400,
            code: "INVALID_SESSION_CACHE_PURGE_REQUEST",
            message: error.message
          }
          : safeError(error);
        rejectJson(request, response, safe.status, {
          error: {
            code: safe.status >= 500
              ? "SESSION_CACHE_PURGE_FAILED"
              : safe.code,
            message: safe.status >= 500
              ? "현재 편집 세션의 VOD 캐시를 안전하게 삭제하지 못했습니다."
              : safe.message
          }
        });
      }
      return;
    }
    if (materializationPurgeMatch) {
      if (request.method !== "DELETE") {
        response.setHeader("allow", "DELETE, OPTIONS");
        rejectJson(request, response, 405, {
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: "완료된 VOD 캐시는 DELETE 요청으로만 지울 수 있습니다."
          }
        });
        return;
      }
      if (
        protocol !== CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA
      ) {
        rejectJson(request, response, 400, {
          error: {
            code: "PROTOCOL_REQUIRED",
            message: "지원하는 VOD 캐시 삭제 프로토콜 헤더가 필요합니다."
          }
        });
        return;
      }
      const capability = authenticateCapability(
        request,
        response,
        "cache-delete"
      );
      if (!capability) {
        return;
      }
      if (!config.vodRuntime || !config.vodStateDir) {
        rejectJson(request, response, 503, {
          error: {
            code: "VOD_RUNTIME_NOT_READY",
            message: "검증된 관리형 VOD cache root가 없어 삭제할 수 없습니다."
          }
        });
        return;
      }
      try {
        const body = await readControlJsonRequest(
          request,
          MAX_CHZZK_VOD_CACHE_PURGE_REQUEST_BYTES
        );
        const owner = materializationOwnerScope(
          materializationPurgeMatch[2] || ""
        );
        if (!owner) {
          rejectJson(request, response, 404, {
            error: {
              code: "CACHE_NOT_FOUND",
              message: "정확히 일치하는 완료 VOD 캐시 세션을 찾지 못했습니다."
            }
          });
          return;
        }
        if (
          !authorizeCapabilityProject(
            request,
            response,
            capability,
            owner.projectId,
            owner.sourceUrl,
            true
          )
        ) {
          return;
        }
        if (closing) {
          sendGatewayClosing(request, response, config.allowedOrigin);
          return;
        }
        const result = await chzzkVodJobs.purge(
          materializationPurgeMatch[2] || "",
          requestMediaAccess(request),
          body
        );
        if (closing) {
          sendGatewayClosing(request, response, config.allowedOrigin);
          return;
        }
        if (!result) {
          sendJson(response, 404, {
            error: {
              code: "CACHE_NOT_FOUND",
              message: "정확히 일치하는 완료 VOD 캐시 세션을 찾지 못했습니다."
            }
          });
          return;
        }
        sendJson(response, 200, result);
      } catch (error) {
        const invalidRequest = error instanceof TypeError;
        const safe = invalidRequest
          ? {
            status: 400,
            code: "INVALID_CACHE_PURGE_REQUEST",
            message: error.message
          }
          : safeError(error);
        rejectJson(request, response, safe.status, {
          error: {
            code: safe.status >= 500 ? "CACHE_PURGE_FAILED" : safe.code,
            message: safe.status >= 500
              ? "현재 완료 작업의 VOD 캐시를 안전하게 삭제하지 못했습니다."
              : safe.message
          }
        });
      }
      return;
    }
    if (request.method !== "GET" && request.method !== "POST") {
      const materializationRequest = Boolean(
        isMaterializationCollection || materializationJobMatch
      );
      const allowed = materializationRequest
        ? "GET, POST, DELETE, OPTIONS"
        : "GET, POST, OPTIONS";
      if (!(materializationJobMatch && request.method === "DELETE")) {
        response.setHeader("allow", allowed);
        rejectJson(request, response, 405, {
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: materializationRequest
              ? "이 VOD 작업에서 지원하지 않는 요청 방식입니다."
              : "GET 또는 POST 요청만 지원합니다."
          }
        });
        return;
      }
    }
    if (
      (isMaterializationCollection || materializationJobMatch)
      && protocol !== CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
    ) {
      rejectJson(request, response, 400, {
        error: {
          code: "PROTOCOL_REQUIRED",
          message: "지원하는 VOD 준비 프로토콜 헤더가 필요합니다."
        }
      });
      return;
    }
    if (isMaterializationCollection || materializationJobMatch) {
      const capability = authenticateCapability(request, response, "vod");
      if (!capability) {
        return;
      }
      if (!config.vodRuntime) {
        rejectJson(request, response, 503, {
          error: {
            code: "VOD_RUNTIME_NOT_READY",
            message: "검증된 로컬 VOD runtime identity가 없어 VOD 기능을 사용할 수 없습니다."
          }
        });
        return;
      }
      const localPort = request.socket.localPort || config.port;
      const baseUrl = `http://127.0.0.1:${localPort}`;
      try {
        if (isMaterializationCollection) {
          if (request.method !== "POST") {
            response.setHeader("allow", "POST, OPTIONS");
            rejectJson(request, response, 405, {
              error: {
                code: "METHOD_NOT_ALLOWED",
                message: "POST 요청만 지원합니다."
              }
            });
            return;
          }
          const body = await readControlJsonRequest(
            request,
            MAX_CHZZK_VOD_REQUEST_BYTES
          );
          const bodyRecord = typeof body === "object"
            && body !== null
            && !Array.isArray(body)
            ? body as Record<string, unknown>
            : null;
          if (!authorizeCapabilityProject(
            request,
            response,
            capability,
            bodyRecord?.consumerId,
            bodyRecord?.sourceUrl,
            true
          )) {
            return;
          }
          if (closing) {
            sendGatewayClosing(request, response, config.allowedOrigin);
            return;
          }
          const job = chzzkVodJobs.create(body);
          chzzkVodJobs.observe(job.id, capability.clientNonce);
          rememberMaterializationOwner(job.id, capability);
          const status = await chzzkVodJobs.publicStatus(job, baseUrl);
          if (closing) {
            sendGatewayClosing(request, response, config.allowedOrigin);
            return;
          }
          sendJson(
            response,
            202,
            statusForMaterializationNamespace(status, materializationNamespace)
          );
          return;
        }
        const jobId = materializationJobMatch?.[2] || "";
        const job = chzzkVodJobs.get(jobId);
        if (!job) {
          rejectJson(request, response, 404, {
            error: {
              code: "JOB_NOT_FOUND",
              message: "VOD 준비 작업을 찾지 못했습니다."
            }
          });
          return;
        }
        const owner = materializationOwnerScope(jobId) ?? Object.freeze({
          projectId: job.request.consumerId,
          sourceUrl: job.request.sourceUrl
        });
        if (!authorizeCapabilityProject(
          request,
          response,
          capability,
          owner.projectId,
          owner.sourceUrl,
          true
        )) {
          return;
        }
        discardUnreadRequestBody(request, response);
        if (request.method === "DELETE") {
          chzzkVodJobs.cancel(jobId);
        } else if (
          request.method !== "POST"
          && (authenticatedPublicMode || request.method !== "GET")
        ) {
          const allowed = authenticatedPublicMode
            ? "POST, DELETE, OPTIONS"
            : "GET, POST, DELETE, OPTIONS";
          response.setHeader("allow", allowed);
          rejectJson(request, response, 405, {
            error: {
              code: "METHOD_NOT_ALLOWED",
              message: authenticatedPublicMode
                ? "POST 또는 DELETE 요청만 지원합니다."
                : "GET, POST 또는 DELETE 요청만 지원합니다."
            }
          });
          return;
        } else if (
          authenticatedPublicMode
          && decryptedControlRequests.get(request)?.body !== null
        ) {
          rejectJson(request, response, 400, {
            error: {
              code: "INVALID_MATERIALIZATION_STATUS_REQUEST",
              message: "암호화된 VOD 준비 상태 요청 본문이 올바르지 않습니다."
            }
          });
          return;
        }
        // A status request keeps only the observer that originally submitted
        // this exact job alive. Same-project recovery capabilities may inspect
        // or explicitly cancel it, but cannot accidentally resurrect its lease.
        chzzkVodJobs.renewObserver(jobId, capability.clientNonce);
        const status = await chzzkVodJobs.publicStatus(job, baseUrl);
        if (closing) {
          sendGatewayClosing(request, response, config.allowedOrigin);
          return;
        }
        sendJson(
          response,
          200,
          statusForMaterializationNamespace(status, materializationNamespace)
        );
      } catch (error) {
        const invalidRequest = error instanceof TypeError;
        const safe = invalidRequest
          ? {
            status: 400,
            code: "INVALID_MATERIALIZATION_REQUEST",
            message: error.message
          }
          : safeError(error);
        rejectJson(request, response, safe.status, {
          error: {
            code: safe.status >= 500
              ? "MATERIALIZATION_INTERNAL_ERROR"
              : safe.code,
            message: safe.status >= 500
              ? "VOD 준비 작업을 처리하지 못했습니다."
              : safe.message
          }
        });
      }
      return;
    }
    const captionCapability = authenticateCapability(
      request,
      response,
      "captions"
    );
    if (!captionCapability) {
      return;
    }
    const encryptedCaptionProbe = authenticatedPublicMode
      && request.method === "POST"
      && decryptedControlRequests.get(request)?.body === null;
    if (
      encryptedCaptionProbe
      || (!authenticatedPublicMode && request.method === "GET")
    ) {
      touchCapability(captionCapability);
      discardUnreadRequestBody(request, response);
      sendJson(response, 200, capabilityResponse(config));
      return;
    }
    if (request.method !== "POST") {
      const allowed = authenticatedPublicMode
        ? "POST, OPTIONS"
        : "GET, POST, OPTIONS";
      response.setHeader("allow", allowed);
      rejectJson(request, response, 405, {
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: authenticatedPublicMode
            ? "POST 요청만 지원합니다."
            : "GET 또는 POST 요청만 지원합니다."
        }
      });
      return;
    }

    if (
      activePipelineControllers.size
      >= config.maxConcurrentCaptionPipelines
    ) {
      response.setHeader(
        "retry-after",
        String(CAPTION_PIPELINE_RETRY_AFTER_SECONDS)
      );
      rejectJson(request, response, 429, {
        error: {
          code: "CAPTION_PIPELINE_BUSY",
          message: "현재 자막 처리가 진행 중입니다. 잠시 뒤 다시 시도해 주세요."
        }
      });
      return;
    }

    const pipelineController = new AbortController();
    activePipelineControllers.add(pipelineController);
    const abortPipeline = () => {
      if (!pipelineController.signal.aborted) {
        pipelineController.abort(
          new DOMException(
            "자막 요청 연결이 닫혔습니다.",
            "AbortError"
          )
        );
      }
    };
    const abortClosedPipelineResponse = () => {
      if (!response.writableEnded) {
        abortPipeline();
      }
    };
    request.once("aborted", abortPipeline);
    response.once("close", abortClosedPipelineResponse);
    gatewayShutdownController.signal.addEventListener(
      "abort",
      abortPipeline,
      { once: true }
    );
    if (gatewayShutdownController.signal.aborted) {
      abortPipeline();
    }
    try {
      const pipelineConfig = resolveCaptionPipelineRequestConfig(
        config.pipeline
      );
      const body = await readControlJsonRequest(
        request,
        config.maxBodyBytes,
        {
          signal: pipelineController.signal,
          timeoutMs: config.captionRequestBodyTimeoutMs
        }
      );
      const bodyRecord = typeof body === "object"
        && body !== null
        && !Array.isArray(body)
        ? body as Record<string, unknown>
        : null;
      const sourceRecord = bodyRecord?.source;
      const sourceProjectId = typeof sourceRecord === "object"
        && sourceRecord !== null
        && !Array.isArray(sourceRecord)
        ? (sourceRecord as Record<string, unknown>).projectId
        : undefined;
      if (!authorizeCapabilityProject(
        request,
        response,
        captionCapability,
        sourceProjectId
      )) {
        return;
      }
      if (closing) {
        sendGatewayClosing(request, response, config.allowedOrigin);
        return;
      }
      const result = await pipelineRunner(body, {
        fetchImpl,
        ...pipelineConfig,
        signal: pipelineController.signal
      });
      if (closing) {
        sendGatewayClosing(request, response, config.allowedOrigin);
      } else if (!pipelineController.signal.aborted) {
        sendJson(response, 200, result);
      }
    } catch (error) {
      if (pipelineController.signal.aborted) {
        if (closing && !response.headersSent && !response.writableEnded) {
          sendGatewayClosing(request, response, config.allowedOrigin);
        }
        return;
      }
      const safe = safeError(error);
      rejectJson(request, response, safe.status, {
        error: {
          code: safe.code,
          message: safe.message
        }
      });
    } finally {
      request.removeListener("aborted", abortPipeline);
      response.removeListener("close", abortClosedPipelineResponse);
      gatewayShutdownController.signal.removeEventListener(
        "abort",
        abortPipeline
      );
      activePipelineControllers.delete(pipelineController);
    }
  };
  const server = createServer((request, response) => {
    const execution = (async () => {
      try {
        if (!validGatewayAuthority(request)) {
          rejectJson(request, response, 421, {
            error: {
              code: "MISDIRECTED_REQUEST",
              message: "요청 대상이 Kirinuki loopback 엔진과 일치하지 않습니다."
            }
          });
        } else if (closing) {
          sendGatewayClosing(request, response, config.allowedOrigin);
        } else {
          await handleRequest(request, response);
        }
      } catch {
        if (!response.headersSent && !response.writableEnded) {
          rejectJson(request, response, 500, {
            error: {
              code: "INTERNAL_ERROR",
              message: "자막 게이트웨이 내부 오류가 발생했습니다."
            }
          });
        } else if (!response.destroyed) {
          response.destroy();
        }
      } finally {
        await waitForResponseSettlement(response);
      }
    })();
    activeHandlers.add(execution);
    void execution.finally(() => activeHandlers.delete(execution));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.once("close", () => {
    // Direct test/embedding callers may close the HTTP server without using
    // runtime.shutdown(). Observe that best-effort fallback so a future
    // rejecting job-manager close cannot become an unhandled rejection. The
    // managed shutdown path calls and verifies the same idempotent close.
    void chzzkVodJobs.close().catch(() => undefined);
  });

  let shutdownPromise: Promise<void> | null = null;
  const shutdown = ({
    graceMs = DEFAULT_GATEWAY_SHUTDOWN_GRACE_MS,
    deadlineMs = DEFAULT_GATEWAY_SHUTDOWN_DEADLINE_MS
  }: {
    graceMs?: number;
    deadlineMs?: number;
  } = {}): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }
    // This gate must flip before any drain/await so a request parsed from an
    // already-connected pipelined socket cannot start new work during close.
    closing = true;
    const normalizedGraceMs = Number.isFinite(graceMs)
      ? Math.round(graceMs)
      : DEFAULT_GATEWAY_SHUTDOWN_GRACE_MS;
    const normalizedDeadlineMs = Number.isFinite(deadlineMs)
      ? Math.round(deadlineMs)
      : DEFAULT_GATEWAY_SHUTDOWN_DEADLINE_MS;
    const boundedGraceMs = Math.max(0, Math.min(30_000, normalizedGraceMs));
    const boundedDeadlineMs = Math.max(
      boundedGraceMs,
      Math.min(60_000, normalizedDeadlineMs)
    );
    shutdownPromise = (async () => {
      // Yield once so `shutdownPromise` is assigned before synchronous AbortSignal
      // listeners run; even an injected re-entrant listener receives this same
      // idempotent promise instead of starting a second shutdown flow.
      await Promise.resolve();
      if (!gatewayShutdownController.signal.aborted) {
        gatewayShutdownController.abort(new DOMException(
          "Kirinuki 내부 자막 엔진을 종료합니다.",
          "AbortError"
        ));
      }
      for (const capability of [...capabilitiesByToken.values()]) {
        removeCapability(capability);
      }
      for (const transport of encryptedTransports.values()) {
        transport.key.fill(0);
      }
      encryptedTransports.clear();
      sessionEncryptionGrants.clear();
      pendingPairingResponses.clear();
      localVodPlayback.shutdown();
      // Job cancellation starts before HTTP draining so yt-dlp/ffmpeg process
      // groups get their TERM -> KILL cleanup window in full.
      const jobsSettled = chzzkVodJobs.close();
      for (const controller of activePipelineControllers) {
        if (!controller.signal.aborted) {
          controller.abort(new DOMException(
            "Kirinuki 내부 자막 엔진을 종료합니다.",
            "AbortError"
          ));
        }
      }
      const serverClosed = new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
        server.closeIdleConnections();
      });
      const handlersSettled = (async () => {
        await Promise.allSettled([serverClosed]);
        while (activeHandlers.size > 0) {
          await Promise.allSettled([...activeHandlers]);
        }
      })();
      const graceful = Promise.allSettled([
        jobsSettled,
        serverClosed,
        handlersSettled
      ]).then((results) => {
        const failures = results.flatMap((result) => (
          result.status === "rejected" ? [result.reason] : []
        ));
        if (failures.length === 1) {
          throw failures[0];
        }
        if (failures.length > 1) {
          throw new AggregateError(
            failures,
            "Kirinuki 내부 자막 엔진 종료 정리 중 여러 작업이 실패했습니다."
          );
        }
      });
      const forceConnections = () => {
        for (const controller of activeMediaControllers) {
          if (!controller.signal.aborted) {
            controller.abort(mediaTransferAborted());
          }
        }
        server.closeAllConnections();
        for (const socket of sockets) {
          socket.destroy();
        }
      };
      const graceTimer = setTimeout(forceConnections, boundedGraceMs);
      let deadlineTimer: NodeJS.Timeout | undefined;
      const deadlineReached = new Promise<"deadline">((resolve) => {
        deadlineTimer = setTimeout(() => {
          forceConnections();
          resolve("deadline");
        }, boundedDeadlineMs);
      });
      try {
        const outcome = await Promise.race([
          graceful.then(() => "settled" as const),
          deadlineReached
        ]);
        if (outcome === "deadline") {
          // `graceful` is all-settled and remains observed after detachment, so
          // an abort-ignoring third-party runner cannot create an unhandled
          // rejection or keep the shutdown caller pending forever. Do not
          // clear active bookkeeping here: this runtime is terminal, and the
          // non-zero counters intentionally expose work that ignored abort.
          void graceful.then(
            () => undefined,
            () => undefined
          );
          throw new CaptionGatewayError(
            "Kirinuki 내부 자막 엔진 종료가 안전 종료 deadline을 넘었습니다.",
            {
              code: "GATEWAY_SHUTDOWN_DEADLINE_EXCEEDED",
              httpStatus: 503
            }
          );
        }
      } finally {
        clearTimeout(graceTimer);
        clearTimeout(deadlineTimer);
      }
    })();
    return shutdownPromise;
  };
  return {
    server,
    config,
    chzzkVodJobs,
    ready: vodCacheRecovery,
    publishPairingResponse,
    shutdown,
    get activeHandlerCount() {
      return activeHandlers.size;
    },
    get activeCaptionPipelineCount() {
      return activePipelineControllers.size;
    }
  };
}

export async function startCaptionGateway(
  options: Parameters<typeof createCaptionGatewayServer>[0] = {}
) {
  const runtime = createCaptionGatewayServer(options);
  const { server, config } = runtime;
  await runtime.ready;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "127.0.0.1", () => resolve());
  });
  return runtime;
}

function isMainModule(): boolean {
  return Boolean(
    process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href
  );
}

if (isMainModule()) {
  startCaptionGateway()
    .then(({ config, shutdown }) => {
      console.log(
        `Kirinuki caption gateway ready at http://127.0.0.1:${config.port}`
      );
      let closing = false;
      const close = () => {
        if (closing) {
          return;
        }
        closing = true;
        void shutdown()
          .then(() => {
            process.exitCode = 0;
          })
          .catch(() => {
            process.exitCode = 1;
          });
      };
      process.once("SIGINT", close);
      process.once("SIGTERM", close);
    })
    .catch((error) => {
      const safe = safeError(error);
      console.error(`Kirinuki caption gateway failed: ${safe.code}`);
      process.exitCode = 1;
    });
}
