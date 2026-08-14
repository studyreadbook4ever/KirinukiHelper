export const LEGACY_CHZZK_VOD_MATERIALIZATION_SCHEMA =
  "chzzk-kirinuki-chzzk-vod-materialization/v1";
export const CHZZK_VOD_MATERIALIZATION_SCHEMA =
  "chzzk-kirinuki-chzzk-vod-materialization/v2";
export const DEFAULT_MATERIALIZATION_HANDLE_MS = 10_000;
export const MAX_MATERIALIZED_MEDIA_DRIFT_MS = 250;
export const MAX_MATERIALIZED_MEDIA_SHORTFALL_MS = 0.5;

const TIME_EPSILON_MS = 0.001;
const MEDIA_DURATION_TOLERANCE_MS = 1;
const MAX_EXPANDED_SEGMENTS = 1_000_000;
const SAFE_IDENTIFIER_PATTERN = /^[^\u0000-\u001f\u007f/?#&=]+$/u;

export interface MaterializationClipRange {
  clipId: string;
  sourceStartMs: number;
  sourceEndMs: number;
}

/**
 * Per-source-clip coverage carried by v2 manifests. `source*` is the immutable
 * capture anchor and `editable*` is the exact locally available range: at
 * least the fixed initial handle, and possibly a later user-requested
 * expansion. Keeping this outside union windows prevents one nearby clip from
 * borrowing another clip's downloaded editing allowance.
 */
export interface MaterializationClipCoverage extends MaterializationClipRange {
  editableSourceStartMs: number;
  editableSourceEndMs: number;
}

export type MaterializationDesiredEditableRange = Pick<
  MaterializationClipCoverage,
  "clipId" | "editableSourceStartMs" | "editableSourceEndMs"
>;

export interface LogicalMaterializationWindow {
  editableSourceStartMs: number;
  editableSourceEndMs: number;
  clipIds: string[];
}

export interface MpdSegmentTimelineEntry {
  t?: number;
  d: number;
  r?: number;
}

export interface MpdSegmentTimelineInput {
  timescale: number;
  presentationTimeOffset?: number;
  periodStartMs?: number;
  periodDurationMs?: number;
  startNumber?: number;
  entries: readonly MpdSegmentTimelineEntry[];
}

export interface ExpandedMpdSegment {
  index: number;
  number: number;
  time: number;
  duration: number;
  sourceStartMs: number;
  sourceEndMs: number;
}

export interface SegmentTemplateValues {
  representationId: string;
  number: number;
  time: number;
}

export interface PlannedSegmentRun {
  editableSourceStartMs: number;
  editableSourceEndMs: number;
  fetchedSourceStartMs: number;
  fetchedSourceEndMs: number;
  clipIds: string[];
  segments: ExpandedMpdSegment[];
  decoderPrefixSegmentCount: number;
}

export interface MaterializationWindow {
  id: string;
  editableSourceStartMs: number;
  editableSourceEndMs: number;
  fetchedSourceStartMs: number;
  fetchedSourceEndMs: number;
  mediaStartMs: number;
  mediaEndMs: number;
  clipIds: string[];
}

export interface ChzzkVodMaterializationSource {
  platform: "CHZZK" | "YOUTUBE" | "SOOP";
  contentType: "vod";
  contentId: string;
  sourceVersionId?: string;
}

export interface ChzzkVodMaterialization {
  schema:
    | typeof CHZZK_VOD_MATERIALIZATION_SCHEMA
    | typeof LEGACY_CHZZK_VOD_MATERIALIZATION_SCHEMA;
  materializationId: string;
  planFingerprint: string;
  source: ChzzkVodMaterializationSource;
  sourceDurationMs: number;
  handleMs: number;
  mediaDurationMs: number;
  windows: MaterializationWindow[];
  clipRanges?: MaterializationClipCoverage[];
  preparedAt: string;
  localOnly: true;
}

export interface ClipLogicalEditableBounds {
  editableSourceStartMs: number;
  editableSourceEndMs: number;
}

export interface ClipMaterializedEditableBounds
  extends ClipLogicalEditableBounds {
  windowId: string;
  mediaStartMs: number;
  mediaEndMs: number;
}

export interface ChzzkVodRightsConfirmation {
  scope: "owned-or-authorized-public-vod";
  contentId: string;
  confirmedAt: string;
}

type MaterializationMapping = Pick<ChzzkVodMaterialization, "windows">;
interface ClipSelectionLike {
  id: string;
  selectionStartMs: number;
  selectionEndMs: number;
  shortFormSourceClipId?: unknown;
  shortFormSelectionStartMs?: unknown;
  shortFormSelectionEndMs?: unknown;
}

type EditableClipLike = ClipSelectionLike & {
  sourceStartMs: number;
  sourceEndMs: number;
};

type UnknownRecord = Record<string, unknown>;

function materializationClipIdentity(clip: ClipSelectionLike): string {
  return safeIdentifier(
    clip.shortFormSourceClipId || clip.id,
    "클립 원본 ID"
  );
}

function materializationClipSelection(clip: Pick<
  ClipSelectionLike,
  | "selectionStartMs"
  | "selectionEndMs"
  | "shortFormSelectionStartMs"
  | "shortFormSelectionEndMs"
>): {
  selectionStartMs: number;
  selectionEndMs: number;
} {
  const anchoredStart = Number(clip.shortFormSelectionStartMs);
  const anchoredEnd = Number(clip.shortFormSelectionEndMs);
  return {
    selectionStartMs: Number.isFinite(anchoredStart)
      ? anchoredStart
      : clip.selectionStartMs,
    selectionEndMs: Number.isFinite(anchoredEnd)
      ? anchoredEnd
      : clip.selectionEndMs
  };
}

function fail(message: string): never {
  throw new TypeError(message);
}

function isPlainRecord(value: unknown): value is UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function normalizeChzzkVodRightsConfirmation(
  value: unknown,
  expectedContentId: unknown
): ChzzkVodRightsConfirmation | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  const contentId = String(expectedContentId || "").trim();
  const confirmedAt = String(value.confirmedAt || "").trim();
  if (
    value.scope !== "owned-or-authorized-public-vod"
    || value.contentId !== contentId
    || !/^[A-Za-z0-9_-]{1,128}$/u.test(contentId)
    || !Number.isFinite(Date.parse(confirmedAt))
    || Object.keys(value).some((key) => ![
      "scope",
      "contentId",
      "confirmedAt"
    ].includes(key))
  ) {
    return null;
  }
  return {
    scope: "owned-or-authorized-public-vod",
    contentId,
    confirmedAt
  };
}

