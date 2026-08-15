import {
  CAPTION_EDITORIAL_CONTEXT_SCHEMA,
  MAX_CAPTION_EDITORIAL_CONTEXT_BYTES,
  MAX_CAPTION_GLOSSARY_ENTRIES,
  MAX_CAPTION_GLOSSARY_VARIANTS,
  MAX_CAPTION_SPEAKERS,
  MAX_CAPTION_SPEAKER_ALIASES,
  MAX_CAPTION_STYLE_EXAMPLES,
  captionEditorialContextFingerprint,
  normalizeCaptionEditorialContext
} from "./editorial-context.js";
import {
  CAPTION_HARNESS_FINGERPRINT,
  CAPTION_QUALITY_PROFILE_ID
} from "./caption-quality-harness.js";

export const CAPTION_AGENT_REQUEST_SCHEMA_ID =
  "chzzk-kirinuki-caption-request/v1";
export const CAPTION_AGENT_RESPONSE_SCHEMA_ID =
  "chzzk-kirinuki-caption-response/v1";
export const LOCAL_WHISPER_CAPTION_MODEL = "whisper-tiny";
export const SUPPORTED_CAPTION_MODELS = Object.freeze([
  LOCAL_WHISPER_CAPTION_MODEL
]);
export const CAPTION_RESPONSE_PROVIDERS = Object.freeze([
  "local-whispercpp"
]);

export const CAPTION_CUE_DURATION_POLICY = "source-timing-within-clip";
export const MIN_CAPTION_CUE_DURATION_MS = 100;
export const MAX_CAPTION_CUES = 4_000;
export const MAX_CAPTION_WARNINGS = 4_000;
export const MAX_CLIP_DURATION_MS = 30 * 60 * 1_000;
export const MAX_AUDIO_WAV_BYTES = 64 * 1024 * 1024;

// Protocol payloads enter through an untyped JSON boundary. Keeping the
// dynamic record local to the validators lets their normalized output remain
// strongly typed without pretending arbitrary JSON is trustworthy.
type JsonObject = Record<string, unknown>;

export interface CaptionAgentRequest {
  schema: typeof CAPTION_AGENT_REQUEST_SCHEMA_ID;
  requestId: string;
  clipId: string;
  clipDurationMs: number;
  language: "ko";
  model: string;
  wavBase64: string;
  projectId: string;
  projectName: string;
  streamerName: string;
  clipNote: string;
  editorialContext: ReturnType<typeof normalizeCaptionEditorialContext>;
}

export interface CaptionCue {
  startMs: number;
  endMs: number;
  text: string;
  speakerId: string;
  reviewRequired: boolean;
  placement: "bottom";
  quality?: {
    status: "accepted" | "review-required";
    codes: string[];
  };
}

export interface CaptionWarning {
  code: string;
  cueIndex: number;
}

export interface CaptionValidationError {
  cueIndex: number;
  fields: string[];
}

const REQUEST_PROPERTIES = Object.freeze([
  "schema",
  "requestId",
  "model",
  "locale",
  "clip",
  "source",
  "editorialContext",
  "policy",
  "audio"
]);

