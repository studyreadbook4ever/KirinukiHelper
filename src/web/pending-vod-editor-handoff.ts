import {
  captureSegmentEditorClipId,
  sourceSessionIdentity
} from "../lib/editor-core.js";
import type { CaptureState } from "../lib/editor-core.js";
import {
  normalizeUsagePolicyAttestation
} from "../lib/usage-policy.js";
import type { UsagePolicyAttestation } from "../lib/usage-policy.js";

export const PENDING_VOD_EDITOR_HANDOFF_SCHEMA =
  "kirinuki-pending-vod-editor-handoff/v1";
export const PENDING_VOD_EDITOR_HANDOFF_STORAGE_PREFIX =
  "kirinuki:pending-vod-editor-handoff:v1:";
export const PENDING_VOD_EDITOR_HANDOFF_OWNER_STORAGE_KEY =
  "kirinuki:pending-vod-editor-handoff-owner:v1";
export const PENDING_VOD_EDITOR_HANDOFF_OWNER_LOCK_PREFIX =
  "kirinuki:pending-vod-editor-handoff-owner-lock:v1:";
export const PENDING_VOD_EDITOR_HANDOFF_OWNER_CHANNEL =
  "kirinuki:pending-vod-editor-handoff-owner-claim:v1";
export const PENDING_VOD_EDITOR_HANDOFF_TTL_MS = 24 * 60 * 60 * 1_000;
const PENDING_VOD_EDITOR_HANDOFF_MAX_BYTES = 512 * 1024;
const PENDING_VOD_EDITOR_OWNER_CLAIM_WAIT_MS = 160;
const PENDING_VOD_EDITOR_OWNER_CLAIM_ATTEMPTS = 4;
const REQUEST_SCHEMA = "chzzk-kirinuki-vod-materialization-request/v4";
const CONTINUATION_POLICY = "bounded-persistent-editor";
const HANDLE_MS = 10_000;

interface PendingVodClip {
  id: string;
  startMs: number;
  endMs: number;
}

export interface PendingVodEditorHandoffRequest {
  schema: typeof REQUEST_SCHEMA;
  consumerId: string;
  continuationPolicy: typeof CONTINUATION_POLICY;
  sourceUrl: string;
  handleMs: typeof HANDLE_MS;
  clips: PendingVodClip[];
}

export interface PendingVodEditorHandoff {
  schema: typeof PENDING_VOD_EDITOR_HANDOFF_SCHEMA;
  ownerId: string;
  projectId: string;
  sourceSessionId: string;
  sourceUrl: string;
  captureSeed: CaptureState;
  attestation: UsagePolicyAttestation;
  request: PendingVodEditorHandoffRequest;
  requestFingerprint: string;
  jobId?: string;
  lifecycle: "pending" | "active" | "terminal";
  terminalCode?: string;
  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs: number;
}

interface StorageLike extends Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  readonly length?: number;
  key?(index: number): string | null;
}

interface LockLike {
  readonly name: string;
}

interface LockManagerLike {
  request(
    name: string,
    options: {
      mode: "exclusive";
      signal: AbortSignal;
    },
    callback: (lock: LockLike | null) => Promise<void> | void
  ): Promise<unknown>;
}

interface BroadcastMessageEventLike {
  readonly data: unknown;
}

interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  addEventListener(
    type: "message",
    listener: (event: BroadcastMessageEventLike) => void
  ): void;
  close(): void;
}

export interface PendingVodEditorHandoffOwnerClaim {
  readonly ownerId: string;
  release(): void;
}

interface PendingVodEditorHandoffOwnerClaimOptions {
  storage?: StorageLike;
  lockManager?: LockManagerLike | null;
  broadcastChannelFactory?: ((name: string) => BroadcastChannelLike) | null;
  randomUUID?: () => string;
  claimWaitMs?: number;
}

function normalizedOwnerId(value: unknown): string {
  const ownerId = typeof value === "string" ? value.trim() : "";
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(ownerId)) {
    throw new TypeError("이어갈 편집 탭의 식별자가 올바르지 않습니다.");
  }
  return ownerId;
}

