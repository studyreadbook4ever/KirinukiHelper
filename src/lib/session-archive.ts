import {
  normalizeEditorProject,
  SUPPORTED_IMAGE_ASSET_MIME_TYPES
} from "./editor-core.js";
import type {
  EditorProject
} from "./editor-core.js";
import {
  canonicalSourceUrl,
  inferSourceIdentifiers,
  isSupportedSourceUrl
} from "./source-platform.js";

export const SESSION_ARCHIVE_SCHEMA = "kirinuki-session-archive/v1" as const;
export const MEDIA_RECOVERY_SCHEMA = "kirinuki-media-recovery/v1" as const;
export const SESSION_ARCHIVE_INTEGRITY_ALGORITHM = "SHA-256" as const;

export const SESSION_ARCHIVE_MAX_IMAGE_ASSETS = 256;
export const SESSION_ARCHIVE_MAX_IMAGE_ASSET_BYTES = 25 * 1024 * 1024;
export const SESSION_ARCHIVE_MAX_TOTAL_IMAGE_ASSET_BYTES = 64 * 1024 * 1024;
export const SESSION_ARCHIVE_MAX_JSON_BYTES = 96 * 1024 * 1024;
export const SESSION_ARCHIVE_MAX_MATERIALIZATION_JSON_BYTES = 2 * 1024 * 1024;

