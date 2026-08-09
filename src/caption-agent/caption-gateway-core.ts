import {
  LOCAL_WHISPER_CAPTION_MODEL,
  MAX_CAPTION_WARNINGS,
  SUPPORTED_CAPTION_MODELS,
  CaptionProtocolError,
  createCaptionAgentResponse,
  validateCaptionAgentRequest,
  type CaptionAgentRequest,
  type CaptionCue,
  type CaptionWarning
} from "./protocol.js";
import {
  CAPTION_HARNESS_FINGERPRINT,
  CAPTION_QUALITY_PROFILE_ID,
  canonicalTimedTranscript,
  repairCaptionDraft
} from "./caption-quality-harness.js";

export const DEFAULT_CAPTION_MODEL = LOCAL_WHISPER_CAPTION_MODEL;
export const LOCAL_WHISPERCPP_TRANSCRIPTION_MODE = "local-whispercpp";
export const DEFAULT_TRANSCRIPTION_MODE =
  LOCAL_WHISPERCPP_TRANSCRIPTION_MODE;
export const DEFAULT_STT_MODEL = "whisper-tiny";
export const DEFAULT_MAX_AUDIO_BYTES = 64 * 1024 * 1024;
export const DEFAULT_PIPELINE_TIMEOUT_MS = 45 * 60 * 1_000;
export const MAX_PIPELINE_TIMEOUT_MS = 60 * 60 * 1_000;
export const DEFAULT_STT_TIMEOUT_MS = DEFAULT_PIPELINE_TIMEOUT_MS;
export const MAX_LOCAL_RESPONSE_BYTES = 16 * 1024 * 1024;
export const MAX_STT_SEGMENTS = 10_000;
export const MAX_STT_WORDS = 50_000;
export const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024;
export const MAX_STT_ENDPOINT_LENGTH = 2_048;
export const MAX_STT_MODEL_LENGTH = 160;

type DynamicRecord = Record<string, unknown>;

export interface TranscriptUnit {
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
}

export interface SttTranscript {
  text: string;
  segments: TranscriptUnit[];
  words: TranscriptUnit[];
}

export interface CaptionPipelineConfig {
  transcriptionMode?: string;
  sttEndpoint?: string;
  sttModel?: string;
  maxAudioBytes?: number;
  pipelineTimeoutMs?: number;
}

interface TranscriptionOptions {
  fetchImpl?: typeof globalThis.fetch;
  sttEndpoint?: unknown;
  sttModel?: unknown;
  maxAudioBytes?: number;
  wavBytes?: Buffer;
  signal?: AbortSignal;
  timeoutMs?: number;
}

type AudioTranscriber = (
  request: CaptionAgentRequest,
  options: TranscriptionOptions
) => Promise<unknown>;