function handoffStorageKey(ownerId: unknown): string {
  return `${PENDING_VOD_EDITOR_HANDOFF_STORAGE_PREFIX}${normalizedOwnerId(ownerId)}`;
}

export function pendingVodEditorHandoffOwnerId(
  storage: StorageLike = sessionStorage,
  randomUUID: () => string = () => crypto.randomUUID()
): string {
  try {
    const existing = storage.getItem(
      PENDING_VOD_EDITOR_HANDOFF_OWNER_STORAGE_KEY
    );
    if (existing) {
      return normalizedOwnerId(existing);
    }
    const created = normalizedOwnerId(randomUUID());
    storage.setItem(PENDING_VOD_EDITOR_HANDOFF_OWNER_STORAGE_KEY, created);
    return created;
  } catch {
    // A denied sessionStorage still gets an in-memory tab identity. Persistence
    // is unavailable in that browser mode, so this value cannot cross reloads.
    return normalizedOwnerId(randomUUID());
  }
}

function writePendingVodEditorHandoffOwnerId(
  ownerId: string,
  storage: StorageLike
): void {
  try {
    storage.setItem(PENDING_VOD_EDITOR_HANDOFF_OWNER_STORAGE_KEY, ownerId);
  } catch {
    // An in-memory claim is still unique for this document when storage is
    // denied. It intentionally cannot promise same-tab reload recovery.
  }
}

function finiteClaimWaitMs(value: unknown): number {
  const waitMs = Number(value);
  return Number.isFinite(waitMs) && waitMs >= 0 && waitMs <= 1_000
    ? Math.floor(waitMs)
    : PENDING_VOD_EDITOR_OWNER_CLAIM_WAIT_MS;
}

async function claimOwnerWithWebLock({
  ownerId,
  lockManager,
  waitMs
}: {
  ownerId: string;
  lockManager: LockManagerLike;
  waitMs: number;
}): Promise<PendingVodEditorHandoffOwnerClaim | null> {
  return new Promise((resolve) => {
    let settled = false;
    let releaseLock: (() => void) | null = null;
    const abortController = new AbortController();
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      abortController.abort();
      resolve(null);
    }, waitMs);
    const finish = (
      claim: PendingVodEditorHandoffOwnerClaim | null
    ): void => {
      if (settled) {
        claim?.release();
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(claim);
    };
    void lockManager.request(
      `${PENDING_VOD_EDITOR_HANDOFF_OWNER_LOCK_PREFIX}${ownerId}`,
      {
        mode: "exclusive",
        signal: abortController.signal
      },
      async (lock) => {
        if (!lock) {
          finish(null);
          return;
        }
        await new Promise<void>((release) => {
          let released = false;
          releaseLock = () => {
            if (released) return;
            released = true;
            release();
          };
          finish({
            ownerId,
            release: () => releaseLock?.()
          });
          if (settled && abortController.signal.aborted) {
            releaseLock();
          }
        });
      }
    ).catch(() => {
      finish(null);
    });
  });
}

const OWNER_CLAIM_MESSAGE_SCHEMA =
  "kirinuki-pending-vod-editor-owner-claim/v1";

function ownerClaimMessage(value: unknown): {
  kind: "probe" | "occupied";
  ownerId: string;
  claimantId: string;
  targetId?: string;
} | null {
  if (!isRecord(value) || value.schema !== OWNER_CLAIM_MESSAGE_SCHEMA) {
    return null;
  }
  try {
    const kind = value.kind;
    const ownerId = normalizedOwnerId(value.ownerId);
    const claimantId = normalizedOwnerId(value.claimantId);
    if (kind === "probe" && value.targetId === undefined) {
      return { kind, ownerId, claimantId };
    }
    if (kind === "occupied") {
      return {
        kind,
        ownerId,
        claimantId,
        targetId: normalizedOwnerId(value.targetId)
      };
    }
  } catch {
    return null;
  }
  return null;
}