export function materializedMediaTimelineMatches(
  materialization: ChzzkVodMaterialization,
  media: { durationMs: number; mediaOriginMs?: number }
): boolean {
  const durationMs = Number(media.durationMs);
  const mediaOriginMs = Number(media.mediaOriginMs || 0);
  const durationDeltaMs = durationMs - materialization.mediaDurationMs;
  return Number.isFinite(durationMs)
    && durationMs > 0
    && Number.isFinite(mediaOriginMs)
    && mediaOriginMs >= 0
    && mediaOriginMs <= 100
    // Extra container tail is harmless, but a short local file means an
    // authorized source endpoint may not exist. Keep this lower bound aligned
    // with the renderer's source-end tolerance instead of accepting the old
    // symmetric 250 ms drift in the missing-content direction.
    && durationDeltaMs >= -MAX_MATERIALIZED_MEDIA_SHORTFALL_MS
    && durationDeltaMs <= MAX_MATERIALIZED_MEDIA_DRIFT_MS;
}

function assertFiniteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    fail(`${label} 값은 유한한 숫자여야 합니다.`);
  }
  return value;
}

function assertNonNegativeNumber(value: number, label: string): number {
  assertFiniteNumber(value, label);
  if (value < 0) {
    fail(`${label} 값은 0 이상이어야 합니다.`);
  }
  return value;
}

function assertSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    fail(`${label} 값은 안전한 정수여야 합니다.`);
  }
  return value;
}

function assertNonNegativeSafeInteger(value: number, label: string): number {
  assertSafeInteger(value, label);
  if (value < 0) {
    fail(`${label} 값은 0 이상의 정수여야 합니다.`);
  }
  return value;
}

function assertPositiveSafeInteger(value: number, label: string): number {
  assertSafeInteger(value, label);
  if (value <= 0) {
    fail(`${label} 값은 양의 정수여야 합니다.`);
  }
  return value;
}

function assertPositiveRange(
  startMs: number,
  endMs: number,
  label: string
): void {
  assertFiniteNumber(startMs, `${label} 시작`);
  assertFiniteNumber(endMs, `${label} 끝`);
  if (endMs <= startMs) {
    fail(`${label}은 끝이 시작보다 큰 half-open 구간이어야 합니다.`);
  }
}

function safeIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string") {
    fail(`${label} 값은 문자열이어야 합니다.`);
  }
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > 240
    || !SAFE_IDENTIFIER_PATTERN.test(normalized)
  ) {
    fail(`${label} 값이 안전한 식별자 형식이 아닙니다.`);
  }
  return normalized;
}

function uniqueIdentifiers(values: readonly string[], label: string): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const identifier = safeIdentifier(value, label);
    if (!seen.has(identifier)) {
      seen.add(identifier);
      normalized.push(identifier);
    }
  }
  if (normalized.length === 0) {
    fail(`${label} 목록은 비어 있을 수 없습니다.`);
  }
  return normalized;
}

function unionIdentifiers(
  first: readonly string[],
  second: readonly string[]
): string[] {
  return [...new Set([...first, ...second])];
}

function approximatelyEqual(first: number, second: number): boolean {
  return Math.abs(first - second) <= TIME_EPSILON_MS;
}

function rangesHaveNoGap(
  firstEndMs: number,
  secondStartMs: number
): boolean {
  return secondStartMs <= firstEndMs + TIME_EPSILON_MS;
}

/**
 * Expands selected source ranges by the requested editing handle, clamps them
 * to the VOD duration and unions overlapping or touching half-open ranges.
 */
export function expandAndMergeClipRanges(
  clips: readonly MaterializationClipRange[],
  sourceDurationMs: number,
  handleMs = DEFAULT_MATERIALIZATION_HANDLE_MS
): LogicalMaterializationWindow[] {
  assertFiniteNumber(sourceDurationMs, "원본 길이");
  if (sourceDurationMs <= 0) {
    fail("원본 길이는 0보다 커야 합니다.");
  }
  assertNonNegativeNumber(handleMs, "편집 여유");

  const expanded = clips.map((clip, index) => {
    const clipId = safeIdentifier(clip.clipId, `클립 ${index + 1} ID`);
    assertPositiveRange(
      clip.sourceStartMs,
      clip.sourceEndMs,
      `클립 ${clipId}`
    );
    if (
      clip.sourceEndMs <= 0
      || clip.sourceStartMs >= sourceDurationMs
    ) {
      fail(`클립 ${clipId}이 원본 재생 범위와 겹치지 않습니다.`);
    }
    return {
      editableSourceStartMs: Math.max(0, clip.sourceStartMs - handleMs),
      editableSourceEndMs: Math.min(
        sourceDurationMs,
        clip.sourceEndMs + handleMs
      ),
      clipIds: [clipId]
    } satisfies LogicalMaterializationWindow;
  }).sort((first, second) => (
    first.editableSourceStartMs - second.editableSourceStartMs
    || first.editableSourceEndMs - second.editableSourceEndMs
    || first.clipIds[0]!.localeCompare(second.clipIds[0]!)
  ));

  const merged: LogicalMaterializationWindow[] = [];
  for (const window of expanded) {
    const previous = merged.at(-1);
    if (
      previous
      && window.editableSourceStartMs
        <= previous.editableSourceEndMs + TIME_EPSILON_MS
    ) {
      previous.editableSourceEndMs = Math.max(
        previous.editableSourceEndMs,
        window.editableSourceEndMs
      );
      previous.clipIds = unionIdentifiers(previous.clipIds, window.clipIds);
      continue;
    }
    merged.push({
      ...window,
      clipIds: [...window.clipIds]
    });
  }
  return merged;
}