export const CAPTION_AGENT_REQUEST_JSON_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: CAPTION_AGENT_REQUEST_SCHEMA_ID,
  title: "CHZZK Kirinuki caption-agent request",
  type: "object",
  additionalProperties: false,
  required: [
    "schema",
    "requestId",
    "model",
    "locale",
    "clip",
    "source",
    "policy",
    "audio"
  ],
  properties: {
    schema: { const: CAPTION_AGENT_REQUEST_SCHEMA_ID },
    requestId: { type: "string", minLength: 1, maxLength: 128 },
    model: {
      type: "string",
      enum: SUPPORTED_CAPTION_MODELS
    },
    locale: { const: "ko-KR" },
    clip: {
      type: "object",
      additionalProperties: false,
      required: ["id", "title", "durationMs"],
      properties: {
        id: { type: "string", minLength: 1, maxLength: 256 },
        title: { type: "string", maxLength: 1_000 },
        durationMs: {
          type: "integer",
          minimum: 1,
          maximum: MAX_CLIP_DURATION_MS
        }
      }
    },
    source: {
      type: "object",
      additionalProperties: false,
      required: ["projectId", "projectName", "streamerName"],
      properties: {
        projectId: { type: "string", maxLength: 256 },
        projectName: { type: "string", maxLength: 200 },
        streamerName: { type: "string", maxLength: 120 }
      }
    },
    editorialContext: {
      type: "object",
      additionalProperties: false,
      required: ["schema", "glossary", "speakers", "style"],
      properties: {
        schema: { const: CAPTION_EDITORIAL_CONTEXT_SCHEMA },
        glossary: {
          type: "array",
          maxItems: MAX_CAPTION_GLOSSARY_ENTRIES,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["term", "variants"],
            properties: {
              term: { type: "string", minLength: 1, maxLength: 64 },
              variants: {
                type: "array",
                maxItems: MAX_CAPTION_GLOSSARY_VARIANTS,
                items: { type: "string", minLength: 1, maxLength: 64 }
              }
            }
          }
        },
        speakers: {
          type: "array",
          maxItems: MAX_CAPTION_SPEAKERS,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "aliases"],
            properties: {
              id: { type: "string", minLength: 1, maxLength: 80 },
              aliases: {
                type: "array",
                maxItems: MAX_CAPTION_SPEAKER_ALIASES,
                items: { type: "string", minLength: 1, maxLength: 80 }
              }
            }
          }
        },
        style: {
          type: "object",
          additionalProperties: false,
          required: [
            "terminalPeriod",
            "placement",
            "maxWidthUnits",
            "examples"
          ],
          properties: {
            terminalPeriod: { const: "omit" },
            placement: { const: "bottom" },
            maxWidthUnits: { const: 20 },
            examples: {
              type: "array",
              maxItems: MAX_CAPTION_STYLE_EXAMPLES,
              items: { type: "string", minLength: 1, maxLength: 80 }
            }
          }
        }
      }
    },
    policy: {
      type: "object",
      additionalProperties: false,
      required: [
        "audience",
        "includeAllRecognizableSpeech",
        "uncertainSpeech",
        "cueDurationPolicy",
        "terminalPeriod",
        "questionAndExclamationMarks"
      ],
      properties: {
        audience: { const: "korean-vtuber-kirinuki" },
        includeAllRecognizableSpeech: { const: true },
        uncertainSpeech: { const: "keep-and-mark-for-review" },
        cueDurationPolicy: { const: CAPTION_CUE_DURATION_POLICY },
        terminalPeriod: { const: "omit" },
        questionAndExclamationMarks: { const: "keep" }
      }
    },
    audio: {
      type: "object",
      additionalProperties: false,
      required: [
        "encoding",
        "mimeType",
        "sampleRateHz",
        "channels",
        "data"
      ],
      properties: {
        encoding: { const: "base64" },
        mimeType: { const: "audio/wav" },
        sampleRateHz: { const: 16_000 },
        channels: { const: 1 },
        data: {
          type: "string",
          minLength: 16,
          maxLength: 4 * Math.ceil(MAX_AUDIO_WAV_BYTES / 3),
          contentEncoding: "base64",
          contentMediaType: "audio/wav"
        }
      }
    },
  }
});

