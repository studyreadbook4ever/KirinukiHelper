import {
  normalizeUsagePolicyAttestation
} from "../lib/usage-policy.js";
import type {
  UsagePolicyAttestation,
  UsagePolicyBasis,
  UsagePolicyPurpose
} from "../lib/usage-policy.js";
import {
  KIRINUKI_LOCAL_STUDIO_ORIGIN
} from "../lib/local-runtime-origin.js";

/** @deprecated Use the document-bound origin from local-runtime-origin. */
export const WEB_STUDIO_ORIGIN = KIRINUKI_LOCAL_STUDIO_ORIGIN;
export const WEB_STUDIO_SESSION_SCHEMA =
  "kirinuki-local-web-usage-session/v3";
export const WEB_STUDIO_SESSION_IDLE_TTL_MS = 24 * 60 * 60 * 1_000;
const WEB_STUDIO_SESSION_CLOCK_SKEW_MS = 5 * 60 * 1_000;
export const WEB_STUDIO_SESSION_STORAGE_KEY =
  "kirinuki:local-web:active-usage-session";
export const WEB_STUDIO_TRANSITION_GENERATION_KEY =
  "kirinuki:local-web:transition-generation";
export const WEB_STUDIO_LATEST_PROJECT_KEY =
  "kirinuki:local-web:latest-project";
const WEB_STORAGE_PREFIX = "kirinuki:local-web:storage:";
const WEB_EDITOR_CHANNEL_NAME = "kirinuki:local-web:editor-instances-v1";
const WEB_PROJECT_WRITER_LOCK_PREFIX = "kirinuki:local-web:project-writer:";
const WEB_PROJECT_COLLECTION_LOCK =
  "kirinuki:local-web:project-collection";
const WEB_EDITOR_SEED_PREFIX = "chzzkKirinukiEditorSeed:";

export interface ActiveStudioUsagePolicySession {
  projectId: string;
  sourceSessionId: string;
  sessionLeaseId: string;
  transitionGeneration: number;
  purpose: UsagePolicyPurpose;
  basis: UsagePolicyBasis;
  confirmedAt: string;
}

export interface StudioRuntimeResponse {
  ok?: boolean;
  connected?: boolean;
  projectId?: string;
  error?: string;
  usagePolicy?: unknown;
}

interface StoredWebUsageSession {
  schema: typeof WEB_STUDIO_SESSION_SCHEMA;
  gateToken: string;
  sessionLeaseId: string;
  transitionGeneration: number;
  createdAtMs: number;
  lastSeenAtMs: number;
  admitted: boolean;
  attestation: UsagePolicyAttestation;
}

export interface StudioStorageArea {
  get(keys?: string | readonly string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | readonly string[]): Promise<void>;
}

export type ExclusiveStudioProjectAccessResult<T> =
  | { acquired: false }
  | { acquired: true; value: T };

export function studioRuntimeKind(): "web" {
  return "web";
}

/**
 * Creates an identity for one explicitly new editing project.
 *
 * A source/session identity describes the VOD, not the user's editing
 * document. Deriving project IDs from that source made every later visit to
 * the same VOD reopen and mutate the first project. Keep the two identities
 * independent so a new-project action can never select an IndexedDB record by
 * accident.
 */
export function createFreshEditorProjectId(): string {
  return `project-${crypto.randomUUID()}`;
}

function webStorageKey(key: string): string {
  return `${WEB_STORAGE_PREFIX}${key}`;
}