async function claimOwnerWithBroadcastChannel({
  ownerId,
  claimantId,
  channelFactory,
  waitMs
}: {
  ownerId: string;
  claimantId: string;
  channelFactory: (name: string) => BroadcastChannelLike;
  waitMs: number;
}): Promise<PendingVodEditorHandoffOwnerClaim | null> {
  let channel: BroadcastChannelLike;
  try {
    channel = channelFactory(PENDING_VOD_EDITOR_HANDOFF_OWNER_CHANNEL);
  } catch {
    return null;
  }
  let occupied = false;
  let active = false;
  const postOccupied = (targetId: string): void => {
    try {
      channel.postMessage({
        schema: OWNER_CLAIM_MESSAGE_SCHEMA,
        kind: "occupied",
        ownerId,
        claimantId,
        targetId
      });
    } catch {
      // A closing channel already releases this best-effort fallback claim.
    }
  };
  channel.addEventListener("message", (event) => {
    const message = ownerClaimMessage(event.data);
    if (!message || message.ownerId !== ownerId) return;
    if (
      message.kind === "occupied"
      && message.targetId === claimantId
      && message.claimantId !== claimantId
    ) {
      occupied = true;
      return;
    }
    if (message.kind !== "probe" || message.claimantId === claimantId) return;
    if (active || claimantId.localeCompare(message.claimantId) < 0) {
      postOccupied(message.claimantId);
      return;
    }
    occupied = true;
  });
  try {
    channel.postMessage({
      schema: OWNER_CLAIM_MESSAGE_SCHEMA,
      kind: "probe",
      ownerId,
      claimantId
    });
  } catch {
    channel.close();
    return null;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
  if (occupied) {
    channel.close();
    return null;
  }
  active = true;
  let released = false;
  return {
    ownerId,
    release: () => {
      if (released) return;
      released = true;
      active = false;
      channel.close();
    }
  };
}

/**
 * Claims the reload-stable session owner before any pending handoff is read.
 * Web Locks make a copied sessionStorage value exclusive while the original
 * document is alive. BroadcastChannel supplies the same bounded arbitration
 * on browsers without Web Locks; a random per-document owner is the final
 * fail-closed fallback.
 */
export async function claimPendingVodEditorHandoffOwner(
  options: PendingVodEditorHandoffOwnerClaimOptions = {}
): Promise<PendingVodEditorHandoffOwnerClaim> {
  const storage = options.storage ?? sessionStorage;
  const randomUUID = options.randomUUID ?? (() => crypto.randomUUID());
  const waitMs = finiteClaimWaitMs(options.claimWaitMs);
  const defaultLockManager = typeof navigator !== "undefined"
    && navigator.locks
    ? {
        request(name, lockOptions, callback) {
          return navigator.locks.request(name, lockOptions, callback);
        }
      } satisfies LockManagerLike
    : null;
  const lockManager = options.lockManager === undefined
    ? defaultLockManager
    : options.lockManager;
  const defaultChannelFactory = typeof BroadcastChannel === "function"
    ? (name: string) => new BroadcastChannel(name) as BroadcastChannelLike
    : null;
  const channelFactory = options.broadcastChannelFactory === undefined
    ? defaultChannelFactory
    : options.broadcastChannelFactory;
  let ownerId = pendingVodEditorHandoffOwnerId(storage, randomUUID);
  for (
    let attempt = 0;
    attempt < PENDING_VOD_EDITOR_OWNER_CLAIM_ATTEMPTS;
    attempt += 1
  ) {
    const claimantId = normalizedOwnerId(randomUUID());
    const claim = lockManager
      ? await claimOwnerWithWebLock({ ownerId, lockManager, waitMs })
      : channelFactory
        ? await claimOwnerWithBroadcastChannel({
          ownerId,
          claimantId,
          channelFactory,
          waitMs
        })
        : null;
    if (claim) {
      writePendingVodEditorHandoffOwnerId(ownerId, storage);
      return claim;
    }
    ownerId = normalizedOwnerId(randomUUID());
    writePendingVodEditorHandoffOwnerId(ownerId, storage);
  }
  // Neither coordination primitive was available (or the browser denied it).
  // Never reuse the copied owner in that case: a fresh random owner prevents a
  // duplicate tab from opening another project's durable pending envelope.
  ownerId = normalizedOwnerId(randomUUID());
  writePendingVodEditorHandoffOwnerId(ownerId, storage);
  return { ownerId, release: () => undefined };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[]
): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === allowed.length
    && keys.every((key, index) => key === [...allowed].sort()[index]);
}