const CAPTION_CUE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "startMs",
    "endMs",
    "text",
    "speakerId",
    "reviewRequired",
    "placement"
  ],
  properties: {
    startMs: {
      type: "integer",
      minimum: 0,
      description: "클립 시작을 0으로 한 자막 시작 시각(ms)"
    },
    endMs: {
      type: "integer",
      minimum: 1,
      description: "클립 시작을 0으로 한 자막 종료 시각(ms), startMs보다 크고 클립 길이 이내"
    },
    text: {
      type: "string",
      minLength: 1,
      maxLength: 300,
      description: "화면에 표시할 한국어 자막. 종결 마침표는 쓰지 않는다"
    },
    speakerId: {
      type: "string",
      minLength: 1,
      maxLength: 80,
      description: "알 수 없는 실명 대신 일관된 화자 표식"
    },
    reviewRequired: {
      type: "boolean",
      description: "사람이 특히 다시 들어야 하는 불확실 자막 여부"
    },
    placement: {
      const: "bottom",
      description: "자동 본문 자막의 고정 기본 위치"
    },
    quality: {
      type: "object",
      additionalProperties: false,
      required: ["status", "codes"],
      properties: {
        status: {
          type: "string",
          enum: ["accepted", "review-required"]
        },
        codes: {
          type: "array",
          maxItems: 32,
          items: { type: "string", minLength: 1, maxLength: 128 }
        }
      }
    }
  }
});
const CAPTION_QUALITY_REPORT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "profileId",
    "harnessFingerprint",
    "valid",
    "disposition",
    "violations",
    "cueReviews",
    "metrics"
  ],
  properties: {
    profileId: { const: CAPTION_QUALITY_PROFILE_ID },
    harnessFingerprint: { const: CAPTION_HARNESS_FINGERPRINT },
    valid: { type: "boolean" },
    disposition: {
      type: "string",
      enum: ["accepted", "review-required"]
    },
    violations: {
      type: "array",
      maxItems: MAX_CAPTION_WARNINGS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "cueIndex", "severity"],
        properties: {
          code: { type: "string", minLength: 1, maxLength: 128 },
          cueIndex: { type: "integer", minimum: 0 },
          severity: { type: "string", enum: ["error", "warning"] }
        }
      }
    },
    cueReviews: {
      type: "array",
      maxItems: MAX_CAPTION_CUES,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["cueIndex", "status", "codes", "metrics"],
        properties: {
          cueIndex: { type: "integer", minimum: 0 },
          status: {
            type: "string",
            enum: ["accepted", "review-required"]
          },
          codes: {
            type: "array",
            maxItems: 32,
            items: { type: "string", minLength: 1, maxLength: 128 }
          },
          metrics: {
            type: "object",
            description: "해당 cue의 시간·폭·읽기속도·전사 대조 수치"
          }
        }
      }
    },
    metrics: {
      type: "object",
      description: "클립 전체 품질 수치"
    }
  }
});

export const CAPTION_AGENT_RESPONSE_JSON_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: CAPTION_AGENT_RESPONSE_SCHEMA_ID,
  title: "CHZZK Kirinuki caption-agent response",
  type: "object",
  additionalProperties: false,
  required: [
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
  ],
  properties: {
    schema: { const: CAPTION_AGENT_RESPONSE_SCHEMA_ID },
    requestId: { type: "string", minLength: 1, maxLength: 128 },
    clipId: { type: "string", minLength: 1, maxLength: 256 },
    language: { const: "ko" },
    sttModel: { type: "string", minLength: 1 },
    captionModel: { type: "string", minLength: 1 },
    model: { type: "string", minLength: 1 },
    resolvedModel: { type: "string", minLength: 1 },
    provider: {
      type: "string",
      enum: CAPTION_RESPONSE_PROVIDERS
    },
    status: { const: "completed" },
    cues: {
      type: "array",
      maxItems: MAX_CAPTION_CUES,
      items: CAPTION_CUE_SCHEMA
    },
    warnings: {
      type: "array",
      maxItems: MAX_CAPTION_WARNINGS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "cueIndex"],
        properties: {
          code: { type: "string", minLength: 1, maxLength: 128 },
          cueIndex: { type: "integer", minimum: 0 }
        }
      }
    },
    qualityProfile: { const: CAPTION_QUALITY_PROFILE_ID },
    harnessFingerprint: { const: CAPTION_HARNESS_FINGERPRINT },
    editorialContextFingerprint: {
      type: "string",
      pattern: "^ctx-v1-[0-9a-f]{16}$"
    },
    qualityReport: CAPTION_QUALITY_REPORT_SCHEMA
  }
});

export class CaptionProtocolError extends Error {
  code: string;
  issues: unknown[];

  constructor(message: string, {
    code = "INVALID_CAPTION_PROTOCOL",
    issues = []
  }: { code?: string; issues?: unknown[] } = {}) {
    super(message);
    this.name = "CaptionProtocolError";
    this.code = code;
    this.issues = issues;
  }
}

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
  );
}