function parseStoredJson(value: string | null): unknown {
  if (value === null) {
    return undefined;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

const webStorageArea: StudioStorageArea = {
  async get(keys = null) {
    const requested = keys === null
      ? [...new Set([
          ...Object.keys(localStorage),
          ...Object.keys(sessionStorage)
        ])]
        .filter((key) => key.startsWith(WEB_STORAGE_PREFIX))
        .map((key) => key.slice(WEB_STORAGE_PREFIX.length))
      : typeof keys === "string"
        ? [keys]
        : [...keys];
    return Object.fromEntries(requested.flatMap((key) => {
      const storageKey = webStorageKey(key);
      const sessionValue = parseStoredJson(sessionStorage.getItem(storageKey));
      const value = sessionValue === undefined
        ? parseStoredJson(localStorage.getItem(storageKey))
        : sessionValue;
      return value === undefined ? [] : [[key, value]];
    }));
  },
  async set(items) {
    for (const [key, value] of Object.entries(items)) {
      localStorage.setItem(webStorageKey(key), JSON.stringify(value));
    }
  },
  async remove(keys) {
    for (const key of typeof keys === "string" ? [keys] : keys) {
      const storageKey = webStorageKey(key);
      localStorage.removeItem(storageKey);
      sessionStorage.removeItem(storageKey);
    }
  }
};

export function studioStorageArea(): StudioStorageArea {
  return webStorageArea;
}

function storedWebUsageSession(): StoredWebUsageSession | null {
  const serialized = sessionStorage.getItem(WEB_STUDIO_SESSION_STORAGE_KEY);
  if (serialized === null) {
    return null;
  }
  const value = parseStoredJson(serialized);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    clearCurrentTabWebEditorSession();
    return null;
  }
  const candidate = value as Partial<StoredWebUsageSession>;
  if (
    candidate.schema !== WEB_STUDIO_SESSION_SCHEMA
    || typeof candidate.gateToken !== "string"
    || !/^[A-Za-z0-9_-]{32,256}$/u.test(candidate.gateToken)
    || typeof candidate.sessionLeaseId !== "string"
    || !/^[a-f0-9]{64}$/u.test(candidate.sessionLeaseId)
    || !Number.isSafeInteger(candidate.transitionGeneration)
    || Number(candidate.transitionGeneration) <= 0
    || !Number.isSafeInteger(candidate.createdAtMs)
    || Number(candidate.createdAtMs) <= 0
    || !Number.isSafeInteger(candidate.lastSeenAtMs)
    || Number(candidate.lastSeenAtMs) < Number(candidate.createdAtMs)
    || typeof candidate.admitted !== "boolean"
  ) {
    clearCurrentTabWebEditorSession();
    return null;
  }
  const now = Date.now();
  if (
    Number(candidate.createdAtMs) > now + WEB_STUDIO_SESSION_CLOCK_SKEW_MS
    || Number(candidate.lastSeenAtMs) > now + WEB_STUDIO_SESSION_CLOCK_SKEW_MS
    || now - Number(candidate.lastSeenAtMs) > WEB_STUDIO_SESSION_IDLE_TTL_MS
  ) {
    clearCurrentTabWebEditorSession();
    return null;
  }
  try {
    const attestation = normalizeUsagePolicyAttestation(candidate.attestation);
    const session: StoredWebUsageSession = {
      schema: WEB_STUDIO_SESSION_SCHEMA,
      gateToken: candidate.gateToken,
      sessionLeaseId: candidate.sessionLeaseId,
      transitionGeneration: Number(candidate.transitionGeneration),
      createdAtMs: Number(candidate.createdAtMs),
      lastSeenAtMs: Number(candidate.lastSeenAtMs),
      admitted: candidate.admitted,
      attestation
    };
    return session;
  } catch {
    clearCurrentTabWebEditorSession();
    return null;
  }
}

function nextWebEditorTransitionGeneration(): number {
  const previous = Number.parseInt(
    sessionStorage.getItem(WEB_STUDIO_TRANSITION_GENERATION_KEY) || "0",
    10
  );
  const generation = Number.isSafeInteger(previous) && previous >= 0
    ? previous + 1
    : 1;
  if (!Number.isSafeInteger(generation) || generation <= 0) {
    throw new Error(
      "이 탭의 편집 전환 세대를 안전하게 만들지 못했습니다. 탭을 닫고 다시 시작해 주세요."
    );
  }
  sessionStorage.setItem(
    WEB_STUDIO_TRANSITION_GENERATION_KEY,
    String(generation)
  );
  return generation;
}

function webEditorSessionLeaseId(): string {
  return crypto.randomUUID().replaceAll("-", "")
    + crypto.randomUUID().replaceAll("-", "");
}

function saveWebUsageSession(session: StoredWebUsageSession): void {
  sessionStorage.setItem(
    WEB_STUDIO_SESSION_STORAGE_KEY,
    JSON.stringify(session)
  );
}

function refreshWebUsageSession(session: StoredWebUsageSession): void {
  session.lastSeenAtMs = Date.now();
  saveWebUsageSession(session);
}

async function runWithSharedStudioProjectCollectionAccess<T>(
  operation: () => T | Promise<T>
): Promise<T> {
  if (!navigator.locks?.request) {
    return operation();
  }
  return navigator.locks.request(
    WEB_PROJECT_COLLECTION_LOCK,
    { mode: "shared" },
    async () => operation()
  );
}

function clearCurrentTabEditorSeeds(): void {
  const storageKeys = new Set([
    ...Object.keys(sessionStorage),
    ...Object.keys(localStorage)
  ]);
  for (const storageKey of storageKeys) {
    if (storageKey.startsWith(webStorageKey(WEB_EDITOR_SEED_PREFIX))) {
      sessionStorage.removeItem(storageKey);
      // v1/v2 builds briefly wrote this navigation envelope persistently.
      // It was never a user save, so remove the legacy copy as well.
      localStorage.removeItem(storageKey);
    }
  }
}

/**
 * Clears only the ephemeral owner of this browser tab. Durable projects and
 * explicit local drafts live in IndexedDB and are intentionally untouched.
 * The start page calls this before reconciling abandoned checkpoints, so a
 * restored/crashed navigation cannot silently reuse an admitted editor lease.
 */
export function clearCurrentTabWebEditorSession(): void {
  sessionStorage.removeItem(WEB_STUDIO_SESSION_STORAGE_KEY);
  clearCurrentTabEditorSeeds();
}

export async function beginWebEditorSession({
  attestation,
  captureSeed
}: {
  attestation: UsagePolicyAttestation;
  captureSeed?: unknown;
}): Promise<{ editorUrl: string; gateToken: string }> {
  const normalized = normalizeUsagePolicyAttestation(attestation, {
    expectedTarget: attestation.target
  });
  const gateToken = crypto.randomUUID().replaceAll("-", "")
    + crypto.randomUUID().replaceAll("-", "");
  await runWithSharedStudioProjectCollectionAccess(async () => {
    const transitionGeneration = nextWebEditorTransitionGeneration();
    const sessionLeaseId = webEditorSessionLeaseId();
    const now = Date.now();
    clearCurrentTabEditorSeeds();
    saveWebUsageSession({
      schema: WEB_STUDIO_SESSION_SCHEMA,
      gateToken,
      sessionLeaseId,
      transitionGeneration,
      createdAtMs: now,
      lastSeenAtMs: now,
      admitted: false,
      attestation: normalized
    });
    if (captureSeed !== undefined) {
      const key = `${WEB_EDITOR_SEED_PREFIX}${normalized.target.projectId}`;
      const storageKey = webStorageKey(key);
      // Capture seeds only bridge a same-tab navigation into the editor. They
      // are not projects and must disappear automatically when that tab dies.
      // Remove a legacy persistent copy while writing the tab-scoped value.
      localStorage.removeItem(storageKey);
      sessionStorage.setItem(storageKey, JSON.stringify({
        captureState: captureSeed,
        createdAt: normalized.confirmedAt,
        projectId: normalized.target.projectId,
        sourceSessionId: normalized.target.sourceSessionId,
        sessionLeaseId,
        transitionGeneration
      }));
    }
  });
  const editorUrl = new URL("/editor.html", location.origin);
  editorUrl.searchParams.set("project", normalized.target.projectId);
  editorUrl.searchParams.set("usageGate", gateToken);
  if (normalized.target.purpose !== "editor-new") {
    editorUrl.searchParams.set("session", "resume");
    if (normalized.target.purpose === "editor-recovery") {
      editorUrl.searchParams.set("recovery", "drafts");
    }
  }
  return { editorUrl: editorUrl.href, gateToken };
}

function activeSessionSummary(
  session: StoredWebUsageSession
): ActiveStudioUsagePolicySession {
  return {
    projectId: session.attestation.target.projectId,
    sourceSessionId: session.attestation.target.sourceSessionId,
    sessionLeaseId: session.sessionLeaseId,
    transitionGeneration: session.transitionGeneration,
    purpose: session.attestation.target.purpose,
    basis: session.attestation.basis,
    confirmedAt: session.attestation.confirmedAt
  };
}

export async function verifyStudioUsagePolicyGate({
  projectId,
  gateToken
}: {
  projectId: string;
  gateToken: string;
}): Promise<StudioRuntimeResponse> {
  const session = storedWebUsageSession();
  if (!session || session.attestation.target.projectId !== projectId) {
    return {
      ok: false,
      error: "이번 편집의 권리·책임 확인을 찾지 못했습니다. 시작 화면에서 양식을 다시 확인해 주세요."
    };
  }
  if (gateToken) {
    if (session.admitted || gateToken !== session.gateToken) {
      return {
        ok: false,
        error: "이미 사용했거나 현재 편집 세션과 맞지 않는 열기 토큰입니다. 시작 화면에서 다시 열어 주세요."
      };
    }
    session.admitted = true;
    saveWebUsageSession(session);
  } else if (!session.admitted) {
    return {
      ok: false,
      error: "시작 화면을 거치지 않은 편집기 주소입니다. 권리·책임 양식을 확인한 뒤 열어 주세요."
    };
  }
  refreshWebUsageSession(session);
  return { ok: true, usagePolicy: activeSessionSummary(session) };
}

export async function completeStudioEditorSession({
  projectId,
  sourceSessionId,
  sessionLeaseId,
  transitionGeneration
}: {
  projectId: string;
  sourceSessionId: string;
  sessionLeaseId?: string;
  transitionGeneration?: number;
}): Promise<StudioRuntimeResponse> {
  const session = storedWebUsageSession();
  if (
    !session
    || session.attestation.target.projectId !== projectId
    || session.attestation.target.sourceSessionId !== sourceSessionId
    || session.sessionLeaseId !== sessionLeaseId
    || session.transitionGeneration !== transitionGeneration
  ) {
    return {
      ok: false,
      error: "끝내려는 편집 작업이 현재 프로젝트와 다릅니다. 시작 화면에서 다시 열어 주세요."
    };
  }
  sessionStorage.removeItem(WEB_STUDIO_SESSION_STORAGE_KEY);
  if (localStorage.getItem(WEB_STUDIO_LATEST_PROJECT_KEY) === projectId) {
    localStorage.removeItem(WEB_STUDIO_LATEST_PROJECT_KEY);
  }
  return { ok: true, projectId };
}

/**
 * A localhost editor is reached through same-tab navigation from the studio
 * start page. Browsers intentionally refuse window.close() for a tab that was
 * not opened by script, so completing a session returns to that start page in
 * the same tab instead of pretending that the tab can be closed.
 */
export function leaveCompletedStudioEditor(): void {
  location.replace(new URL("/", location.origin).href);
}

export async function studioEditorReady({
  projectId,
  sourceSessionId,
  sessionLeaseId,
  transitionGeneration,
  sourceUrl
}: {
  projectId: string;
  sourceSessionId: string;
  sessionLeaseId?: string;
  transitionGeneration?: number;
  sourceUrl?: string;
}): Promise<StudioRuntimeResponse> {
  const session = storedWebUsageSession();
  if (
    !session
    || session.attestation.target.projectId !== projectId
    || session.attestation.target.sourceSessionId !== sourceSessionId
    || session.sessionLeaseId !== sessionLeaseId
    || session.transitionGeneration !== transitionGeneration
  ) {
    return {
      ok: false,
      connected: false,
      error: "다른 편집 작업으로 전환되어 이 문서에는 원본을 연결하지 않았습니다. 시작 화면에서 현재 작업을 다시 열어 주세요."
    };
  }
  refreshWebUsageSession(session);
  return { ok: true, connected: Boolean(sourceUrl) };
}

function sourceUrlWithTime(
  sourceUrl: string,
  sourceSeconds: number | null
): string {
  const url = new URL(sourceUrl);
  if (sourceSeconds === null || !Number.isFinite(sourceSeconds)) {
    return url.href;
  }
  const seconds = Math.max(0, Math.floor(sourceSeconds));
  if (url.hostname === "youtu.be" || url.hostname.endsWith("youtube.com")) {
    url.searchParams.set("t", `${seconds}s`);
  } else if (
    url.hostname === "vod.sooplive.com"
    || url.hostname === "vod.sooplive.co.kr"
    || url.hostname === "vod.afreecatv.com"
  ) {
    url.searchParams.set("change_second", String(seconds));
  }
  return url.href;
}

export async function runStudioSourceAction({
  projectId,
  sourceSessionId,
  sessionLeaseId,
  transitionGeneration,
  sourceUrl,
  action,
  sourceSeconds
}: {
  projectId: string;
  sourceSessionId: string;
  sessionLeaseId?: string;
  transitionGeneration?: number;
  sourceUrl: string;
  action: "focus" | "seek-and-focus";
  sourceSeconds: number | null;
}): Promise<StudioRuntimeResponse> {
  const session = storedWebUsageSession();
  if (
    !session
    || session.attestation.target.projectId !== projectId
    || session.attestation.target.sourceSessionId !== sourceSessionId
    || session.sessionLeaseId !== sessionLeaseId
    || session.transitionGeneration !== transitionGeneration
  ) {
    return {
      ok: false,
      connected: false,
      error: "다른 편집 작업으로 전환되어 이 문서에서는 원본 동작을 실행하지 않았습니다. 시작 화면에서 현재 작업을 다시 열어 주세요."
    };
  }
  let target: string;
  try {
    target = sourceUrlWithTime(
      sourceUrl,
      action === "seek-and-focus" ? sourceSeconds : null
    );
  } catch {
    return { ok: false, error: "원본 영상 주소가 올바르지 않습니다." };
  }
  refreshWebUsageSession(session);
  const opened = window.open(target, "kirinuki-source");
  if (opened) {
    opened.opener = null;
  }
  return { ok: true, connected: true };
}

export function studioAssetUrl(relativePath: string): string {
  return new URL(relativePath, location.origin).href;
}

const webEditorInstanceId = crypto.randomUUID();
let webEditorProjectId = "";
let webProjectWriterLockName = "";
let releaseWebProjectWriter: (() => void) | null = null;
const webEditorChannel = typeof window === "object"
  && typeof BroadcastChannel === "function"
  ? new BroadcastChannel(WEB_EDITOR_CHANNEL_NAME)
  : null;

if (webEditorChannel) {
  webEditorChannel.addEventListener("message", (event) => {
    const value: unknown = event.data;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return;
    }
    const message = value as Record<string, unknown>;
    if (
      message.type === "ping"
      && message.projectId === webEditorProjectId
      && typeof message.requestId === "string"
    ) {
      webEditorChannel.postMessage({
        type: "pong",
        requestId: message.requestId,
        projectId: webEditorProjectId,
        instanceId: webEditorInstanceId
      });
    }
  });
}