/** Builds deterministic per-clip request and editable coverage for v2. */
export function createMaterializationClipCoverages(
  clips: readonly MaterializationClipRange[],
  sourceDurationMs: number,
  handleMs = DEFAULT_MATERIALIZATION_HANDLE_MS,
  desiredEditableRanges?: readonly MaterializationDesiredEditableRange[]
): MaterializationClipCoverage[] {
  const normalizedClips = clips.map((clip, index) => {
    if (
      !Number.isSafeInteger(clip.sourceStartMs)
      || !Number.isSafeInteger(clip.sourceEndMs)
    ) {
      fail(`클립 ${index + 1} 요청 구간은 안전한 정수 밀리초여야 합니다.`);
    }
    return { ...clip };
  });
  // Reuse the strict range validation and source-duration checks above while
  // retaining each clip separately from the union windows.
  expandAndMergeClipRanges(normalizedClips, sourceDurationMs, handleMs);
  const desiredById = new Map<string, MaterializationDesiredEditableRange>();
  if (desiredEditableRanges !== undefined) {
    if (
      !Array.isArray(desiredEditableRanges)
      || desiredEditableRanges.length !== normalizedClips.length
    ) {
      fail("확장 편집 범위는 모든 클립에 정확히 하나씩 있어야 합니다.");
    }
    for (const [index, desired] of desiredEditableRanges.entries()) {
      const clipId = safeIdentifier(desired.clipId, `확장 편집 범위 ${index + 1} ID`);
      if (desiredById.has(clipId)) {
        fail("확장 편집 범위의 clipId는 중복될 수 없습니다.");
      }
      if (
        !Number.isSafeInteger(desired.editableSourceStartMs)
        || !Number.isSafeInteger(desired.editableSourceEndMs)
      ) {
        fail("확장 편집 범위는 안전한 정수 밀리초여야 합니다.");
      }
      desiredById.set(clipId, { ...desired, clipId });
    }
  }
  const ids = new Set<string>();
  const coverages = normalizedClips.map((clip, index) => {
    const clipId = safeIdentifier(clip.clipId, `클립 ${index + 1} ID`);
    if (ids.has(clipId)) {
      fail("materialization clipRanges의 clipId는 중복될 수 없습니다.");
    }
    ids.add(clipId);
    const minimumStartMs = Math.max(0, clip.sourceStartMs - handleMs);
    const minimumEndMs = Math.min(sourceDurationMs, clip.sourceEndMs + handleMs);
    const desired = desiredById.get(clipId);
    const editableSourceStartMs = desired?.editableSourceStartMs
      ?? minimumStartMs;
    const editableSourceEndMs = desired?.editableSourceEndMs
      ?? minimumEndMs;
    if (
      editableSourceStartMs < 0
      || editableSourceStartMs > minimumStartMs
      || editableSourceEndMs < minimumEndMs
      || editableSourceEndMs > sourceDurationMs
      || editableSourceEndMs <= editableSourceStartMs
    ) {
      fail("확장 편집 범위는 원래 선택의 ±10초를 포함하고 원본 안에 있어야 합니다.");
    }
    return {
      clipId,
      sourceStartMs: clip.sourceStartMs,
      sourceEndMs: clip.sourceEndMs,
      editableSourceStartMs,
      editableSourceEndMs
    };
  });
  if (
    desiredEditableRanges !== undefined
    && [...desiredById.keys()].some((clipId) => !ids.has(clipId))
  ) {
    fail("확장 편집 범위의 clipId 목록이 원본 클립과 정확히 일치해야 합니다.");
  }
  return coverages.sort((left, right) => left.clipId.localeCompare(right.clipId));
}

/** Unions exact per-clip editable coverage without applying the handle twice. */
export function mergeMaterializationClipCoverages(
  coverages: readonly MaterializationClipCoverage[]
): LogicalMaterializationWindow[] {
  const ordered = coverages.map((coverage, index) => {
    const clipId = safeIdentifier(coverage.clipId, `편집 범위 ${index + 1} ID`);
    assertPositiveRange(
      coverage.editableSourceStartMs,
      coverage.editableSourceEndMs,
      `편집 범위 ${clipId}`
    );
    return {
      editableSourceStartMs: coverage.editableSourceStartMs,
      editableSourceEndMs: coverage.editableSourceEndMs,
      clipIds: [clipId]
    };
  }).sort((left, right) => (
    left.editableSourceStartMs - right.editableSourceStartMs
    || left.editableSourceEndMs - right.editableSourceEndMs
    || left.clipIds[0]!.localeCompare(right.clipIds[0]!)
  ));
  const merged: LogicalMaterializationWindow[] = [];
  for (const coverage of ordered) {
    const previous = merged.at(-1);
    if (
      previous
      && coverage.editableSourceStartMs
        <= previous.editableSourceEndMs + TIME_EPSILON_MS
    ) {
      previous.editableSourceEndMs = Math.max(
        previous.editableSourceEndMs,
        coverage.editableSourceEndMs
      );
      previous.clipIds = unionIdentifiers(previous.clipIds, coverage.clipIds);
    } else {
      merged.push({ ...coverage, clipIds: [...coverage.clipIds] });
    }
  }
  return merged;
}

function repeatBoundary(
  input: MpdSegmentTimelineInput,
  entryIndex: number,
  segmentStart: number,
  presentationTimeOffset: number
): number {
  const nextEntry = input.entries[entryIndex + 1];
  if (nextEntry) {
    if (nextEntry.t === undefined) {
      fail("r=-1 다음 SegmentTimeline 항목에는 t가 필요합니다.");
    }
    return assertNonNegativeSafeInteger(
      nextEntry.t,
      "r=-1 다음 세그먼트 t"
    );
  }
  if (input.periodDurationMs === undefined) {
    fail("마지막 r=-1 항목을 펼치려면 periodDurationMs가 필요합니다.");
  }
  assertFiniteNumber(input.periodDurationMs, "Period 길이");
  if (input.periodDurationMs <= 0) {
    fail("Period 길이는 0보다 커야 합니다.");
  }
  const boundary = presentationTimeOffset
    + input.periodDurationMs * input.timescale / 1_000;
  assertFiniteNumber(boundary, "r=-1 반복 경계");
  if (boundary <= segmentStart) {
    fail("r=-1 반복 경계는 세그먼트 시작보다 뒤여야 합니다.");
  }
  return boundary;
}

/**
 * Expands the MPD SegmentTimeline into concrete segment descriptors. `r`
 * counts additional segments. A negative repeat is expanded through the next
 * explicit `t`, or through the Period end for the final timeline entry.
 */
export function expandSegmentTimeline(
  input: MpdSegmentTimelineInput
): ExpandedMpdSegment[] {
  const timescale = assertPositiveSafeInteger(input.timescale, "timescale");
  const presentationTimeOffset = assertNonNegativeSafeInteger(
    input.presentationTimeOffset ?? 0,
    "presentationTimeOffset"
  );
  const periodStartMs = assertNonNegativeNumber(
    input.periodStartMs ?? 0,
    "Period 시작"
  );
  const startNumber = assertNonNegativeSafeInteger(
    input.startNumber ?? 1,
    "startNumber"
  );
  if (input.entries.length === 0) {
    fail("SegmentTimeline 항목이 비어 있습니다.");
  }

  const segments: ExpandedMpdSegment[] = [];
  let inferredTime = 0;
  for (const [entryIndex, entry] of input.entries.entries()) {
    const duration = assertPositiveSafeInteger(
      entry.d,
      `SegmentTimeline ${entryIndex + 1} d`
    );
    const explicitTime = entry.t === undefined
      ? undefined
      : assertNonNegativeSafeInteger(
        entry.t,
        `SegmentTimeline ${entryIndex + 1} t`
      );
    const segmentStart = explicitTime ?? inferredTime;
    const repeat = entry.r ?? 0;
    assertSafeInteger(repeat, `SegmentTimeline ${entryIndex + 1} r`);
    if (repeat < -1) {
      fail("SegmentTimeline r은 -1 이상의 정수여야 합니다.");
    }

    const count = repeat >= 0
      ? repeat + 1
      : Math.ceil(
        (repeatBoundary(
          input,
          entryIndex,
          segmentStart,
          presentationTimeOffset
        ) - segmentStart) / duration
      );
    if (count <= 0) {
      fail("SegmentTimeline 반복 결과가 비어 있습니다.");
    }
    if (segments.length + count > MAX_EXPANDED_SEGMENTS) {
      fail("SegmentTimeline이 안전한 최대 세그먼트 수를 초과합니다.");
    }

    for (let repeatIndex = 0; repeatIndex < count; repeatIndex += 1) {
      const time = segmentStart + repeatIndex * duration;
      const number = startNumber + segments.length;
      assertSafeInteger(time, "세그먼트 time");
      assertSafeInteger(number, "세그먼트 number");
      const sourceStartMs = periodStartMs
        + (time - presentationTimeOffset) * 1_000 / timescale;
      const sourceEndMs = periodStartMs
        + (time + duration - presentationTimeOffset) * 1_000 / timescale;
      segments.push({
        index: segments.length,
        number,
        time,
        duration,
        sourceStartMs,
        sourceEndMs
      });
    }
    inferredTime = segmentStart + count * duration;
  }
  return segments;
}

