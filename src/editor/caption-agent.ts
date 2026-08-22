import {
  CAPTION_HARNESS_FINGERPRINT,
  CAPTION_QUALITY_PROFILE_ID
} from "../caption-agent/caption-quality-harness.js";
import {
  buildProjectCaptionEditorialContext,
  captionEditorialContextFingerprint
} from "../caption-agent/editorial-context.js";
import {
  AUDSEG_ENGINE_VERSION,
  AUDSEG_PIPELINE_FINGERPRINT
} from "./audseg.js";
import {
  studioStorageArea
} from "./studio-runtime.js";
import {
  LOCAL_MEDIA_ENGINE_AUTHENTICATED_SESSION_PROTOCOL,
  LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER,
  LOCAL_MEDIA_ENGINE_SESSION_STATUS_PROTOCOL,
  LOCAL_MEDIA_ENGINE_SESSION_STATUS_SCHEMA,
  decryptLocalMediaEngineSessionResponse,
  freshLocalMediaEngineChallenge,
  localMediaEngineProofTranscript,
  prepareLocalMediaEngineSessionRequest,
  parseLocalMediaEngineDeviceProof,
  verifyLocalMediaEngineSignature
} from "../lib/local-media-engine-auth.js";
import {
  probeLocalMediaEngine
} from "./local-media-engine-onboarding.js";
import {
  currentAuthenticatedLocalMediaEngine,
  forgetAuthenticatedLocalMediaEngine,
  localMediaEngineTrustStore
} from "./local-media-engine-trust.js";
import type {
  LocalMediaEngineTrustStore
} from "./local-media-engine-trust.js";
import {
  establishLocalMediaEngineTransport,
  forgetLocalMediaEngineTransport,
  hasLocalMediaEngineTransport,
  localMediaEngineTransportFetch
} from "./local-media-engine-transport.js";
import {
  localMediaEngineLoopbackRequestInit
} from "../lib/local-media-engine-contract.js";

export const CAPTION_AGENT_SETTINGS_KEY = "chzzk-kirinuki-caption-agent-settings-v4";
const PREVIOUS_CAPTION_AGENT_SETTINGS_KEY =
  "chzzk-kirinuki-caption-agent-settings-v3";
export const LEGACY_CAPTION_AGENT_SETTINGS_KEY =
  "chzzk-kirinuki-caption-agent-settings-v2";
const OLDEST_CAPTION_AGENT_SETTINGS_KEY =
  "chzzk-kirinuki-caption-agent-settings-v1";
export const CAPTION_AGENT_REQUEST_SCHEMA = "chzzk-kirinuki-caption-request/v1";
export const CAPTION_AGENT_RESPONSE_SCHEMA = "chzzk-kirinuki-caption-response/v1";
export const CAPTION_AGENT_SESSION_SCHEMA =
  "kirinuki-local-engine-session/v1";
export const LOCAL_ENGINE_SESSION_REQUEST_SCHEMA =
  LOCAL_MEDIA_ENGINE_AUTHENTICATED_SESSION_PROTOCOL;
export const LOCAL_ENGINE_SESSION_AUTHENTICATION =
  "bearer-memory-capability";
export const CAPTION_AGENT_CAPABILITY_SCHEMA =
  "chzzk-kirinuki-caption-agent/capability-v2";
export const MAX_REMOTE_CUES = 4_000;
export const MAX_REMOTE_WARNINGS = 4_000;
export const MAX_CAPTION_AGENT_CLIPS_PER_RUN = 16;
export const MAX_CAPTION_AGENT_CUES_PER_RUN = 10_000;
export const MAX_CAPTION_AGENT_POLL_ATTEMPTS = 240;
export const CAPTION_AGENT_REQUEST_TIMEOUT_MS = 65 * 60 * 1_000;
export const CAPTION_AGENT_PROBE_TIMEOUT_MS = 10_000;
export const MAX_CAPTION_AGENT_RESPONSE_BYTES = 8 * 1024 * 1024;
export const MAX_CAPTION_AGENT_CLIP_DURATION_MS = 30 * 60 * 1_000;
export const MAX_CAPTION_AGENT_WAV_BYTES = 64 * 1024 * 1024;
export const CAPTION_AGENT_SAMPLE_RATE_HZ = 16_000;
export const MAX_SESSION_TOKEN_LENGTH = 4_096;
export const MAX_STT_MODEL_LENGTH = 160;

export type CaptionModel = "whisper-tiny" | "audseg-local";

export interface CaptionAgentSettings {
  endpoint: string;
  model: CaptionModel;
}

export interface CaptionClip extends Record<string, unknown> {
  id: string;
  enabled?: boolean;
  sourceStartMs?: number;
  sourceEndMs?: number;
  startMs?: number;
  endMs?: number;
  note?: string;
  title?: string;
}

export interface CaptionCheckpoint {
  clipId: string;
  sourceStartMs: number;
  sourceEndMs: number;
  model: CaptionModel;
  qualityProfile: string;
  harnessFingerprint: string;
  editorialContextFingerprint: string;
  pipelineFingerprint: string;
  requestId: string;
  completedAt: string;
}

export interface CaptionAgentRequest extends JsonRecord {
  schema: typeof CAPTION_AGENT_REQUEST_SCHEMA;
  requestId: string;
  model: typeof LOCAL_WHISPER_CAPTION_MODEL;
  locale: "ko-KR";
  clip: {
    id: string;
    title: string;
    durationMs: number;
  };
  source: {
    projectId: string;
    projectName: string;
    streamerName: string;
  };
  editorialContext: unknown;
  policy: JsonRecord;
  audio: {
    encoding: "base64";
    mimeType: "audio/wav";
    sampleRateHz: number;
    channels: 1;
    data: string;
  };
}

export interface NormalizedCaptionCue {
  startOffsetMs: number;
  endOffsetMs: number;
  text: string;
  y: number;
  color?: string;
  remoteMeta: {
    speakerId: string;
    reviewRequired: boolean;
    placement: typeof AUTOMATIC_CAPTION_PLACEMENT;
    qualityStatus?: string;
    qualityCodes?: string[];
  };
}

type JsonRecord = Record<string, unknown>;
type StorageArea = ReturnType<typeof studioStorageArea>;
type FetchImplementation = typeof fetch;
export type LocalMediaEngineSessionPurpose = "vod" | "captions";

interface CaptionAgentConnectionOptions {
  endpoint: unknown;
  purpose?: LocalMediaEngineSessionPurpose;
  projectId?: unknown;
  sourceUrl?: unknown;
  signal?: AbortSignal;
  fetchImpl?: FetchImplementation;
  timeoutMs?: number;
  trustStore?: Readonly<LocalMediaEngineTrustStore>;
}

interface CaptionAgentProbeOptions extends CaptionAgentConnectionOptions {
  token?: string;
}

export interface CaptionAgentRequestOptions extends CaptionAgentProbeOptions {
  request: CaptionAgentRequest;
  onProgress?: (progress: number, message: string) => void;
  maxPollAttempts?: number;
}

function httpStatus(error: unknown): number {
  return error instanceof CaptionAgentHttpError ? error.status : 0;
}

class CaptionAgentHttpError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "CaptionAgentHttpError";
    this.status = status;
    this.code = code;
  }
}

export const DEFAULT_CAPTION_AGENT_SETTINGS: Readonly<CaptionAgentSettings> =
Object.freeze({
  endpoint: "http://127.0.0.1:4319/v1/captions",
  model: "audseg-local"
});

export const LOCAL_WHISPER_CAPTION_MODEL = "whisper-tiny";
export const LOCAL_AUDSEG_CAPTION_MODEL = "audseg-local";
const ALLOWED_CAPTION_MODELS = new Set<CaptionModel>([
  LOCAL_WHISPER_CAPTION_MODEL,
  LOCAL_AUDSEG_CAPTION_MODEL
]);
const LEGACY_CAPTION_PIPELINE_FINGERPRINT = "legacy-caption-pipeline-v0";
const REQUIRED_CAPTION_PIPELINE_FINGERPRINT =
  "current-caption-pipeline-required-v1";
export const REQUIRED_WHISPER_VAD_ENABLED = false;
export const REQUIRED_WHISPER_TIMESTAMP_CLOCK = "original-audio";
export const REQUIRED_WHISPER_TIMING_REVISION =
  "vad-off-original-clock-v1";
export const REQUIRED_WHISPER_CUE_DURATION_POLICY =
  "source-timing-within-clip";

function isCaptionModel(model: unknown): model is CaptionModel {
  return typeof model === "string"
    && ALLOWED_CAPTION_MODELS.has(model as CaptionModel);
}

export function isAudSegCaptionModel(model: unknown): boolean {
  return model === LOCAL_AUDSEG_CAPTION_MODEL;
}