function boundedCaptionWarnings(
  ...groups: Array<readonly Partial<CaptionWarning>[] | null | undefined>
): CaptionWarning[] {
  const warnings: CaptionWarning[] = [];
  const seen = new Set<string>();
  let truncated = false;
  for (const warning of groups.flat()) {
    const code = String(warning?.code || "").trim().slice(0, 128);
    const cueIndex = Number(warning?.cueIndex);
    if (!code || !Number.isInteger(cueIndex) || cueIndex < 0) {
      continue;
    }
    const key = `${code}\u0000${cueIndex}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (warnings.length >= MAX_CAPTION_WARNINGS - 1) {
      truncated = true;
      break;
    }
    warnings.push({ code, cueIndex });
  }
  if (truncated) {
    warnings.push({ code: "TRIMMED_WARNING_COUNT", cueIndex: 0 });
  }
  return warnings;
}

export class CaptionGatewayError extends Error {
  code: string;
  httpStatus: number;

  constructor(message: string, {
    code = "CAPTION_GATEWAY_ERROR",
    httpStatus = 502
  }: { code?: string; httpStatus?: number } = {}) {
    super(message);
    this.name = "CaptionGatewayError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function requiredConfigurationValue(value: unknown, name: string, {
  required = true,
  httpStatus = 500
}: { required?: boolean; httpStatus?: number } = {}): string {
  const normalized = String(value || "").trim();
  if (!normalized && required) {
    throw new CaptionGatewayError(`${name} 설정이 필요합니다.`, {
      code: "MISSING_CONFIGURATION",
      httpStatus
    });
  }
  return normalized;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

function normalizeTranscriptionMode(
  value: unknown,
  { httpStatus = 500 }: { httpStatus?: number } = {}
): string {
  const normalized = String(
    value || DEFAULT_TRANSCRIPTION_MODE
  ).trim() || DEFAULT_TRANSCRIPTION_MODE;
  if (normalized !== LOCAL_WHISPERCPP_TRANSCRIPTION_MODE) {
    throw new CaptionGatewayError(
      "STT 모드는 local-whispercpp만 지원합니다.",
      {
        code: "UNSUPPORTED_TRANSCRIPTION_MODE",
        httpStatus
      }
    );
  }
  return normalized;
}

function localWhisperEndpoint(value: unknown, name: string, {
  required = true,
  httpStatus = 500
}: { required?: boolean; httpStatus?: number } = {}): string {
  const normalized = requiredConfigurationValue(value, name, {
    required,
    httpStatus
  });
  if (!normalized) {
    return "";
  }
  if (normalized.length > MAX_STT_ENDPOINT_LENGTH) {
    throw new CaptionGatewayError(`${name} URL이 너무 깁니다.`, {
      code: "INVALID_CONFIGURATION",
      httpStatus
    });
  }
  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw new CaptionGatewayError(`${name} URL이 올바르지 않습니다.`, {
      code: "INVALID_CONFIGURATION",
      httpStatus
    });
  }
  if (
    url.protocol !== "http:"
    || !isLoopbackHostname(url.hostname)
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new CaptionGatewayError(
      `${name}는 인증정보·쿼리·# 조각이 없는 loopback HTTP URL이어야 합니다.`,
      {
        code: "INVALID_CONFIGURATION",
        httpStatus
      }
    );
  }
  return url.href;
}

function sttModelName(value: unknown, {
  fallback = DEFAULT_STT_MODEL,
  httpStatus = 500
}: { fallback?: string; httpStatus?: number } = {}): string {
  const normalized = String(value || fallback).trim() || fallback;
  if (
    normalized.length > MAX_STT_MODEL_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new CaptionGatewayError("STT 모델명이 올바르지 않습니다.", {
      code: "INVALID_CONFIGURATION",
      httpStatus
    });
  }
  return normalized;
}

export function normalizeCaptionModel(value: unknown, {
  fallback = DEFAULT_CAPTION_MODEL,
  httpStatus = 500
}: { fallback?: string; httpStatus?: number } = {}): string {
  const normalized = String(value || fallback).trim() || fallback;
  if (!(SUPPORTED_CAPTION_MODELS as readonly string[]).includes(normalized)) {
    throw new CaptionGatewayError(
      `자막 초벌 모델은 ${SUPPORTED_CAPTION_MODELS.join(" 또는 ")}만 지원합니다.`,
      {
        code: "UNSUPPORTED_CAPTION_MODEL",
        httpStatus
      }
    );
  }
  return normalized;
}

export function resolveCaptionPipelineConfig(
  env: NodeJS.ProcessEnv = process.env,
  { allowMissingProviderConfig = false }: {
    allowMissingProviderConfig?: boolean;
  } = {}
): Required<CaptionPipelineConfig> {
  const maxAudioBytes = Number(env.KIRINUKI_MAX_AUDIO_BYTES);
  const pipelineTimeoutMs = Number(env.KIRINUKI_PIPELINE_TIMEOUT_MS);
  return {
    transcriptionMode: normalizeTranscriptionMode(
      env.KIRINUKI_STT_MODE
    ),
    sttEndpoint: localWhisperEndpoint(
      env.KIRINUKI_STT_ENDPOINT,
      "KIRINUKI_STT_ENDPOINT",
      { required: !allowMissingProviderConfig }
    ),
    sttModel: sttModelName(env.KIRINUKI_STT_MODEL),
    maxAudioBytes: Number.isFinite(maxAudioBytes) && maxAudioBytes > 0
      ? Math.floor(maxAudioBytes)
      : DEFAULT_MAX_AUDIO_BYTES,
    pipelineTimeoutMs: Number.isFinite(pipelineTimeoutMs)
      && pipelineTimeoutMs >= 1_000
      ? Math.min(MAX_PIPELINE_TIMEOUT_MS, Math.floor(pipelineTimeoutMs))
      : DEFAULT_PIPELINE_TIMEOUT_MS
  };
}

