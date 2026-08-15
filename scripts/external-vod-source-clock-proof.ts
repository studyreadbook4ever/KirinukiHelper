import { createHash } from "node:crypto";

import {
  normalizeSoopVodSourceClockIdentity
} from "../src/lib/soop-vod-source-clock.js";
import type {
  SoopVodSourceClockIdentity
} from "../src/lib/soop-vod-source-clock.js";
import {
  parseExternalVodPersistedClockProofSet
} from "./external-vod-clock-resolver.js";
import type {
  ExternalVodPersistedClockProofSet
} from "./external-vod-clock-resolver.js";
import type { ExternalVodTransferPlatform } from "./external-vod-transfer.js";

export const EXTERNAL_VOD_SOURCE_CLOCK_PROOF_SCHEMA =
  "chzzk-kirinuki/external-vod-source-clock-proof-v1";
export const MAX_EXTERNAL_VOD_SOURCE_CLOCK_PARTS = 500;
export const MAX_EXTERNAL_VOD_SOURCE_CLOCK_MS = 7 * 24 * 60 * 60 * 1_000;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_PART_ID_PATTERN = /^[^\u0000-\u001f\u007f/?#&=]{1,240}$/u;

type UnknownRecord = Record<string, unknown>;

export interface ExternalVodSourceClockMetadataPart {
  partIndex: number;
  playlistItem?: number;
  partId: string;
  sourceStartMs: number;
  sourceEndMs: number;
  durationMs: number;
}

export interface ExternalVodSourceClockProofPart {
  partIndex: number;
  playlistItem: number | null;
  partIdentitySha256: string;
  sourceStartMs: number;
  sourceEndMs: number;
  durationMs: number;
}

export interface ExternalVodSourceClockProof {
  schemaId: typeof EXTERNAL_VOD_SOURCE_CLOCK_PROOF_SCHEMA;
  sourceClockProofId: string;
  platform: ExternalVodTransferPlatform;
  contentIdentitySha256: string;
  metadataIdentityId: string;
  sourceDurationMs: number;
  browserClockIdentitySha256: string | null;
  parts: readonly ExternalVodSourceClockProofPart[];
}

export interface ExternalVodSourceClockResolution {
  proof: ExternalVodSourceClockProof;
  sourceVersionId: string;
  sourceDurationMs: number;
  authoritativeParts: readonly ExternalVodSourceClockMetadataPart[];
}

export class ExternalVodSourceClockProofError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "ExternalVodSourceClockProofError";
    this.code = code;
  }
}

function fail(message: string, code: string): never {
  throw new ExternalVodSourceClockProofError(message, code);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const record = value as UnknownRecord;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  )).join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function exactKeys(value: UnknownRecord, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    fail(`${label} 필드 구성이 올바르지 않습니다.`, "INVALID_SOURCE_CLOCK_PROOF");
  }
}

function checkedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string
): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail(`${label} 값이 올바르지 않습니다.`, "INVALID_SOURCE_CLOCK_PROOF");
  }
  return Number(value);
}

function checkedSha(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(`${label} 지문이 올바르지 않습니다.`, "INVALID_SOURCE_CLOCK_PROOF");
  }
  return value;
}

function normalizedMetadataParts(
  platform: ExternalVodTransferPlatform,
  value: readonly ExternalVodSourceClockMetadataPart[]
): ExternalVodSourceClockMetadataPart[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_EXTERNAL_VOD_SOURCE_CLOCK_PARTS) {
    fail("원본 VOD 파트 구성이 올바르지 않습니다.", "INVALID_SOURCE_CLOCK_METADATA");
  }
  let cursorMs = 0;
  const ids = new Set<string>();
  return value.map((part, partIndex) => {
    if (
      part.partIndex !== partIndex
      || typeof part.partId !== "string"
      || !SAFE_PART_ID_PATTERN.test(part.partId)
      || ids.has(part.partId)
      || part.sourceStartMs !== cursorMs
      || !Number.isSafeInteger(part.durationMs)
      || part.durationMs <= 0
      || part.sourceEndMs !== cursorMs + part.durationMs
      || part.sourceEndMs > MAX_EXTERNAL_VOD_SOURCE_CLOCK_MS
      || (platform === "SOOP"
        ? part.playlistItem !== partIndex + 1
        : part.playlistItem !== undefined)
    ) {
      fail("원본 VOD 파트 순서·범위·identity가 올바르지 않습니다.", "INVALID_SOURCE_CLOCK_METADATA");
    }
    ids.add(part.partId);
    cursorMs = part.sourceEndMs;
    return { ...part };
  });
}

