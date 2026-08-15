import { SUPPORTED_IMAGE_ASSET_MIME_TYPES } from "./editor-core.js";

export const ORIGIN_STORAGE_MIGRATION_SCHEMA =
  "kirinuki-origin-storage-migration/v1" as const;
export const ORIGIN_STORAGE_MIGRATION_INTEGRITY_ALGORITHM =
  "SHA-256" as const;
export const ORIGIN_STORAGE_MIGRATION_TARGET_ORIGIN =
  "http://127.0.0.1:4320" as const;

export const ORIGIN_STORAGE_MIGRATION_MAX_PROJECTS = 64;
export const ORIGIN_STORAGE_MIGRATION_MAX_LOCAL_DRAFTS = 320;
export const ORIGIN_STORAGE_MIGRATION_MAX_IMAGE_ASSETS = 256;
export const ORIGIN_STORAGE_MIGRATION_MAX_IMAGE_ASSET_BYTES =
  25 * 1024 * 1024;
export const ORIGIN_STORAGE_MIGRATION_MAX_TOTAL_IMAGE_ASSET_BYTES =
  64 * 1024 * 1024;
export const ORIGIN_STORAGE_MIGRATION_MAX_JSON_BYTES = 96 * 1024 * 1024;

const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 250_000;
const MAX_RECORD_ID_LENGTH = 512;
const MAX_MIME_TYPE_LENGTH = 128;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const BASE64URL_256_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const EXTENSION_ORIGIN_PATTERN = /^chrome-extension:\/\/[a-p]{32}$/u;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const IMAGE_MIME_TYPES = new Set<string>(SUPPORTED_IMAGE_ASSET_MIME_TYPES);

type JsonPrimitive = string | number | boolean | null;
export type OriginMigrationJsonValue =
  | JsonPrimitive
  | OriginMigrationJsonValue[]
  | { [key: string]: OriginMigrationJsonValue };
export type OriginMigrationJsonObject = {
  [key: string]: OriginMigrationJsonValue;
};

export interface OriginStorageMigrationImageInput {
  key: readonly [string, string];
  blob: Blob;
}

export interface OriginStorageMigrationSnapshot {
  sourceOrigin: string;
  databaseName: string;
  databaseVersion: number;
  projects: readonly unknown[];
  localDrafts: readonly unknown[];
  imageAssets: readonly OriginStorageMigrationImageInput[];
  transferId?: string;
  createdAt?: string;
}

export interface OriginStorageMigrationImageAsset {
  key: [string, string];
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  dataBase64: string;
}

export interface OriginStorageMigrationPayload {
  schema: typeof ORIGIN_STORAGE_MIGRATION_SCHEMA;
  transferId: string;
  createdAt: string;
  source: {
    origin: string;
    databaseName: string;
    databaseVersion: number;
  };
  target: {
    origin: typeof ORIGIN_STORAGE_MIGRATION_TARGET_ORIGIN;
  };
  stores: {
    projects: OriginMigrationJsonObject[];
    localDrafts: OriginMigrationJsonObject[];
    imageAssets: OriginStorageMigrationImageAsset[];
  };
}

export interface OriginStorageMigrationEnvelope
  extends OriginStorageMigrationPayload {
  integrity: {
    algorithm: typeof ORIGIN_STORAGE_MIGRATION_INTEGRITY_ALGORITHM;
    sha256: string;
  };
}

export interface MaterializedOriginStorageMigration {
  envelope: OriginStorageMigrationEnvelope;
  projects: OriginMigrationJsonObject[];
  localDrafts: OriginMigrationJsonObject[];
  imageAssets: Array<{
    key: [string, string];
    blob: Blob;
  }>;
}

type UnknownRecord = Record<string, unknown>;

export class OriginStorageMigrationError extends Error {
  override readonly name = "OriginStorageMigrationError";
  readonly code: string;

  constructor(message: string, code = "INVALID_ORIGIN_STORAGE_MIGRATION") {
    super(message);
    this.code = code;
  }
}

function fail(message: string, code?: string): never {
  throw new OriginStorageMigrationError(message, code);
}

function isPlainRecord(value: unknown): value is UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredRecord(value: unknown, label: string): UnknownRecord {
  if (!isPlainRecord(value)) {
    fail(`${label}은 JSON 객체여야 합니다.`);
  }
  return value;
}

