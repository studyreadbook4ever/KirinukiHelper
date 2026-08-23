import {
  sourceSessionIdentity
} from "./editor-core.js";
import type {
  CaptureState,
  SourceRecord
} from "./editor-core.js";
import {
  canonicalSupportedVodSourceUrl
} from "./source-embed.js";
import {
  inferSourceIdentifiers
} from "./source-platform.js";
import {
  normalizeSoopVodSourceClockIdentity
} from "./soop-vod-source-clock.js";

export const EDITOR_HANDOFF_SCHEMA =
  "kirinuki-editor-handoff/v1" as const;
export const EDITOR_HANDOFF_SUBMISSION_SCHEMA =
  "kirinuki-editor-handoff-submission/v1" as const;
export const EDITOR_HANDOFF_CONSUME_REQUEST_SCHEMA =
  "kirinuki-editor-handoff-consume-request/v1" as const;
export const EDITOR_HANDOFF_ACKNOWLEDGEMENT_SCHEMA =
  "kirinuki-editor-handoff-acknowledgement/v1" as const;
export const EDITOR_HANDOFF_CONSUME_PROTOCOL =
  "kirinuki-editor-handoff-consume/v1" as const;
export const EDITOR_HANDOFF_FRAGMENT_KEY =
  "kirinuki-editor-handoff" as const;
export const EDITOR_HANDOFF_CAPABILITY_ACTION =
  "editor-handoff-consume" as const;
export const EDITOR_HANDOFF_MAXIMUM_BYTES = 256 * 1024;
export const EDITOR_HANDOFF_MAXIMUM_PENDING = 8;
export const EDITOR_HANDOFF_TTL_MS = 2 * 60 * 1_000;

export function editorHandoffAcknowledgementFailureDisposition(
  responseStatus: unknown
): "preserve" | "rollback" {
  return Number.isInteger(responseStatus)
    && Number(responseStatus) >= 400
    && Number(responseStatus) < 500
    ? "rollback"
    : "preserve";
}

const HANDOFF_NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const HANDOFF_PROJECT_PREFIX = "editor-handoff-";
const MAXIMUM_HANDOFF_SEGMENTS = 128;
const MAXIMUM_SOURCE_SECONDS = 30 * 24 * 60 * 60;

type UnknownRecord = Record<string, unknown>;

export interface EditorHandoffEnvelope {
  readonly schema: typeof EDITOR_HANDOFF_SCHEMA;
  readonly handoffGeneration: number;
  readonly confirmedAt: string;
  readonly acknowledgements: EditorHandoffAcknowledgements;
  readonly captureSeed: CaptureState;
}

export interface EditorHandoffAcknowledgements {
  readonly vodCovered: true;
  readonly localAcquisitionAndEditing: true;
  readonly publicationIsSeparate: true;
  readonly thirdPartyRights: true;
  readonly platformTermsAndNoCircumvention: true;
  readonly userResponsibility: true;
}

export interface EditorHandoffSubmission {
  readonly schema: typeof EDITOR_HANDOFF_SUBMISSION_SCHEMA;
  readonly confirmedAt: string;
  readonly acknowledgements: EditorHandoffAcknowledgements;
  readonly captureSeed: CaptureState;
}

export interface EditorHandoffConsumeRequest {
  readonly schema: typeof EDITOR_HANDOFF_CONSUME_REQUEST_SCHEMA;
  readonly handoffNonce: string;
  readonly claimId: string;
}

export interface EditorHandoffAcknowledgement {
  readonly schema: typeof EDITOR_HANDOFF_ACKNOWLEDGEMENT_SCHEMA;
  readonly handoffNonce: string;
  readonly claimId: string;
}

export interface EditorHandoffBroker {
  readonly publish: (value: unknown) => Readonly<{
    handoffNonce: string;
    handoffGeneration: number;
  }>;
  readonly claim: (
    request: unknown,
    capabilityProjectId: unknown
  ) => Readonly<EditorHandoffEnvelope> | null;
  readonly acknowledge: (
    request: unknown,
    capabilityProjectId: unknown
  ) => boolean;
  readonly status: (
    handoffNonce: unknown
  ) => "pending" | "claimed" | "acknowledged" | "absent";
  readonly cancel: (
    handoffNonce: unknown,
    handoffGeneration: unknown
  ) => boolean;
  readonly clear: () => void;
  readonly size: () => number;
}