function normalizedSoopIdentity(
  value: unknown,
  contentId: string,
  parts: readonly ExternalVodSourceClockMetadataPart[]
): SoopVodSourceClockIdentity {
  const identity = normalizeSoopVodSourceClockIdentity(value);
  if (
    !identity
    || identity.contentId !== contentId
    || identity.parts.length !== parts.length
    || identity.parts.some((part, index) => {
      const metadataPart = parts[index];
      return !metadataPart
        || part.id !== metadataPart.partId
        || part.index !== metadataPart.partIndex
        || part.order !== metadataPart.playlistItem
        || part.durationSeconds * 1_000 !== metadataPart.durationMs;
    })
  ) {
    fail(
      "브라우저 SOOP 플레이어와 추출기의 전체 파트 시간축이 다릅니다.",
      "SOURCE_CLOCK_MISMATCH"
    );
  }
  return identity;
}

function sourceClockProofId(
  value: Omit<ExternalVodSourceClockProof, "sourceClockProofId">
): string {
  return sha256(stableJson(value));
}

export function externalVodSourceVersionId({
  metadataIdentityId,
  sourceClockProofId: proofId
}: {
  metadataIdentityId: string;
  sourceClockProofId: string;
}): string {
  checkedSha(metadataIdentityId, "메타데이터 identity");
  checkedSha(proofId, "원본 시간축 증명");
  return sha256(stableJson({ version: 3, metadataIdentityId, sourceClockProofId: proofId }));
}

/**
 * Resolves the whole player clock. CHZZK HLS and YouTube direct media are the
 * single-part authority; SOOP's official browser/controller vector is the
 * multipart authority and must exactly match extractor metadata.
 */
export function createExternalVodSourceClockProof({
  platform,
  contentId,
  metadataIdentityId,
  metadataParts,
  acquisitionClockProofSet,
  soopSourceClockIdentity
}: {
  platform: ExternalVodTransferPlatform;
  contentId: string;
  metadataIdentityId: string;
  metadataParts: readonly ExternalVodSourceClockMetadataPart[];
  acquisitionClockProofSet?: ExternalVodPersistedClockProofSet;
  soopSourceClockIdentity?: unknown;
}): ExternalVodSourceClockResolution {
  if (typeof contentId !== "string" || !SAFE_PART_ID_PATTERN.test(contentId)) {
    fail("원본 VOD 콘텐츠 ID가 올바르지 않습니다.", "INVALID_SOURCE_CLOCK_METADATA");
  }
  checkedSha(metadataIdentityId, "메타데이터 identity");
  const metadata = normalizedMetadataParts(platform, metadataParts);
  let authoritativeParts: ExternalVodSourceClockMetadataPart[];
  let browserClockIdentitySha256: string | null = null;
  if (platform === "SOOP") {
    if (acquisitionClockProofSet !== undefined) {
      fail("SOOP 전체 player clock은 plan-scoped 취득 증거로 만들 수 없습니다.", "INVALID_SOURCE_CLOCK_METADATA");
    }
    const identity = normalizedSoopIdentity(
      soopSourceClockIdentity,
      contentId,
      metadata
    );
    browserClockIdentitySha256 = sha256(stableJson(identity));
    authoritativeParts = metadata.map((part) => ({ ...part }));
  } else {
    if (soopSourceClockIdentity !== undefined || metadata.length !== 1 || !acquisitionClockProofSet) {
      fail("단일 파트 원본 시간축 증명 입력이 올바르지 않습니다.", "INVALID_SOURCE_CLOCK_METADATA");
    }
    const acquisition = parseExternalVodPersistedClockProofSet(acquisitionClockProofSet);
    const selectedPart = acquisition.parts[0];
    if (
      acquisition.platform !== platform
      || acquisition.parts.length !== 1
      || acquisition.metadataPartCount !== 1
      || acquisition.sourceVersionId !== metadataIdentityId
      || !selectedPart
      || selectedPart.partIndex !== 0
      || selectedPart.partIdentitySha256 !== sha256(metadata[0]!.partId)
    ) {
      fail("선택 미디어 증명이 원본 단일 파트와 다릅니다.", "SOURCE_CLOCK_MISMATCH");
    }
    // Never expose a range beyond verified media. Sub-millisecond tails are
    // deliberately floored because every public request uses integer ms.
    const authoritativeDurationMs = Math.floor(selectedPart.resolvedDurationUs / 1_000);
    if (authoritativeDurationMs <= 0) {
      fail("증명된 원본 재생 시간이 비어 있습니다.", "SOURCE_CLOCK_MISMATCH");
    }
    authoritativeParts = [{
      ...metadata[0]!,
      sourceStartMs: 0,
      sourceEndMs: authoritativeDurationMs,
      durationMs: authoritativeDurationMs
    }];
  }
  const sourceDurationMs = authoritativeParts.at(-1)?.sourceEndMs ?? 0;
  const parts: ExternalVodSourceClockProofPart[] = authoritativeParts.map((part) => ({
    partIndex: part.partIndex,
    playlistItem: part.playlistItem ?? null,
    partIdentitySha256: sha256(part.partId),
    sourceStartMs: part.sourceStartMs,
    sourceEndMs: part.sourceEndMs,
    durationMs: part.durationMs
  }));
  const withoutId: Omit<ExternalVodSourceClockProof, "sourceClockProofId"> = {
    schemaId: EXTERNAL_VOD_SOURCE_CLOCK_PROOF_SCHEMA,
    platform,
    contentIdentitySha256: sha256(contentId),
    metadataIdentityId,
    sourceDurationMs,
    browserClockIdentitySha256,
    parts
  };
  const proof = {
    ...withoutId,
    sourceClockProofId: sourceClockProofId(withoutId)
  };
  if (acquisitionClockProofSet) {
    assertExternalVodSourceClockProofMatchesAcquisitionClockProofSet(
      proof,
      acquisitionClockProofSet
    );
  }
  return {
    proof,
    sourceVersionId: externalVodSourceVersionId({
      metadataIdentityId,
      sourceClockProofId: proof.sourceClockProofId
    }),
    sourceDurationMs,
    authoritativeParts
  };
}