function normalizedIdentifier(value: unknown, maximum: number): string {
  const normalized = typeof value === "string"
    ? value.normalize("NFKC").trim()
    : "";
  if (
    !normalized
    || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new TypeError("이어갈 편집 작업의 식별자가 올바르지 않습니다.");
  }
  return normalized;
}

function normalizedSourceUrl(value: unknown): string {
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(String(value || "").trim());
  } catch {
    throw new TypeError("이어갈 원본 VOD 주소가 올바르지 않습니다.");
  }
  if (
    sourceUrl.protocol !== "https:"
    || sourceUrl.username
    || sourceUrl.password
    || sourceUrl.hash
  ) {
    throw new TypeError("이어갈 원본 VOD 주소가 안전하지 않습니다.");
  }
  return sourceUrl.href;
}

function normalizedClips(value: unknown): PendingVodClip[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) {
    throw new TypeError("이어갈 편집 구간이 올바르지 않습니다.");
  }
  const ids = new Set<string>();
  return value.map((candidate) => {
    if (!isRecord(candidate) || !exactKeys(candidate, ["endMs", "id", "startMs"])) {
      throw new TypeError("이어갈 편집 구간이 올바르지 않습니다.");
    }
    const id = normalizedIdentifier(candidate.id, 256);
    const startMs = Number(candidate.startMs);
    const endMs = Number(candidate.endMs);
    if (
      ids.has(id)
      || !Number.isSafeInteger(startMs)
      || !Number.isSafeInteger(endMs)
      || startMs < 0
      || endMs <= startMs
    ) {
      throw new TypeError("이어갈 편집 구간이 올바르지 않습니다.");
    }
    ids.add(id);
    return { id, startMs, endMs };
  });
}

function normalizedRequest(value: unknown): PendingVodEditorHandoffRequest {
  if (
    !isRecord(value)
    || !exactKeys(value, [
      "clips",
      "consumerId",
      "continuationPolicy",
      "handleMs",
      "schema",
      "sourceUrl"
    ])
    || value.schema !== REQUEST_SCHEMA
    || value.continuationPolicy !== CONTINUATION_POLICY
    || value.handleMs !== HANDLE_MS
  ) {
    throw new TypeError("이어갈 영상 준비 요청 버전이 올바르지 않습니다.");
  }
  return {
    schema: REQUEST_SCHEMA,
    consumerId: normalizedIdentifier(value.consumerId, 256),
    continuationPolicy: CONTINUATION_POLICY,
    sourceUrl: normalizedSourceUrl(value.sourceUrl),
    handleMs: HANDLE_MS,
    clips: normalizedClips(value.clips)
  };
}

function canonicalRequest(request: PendingVodEditorHandoffRequest): string {
  return JSON.stringify({
    consumerId: request.consumerId,
    continuationPolicy: request.continuationPolicy,
    sourceUrl: request.sourceUrl,
    sourceClockIdentity: null,
    handleMs: request.handleMs,
    clips: [...request.clips].sort((left, right) => (
      left.startMs - right.startMs
      || left.endMs - right.endMs
      || left.id.localeCompare(right.id)
    )),
    editableRanges: null,
    resume: null,
    base: null
  });
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export async function pendingVodEditorHandoffRequestFingerprint(
  request: PendingVodEditorHandoffRequest
): Promise<string> {
  const normalized = normalizedRequest(request);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalRequest(normalized))
  );
  return base64Url(new Uint8Array(digest));
}