export function resolveCaptionPipelineRequestConfig(
  baseConfig: CaptionPipelineConfig = {},
  overrides: CaptionPipelineConfig = {}
): CaptionPipelineConfig {
  const suppliedOverrides = Object.entries(overrides).filter(([, value]) => (
    value != null && String(value).trim() !== ""
  ));
  if (suppliedOverrides.length > 0) {
    throw new CaptionGatewayError(
      "브라우저 요청에서 전사 제공자 설정을 덮어쓸 수 없습니다.",
      {
        code: "RUNTIME_PROVIDER_OVERRIDE_UNSUPPORTED",
        httpStatus: 400
      }
    );
  }
  return {
    ...baseConfig,
    transcriptionMode: normalizeTranscriptionMode(
      baseConfig.transcriptionMode,
      { httpStatus: 500 }
    ),
    sttEndpoint: localWhisperEndpoint(
      baseConfig.sttEndpoint,
      "로컬 Whisper 주소",
      { required: true, httpStatus: 500 }
    ),
    sttModel: sttModelName(baseConfig.sttModel, { httpStatus: 500 })
  };
}

function normalizeTranscriptText(value: unknown): string {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function transcriptRange(
  candidate: DynamicRecord | null | undefined,
  clipDurationMs: number
): { startMs: number; endMs: number } | null {
  const directStartMs = Number(candidate?.startMs ?? candidate?.start_ms);
  const directEndMs = Number(candidate?.endMs ?? candidate?.end_ms);
  if (Number.isFinite(directStartMs) && Number.isFinite(directEndMs)) {
    const startMs = Math.max(
      0,
      Math.min(clipDurationMs, Math.round(directStartMs))
    );
    const endMs = Math.max(
      0,
      Math.min(clipDurationMs, Math.round(directEndMs))
    );
    return endMs > startMs ? { startMs, endMs } : null;
  }
  const timestamp = Array.isArray(candidate?.timestamp)
    ? candidate.timestamp
    : null;
  const startSeconds = Number(
    candidate?.start
    ?? candidate?.start_time
    ?? timestamp?.[0]
  );
  const endSeconds = Number(
    candidate?.end
    ?? candidate?.end_time
    ?? timestamp?.[1]
  );
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
    return null;
  }
  const startMs = Math.max(
    0,
    Math.min(clipDurationMs, Math.round(startSeconds * 1_000))
  );
  const endMs = Math.max(
    0,
    Math.min(clipDurationMs, Math.round(endSeconds * 1_000))
  );
  return endMs > startMs ? { startMs, endMs } : null;
}

function normalizeTranscriptUnit(
  candidate: DynamicRecord | null | undefined,
  clipDurationMs: number,
  textFields: readonly string[]
): TranscriptUnit | null {
  const range = transcriptRange(candidate, clipDurationMs);
  const text = normalizeTranscriptText(
    textFields.map((field) => candidate?.[field]).find(
      (value) => value != null && value !== ""
    )
  );
  if (!range || !text) {
    return null;
  }
  const speaker = normalizeTranscriptText(
    candidate?.speaker
    ?? candidate?.speaker_label
    ?? candidate?.speakerLabel
  );
  return {
    ...range,
    text,
    ...(speaker ? { speaker } : {})
  };
}