function parseProofPart(value: unknown): ExternalVodSourceClockProofPart {
  if (!isRecord(value)) {
    fail("원본 시간축 파트 증거가 올바르지 않습니다.", "INVALID_SOURCE_CLOCK_PROOF");
  }
  exactKeys(value, [
    "partIndex", "playlistItem", "partIdentitySha256", "sourceStartMs",
    "sourceEndMs", "durationMs"
  ], "원본 시간축 파트 증거");
  const partIndex = checkedInteger(value.partIndex, 0, MAX_EXTERNAL_VOD_SOURCE_CLOCK_PARTS - 1, "파트 순번");
  const sourceStartMs = checkedInteger(value.sourceStartMs, 0, MAX_EXTERNAL_VOD_SOURCE_CLOCK_MS, "파트 시작");
  const sourceEndMs = checkedInteger(value.sourceEndMs, sourceStartMs + 1, MAX_EXTERNAL_VOD_SOURCE_CLOCK_MS, "파트 끝");
  const durationMs = checkedInteger(value.durationMs, 1, MAX_EXTERNAL_VOD_SOURCE_CLOCK_MS, "파트 길이");
  if (sourceEndMs - sourceStartMs !== durationMs) {
    fail("원본 시간축 파트 범위와 길이가 다릅니다.", "INVALID_SOURCE_CLOCK_PROOF");
  }
  return {
    partIndex,
    playlistItem: value.playlistItem === null
      ? null
      : checkedInteger(value.playlistItem, 1, MAX_EXTERNAL_VOD_SOURCE_CLOCK_PARTS, "playlist item"),
    partIdentitySha256: checkedSha(value.partIdentitySha256, "파트 identity"),
    sourceStartMs,
    sourceEndMs,
    durationMs
  };
}