export function bindStudioEditorProject(projectId: string): void {
  webEditorProjectId = projectId;
}

export async function acquireStudioProjectWriter(
  projectId: string
): Promise<boolean> {
  const normalizedProjectId = String(projectId || "").trim();
  if (!normalizedProjectId) {
    throw new TypeError("프로젝트 writer lock ID가 없습니다.");
  }
  const lockName = `${WEB_PROJECT_WRITER_LOCK_PREFIX}${normalizedProjectId}`;
  if (releaseWebProjectWriter && webProjectWriterLockName === lockName) {
    return true;
  }
  if (releaseWebProjectWriter) {
    // One editor document must never accumulate writer leases for unrelated
    // projects. The current web editor binds exactly one project per page.
    return false;
  }
  if (!navigator.locks?.request) {
    // Older browsers do not expose Web Locks. Fail closed when there is no
    // cross-tab channel; otherwise perform admission only after every
    // concurrently opening tab has had time to publish the same project ID.
    if (!webEditorChannel) {
      return false;
    }
    const previousProjectId = webEditorProjectId;
    webEditorProjectId = normalizedProjectId;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
    const editorCount = await countStudioProjectEditors(normalizedProjectId);
    if (editorCount > 1) {
      webEditorProjectId = previousProjectId;
      return false;
    }
    return true;
  }
  let settleAcquisition: (acquired: boolean) => void = () => undefined;
  const acquisition = new Promise<boolean>((resolve) => {
    settleAcquisition = resolve;
  });
  let releaseHold: () => void = () => undefined;
  const hold = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });
  // Every live editor holds the collection lock in shared mode before taking
  // its project-specific writer lease. Whole-browser deletion takes the same
  // lock exclusively, closing the otherwise unavoidable race where a fresh
  // UUID project appears after the manager inventories known project IDs but
  // before it clears all IndexedDB stores.
  void navigator.locks.request(
    WEB_PROJECT_COLLECTION_LOCK,
    { mode: "shared", ifAvailable: true },
    async (collectionLock) => {
      if (!collectionLock) {
        settleAcquisition(false);
        return;
      }
      await navigator.locks.request(
        lockName,
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (!lock) {
            settleAcquisition(false);
            return;
          }
          webProjectWriterLockName = lockName;
          releaseWebProjectWriter = releaseHold;
          settleAcquisition(true);
          await hold;
          if (webProjectWriterLockName === lockName) {
            webProjectWriterLockName = "";
            releaseWebProjectWriter = null;
          }
        }
      );
    }
  ).catch(() => settleAcquisition(false));
  return acquisition;
}