function cloneCaptureSeed(value: unknown): CaptureState {
  if (!isRecord(value)) {
    throw new TypeError("이어갈 컷 선택 정보를 읽지 못했습니다.");
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError("이어갈 컷 선택 정보를 읽지 못했습니다.");
  }
  if (
    !serialized
    || new TextEncoder().encode(serialized).byteLength
      > PENDING_VOD_EDITOR_HANDOFF_MAX_BYTES
  ) {
    throw new TypeError("이어갈 컷 선택 정보가 허용 크기를 넘었습니다.");
  }
  const cloned = JSON.parse(serialized) as unknown;
  const inspect = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const entry of candidate) inspect(entry);
      return;
    }
    if (!isRecord(candidate)) return;
    for (const [key, entry] of Object.entries(candidate)) {
      if (/(?:authorization|capability|clientnonce|cookie|password|secret|token)/iu.test(key)) {
        throw new TypeError("이어갈 컷 선택 정보에 저장할 수 없는 인증 정보가 있습니다.");
      }
      inspect(entry);
    }
  };
  inspect(cloned);
  return cloned as CaptureState;
}

function assertCaptureSeedMatchesRequest({
  captureSeed,
  sourceSessionId,
  request
}: {
  captureSeed: CaptureState;
  sourceSessionId: string;
  request: PendingVodEditorHandoffRequest;
}): void {
  if (!isRecord(captureSeed.source)) {
    throw new TypeError("이어갈 컷 선택 원본 정보가 없습니다.");
  }
  const seedSourceUrl = normalizedSourceUrl(
    captureSeed.source.canonicalUrl || captureSeed.source.url
  );
  const seedSourceSessionId = sourceSessionIdentity(captureSeed.source);
  if (
    seedSourceUrl !== request.sourceUrl
    || seedSourceSessionId !== sourceSessionId
  ) {
    throw new TypeError("이어갈 컷 선택 원본 identity가 영상 준비 요청과 다릅니다.");
  }
  const segments = Array.isArray(captureSeed.segments)
    ? captureSeed.segments
    : [];
  const derivedClips = normalizedClips(segments.map((segment, index) => ({
    id: captureSegmentEditorClipId(segment, index),
    startMs: Math.round(Number(segment.startSeconds) * 1_000),
    endMs: Math.round(Number(segment.endSeconds) * 1_000)
  })));
  if (
    derivedClips.length !== request.clips.length
    || derivedClips.some((clip, index) => {
      const expected = request.clips[index];
      return !expected
        || clip.id !== expected.id
        || clip.startMs !== expected.startMs
        || clip.endMs !== expected.endMs;
    })
  ) {
    throw new TypeError("이어갈 컷 선택 구간이 영상 준비 요청과 다릅니다.");
  }
}

export async function createPendingVodEditorHandoff({
  ownerId,
  projectId,
  sourceSessionId,
  sourceUrl,
  captureSeed,
  attestation,
  clips,
  nowMs = Date.now()
}: {
  ownerId: unknown;
  projectId: unknown;
  sourceSessionId: unknown;
  sourceUrl: unknown;
  captureSeed: CaptureState;
  attestation: UsagePolicyAttestation;
  clips: readonly PendingVodClip[];
  nowMs?: number;
}): Promise<PendingVodEditorHandoff> {
  const normalizedOwner = normalizedOwnerId(ownerId);
  const normalizedProjectId = normalizedIdentifier(projectId, 256);
  const normalizedSourceSessionId = normalizedIdentifier(sourceSessionId, 1_024);
  const normalizedUrl = normalizedSourceUrl(sourceUrl);
  const request = normalizedRequest({
    schema: REQUEST_SCHEMA,
    consumerId: normalizedProjectId,
    continuationPolicy: CONTINUATION_POLICY,
    sourceUrl: normalizedUrl,
    handleMs: HANDLE_MS,
    clips: [...clips]
  });
  const normalizedAttestation = normalizeUsagePolicyAttestation(attestation, {
    expectedTarget: {
      projectId: normalizedProjectId,
      sourceSessionId: normalizedSourceSessionId,
      purpose: "editor-new"
    }
  });
  const createdAtMs = Number(nowMs);
  if (!Number.isSafeInteger(createdAtMs) || createdAtMs <= 0) {
    throw new TypeError("이어갈 편집 작업의 생성 시각이 올바르지 않습니다.");
  }
  const clonedCaptureSeed = cloneCaptureSeed(captureSeed);
  assertCaptureSeedMatchesRequest({
    captureSeed: clonedCaptureSeed,
    sourceSessionId: normalizedSourceSessionId,
    request
  });
  return {
    schema: PENDING_VOD_EDITOR_HANDOFF_SCHEMA,
    ownerId: normalizedOwner,
    projectId: normalizedProjectId,
    sourceSessionId: normalizedSourceSessionId,
    sourceUrl: normalizedUrl,
    captureSeed: clonedCaptureSeed,
    attestation: normalizedAttestation,
    request,
    requestFingerprint: await pendingVodEditorHandoffRequestFingerprint(request),
    lifecycle: "pending",
    createdAtMs,
    updatedAtMs: createdAtMs,
    expiresAtMs: createdAtMs + PENDING_VOD_EDITOR_HANDOFF_TTL_MS
  };
}