function isPlainRecord(value: unknown): value is UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: UnknownRecord,
  keys: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${label} 필드가 올바르지 않습니다.`);
  }
}

function normalizedSingleLine(
  value: unknown,
  label: string,
  maximumLength: number,
  { required = true }: { readonly required?: boolean } = {}
): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label}이 문자열이 아닙니다.`);
  }
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (
    (required && normalized.length === 0)
    || normalized.length > maximumLength
    || /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new TypeError(`${label}이 허용 범위를 벗어났습니다.`);
  }
  return normalized;
}

function exactIsoTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() !== value) {
    throw new TypeError(`${label}이 올바르지 않습니다.`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new TypeError(`${label}이 canonical ISO 시각이 아닙니다.`);
  }
  return value;
}

function normalizeCaptureSource(value: unknown): SourceRecord {
  if (!isPlainRecord(value)) {
    throw new TypeError("컷 인계 원본 정보가 올바르지 않습니다.");
  }
  const allowedKeys = [
    "platform",
    "channelId",
    "contentId",
    "contentType",
    "canonicalUrl",
    "url",
    "broadcastTitle",
    "sourceClockIdentity"
  ];
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    throw new TypeError("컷 인계 원본에 허용되지 않은 필드가 있습니다.");
  }
  const canonicalUrl = canonicalSupportedVodSourceUrl(value.canonicalUrl);
  if (
    !canonicalUrl
    || canonicalUrl !== value.canonicalUrl
    || value.url !== canonicalUrl
  ) {
    throw new TypeError("컷 인계 원본 URL이 정규 공개 VOD URL이 아닙니다.");
  }
  const identifiers = inferSourceIdentifiers(canonicalUrl);
  const platform = normalizedSingleLine(value.platform, "원본 플랫폼", 16)
    .toUpperCase();
  const channelId = normalizedSingleLine(
    value.channelId,
    "원본 채널 ID",
    256,
    { required: false }
  );
  const contentId = normalizedSingleLine(value.contentId, "원본 콘텐츠 ID", 256);
  const contentType = normalizedSingleLine(value.contentType, "원본 종류", 16)
    .toLowerCase();
  if (
    platform !== identifiers.platform
    || channelId !== identifiers.channelId
    || contentId !== identifiers.contentId
    || contentType !== "vod"
  ) {
    throw new TypeError("컷 인계 원본 식별자가 URL과 일치하지 않습니다.");
  }
  const source: SourceRecord = {
    platform,
    channelId,
    contentId,
    contentType,
    canonicalUrl,
    url: canonicalUrl,
    broadcastTitle: normalizedSingleLine(
      value.broadcastTitle,
      "프로젝트 이름",
      160
    )
  };
  if (value.sourceClockIdentity !== undefined) {
    const sourceClockIdentity = normalizeSoopVodSourceClockIdentity(
      value.sourceClockIdentity
    );
    if (
      platform !== "SOOP"
      || !sourceClockIdentity
      || sourceClockIdentity.contentId !== contentId
    ) {
      throw new TypeError("SOOP 컷 인계 원본 시계가 콘텐츠와 일치하지 않습니다.");
    }
    source.sourceClockIdentity = sourceClockIdentity;
  }
  if (!sourceSessionIdentity(source)) {
    throw new TypeError("컷 인계 원본 회차를 식별하지 못했습니다.");
  }
  return Object.freeze(source);
}

function normalizeCaptureSeed(value: unknown): CaptureState {
  if (!isPlainRecord(value)) {
    throw new TypeError("컷 인계 데이터가 올바르지 않습니다.");
  }
  exactKeys(value, ["source", "projectName", "segments"], "컷 인계 데이터");
  const source = normalizeCaptureSource(value.source);
  const projectName = normalizedSingleLine(
    value.projectName,
    "프로젝트 이름",
    160
  );
  if (source.broadcastTitle !== projectName) {
    throw new TypeError("컷 인계 프로젝트 이름이 원본 표시 이름과 다릅니다.");
  }
  if (
    !Array.isArray(value.segments)
    || value.segments.length === 0
    || value.segments.length > MAXIMUM_HANDOFF_SEGMENTS
  ) {
    throw new TypeError("컷 인계 구간 수가 허용 범위를 벗어났습니다.");
  }
  const segmentIds = new Set<string>();
  const segments = value.segments.map((entry, index) => {
    if (!isPlainRecord(entry)) {
      throw new TypeError(`${index + 1}번 컷 인계 구간이 올바르지 않습니다.`);
    }
    exactKeys(
      entry,
      ["id", "startSeconds", "endSeconds", "description", "createdAt", "updatedAt"],
      `${index + 1}번 컷 인계 구간`
    );
    const id = normalizedSingleLine(entry.id, "컷 구간 ID", 128);
    const startSeconds = Number(entry.startSeconds);
    const endSeconds = Number(entry.endSeconds);
    if (
      !/^[A-Za-z0-9._:-]{8,128}$/u.test(id)
      || segmentIds.has(id)
      || !Number.isFinite(startSeconds)
      || !Number.isFinite(endSeconds)
      || startSeconds < 0
      || endSeconds - startSeconds < 0.1
      || endSeconds > MAXIMUM_SOURCE_SECONDS
      || Math.round(startSeconds * 1_000) !== startSeconds * 1_000
      || Math.round(endSeconds * 1_000) !== endSeconds * 1_000
    ) {
      throw new TypeError(`${index + 1}번 컷 인계 구간 범위가 올바르지 않습니다.`);
    }
    segmentIds.add(id);
    return Object.freeze({
      id,
      startSeconds,
      endSeconds,
      description: normalizedSingleLine(
        entry.description,
        "컷 메모",
        160,
        { required: false }
      ),
      createdAt: exactIsoTimestamp(entry.createdAt, "컷 생성 시각"),
      updatedAt: exactIsoTimestamp(entry.updatedAt, "컷 수정 시각")
    });
  });
  return Object.freeze({
    source,
    projectName,
    segments
  });
}

