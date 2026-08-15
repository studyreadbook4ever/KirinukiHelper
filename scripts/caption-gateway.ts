#!/usr/bin/env node

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import type { BigIntStats } from "node:fs";
import { open } from "node:fs/promises";
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
  isKirinukiLocalStudioOrigin
} from "../src/lib/local-runtime-origin.js";
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
  CHZZK_VOD_HANDLE_MS,
  CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA,
  CHZZK_VOD_CONSUMER_CACHE_PURGE_REQUEST_SCHEMA,
  CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA,
  VOD_ARTIFACT_CHUNK_BYTES,
  ChzzkVodJobManagerError,
  createChzzkVodJobManager
} from "./chzzk-vod-job-manager.js";
import type {
  ChzzkVodArtifactIdentity,
  ChzzkVodArtifactVerification,
  ChzzkVodMaterializationRunner,
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

export const CAPTION_AGENT_CAPABILITY_SCHEMA_ID =
  "chzzk-kirinuki-caption-agent/capability-v2";
export const CAPTION_AGENT_SESSION_SCHEMA_ID =
  "chzzk-kirinuki-caption-agent/session-v1";
export const CAPTION_AGENT_HEALTH_SCHEMA_ID =
  "chzzk-kirinuki-caption-agent/health-v1";
export const DEFAULT_CAPTION_GATEWAY_PORT = 4319;
export const DEFAULT_PAIRING_LIMIT_PER_MINUTE = 12;
export const DEFAULT_MAX_CONCURRENT_CAPTION_PIPELINES = 1;
export const MAX_CONCURRENT_CAPTION_PIPELINES = 2;
export const CAPTION_PIPELINE_RETRY_AFTER_SECONDS = 1;
export const DEFAULT_CAPTION_REQUEST_BODY_TIMEOUT_MS = 15_000;
export const MAX_CAPTION_REQUEST_BODY_TIMEOUT_MS = 60_000;
export const MAX_CHZZK_VOD_REQUEST_BYTES = 256 * 1024;
export const MAX_CHZZK_VOD_CACHE_PURGE_REQUEST_BYTES = 16 * 1024;
export const DEFAULT_GATEWAY_SHUTDOWN_GRACE_MS = 1_500;
export const DEFAULT_GATEWAY_SHUTDOWN_DEADLINE_MS =
  EXTERNAL_PROCESS_KILL_GRACE_MS + 10_000;

interface CaptionGatewayConfig {
  agentToken: string;
  autoPair: boolean;
  allowedOrigin: string;
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
    const strictSoopSourceClockIdentity = source.platform === SOURCE_PLATFORM_SOOP
      ? normalizeSoopVodSourceClockIdentity(sourceClockIdentity)
      : null;
    if (
      (source.platform === SOURCE_PLATFORM_SOOP
        && (
          !strictSoopSourceClockIdentity
          || strictSoopSourceClockIdentity.contentId !== source.contentId
        ))
      || (source.platform !== SOURCE_PLATFORM_SOOP
        && sourceClockIdentity !== undefined)
    ) {
      throw new TypeError(
        "SOOP 공식 VOD part 시계 증명이 없거나 현재 원본과 맞지 않습니다."
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

function requiredServerValue(value: unknown, name: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new CaptionGatewayError(`${name} 환경 변수가 필요합니다.`, {
      code: "MISSING_CONFIGURATION",
      httpStatus: 500
    });
  }
  return normalized;
}

function enabledEnvironmentFlag(value: unknown): boolean {
  return ["1", "true", "yes", "on"].includes(
    String(value || "").trim().toLowerCase()
  );
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
  const allowedOrigin = requiredServerValue(
    configuredOriginValue,
    "KIRINUKI_ALLOWED_ORIGIN"
  );
  if (
    configuredOriginValue !== allowedOrigin
    || !isKirinukiLocalStudioOrigin(allowedOrigin)
  ) {
    throw new CaptionGatewayError(
      `KIRINUKI_ALLOWED_ORIGIN은 설치된 Kirinuki 앱 Origin(${KIRINUKI_LOCAL_STUDIO_ORIGIN})이어야 합니다.`,
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
  const autoPair = enabledEnvironmentFlag(env.KIRINUKI_AUTO_PAIR);
  const configuredAgentToken = String(
    env.KIRINUKI_AGENT_TOKEN || ""
  ).trim();
  if (!autoPair && !configuredAgentToken) {
    requiredServerValue(configuredAgentToken, "KIRINUKI_AGENT_TOKEN");
  }
  const vodRuntime = resolveManagedVodRuntimeIdentity(env);
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
    agentToken: configuredAgentToken,
    autoPair,
    allowedOrigin,
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

function exactBearerToken(
  authorization: unknown,
  expectedToken: string
): boolean {
  const match = /^Bearer ([^\s]+)$/iu.exec(String(authorization || ""));
  if (!match) {
    return false;
  }
  const suppliedToken = match[1];
  if (suppliedToken === undefined) {
    return false;
  }
  const supplied = Buffer.from(suppliedToken);
  const expected = Buffer.from(expectedToken);
  return (
    supplied.length === expected.length
    && timingSafeEqual(supplied, expected)
  );
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
      "X-Kirinuki-Media-Access",
      "X-Kirinuki-Protocol"
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
  const body = JSON.stringify(value);
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
    String(request.headers.origin || ""),
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
    && metadata.dev.toString() === expectedIdentity.dev
    && metadata.ino.toString() === expectedIdentity.ino
    && metadata.mtimeNs.toString() === expectedIdentity.mtimeNs
    && metadata.ctimeNs.toString() === expectedIdentity.ctimeNs
  );
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
    if (
      !sameMediaIdentity(metadata, expectedIdentity)
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
  fetchImpl = globalThis.fetch,
  pipelineRunner = runCaptionPipeline,
  materializationRunner,
  chzzkMaterializer = materializeChzzkVod,
  externalMaterializer = materializeExternalVod,
  randomBytesImpl = randomBytes,
  now = Date.now
}: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof globalThis.fetch;
  pipelineRunner?: PipelineRunner;
  materializationRunner?: ChzzkVodMaterializationRunner;
  chzzkMaterializer?: ChzzkVodMaterializerImplementation;
  externalMaterializer?: ExternalVodMaterializerImplementation;
  randomBytesImpl?: typeof randomBytes;
  now?: () => number;
} = {}) {
  const resolvedConfig = resolveCaptionGatewayConfig(env);
  const generatedToken = resolvedConfig.agentToken
    ? ""
    : randomBytesImpl(32).toString("base64url");
  const config = {
    ...resolvedConfig,
    agentToken: resolvedConfig.agentToken || generatedToken
  };
  const pairingState = {
    windowStartedAt: now(),
    count: 0
  };
  const selectedMaterializationRunner = materializationRunner
    ?? createPlatformMaterializationRunner({
      chzzkMaterializer,
      externalMaterializer
    });
  const chzzkVodJobs = createChzzkVodJobManager({
    runner: selectedMaterializationRunner,
    ...(config.vodStateDir ? { artifactRoot: config.vodStateDir } : {}),
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
  let closing = false;
  const handleRequest = async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> => {
    const origin = String(request.headers.origin || "");
    if (origin !== config.allowedOrigin) {
      rejectJson(request, response, 403, {
        error: {
          code: "ORIGIN_NOT_ALLOWED",
          message: "허용되지 않은 Origin입니다."
        }
      });
      return;
    }
    setCorsHeaders(request, response, origin, config.allowedOrigin);

    const requestUrl = new URL(
      request.url || "/",
      "http://127.0.0.1"
    );
    const isHealthRequest = requestUrl.pathname === "/v1/health";
    const isPairingRequest = requestUrl.pathname === "/v1/session";
    const isCaptionRequest = requestUrl.pathname === "/v1/captions";
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
      && !isPairingRequest
      && !isCaptionRequest
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
    if (isHealthRequest) {
      if (
        origin !== config.allowedOrigin
        || String(request.headers["x-kirinuki-protocol"] || "")
          !== CAPTION_AGENT_REQUEST_SCHEMA_ID
      ) {
        rejectJson(request, response, 403, {
          error: {
            code: "HEALTH_PROBE_NOT_ALLOWED",
            message: "정확한 Origin과 자막 프로토콜이 필요합니다."
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
      discardUnreadRequestBody(request, response);
      sendJson(response, 200, {
        schema: CAPTION_AGENT_HEALTH_SCHEMA_ID,
        status: "ok",
        managed: config.autoPair,
        originBinding: KIRINUKI_GATEWAY_ORIGIN_BINDING,
        transcriptionMode: LOCAL_WHISPERCPP_TRANSCRIPTION_MODE,
        vodRuntime: config.vodRuntime
      });
      return;
    }
    if (isPairingRequest) {
      if (!config.autoPair) {
        rejectJson(request, response, 404, {
          error: {
            code: "PAIRING_DISABLED",
            message: "자동 로컬 연결이 비활성화되어 있습니다."
          }
        });
        return;
      }
      if (origin !== config.allowedOrigin) {
        rejectJson(request, response, 403, {
          error: {
            code: "ORIGIN_NOT_ALLOWED",
            message: "정확한 Kirinuki 로컬 Studio Origin에서만 연결할 수 있습니다."
          }
        });
        return;
      }
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
      if (
        String(request.headers["x-kirinuki-protocol"] || "")
        !== CAPTION_AGENT_REQUEST_SCHEMA_ID
      ) {
        rejectJson(request, response, 400, {
          error: {
            code: "PROTOCOL_REQUIRED",
            message: "지원하는 자막 프로토콜 헤더가 필요합니다."
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
      discardUnreadRequestBody(request, response);
      sendJson(response, 200, {
        schema: CAPTION_AGENT_SESSION_SCHEMA_ID,
        status: "ok",
        authentication: "bearer-process-memory",
        expires: "companion-restart",
        token: config.agentToken
      });
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
        String(request.headers["x-kirinuki-protocol"] || "")
          !== CHZZK_VOD_CONSUMER_CACHE_PURGE_REQUEST_SCHEMA
      ) {
        rejectJson(request, response, 400, {
          error: {
            code: "PROTOCOL_REQUIRED",
            message: "지원하는 VOD 세션 캐시 삭제 프로토콜 헤더가 필요합니다."
          }
        });
        return;
      }
      if (!exactBearerToken(
        request.headers.authorization,
        config.agentToken
      )) {
        response.setHeader("www-authenticate", "Bearer");
        rejectJson(request, response, 401, {
          error: {
            code: "UNAUTHORIZED",
            message: "Bearer 인증이 필요합니다."
          }
        });
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
        const body = await readJsonRequest(
          request,
          MAX_CHZZK_VOD_CACHE_PURGE_REQUEST_BYTES
        );
        if (closing) {
          sendGatewayClosing(request, response, config.allowedOrigin);
          return;
        }
        const result = await chzzkVodJobs.purgeConsumerCache(
          materializationSessionPurgeMatch[2] || "",
          request.headers["x-kirinuki-media-access"],
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
        String(request.headers["x-kirinuki-protocol"] || "")
          !== CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA
      ) {
        rejectJson(request, response, 400, {
          error: {
            code: "PROTOCOL_REQUIRED",
            message: "지원하는 VOD 캐시 삭제 프로토콜 헤더가 필요합니다."
          }
        });
        return;
      }
      if (!exactBearerToken(
        request.headers.authorization,
        config.agentToken
      )) {
        response.setHeader("www-authenticate", "Bearer");
        rejectJson(request, response, 401, {
          error: {
            code: "UNAUTHORIZED",
            message: "Bearer 인증이 필요합니다."
          }
        });
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
        const body = await readJsonRequest(
          request,
          MAX_CHZZK_VOD_CACHE_PURGE_REQUEST_BYTES
        );
        if (closing) {
          sendGatewayClosing(request, response, config.allowedOrigin);
          return;
        }
        const result = await chzzkVodJobs.purge(
          materializationPurgeMatch[2] || "",
          request.headers["x-kirinuki-media-access"],
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
      && String(request.headers["x-kirinuki-protocol"] || "")
        !== CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
    ) {
      rejectJson(request, response, 400, {
        error: {
          code: "PROTOCOL_REQUIRED",
          message: "지원하는 VOD 준비 프로토콜 헤더가 필요합니다."
        }
      });
      return;
    }
    if (!exactBearerToken(
      request.headers.authorization,
      config.agentToken
    )) {
      response.setHeader("www-authenticate", "Bearer");
      rejectJson(request, response, 401, {
        error: {
          code: "UNAUTHORIZED",
          message: "Bearer 인증이 필요합니다."
        }
      });
      return;
    }
    if (isMaterializationCollection || materializationJobMatch) {
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
          const body = await readJsonRequest(
            request,
            MAX_CHZZK_VOD_REQUEST_BYTES
          );
          if (closing) {
            sendGatewayClosing(request, response, config.allowedOrigin);
            return;
          }
          const job = chzzkVodJobs.create(body);
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
        discardUnreadRequestBody(request, response);
        if (request.method === "DELETE") {
          chzzkVodJobs.cancel(jobId);
        } else if (request.method !== "GET") {
          response.setHeader("allow", "GET, DELETE, OPTIONS");
          rejectJson(request, response, 405, {
            error: {
              code: "METHOD_NOT_ALLOWED",
              message: "GET 또는 DELETE 요청만 지원합니다."
            }
          });
          return;
        }
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
    if (request.method === "GET") {
      discardUnreadRequestBody(request, response);
      sendJson(response, 200, capabilityResponse(config));
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
      const body = await readJsonRequest(
        request,
        config.maxBodyBytes,
        {
          signal: pipelineController.signal,
          timeoutMs: config.captionRequestBodyTimeoutMs
        }
      );
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
        if (closing) {
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