function requiredBoundedString(
  value: unknown,
  field: string,
  maxLength: number
): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maxLength) {
    throw new CaptionProtocolError(`${field} 값이 올바르지 않습니다.`, {
      code: "INVALID_REQUEST_FIELD",
      issues: [field]
    });
  }
  return normalized;
}

function optionalBoundedString(
  value: unknown,
  field: string,
  maxLength: number
): string {
  if (value == null || value === "") {
    return "";
  }
  return requiredBoundedString(value, field, maxLength);
}

function exactObject(
  value: unknown,
  field: string,
  allowedFields: readonly string[]
): JsonObject {
  if (!isPlainObject(value)) {
    throw new CaptionProtocolError(`${field} 값은 JSON 객체여야 합니다.`, {
      code: "INVALID_REQUEST_FIELD",
      issues: [field]
    });
  }
  const unknown = Object.keys(value).filter(
    (candidate) => !allowedFields.includes(candidate)
  );
  if (unknown.length > 0) {
    throw new CaptionProtocolError(`${field}에 지원하지 않는 필드가 있습니다.`, {
      code: "UNKNOWN_REQUEST_FIELD",
      issues: unknown.map((candidate) => `${field}.${candidate}`)
    });
  }
  return value;
}

function looksLikeBase64(value: unknown): value is string {
  if (
    typeof value !== "string"
    || value.length < 16
    || value.length % 4 === 1
    || /\s/.test(value)
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    return false;
  }
  try {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length === 0) {
      return false;
    }
    const canonicalInput = value.replace(/=+$/, "");
    return decoded.toString("base64").replace(/=+$/, "") === canonicalInput;
  } catch {
    return false;
  }
}