function normalizeAcknowledgements(
  value: unknown
): EditorHandoffAcknowledgements {
  if (!isPlainRecord(value)) {
    throw new TypeError("컷 인계의 필수 책임 확인이 없습니다.");
  }
  const keys = [
    "vodCovered",
    "localAcquisitionAndEditing",
    "publicationIsSeparate",
    "thirdPartyRights",
    "platformTermsAndNoCircumvention",
    "userResponsibility"
  ];
  exactKeys(value, keys, "컷 인계 필수 책임 확인");
  if (keys.some((key) => value[key] !== true)) {
    throw new TypeError("컷 인계의 필수 책임 확인을 모두 완료해야 합니다.");
  }
  return Object.freeze({
    vodCovered: true,
    localAcquisitionAndEditing: true,
    publicationIsSeparate: true,
    thirdPartyRights: true,
    platformTermsAndNoCircumvention: true,
    userResponsibility: true
  });
}

export function normalizeEditorHandoffSubmission(
  value: unknown
): Readonly<EditorHandoffSubmission> {
  if (!isPlainRecord(value)) {
    throw new TypeError("편집기 인계 제출 정보가 올바르지 않습니다.");
  }
  exactKeys(
    value,
    ["schema", "confirmedAt", "acknowledgements", "captureSeed"],
    "편집기 인계 제출 정보"
  );
  if (value.schema !== EDITOR_HANDOFF_SUBMISSION_SCHEMA) {
    throw new TypeError("지원하지 않는 편집기 인계 제출 형식입니다.");
  }
  return Object.freeze({
    schema: EDITOR_HANDOFF_SUBMISSION_SCHEMA,
    confirmedAt: exactIsoTimestamp(value.confirmedAt, "사용자 확인 시각"),
    acknowledgements: normalizeAcknowledgements(value.acknowledgements),
    captureSeed: normalizeCaptureSeed(value.captureSeed)
  });
}

export function normalizeEditorHandoffEnvelope(
  value: unknown
): Readonly<EditorHandoffEnvelope> {
  if (!isPlainRecord(value)) {
    throw new TypeError("편집기 인계 정보가 올바르지 않습니다.");
  }
  exactKeys(
    value,
    [
      "schema",
      "handoffGeneration",
      "confirmedAt",
      "acknowledgements",
      "captureSeed"
    ],
    "편집기 인계 정보"
  );
  if (value.schema !== EDITOR_HANDOFF_SCHEMA) {
    throw new TypeError("지원하지 않는 편집기 인계 형식입니다.");
  }
  const handoffGeneration = Number(value.handoffGeneration);
  if (!Number.isSafeInteger(handoffGeneration) || handoffGeneration <= 0) {
    throw new TypeError("편집기 인계 세대가 올바르지 않습니다.");
  }
  const normalized: EditorHandoffEnvelope = {
    schema: EDITOR_HANDOFF_SCHEMA,
    handoffGeneration,
    confirmedAt: exactIsoTimestamp(value.confirmedAt, "사용자 확인 시각"),
    acknowledgements: normalizeAcknowledgements(value.acknowledgements),
    captureSeed: normalizeCaptureSeed(value.captureSeed)
  };
  if (
    new TextEncoder().encode(JSON.stringify(normalized)).byteLength
      > EDITOR_HANDOFF_MAXIMUM_BYTES
  ) {
    throw new TypeError("편집기 인계 정보가 허용 크기를 넘었습니다.");
  }
  return Object.freeze(normalized);
}