export function captionAgentRunClipLimit(model: CaptionModel): number | null {
  if (model === LOCAL_AUDSEG_CAPTION_MODEL) {
    return null;
  }
  if (model === LOCAL_WHISPER_CAPTION_MODEL) {
    return MAX_CAPTION_AGENT_CLIPS_PER_RUN;
  }
  throw new Error("선택한 자막 초벌 모델이 올바르지 않습니다.");
}

const AUTOMATIC_CAPTION_PLACEMENT = "bottom";
const AUTOMATIC_CAPTION_Y = 0.84;

function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" ||
    hostname === "localhost";
}

export function isLoopbackCaptionAgentEndpoint(value: unknown): boolean {
  const url = new URL(normalizeCaptionAgentEndpoint(value));
  return (
    url.protocol === "http:"
    && isLoopbackHostname(url.hostname)
  );
}

function normalizeSessionToken(value: unknown): string {
  const secret = String(value || "").trim();
  if (!secret) {
    return "";
  }
  if (
    secret.length > MAX_SESSION_TOKEN_LENGTH
    || !/^[A-Za-z0-9_-]{43}$/u.test(secret)
  ) {
    throw new Error("Kirinuki 내부 자막 엔진의 연결 정보가 올바르지 않습니다.");
  }
  try {
    const base64 = secret.replace(/-/gu, "+").replace(/_/gu, "/") + "=";
    if (atob(base64).length !== 32) {
      throw new Error("invalid length");
    }
  } catch {
    throw new Error("Kirinuki 내부 자막 엔진의 연결 정보가 올바르지 않습니다.");
  }
  return secret;
}

function encodeBase64Url(bytes: Uint8Array): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const packed = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += alphabet[(packed >>> 18) & 63];
    output += alphabet[(packed >>> 12) & 63];
    if (second !== undefined) {
      output += alphabet[(packed >>> 6) & 63];
    }
    if (third !== undefined) {
      output += alphabet[packed & 63];
    }
  }
  return output;
}

function freshLocalEngineDocumentNonce(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

const fallbackLocalEngineDocumentNonce = freshLocalEngineDocumentNonce();

interface LocalEngineDocumentSession {
  readonly token: string;
  readonly clientNonce: string;
  readonly purpose: LocalMediaEngineSessionPurpose;
  readonly projectId: string;
  readonly sourceUrl?: string;
  readonly expiresAtMs: number;
}

let activeLocalEngineDocumentSession: LocalEngineDocumentSession | null = null;

export function clearLocalMediaEngineSessionState(): void {
  activeLocalEngineDocumentSession = null;
  forgetLocalMediaEngineTransport();
  forgetAuthenticatedLocalMediaEngine();
}

export function localEngineDocumentClientNonce(): string {
  return activeLocalEngineDocumentSession?.clientNonce
    ?? fallbackLocalEngineDocumentNonce;
}

function normalizeLocalEngineProjectId(value: unknown): string {
  const projectId = String(value ?? "").normalize("NFC").trim();
  if (
    !projectId
    || projectId.length > 256
    || new TextEncoder().encode(projectId).byteLength > 1_024
    || /[\u0000-\u001f\u007f-\u009f]/u.test(projectId)
  ) {
    throw new Error("로컬 영상 엔진에 연결할 편집 프로젝트가 올바르지 않습니다.");
  }
  return projectId;
}

function normalizeLocalEngineSourceUrl(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const sourceUrl = String(value).trim();
  if (
    sourceUrl !== value
    || sourceUrl.length > 8_192
    || /[\u0000-\u001f\u007f]/u.test(sourceUrl)
  ) {
    throw new Error("로컬 영상 엔진에 연결할 원본 주소가 올바르지 않습니다.");
  }
  const parsed = new URL(sourceUrl);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("로컬 영상 엔진에는 공개 HTTPS VOD 주소만 연결할 수 있습니다.");
  }
  return sourceUrl;
}

function normalizeLocalEngineSessionPurpose(
  value: unknown,
  sourceUrl: string | undefined
): LocalMediaEngineSessionPurpose {
  const purpose = value === undefined
    ? (sourceUrl === undefined ? "captions" : "vod")
    : value;
  if (purpose !== "vod" && purpose !== "captions") {
    throw new TypeError("로컬 엔진 session 목적이 올바르지 않습니다.");
  }
  if (
    (purpose === "vod" && sourceUrl === undefined)
    || (purpose === "captions" && sourceUrl !== undefined)
  ) {
    throw new TypeError(
      purpose === "vod"
        ? "VOD session에는 정규 원본 주소가 필요합니다."
        : "자막 session에는 VOD 원본 권한을 함께 요청할 수 없습니다."
    );
  }
  return purpose;
}

function matchingCachedLocalEngineToken(
  projectId: string,
  purpose: LocalMediaEngineSessionPurpose,
  sourceUrl: string | undefined
): string {
  const session = activeLocalEngineDocumentSession;
  if (
    !session
    || session.projectId !== projectId
    || session.purpose !== purpose
    || session.sourceUrl !== sourceUrl
    || Date.now() >= session.expiresAtMs
  ) {
    return "";
  }
  return session.token;
}

export function captionAgentSessionEndpoint(endpoint: unknown): string {
  const url = new URL(normalizeCaptionAgentEndpoint(endpoint));
  if (!isLoopbackCaptionAgentEndpoint(url.toString())) {
    throw new Error("자동 연결은 영상 준비 도우미가 관리하는 내부 자막 엔진에서만 사용할 수 있습니다.");
  }
  url.pathname = "/v1/session";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function captionAgentRequestHeaders(
  token: unknown
): Record<string, string> {
  const normalizedToken = normalizeSessionToken(token);
  return {
    "X-Kirinuki-Client-Nonce": localEngineDocumentClientNonce(),
    ...(normalizedToken
      ? { Authorization: `Bearer ${normalizedToken}` }
      : {})
  };
}

export function normalizeCaptionAgentEndpoint(value: unknown): string {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("자막 에이전트 주소가 올바른 URL이 아닙니다.");
  }
  if (url.username || url.password) {
    throw new Error("자막 에이전트 주소에 아이디나 비밀번호를 넣지 마세요.");
  }
  if (url.search || url.hash) {
    throw new Error(
      "자막 에이전트 주소에는 쿼리 문자열이나 # 조각을 사용할 수 없습니다."
    );
  }
  const localHttp = url.protocol === "http:" && isLoopbackHostname(url.hostname);
  if (!localHttp) {
    throw new Error(
      "내부 자막 엔진은 영상 준비 도우미가 관리하는 로컬 연결만 사용할 수 있습니다."
    );
  }
  return url.toString();
}

export function normalizeCaptionAgentSettings(
  raw: Partial<CaptionAgentSettings> | null | undefined = {}
): CaptionAgentSettings {
  const model = isCaptionModel(raw?.model)
    ? raw.model
    : DEFAULT_CAPTION_AGENT_SETTINGS.model;
  let endpoint = DEFAULT_CAPTION_AGENT_SETTINGS.endpoint;
  try {
    endpoint = normalizeCaptionAgentEndpoint(
      raw?.endpoint || DEFAULT_CAPTION_AGENT_SETTINGS.endpoint
    );
  } catch {
    // A stale or malformed saved setting must not prevent the editor from opening.
  }
  if (!isLoopbackCaptionAgentEndpoint(endpoint)) {
    endpoint = DEFAULT_CAPTION_AGENT_SETTINGS.endpoint;
  }
  return { endpoint, model };
}

export async function loadCaptionAgentSettings(
  storageArea: StorageArea = studioStorageArea()
): Promise<CaptionAgentSettings> {
  const stored = await storageArea.get([
    CAPTION_AGENT_SETTINGS_KEY,
    PREVIOUS_CAPTION_AGENT_SETTINGS_KEY,
    LEGACY_CAPTION_AGENT_SETTINGS_KEY,
    OLDEST_CAPTION_AGENT_SETTINGS_KEY
  ]);
  const current = stored[CAPTION_AGENT_SETTINGS_KEY];
  const previous = stored[PREVIOUS_CAPTION_AGENT_SETTINGS_KEY]
    || stored[LEGACY_CAPTION_AGENT_SETTINGS_KEY]
    || stored[OLDEST_CAPTION_AGENT_SETTINGS_KEY]
    || {};
  const persisted = normalizeCaptionAgentSettings(
    current || (
      typeof previous === "object" && previous !== null ? previous : {}
    )
  );
  const normalized = {
    ...persisted,
    // A Whisper connection is deliberately scoped to the current editor page:
    // its verified runtime and memory-only session token do not survive reload.
    // Reopening on a disconnected Whisper panel would both misrepresent that
    // state and defeat the progressive AudSeg-first opt-in UX.
    model: DEFAULT_CAPTION_AGENT_SETTINGS.model
  };
  await storageArea.set({ [CAPTION_AGENT_SETTINGS_KEY]: normalized });
  await storageArea.remove([
    PREVIOUS_CAPTION_AGENT_SETTINGS_KEY,
    LEGACY_CAPTION_AGENT_SETTINGS_KEY,
    OLDEST_CAPTION_AGENT_SETTINGS_KEY
  ]);
  return normalized;
}