const SESSION_ARCHIVE_MAX_DEPTH = 64;
const SESSION_ARCHIVE_MAX_NODES = 250_000;
const MAX_BLOB_KEY_LENGTH = 512;
const MAX_SOURCE_URL_LENGTH = 2_048;
const MAX_SOURCE_ID_LENGTH = 256;
const MAX_FILE_NAME_LENGTH = 512;
const MAX_MIME_TYPE_LENGTH = 128;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const SAFE_BLOB_KEY_PATTERN = /^[^\u0000-\u001f\u007f]{1,512}$/u;
const SAFE_CONTENT_ID_PATTERN = /^[^\u0000-\u001f\u007f/?#&=]{1,256}$/u;
const REMOTE_PLATFORMS = new Set(["CHZZK", "YOUTUBE", "SOOP"]);
const RECOVERY_MODES = new Set([
  "none",
  "reconnect-local-file",
  "redownload-vod"
]);
const IMAGE_MIME_TYPES = new Set<string>(SUPPORTED_IMAGE_ASSET_MIME_TYPES);

type JsonPrimitive = string | number | boolean | null;
export type SessionArchiveJsonValue =
  | JsonPrimitive
  | SessionArchiveJsonValue[]
  | { [key: string]: SessionArchiveJsonValue };
export type SessionArchiveJsonObject = {
  [key: string]: SessionArchiveJsonValue;
};

export type SessionArchiveExportKind = "main" | "short-form";
export type SessionArchiveMediaRecoveryMode =
  | "none"
  | "reconnect-local-file"
  | "redownload-vod";

export interface SessionArchiveImageAsset {
  blobKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  dataBase64: string;
}

export interface SessionArchiveMediaSource {
  platform: "CHZZK" | "YOUTUBE" | "SOOP" | "LOCAL";
  contentType: "vod" | "live" | "clip" | "file";
  contentId: string;
  canonicalUrl: string;
}

export interface SessionArchiveLocalMedia {
  name: string;
  mimeType: string;
  sizeBytes: number;
  lastModifiedMs: number;
  sha256: string | null;
  sampleSha256?: string | null;
}

export interface SessionArchiveMediaRecovery {
  schema: typeof MEDIA_RECOVERY_SCHEMA;
  mode: SessionArchiveMediaRecoveryMode;
  source: SessionArchiveMediaSource | null;
  localMedia: SessionArchiveLocalMedia | null;
  materialization: SessionArchiveJsonObject | null;
  vodBytesIncluded: false;
}

export interface SessionArchivePayload {
  schema: typeof SESSION_ARCHIVE_SCHEMA;
  createdAt: string;
  exportKind: SessionArchiveExportKind;
  rootProject: EditorProject;
  exportSnapshot: SessionArchiveJsonObject;
  imageAssets: SessionArchiveImageAsset[];
  mediaRecovery: SessionArchiveMediaRecovery;
}

export interface SessionArchive extends SessionArchivePayload {
  integrity: {
    algorithm: typeof SESSION_ARCHIVE_INTEGRITY_ALGORITHM;
    sha256: string;
  };
}

export type ResolveSessionArchiveImageAssetBlob = (
  blobKey: string
) => Promise<Blob | null>;

export interface BuildSessionArchiveInput {
  rootProject: EditorProject;
  exportKind: SessionArchiveExportKind;
  exportSnapshot: unknown;
  mediaRecovery: unknown;
  resolveImageAssetBlob: ResolveSessionArchiveImageAssetBlob;
  createdAt?: string;
}

type UnknownRecord = Record<string, unknown>;

export class SessionArchiveError extends Error {
  override readonly name: string = "SessionArchiveError";
  readonly code: string;

  constructor(message: string, code = "INVALID_SESSION_ARCHIVE") {
    super(message);
    this.code = code;
  }
}

export class UnsupportedSessionArchiveSchemaError extends SessionArchiveError {
  override readonly name = "UnsupportedSessionArchiveSchemaError";

  constructor(schema: unknown) {
    super(
      `이 버전의 Kirinuki가 지원하지 않는 세션 복원 파일입니다: ${String(schema || "(형식 없음)")}`,
      "UNSUPPORTED_SESSION_ARCHIVE_SCHEMA"
    );
  }
}

function fail(message: string, code?: string): never {
  throw new SessionArchiveError(message, code);
}

function isPlainRecord(value: unknown): value is UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requirePlainRecord(value: unknown, label: string): UnknownRecord {
  if (!isPlainRecord(value)) {
    fail(`${label}은 JSON 객체여야 합니다.`);
  }
  return value;
}

function assertOnlyKeys(
  record: UnknownRecord,
  allowedKeys: readonly string[],
  label: string
): void {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(record).find((key) => !allowed.has(key));
  if (unexpected) {
    fail(`${label}에 지원하지 않는 필드가 있습니다: ${unexpected}`);
  }
}

function normalizedFieldName(value: string): string {
  return value.replace(/[^A-Za-z0-9]/gu, "").toLowerCase();
}

function isPerUseOrSensitiveField(key: string): boolean {
  const normalized = normalizedFieldName(key);
  return (
    normalized === "history"
    || normalized === "undo"
    || normalized === "redo"
    || normalized.startsWith("usagepolicy")
    || normalized.startsWith("rightsconfirmation")
    || normalized.startsWith("sessioncleanup")
    || normalized === "confirmationtext"
    || normalized.includes("token")
    || normalized.includes("credential")
    || normalized.includes("apikey")
    || normalized.includes("authorization")
    || normalized.includes("password")
    || normalized.includes("secret")
    || normalized === "vodbytes"
    || normalized === "mediabytes"
    || normalized === "filebytes"
    || normalized === "bytes"
    || normalized === "binary"
    || normalized === "blob"
    || normalized === "payload"
    || normalized === "body"
    || normalized === "voddata"
    || normalized === "mediadata"
    || normalized === "filedata"
    || normalized === "database64"
    || normalized === "payloadbase64"
    || normalized === "bodybase64"
  );
}

/**
 * Produces a JSON-only copy while removing state that belongs to the current
 * policy lease/browser session. Imported projects must ask for rights again;
 * credentials and undo snapshots must never travel in a recovery sidecar.
 */
function sanitizedJsonValue(
  value: unknown,
  label: string,
  { removeSensitive = true }: { removeSensitive?: boolean } = {}
): SessionArchiveJsonValue {
  const active = new Set<object>();
  let visitedNodes = 0;

  const visit = (candidate: unknown, depth: number): SessionArchiveJsonValue => {
    visitedNodes += 1;
    if (visitedNodes > SESSION_ARCHIVE_MAX_NODES) {
      fail(`${label}의 항목 수가 허용 범위를 넘었습니다.`);
    }
    if (depth > SESSION_ARCHIVE_MAX_DEPTH) {
      fail(`${label}의 중첩 깊이가 허용 범위를 넘었습니다.`);
    }
    if (
      candidate === null
      || typeof candidate === "string"
      || typeof candidate === "boolean"
    ) {
      return candidate;
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) {
        fail(`${label}에는 유한하지 않은 숫자를 저장할 수 없습니다.`);
      }
      return candidate;
    }
    if (
      typeof candidate === "undefined"
      || typeof candidate === "function"
      || typeof candidate === "symbol"
      || typeof candidate === "bigint"
    ) {
      fail(`${label}에는 JSON으로 표현할 수 없는 값이 있습니다.`);
    }
    if (
      candidate instanceof Blob
      || candidate instanceof ArrayBuffer
      || ArrayBuffer.isView(candidate)
    ) {
      fail(`${label}에는 미디어 또는 바이너리 본문을 직접 넣을 수 없습니다.`);
    }
    if (typeof candidate !== "object") {
      fail(`${label}에 지원하지 않는 값이 있습니다.`);
    }
    if (active.has(candidate)) {
      fail(`${label}에는 순환 참조를 저장할 수 없습니다.`);
    }
    active.add(candidate);
    try {
      if (Array.isArray(candidate)) {
        return candidate.map((entry) => visit(entry, depth + 1));
      }
      if (!isPlainRecord(candidate)) {
        fail(`${label}에는 일반 JSON 객체만 저장할 수 있습니다.`);
      }
      const result: SessionArchiveJsonObject = {};
      for (const key of Object.keys(candidate)) {
        if (
          key === "__proto__"
          || key === "prototype"
          || key === "constructor"
        ) {
          if (!removeSensitive) {
            fail(`${label}에 안전하지 않은 객체 필드가 있습니다.`);
          }
          continue;
        }
        if (removeSensitive && isPerUseOrSensitiveField(key)) {
          continue;
        }
        const child = candidate[key];
        if (typeof child === "undefined") {
          continue;
        }
        result[key] = visit(child, depth + 1);
      }
      return result;
    } finally {
      active.delete(candidate);
    }
  };

  return visit(value, 0);
}