export function normalizeEditorHandoffNonce(value: unknown): string {
  if (typeof value !== "string" || !HANDOFF_NONCE_PATTERN.test(value)) {
    throw new TypeError("편집기 인계 nonce가 올바르지 않습니다.");
  }
  return value;
}

export function editorHandoffCapabilityProjectId(nonce: unknown): string {
  return `${HANDOFF_PROJECT_PREFIX}${normalizeEditorHandoffNonce(nonce)}`;
}

export function normalizeEditorHandoffConsumeRequest(
  value: unknown
): Readonly<EditorHandoffConsumeRequest> {
  if (!isPlainRecord(value)) {
    throw new TypeError("편집기 인계 수령 요청이 올바르지 않습니다.");
  }
  exactKeys(
    value,
    ["schema", "handoffNonce", "claimId"],
    "편집기 인계 수령 요청"
  );
  if (value.schema !== EDITOR_HANDOFF_CONSUME_REQUEST_SCHEMA) {
    throw new TypeError("지원하지 않는 편집기 인계 수령 형식입니다.");
  }
  return Object.freeze({
    schema: EDITOR_HANDOFF_CONSUME_REQUEST_SCHEMA,
    handoffNonce: normalizeEditorHandoffNonce(value.handoffNonce),
    claimId: normalizeEditorHandoffNonce(value.claimId)
  });
}

export function normalizeEditorHandoffAcknowledgement(
  value: unknown
): Readonly<EditorHandoffAcknowledgement> {
  if (!isPlainRecord(value)) {
    throw new TypeError("편집기 인계 완료 확인이 올바르지 않습니다.");
  }
  exactKeys(
    value,
    ["schema", "handoffNonce", "claimId"],
    "편집기 인계 완료 확인"
  );
  if (value.schema !== EDITOR_HANDOFF_ACKNOWLEDGEMENT_SCHEMA) {
    throw new TypeError("지원하지 않는 편집기 인계 완료 확인 형식입니다.");
  }
  return Object.freeze({
    schema: EDITOR_HANDOFF_ACKNOWLEDGEMENT_SCHEMA,
    handoffNonce: normalizeEditorHandoffNonce(value.handoffNonce),
    claimId: normalizeEditorHandoffNonce(value.claimId)
  });
}