function deduplicateTranscriptUnits(units: TranscriptUnit[]): TranscriptUnit[] {
  return units
    .sort((first, second) => (
      first.startMs - second.startMs
      || first.endMs - second.endMs
      || first.text.localeCompare(second.text)
    ))
    .filter((unit, index, all) => {
      const previous = all[index - 1];
      return !previous || !(
        previous.startMs === unit.startMs
        && previous.endMs === unit.endMs
        && previous.text === unit.text
        && previous.speaker === unit.speaker
      );
    });
}

export function normalizeSttTranscript(
  payload: unknown,
  { clipDurationMs }: { clipDurationMs?: unknown } = {}
): SttTranscript {
  const duration = Number(clipDurationMs);
  if (!Number.isInteger(duration) || duration < 1) {
    throw new CaptionGatewayError("STT 정규화용 클립 길이가 올바르지 않습니다.", {
      code: "INVALID_CLIP_DURATION",
      httpStatus: 400
    });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new CaptionGatewayError(
      "로컬 Whisper가 JSON 객체를 반환하지 않았습니다.",
      { code: "INVALID_STT_RESPONSE" }
    );
  }

  const source = payload as DynamicRecord;
  const rawSegments: DynamicRecord[] = Array.isArray(source.segments)
    ? source.segments
    : Array.isArray(source.chunks)
      ? source.chunks
      : [];
  if (rawSegments.length > MAX_STT_SEGMENTS) {
    throw new CaptionGatewayError(
      "로컬 Whisper의 segment 개수가 허용 상한을 넘었습니다.",
      { code: "STT_RESPONSE_TOO_LARGE" }
    );
  }
  const segments = deduplicateTranscriptUnits(
    rawSegments
      .map((segment) => normalizeTranscriptUnit(
        segment,
        duration,
        ["text", "word"]
      ))
      .filter((unit): unit is TranscriptUnit => unit !== null)
  );

  let rawWords: DynamicRecord[];
  if (Array.isArray(source.words)) {
    if (source.words.length > MAX_STT_WORDS) {
      throw new CaptionGatewayError(
        "로컬 Whisper의 word 개수가 허용 상한을 넘었습니다.",
        { code: "STT_RESPONSE_TOO_LARGE" }
      );
    }
    rawWords = source.words;
  } else {
    rawWords = [];
    for (const segment of rawSegments) {
      const words = Array.isArray(segment?.words) ? segment.words : [];
      if (rawWords.length + words.length > MAX_STT_WORDS) {
        throw new CaptionGatewayError(
          "로컬 Whisper의 word 개수가 허용 상한을 넘었습니다.",
          { code: "STT_RESPONSE_TOO_LARGE" }
        );
      }
      rawWords.push(...words);
    }
  }
  const words = deduplicateTranscriptUnits(
    rawWords
      .map((word) => normalizeTranscriptUnit(
        word,
        duration,
        ["word", "text"]
      ))
      .filter((unit): unit is TranscriptUnit => unit !== null)
  );

  const text = normalizeTranscriptText(source.text);
  if (segments.length === 0 && words.length === 0 && text) {
    throw new CaptionGatewayError(
      "로컬 Whisper가 발화 텍스트만 반환하고 시간 정보를 반환하지 않았습니다.",
      {
        code: "TIMED_TRANSCRIPT_REQUIRED",
        httpStatus: 502
      }
    );
  }
  const transcript = { text, segments, words };
  if (Buffer.byteLength(JSON.stringify(transcript)) > MAX_TRANSCRIPT_BYTES) {
    throw new CaptionGatewayError("로컬 전사문이 허용 상한을 넘었습니다.", {
      code: "STT_TRANSCRIPT_TOO_LARGE"
    });
  }
  return transcript;
}

function decodeWavBase64(value: string, maxAudioBytes: number): Buffer {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(value, "base64");
  } catch {
    throw new CaptionProtocolError("WAV base64를 해석하지 못했습니다.", {
      code: "INVALID_WAV"
    });
  }
  return validateWavBytes(bytes, maxAudioBytes);
}

