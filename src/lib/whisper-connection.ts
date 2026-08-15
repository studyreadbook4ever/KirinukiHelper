import {
  isKirinukiLocalStudioOrigin
} from "./local-runtime-origin.js";
import type { KirinukiAppOrigin } from "./local-runtime-origin.js";

export const KIRINUKI_WHISPER_CONNECTION_SCHEMA =
  "kirinuki-whisper-connection/v1";
export const KIRINUKI_WHISPER_CONNECTION_FILENAME =
  "kirinuki-whisper-connection.json";
export const MAX_WHISPER_CONNECTION_JSON_BYTES = 16 * 1024;

export const WHISPER_MODEL_IDS = Object.freeze([
  "tiny-q5_1",
  "base-q5_1",
  "small-q5_1",
  "medium-q5_0"
] as const);

export type WhisperModelId = typeof WHISPER_MODEL_IDS[number];

export interface WhisperModelCatalogEntry {
  id: WhisperModelId;
  profile: WhisperEffectiveProfile;
  label: string;
  purpose: string;
  downloadSizeBytes: number;
  downloadSizeLabel: string;
}

export const WHISPER_MODEL_CATALOG = Object.freeze({
  "tiny-q5_1": Object.freeze({
    id: "tiny-q5_1",
    profile: "draft",
    label: "Tiny · 빠른 초안",
    purpose: "가장 빠르게 자막 초안을 만듭니다.",
    downloadSizeBytes: 32_152_673,
    downloadSizeLabel: "약 32 MB"
  }),
  "base-q5_1": Object.freeze({
    id: "base-q5_1",
    profile: "light",
    label: "Base · 가벼운 품질",
    purpose: "저사양 PC에서 속도와 품질을 가볍게 높입니다.",
    downloadSizeBytes: 59_707_625,
    downloadSizeLabel: "약 60 MB"
  }),
  "small-q5_1": Object.freeze({
    id: "small-q5_1",
    profile: "auto",
    label: "Small · 균형",
    purpose: "속도와 자막 품질의 균형을 우선합니다.",
    downloadSizeBytes: 190_085_487,
    downloadSizeLabel: "약 190 MB"
  }),
  "medium-q5_0": Object.freeze({
    id: "medium-q5_0",
    profile: "quality",
    label: "Medium · 정확도 우선",
    purpose: "더 많은 자원을 사용해 정확도를 우선합니다.",
    downloadSizeBytes: 539_212_467,
    downloadSizeLabel: "약 539 MB"
  })
} satisfies Record<WhisperModelId, WhisperModelCatalogEntry>);

const REQUESTED_PROFILES = Object.freeze([
  "draft",
  "auto",
  "light",
  "quality"
] as const);
const EFFECTIVE_PROFILES = REQUESTED_PROFILES;
const BACKENDS = Object.freeze(["cpu", "cuda"] as const);

export type WhisperRequestedProfile = typeof REQUESTED_PROFILES[number];
export type WhisperEffectiveProfile = typeof EFFECTIVE_PROFILES[number];
export type WhisperBackend = typeof BACKENDS[number];

export interface WhisperConnectionDescriptor {
  schema: typeof KIRINUKI_WHISPER_CONNECTION_SCHEMA;
  endpoint: string;
  origin: string;
  requestedProfile: WhisperRequestedProfile;
  effectiveProfile: WhisperEffectiveProfile;
  backend: WhisperBackend;
  modelId: WhisperModelId;
}

const DESCRIPTOR_KEYS = Object.freeze([
  "schema",
  "endpoint",
  "origin",
  "requestedProfile",
  "effectiveProfile",
  "backend",
  "modelId"
] as const);
const CAPTION_ENDPOINT_PATTERN =
  /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/v1\/captions$/u;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function includes<const Values extends readonly string[]>(
  values: Values,
  value: unknown
): value is Values[number] {
  return typeof value === "string" && values.includes(value as Values[number]);
}

function assertStudioOrigin(
  value: unknown,
  label: string
): KirinukiAppOrigin {
  if (!isKirinukiLocalStudioOrigin(value)) {
    throw new TypeError(
      `${label}은 설치된 Kirinuki 앱의 고정 Origin이어야 합니다.`
    );
  }
  return value;
}

export function whisperCaptionEndpoint(gatewayPort: unknown): string {
  const port = Number(gatewayPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError("Whisper gateway 포트는 1~65535 정수여야 합니다.");
  }
  return `http://127.0.0.1:${port}/v1/captions`;
}