function paddedInteger(value: number, widthText: string): string {
  const width = Number(widthText);
  if (!Number.isSafeInteger(width) || width <= 0 || width > 20) {
    fail("세그먼트 템플릿 숫자 너비가 올바르지 않습니다.");
  }
  return String(value).padStart(width, "0");
}

/** Resolves the DASH template identifiers used by CHZZK's media segments. */
export function substituteSegmentTemplate(
  template: string,
  values: SegmentTemplateValues
): string {
  if (typeof template !== "string" || template.length === 0) {
    fail("세그먼트 템플릿이 비어 있습니다.");
  }
  const representationId = String(values.representationId);
  if (!representationId || representationId.includes("$")) {
    fail("Representation ID가 올바르지 않습니다.");
  }
  assertNonNegativeSafeInteger(values.number, "세그먼트 number");
  assertNonNegativeSafeInteger(values.time, "세그먼트 time");

  let result = "";
  let cursor = 0;
  while (cursor < template.length) {
    const marker = template.indexOf("$", cursor);
    if (marker < 0) {
      result += template.slice(cursor);
      break;
    }
    result += template.slice(cursor, marker);
    if (template[marker + 1] === "$") {
      result += "$";
      cursor = marker + 2;
      continue;
    }
    const end = template.indexOf("$", marker + 1);
    if (end < 0) {
      fail("세그먼트 템플릿의 $ 구분자가 닫히지 않았습니다.");
    }
    const token = template.slice(marker + 1, end);
    if (token === "RepresentationID") {
      result += representationId;
    } else if (token === "Number") {
      result += String(values.number);
    } else if (token === "Time") {
      result += String(values.time);
    } else {
      const numberFormat = /^Number%0([1-9]\d*)d$/u.exec(token);
      if (!numberFormat) {
        fail(`지원하지 않는 세그먼트 템플릿 토큰입니다: ${token}`);
      }
      result += paddedInteger(values.number, numberFormat[1]!);
    }
    cursor = end + 1;
  }
  return result;
}

function validateExpandedSegments(
  segments: readonly ExpandedMpdSegment[]
): void {
  let previousIndex = -1;
  let previousNumber = -1;
  let previousStartMs = Number.NEGATIVE_INFINITY;
  for (const [position, segment] of segments.entries()) {
    assertNonNegativeSafeInteger(segment.index, `세그먼트 ${position + 1} index`);
    assertNonNegativeSafeInteger(segment.number, `세그먼트 ${position + 1} number`);
    assertNonNegativeSafeInteger(segment.time, `세그먼트 ${position + 1} time`);
    assertPositiveSafeInteger(segment.duration, `세그먼트 ${position + 1} duration`);
    assertPositiveRange(
      segment.sourceStartMs,
      segment.sourceEndMs,
      `세그먼트 ${position + 1}`
    );
    if (
      segment.index <= previousIndex
      || segment.number <= previousNumber
      || segment.sourceStartMs < previousStartMs
    ) {
      fail("세그먼트 목록은 시간·index·number 오름차순이어야 합니다.");
    }
    previousIndex = segment.index;
    previousNumber = segment.number;
    previousStartMs = segment.sourceStartMs;
  }
}

function normalizeLogicalWindow(
  window: LogicalMaterializationWindow,
  index: number
): LogicalMaterializationWindow {
  assertPositiveRange(
    window.editableSourceStartMs,
    window.editableSourceEndMs,
    `논리 구간 ${index + 1}`
  );
  return {
    editableSourceStartMs: window.editableSourceStartMs,
    editableSourceEndMs: window.editableSourceEndMs,
    clipIds: uniqueIdentifiers(window.clipIds, `논리 구간 ${index + 1} clipIds`)
  };
}

function selectedSegmentsForWindow(
  segments: readonly ExpandedMpdSegment[],
  window: LogicalMaterializationWindow
): ExpandedMpdSegment[] {
  const selected = segments.filter((segment) => (
    segment.sourceStartMs < window.editableSourceEndMs
    && segment.sourceEndMs > window.editableSourceStartMs
  ));
  if (selected.length === 0) {
    fail("논리 편집 구간과 겹치는 미디어 세그먼트가 없습니다.");
  }
  const first = selected[0]!;
  const last = selected.at(-1)!;
  if (
    first.sourceStartMs > window.editableSourceStartMs + TIME_EPSILON_MS
    || last.sourceEndMs < window.editableSourceEndMs - TIME_EPSILON_MS
  ) {
    fail("선택된 세그먼트가 논리 편집 구간 전체를 덮지 못합니다.");
  }
  for (let index = 1; index < selected.length; index += 1) {
    const previous = selected[index - 1]!;
    const current = selected[index]!;
    if (
      current.index !== previous.index + 1
      || !rangesHaveNoGap(previous.sourceEndMs, current.sourceStartMs)
    ) {
      fail("논리 편집 구간 중간에 미디어 세그먼트 공백이 있습니다.");
    }
  }
  return selected.map((segment) => ({ ...segment }));
}

function canMergeRuns(
  first: PlannedSegmentRun,
  second: PlannedSegmentRun
): boolean {
  const firstLast = first.segments.at(-1)!;
  const secondFirst = second.segments[0]!;
  return secondFirst.index <= firstLast.index + 1
    && rangesHaveNoGap(first.fetchedSourceEndMs, second.fetchedSourceStartMs);
}

function mergeRunSegments(
  first: readonly ExpandedMpdSegment[],
  second: readonly ExpandedMpdSegment[]
): ExpandedMpdSegment[] {
  const byIndex = new Map<number, ExpandedMpdSegment>();
  for (const segment of [...first, ...second]) {
    byIndex.set(segment.index, { ...segment });
  }
  return [...byIndex.values()].sort((left, right) => left.index - right.index);
}