async function normalizePendingVodEditorHandoff(
  value: unknown,
  nowMs: number
): Promise<PendingVodEditorHandoff | null> {
  if (!isRecord(value)) {
    return null;
  }
  const allowed = [
    "attestation",
    "captureSeed",
    "createdAtMs",
    "expiresAtMs",
    "lifecycle",
    "ownerId",
    "projectId",
    "request",
    "requestFingerprint",
    "schema",
    "sourceSessionId",
    "sourceUrl",
    "updatedAtMs",
    ...(value.jobId === undefined ? [] : ["jobId"]),
    ...(value.terminalCode === undefined ? [] : ["terminalCode"])
  ];
  if (!exactKeys(value, allowed) || value.schema !== PENDING_VOD_EDITOR_HANDOFF_SCHEMA) {
    return null;
  }
  try {
    const ownerId = normalizedOwnerId(value.ownerId);
    const projectId = normalizedIdentifier(value.projectId, 256);
    const sourceSessionId = normalizedIdentifier(value.sourceSessionId, 1_024);
    const sourceUrl = normalizedSourceUrl(value.sourceUrl);
    const request = normalizedRequest(value.request);
    const lifecycle = value.lifecycle;
    if (
      lifecycle !== "pending"
      && lifecycle !== "active"
      && lifecycle !== "terminal"
    ) {
      return null;
    }
    if (
      request.consumerId !== projectId
      || request.sourceUrl !== sourceUrl
      || typeof value.requestFingerprint !== "string"
      || !/^[A-Za-z0-9_-]{43}$/u.test(value.requestFingerprint)
    ) {
      return null;
    }
    const fingerprint = await pendingVodEditorHandoffRequestFingerprint(request);
    if (fingerprint !== value.requestFingerprint) {
      return null;
    }
    const expectedJobId = `vod_${fingerprint.slice(0, 40)}`;
    if (
      value.jobId !== undefined
      && (typeof value.jobId !== "string" || value.jobId !== expectedJobId)
    ) {
      return null;
    }
    const terminalCode = value.terminalCode;
    if (
      (lifecycle === "terminal"
        && (typeof terminalCode !== "string"
          || !/^[A-Z][A-Z0-9_]{2,79}$/u.test(terminalCode)))
      || (lifecycle !== "terminal" && terminalCode !== undefined)
      || (lifecycle === "active" && value.jobId === undefined)
    ) {
      return null;
    }
    const createdAtMs = Number(value.createdAtMs);
    const updatedAtMs = Number(value.updatedAtMs);
    const expiresAtMs = Number(value.expiresAtMs);
    if (
      !Number.isSafeInteger(createdAtMs)
      || !Number.isSafeInteger(updatedAtMs)
      || !Number.isSafeInteger(expiresAtMs)
      || createdAtMs <= 0
      || updatedAtMs < createdAtMs
      || expiresAtMs !== createdAtMs + PENDING_VOD_EDITOR_HANDOFF_TTL_MS
      || nowMs < createdAtMs - 5 * 60 * 1_000
      || nowMs >= expiresAtMs
    ) {
      return null;
    }
    const attestation = normalizeUsagePolicyAttestation(value.attestation, {
      expectedTarget: {
        projectId,
        sourceSessionId,
        purpose: "editor-new"
      }
    });
    const captureSeed = cloneCaptureSeed(value.captureSeed);
    assertCaptureSeedMatchesRequest({
      captureSeed,
      sourceSessionId,
      request
    });
    return {
      schema: PENDING_VOD_EDITOR_HANDOFF_SCHEMA,
      ownerId,
      projectId,
      sourceSessionId,
      sourceUrl,
      captureSeed,
      attestation,
      request,
      requestFingerprint: fingerprint,
      ...(value.jobId === undefined ? {} : { jobId: expectedJobId }),
      lifecycle,
      ...(typeof terminalCode === "string" ? { terminalCode } : {}),
      createdAtMs,
      updatedAtMs,
      expiresAtMs
    };
  } catch {
    return null;
  }
}