export function validateCaptionAgentRequest(value: unknown): CaptionAgentRequest {
  if (!isPlainObject(value)) {
    throw new CaptionProtocolError("자막 요청은 JSON 객체여야 합니다.", {
      code: "INVALID_REQUEST"
    });
  }
  const unknownFields = Object.keys(value).filter(
    (field) => !REQUEST_PROPERTIES.includes(field)
  );
  if (unknownFields.length > 0) {
    throw new CaptionProtocolError("지원하지 않는 자막 요청 필드가 있습니다.", {
      code: "UNKNOWN_REQUEST_FIELD",
      issues: unknownFields
    });
  }
  if (value.schema !== CAPTION_AGENT_REQUEST_SCHEMA_ID) {
    throw new CaptionProtocolError("지원하지 않는 자막 요청 스키마입니다.", {
      code: "UNSUPPORTED_REQUEST_SCHEMA",
      issues: ["schema"]
    });
  }
  const clip = exactObject(value.clip, "clip", ["id", "title", "durationMs"]);
  const source = exactObject(
    value.source,
    "source",
    ["projectId", "projectName", "streamerName"]
  );
  let editorialContext;
  try {
    editorialContext = normalizeCaptionEditorialContext(
      value.editorialContext,
      { strict: value.editorialContext != null }
    );
  } catch {
    throw new CaptionProtocolError(
      "프로젝트 자막 편집 문맥이 올바르지 않거나 허용 상한을 넘었습니다.",
      {
        code: "INVALID_EDITORIAL_CONTEXT",
        issues: ["editorialContext"]
      }
    );
  }
  if (
    new TextEncoder().encode(JSON.stringify(editorialContext)).byteLength
    > MAX_CAPTION_EDITORIAL_CONTEXT_BYTES
  ) {
    throw new CaptionProtocolError("프로젝트 자막 편집 문맥이 너무 큽니다.", {
      code: "INVALID_EDITORIAL_CONTEXT",
      issues: ["editorialContext"]
    });
  }
  const policy = exactObject(value.policy, "policy", [
    "audience",
    "includeAllRecognizableSpeech",
    "uncertainSpeech",
    "cueDurationPolicy",
    "terminalPeriod",
    "questionAndExclamationMarks"
  ]);
  const audio = exactObject(value.audio, "audio", [
    "encoding",
    "mimeType",
    "sampleRateHz",
    "channels",
    "data"
  ]);
  const clipDurationMs = Number(clip.durationMs);
  if (
    !Number.isInteger(clipDurationMs)
    || clipDurationMs < 1
    || clipDurationMs > MAX_CLIP_DURATION_MS
  ) {
    throw new CaptionProtocolError("clipDurationMs 범위가 올바르지 않습니다.", {
      code: "INVALID_REQUEST_FIELD",
      issues: ["clip.durationMs"]
    });
  }
  if (value.locale !== "ko-KR") {
    throw new CaptionProtocolError("현재 자막 에이전트는 한국어(ko-KR)만 지원합니다.", {
      code: "UNSUPPORTED_LANGUAGE",
      issues: ["locale"]
    });
  }
  const supportedModels = new Set<string>(SUPPORTED_CAPTION_MODELS);
  if (
    typeof value.model !== "string"
    || !supportedModels.has(value.model)
  ) {
    throw new CaptionProtocolError("지원하지 않는 자막 초벌 모델입니다.", {
      code: "INVALID_REQUEST_FIELD",
      issues: ["model"]
    });
  }
  const expectedPolicy = {
    audience: "korean-vtuber-kirinuki",
    includeAllRecognizableSpeech: true,
    uncertainSpeech: "keep-and-mark-for-review",
    cueDurationPolicy: CAPTION_CUE_DURATION_POLICY,
    terminalPeriod: "omit",
    questionAndExclamationMarks: "keep"
  };
  const invalidPolicyFields = Object.entries(expectedPolicy)
    .filter(([field, expected]) => policy[field] !== expected)
    .map(([field]) => `policy.${field}`);
  if (invalidPolicyFields.length > 0) {
    throw new CaptionProtocolError("자막 초안 정책이 지원 계약과 다릅니다.", {
      code: "INVALID_REQUEST_POLICY",
      issues: invalidPolicyFields
    });
  }
  if (
    audio.encoding !== "base64"
    || audio.mimeType !== "audio/wav"
    || audio.sampleRateHz !== 16_000
    || audio.channels !== 1
  ) {
    throw new CaptionProtocolError("16kHz mono PCM WAV 요청만 지원합니다.", {
      code: "UNSUPPORTED_AUDIO_FORMAT",
      issues: ["audio"]
    });
  }
  if (!looksLikeBase64(audio.data)) {
    throw new CaptionProtocolError("audio.data가 올바른 base64 데이터가 아닙니다.", {
      code: "INVALID_REQUEST_FIELD",
      issues: ["audio.data"]
    });
  }
  return {
    schema: CAPTION_AGENT_REQUEST_SCHEMA_ID,
    requestId: requiredBoundedString(value.requestId, "requestId", 128),
    clipId: requiredBoundedString(clip.id, "clip.id", 256),
    clipDurationMs,
    language: "ko",
    model: value.model,
    wavBase64: audio.data,
    projectId: optionalBoundedString(source.projectId, "source.projectId", 256),
    projectName: optionalBoundedString(source.projectName, "source.projectName", 200),
    streamerName: optionalBoundedString(source.streamerName, "source.streamerName", 120),
    clipNote: optionalBoundedString(clip.title, "clip.title", 1_000),
    editorialContext
  };
}