/**
 * Runs one bounded maintenance mutation only while no editor owns the project.
 * The lease is released as soon as the callback settles; unlike the editor
 * writer lease it is never retained for the page lifetime.
 */
export async function runWithExclusiveStudioProjectAccess<T>(
  projectId: string,
  operation: () => T | Promise<T>
): Promise<ExclusiveStudioProjectAccessResult<T>> {
  const normalizedProjectId = String(projectId || "").trim();
  if (!normalizedProjectId) {
    throw new TypeError("프로젝트 배타 작업 ID가 없습니다.");
  }
  if (!navigator.locks?.request) {
    // BroadcastChannel can discover an existing editor but cannot make two
    // maintenance tabs mutually exclusive. Deletion must therefore fail
    // closed rather than use a racy best-effort admission check.
    return { acquired: false };
  }
  const lockName = `${WEB_PROJECT_WRITER_LOCK_PREFIX}${normalizedProjectId}`;
  return navigator.locks.request(
    WEB_PROJECT_COLLECTION_LOCK,
    { mode: "shared", ifAvailable: true },
    async (collectionLock): Promise<ExclusiveStudioProjectAccessResult<T>> => {
      if (!collectionLock) {
        return { acquired: false };
      }
      return navigator.locks.request(
        lockName,
        { mode: "exclusive", ifAvailable: true },
        async (lock): Promise<ExclusiveStudioProjectAccessResult<T>> => {
          if (!lock) {
            return { acquired: false };
          }
          return {
            acquired: true,
            value: await operation()
          };
        }
      );
    }
  );
}