/**
 * Removes only Kirinuki-owned, invalid or expired envelopes. A valid record
 * owned by another live tab is never touched. Enumeration is capped so a
 * hostile or damaged storage area cannot turn startup into unbounded work.
 */
export async function prunePendingVodEditorHandoffs(
  storage: StorageLike = localStorage,
  nowMs = Date.now(),
  maximumCandidates = 128
): Promise<number> {
  if (
    typeof storage.key !== "function"
    || !Number.isSafeInteger(storage.length)
    || Number(storage.length) < 0
    || !Number.isSafeInteger(maximumCandidates)
    || maximumCandidates < 1
    || maximumCandidates > 512
  ) {
    return 0;
  }
  const keys: string[] = [];
  try {
    for (let index = 0; index < Number(storage.length); index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(PENDING_VOD_EDITOR_HANDOFF_STORAGE_PREFIX)) {
        keys.push(key);
        if (keys.length >= maximumCandidates) break;
      }
    }
  } catch {
    return 0;
  }
  let removed = 0;
  for (const key of keys) {
    let serialized: string | null;
    try {
      serialized = storage.getItem(key);
    } catch {
      break;
    }
    if (serialized === null) continue;
    let normalized: PendingVodEditorHandoff | null = null;
    if (
      new TextEncoder().encode(serialized).byteLength
        <= PENDING_VOD_EDITOR_HANDOFF_MAX_BYTES
    ) {
      try {
        normalized = await normalizePendingVodEditorHandoff(
          JSON.parse(serialized) as unknown,
          nowMs
        );
      } catch {
        normalized = null;
      }
    }
    const expectedKey = normalized
      ? handoffStorageKey(normalized.ownerId)
      : null;
    if (normalized && expectedKey === key) continue;
    try {
      storage.removeItem(key);
      removed += 1;
    } catch {
      break;
    }
  }
  return removed;
}

export function savePendingVodEditorHandoff(
  pending: PendingVodEditorHandoff,
  storage: StorageLike = localStorage
): void {
  const serialized = JSON.stringify(pending);
  if (
    new TextEncoder().encode(serialized).byteLength
      > PENDING_VOD_EDITOR_HANDOFF_MAX_BYTES
  ) {
    throw new TypeError("이어갈 컷 선택 정보가 허용 크기를 넘었습니다.");
  }
  storage.setItem(handoffStorageKey(pending.ownerId), serialized);
}