export function parseExternalVodSourceClockProof(
  value: unknown
): ExternalVodSourceClockProof {
  if (!isRecord(value)) {
    fail("원본 시간축 증거가 올바르지 않습니다.", "INVALID_SOURCE_CLOCK_PROOF");
  }
  exactKeys(value, [
    "schemaId", "sourceClockProofId", "platform", "contentIdentitySha256",
    "metadataIdentityId", "sourceDurationMs", "browserClockIdentitySha256", "parts"
  ], "원본 시간축 증거");
  if (
    value.schemaId !== EXTERNAL_VOD_SOURCE_CLOCK_PROOF_SCHEMA
    || !["CHZZK", "YOUTUBE", "SOOP"].includes(String(value.platform))
    || !Array.isArray(value.parts)
    || value.parts.length === 0
    || value.parts.length > MAX_EXTERNAL_VOD_SOURCE_CLOCK_PARTS
  ) {
    fail("원본 시간축 증거 버전 또는 플랫폼이 올바르지 않습니다.", "INVALID_SOURCE_CLOCK_PROOF");
  }
  const platform = value.platform as ExternalVodTransferPlatform;
  const parts = value.parts.map(parseProofPart);
  let cursorMs = 0;
  for (const [index, part] of parts.entries()) {
    if (
      part.partIndex !== index
      || part.sourceStartMs !== cursorMs
      || (platform === "SOOP"
        ? part.playlistItem !== index + 1
        : part.playlistItem !== null)
    ) {
      fail("원본 시간축 파트가 연속적이지 않습니다.", "INVALID_SOURCE_CLOCK_PROOF");
    }
    cursorMs = part.sourceEndMs;
  }
  if (platform !== "SOOP" && parts.length !== 1) {
    fail("단일 파트 플랫폼의 시간축 파트 수가 올바르지 않습니다.", "INVALID_SOURCE_CLOCK_PROOF");
  }
  const sourceDurationMs = checkedInteger(
    value.sourceDurationMs,
    1,
    MAX_EXTERNAL_VOD_SOURCE_CLOCK_MS,
    "원본 전체 길이"
  );
  if (cursorMs !== sourceDurationMs) {
    fail("원본 전체 길이와 파트 합이 다릅니다.", "INVALID_SOURCE_CLOCK_PROOF");
  }
  const browserClockIdentitySha256 = value.browserClockIdentitySha256 === null
    ? null
    : checkedSha(value.browserClockIdentitySha256, "브라우저 시간축 identity");
  if ((platform === "SOOP") !== (browserClockIdentitySha256 !== null)) {
    fail("플랫폼과 브라우저 시간축 identity가 다릅니다.", "INVALID_SOURCE_CLOCK_PROOF");
  }
  const withoutId: Omit<ExternalVodSourceClockProof, "sourceClockProofId"> = {
    schemaId: EXTERNAL_VOD_SOURCE_CLOCK_PROOF_SCHEMA,
    platform,
    contentIdentitySha256: checkedSha(value.contentIdentitySha256, "콘텐츠 identity"),
    metadataIdentityId: checkedSha(value.metadataIdentityId, "메타데이터 identity"),
    sourceDurationMs,
    browserClockIdentitySha256,
    parts
  };
  const expectedId = sourceClockProofId(withoutId);
  if (checkedSha(value.sourceClockProofId, "원본 시간축 증거") !== expectedId) {
    fail("원본 시간축 증거 ID가 본문과 다릅니다.", "INVALID_SOURCE_CLOCK_PROOF");
  }
  return { ...withoutId, sourceClockProofId: expectedId };
}

/**
 * Cross-binds the whole browser/player clock to a plan-scoped acquisition
 * proof set. SOOP may acquire a sparse subset of its complete part vector;
 * every acquired part must still name the exact whole-clock part. CHZZK and
 * YouTube use the selected media's floored microsecond duration as authority,
 * because their extractor metadata duration may be rounded.
 */
export function assertExternalVodSourceClockProofMatchesAcquisitionClockProofSet(
  sourceClockProofValue: unknown,
  acquisitionClockProofSetValue: unknown
): ExternalVodPersistedClockProofSet {
  const source = parseExternalVodSourceClockProof(sourceClockProofValue);
  const acquisition = parseExternalVodPersistedClockProofSet(
    acquisitionClockProofSetValue
  );
  if (
    source.platform !== acquisition.platform
    || source.contentIdentitySha256 !== acquisition.contentIdentitySha256
    || source.metadataIdentityId !== acquisition.sourceVersionId
    || source.sourceDurationMs !== acquisition.sourceDurationMs
    || source.parts.length !== acquisition.metadataPartCount
  ) {
    fail(
      "외부 VOD 전체 시간축과 취득 시간축 증거의 원본 identity가 다릅니다.",
      "SOURCE_CLOCK_MISMATCH"
    );
  }
  for (const acquiredPart of acquisition.parts) {
    const sourcePart = source.parts[acquiredPart.partIndex];
    const durationMatchesAuthority = source.platform === "SOOP"
      ? sourcePart?.durationMs === acquiredPart.metadataDurationMs
      : sourcePart?.durationMs
        === Math.floor(acquiredPart.resolvedDurationUs / 1_000);
    if (
      !sourcePart
      || sourcePart.partIndex !== acquiredPart.partIndex
      || sourcePart.playlistItem !== acquiredPart.playlistItem
      || sourcePart.partIdentitySha256 !== acquiredPart.partIdentitySha256
      || sourcePart.sourceStartMs !== acquiredPart.sourceStartMs
      || sourcePart.sourceEndMs !== acquiredPart.sourceEndMs
      || !durationMatchesAuthority
    ) {
      fail(
        "외부 VOD 취득 파트가 전체 player clock의 해당 파트와 다릅니다.",
        "SOURCE_CLOCK_MISMATCH"
      );
    }
  }
  return acquisition;
}

export function assertExternalVodSourceClockProofUnchanged(
  expectedValue: unknown,
  actualValue: unknown
): ExternalVodSourceClockProof {
  const expected = parseExternalVodSourceClockProof(expectedValue);
  const actual = parseExternalVodSourceClockProof(actualValue);
  if (expected.sourceClockProofId !== actual.sourceClockProofId) {
    fail("외부 VOD 전체 player clock이 처리 중 바뀌었습니다.", "SOURCE_CHANGED");
  }
  return actual;
}