export function parseWhisperConnectionDescriptor(
  value: unknown,
  expectedOrigin: string
): Readonly<WhisperConnectionDescriptor> {
  const exactExpectedOrigin = assertStudioOrigin(
    expectedOrigin,
    "현재 Kirinuki Origin"
  );
  if (!isPlainRecord(value) || !hasExactKeys(value, DESCRIPTOR_KEYS)) {
    throw new TypeError(
      "Kirinuki Whisper 연결 파일의 필드 구성이 올바르지 않습니다."
    );
  }
  if (value.schema !== KIRINUKI_WHISPER_CONNECTION_SCHEMA) {
    throw new TypeError("지원하지 않는 Kirinuki Whisper 연결 파일입니다.");
  }
  if (typeof value.endpoint !== "string") {
    throw new TypeError("Whisper 연결 주소가 없습니다.");
  }
  const endpointMatch = CAPTION_ENDPOINT_PATTERN.exec(value.endpoint);
  const gatewayPort = Number(endpointMatch?.[1]);
  if (
    !endpointMatch
    || !Number.isInteger(gatewayPort)
    || gatewayPort < 1
    || gatewayPort > 65_535
  ) {
    throw new TypeError(
      "Whisper 연결 주소는 127.0.0.1의 Kirinuki 자막 endpoint여야 합니다."
    );
  }
  const descriptorOrigin = assertStudioOrigin(
    value.origin,
    "연결 파일 Origin"
  );
  if (descriptorOrigin !== exactExpectedOrigin) {
    throw new TypeError(
      "이 연결 파일은 현재 실행 중인 Kirinuki용으로 만들어지지 않았습니다."
    );
  }
  if (!includes(REQUESTED_PROFILES, value.requestedProfile)) {
    throw new TypeError("지원하지 않는 Whisper 요청 profile입니다.");
  }
  if (!includes(EFFECTIVE_PROFILES, value.effectiveProfile)) {
    throw new TypeError("지원하지 않는 Whisper 실제 profile입니다.");
  }
  if (!includes(BACKENDS, value.backend)) {
    throw new TypeError("지원하지 않는 Whisper backend입니다.");
  }
  if (!includes(WHISPER_MODEL_IDS, value.modelId)) {
    throw new TypeError("지원하지 않는 Whisper 모델입니다.");
  }
  const catalogEntry = WHISPER_MODEL_CATALOG[value.modelId];
  if (catalogEntry.profile !== value.effectiveProfile) {
    throw new TypeError(
      "Whisper 실제 profile과 모델 정보가 서로 일치하지 않습니다."
    );
  }
  if (
    value.requestedProfile === "auto"
      ? !["auto", "light"].includes(value.effectiveProfile)
      : value.requestedProfile !== value.effectiveProfile
  ) {
    throw new TypeError(
      "Whisper 요청 profile과 실제 profile 정보가 서로 일치하지 않습니다."
    );
  }
  return Object.freeze({
    schema: KIRINUKI_WHISPER_CONNECTION_SCHEMA,
    endpoint: value.endpoint,
    origin: descriptorOrigin,
    requestedProfile: value.requestedProfile,
    effectiveProfile: value.effectiveProfile,
    backend: value.backend,
    modelId: value.modelId
  });
}

export function parseWhisperConnectionJson(
  json: string,
  expectedOrigin: string
): Readonly<WhisperConnectionDescriptor> {
  if (typeof json !== "string") {
    throw new TypeError("Whisper 연결 파일은 JSON 텍스트여야 합니다.");
  }
  if (new TextEncoder().encode(json).byteLength > MAX_WHISPER_CONNECTION_JSON_BYTES) {
    throw new TypeError("Whisper 연결 파일이 허용된 크기를 초과했습니다.");
  }
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    throw new TypeError("Whisper 연결 파일이 올바른 JSON이 아닙니다.");
  }
  return parseWhisperConnectionDescriptor(value, expectedOrigin);
}

export function createWhisperConnectionDescriptor({
  gatewayPort,
  origin,
  requestedProfile,
  effectiveProfile,
  backend,
  modelId
}: {
  gatewayPort: number;
  origin: string;
  requestedProfile: WhisperRequestedProfile;
  effectiveProfile: WhisperEffectiveProfile;
  backend: WhisperBackend;
  modelId: WhisperModelId;
}): Readonly<WhisperConnectionDescriptor> {
  return parseWhisperConnectionDescriptor({
    schema: KIRINUKI_WHISPER_CONNECTION_SCHEMA,
    endpoint: whisperCaptionEndpoint(gatewayPort),
    origin,
    requestedProfile,
    effectiveProfile,
    backend,
    modelId
  }, origin);
}

export function serializeWhisperConnectionDescriptor(
  descriptor: WhisperConnectionDescriptor,
  expectedOrigin: string
): string {
  const parsed = parseWhisperConnectionDescriptor(
    descriptor,
    expectedOrigin
  );
  return `${JSON.stringify(parsed, null, 2)}\n`;
}