function jsonObject(
  value: unknown,
  label: string,
  options: { removeSensitive?: boolean } = {}
): SessionArchiveJsonObject {
  const sanitized = sanitizedJsonValue(value, label, options);
  if (!isPlainRecord(sanitized)) {
    fail(`${label}은 JSON 객체여야 합니다.`);
  }
  return sanitized;
}

function canonicalJson(value: SessionArchiveJsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key] as SessionArchiveJsonValue)}`
  )).join(",")}}`;
}

function utf8Bytes(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value);
}

function jsonByteLength(value: unknown, label: string): number {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail(`${label}을 JSON으로 직렬화할 수 없습니다.`);
  }
  return utf8Bytes(serialized).byteLength;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    fail("이 브라우저에서는 SHA-256 무결성 검사를 사용할 수 없습니다.");
  }
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Json(value: SessionArchiveJsonValue): Promise<string> {
  return sha256Hex(utf8Bytes(canonicalJson(value)));
}

function encodeBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] as number;
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = hasSecond ? bytes[index + 1] as number : 0;
    const third = hasThird ? bytes[index + 2] as number : 0;
    const packed = (first << 16) | (second << 8) | third;
    result += alphabet[(packed >>> 18) & 63];
    result += alphabet[(packed >>> 12) & 63];
    result += hasSecond ? alphabet[(packed >>> 6) & 63] : "=";
    result += hasThird ? alphabet[packed & 63] : "=";
  }
  return result;
}

function decodeBase64(value: unknown, label: string): Uint8Array<ArrayBuffer> {
  if (
    typeof value !== "string"
    || !value
    || value.length % 4 !== 0
    || !BASE64_PATTERN.test(value)
  ) {
    fail(`${label}의 Base64 데이터가 올바르지 않습니다.`);
  }
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array((value.length / 4) * 3 - padding);
  let outputIndex = 0;
  for (let index = 0; index < value.length; index += 4) {
    const a = alphabet.indexOf(value[index] as string);
    const b = alphabet.indexOf(value[index + 1] as string);
    const c = value[index + 2] === "="
      ? 0
      : alphabet.indexOf(value[index + 2] as string);
    const d = value[index + 3] === "="
      ? 0
      : alphabet.indexOf(value[index + 3] as string);
    const packed = (a << 18) | (b << 12) | (c << 6) | d;
    if (outputIndex < bytes.length) {
      bytes[outputIndex] = (packed >>> 16) & 255;
      outputIndex += 1;
    }
    if (outputIndex < bytes.length) {
      bytes[outputIndex] = (packed >>> 8) & 255;
      outputIndex += 1;
    }
    if (outputIndex < bytes.length) {
      bytes[outputIndex] = packed & 255;
      outputIndex += 1;
    }
  }
  if (encodeBase64(bytes) !== value) {
    fail(`${label}의 Base64 데이터가 canonical 형식이 아닙니다.`);
  }
  return bytes;
}

function normalizeImageMimeType(value: unknown, label: string): string {
  const requested = String(value || "").trim().toLowerCase();
  const mimeType = requested === "image/jpg" ? "image/jpeg" : requested;
  if (!IMAGE_MIME_TYPES.has(mimeType)) {
    fail(`${label}의 이미지 MIME 유형을 지원하지 않습니다.`);
  }
  return mimeType;
}