export function createEditorHandoffBroker({
  createNonce,
  now = Date.now,
  ttlMs = EDITOR_HANDOFF_TTL_MS,
  maximumPending = EDITOR_HANDOFF_MAXIMUM_PENDING
}: {
  readonly createNonce: () => string;
  readonly now?: () => number;
  readonly ttlMs?: number;
  readonly maximumPending?: number;
}): EditorHandoffBroker {
  if (
    typeof createNonce !== "function"
    || typeof now !== "function"
    || !Number.isSafeInteger(ttlMs)
    || ttlMs < 1_000
    || ttlMs > 10 * 60_000
    || !Number.isSafeInteger(maximumPending)
    || maximumPending < 1
    || maximumPending > 32
  ) {
    throw new TypeError("편집기 인계 broker 설정이 올바르지 않습니다.");
  }
  const pending = new Map<string, {
    readonly envelope: Readonly<EditorHandoffEnvelope>;
    readonly expiresAt: number;
    claim: Readonly<{
      claimId: string;
      capabilityProjectId: string;
    }> | null;
  }>();
  const acknowledged = new Map<string, Readonly<{
    claimId: string;
    capabilityProjectId: string;
    expiresAt: number;
  }>>();
  let nextGeneration = 1;
  const prune = (timestamp: number): void => {
    for (const [nonce, entry] of pending) {
      if (timestamp >= entry.expiresAt) {
        pending.delete(nonce);
      }
    }
    for (const [nonce, tombstone] of acknowledged) {
      if (timestamp >= tombstone.expiresAt) {
        acknowledged.delete(nonce);
      }
    }
  };
  return Object.freeze({
    publish(value: unknown): Readonly<{
      handoffNonce: string;
      handoffGeneration: number;
    }> {
      const timestamp = now();
      if (!Number.isFinite(timestamp)) {
        throw new Error("편집기 인계 현재 시각을 확인하지 못했습니다.");
      }
      prune(timestamp);
      if (pending.size >= maximumPending) {
        throw new Error("동시에 대기 중인 편집기 인계가 너무 많습니다.");
      }
      const submission = normalizeEditorHandoffSubmission(value);
      const confirmedAt = Date.parse(submission.confirmedAt);
      if (
        confirmedAt > timestamp + 60_000
        || timestamp - confirmedAt > ttlMs
      ) {
        throw new TypeError("편집기 인계 사용자 확인이 만료됐습니다.");
      }
      let handoffNonce = "";
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const candidate = normalizeEditorHandoffNonce(createNonce());
        if (!pending.has(candidate) && !acknowledged.has(candidate)) {
          handoffNonce = candidate;
          break;
        }
      }
      if (!handoffNonce) {
        throw new Error("편집기 인계 nonce를 안전하게 만들지 못했습니다.");
      }
      if (!Number.isSafeInteger(nextGeneration) || nextGeneration <= 0) {
        throw new Error("편집기 인계 세대를 더 만들 수 없습니다.");
      }
      const envelope = normalizeEditorHandoffEnvelope({
        schema: EDITOR_HANDOFF_SCHEMA,
        handoffGeneration: nextGeneration,
        confirmedAt: submission.confirmedAt,
        acknowledgements: submission.acknowledgements,
        captureSeed: submission.captureSeed
      });
      nextGeneration += 1;
      pending.set(handoffNonce, {
        envelope,
        expiresAt: timestamp + ttlMs,
        claim: null
      });
      return Object.freeze({
        handoffNonce,
        handoffGeneration: envelope.handoffGeneration
      });
    },
    claim(requestValue: unknown, capabilityProjectId: unknown) {
      const timestamp = now();
      prune(timestamp);
      const request = normalizeEditorHandoffConsumeRequest(requestValue);
      if (
        capabilityProjectId
          !== editorHandoffCapabilityProjectId(request.handoffNonce)
      ) {
        return null;
      }
      const entry = pending.get(request.handoffNonce);
      if (!entry || timestamp >= entry.expiresAt) {
        return null;
      }
      const expectedScope = editorHandoffCapabilityProjectId(
        request.handoffNonce
      );
      if (
        entry.claim
        && (
          entry.claim.claimId !== request.claimId
          || entry.claim.capabilityProjectId !== expectedScope
        )
      ) {
        return null;
      }
      // Bind before returning. A lost encrypted response can be retried only
      // by the exact same document claim; another claim never sees payload.
      entry.claim ??= Object.freeze({
        claimId: request.claimId,
        capabilityProjectId: expectedScope
      });
      return entry.envelope;
    },
    acknowledge(requestValue: unknown, capabilityProjectId: unknown): boolean {
      const timestamp = now();
      prune(timestamp);
      const request = normalizeEditorHandoffAcknowledgement(requestValue);
      const expectedScope = editorHandoffCapabilityProjectId(
        request.handoffNonce
      );
      if (capabilityProjectId !== expectedScope) {
        return false;
      }
      const entry = pending.get(request.handoffNonce);
      if (
        !entry
        || !entry.claim
        || entry.claim.claimId !== request.claimId
        || entry.claim.capabilityProjectId !== expectedScope
      ) {
        const tombstone = acknowledged.get(request.handoffNonce);
        return Boolean(
          tombstone
          && tombstone.claimId === request.claimId
          && tombstone.capabilityProjectId === expectedScope
        );
      }
      pending.delete(request.handoffNonce);
      if (acknowledged.size >= maximumPending) {
        const oldest = acknowledged.keys().next().value;
        if (typeof oldest === "string") {
          acknowledged.delete(oldest);
        }
      }
      acknowledged.set(request.handoffNonce, Object.freeze({
        claimId: request.claimId,
        capabilityProjectId: expectedScope,
        expiresAt: timestamp + ttlMs
      }));
      return true;
    },
    status(handoffNonceValue: unknown) {
      const timestamp = now();
      prune(timestamp);
      const handoffNonce = normalizeEditorHandoffNonce(handoffNonceValue);
      if (acknowledged.has(handoffNonce)) {
        return "acknowledged";
      }
      const entry = pending.get(handoffNonce);
      return !entry ? "absent" : entry.claim ? "claimed" : "pending";
    },
    cancel(handoffNonceValue: unknown, handoffGenerationValue: unknown): boolean {
      const timestamp = now();
      prune(timestamp);
      const handoffNonce = normalizeEditorHandoffNonce(handoffNonceValue);
      const handoffGeneration = Number(handoffGenerationValue);
      if (
        !Number.isSafeInteger(handoffGeneration)
        || handoffGeneration <= 0
      ) {
        return false;
      }
      const entry = pending.get(handoffNonce);
      if (
        !entry
        || entry.envelope.handoffGeneration !== handoffGeneration
      ) {
        return false;
      }
      pending.delete(handoffNonce);
      return true;
    },
    clear(): void {
      pending.clear();
      acknowledged.clear();
    },
    size(): number {
      prune(now());
      return pending.size;
    }
  });
}