/** Selects whole segments and groups overlapping/adjacent selections into runs. */
export function planSegmentRuns(
  segments: readonly ExpandedMpdSegment[],
  logicalWindows: readonly LogicalMaterializationWindow[]
): PlannedSegmentRun[] {
  if (segments.length === 0 && logicalWindows.length > 0) {
    fail("계획에 사용할 미디어 세그먼트가 없습니다.");
  }
  validateExpandedSegments(segments);
  const normalizedWindows = logicalWindows
    .map(normalizeLogicalWindow)
    .sort((first, second) => (
      first.editableSourceStartMs - second.editableSourceStartMs
      || first.editableSourceEndMs - second.editableSourceEndMs
    ));
  const planned = normalizedWindows.map((window) => {
    const selected = selectedSegmentsForWindow(segments, window);
    return {
      editableSourceStartMs: window.editableSourceStartMs,
      editableSourceEndMs: window.editableSourceEndMs,
      fetchedSourceStartMs: selected[0]!.sourceStartMs,
      fetchedSourceEndMs: selected.at(-1)!.sourceEndMs,
      clipIds: [...window.clipIds],
      segments: selected,
      decoderPrefixSegmentCount: 0
    } satisfies PlannedSegmentRun;
  });

  const runs: PlannedSegmentRun[] = [];
  for (const run of planned) {
    const previous = runs.at(-1);
    if (previous && canMergeRuns(previous, run)) {
      previous.editableSourceStartMs = Math.min(
        previous.editableSourceStartMs,
        run.editableSourceStartMs
      );
      previous.editableSourceEndMs = Math.max(
        previous.editableSourceEndMs,
        run.editableSourceEndMs
      );
      previous.fetchedSourceStartMs = Math.min(
        previous.fetchedSourceStartMs,
        run.fetchedSourceStartMs
      );
      previous.fetchedSourceEndMs = Math.max(
        previous.fetchedSourceEndMs,
        run.fetchedSourceEndMs
      );
      previous.clipIds = unionIdentifiers(previous.clipIds, run.clipIds);
      previous.segments = mergeRunSegments(previous.segments, run.segments);
      continue;
    }
    runs.push({
      ...run,
      clipIds: [...run.clipIds],
      segments: run.segments.map((segment) => ({ ...segment }))
    });
  }
  return runs;
}

/**
 * Prepends an exact number of earlier contiguous segments to a run. The
 * editable range stays unchanged, keeping decoder padding out of trim bounds.
 */
export function prependDecoderPrefixSegments(
  run: PlannedSegmentRun,
  allSegments: readonly ExpandedMpdSegment[],
  count = 1
): PlannedSegmentRun {
  assertNonNegativeSafeInteger(count, "decoder prefix 세그먼트 수");
  validateExpandedSegments(allSegments);
  if (run.segments.length === 0) {
    fail("decoder prefix를 붙일 세그먼트 run이 비어 있습니다.");
  }
  const first = run.segments[0]!;
  const firstPosition = allSegments.findIndex((candidate) => (
    candidate.index === first.index
    && candidate.number === first.number
    && candidate.time === first.time
  ));
  if (firstPosition < 0) {
    fail("세그먼트 run의 시작점을 원본 timeline에서 찾지 못했습니다.");
  }
  if (count > firstPosition) {
    fail("요청한 decoder prefix 이전 세그먼트가 충분하지 않습니다.");
  }
  if (count === 0) {
    return {
      ...run,
      clipIds: [...run.clipIds],
      segments: run.segments.map((segment) => ({ ...segment }))
    };
  }
  const prefix = allSegments.slice(firstPosition - count, firstPosition);
  const combined = [...prefix, ...run.segments];
  for (let index = 1; index < combined.length; index += 1) {
    const previous = combined[index - 1]!;
    const current = combined[index]!;
    if (
      current.index !== previous.index + 1
      || !rangesHaveNoGap(previous.sourceEndMs, current.sourceStartMs)
    ) {
      fail("decoder prefix 세그먼트가 기존 run과 연속되지 않습니다.");
    }
  }
  return {
    ...run,
    fetchedSourceStartMs: combined[0]!.sourceStartMs,
    fetchedSourceEndMs: combined.at(-1)!.sourceEndMs,
    clipIds: [...run.clipIds],
    segments: combined.map((segment) => ({ ...segment })),
    decoderPrefixSegmentCount: run.decoderPrefixSegmentCount + count
  };
}

/** Creates compact-media mapping windows in source order. */
export function createMaterializationWindows(
  runs: readonly PlannedSegmentRun[]
): MaterializationWindow[] {
  let mediaCursorMs = 0;
  return runs.map((run, index) => {
    assertPositiveRange(
      run.fetchedSourceStartMs,
      run.fetchedSourceEndMs,
      `세그먼트 run ${index + 1}`
    );
    if (
      run.editableSourceStartMs < run.fetchedSourceStartMs
      || run.editableSourceEndMs > run.fetchedSourceEndMs
    ) {
      fail("논리 편집 구간은 내려받은 세그먼트 구간 안에 있어야 합니다.");
    }
    const durationMs = run.fetchedSourceEndMs - run.fetchedSourceStartMs;
    const window: MaterializationWindow = {
      id: `window-${index + 1}`,
      editableSourceStartMs: run.editableSourceStartMs,
      editableSourceEndMs: run.editableSourceEndMs,
      fetchedSourceStartMs: run.fetchedSourceStartMs,
      fetchedSourceEndMs: run.fetchedSourceEndMs,
      mediaStartMs: mediaCursorMs,
      mediaEndMs: mediaCursorMs + durationMs,
      clipIds: uniqueIdentifiers(run.clipIds, `세그먼트 run ${index + 1} clipIds`)
    };
    mediaCursorMs = window.mediaEndMs;
    return window;
  });
}

function hasOnlyKeys(record: UnknownRecord, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(record).every((key) => allowedKeys.has(key));
}

function requiredNumber(record: UnknownRecord, key: string): number {
  const value = record[key];
  if (typeof value !== "number") {
    fail(`${key} 값은 숫자여야 합니다.`);
  }
  return assertFiniteNumber(value, key);
}