function assertOnlyKeys(
  value: UnknownRecord,
  allowedKeys: readonly string[],
  label: string
): void {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) {
    fail(`${label}에 지원하지 않는 필드가 있습니다: ${unexpected}`);
  }
}

function requiredText(
  value: unknown,
  label: string,
  maxLength = MAX_RECORD_ID_LENGTH
): string {
  if (
    typeof value !== "string"
    || !value
    || value.trim() !== value
    || value.length > maxLength
    || /[\0\r\n]/u.test(value)
  ) {
    fail(`${label}이(가) 올바르지 않습니다.`);
  }
  return value;
}

function requiredRecordId(value: unknown, label: string): string {
  return requiredText(value, label);
}

function cloneJsonObject(value: unknown, label: string): OriginMigrationJsonObject {
  const active = new Set<object>();
  let visited = 0;

  const visit = (candidate: unknown, depth: number): OriginMigrationJsonValue => {
    visited += 1;
    if (visited > MAX_JSON_NODES) {
      fail(`${label}의 항목 수가 허용 범위를 넘었습니다.`);
    }
    if (depth > MAX_JSON_DEPTH) {
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
      fail(`${label}에는 Blob·파일 핸들·바이너리를 직접 넣을 수 없습니다.`);
    }
    if (
      typeof candidate !== "object"
      || (!Array.isArray(candidate) && !isPlainRecord(candidate))
    ) {
      fail(`${label}에는 일반 JSON 객체와 배열만 저장할 수 있습니다.`);
    }
    if (active.has(candidate)) {
      fail(`${label}에는 순환 참조를 저장할 수 없습니다.`);
    }
    active.add(candidate);
    try {
      if (Array.isArray(candidate)) {
        return candidate.map((entry) => visit(entry, depth + 1));
      }
      const result: OriginMigrationJsonObject = {};
      for (const key of Object.keys(candidate)) {
        if (
          key === "__proto__"
          || key === "prototype"
          || key === "constructor"
        ) {
          fail(`${label}에 안전하지 않은 객체 필드가 있습니다.`);
        }
        result[key] = visit(candidate[key], depth + 1);
      }
      return result;
    } finally {
      active.delete(candidate);
    }
  };

  const result = visit(value, 0);
  if (!isPlainRecord(result)) {
    fail(`${label}은 JSON 객체여야 합니다.`);
  }
  return result;
}