function sniffImageMimeType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  if (bytes.length >= 6) {
    const signature = String.fromCharCode(...bytes.slice(0, 6));
    if (signature === "GIF87a" || signature === "GIF89a") {
      return "image/gif";
    }
  }
  return null;
}

function assertImageMimeMatches(
  bytes: Uint8Array,
  mimeType: string,
  label: string
): void {
  if (sniffImageMimeType(bytes) !== mimeType) {
    fail(`${label}의 실제 이미지 형식과 MIME 유형이 일치하지 않습니다.`);
  }
}

function normalizedBlobKey(value: unknown, label: string): string {
  const blobKey = typeof value === "string" ? value.trim() : "";
  if (
    !blobKey
    || blobKey.length > MAX_BLOB_KEY_LENGTH
    || !SAFE_BLOB_KEY_PATTERN.test(blobKey)
  ) {
    fail(`${label}의 Blob 키가 올바르지 않습니다.`);
  }
  return blobKey;
}

function collectBlobImageReferences(
  values: readonly SessionArchiveJsonObject[]
): Map<string, string> {
  const references = new Map<string, string>();
  const pending: SessionArchiveJsonValue[] = [...values];
  let visited = 0;
  while (pending.length > 0) {
    const value = pending.pop() as SessionArchiveJsonValue;
    visited += 1;
    if (visited > SESSION_ARCHIVE_MAX_NODES) {
      fail("이미지 에셋 참조 수가 허용 범위를 넘었습니다.");
    }
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    if (!isPlainRecord(value)) {
      continue;
    }
    const source = value.source;
    if (isPlainRecord(source) && source.kind === "blob-key") {
      const blobKey = normalizedBlobKey(source.value, "이미지 에셋");
      const mimeType = normalizeImageMimeType(value.mimeType, `이미지 ${blobKey}`);
      const previousMimeType = references.get(blobKey);
      if (previousMimeType && previousMimeType !== mimeType) {
        fail(`같은 이미지 Blob 키 ${blobKey}가 서로 다른 MIME 유형을 가리킵니다.`);
      }
      references.set(blobKey, mimeType);
      if (references.size > SESSION_ARCHIVE_MAX_IMAGE_ASSETS) {
        fail(`이미지 에셋은 최대 ${SESSION_ARCHIVE_MAX_IMAGE_ASSETS}개까지 복원 파일에 넣을 수 있습니다.`);
      }
    }
    pending.push(...Object.values(value));
  }
  return references;
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value !== "string" || value.length > 64) {
    fail("세션 복원 파일의 생성 시각이 올바르지 않습니다.");
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    fail("세션 복원 파일의 생성 시각이 올바르지 않습니다.");
  }
  return new Date(parsed).toISOString();
}

function normalizeExportKind(value: unknown): SessionArchiveExportKind {
  if (value !== "main" && value !== "short-form") {
    fail("세션 복원 파일의 내보내기 종류가 올바르지 않습니다.");
  }
  return value;
}

function safeInteger(
  value: unknown,
  label: string,
  { positive = false }: { positive?: boolean } = {}
): number {
  if (
    !Number.isSafeInteger(value)
    || Number(value) < (positive ? 1 : 0)
  ) {
    fail(`${label} 값이 올바르지 않습니다.`);
  }
  return Number(value);
}

function normalizeOptionalSha256(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(`${label} SHA-256 값이 올바르지 않습니다.`);
  }
  return value;
}