function parseMaterializationWindow(
  value: unknown,
  index: number
): MaterializationWindow {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, [
    "id",
    "editableSourceStartMs",
    "editableSourceEndMs",
    "fetchedSourceStartMs",
    "fetchedSourceEndMs",
    "mediaStartMs",
    "mediaEndMs",
    "clipIds"
  ])) {
    fail(`materialization window ${index + 1} 구조가 올바르지 않습니다.`);
  }
  const editableSourceStartMs = requiredNumber(value, "editableSourceStartMs");
  const editableSourceEndMs = requiredNumber(value, "editableSourceEndMs");
  const fetchedSourceStartMs = requiredNumber(value, "fetchedSourceStartMs");
  const fetchedSourceEndMs = requiredNumber(value, "fetchedSourceEndMs");
  const mediaStartMs = requiredNumber(value, "mediaStartMs");
  const mediaEndMs = requiredNumber(value, "mediaEndMs");
  assertPositiveRange(
    editableSourceStartMs,
    editableSourceEndMs,
    `materialization window ${index + 1} 편집 구간`
  );
  assertPositiveRange(
    fetchedSourceStartMs,
    fetchedSourceEndMs,
    `materialization window ${index + 1} 다운로드 구간`
  );
  assertPositiveRange(
    mediaStartMs,
    mediaEndMs,
    `materialization window ${index + 1} 로컬 미디어 구간`
  );
  if (
    editableSourceStartMs < fetchedSourceStartMs
    || editableSourceEndMs > fetchedSourceEndMs
    || mediaStartMs < 0
  ) {
    fail("편집·다운로드·로컬 미디어 구간의 포함 관계가 올바르지 않습니다.");
  }
  const fetchedDurationMs = fetchedSourceEndMs - fetchedSourceStartMs;
  const mediaDurationMs = mediaEndMs - mediaStartMs;
  if (Math.abs(fetchedDurationMs - mediaDurationMs) > MEDIA_DURATION_TOLERANCE_MS) {
    fail("다운로드 구간과 로컬 미디어 구간의 길이가 일치하지 않습니다.");
  }
  if (!Array.isArray(value.clipIds)) {
    fail("materialization window clipIds는 배열이어야 합니다.");
  }
  return {
    id: safeIdentifier(value.id, `materialization window ${index + 1} ID`),
    editableSourceStartMs,
    editableSourceEndMs,
    fetchedSourceStartMs,
    fetchedSourceEndMs,
    mediaStartMs,
    mediaEndMs,
    clipIds: uniqueIdentifiers(
      value.clipIds.map((clipId) => {
        if (typeof clipId !== "string") {
          fail("materialization window clip ID는 문자열이어야 합니다.");
        }
        return clipId;
      }),
      `materialization window ${index + 1} clipIds`
    )
  };
}

function parseMaterializationClipCoverage(
  value: unknown,
  index: number,
  sourceDurationMs: number,
  handleMs: number
): MaterializationClipCoverage {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, [
    "clipId",
    "sourceStartMs",
    "sourceEndMs",
    "editableSourceStartMs",
    "editableSourceEndMs"
  ])) {
    fail(`materialization clipRanges ${index + 1} 구조가 올바르지 않습니다.`);
  }
  const sourceStartMs = requiredNumber(value, "sourceStartMs");
  const sourceEndMs = requiredNumber(value, "sourceEndMs");
  const editableSourceStartMs = requiredNumber(
    value,
    "editableSourceStartMs"
  );
  const editableSourceEndMs = requiredNumber(value, "editableSourceEndMs");
  assertPositiveRange(
    sourceStartMs,
    sourceEndMs,
    `materialization clipRanges ${index + 1} 요청 구간`
  );
  assertPositiveRange(
    editableSourceStartMs,
    editableSourceEndMs,
    `materialization clipRanges ${index + 1} 편집 구간`
  );
  if (
    !Number.isSafeInteger(sourceStartMs)
    || !Number.isSafeInteger(sourceEndMs)
    || !Number.isSafeInteger(editableSourceStartMs)
    || !Number.isSafeInteger(editableSourceEndMs)
    || sourceStartMs < 0
    || sourceEndMs > sourceDurationMs
    || editableSourceStartMs < 0
    || editableSourceStartMs > Math.max(0, sourceStartMs - handleMs)
    || editableSourceEndMs < Math.min(sourceDurationMs, sourceEndMs + handleMs)
    || editableSourceEndMs > sourceDurationMs
  ) {
    fail("materialization clipRanges의 요청·편집 범위 관계가 올바르지 않습니다.");
  }
  return {
    clipId: safeIdentifier(value.clipId, `materialization clipRanges ${index + 1} ID`),
    sourceStartMs,
    sourceEndMs,
    editableSourceStartMs,
    editableSourceEndMs
  };
}

function parseSource(value: unknown): ChzzkVodMaterializationSource {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, [
    "platform",
    "contentType",
    "contentId",
    "sourceVersionId"
  ])) {
    fail("VOD 원본 식별 구조가 올바르지 않습니다.");
  }
  if (
    !["CHZZK", "YOUTUBE", "SOOP"].includes(String(value.platform))
    || value.contentType !== "vod"
  ) {
    fail("materialization 원본은 지원하는 VOD여야 합니다.");
  }
  if (
    typeof value.contentId !== "string"
    || !/^[A-Za-z0-9_-]{1,128}$/u.test(value.contentId)
  ) {
    fail("VOD contentId 형식이 올바르지 않습니다.");
  }
  const sourceVersionId = value.sourceVersionId === undefined
    ? undefined
    : safeIdentifier(value.sourceVersionId, "원본 버전 ID");
  return {
    platform: value.platform as ChzzkVodMaterializationSource["platform"],
    contentType: "vod",
    contentId: value.contentId,
    ...(sourceVersionId === undefined ? {} : { sourceVersionId })
  };
}

function parsePreparedAt(value: unknown): string {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    || !Number.isFinite(Date.parse(value))
  ) {
    fail("preparedAt은 UTC ISO 시각이어야 합니다.");
  }
  return value;
}