function validateWavBytes(bytes: unknown, maxAudioBytes: number): Buffer {
  if (!Buffer.isBuffer(bytes)) {
    throw new CaptionProtocolError("WAV 바이트가 Buffer가 아닙니다.", {
      code: "INVALID_WAV"
    });
  }
  if (bytes.length < 12 || bytes.length > maxAudioBytes) {
    throw new CaptionProtocolError("WAV 파일 크기가 허용 범위를 벗어났습니다.", {
      code: bytes.length > maxAudioBytes ? "WAV_TOO_LARGE" : "INVALID_WAV"
    });
  }
  const container = bytes.toString("ascii", 0, 4);
  const wave = bytes.toString("ascii", 8, 12);
  if ((container !== "RIFF" && container !== "RF64") || wave !== "WAVE") {
    throw new CaptionProtocolError(
      "wavBase64가 RIFF/RF64 WAVE 파일이 아닙니다.",
      { code: "INVALID_WAV" }
    );
  }
  return bytes;
}

async function responseTextLimited(response: Response, {
  maxBytes = MAX_LOCAL_RESPONSE_BYTES
}: { maxBytes?: number } = {}): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new CaptionGatewayError(
      "로컬 Whisper 응답 본문이 너무 큽니다.",
      {
        code: "STT_RESPONSE_TOO_LARGE",
        httpStatus: 502
      }
    );
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) {
      throw new CaptionGatewayError(
        "로컬 Whisper 응답 본문이 너무 큽니다.",
        {
          code: "STT_RESPONSE_TOO_LARGE",
          httpStatus: 502
        }
      );
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
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
        throw new CaptionGatewayError(
          "로컬 Whisper 응답 본문이 너무 큽니다.",
          {
            code: "STT_RESPONSE_TOO_LARGE",
            httpStatus: 502
          }
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

async function responsePayload(
  response: Response
): Promise<{ text: string; json: unknown | null }> {
  const text = await responseTextLimited(response);
  if (!text) {
    return { text: "", json: null };
  }
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return { text, json: null };
  }
}

function requestSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
}

export async function requestLocalWhisperTranscription(request: CaptionAgentRequest, {
  fetchImpl = globalThis.fetch,
  sttEndpoint,
  sttModel = DEFAULT_STT_MODEL,
  maxAudioBytes = DEFAULT_MAX_AUDIO_BYTES,
  wavBytes,
  signal,
  timeoutMs = DEFAULT_STT_TIMEOUT_MS
}: TranscriptionOptions): Promise<SttTranscript> {
  if (typeof fetchImpl !== "function") {
    throw new CaptionGatewayError("fetch 구현이 없습니다.", {
      code: "INVALID_CONFIGURATION",
      httpStatus: 500
    });
  }
  const endpoint = localWhisperEndpoint(
    sttEndpoint,
    "로컬 Whisper 주소",
    { required: true, httpStatus: 500 }
  );
  const audioBytes = wavBytes === undefined
    ? decodeWavBase64(request.wavBase64, maxAudioBytes)
    : validateWavBytes(wavBytes, maxAudioBytes);
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(audioBytes)], { type: "audio/wav" }),
    "clip.wav"
  );
  form.append("model", sttModelName(sttModel));
  form.append("language", "ko");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  form.append("timestamp_granularities[]", "word");

  const requestedTimeoutMs = Number(timeoutMs);
  const sttTimeoutMs = Number.isFinite(requestedTimeoutMs)
    && requestedTimeoutMs >= 1
    ? Math.min(MAX_PIPELINE_TIMEOUT_MS, Math.floor(requestedTimeoutMs))
    : DEFAULT_STT_TIMEOUT_MS;
  const sttSignal = requestSignal(signal, sttTimeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      redirect: "error",
      headers: { accept: "application/json" },
      body: form,
      signal: sttSignal
    });
  } catch (error) {
    if (
      !signal?.aborted
      && sttSignal.aborted
      && sttSignal.reason?.name === "TimeoutError"
    ) {
      throw new CaptionGatewayError(
        "음성 전사 제한 시간을 초과했습니다.",
        {
          code: "STT_TIMEOUT",
          httpStatus: 504
        }
      );
    }
    if (sttSignal.aborted) {
      throw sttSignal.reason || error;
    }
    throw new CaptionGatewayError("로컬 Whisper 통신에 실패했습니다.", {
      code: "LOCAL_WHISPER_NETWORK_ERROR",
      httpStatus: 502
    });
  }
  const payload = await responsePayload(response);
  if (!response.ok || !payload.json) {
    throw new CaptionGatewayError("로컬 Whisper 요청이 실패했습니다.", {
      code: "STT_REQUEST_FAILED",
      httpStatus: 502
    });
  }
  return normalizeSttTranscript(payload.json, {
    clipDurationMs: request.clipDurationMs
  });
}