function normalizeRecoverySource(value: unknown): SessionArchiveMediaSource | null {
  if (value === null) {
    return null;
  }
  const source = requirePlainRecord(value, "미디어 복구 원본");
  assertOnlyKeys(
    source,
    ["platform", "contentType", "contentId", "canonicalUrl"],
    "미디어 복구 원본"
  );
  const platform = String(source.platform || "").trim().toUpperCase();
  if (![...REMOTE_PLATFORMS, "LOCAL"].includes(platform)) {
    fail("미디어 복구 원본 플랫폼이 올바르지 않습니다.");
  }
  const contentType = String(source.contentType || "").trim().toLowerCase();
  if (!["vod", "live", "clip", "file"].includes(contentType)) {
    fail("미디어 복구 원본 종류가 올바르지 않습니다.");
  }
  const contentId = String(source.contentId || "").trim();
  const canonicalUrl = String(source.canonicalUrl || "").trim();
  if (platform === "LOCAL") {
    if (contentType !== "file" || contentId || canonicalUrl) {
      fail("로컬 파일 복구 원본 설명이 올바르지 않습니다.");
    }
  } else {
    if (
      contentType === "file"
      || !SAFE_CONTENT_ID_PATTERN.test(contentId)
      || canonicalUrl.length > MAX_SOURCE_URL_LENGTH
    ) {
      fail("원격 미디어 복구 원본 설명이 올바르지 않습니다.");
    }
    const inferred = inferSourceIdentifiers(canonicalUrl);
    if (
      !isSupportedSourceUrl(canonicalUrl)
      || inferred.platform !== platform
      || inferred.contentType !== contentType
      || inferred.contentId !== contentId
    ) {
      fail("미디어 복구 원본 URL과 플랫폼·콘텐츠 식별자가 서로 맞지 않습니다.");
    }
    const normalizedUrl = canonicalSourceUrl(canonicalUrl, inferred);
    if (!normalizedUrl) {
      fail("미디어 복구 원본 URL을 canonical 형식으로 만들지 못했습니다.");
    }
    return {
      platform: platform as SessionArchiveMediaSource["platform"],
      contentType: contentType as SessionArchiveMediaSource["contentType"],
      contentId: contentId.slice(0, MAX_SOURCE_ID_LENGTH),
      canonicalUrl: normalizedUrl
    };
  }
  return {
    platform: platform as SessionArchiveMediaSource["platform"],
    contentType: contentType as SessionArchiveMediaSource["contentType"],
    contentId: contentId.slice(0, MAX_SOURCE_ID_LENGTH),
    canonicalUrl
  };
}

function normalizeLocalMedia(value: unknown): SessionArchiveLocalMedia | null {
  if (value === null) {
    return null;
  }
  const media = requirePlainRecord(value, "로컬 미디어 설명");
  assertOnlyKeys(
    media,
    [
      "name",
      "mimeType",
      "sizeBytes",
      "lastModifiedMs",
      "sha256",
      "sampleSha256"
    ],
    "로컬 미디어 설명"
  );
  const name = String(media.name || "").trim();
  const mimeType = String(media.mimeType || "").trim().toLowerCase();
  if (
    !name
    || name.length > MAX_FILE_NAME_LENGTH
    || /[\\/\u0000-\u001f\u007f]/u.test(name)
  ) {
    fail("다시 연결할 로컬 미디어 파일명이 올바르지 않습니다.");
  }
  if (
    mimeType.length > MAX_MIME_TYPE_LENGTH
    || (mimeType && !/^(?:video|audio)\/[a-z0-9][a-z0-9.+-]*$/u.test(mimeType))
  ) {
    fail("다시 연결할 로컬 미디어 MIME 유형이 올바르지 않습니다.");
  }
  return {
    name,
    mimeType,
    sizeBytes: safeInteger(media.sizeBytes, "로컬 미디어 크기", { positive: true }),
    lastModifiedMs: safeInteger(media.lastModifiedMs, "로컬 미디어 수정 시각"),
    sha256: normalizeOptionalSha256(media.sha256, "로컬 미디어"),
    ...(Object.hasOwn(media, "sampleSha256")
      ? {
        sampleSha256: normalizeOptionalSha256(
          media.sampleSha256,
          "로컬 미디어 표본"
        )
      }
      : {})
  };
}

export function normalizeSessionArchiveMediaRecovery(
  value: unknown
): SessionArchiveMediaRecovery {
  const recovery = requirePlainRecord(value, "미디어 복구 설명");
  assertOnlyKeys(
    recovery,
    [
      "schema",
      "mode",
      "source",
      "localMedia",
      "materialization",
      "vodBytesIncluded"
    ],
    "미디어 복구 설명"
  );
  if (recovery.schema !== MEDIA_RECOVERY_SCHEMA) {
    fail("미디어 복구 설명 형식이 올바르지 않습니다.");
  }
  const mode = String(recovery.mode || "") as SessionArchiveMediaRecoveryMode;
  if (!RECOVERY_MODES.has(mode)) {
    fail("미디어 복구 방식이 올바르지 않습니다.");
  }
  if (recovery.vodBytesIncluded !== false) {
    fail("세션 복원 파일에는 다운로드한 VOD 본문을 넣을 수 없습니다.");
  }
  const source = normalizeRecoverySource(recovery.source);
  const localMedia = normalizeLocalMedia(recovery.localMedia);
  const materialization = recovery.materialization === null
    ? null
    : jsonObject(recovery.materialization, "미디어 materialization 설명");
  if (
    materialization
    && jsonByteLength(materialization, "미디어 materialization 설명")
      > SESSION_ARCHIVE_MAX_MATERIALIZATION_JSON_BYTES
  ) {
    fail("미디어 materialization 설명이 허용 크기를 넘었습니다.");
  }
  if (
    (mode === "none" && (source || localMedia || materialization))
    || (mode === "reconnect-local-file" && !localMedia)
    || (
      mode === "redownload-vod"
      && (
        !source
        || !REMOTE_PLATFORMS.has(source.platform)
        || source.contentType !== "vod"
      )
    )
  ) {
    fail("미디어 복구 방식과 복구 설명이 서로 맞지 않습니다.");
  }
  return {
    schema: MEDIA_RECOVERY_SCHEMA,
    mode,
    source,
    localMedia,
    materialization,
    vodBytesIncluded: false
  };
}