export async function loadPendingVodEditorHandoff(
  ownerId: unknown,
  storage: StorageLike = localStorage,
  nowMs = Date.now()
): Promise<PendingVodEditorHandoff | null> {
  let key: string;
  try {
    key = handoffStorageKey(ownerId);
  } catch {
    return null;
  }
  let serialized: string | null;
  try {
    serialized = storage.getItem(key);
  } catch {
    return null;
  }
  if (serialized === null) {
    return null;
  }
  if (
    new TextEncoder().encode(serialized).byteLength
      > PENDING_VOD_EDITOR_HANDOFF_MAX_BYTES
  ) {
    try {
      storage.removeItem(key);
    } catch {
      // An unavailable storage area already prevents this record from loading.
    }
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // An unavailable storage area already prevents this record from loading.
    }
    return null;
  }
  const normalized = await normalizePendingVodEditorHandoff(value, nowMs);
  if (!normalized || normalized.ownerId !== ownerId) {
    try {
      storage.removeItem(key);
    } catch {
      // The malformed record remains inaccessible and cannot be resumed.
    }
  }
  return normalized?.ownerId === ownerId ? normalized : null;
}

export function pendingVodEditorHandoffWithJob(
  pending: PendingVodEditorHandoff,
  jobId: unknown,
  nowMs = Date.now()
): PendingVodEditorHandoff {
  const expectedJobId = `vod_${pending.requestFingerprint.slice(0, 40)}`;
  if (jobId !== expectedJobId) {
    throw new TypeError("이어갈 영상 준비 작업 identity가 요청과 다릅니다.");
  }
  const updatedAtMs = Number(nowMs);
  if (
    !Number.isSafeInteger(updatedAtMs)
    || updatedAtMs < pending.createdAtMs
    || updatedAtMs >= pending.expiresAtMs
  ) {
    throw new TypeError("이어갈 영상 준비 작업 시각이 올바르지 않습니다.");
  }
  return {
    ...pending,
    jobId: expectedJobId,
    lifecycle: "active",
    updatedAtMs
  };
}

export function pendingVodEditorHandoffWithTerminal(
  pending: PendingVodEditorHandoff,
  terminalCode: unknown,
  nowMs = Date.now()
): PendingVodEditorHandoff {
  const code = typeof terminalCode === "string"
    ? terminalCode.trim().toUpperCase()
    : "";
  if (!/^[A-Z][A-Z0-9_]{2,79}$/u.test(code)) {
    throw new TypeError("이어갈 영상 준비 작업의 종료 코드가 올바르지 않습니다.");
  }
  const updatedAtMs = Number(nowMs);
  if (
    !Number.isSafeInteger(updatedAtMs)
    || updatedAtMs < pending.createdAtMs
    || updatedAtMs >= pending.expiresAtMs
  ) {
    throw new TypeError("이어갈 영상 준비 작업 시각이 올바르지 않습니다.");
  }
  return {
    ...pending,
    lifecycle: "terminal",
    terminalCode: code,
    updatedAtMs
  };
}

export function retryPendingVodEditorHandoff(
  pending: PendingVodEditorHandoff,
  nowMs = Date.now()
): PendingVodEditorHandoff {
  const updatedAtMs = Number(nowMs);
  if (
    !Number.isSafeInteger(updatedAtMs)
    || updatedAtMs < pending.createdAtMs
    || updatedAtMs >= pending.expiresAtMs
  ) {
    throw new TypeError("이어갈 영상 준비 작업 시각이 올바르지 않습니다.");
  }
  const retried = { ...pending, lifecycle: "pending" as const, updatedAtMs };
  delete retried.jobId;
  delete retried.terminalCode;
  return retried;
}

export function clearPendingVodEditorHandoff(
  ownerId: unknown,
  expectedFingerprint?: string,
  storage: StorageLike = localStorage
): boolean {
  let key: string;
  try {
    key = handoffStorageKey(ownerId);
  } catch {
    return false;
  }
  let serialized: string | null;
  try {
    serialized = storage.getItem(key);
  } catch {
    return false;
  }
  if (serialized === null) {
    return false;
  }
  if (expectedFingerprint) {
    try {
      const value: unknown = JSON.parse(serialized);
      if (
        !isRecord(value)
        || value.requestFingerprint !== expectedFingerprint
      ) {
        return false;
      }
    } catch {
      return false;
    }
  }
  try {
    storage.removeItem(key);
  } catch {
    return false;
  }
  return true;
}