/**
 * Runs one operation that can replace every browser-local project only while
 * no editor or project-scoped maintenance operation is active. Unknown fresh
 * project IDs are covered because admission is based on the collection lease,
 * not on a stale project inventory.
 */
export async function runWithExclusiveStudioProjectCollectionAccess<T>(
  operation: () => T | Promise<T>
): Promise<ExclusiveStudioProjectAccessResult<T>> {
  if (!navigator.locks?.request) {
    return { acquired: false };
  }
  return navigator.locks.request(
    WEB_PROJECT_COLLECTION_LOCK,
    { mode: "exclusive", ifAvailable: true },
    async (lock): Promise<ExclusiveStudioProjectAccessResult<T>> => {
      if (!lock) {
        return { acquired: false };
      }
      return {
        acquired: true,
        value: await operation()
      };
    }
  );
}

export async function countStudioProjectEditors(projectId: string): Promise<number> {
  if (!webEditorChannel) {
    return 1;
  }
  const requestId = crypto.randomUUID();
  const instances = new Set<string>([webEditorInstanceId]);
  const listener = (event: MessageEvent<unknown>) => {
    const value = event.data;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return;
    }
    const message = value as Record<string, unknown>;
    if (
      message.type === "pong"
      && message.requestId === requestId
      && message.projectId === projectId
      && typeof message.instanceId === "string"
    ) {
      instances.add(message.instanceId);
    }
  };
  webEditorChannel.addEventListener("message", listener);
  webEditorChannel.postMessage({ type: "ping", requestId, projectId });
  await new Promise<void>((resolve) => window.setTimeout(resolve, 80));
  webEditorChannel.removeEventListener("message", listener);
  return instances.size;
}

export function latestWebProjectId(): string {
  return String(localStorage.getItem(WEB_STUDIO_LATEST_PROJECT_KEY) || "").trim();
}