async function buildImageAssets(
  references: Map<string, string>,
  resolver: ResolveSessionArchiveImageAssetBlob
): Promise<SessionArchiveImageAsset[]> {
  if (typeof resolver !== "function") {
    fail("이미지 에셋 Blob을 읽는 함수가 필요합니다.");
  }
  const imageAssets: SessionArchiveImageAsset[] = [];
  let totalBytes = 0;
  for (const [blobKey, mimeType] of [...references].sort(([left], [right]) => (
    left.localeCompare(right)
  ))) {
    const blob = await resolver(blobKey);
    if (!(blob instanceof Blob) || blob.size <= 0) {
      fail(`이미지 에셋 ${blobKey}의 Blob을 읽지 못했습니다.`);
    }
    if (blob.size > SESSION_ARCHIVE_MAX_IMAGE_ASSET_BYTES) {
      fail(`이미지 에셋 ${blobKey}가 개별 허용 크기를 넘었습니다.`);
    }
    totalBytes += blob.size;
    if (totalBytes > SESSION_ARCHIVE_MAX_TOTAL_IMAGE_ASSET_BYTES) {
      fail("이미지 에셋 전체 크기가 허용 범위를 넘었습니다.");
    }
    const blobMimeType = blob.type
      ? normalizeImageMimeType(blob.type, `이미지 ${blobKey}`)
      : mimeType;
    if (blobMimeType !== mimeType) {
      fail(`이미지 에셋 ${blobKey}의 Blob MIME 유형이 프로젝트와 다릅니다.`);
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    assertImageMimeMatches(bytes, mimeType, `이미지 ${blobKey}`);
    imageAssets.push({
      blobKey,
      mimeType,
      sizeBytes: bytes.byteLength,
      sha256: await sha256Hex(new Uint8Array(bytes)),
      dataBase64: encodeBase64(bytes)
    });
  }
  return imageAssets;
}

async function normalizeImageAssets(
  value: unknown,
  references: Map<string, string>
): Promise<SessionArchiveImageAsset[]> {
  if (!Array.isArray(value)) {
    fail("세션 복원 파일의 이미지 에셋 목록이 올바르지 않습니다.");
  }
  if (value.length > SESSION_ARCHIVE_MAX_IMAGE_ASSETS) {
    fail(`이미지 에셋은 최대 ${SESSION_ARCHIVE_MAX_IMAGE_ASSETS}개까지 복원할 수 있습니다.`);
  }
  const pendingAssets: Array<{
    blobKey: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    dataBase64: unknown;
    label: string;
  }> = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const [index, rawAsset] of value.entries()) {
    const label = `이미지 에셋 ${index + 1}`;
    const asset = requirePlainRecord(rawAsset, label);
    assertOnlyKeys(
      asset,
      ["blobKey", "mimeType", "sizeBytes", "sha256", "dataBase64"],
      label
    );
    const blobKey = normalizedBlobKey(asset.blobKey, label);
    if (seen.has(blobKey)) {
      fail(`이미지 Blob 키 ${blobKey}가 복원 파일에 중복되어 있습니다.`);
    }
    seen.add(blobKey);
    const mimeType = normalizeImageMimeType(asset.mimeType, label);
    const expectedMimeType = references.get(blobKey);
    if (!expectedMimeType || expectedMimeType !== mimeType) {
      fail(`${label}이 프로젝트의 이미지 Blob 참조와 일치하지 않습니다.`);
    }
    const sizeBytes = safeInteger(asset.sizeBytes, `${label} 크기`, { positive: true });
    if (sizeBytes > SESSION_ARCHIVE_MAX_IMAGE_ASSET_BYTES) {
      fail(`${label}이 개별 허용 크기를 넘었습니다.`);
    }
    totalBytes += sizeBytes;
    if (totalBytes > SESSION_ARCHIVE_MAX_TOTAL_IMAGE_ASSET_BYTES) {
      fail("이미지 에셋 전체 크기가 허용 범위를 넘었습니다.");
    }
    const sha256 = normalizeOptionalSha256(asset.sha256, label);
    if (!sha256) {
      fail(`${label}에 SHA-256이 없습니다.`);
    }
    pendingAssets.push({
      blobKey,
      mimeType,
      sizeBytes,
      sha256,
      dataBase64: asset.dataBase64,
      label
    });
  }
  if (
    pendingAssets.length !== references.size
    || [...references.keys()].some((blobKey) => !seen.has(blobKey))
  ) {
    fail("프로젝트에서 참조하는 이미지 Blob이 복원 파일에 모두 들어 있지 않습니다.");
  }

  const assets: SessionArchiveImageAsset[] = [];
  for (const pending of pendingAssets) {
    const {
      blobKey,
      mimeType,
      sizeBytes,
      sha256,
      dataBase64,
      label
    } = pending;
    const bytes = decodeBase64(dataBase64, label);
    if (bytes.byteLength !== sizeBytes) {
      fail(`${label}의 Base64 바이트 수와 기록된 크기가 다릅니다.`);
    }
    assertImageMimeMatches(bytes, mimeType, label);
    if (await sha256Hex(bytes) !== sha256) {
      fail(`${label}의 SHA-256 무결성 검증에 실패했습니다.`, "SESSION_ARCHIVE_INTEGRITY_FAILED");
    }
    assets.push({
      blobKey,
      mimeType,
      sizeBytes,
      sha256,
      dataBase64: String(dataBase64)
    });
  }
  return assets.sort((left, right) => left.blobKey.localeCompare(right.blobKey));
}