function parseMaterialization(value: unknown): ChzzkVodMaterialization {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, [
    "schema",
    "materializationId",
    "planFingerprint",
    "source",
    "sourceDurationMs",
    "handleMs",
    "mediaDurationMs",
    "windows",
    "clipRanges",
    "preparedAt",
    "localOnly"
  ])) {
    fail("CHZZK VOD materialization 구조가 올바르지 않습니다.");
  }
  if (
    ![
      CHZZK_VOD_MATERIALIZATION_SCHEMA,
      LEGACY_CHZZK_VOD_MATERIALIZATION_SCHEMA
    ].includes(String(value.schema))
    || value.localOnly !== true
  ) {
    fail("CHZZK VOD materialization schema 또는 localOnly 값이 올바르지 않습니다.");
  }
  const sourceDurationMs = requiredNumber(value, "sourceDurationMs");
  const handleMs = requiredNumber(value, "handleMs");
  const mediaDurationMs = requiredNumber(value, "mediaDurationMs");
  if (sourceDurationMs <= 0 || handleMs < 0 || mediaDurationMs <= 0) {
    fail("materialization 길이 값이 올바르지 않습니다.");
  }
  if (!Array.isArray(value.windows) || value.windows.length === 0) {
    fail("materialization windows는 비어 있지 않은 배열이어야 합니다.");
  }
  const windows = value.windows.map(parseMaterializationWindow);
  const clipRanges = value.schema === CHZZK_VOD_MATERIALIZATION_SCHEMA
    ? (
      Array.isArray(value.clipRanges) && value.clipRanges.length > 0
        ? value.clipRanges.map((entry, index) => (
          parseMaterializationClipCoverage(
            entry,
            index,
            sourceDurationMs,
            handleMs
          )
        ))
        : fail("v2 materialization clipRanges는 비어 있지 않은 배열이어야 합니다.")
    )
    : (
      value.clipRanges === undefined
        ? undefined
        : fail("v1 materialization에는 clipRanges가 없어야 합니다.")
    );
  const ids = new Set<string>();
  const clipIds = new Set<string>();
  for (const [index, window] of windows.entries()) {
    if (ids.has(window.id)) {
      fail("materialization window ID는 중복될 수 없습니다.");
    }
    ids.add(window.id);
    for (const clipId of window.clipIds) {
      if (clipIds.has(clipId)) {
        fail("하나의 클립은 여러 materialization window에 걸칠 수 없습니다.");
      }
      clipIds.add(clipId);
    }
    if (
      window.editableSourceStartMs < 0
      || window.editableSourceEndMs > sourceDurationMs
    ) {
      fail("논리 편집 구간이 원본 길이를 벗어났습니다.");
    }
    const previous = windows[index - 1];
    if (previous) {
      if (
        window.fetchedSourceStartMs < previous.fetchedSourceEndMs
        || !approximatelyEqual(window.mediaStartMs, previous.mediaEndMs)
      ) {
        fail("materialization window는 source에서 겹치지 않고 media에서 연속이어야 합니다.");
      }
    } else if (!approximatelyEqual(window.mediaStartMs, 0)) {
      fail("첫 materialization window는 media 0ms에서 시작해야 합니다.");
    }
  }
  if (!approximatelyEqual(windows.at(-1)!.mediaEndMs, mediaDurationMs)) {
    fail("mediaDurationMs가 마지막 materialization window 끝과 다릅니다.");
  }
  if (clipRanges) {
    const coverageIds = new Set<string>();
    for (const coverage of clipRanges) {
      if (coverageIds.has(coverage.clipId)) {
        fail("materialization clipRanges의 clipId는 중복될 수 없습니다.");
      }
      coverageIds.add(coverage.clipId);
      const containing = windows.filter((window) => (
        window.clipIds.includes(coverage.clipId)
        && coverage.editableSourceStartMs >= window.editableSourceStartMs
        && coverage.editableSourceEndMs <= window.editableSourceEndMs
      ));
      if (containing.length !== 1) {
        fail("materialization clipRanges는 정확히 하나의 다운로드 window에 포함되어야 합니다.");
      }
    }
    if (
      coverageIds.size !== clipIds.size
      || [...clipIds].some((clipId) => !coverageIds.has(clipId))
    ) {
      fail("materialization window와 clipRanges의 clipId 목록이 다릅니다.");
    }
  }
  const materializationId = safeIdentifier(
    value.materializationId,
    "materialization ID"
  );
  const planFingerprint = safeIdentifier(
    value.planFingerprint,
    "계획 fingerprint"
  );
  const source = parseSource(value.source);
  if (
    value.schema === CHZZK_VOD_MATERIALIZATION_SCHEMA
    && (
      !/^[a-f0-9]{32}$/u.test(materializationId)
      || !/^[a-f0-9]{64}$/u.test(planFingerprint)
      || materializationId !== planFingerprint.slice(0, 32)
      || !/^[a-f0-9]{64}$/u.test(source.sourceVersionId || "")
    )
  ) {
    fail("v2 materialization의 계획·원본 버전 identity가 올바르지 않습니다.");
  }
  if (clipRanges) {
    for (const window of windows) {
      const windowCoverages = clipRanges.filter((coverage) => (
        window.clipIds.includes(coverage.clipId)
      ));
      const exactEditableStartMs = Math.min(
        ...windowCoverages.map((coverage) => coverage.editableSourceStartMs)
      );
      const exactEditableEndMs = Math.max(
        ...windowCoverages.map((coverage) => coverage.editableSourceEndMs)
      );
      if (
        window.editableSourceStartMs !== exactEditableStartMs
        || window.editableSourceEndMs !== exactEditableEndMs
        || window.fetchedSourceStartMs < 0
        || window.fetchedSourceEndMs > sourceDurationMs
      ) {
        fail("v2 materialization window가 clipRanges의 정확한 편집 범위와 다릅니다.");
      }
      if (
        source.platform !== "CHZZK"
        && (
          window.fetchedSourceStartMs !== window.editableSourceStartMs
          || window.fetchedSourceEndMs !== window.editableSourceEndMs
        )
      ) {
        fail("외부 VOD materialization은 요청한 편집 범위만 포함해야 합니다.");
      }
    }
    if (source.platform !== "CHZZK") {
      const exactWindows = mergeMaterializationClipCoverages(clipRanges);
      if (
        exactWindows.length !== windows.length
        || exactWindows.some((expectedWindow, index) => {
          const actualWindow = windows[index];
          return !actualWindow
            || actualWindow.editableSourceStartMs
              !== expectedWindow.editableSourceStartMs
            || actualWindow.editableSourceEndMs
              !== expectedWindow.editableSourceEndMs
            || actualWindow.clipIds.length !== expectedWindow.clipIds.length
            || expectedWindow.clipIds.some((clipId) => (
              !actualWindow.clipIds.includes(clipId)
            ));
        })
      ) {
        fail("외부 VOD materialization window가 clipRanges 합집합과 다릅니다.");
      }
    }
  }
  return {
    schema: value.schema as ChzzkVodMaterialization["schema"],
    materializationId,
    planFingerprint,
    source,
    sourceDurationMs,
    handleMs,
    mediaDurationMs,
    windows,
    ...(clipRanges ? { clipRanges } : {}),
    preparedAt: parsePreparedAt(value.preparedAt),
    localOnly: true
  };
}

/** Returns a defensive, exact-schema clone or null for any invalid record. */
export function normalizeChzzkVodMaterialization(
  value: unknown
): ChzzkVodMaterialization | null {
  try {
    return parseMaterialization(value);
  } catch {
    return null;
  }
}

/** Returns a defensive, exact-schema clone and throws for an invalid record. */
export function assertChzzkVodMaterialization(
  value: unknown
): ChzzkVodMaterialization {
  return parseMaterialization(value);
}

function mapSourceWithinWindow(
  window: MaterializationWindow,
  sourceMs: number
): number {
  return window.mediaStartMs
    + (sourceMs - window.fetchedSourceStartMs);
}

function mapMediaWithinWindow(
  window: MaterializationWindow,
  mediaMs: number
): number {
  return window.fetchedSourceStartMs
    + (mediaMs - window.mediaStartMs);
}

/** Maps a source point in a fetched half-open window to compact media time. */
export function sourceMsToMediaMs(
  mapping: MaterializationMapping,
  sourceMs: number
): number | null {
  if (!Number.isFinite(sourceMs)) {
    return null;
  }
  const matches = mapping.windows.filter((window) => (
    sourceMs >= window.fetchedSourceStartMs
    && sourceMs < window.fetchedSourceEndMs
  ));
  if (matches.length !== 1) {
    return null;
  }
  return mapSourceWithinWindow(matches[0]!, sourceMs);
}