export async function saveCaptionAgentSettings(
  settings: Partial<CaptionAgentSettings>,
  storageArea: StorageArea = studioStorageArea()
): Promise<CaptionAgentSettings> {
  const requestedModel = isCaptionModel(settings?.model)
    ? settings.model
    : DEFAULT_CAPTION_AGENT_SETTINGS.model;
  const normalized = requestedModel === LOCAL_AUDSEG_CAPTION_MODEL
    ? normalizeCaptionAgentSettings({
      ...settings,
      model: requestedModel
    })
    : normalizeCaptionAgentSettings({
      ...settings,
      endpoint: normalizeCaptionAgentEndpoint(settings?.endpoint),
      model: requestedModel
    });
  await storageArea.set({ [CAPTION_AGENT_SETTINGS_KEY]: normalized });
  await storageArea.remove([
    PREVIOUS_CAPTION_AGENT_SETTINGS_KEY,
    LEGACY_CAPTION_AGENT_SETTINGS_KEY,
    OLDEST_CAPTION_AGENT_SETTINGS_KEY
  ]);
  return normalized;
}

function boundedCapabilityString(
  value: unknown,
  label: string,
  maximum = 2_048
): string {
  const normalized = String(value || "").trim();
  if (
    !normalized
    || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new Error(`자막 에이전트의 ${label} 정보가 올바르지 않습니다.`);
  }
  return normalized;
}