function transcriptHasRecognizableContent(
  transcript: SttTranscript | null | undefined
): boolean {
  return Boolean(
    normalizeTranscriptText(transcript?.text)
    || transcript?.segments?.some(
      (segment) => normalizeTranscriptText(segment?.text)
    )
    || transcript?.words?.some(
      (word) => normalizeTranscriptText(word?.text)
    )
  );
}

export function buildLocalWhisperCaptionDraft(
  request: CaptionAgentRequest,
  transcript: SttTranscript
) {
  const canonicalTranscript = canonicalTimedTranscript(transcript, {
    clipDurationMs: request.clipDurationMs,
    editorialContext: request.editorialContext
  });
  const rawCues: CaptionCue[] = canonicalTranscript.units.map((
    unit: TranscriptUnit & { speakerId?: string }
  ) => ({
    startMs: unit.startMs,
    endMs: unit.endMs,
    text: unit.text,
    speakerId: !unit.speakerId || unit.speakerId === "unknown"
      ? "main"
      : unit.speakerId,
    reviewRequired: false,
    placement: "bottom" as const
  }));
  const repaired = repairCaptionDraft(rawCues, {
    clipDurationMs: request.clipDurationMs,
    transcript: canonicalTranscript,
    editorialContext: request.editorialContext,
    timingPolicy: "stt-boundaries"
  });
  if (repaired.report.disposition === "rejected") {
    throw new CaptionGatewayError(
      "로컬 품질 하네스가 구조 충돌 cue를 격리했습니다. 자막은 적용하지 않았습니다.",
      {
        code: "CAPTION_QUALITY_GATE_FAILED",
        httpStatus: 422
      }
    );
  }
  const reviewsByCue = new Map<number, {
    cueIndex: number;
    status?: string;
    codes?: unknown[];
  }>(
    repaired.report.cueReviews.map((review: {
      cueIndex: number;
      status?: string;
      codes?: unknown[];
    }) => [
      review.cueIndex,
      review
    ])
  );
  const cues: CaptionCue[] = repaired.cues.map((cue, cueIndex): CaptionCue => {
    const review = reviewsByCue.get(cueIndex);
    const status = review?.status === "review-required"
      ? "review-required"
      : "accepted";
    return {
      ...cue,
      placement: "bottom",
      reviewRequired: cue.reviewRequired || status === "review-required",
      quality: {
        status,
        codes: (review?.codes || [])
          .filter((code): code is string => typeof code === "string")
          .slice(0, 32)
      }
    };
  });
  return {
    cues,
    warnings: boundedCaptionWarnings(
      canonicalTranscript.warnings,
      repaired.warnings,
      repaired.report.violations.map(({ code, cueIndex }) => ({
        code,
        cueIndex
      }))
    ),
    qualityProfile: repaired.profileId,
    harnessFingerprint: repaired.harnessFingerprint,
    qualityReport: repaired.report
  };
}

function emptySpeechQualityReport() {
  return {
    profileId: CAPTION_QUALITY_PROFILE_ID,
    harnessFingerprint: CAPTION_HARNESS_FINGERPRINT,
    valid: true,
    disposition: "review-required",
    violations: [{
      code: "NO_RECOGNIZABLE_SPEECH",
      cueIndex: 0,
      severity: "warning"
    }],
    cueReviews: [],
    metrics: {
      cueCount: 0,
      maximumDurationMs: 0,
      maximumLineWidthUnits: 0,
      maximumTotalWidthUnits: 0,
      maximumReadingRate: 0,
      transcriptCoverage: null,
      transcriptPrecision: null,
      wordAnchorCoverage: null,
      placement: "bottom"
    }
  };
}