function payloadAsJson(payload: SessionArchivePayload): SessionArchiveJsonObject {
  return jsonObject(payload, "세션 복원 파일 payload", {
    removeSensitive: false
  });
}

function isRestorableEditorProject(
  value: SessionArchiveJsonObject
): value is SessionArchiveJsonObject & EditorProject {
  return (
    typeof value.id === "string"
    && Boolean(value.id.trim())
    && normalizeEditorProject(value) !== null
  );
}

async function withIntegrity(payload: SessionArchivePayload): Promise<SessionArchive> {
  return {
    ...payload,
    integrity: {
      algorithm: SESSION_ARCHIVE_INTEGRITY_ALGORITHM,
      sha256: await sha256Json(payloadAsJson(payload))
    }
  };
}

function assertArchiveSize(value: unknown): void {
  if (jsonByteLength(value, "세션 복원 파일") > SESSION_ARCHIVE_MAX_JSON_BYTES) {
    fail("세션 복원 파일이 허용 크기를 넘었습니다.", "SESSION_ARCHIVE_TOO_LARGE");
  }
}

export async function buildSessionArchive({
  rootProject,
  exportKind,
  exportSnapshot,
  mediaRecovery,
  resolveImageAssetBlob,
  createdAt = new Date().toISOString()
}: BuildSessionArchiveInput): Promise<SessionArchive> {
  const sanitizedRootProject = jsonObject(rootProject, "루트 편집 프로젝트");
  if (!isRestorableEditorProject(sanitizedRootProject)) {
    fail("루트 편집 프로젝트 형식 또는 ID가 올바르지 않습니다.");
  }
  const sanitizedExportSnapshot = jsonObject(exportSnapshot, "내보내기 스냅샷");
  const references = collectBlobImageReferences([
    sanitizedRootProject,
    sanitizedExportSnapshot
  ]);
  const payload: SessionArchivePayload = {
    schema: SESSION_ARCHIVE_SCHEMA,
    createdAt: normalizeTimestamp(createdAt),
    exportKind: normalizeExportKind(exportKind),
    rootProject: sanitizedRootProject,
    exportSnapshot: sanitizedExportSnapshot,
    imageAssets: await buildImageAssets(references, resolveImageAssetBlob),
    mediaRecovery: normalizeSessionArchiveMediaRecovery(mediaRecovery)
  };
  const archive = await withIntegrity(payload);
  assertArchiveSize(archive);
  return archive;
}