/** Maps a point in compact media back to its absolute CHZZK VOD time. */
export function mediaMsToSourceMs(
  mapping: MaterializationMapping,
  mediaMs: number
): number | null {
  if (!Number.isFinite(mediaMs)) {
    return null;
  }
  const matches = mapping.windows.filter((window) => (
    mediaMs >= window.mediaStartMs
    && mediaMs < window.mediaEndMs
  ));
  if (matches.length !== 1) {
    return null;
  }
  return mapMediaWithinWindow(matches[0]!, mediaMs);
}

function containingEditableWindow(
  mapping: MaterializationMapping,
  sourceStartMs: number,
  sourceEndMs: number,
  clipId?: string
): MaterializationWindow | null {
  const matches = mapping.windows.filter((window) => (
    sourceStartMs >= window.editableSourceStartMs
    && sourceEndMs <= window.editableSourceEndMs
    && (clipId === undefined || window.clipIds.includes(clipId))
  ));
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * Clones a clip for media-engine use, replacing only its absolute source range
 * with compact-media coordinates. The persisted source clip is never mutated.
 */
export function materializeEditorClip<
  T extends { sourceStartMs: number; sourceEndMs: number }
>(
  clip: T,
  mapping: MaterializationMapping
): T | null {
  if (
    !Number.isFinite(clip.sourceStartMs)
    || !Number.isFinite(clip.sourceEndMs)
    || clip.sourceEndMs <= clip.sourceStartMs
  ) {
    return null;
  }
  const window = containingEditableWindow(
    mapping,
    clip.sourceStartMs,
    clip.sourceEndMs
  );
  if (!window) {
    return null;
  }
  return {
    ...clip,
    sourceStartMs: mapSourceWithinWindow(window, clip.sourceStartMs),
    sourceEndMs: mapSourceWithinWindow(window, clip.sourceEndMs)
  };
}

/** Uses the immutable capture selection, not the current trim, for ±handles. */
export function logicalEditableBoundsForClip(
  clip: Pick<
    ClipSelectionLike,
    | "selectionStartMs"
    | "selectionEndMs"
    | "shortFormSelectionStartMs"
    | "shortFormSelectionEndMs"
  >,
  sourceDurationMs: number,
  handleMs = DEFAULT_MATERIALIZATION_HANDLE_MS
): ClipLogicalEditableBounds {
  const selection = materializationClipSelection(clip);
  const [window] = expandAndMergeClipRanges([{
    clipId: "clip",
    sourceStartMs: selection.selectionStartMs,
    sourceEndMs: selection.selectionEndMs
  }], sourceDurationMs, handleMs);
  if (!window) {
    fail("클립의 논리 편집 구간을 만들지 못했습니다.");
  }
  return {
    editableSourceStartMs: window.editableSourceStartMs,
    editableSourceEndMs: window.editableSourceEndMs
  };
}

/**
 * Returns the exact anchor range that produced this clip's current downloaded
 * coverage. Legacy v1 records fall back to the immutable capture selection.
 */
export function materializationRequestRangeForClip(
  clip: ClipSelectionLike,
  materialization: ChzzkVodMaterialization
): MaterializationClipRange | null {
  let clipId: string;
  try {
    clipId = materializationClipIdentity(clip);
  } catch {
    return null;
  }
  const explicit = materialization.clipRanges?.filter((range) => (
    range.clipId === clipId
  ));
  if (explicit && explicit.length !== 1) {
    return null;
  }
  const selection = materializationClipSelection(clip);
  if (explicit?.[0]) {
    if (
      explicit[0].sourceStartMs !== selection.selectionStartMs
      || explicit[0].sourceEndMs !== selection.selectionEndMs
    ) {
      return null;
    }
    return {
      clipId,
      sourceStartMs: explicit[0].sourceStartMs,
      sourceEndMs: explicit[0].sourceEndMs
    };
  }
  return {
    clipId,
    sourceStartMs: selection.selectionStartMs,
    sourceEndMs: selection.selectionEndMs
  };
}

/** Resolves a clip's allowed source trim range and its compact-media range. */
export function materializedEditableBoundsForClip(
  clip: ClipSelectionLike,
  materialization: ChzzkVodMaterialization
): ClipMaterializedEditableBounds | null {
  let clipId: string;
  let logical: ClipLogicalEditableBounds;
  try {
    clipId = materializationClipIdentity(clip);
    const explicit = materialization.clipRanges?.filter((range) => (
      range.clipId === clipId
    ));
    if (explicit && explicit.length !== 1) {
      return null;
    }
    const selection = materializationClipSelection(clip);
    if (
      explicit?.[0]
      && (
        explicit[0].sourceStartMs !== selection.selectionStartMs
        || explicit[0].sourceEndMs !== selection.selectionEndMs
      )
    ) {
      return null;
    }
    logical = explicit?.[0]
      ? {
        editableSourceStartMs: explicit[0].editableSourceStartMs,
        editableSourceEndMs: explicit[0].editableSourceEndMs
      }
      : logicalEditableBoundsForClip(
        clip,
        materialization.sourceDurationMs,
        materialization.handleMs
      );
  } catch {
    return null;
  }
  const window = containingEditableWindow(
    materialization,
    logical.editableSourceStartMs,
    logical.editableSourceEndMs,
    clipId
  );
  if (!window) {
    return null;
  }
  return {
    ...logical,
    windowId: window.id,
    mediaStartMs: mapSourceWithinWindow(
      window,
      logical.editableSourceStartMs
    ),
    mediaEndMs: mapSourceWithinWindow(
      window,
      logical.editableSourceEndMs
    )
  };
}

/**
 * Maps a persisted editor clip only when its current trim stays inside that
 * clip's own downloaded coverage. This is intentionally stricter than
 * materializeEditorClip: overlapping selections may share one union window,
 * but must never borrow each other's initial handles or later hot-load range.
 */
export function materializeEditorClipWithinEditableBounds<
  T extends EditableClipLike
>(
  clip: T,
  materialization: ChzzkVodMaterialization
): T | null {
  const bounds = materializedEditableBoundsForClip(clip, materialization);
  if (
    !bounds
    || !Number.isFinite(clip.sourceStartMs)
    || !Number.isFinite(clip.sourceEndMs)
    || clip.sourceEndMs <= clip.sourceStartMs
    || clip.sourceStartMs < bounds.editableSourceStartMs
    || clip.sourceEndMs > bounds.editableSourceEndMs
  ) {
    return null;
  }
  const window = materialization.windows.find((candidate) => (
    candidate.id === bounds.windowId
    && candidate.clipIds.includes(materializationClipIdentity(clip))
  ));
  if (!window) {
    return null;
  }
  return {
    ...clip,
    sourceStartMs: mapSourceWithinWindow(window, clip.sourceStartMs),
    sourceEndMs: mapSourceWithinWindow(window, clip.sourceEndMs)
  };
}