export function stripTerminalPeriods(value: unknown): string {
  const normalized = String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized
    .replace(/[.\u3002\uff0e]+(?=(?:["'”’)\]}\u3009\u300b\u300d\u300f\u3011]*)$)/gu, "")
    .trim();
}

function finiteInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function normalizedSpeaker(value: unknown): string {
  const speaker = String(value ?? "").replace(/\s+/gu, " ").trim();
  return speaker.slice(0, 80) || "unknown";
}

function normalizedPlacement(_value?: unknown): "bottom" {
  return "bottom";
}

function rawCueField(
  cue: JsonObject | null | undefined,
  camelName: string,
  snakeName: string
): unknown {
  return cue?.[camelName] ?? cue?.[snakeName];
}

export function validateCaptionCue(
  cue: unknown,
  { clipDurationMs }: { clipDurationMs?: unknown } = {}
): string[] {
  const errors: string[] = [];
  const duration = Number(clipDurationMs);
  if (!isPlainObject(cue)) {
    return ["cue_object"];
  }
  const startMs = cue.startMs;
  const endMs = cue.endMs;
  const validStartMs = typeof startMs === "number"
    && Number.isInteger(startMs);
  const validEndMs = typeof endMs === "number"
    && Number.isInteger(endMs);
  if (!validStartMs || startMs < 0) {
    errors.push("startMs");
  }
  if (!validEndMs || !validStartMs || endMs <= startMs) {
    errors.push("endMs");
  }
  if (
    Number.isFinite(duration)
    && validEndMs
    && endMs > duration
  ) {
    errors.push("clipDurationMs");
  }
  if (!String(cue.text || "").trim()) {
    errors.push("text");
  } else if (stripTerminalPeriods(cue.text) !== String(cue.text).trim()) {
    errors.push("terminalPeriod");
  }
  if (!String(cue.speakerId || "").trim()) {
    errors.push("speakerId");
  }
  if (typeof cue.reviewRequired !== "boolean") {
    errors.push("reviewRequired");
  }
  if (cue.placement !== "bottom") {
    errors.push("placement");
  }
  if (cue.quality != null) {
    if (
      !isPlainObject(cue.quality)
      || Object.keys(cue.quality).some(
        (field) => !["status", "codes"].includes(field)
      )
      || typeof cue.quality.status !== "string"
      || !["accepted", "review-required"].includes(cue.quality.status)
      || !Array.isArray(cue.quality.codes)
      || cue.quality.codes.length > 32
      || cue.quality.codes.some((code) => (
        typeof code !== "string"
        || !code.trim()
        || code.length > 128
      ))
    ) {
      errors.push("quality");
    }
  }
  return [...new Set(errors)];
}

export function validateCaptionCues(
  cues: unknown,
  { clipDurationMs }: { clipDurationMs?: unknown } = {}
): { valid: boolean; errors: CaptionValidationError[] } {
  if (!Array.isArray(cues)) {
    return {
      valid: false,
      errors: [{ cueIndex: -1, fields: ["cues_array"] }]
    };
  }
  const errors = cues.flatMap((cue, cueIndex) => {
    const fields = validateCaptionCue(cue, { clipDurationMs });
    return fields.length > 0 ? [{ cueIndex, fields }] : [];
  });
  if (cues.length > MAX_CAPTION_CUES) {
    errors.push({ cueIndex: MAX_CAPTION_CUES, fields: ["maxItems"] });
  }
  return { valid: errors.length === 0, errors };
}

export function normalizeCaptionCuesDetailed(
  rawCues: unknown,
  { clipDurationMs }: { clipDurationMs?: unknown } = {}
): { cues: CaptionCue[]; warnings: CaptionWarning[] } {
  const duration = Number(clipDurationMs);
  if (
    !Number.isInteger(duration)
    || duration < 1
    || duration > MAX_CLIP_DURATION_MS
  ) {
    throw new CaptionProtocolError("자막 정규화용 clipDurationMs가 올바르지 않습니다.", {
      code: "INVALID_CLIP_DURATION"
    });
  }
  if (!Array.isArray(rawCues)) {
    throw new CaptionProtocolError("자막 초안의 cues가 배열이 아닙니다.", {
      code: "INVALID_CAPTION_DRAFT"
    });
  }
  if (rawCues.length > MAX_CAPTION_CUES) {
    throw new CaptionProtocolError("자막 초안의 cue 개수가 허용 상한을 넘었습니다.", {
      code: "CAPTION_CUE_LIMIT_EXCEEDED",
      issues: [{ cueIndex: MAX_CAPTION_CUES, fields: ["maxItems"] }]
    });
  }

  const warnings: CaptionWarning[] = [];
  const normalized: CaptionCue[] = [];
  const appendWarning = (warning: CaptionWarning): void => {
    if (warnings.length >= MAX_CAPTION_WARNINGS) {
      throw new CaptionProtocolError("자막 초안의 경고 개수가 허용 상한을 넘었습니다.", {
        code: "CAPTION_WARNING_LIMIT_EXCEEDED"
      });
    }
    warnings.push(warning);
  };
  for (const [cueIndex, rawCue] of rawCues.entries()) {
    if (!isPlainObject(rawCue)) {
      appendWarning({ code: "DROPPED_INVALID_CUE", cueIndex });
      continue;
    }
    const rawStart = finiteInteger(rawCueField(rawCue, "startMs", "start_ms"));
    const rawEnd = finiteInteger(rawCueField(rawCue, "endMs", "end_ms"));
    const text = stripTerminalPeriods(rawCue.text);
    if (rawStart == null || rawEnd == null || !text) {
      appendWarning({ code: "DROPPED_INVALID_CUE", cueIndex });
      continue;
    }
    let startMs = Math.max(0, Math.min(duration, rawStart));
    let endMs = Math.max(0, Math.min(duration, rawEnd));
    if (endMs <= startMs) {
      appendWarning({ code: "DROPPED_EMPTY_RANGE", cueIndex });
      continue;
    }
    if (
      endMs - startMs < MIN_CAPTION_CUE_DURATION_MS
      && duration >= MIN_CAPTION_CUE_DURATION_MS
    ) {
      startMs = Math.min(startMs, duration - MIN_CAPTION_CUE_DURATION_MS);
      endMs = Math.max(
        endMs,
        Math.min(duration, startMs + MIN_CAPTION_CUE_DURATION_MS)
      );
      appendWarning({ code: "EXPANDED_SHORT_CUE", cueIndex });
    }

    const boundedText = text.slice(0, 300).trim();
    if (boundedText !== text) {
      appendWarning({ code: "TRIMMED_LONG_TEXT", cueIndex });
    }
    normalized.push({
      startMs,
      endMs,
      text: stripTerminalPeriods(boundedText),
      speakerId: normalizedSpeaker(
        rawCueField(rawCue, "speakerId", "speaker_id")
        ?? rawCue.speaker
      ),
      reviewRequired: (
        rawCueField(rawCue, "reviewRequired", "review_required") === true
        || /\[불명확\]/u.test(boundedText)
      ),
      placement: normalizedPlacement(rawCue.placement)
    });
  }

  normalized.sort((first, second) => (
    first.startMs - second.startMs
    || first.endMs - second.endMs
    || first.speakerId.localeCompare(second.speakerId)
  ));
  const deduplicated = normalized.filter((cue, index, all) => {
    const previous = all[index - 1];
    return !previous || !(
      previous.startMs === cue.startMs
      && previous.endMs === cue.endMs
      && previous.text === cue.text
      && previous.speakerId === cue.speakerId
    );
  });
  const validation = validateCaptionCues(deduplicated, { clipDurationMs: duration });
  if (!validation.valid) {
    throw new CaptionProtocolError("정규화된 자막 cue가 프로토콜을 위반했습니다.", {
      code: "INVALID_NORMALIZED_CUES",
      issues: validation.errors
    });
  }
  return { cues: deduplicated, warnings };
}

export function normalizeCaptionCues(
  rawCues: unknown,
  options: { clipDurationMs?: unknown }
): CaptionCue[] {
  return normalizeCaptionCuesDetailed(rawCues, options).cues;
}

export function createCaptionAgentResponse({
  request,
  sttModel,
  captionModel,
  resolvedModel = captionModel,
  provider = "local-whispercpp",
  cues,
  warnings = [],
  qualityProfile = CAPTION_QUALITY_PROFILE_ID,
  harnessFingerprint = CAPTION_HARNESS_FINGERPRINT,
  qualityReport
}: {
  request: CaptionAgentRequest;
  sttModel: unknown;
  captionModel: unknown;
  resolvedModel?: unknown;
  provider?: string;
  cues: CaptionCue[];
  warnings?: CaptionWarning[];
  qualityProfile?: string;
  harnessFingerprint?: string;
  qualityReport?: unknown;
}) {
  const validation = validateCaptionCues(cues, {
    clipDurationMs: request.clipDurationMs
  });
  if (!validation.valid) {
    throw new CaptionProtocolError("응답 자막 cue가 프로토콜을 위반했습니다.", {
      code: "INVALID_RESPONSE_CUES",
      issues: validation.errors
    });
  }
  if (
    !Array.isArray(warnings)
    || warnings.length > MAX_CAPTION_WARNINGS
    || warnings.some((warning) => (
      !isPlainObject(warning)
      || Object.keys(warning).some((key) => !["code", "cueIndex"].includes(key))
      || typeof warning.code !== "string"
      || !warning.code.trim()
      || warning.code.length > 128
      || !Number.isInteger(warning.cueIndex)
      || warning.cueIndex < 0
    ))
  ) {
    throw new CaptionProtocolError("응답 경고가 프로토콜을 위반했습니다.", {
      code: "INVALID_RESPONSE_WARNINGS"
    });
  }
  const report = qualityReport || {
    profileId: CAPTION_QUALITY_PROFILE_ID,
    harnessFingerprint: CAPTION_HARNESS_FINGERPRINT,
    valid: true,
    disposition: cues.some((cue) => cue.reviewRequired)
      ? "review-required"
      : "accepted",
    violations: [],
    cueReviews: cues.map((cue, cueIndex) => ({
      cueIndex,
      status: cue.reviewRequired ? "review-required" : "accepted",
      codes: [],
      metrics: {
        durationMs: cue.endMs - cue.startMs,
        widthUnits: null,
        readingRate: null,
        transcriptCoverage: null,
        transcriptPrecision: null
      }
    })),
    metrics: {
      cueCount: cues.length
    }
  };
  if (
    qualityProfile !== CAPTION_QUALITY_PROFILE_ID
    || harnessFingerprint !== CAPTION_HARNESS_FINGERPRINT
    || !isPlainObject(report)
    || report.profileId !== CAPTION_QUALITY_PROFILE_ID
    || report.harnessFingerprint !== CAPTION_HARNESS_FINGERPRINT
    || typeof report.valid !== "boolean"
    || typeof report.disposition !== "string"
    || !["accepted", "review-required"].includes(report.disposition)
    || !Array.isArray(report.violations)
    || report.violations.length > MAX_CAPTION_WARNINGS
    || !Array.isArray(report.cueReviews)
    || report.cueReviews.length !== cues.length
    || !isPlainObject(report.metrics)
  ) {
    throw new CaptionProtocolError("응답 품질 보고서가 프로토콜을 위반했습니다.", {
      code: "INVALID_RESPONSE_QUALITY_REPORT"
    });
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
      throw new CaptionProtocolError("cue별 품질 보고서가 올바르지 않습니다.", {
        code: "INVALID_RESPONSE_QUALITY_REPORT"
      });
    }
  }
  for (const violation of report.violations) {
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
      throw new CaptionProtocolError("품질 위반 보고서가 올바르지 않습니다.", {
        code: "INVALID_RESPONSE_QUALITY_REPORT"
      });
    }
  }
  if (!(CAPTION_RESPONSE_PROVIDERS as readonly string[]).includes(provider)) {
    throw new CaptionProtocolError("응답 자막 제공자가 올바르지 않습니다.", {
      code: "INVALID_RESPONSE_PROVIDER"
    });
  }
  return {
    schema: CAPTION_AGENT_RESPONSE_SCHEMA_ID,
    requestId: request.requestId,
    clipId: request.clipId,
    language: "ko",
    sttModel: String(sttModel || ""),
    captionModel: String(captionModel || ""),
    model: String(captionModel || ""),
    resolvedModel: String(resolvedModel || captionModel || ""),
    provider,
    status: "completed",
    cues,
    warnings,
    qualityProfile,
    harnessFingerprint,
    editorialContextFingerprint: captionEditorialContextFingerprint(
      request.editorialContext
    ),
    qualityReport: report
  };
}

export const CAPTION_REQUEST_SCHEMA = CAPTION_AGENT_REQUEST_JSON_SCHEMA;
export const CAPTION_RESPONSE_SCHEMA = CAPTION_AGENT_RESPONSE_JSON_SCHEMA;