export async function normalizeSessionArchive(value: unknown): Promise<SessionArchive> {
  const archive = requirePlainRecord(value, "세션 복원 파일");
  if (archive.schema !== SESSION_ARCHIVE_SCHEMA) {
    throw new UnsupportedSessionArchiveSchemaError(archive.schema);
  }
  assertOnlyKeys(
    archive,
    [
      "schema",
      "createdAt",
      "exportKind",
      "rootProject",
      "exportSnapshot",
      "imageAssets",
      "mediaRecovery",
      "integrity"
    ],
    "세션 복원 파일"
  );
  assertArchiveSize(archive);
  const integrity = requirePlainRecord(archive.integrity, "세션 복원 파일 무결성");
  assertOnlyKeys(integrity, ["algorithm", "sha256"], "세션 복원 파일 무결성");
  if (
    integrity.algorithm !== SESSION_ARCHIVE_INTEGRITY_ALGORITHM
    || typeof integrity.sha256 !== "string"
    || !SHA256_PATTERN.test(integrity.sha256)
  ) {
    fail("세션 복원 파일의 SHA-256 정보가 올바르지 않습니다.");
  }
  const receivedPayload = jsonObject({
    schema: archive.schema,
    createdAt: archive.createdAt,
    exportKind: archive.exportKind,
    rootProject: archive.rootProject,
    exportSnapshot: archive.exportSnapshot,
    imageAssets: archive.imageAssets,
    mediaRecovery: archive.mediaRecovery
  }, "세션 복원 파일 payload", { removeSensitive: false });
  const rootProject = jsonObject(archive.rootProject, "루트 편집 프로젝트");
  if (!isRestorableEditorProject(rootProject)) {
    fail("루트 편집 프로젝트 형식 또는 ID가 올바르지 않습니다.");
  }
  const exportSnapshot = jsonObject(archive.exportSnapshot, "내보내기 스냅샷");
  const references = collectBlobImageReferences([rootProject, exportSnapshot]);
  const payload: SessionArchivePayload = {
    schema: SESSION_ARCHIVE_SCHEMA,
    createdAt: normalizeTimestamp(archive.createdAt),
    exportKind: normalizeExportKind(archive.exportKind),
    rootProject,
    exportSnapshot,
    imageAssets: await normalizeImageAssets(archive.imageAssets, references),
    mediaRecovery: normalizeSessionArchiveMediaRecovery(archive.mediaRecovery)
  };
  const receivedSha256 = await sha256Json(receivedPayload);
  if (receivedSha256 !== integrity.sha256) {
    fail(
      "세션 복원 파일 전체의 SHA-256 무결성 검증에 실패했습니다.",
      "SESSION_ARCHIVE_INTEGRITY_FAILED"
    );
  }
  const sanitizedSha256 = await sha256Json(payloadAsJson(payload));
  return {
    ...payload,
    integrity: {
      algorithm: SESSION_ARCHIVE_INTEGRITY_ALGORITHM,
      sha256: sanitizedSha256
    }
  };
}

export async function verifySessionArchive(value: unknown): Promise<SessionArchive> {
  return normalizeSessionArchive(value);
}

export async function parseSessionArchiveJson(value: string): Promise<SessionArchive> {
  if (typeof value !== "string") {
    fail("세션 복원 파일은 JSON 문자열이어야 합니다.");
  }
  if (utf8Bytes(value).byteLength > SESSION_ARCHIVE_MAX_JSON_BYTES) {
    fail("세션 복원 파일이 허용 크기를 넘었습니다.", "SESSION_ARCHIVE_TOO_LARGE");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    fail("세션 복원 파일 JSON을 읽지 못했습니다.");
  }
  return normalizeSessionArchive(parsed);
}

export async function stringifySessionArchive(value: unknown): Promise<string> {
  const archive = await normalizeSessionArchive(value);
  const serialized = JSON.stringify(archive, null, 2);
  if (utf8Bytes(serialized).byteLength > SESSION_ARCHIVE_MAX_JSON_BYTES) {
    fail("세션 복원 파일이 허용 크기를 넘었습니다.", "SESSION_ARCHIVE_TOO_LARGE");
  }
  return serialized;
}

export async function restoreSessionArchiveProject(
  value: unknown
): Promise<EditorProject> {
  const archive = await normalizeSessionArchive(value);
  return structuredClone(archive.rootProject);
}

export async function restoreSessionArchiveImageBlobs(
  value: unknown
): Promise<Map<string, Blob>> {
  const archive = await normalizeSessionArchive(value);
  return new Map(archive.imageAssets.map((asset) => [
    asset.blobKey,
    new Blob([decodeBase64(asset.dataBase64, `이미지 ${asset.blobKey}`)], {
      type: asset.mimeType
    })
  ]));
}