function canonicalJson(value: unknown): string {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("무결성 계산 대상에 유한하지 않은 숫자가 있습니다.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (!isPlainRecord(value)) {
    fail("무결성 계산 대상이 JSON 값이 아닙니다.");
  }
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(",")}}`;
}

function encodedJsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    let text = "";
    for (const byte of chunk) {
      text += String.fromCharCode(byte);
    }
    chunks.push(text);
  }
  return btoa(chunks.join(""));
}

function base64ToBytes(
  value: string,
  expectedBytes: number
): Uint8Array<ArrayBuffer> {
  if (!BASE64_PATTERN.test(value)) {
    fail("이미지 에셋 base64 본문이 올바르지 않습니다.");
  }
  const maximumEncodedLength = Math.ceil(expectedBytes / 3) * 4;
  if (value.length !== maximumEncodedLength) {
    fail("이미지 에셋 base64 길이가 선언된 크기와 다릅니다.");
  }
  let decoded: string;
  try {
    decoded = atob(value);
  } catch {
    fail("이미지 에셋 base64 본문을 해석하지 못했습니다.");
  }
  if (decoded.length !== expectedBytes) {
    fail("이미지 에셋 본문 크기가 선언된 크기와 다릅니다.");
  }
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", owned.buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function payloadSha256(payload: OriginStorageMigrationPayload): Promise<string> {
  const canonical = canonicalJson(payload);
  return sha256Hex(new TextEncoder().encode(canonical));
}

function createTransferId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

function requiredExtensionOrigin(value: unknown): string {
  const origin = requiredText(value, "Extension origin", 128);
  if (!EXTENSION_ORIGIN_PATTERN.test(origin)) {
    fail("마이그레이션 원본은 정확한 Chrome Extension origin이어야 합니다.");
  }
  return origin;
}

function requiredCreatedAt(value: unknown): string {
  if (
    typeof value !== "string"
    || !ISO_INSTANT_PATTERN.test(value)
    || !Number.isFinite(Date.parse(value))
  ) {
    fail("마이그레이션 생성 시각이 올바른 UTC ISO 문자열이 아닙니다.");
  }
  return value;
}

function requiredTransferId(value: unknown): string {
  if (typeof value !== "string" || !BASE64URL_256_PATTERN.test(value)) {
    fail("마이그레이션 transfer ID가 올바르지 않습니다.");
  }
  return value;
}

function validatedJsonRecords(
  value: unknown,
  label: string,
  maximum: number
): OriginMigrationJsonObject[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
    fail(`${label} 개수가 허용 범위를 벗어났습니다.`);
  }
  return value.map((entry, index) => cloneJsonObject(
    entry,
    `${label} ${index + 1}`
  ));
}

function validateProjectAndDraftRecords(
  projects: readonly OriginMigrationJsonObject[],
  localDrafts: readonly OriginMigrationJsonObject[]
): Set<string> {
  const projectIds = new Set<string>();
  for (const project of projects) {
    const id = requiredRecordId(project.id, "프로젝트 ID");
    if (projectIds.has(id)) {
      fail(`중복된 프로젝트 ID가 있습니다: ${id}`);
    }
    projectIds.add(id);
  }

  const draftIds = new Set<string>();
  for (const draft of localDrafts) {
    if (Object.prototype.hasOwnProperty.call(draft, "mediaHandleBinding")) {
      fail(
        "브라우저 로컬 파일 핸들 결합은 origin 마이그레이션으로 가져올 수 없습니다."
      );
    }
    const id = requiredRecordId(draft.id, "로컬 임시저장 ID");
    const projectId = requiredRecordId(
      draft.projectId,
      "로컬 임시저장 프로젝트 ID"
    );
    if (draftIds.has(id)) {
      fail(`중복된 로컬 임시저장 ID가 있습니다: ${id}`);
    }
    if (!projectIds.has(projectId)) {
      fail(`로컬 임시저장이 알 수 없는 프로젝트를 가리킵니다: ${projectId}`);
    }
    const embeddedProject = requiredRecord(
      draft.project,
      `로컬 임시저장 ${id}의 프로젝트`
    );
    if (requiredRecordId(embeddedProject.id, "임시저장 내부 프로젝트 ID") !== projectId) {
      fail(`로컬 임시저장 ${id}의 프로젝트 ID가 내부 스냅샷과 다릅니다.`);
    }
    draftIds.add(id);
  }
  return projectIds;
}

/**
 * FileSystemFileHandle is intentionally browser-origin local. Local draft
 * records may contain an exact handle binding for same-origin recovery, but a
 * portable migration must neither serialize nor imply that authority.
 */
function portableLocalDraftRecord(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const {
    mediaHandleBinding: _browserLocalMediaHandleBinding,
    ...portable
  } = value as Record<string, unknown>;
  return portable;
}

function requiredImageKey(
  value: unknown,
  projectIds: ReadonlySet<string>
): [string, string] {
  if (!Array.isArray(value) || value.length !== 2) {
    fail("이미지 에셋 키는 [projectId, assetId]여야 합니다.");
  }
  const projectId = requiredRecordId(value[0], "이미지 에셋 프로젝트 ID");
  const assetId = requiredRecordId(value[1], "이미지 에셋 ID");
  if (!projectIds.has(projectId)) {
    fail(`이미지 에셋이 알 수 없는 프로젝트를 가리킵니다: ${projectId}`);
  }
  return [projectId, assetId];
}

function requiredImageMetadata(
  value: UnknownRecord,
  projectIds: ReadonlySet<string>
): Omit<OriginStorageMigrationImageAsset, "dataBase64"> & {
  dataBase64: string;
} {
  assertOnlyKeys(
    value,
    ["key", "mimeType", "sizeBytes", "sha256", "dataBase64"],
    "이미지 에셋"
  );
  const key = requiredImageKey(value.key, projectIds);
  const mimeType = requiredText(
    value.mimeType,
    "이미지 에셋 MIME 타입",
    MAX_MIME_TYPE_LENGTH
  ).toLowerCase();
  if (!IMAGE_MIME_TYPES.has(mimeType)) {
    fail(`지원하지 않는 이미지 에셋 MIME 타입입니다: ${mimeType}`);
  }
  if (
    typeof value.sizeBytes !== "number"
    || !Number.isSafeInteger(value.sizeBytes)
    || value.sizeBytes <= 0
    || value.sizeBytes > ORIGIN_STORAGE_MIGRATION_MAX_IMAGE_ASSET_BYTES
  ) {
    fail("이미지 에셋 크기가 허용 범위를 벗어났습니다.");
  }
  if (typeof value.sha256 !== "string" || !SHA256_PATTERN.test(value.sha256)) {
    fail("이미지 에셋 SHA-256이 올바르지 않습니다.");
  }
  if (typeof value.dataBase64 !== "string") {
    fail("이미지 에셋 base64 본문이 없습니다.");
  }
  return {
    key,
    mimeType,
    sizeBytes: value.sizeBytes,
    sha256: value.sha256,
    dataBase64: value.dataBase64
  };
}

function assertEnvelopeJsonSize(value: unknown): void {
  if (encodedJsonBytes(value) > ORIGIN_STORAGE_MIGRATION_MAX_JSON_BYTES) {
    fail(
      "마이그레이션 JSON이 허용 크기를 넘었습니다.",
      "ORIGIN_STORAGE_MIGRATION_TOO_LARGE"
    );
  }
}

export async function buildOriginStorageMigration(
  snapshot: OriginStorageMigrationSnapshot
): Promise<OriginStorageMigrationEnvelope> {
  const projects = validatedJsonRecords(
    snapshot.projects,
    "프로젝트",
    ORIGIN_STORAGE_MIGRATION_MAX_PROJECTS
  );
  const localDrafts = Array.isArray(snapshot.localDrafts)
    && snapshot.localDrafts.length === 0
    ? []
    : validatedJsonRecords(
      snapshot.localDrafts.map(portableLocalDraftRecord),
      "로컬 임시저장",
      ORIGIN_STORAGE_MIGRATION_MAX_LOCAL_DRAFTS
    );
  const projectIds = validateProjectAndDraftRecords(projects, localDrafts);
  if (
    !Array.isArray(snapshot.imageAssets)
    || snapshot.imageAssets.length > ORIGIN_STORAGE_MIGRATION_MAX_IMAGE_ASSETS
  ) {
    fail("이미지 에셋 개수가 허용 범위를 벗어났습니다.");
  }

  let totalImageBytes = 0;
  const imageKeys = new Set<string>();
  const imageAssets: OriginStorageMigrationImageAsset[] = [];
  for (const input of snapshot.imageAssets) {
    const key = requiredImageKey(input.key, projectIds);
    const keyIdentity = JSON.stringify(key);
    if (imageKeys.has(keyIdentity)) {
      fail(`중복된 이미지 에셋 키가 있습니다: ${keyIdentity}`);
    }
    if (
      !(input.blob instanceof Blob)
      || input.blob.size <= 0
      || input.blob.size > ORIGIN_STORAGE_MIGRATION_MAX_IMAGE_ASSET_BYTES
    ) {
      fail("이미지 에셋 Blob 크기가 허용 범위를 벗어났습니다.");
    }
    const mimeType = requiredText(
      input.blob.type,
      "이미지 에셋 MIME 타입",
      MAX_MIME_TYPE_LENGTH
    ).toLowerCase();
    if (!IMAGE_MIME_TYPES.has(mimeType)) {
      fail(`지원하지 않는 이미지 에셋 MIME 타입입니다: ${mimeType}`);
    }
    totalImageBytes += input.blob.size;
    if (totalImageBytes > ORIGIN_STORAGE_MIGRATION_MAX_TOTAL_IMAGE_ASSET_BYTES) {
      fail("이미지 에셋 전체 크기가 허용 범위를 넘었습니다.");
    }
    const bytes = new Uint8Array(await input.blob.arrayBuffer());
    imageAssets.push({
      key,
      mimeType,
      sizeBytes: bytes.byteLength,
      sha256: await sha256Hex(bytes),
      dataBase64: bytesToBase64(bytes)
    });
    imageKeys.add(keyIdentity);
  }

  const databaseVersion = Number(snapshot.databaseVersion);
  if (!Number.isSafeInteger(databaseVersion) || databaseVersion < 1) {
    fail("원본 IndexedDB 버전이 올바르지 않습니다.");
  }
  const payload: OriginStorageMigrationPayload = {
    schema: ORIGIN_STORAGE_MIGRATION_SCHEMA,
    transferId: requiredTransferId(snapshot.transferId || createTransferId()),
    createdAt: requiredCreatedAt(snapshot.createdAt || new Date().toISOString()),
    source: {
      origin: requiredExtensionOrigin(snapshot.sourceOrigin),
      databaseName: requiredText(
        snapshot.databaseName,
        "원본 IndexedDB 이름",
        128
      ),
      databaseVersion
    },
    target: {
      origin: ORIGIN_STORAGE_MIGRATION_TARGET_ORIGIN
    },
    stores: {
      projects,
      localDrafts,
      imageAssets
    }
  };
  const envelope: OriginStorageMigrationEnvelope = {
    ...payload,
    integrity: {
      algorithm: ORIGIN_STORAGE_MIGRATION_INTEGRITY_ALGORITHM,
      sha256: await payloadSha256(payload)
    }
  };
  assertEnvelopeJsonSize(envelope);
  return envelope;
}

export async function parseOriginStorageMigration(
  value: unknown,
  {
    expectedSourceOrigin,
    expectedTargetOrigin = ORIGIN_STORAGE_MIGRATION_TARGET_ORIGIN
  }: {
    expectedSourceOrigin?: string;
    expectedTargetOrigin?: string;
  } = {}
): Promise<MaterializedOriginStorageMigration> {
  assertEnvelopeJsonSize(value);
  const envelope = requiredRecord(value, "마이그레이션 봉투");
  assertOnlyKeys(
    envelope,
    ["schema", "transferId", "createdAt", "source", "target", "stores", "integrity"],
    "마이그레이션 봉투"
  );
  if (envelope.schema !== ORIGIN_STORAGE_MIGRATION_SCHEMA) {
    fail(
      `지원하지 않는 마이그레이션 스키마입니다: ${String(envelope.schema || "(없음)")}`,
      "UNSUPPORTED_ORIGIN_STORAGE_MIGRATION_SCHEMA"
    );
  }
  const transferId = requiredTransferId(envelope.transferId);
  const createdAt = requiredCreatedAt(envelope.createdAt);

  const source = requiredRecord(envelope.source, "마이그레이션 원본");
  assertOnlyKeys(source, ["origin", "databaseName", "databaseVersion"], "마이그레이션 원본");
  const sourceOrigin = requiredExtensionOrigin(source.origin);
  if (expectedSourceOrigin !== undefined && sourceOrigin !== expectedSourceOrigin) {
    fail("마이그레이션 원본 Extension origin이 현재 빌드와 다릅니다.");
  }
  const databaseName = requiredText(source.databaseName, "원본 IndexedDB 이름", 128);
  if (
    typeof source.databaseVersion !== "number"
    || !Number.isSafeInteger(source.databaseVersion)
    || source.databaseVersion < 1
  ) {
    fail("원본 IndexedDB 버전이 올바르지 않습니다.");
  }

  const target = requiredRecord(envelope.target, "마이그레이션 대상");
  assertOnlyKeys(target, ["origin"], "마이그레이션 대상");
  if (
    target.origin !== ORIGIN_STORAGE_MIGRATION_TARGET_ORIGIN
    || target.origin !== expectedTargetOrigin
  ) {
    fail("마이그레이션 대상은 고정된 Kirinuki loopback origin이어야 합니다.");
  }

  const stores = requiredRecord(envelope.stores, "마이그레이션 스토어");
  assertOnlyKeys(stores, ["projects", "localDrafts", "imageAssets"], "마이그레이션 스토어");
  const projects = validatedJsonRecords(
    stores.projects,
    "프로젝트",
    ORIGIN_STORAGE_MIGRATION_MAX_PROJECTS
  );
  const localDrafts = Array.isArray(stores.localDrafts)
    && stores.localDrafts.length === 0
    ? []
    : validatedJsonRecords(
      stores.localDrafts,
      "로컬 임시저장",
      ORIGIN_STORAGE_MIGRATION_MAX_LOCAL_DRAFTS
    );
  const projectIds = validateProjectAndDraftRecords(projects, localDrafts);
  if (
    !Array.isArray(stores.imageAssets)
    || stores.imageAssets.length > ORIGIN_STORAGE_MIGRATION_MAX_IMAGE_ASSETS
  ) {
    fail("이미지 에셋 개수가 허용 범위를 벗어났습니다.");
  }

  const materializedImages: MaterializedOriginStorageMigration["imageAssets"] = [];
  const serializedImages: OriginStorageMigrationImageAsset[] = [];
  const imageKeys = new Set<string>();
  let totalImageBytes = 0;
  for (const rawImage of stores.imageAssets) {
    const image = requiredImageMetadata(
      requiredRecord(rawImage, "이미지 에셋"),
      projectIds
    );
    const keyIdentity = JSON.stringify(image.key);
    if (imageKeys.has(keyIdentity)) {
      fail(`중복된 이미지 에셋 키가 있습니다: ${keyIdentity}`);
    }
    totalImageBytes += image.sizeBytes;
    if (totalImageBytes > ORIGIN_STORAGE_MIGRATION_MAX_TOTAL_IMAGE_ASSET_BYTES) {
      fail("이미지 에셋 전체 크기가 허용 범위를 넘었습니다.");
    }
    const bytes = base64ToBytes(image.dataBase64, image.sizeBytes);
    if (await sha256Hex(bytes) !== image.sha256) {
      fail(`이미지 에셋 무결성 검증에 실패했습니다: ${keyIdentity}`);
    }
    serializedImages.push(image);
    materializedImages.push({
      key: image.key,
      blob: new Blob([bytes], { type: image.mimeType })
    });
    imageKeys.add(keyIdentity);
  }

  const integrity = requiredRecord(envelope.integrity, "마이그레이션 무결성");
  assertOnlyKeys(integrity, ["algorithm", "sha256"], "마이그레이션 무결성");
  if (
    integrity.algorithm !== ORIGIN_STORAGE_MIGRATION_INTEGRITY_ALGORITHM
    || typeof integrity.sha256 !== "string"
    || !SHA256_PATTERN.test(integrity.sha256)
  ) {
    fail("마이그레이션 무결성 정보가 올바르지 않습니다.");
  }

  const payload: OriginStorageMigrationPayload = {
    schema: ORIGIN_STORAGE_MIGRATION_SCHEMA,
    transferId,
    createdAt,
    source: {
      origin: sourceOrigin,
      databaseName,
      databaseVersion: source.databaseVersion
    },
    target: {
      origin: ORIGIN_STORAGE_MIGRATION_TARGET_ORIGIN
    },
    stores: {
      projects,
      localDrafts,
      imageAssets: serializedImages
    }
  };
  if (await payloadSha256(payload) !== integrity.sha256) {
    fail("마이그레이션 봉투 SHA-256 검증에 실패했습니다.");
  }

  return {
    envelope: {
      ...payload,
      integrity: {
        algorithm: ORIGIN_STORAGE_MIGRATION_INTEGRITY_ALGORITHM,
        sha256: integrity.sha256
      }
    },
    projects,
    localDrafts,
    imageAssets: materializedImages
  };
}

export async function parseOriginStorageMigrationJson(
  json: string,
  options: Parameters<typeof parseOriginStorageMigration>[1] = {}
): Promise<MaterializedOriginStorageMigration> {
  if (
    typeof json !== "string"
    || new TextEncoder().encode(json).byteLength
      > ORIGIN_STORAGE_MIGRATION_MAX_JSON_BYTES
  ) {
    fail(
      "마이그레이션 JSON이 허용 크기를 넘었습니다.",
      "ORIGIN_STORAGE_MIGRATION_TOO_LARGE"
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    fail("마이그레이션 JSON 문법이 올바르지 않습니다.");
  }
  return parseOriginStorageMigration(value, options);
}

export function serializeOriginStorageMigration(
  envelope: OriginStorageMigrationEnvelope
): string {
  const json = JSON.stringify(envelope);
  if (new TextEncoder().encode(json).byteLength > ORIGIN_STORAGE_MIGRATION_MAX_JSON_BYTES) {
    fail(
      "마이그레이션 JSON이 허용 크기를 넘었습니다.",
      "ORIGIN_STORAGE_MIGRATION_TOO_LARGE"
    );
  }
  return json;
}