export async function runCaptionPipeline(rawRequest: unknown, {
  fetchImpl = globalThis.fetch,
  transcribeAudio = requestLocalWhisperTranscription,
  signal,
  pipelineTimeoutMs = DEFAULT_PIPELINE_TIMEOUT_MS,
  ...config
}: CaptionPipelineConfig & {
  fetchImpl?: typeof globalThis.fetch;
  transcribeAudio?: AudioTranscriber;
  signal?: AbortSignal;
} = {}) {
  const configuredTimeoutMs = Number(pipelineTimeoutMs);
  const deadlineMs = Number.isFinite(configuredTimeoutMs)
    && configuredTimeoutMs >= 1
    ? Math.min(MAX_PIPELINE_TIMEOUT_MS, Math.floor(configuredTimeoutMs))
    : DEFAULT_PIPELINE_TIMEOUT_MS;
  const pipelineSignal = requestSignal(signal, deadlineMs);

  try {
    const request = validateCaptionAgentRequest(rawRequest);
    const captionModel = normalizeCaptionModel(
      request.model || DEFAULT_CAPTION_MODEL,
      { httpStatus: 400 }
    );
    if (typeof transcribeAudio !== "function") {
      throw new CaptionGatewayError(
        "로컬 Whisper 전사 구현이 필요합니다.",
        {
          code: "LOCAL_WHISPER_TRANSCRIBER_REQUIRED",
          httpStatus: 500
        }
      );
    }
    const wavBytes = decodeWavBase64(
      request.wavBase64,
      config.maxAudioBytes || DEFAULT_MAX_AUDIO_BYTES
    );
    const transcriptPayload = await transcribeAudio(request, {
      fetchImpl,
      ...(config.sttEndpoint === undefined
        ? {}
        : { sttEndpoint: config.sttEndpoint }),
      ...(config.sttModel === undefined
        ? {}
        : { sttModel: config.sttModel }),
      ...(config.maxAudioBytes === undefined
        ? {}
        : { maxAudioBytes: config.maxAudioBytes }),
      wavBytes,
      signal: pipelineSignal,
      timeoutMs: deadlineMs
    });
    const transcript = normalizeSttTranscript(transcriptPayload, {
      clipDurationMs: request.clipDurationMs
    });
    if (!transcriptHasRecognizableContent(transcript)) {
      return createCaptionAgentResponse({
        request,
        sttModel: config.sttModel || DEFAULT_STT_MODEL,
        captionModel,
        resolvedModel: config.sttModel || DEFAULT_STT_MODEL,
        provider: "local-whispercpp",
        cues: [],
        warnings: [{
          code: "NO_RECOGNIZABLE_SPEECH",
          cueIndex: 0
        }],
        qualityReport: emptySpeechQualityReport()
      });
    }
    const result = buildLocalWhisperCaptionDraft(request, transcript);
    return createCaptionAgentResponse({
      request,
      sttModel: config.sttModel || DEFAULT_STT_MODEL,
      captionModel,
      resolvedModel: config.sttModel || DEFAULT_STT_MODEL,
      provider: "local-whispercpp",
      cues: result.cues,
      warnings: result.warnings,
      qualityProfile: result.qualityProfile,
      harnessFingerprint: result.harnessFingerprint,
      qualityReport: result.qualityReport
    });
  } catch (error) {
    if (
      !signal?.aborted
      && pipelineSignal.aborted
      && pipelineSignal.reason?.name === "TimeoutError"
    ) {
      throw new CaptionGatewayError(
        "자막 파이프라인의 전체 제한 시간을 초과했습니다.",
        {
          code: "PIPELINE_TIMEOUT",
          httpStatus: 504
        }
      );
    }
    throw error;
  }
}