function shortStableFingerprint(value: unknown): string {
  const bytes = new TextEncoder().encode(String(value));
  let first = 0x811C9DC5;
  let second = 0x9E3779B9;
  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 0x01000193) >>> 0;
    second = Math.imul(second ^ byte, 0x85EBCA6B) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second
    .toString(16)
    .padStart(8, "0")}`;
}

export function captionAgentRuntimeIdentity(
  capability: unknown,
  {
    model = DEFAULT_CAPTION_AGENT_SETTINGS.model
  }: { model?: CaptionModel } = {}
): {
  provider: string;
  sttModel: string;
  transcriptionMode: string;
  fingerprint: string;
} {
  if (!isCaptionModel(model)) {
    throw new Error("선택한 자막 초벌 모델이 올바르지 않습니다.");
  }
  if (model === LOCAL_AUDSEG_CAPTION_MODEL) {
    const provider = "local-audseg";
    const sttModel = `audseg-${AUDSEG_ENGINE_VERSION}-dsp`;
    const transcriptionMode = "browser-audio-activity";
    return {
      provider,
      sttModel,
      transcriptionMode,
      fingerprint: AUDSEG_PIPELINE_FINGERPRINT
    };
  }
  if (!isPlainObject(capability)) {
    throw new Error("자막 에이전트 capability 응답이 JSON 객체가 아닙니다.");
  }
  if (
    capability.schema !== CAPTION_AGENT_CAPABILITY_SCHEMA
    || capability.status !== "ok"
  ) {
    throw new Error("자막 에이전트 capability 버전이 맞지 않습니다.");
  }
  const availableModels = Array.isArray(capability.availableModels)
    ? capability.availableModels.map((entry) => String(entry))
    : [];
  if (!availableModels.includes(model)) {
    throw new Error(`Kirinuki 내부 자막 엔진이 ${model} 모델을 지원하지 않습니다.`);
  }
  const provider = boundedCapabilityString(
    capability.provider,
    "STT 제공자",
    80
  );
  if (provider !== "local-whispercpp") {
    throw new Error("자막 에이전트의 STT 제공자가 올바르지 않습니다.");
  }
  const sttModel = boundedCapabilityString(
    isPlainObject(capability.models) ? capability.models.stt : undefined,
    "실제 STT 모델",
    MAX_STT_MODEL_LENGTH
  );
  const transcriptionMode = boundedCapabilityString(
    isPlainObject(capability.transcription)
      ? capability.transcription.mode
      : undefined,
    "STT 실행 방식",
    80
  );
  if (transcriptionMode !== "local-whispercpp") {
    throw new Error(
      "Whisper 로컬 초벌은 이 기기의 local-whispercpp runtime만 사용할 수 있습니다."
    );
  }
  const transcription = isPlainObject(capability.transcription)
    ? capability.transcription
    : {};
  if (transcription.vad !== REQUIRED_WHISPER_VAD_ENABLED) {
    throw new Error(
      "로컬 Whisper가 원본 오디오 시간축을 보장하는 VAD-off 방식이 아닙니다."
    );
  }
  const timestampClock = boundedCapabilityString(
    transcription.timestampClock,
    "타임스탬프 시간축",
    80
  );
  const timingRevision = boundedCapabilityString(
    transcription.timingRevision,
    "타임스탬프 실행 버전",
    80
  );
  if (
    timestampClock !== REQUIRED_WHISPER_TIMESTAMP_CLOCK
    || timingRevision !== REQUIRED_WHISPER_TIMING_REVISION
  ) {
    throw new Error(
      "로컬 Whisper의 세그먼트·단어 시간축 계약이 현재 편집기와 다릅니다."
    );
  }
  if (
    capability.requestSchema !== CAPTION_AGENT_REQUEST_SCHEMA
    || capability.responseSchema !== CAPTION_AGENT_RESPONSE_SCHEMA
  ) {
    throw new Error("로컬 Whisper의 자막 요청·응답 계약이 현재 편집기와 다릅니다.");
  }
  const qualityHarness = isPlainObject(capability.qualityHarness)
    ? capability.qualityHarness
    : {};
  if (
    qualityHarness.profile !== CAPTION_QUALITY_PROFILE_ID
    || qualityHarness.harnessFingerprint !== CAPTION_HARNESS_FINGERPRINT
  ) {
    throw new Error("로컬 Whisper의 자막 품질 하네스가 현재 편집기와 다릅니다.");
  }
  const cueDurationPolicy = boundedCapabilityString(
    capability.cueDurationPolicy,
    "자막 표시 시간 정책",
    80
  );
  if (cueDurationPolicy !== REQUIRED_WHISPER_CUE_DURATION_POLICY) {
    throw new Error(
      "로컬 Whisper가 발화 원본 시간축 안에서 자막 길이를 보존하는 방식이 아닙니다."
    );
  }
  const identitySource = JSON.stringify({
    schema: "caption-pipeline-identity/v3",
    model,
    provider,
    transcriptionMode,
    sttModel,
    vad: REQUIRED_WHISPER_VAD_ENABLED,
    timestampClock,
    timingRevision,
    requestSchema: CAPTION_AGENT_REQUEST_SCHEMA,
    responseSchema: CAPTION_AGENT_RESPONSE_SCHEMA,
    qualityProfile: CAPTION_QUALITY_PROFILE_ID,
    harnessFingerprint: CAPTION_HARNESS_FINGERPRINT,
    cueDurationPolicy
  });
  return {
    provider,
    sttModel,
    transcriptionMode,
    fingerprint: `caption-pipeline-v3-${shortStableFingerprint(identitySource)}`
  };
}

export function captionAgentCapabilityReady(capability: unknown): boolean {
  if (!isPlainObject(capability)) {
    return false;
  }
  const configured = isPlainObject(capability.configured)
    ? capability.configured
    : {};
  const transcription = isPlainObject(capability.transcription)
    ? capability.transcription
    : {};
  return configured.localWhisperReady === true
    && transcription.ready === true;
}

export function captionAgentRunEstimate(clips: CaptionClip[] | unknown = [], {
  model = DEFAULT_CAPTION_AGENT_SETTINGS.model
}: { model?: CaptionModel } = {}): {
  clipCount: number;
  totalDurationMs: number;
  companionRequests: number;
  browserDrafts: number;
} {
  if (!Array.isArray(clips)) {
    throw new TypeError("자막 실행 예상량을 계산할 컷 배열이 필요합니다.");
  }
  const enabled = clips.filter((clip) => clip?.enabled !== false);
  const totalDurationMs = enabled.reduce((total, clip) => {
    const startMs = finiteNumber(clip?.sourceStartMs ?? clip?.startMs);
    const endMs = finiteNumber(clip?.sourceEndMs ?? clip?.endMs);
    return total + Math.max(0, Math.round(endMs - startMs));
  }, 0);
  return {
    clipCount: enabled.length,
    totalDurationMs,
    companionRequests: model === LOCAL_WHISPER_CAPTION_MODEL
      ? enabled.length
      : 0,
    browserDrafts: model === LOCAL_AUDSEG_CAPTION_MODEL
      ? enabled.length
      : 0
  };
}

export function captionAgentEditorialContextFingerprint(
  project: Record<string, unknown>
): string {
  return captionEditorialContextFingerprint(
    buildProjectCaptionEditorialContext(project, {
      includeUnreviewedSpeakers: false
    })
  );
}

function captionCheckpointKey({
  clipId,
  sourceStartMs,
  sourceEndMs,
  model,
  qualityProfile,
  harnessFingerprint,
  editorialContextFingerprint,
  pipelineFingerprint
}: Partial<CaptionCheckpoint>): string {
  return [
    String(clipId || ""),
    Math.round(finiteNumber(sourceStartMs, -1)),
    Math.round(finiteNumber(sourceEndMs, -1)),
    String(model || ""),
    String(qualityProfile || "legacy-unharnessed-v0"),
    String(harnessFingerprint || "legacy-harness-fingerprint-v0"),
    String(editorialContextFingerprint || "legacy-context-v0"),
    String(pipelineFingerprint || LEGACY_CAPTION_PIPELINE_FINGERPRINT)
  ].join("\u0000");
}

export function createCaptionAgentCheckpoint(
  clip: CaptionClip,
  model: CaptionModel,
  {
    requestId = "",
    completedAt = new Date().toISOString(),
    editorialContextFingerprint = "legacy-context-v0",
    pipelineFingerprint = REQUIRED_CAPTION_PIPELINE_FINGERPRINT
  }: {
    requestId?: string;
    completedAt?: string;
    editorialContextFingerprint?: string;
    pipelineFingerprint?: string;
  } = {}
): CaptionCheckpoint {
  if (!isCaptionModel(model)) {
    throw new Error("자막 재개 체크포인트의 초벌 모델이 올바르지 않습니다.");
  }
  const normalizedModel = model;
  const checkpoint = {
    clipId: String(clip?.id || ""),
    sourceStartMs: Math.round(finiteNumber(clip?.sourceStartMs, -1)),
    sourceEndMs: Math.round(finiteNumber(clip?.sourceEndMs, -1)),
    model: normalizedModel,
    qualityProfile: CAPTION_QUALITY_PROFILE_ID,
    harnessFingerprint: CAPTION_HARNESS_FINGERPRINT,
    editorialContextFingerprint: String(
      editorialContextFingerprint || "legacy-context-v0"
    ).trim().slice(0, 128),
    pipelineFingerprint: String(
      pipelineFingerprint || REQUIRED_CAPTION_PIPELINE_FINGERPRINT
    ).trim().slice(0, 128),
    requestId: String(requestId || "").trim().slice(0, 128),
    completedAt: String(completedAt || "").trim().slice(0, 64)
  };
  if (
    !checkpoint.clipId
    || checkpoint.sourceStartMs < 0
    || checkpoint.sourceEndMs <= checkpoint.sourceStartMs
    || !checkpoint.pipelineFingerprint
  ) {
    throw new Error("자막 재개 체크포인트용 컷 범위가 올바르지 않습니다.");
  }
  return checkpoint;
}

export function upsertCaptionAgentCheckpoint(
  checkpoints: CaptionCheckpoint[] | unknown,
  checkpoint: CaptionCheckpoint,
  { maximum = MAX_CAPTION_AGENT_CLIPS_PER_RUN }: {
    maximum?: number;
  } = {}
): CaptionCheckpoint[] {
  const source = Array.isArray(checkpoints) ? checkpoints : [];
  const targetKey = captionCheckpointKey(checkpoint);
  return [
    ...source.filter(
      (candidate) => captionCheckpointKey(candidate) !== targetKey
    ),
    checkpoint
  ].slice(-Math.max(1, Math.round(finiteNumber(maximum, 1))));
}

export function discardCaptionAgentCheckpointsForClips(
  checkpoints: CaptionCheckpoint[] | unknown,
  clips: CaptionClip[] | unknown
): CaptionCheckpoint[] {
  const clipIds = new Set(
    (Array.isArray(clips) ? clips : [])
      .map((clip) => String(clip?.id || ""))
      .filter(Boolean)
  );
  if (clipIds.size === 0) {
    return Array.isArray(checkpoints) ? [...checkpoints] : [];
  }
  return (Array.isArray(checkpoints) ? checkpoints : []).filter(
    (checkpoint) => !clipIds.has(String(checkpoint?.clipId || ""))
  );
}

export function sameCaptionMediaIdentity(left: unknown, right: unknown): boolean {
  if (!isPlainObject(left) || !isPlainObject(right)) {
    return false;
  }
  for (const field of ["size", "lastModified", "durationMs"]) {
    if (
      !Number.isFinite(Number(left[field]))
      || !Number.isFinite(Number(right[field]))
    ) {
      return false;
    }
  }
  const fields = [
    "name",
    "size",
    "lastModified",
    "durationMs",
    "mediaOriginMs",
    "width",
    "height",
    "codec",
    "audioCodec"
  ];
  return fields.every(
    (field) => String(left[field] ?? "") === String(right[field] ?? "")
  );
}

export function captionAgentResumePlan(
  clips: CaptionClip[] | unknown,
  checkpoints: CaptionCheckpoint[] | unknown,
  model: CaptionModel,
  {
    resume = false,
    editorialContextFingerprint = "legacy-context-v0",
    pipelineFingerprint = REQUIRED_CAPTION_PIPELINE_FINGERPRINT
  }: {
    resume?: boolean;
    editorialContextFingerprint?: string;
    pipelineFingerprint?: string;
  } = {}
): { clips: CaptionClip[]; skippedClipIds: string[] } {
  const enabled = (Array.isArray(clips) ? clips : []).filter(
    (clip) => clip?.enabled !== false
  );
  if (!resume) {
    return {
      clips: enabled,
      skippedClipIds: []
    };
  }
  const completedKeys = new Set(
    (Array.isArray(checkpoints) ? checkpoints : [])
      .map((checkpoint) => captionCheckpointKey(checkpoint))
  );
  const skippedClipIds: string[] = [];
  const pending = enabled.filter((clip) => {
    const completed = completedKeys.has(captionCheckpointKey({
      clipId: clip.id,
      sourceStartMs: clip.sourceStartMs,
      sourceEndMs: clip.sourceEndMs,
      model,
      qualityProfile: CAPTION_QUALITY_PROFILE_ID,
      harnessFingerprint: CAPTION_HARNESS_FINGERPRINT,
      editorialContextFingerprint,
      pipelineFingerprint
    }));
    if (completed) {
      skippedClipIds.push(String(clip.id));
    }
    return !completed;
  });
  return {
    clips: pending,
    skippedClipIds
  };
}

export function captionAgentAudioFootprint(durationMs: unknown): {
  durationMs: number;
  sampleCount: number;
  floatPcmBytes: number;
  wavBytes: number;
  base64Bytes: number;
} {
  const duration = Math.round(finiteNumber(durationMs));
  if (duration <= 0 || duration > MAX_CAPTION_AGENT_CLIP_DURATION_MS) {
    throw new RangeError("자동 자막은 한 컷당 30분 이하만 처리할 수 있습니다.");
  }
  const sampleCount = Math.ceil(
    duration * CAPTION_AGENT_SAMPLE_RATE_HZ / 1_000
  );
  const floatPcmBytes = sampleCount * Float32Array.BYTES_PER_ELEMENT;
  const wavBytes = 44 + sampleCount * Int16Array.BYTES_PER_ELEMENT;
  if (wavBytes > MAX_CAPTION_AGENT_WAV_BYTES) {
    throw new RangeError("자동 자막용 WAV가 64MiB 상한을 넘습니다.");
  }
  return {
    durationMs: duration,
    sampleCount,
    floatPcmBytes,
    wavBytes,
    base64Bytes: 4 * Math.ceil(wavBytes / 3)
  };
}

export function encodePcm16WavBase64(
  audio: Float32Array,
  sampleRateHz: number = CAPTION_AGENT_SAMPLE_RATE_HZ
): string {
  if (!(audio instanceof Float32Array)) {
    throw new TypeError("16kHz Float32 PCM 오디오가 필요합니다.");
  }
  const sampleRate = Math.round(finiteNumber(sampleRateHz));
  if (sampleRate !== CAPTION_AGENT_SAMPLE_RATE_HZ) {
    throw new RangeError("자동 자막은 16kHz PCM 오디오만 처리할 수 있습니다.");
  }
  const wavByteLength = 44 + audio.length * 2;
  if (wavByteLength > MAX_CAPTION_AGENT_WAV_BYTES) {
    throw new RangeError("자동 자막용 WAV가 64MiB 상한을 넘습니다.");
  }
  const bytes = new Uint8Array(wavByteLength);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      bytes[offset + index] = text.charCodeAt(index);
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, audio.length * 2, true);
  for (let index = 0; index < audio.length; index += 1) {
    const sample = clamp(finiteNumber(audio[index]), -1, 1);
    view.setInt16(
      44 + index * 2,
      Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff),
      true
    );
  }

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const packed = (first << 16) | ((second || 0) << 8) | (third || 0);
    output += alphabet[(packed >>> 18) & 63];
    output += alphabet[(packed >>> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(packed >>> 6) & 63] : "=";
    output += index + 2 < bytes.length ? alphabet[packed & 63] : "=";
  }
  return output;
}

export function createCaptionAgentRequest({
  project,
  clip,
  model,
  audioBase64
}: {
  project: Record<string, unknown>;
  clip: CaptionClip;
  model: CaptionModel;
  audioBase64: string;
}): CaptionAgentRequest {
  const durationMs = Math.max(0, Math.round(
    finiteNumber(clip?.sourceEndMs) - finiteNumber(clip?.sourceStartMs)
  ));
  if (!clip?.id || durationMs <= 0) {
    throw new Error("자막을 만들 컷 구간이 올바르지 않습니다.");
  }
  captionAgentAudioFootprint(durationMs);
  if (model !== LOCAL_WHISPER_CAPTION_MODEL) {
    throw new Error(
      "Kirinuki 내부 자막 엔진 요청은 Whisper 초벌에서만 사용합니다. AudSeg는 브라우저에서 직접 실행합니다."
    );
  }
  if (!audioBase64) {
    throw new Error("에이전트에 보낼 음성이 비어 있습니다.");
  }
  const editorialContext = buildProjectCaptionEditorialContext(project);
  const projectSource = isPlainObject(project.source)
    ? project.source
    : {};
  return {
    schema: CAPTION_AGENT_REQUEST_SCHEMA,
    requestId: globalThis.crypto.randomUUID(),
    model,
    locale: "ko-KR",
    clip: {
      id: clip.id,
      title: String(clip.note ?? clip.title ?? "").slice(0, 1_000),
      durationMs
    },
    source: {
      projectId: String(project?.id || ""),
      projectName: String(project?.name || ""),
      streamerName: String(projectSource.streamerName || "")
    },
    editorialContext,
    policy: {
      audience: "korean-vtuber-kirinuki",
      includeAllRecognizableSpeech: true,
      uncertainSpeech: "keep-and-mark-for-review",
      cueDurationPolicy: REQUIRED_WHISPER_CUE_DURATION_POLICY,
      terminalPeriod: "omit",
      questionAndExclamationMarks: "keep"
    },
    audio: {
      encoding: "base64",
      mimeType: "audio/wav",
      sampleRateHz: CAPTION_AGENT_SAMPLE_RATE_HZ,
      channels: 1,
      data: audioBase64
    }
  };
}

function stripTerminalPeriod(text: unknown): string {
  return String(text || "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.\u3002\uff0e]+(?=(?:["'”’)\]}\u3009\u300b\u300d\u300f\u3011]*)$)/gu, "")
    .trim();
}

function normalizedColor(value: unknown): string | undefined {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/iu.test(color) ? color.toLowerCase() : undefined;
}

function normalizedRemoteMeta(
  raw: JsonRecord
): NormalizedCaptionCue["remoteMeta"] {
  const rawQuality = isPlainObject(raw.quality) ? raw.quality : null;
  const qualityCodes = Array.isArray(rawQuality?.codes)
    ? [...new Set((rawQuality.codes as unknown[])
      .map((code) => String(code || "").trim().slice(0, 128))
      .filter(Boolean))]
      .slice(0, 32)
    : [];
  const qualityStatus = rawQuality?.status === "review-required"
    ? "review-required"
    : "accepted";
  return {
    speakerId: String(raw?.speakerId ?? raw?.speaker_id ?? "unknown")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 80) || "unknown",
    reviewRequired: (
      Boolean(raw?.reviewRequired ?? raw?.review_required)
      || qualityStatus === "review-required"
    ),
    placement: AUTOMATIC_CAPTION_PLACEMENT,
    ...(isPlainObject(rawQuality)
      ? { qualityStatus, qualityCodes }
      : {})
  };
}

export function normalizeCaptionAgentCues(
  cues: unknown,
  clipDurationMs: unknown
): NormalizedCaptionCue[] {
  const durationMs = Math.max(0, Math.round(finiteNumber(clipDurationMs)));
  if (!Array.isArray(cues)) {
    throw new Error("자막 에이전트 응답에 cues 배열이 없습니다.");
  }
  if (cues.length > MAX_REMOTE_CUES) {
    throw new Error(`자막 에이전트 응답이 ${MAX_REMOTE_CUES}개 cue 상한을 넘었습니다.`);
  }
  const normalized = cues.map((value, index) => {
    const raw = isPlainObject(value) ? value : {};
    const text = stripTerminalPeriod(raw.text);
    const rawStartMs = Number(raw.startMs ?? raw.start_ms);
    const rawEndMs = Number(raw.endMs ?? raw.end_ms);
    if (!text) {
      throw new Error(`${index + 1}번째 원격 자막의 텍스트가 비어 있습니다.`);
    }
    if (
      !Number.isFinite(rawStartMs) ||
      !Number.isFinite(rawEndMs) ||
      rawStartMs < 0 ||
      rawEndMs > durationMs ||
      rawEndMs - rawStartMs < 100
    ) {
      throw new Error(`${index + 1}번째 원격 자막의 시간 범위가 올바르지 않습니다.`);
    }
    const startOffsetMs = Math.round(rawStartMs);
    const endOffsetMs = Math.round(rawEndMs);
    const color = normalizedColor(raw.color);
    return {
      startOffsetMs,
      endOffsetMs,
      text,
      y: AUTOMATIC_CAPTION_Y,
      ...(color ? { color } : {}),
      remoteMeta: normalizedRemoteMeta(raw)
    };
  }).sort((left, right) => (
    left.startOffsetMs - right.startOffsetMs ||
    left.endOffsetMs - right.endOffsetMs
  ));

  return normalized;
}

async function readResponseTextLimited(
  response: Response,
  maxBytes: number = MAX_CAPTION_AGENT_RESPONSE_BYTES
): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("자막 에이전트 응답 본문이 너무 큽니다.");
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error("자막 에이전트 응답 본문이 너무 큽니다.");
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error("자막 에이전트 응답 본문이 너무 큽니다.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function parseResponse(response: Response): Promise<JsonRecord> {
  const text = await readResponseTextLimited(response);
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      if (response.ok) {
        throw new Error("자막 에이전트가 JSON이 아닌 응답을 보냈습니다.");
      }
    }
  }
  if (!response.ok) {
    const errorPayload = isPlainObject(payload) && isPlainObject(payload.error)
      ? payload.error
      : {};
    const remoteCode = String(errorPayload.code || "");
    const code = /^[A-Z][A-Z0-9_]{0,63}$/u.test(remoteCode)
      ? remoteCode
      : "CAPTION_AGENT_REQUEST_FAILED";
    throw new CaptionAgentHttpError(
      `자막 에이전트 요청 실패 (${response.status}, ${code})`,
      response.status,
      code
    );
  }
  return isPlainObject(payload) ? payload : {};
}

function abortableDelay(
  milliseconds: number,
  signal?: AbortSignal
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error
        ? signal.reason
        : new DOMException("작업이 취소되었습니다.", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("작업이 취소되었습니다.", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("작업이 취소되었습니다.", "AbortError");
}

function createDeadlineSignal(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; cleanup(): void } {
  const normalizedTimeoutMs = Number(timeoutMs);
  if (!Number.isFinite(normalizedTimeoutMs) || normalizedTimeoutMs <= 0) {
    throw new RangeError("자막 에이전트 요청 제한 시간이 올바르지 않습니다.");
  }
  const controller = new AbortController();
  const onParentAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort(
        parentSignal?.reason instanceof Error
          ? parentSignal.reason
          : new DOMException("작업이 취소되었습니다.", "AbortError")
      );
    }
  };
  if (parentSignal?.aborted) {
    onParentAbort();
  } else {
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  }
  const timeout = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(
        new DOMException("자막 에이전트 요청 제한 시간을 넘었습니다.", "TimeoutError")
      );
    }
  }, Math.floor(normalizedTimeoutMs));
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", onParentAbort);
    }
  };
}

function isPlainObject(value: unknown): value is JsonRecord {
  return Boolean(
    value
    && typeof value === "object"
    &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function requiredResponseString(
  payload: JsonRecord,
  field: string
): string {
  const value = payload[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`자막 에이전트 응답의 ${field} 필드가 올바르지 않습니다.`);
  }
  return value;
}

function assertExactResponseFields(
  value: JsonRecord,
  allowedFields: readonly string[],
  label: string
): void {
  const unknownFields = Object.keys(value).filter(
    (field) => !allowedFields.includes(field)
  );
  if (unknownFields.length > 0) {
    throw new Error(
      `${label}에 지원하지 않는 필드가 있습니다: ${unknownFields.join(", ")}`
    );
  }
}

function validateRemoteCueQuality(quality: unknown, index: number): void {
  if (
    !isPlainObject(quality)
    || typeof quality.status !== "string"
    || !["accepted", "review-required"].includes(quality.status)
    || !Array.isArray(quality.codes)
    || quality.codes.length > 32
    || quality.codes.some((code) => (
      typeof code !== "string"
      || !code.trim()
      || code.length > 128
    ))
  ) {
    throw new Error(`${index + 1}번째 자막 품질 검수 정보가 올바르지 않습니다.`);
  }
  assertExactResponseFields(
    quality,
    ["status", "codes"],
    `${index + 1}번째 자막 품질 검수 정보`
  );
}

function validateRemoteQualityReport(
  report: unknown,
  cues: readonly unknown[]
): void {
  if (
    !isPlainObject(report)
    || report.profileId !== CAPTION_QUALITY_PROFILE_ID
    || report.harnessFingerprint !== CAPTION_HARNESS_FINGERPRINT
    || typeof report.valid !== "boolean"
    || typeof report.disposition !== "string"
    || !["accepted", "review-required"].includes(report.disposition)
    || !Array.isArray(report.violations)
    || report.violations.length > MAX_REMOTE_WARNINGS
    || !Array.isArray(report.cueReviews)
    || report.cueReviews.length !== cues.length
    || !isPlainObject(report.metrics)
  ) {
    throw new Error("자막 에이전트 응답의 품질 보고서가 올바르지 않습니다.");
  }
  assertExactResponseFields(report, [
    "profileId",
    "harnessFingerprint",
    "valid",
    "disposition",
    "violations",
    "cueReviews",
    "metrics"
  ], "자막 에이전트 품질 보고서");
  for (const [index, violation] of report.violations.entries()) {
    if (
      !isPlainObject(violation)
      || typeof violation.code !== "string"
      || !violation.code.trim()
      || violation.code.length > 128
      || typeof violation.cueIndex !== "number"
      || !Number.isInteger(violation.cueIndex)
      || violation.cueIndex < 0
      || typeof violation.severity !== "string"
      || !["error", "warning"].includes(violation.severity)
    ) {
      throw new Error(`${index + 1}번째 품질 위반 정보가 올바르지 않습니다.`);
    }
    assertExactResponseFields(
      violation,
      ["code", "cueIndex", "severity"],
      `${index + 1}번째 품질 위반 정보`
    );
  }
  for (const [index, review] of report.cueReviews.entries()) {
    if (
      !isPlainObject(review)
      || review.cueIndex !== index
      || typeof review.status !== "string"
      || !["accepted", "review-required"].includes(review.status)
      || !Array.isArray(review.codes)
      || review.codes.length > 32
      || review.codes.some((code) => (
        typeof code !== "string"
        || !code.trim()
        || code.length > 128
      ))
      || !isPlainObject(review.metrics)
    ) {
      throw new Error(`${index + 1}번째 cue 품질 보고서가 올바르지 않습니다.`);
    }
    assertExactResponseFields(
      review,
      ["cueIndex", "status", "codes", "metrics"],
      `${index + 1}번째 cue 품질 보고서`
    );
  }
}

function validateCompletedCaptionAgentResponse(
  payload: JsonRecord,
  request: CaptionAgentRequest
): JsonRecord {
  if (!isPlainObject(payload)) {
    throw new Error("자막 에이전트 완료 응답이 JSON 객체가 아닙니다.");
  }
  assertExactResponseFields(payload, [
    "schema",
    "requestId",
    "clipId",
    "language",
    "sttModel",
    "captionModel",
    "model",
    "resolvedModel",
    "provider",
    "status",
    "cues",
    "warnings",
    "qualityProfile",
    "harnessFingerprint",
    "editorialContextFingerprint",
    "qualityReport"
  ], "자막 에이전트 완료 응답");
  if (payload.schema !== CAPTION_AGENT_RESPONSE_SCHEMA) {
    throw new Error("자막 에이전트 응답 스키마 버전이 맞지 않습니다.");
  }
  if (payload.status !== "completed") {
    throw new Error("자막 에이전트 완료 응답의 status가 올바르지 않습니다.");
  }

  const requestId = requiredResponseString(payload, "requestId");
  const clipId = requiredResponseString(payload, "clipId");
  if (requestId.length > 128 || clipId.length > 256) {
    throw new Error("자막 에이전트 응답 식별자가 허용 길이를 넘었습니다.");
  }
  if (requestId !== String(request?.requestId || "")) {
    throw new Error("자막 에이전트 응답의 요청 ID가 현재 요청과 다릅니다.");
  }
  if (clipId !== String(request?.clip?.id || "")) {
    throw new Error("자막 에이전트 응답의 컷 ID가 요청과 다릅니다.");
  }
  if (payload.language !== "ko") {
    throw new Error("자막 에이전트 응답 언어가 한국어가 아닙니다.");
  }
  for (const field of [
    "sttModel",
    "captionModel",
    "model",
    "resolvedModel",
    "provider"
  ]) {
    requiredResponseString(payload, field);
  }
  if (payload.provider !== "local-whispercpp") {
    throw new Error("자막 에이전트 응답 제공자가 올바르지 않습니다.");
  }
  const requestedModel = String(request?.model || "");
  if (
    payload.captionModel !== requestedModel
    || payload.model !== requestedModel
  ) {
    throw new Error("자막 에이전트 응답 모델이 현재 요청과 다릅니다.");
  }
  if (
    requestedModel !== LOCAL_WHISPER_CAPTION_MODEL
    || payload.provider !== "local-whispercpp"
  ) {
    throw new Error("자막 에이전트 응답 제공자가 선택한 초벌 방식과 다릅니다.");
  }
  if (!Array.isArray(payload.cues) || payload.cues.length > MAX_REMOTE_CUES) {
    throw new Error("자막 에이전트 응답의 cues 필드가 올바르지 않습니다.");
  }
  const clipDurationMs = Number(request?.clip?.durationMs);
  for (const [index, cue] of payload.cues.entries()) {
    if (
      !isPlainObject(cue) ||
      typeof cue.startMs !== "number" ||
      typeof cue.endMs !== "number" ||
      !Number.isInteger(cue.startMs) ||
      !Number.isInteger(cue.endMs) ||
      cue.startMs < 0 ||
      cue.endMs <= cue.startMs ||
      cue.endMs > clipDurationMs ||
      typeof cue.text !== "string" ||
      !cue.text.trim() ||
      cue.text.length > 300 ||
      typeof cue.speakerId !== "string" ||
      !cue.speakerId.trim() ||
      cue.speakerId.length > 80 ||
      typeof cue.reviewRequired !== "boolean" ||
      typeof cue.placement !== "string" ||
      !["top", "center", "bottom"].includes(cue.placement) ||
      (cue.quality != null && !isPlainObject(cue.quality))
    ) {
      throw new Error(`${index + 1}번째 자막 에이전트 응답 cue가 올바르지 않습니다.`);
    }
    assertExactResponseFields(cue, [
      "startMs",
      "endMs",
      "text",
      "speakerId",
      "reviewRequired",
      "placement",
      "quality"
    ], `${index + 1}번째 자막 에이전트 응답 cue`);
    if (cue.quality != null) {
      validateRemoteCueQuality(cue.quality, index);
    }
  }
  if (
    !Array.isArray(payload.warnings)
    || payload.warnings.length > MAX_REMOTE_WARNINGS
  ) {
    throw new Error("자막 에이전트 응답의 warnings 필드가 올바르지 않습니다.");
  }
  for (const [index, warning] of payload.warnings.entries()) {
    if (
      !isPlainObject(warning) ||
      typeof warning.code !== "string" ||
      !warning.code.trim() ||
      warning.code.length > 128 ||
      typeof warning.cueIndex !== "number" ||
      !Number.isInteger(warning.cueIndex) ||
      warning.cueIndex < 0
    ) {
      throw new Error(`${index + 1}번째 자막 에이전트 응답 warning이 올바르지 않습니다.`);
    }
    assertExactResponseFields(
      warning,
      ["code", "cueIndex"],
      `${index + 1}번째 자막 에이전트 응답 warning`
    );
  }
  const expectedEditorialContextFingerprint =
    captionEditorialContextFingerprint(request?.editorialContext);
  if (
    payload.qualityProfile !== CAPTION_QUALITY_PROFILE_ID
    || payload.harnessFingerprint !== CAPTION_HARNESS_FINGERPRINT
    || payload.editorialContextFingerprint
      !== expectedEditorialContextFingerprint
  ) {
    throw new Error("자막 에이전트 품질 하네스 지문이 현재 요청과 다릅니다.");
  }
  validateRemoteQualityReport(payload.qualityReport, payload.cues);
  return payload;
}

function assertSafeStatusUrl(statusUrl: unknown, endpoint: string): string {
  const status = new URL(String(statusUrl), endpoint);
  const requested = new URL(endpoint);
  if (status.username || status.password || status.hash) {
    throw new Error("자막 에이전트 작업 상태 주소에 인증 정보나 # 조각을 넣을 수 없습니다.");
  }
  if (status.origin !== requested.origin) {
    throw new Error("자막 에이전트가 다른 출처의 작업 상태 주소를 반환했습니다.");
  }
  return status.toString();
}

export async function pairCaptionAgent({
  endpoint,
  purpose: requestedPurpose,
  projectId,
  sourceUrl,
  signal,
  fetchImpl = fetch,
  timeoutMs = CAPTION_AGENT_PROBE_TIMEOUT_MS,
  trustStore = localMediaEngineTrustStore
}: CaptionAgentConnectionOptions): Promise<string> {
  const sessionEndpoint = captionAgentSessionEndpoint(endpoint);
  if (new URL(sessionEndpoint).origin !== "http://127.0.0.1:4319") {
    throw new Error("인증된 Kirinuki 엔진 세션은 고정된 127.0.0.1:4319에서만 발급할 수 있습니다.");
  }
  await probeLocalMediaEngine(signal, fetchImpl, timeoutMs, trustStore);
  const authenticatedEngine = currentAuthenticatedLocalMediaEngine();
  if (!authenticatedEngine) {
    throw new Error("서명된 Kirinuki 엔진 health 확인이 만료됐습니다.");
  }
  const normalizedProjectId = normalizeLocalEngineProjectId(projectId);
  const normalizedSourceUrl = normalizeLocalEngineSourceUrl(sourceUrl);
  const purpose = normalizeLocalEngineSessionPurpose(
    requestedPurpose,
    normalizedSourceUrl
  );
  const clientNonce = freshLocalEngineDocumentNonce();
  const challenge = freshLocalMediaEngineChallenge();
  const sessionRequest = {
    schema: LOCAL_ENGINE_SESSION_REQUEST_SCHEMA,
    clientNonce,
    projectId: normalizedProjectId,
    actions: purpose === "captions"
      ? ["captions"]
      : ["vod", "cache-delete"],
    ...(normalizedSourceUrl === undefined
      ? {}
      : { sourceUrl: normalizedSourceUrl })
  };
  const encryptedSession = await prepareLocalMediaEngineSessionRequest({
    offer: authenticatedEngine.sessionEncryption,
    responseChallenge: challenge,
    plaintext: JSON.stringify(sessionRequest)
  });
  throwIfAborted(signal);
  const deadline = createDeadlineSignal(signal, timeoutMs);
  let transportEstablished = false;
  try {
    const response = await fetchImpl(
      sessionEndpoint,
      localMediaEngineLoopbackRequestInit({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Kirinuki-Client-Nonce": clientNonce,
        "X-Kirinuki-Protocol": LOCAL_ENGINE_SESSION_REQUEST_SCHEMA,
        [LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER]: challenge
      },
      body: JSON.stringify(encryptedSession.request),
      signal: deadline.signal,
      cache: "no-store",
      credentials: "omit",
      redirect: "error"
      })
    );
    const encryptedPayload = await parseResponse(response);
    let decryptedPayload: unknown;
    try {
      decryptedPayload = JSON.parse(await decryptLocalMediaEngineSessionResponse({
        sharedKey: encryptedSession.sharedKey,
        request: encryptedSession.request,
        responseChallenge: challenge,
        response: encryptedPayload
      }));
    } catch {
      throw new Error(
        "Kirinuki 내부 자막 엔진의 암호화된 연결 응답 인증에 실패했습니다."
      );
    }
    const payload = decryptedPayload;
    if (!isPlainObject(payload)) {
      throw new Error("Kirinuki 내부 자막 엔진의 연결 응답이 올바르지 않습니다.");
    }
    assertExactResponseFields(payload, [
      "schema",
      "authentication",
      "expiresAt",
      "token",
      "deviceProof"
    ], "Kirinuki 내부 자막 엔진 연결 응답");
    const sessionPayload = {
      schema: payload.schema,
      authentication: payload.authentication,
      expiresAt: payload.expiresAt,
      token: payload.token
    };
    const proof = parseLocalMediaEngineDeviceProof(payload.deviceProof);
    const proofValid = proof !== null
      && proof.keyId === authenticatedEngine.keyId
      && proof.challenge === challenge
      && proof.instanceNonce === authenticatedEngine.instanceNonce
      && await verifyLocalMediaEngineSignature({
        publicKeySpki: authenticatedEngine.publicKeySpki,
        signature: proof.signature,
        transcript: localMediaEngineProofTranscript({
          kind: "session",
          challenge,
          instanceNonce: proof.instanceNonce,
          requestBinding: JSON.stringify(sessionRequest),
          payload: sessionPayload
        })
      });
    if (!proofValid) {
      throw new Error("Kirinuki 내부 자막 엔진 세션의 설치 identity 서명이 올바르지 않습니다.");
    }
    const expiresAtMs = Date.parse(String(payload.expiresAt || ""));
    if (
      payload.schema !== CAPTION_AGENT_SESSION_SCHEMA
      || payload.authentication !== LOCAL_ENGINE_SESSION_AUTHENTICATION
      || !Number.isFinite(expiresAtMs)
      || expiresAtMs <= Date.now()
    ) {
      throw new Error("Kirinuki 내부 자막 엔진의 연결 응답 버전이 맞지 않습니다.");
    }
    const token = normalizeSessionToken(payload.token);
    if (!token) {
      throw new Error("Kirinuki 내부 자막 엔진이 연결 정보를 반환하지 않았습니다.");
    }
    activeLocalEngineDocumentSession = {
      token,
      clientNonce,
      purpose,
      projectId: normalizedProjectId,
      ...(normalizedSourceUrl === undefined
        ? {}
        : { sourceUrl: normalizedSourceUrl }),
      expiresAtMs
    };
    await establishLocalMediaEngineTransport({
      transportId: encryptedSession.request.grantId,
      clientNonce,
      sharedKey: encryptedSession.sharedKey
    });
    transportEstablished = true;
    return token;
  } finally {
    encryptedSession.sharedKey.fill(0);
    if (!transportEstablished) {
      forgetLocalMediaEngineTransport();
    }
    deadline.cleanup();
  }
}

export async function requestCaptionAgent({
  endpoint,
  token,
  request,
  signal,
  fetchImpl = fetch,
  onProgress = () => {},
  timeoutMs = CAPTION_AGENT_REQUEST_TIMEOUT_MS,
  maxPollAttempts = MAX_CAPTION_AGENT_POLL_ATTEMPTS
}: CaptionAgentRequestOptions): Promise<JsonRecord> {
  const normalizedEndpoint = normalizeCaptionAgentEndpoint(endpoint);
  if (
    isLoopbackCaptionAgentEndpoint(normalizedEndpoint)
    && !currentAuthenticatedLocalMediaEngine()
  ) {
    throw new Error("서명된 Kirinuki 엔진 health 확인 전에 프로젝트 자막 데이터를 보낼 수 없습니다.");
  }
  throwIfAborted(signal);
  const normalizedMaxPollAttempts = Number(maxPollAttempts);
  if (
    !Number.isInteger(normalizedMaxPollAttempts) ||
    normalizedMaxPollAttempts < 1
  ) {
    throw new RangeError("자막 에이전트 폴링 횟수 상한이 올바르지 않습니다.");
  }
  const deadline = createDeadlineSignal(signal, timeoutMs);
  const requestSignal = deadline.signal;
  try {
    throwIfAborted(requestSignal);
    const headers = {
      "Content-Type": "application/json",
      "X-Kirinuki-Protocol": CAPTION_AGENT_REQUEST_SCHEMA,
      ...captionAgentRequestHeaders(token)
    };
    onProgress(0.08, "자막 엔진에 선택 구간 음성을 보내는 중");
    throwIfAborted(requestSignal);
    let response = await localMediaEngineTransportFetch(normalizedEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal: requestSignal,
      cache: "no-store",
      credentials: "omit",
      redirect: "error"
    }, fetchImpl);
    let payload = await parseResponse(response);
    let statusUrl = payload.statusUrl
      ? assertSafeStatusUrl(payload.statusUrl, normalizedEndpoint)
      : null;
    let pollCount = 0;
    while (
      response.status === 202 ||
      (
        typeof payload.status === "string"
        && ["queued", "transcribing", "captioning", "running"]
          .includes(payload.status)
      )
    ) {
      if (!statusUrl) {
        throw new Error("비동기 자막 작업에 상태 확인 주소가 없습니다.");
      }
      if (pollCount >= normalizedMaxPollAttempts) {
        throw new Error("자막 에이전트 상태 확인 횟수 상한을 넘었습니다.");
      }
      pollCount += 1;
      onProgress(
        clamp(finiteNumber(payload.progress, 0.15 + pollCount * 0.025), 0.12, 0.92),
        String(payload.message || "음성인식과 자막 초벌 정리 중")
      );
      await abortableDelay(
        clamp(finiteNumber(payload.retryAfterMs, 1_200), 300, 10_000),
        requestSignal
      );
      throwIfAborted(requestSignal);
      response = await localMediaEngineTransportFetch(statusUrl, {
        method: "POST",
        headers: {
          "X-Kirinuki-Protocol": CAPTION_AGENT_REQUEST_SCHEMA,
          ...captionAgentRequestHeaders(token)
        },
        signal: requestSignal,
        cache: "no-store",
        credentials: "omit",
        redirect: "error"
      }, fetchImpl);
      payload = await parseResponse(response);
      statusUrl = payload.statusUrl
        ? assertSafeStatusUrl(payload.statusUrl, normalizedEndpoint)
        : statusUrl;
    }
    throwIfAborted(requestSignal);
    validateCompletedCaptionAgentResponse(payload, request);
    onProgress(
      1,
      "로컬 Whisper 자막 초안 수신 완료"
    );
    return payload;
  } finally {
    deadline.cleanup();
  }
}

export async function probeCaptionAgent({
  endpoint,
  token,
  signal,
  fetchImpl = fetch,
  timeoutMs = CAPTION_AGENT_PROBE_TIMEOUT_MS
}: CaptionAgentProbeOptions): Promise<JsonRecord> {
  const normalizedEndpoint = normalizeCaptionAgentEndpoint(endpoint);
  if (
    isLoopbackCaptionAgentEndpoint(normalizedEndpoint)
    && !currentAuthenticatedLocalMediaEngine()
  ) {
    throw new Error("서명된 Kirinuki 엔진 health 확인 전에 capability를 보낼 수 없습니다.");
  }
  throwIfAborted(signal);
  const deadline = createDeadlineSignal(signal, timeoutMs);
  try {
    const headers = {
      "X-Kirinuki-Protocol": CAPTION_AGENT_REQUEST_SCHEMA,
      ...captionAgentRequestHeaders(token)
    };
    const response = await localMediaEngineTransportFetch(normalizedEndpoint, {
      method: "POST",
      headers,
      signal: deadline.signal,
      cache: "no-store",
      credentials: "omit",
      redirect: "error"
    }, fetchImpl);
    return parseResponse(response);
  } finally {
    deadline.cleanup();
  }
}

export async function probeLocalMediaEngineSession({
  endpoint,
  token,
  purpose = "captions",
  signal,
  fetchImpl = fetch,
  timeoutMs = CAPTION_AGENT_PROBE_TIMEOUT_MS
}: CaptionAgentProbeOptions): Promise<void> {
  if (!isLoopbackCaptionAgentEndpoint(endpoint)) {
    return;
  }
  if (purpose !== "vod" && purpose !== "captions") {
    throw new TypeError("확인할 로컬 엔진 session 목적이 올바르지 않습니다.");
  }
  const deadline = createDeadlineSignal(signal, timeoutMs);
  try {
    const sessionStatusEndpoint = new URL(
      captionAgentSessionEndpoint(endpoint)
    );
    sessionStatusEndpoint.pathname = "/v1/session/status";
    const response = await localMediaEngineTransportFetch(
      sessionStatusEndpoint,
      {
        method: "POST",
        headers: {
          "X-Kirinuki-Protocol": LOCAL_MEDIA_ENGINE_SESSION_STATUS_PROTOCOL,
          ...captionAgentRequestHeaders(token)
        },
        signal: deadline.signal,
        cache: "no-store",
        credentials: "omit",
        redirect: "error"
      },
      fetchImpl
    );
    const payload = await parseResponse(response);
    assertExactResponseFields(payload, [
      "schema",
      "status",
      "actions",
      "sourceBound",
      "expiresAt"
    ], "Kirinuki 내부 엔진 session status");
    const expectedActions = purpose === "vod"
      ? ["vod", "cache-delete"]
      : ["captions"];
    if (
      payload.schema !== LOCAL_MEDIA_ENGINE_SESSION_STATUS_SCHEMA
      || payload.status !== "active"
      || JSON.stringify(payload.actions) !== JSON.stringify(expectedActions)
      || payload.sourceBound !== (purpose === "vod")
      || !Number.isFinite(Date.parse(String(payload.expiresAt || "")))
      || Date.parse(String(payload.expiresAt || "")) <= Date.now()
    ) {
      throw new Error("Kirinuki 내부 엔진 session status 범위가 다릅니다.");
    }
  } finally {
    deadline.cleanup();
  }
}

export async function ensureCaptionAgentSession({
  endpoint,
  token,
  purpose: requestedPurpose,
  projectId,
  sourceUrl,
  signal,
  fetchImpl = fetch,
  timeoutMs = CAPTION_AGENT_PROBE_TIMEOUT_MS,
  trustStore = localMediaEngineTrustStore
}: CaptionAgentProbeOptions): Promise<string> {
  if (!isLoopbackCaptionAgentEndpoint(endpoint)) {
    return String(token || "").trim();
  }
  const normalizedProjectId = normalizeLocalEngineProjectId(projectId);
  const normalizedSourceUrl = normalizeLocalEngineSourceUrl(sourceUrl);
  const purpose = normalizeLocalEngineSessionPurpose(
    requestedPurpose,
    normalizedSourceUrl
  );
  const currentToken = String(token || "").trim()
    || matchingCachedLocalEngineToken(
      normalizedProjectId,
      purpose,
      normalizedSourceUrl
    );
  const activeSessionMatches = activeLocalEngineDocumentSession?.token
      === currentToken
    && activeLocalEngineDocumentSession.projectId === normalizedProjectId
    && activeLocalEngineDocumentSession.purpose === purpose
    && activeLocalEngineDocumentSession.sourceUrl === normalizedSourceUrl;
  if (currentToken && hasLocalMediaEngineTransport() && activeSessionMatches) {
    try {
      await probeLocalMediaEngineSession({
        endpoint,
        token: currentToken,
        purpose,
        ...(signal === undefined ? {} : { signal }),
        fetchImpl,
        timeoutMs
      });
      return currentToken;
    } catch (error) {
      const status = httpStatus(error);
      if (status !== 401 && (status !== 0 || signal?.aborted)) {
        throw error;
      }
      forgetLocalMediaEngineTransport();
      if (activeLocalEngineDocumentSession?.token === currentToken) {
        activeLocalEngineDocumentSession = null;
      }
    }
  }
  return pairCaptionAgent({
    endpoint,
    purpose,
    projectId: normalizedProjectId,
    ...(normalizedSourceUrl === undefined
      ? {}
      : { sourceUrl: normalizedSourceUrl }),
    ...(signal === undefined ? {} : { signal }),
    fetchImpl,
    timeoutMs,
    trustStore
  });
}

export async function requestCaptionAgentWithSessionRetry({
  onSessionToken = () => {},
  fetchImpl = fetch,
  ...options
}: CaptionAgentRequestOptions & {
  onSessionToken?: (token: string) => void;
}): Promise<JsonRecord> {
  try {
    return await requestCaptionAgent({
      ...options,
      fetchImpl
    });
  } catch (error) {
    if (
      httpStatus(error) !== 401
      || !isLoopbackCaptionAgentEndpoint(options.endpoint)
    ) {
      throw error;
    }
    if (activeLocalEngineDocumentSession?.token === options.token) {
      activeLocalEngineDocumentSession = null;
    }
    const projectId = normalizeLocalEngineProjectId(
      options.projectId ?? options.request.source.projectId
    );
    const token = await pairCaptionAgent({
      endpoint: options.endpoint,
      purpose: "captions",
      projectId,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      fetchImpl,
      ...(options.trustStore === undefined
        ? {}
        : { trustStore: options.trustStore })
    });
    onSessionToken(token);
    return requestCaptionAgent({
      ...options,
      token,
      fetchImpl
    });
  }
}
