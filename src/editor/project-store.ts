import { EDITOR_DATABASE_NAME } from "../lib/editor-core.js";

const DATABASE_NAME = EDITOR_DATABASE_NAME;
const DATABASE_VERSION = 5;
const PROJECTS = "projects";
const HANDLES = "media-handles";
const IMAGE_ASSETS = "image-assets";
const LOCAL_DRAFTS = "local-drafts";
const LOCAL_DRAFT_PROJECT_INDEX = "projectId";
const SHORT_VIDEO_CACHES = "short-video-caches";
const SHORT_VIDEO_CACHE_PROJECT_INDEX = "projectId";
const EDITING_SESSION_CHECKPOINTS = "editing-session-checkpoints";
const LOCAL_DRAFT_SCHEMA = "chzzk-kirinuki-local-draft/v1";
export const SHORT_VIDEO_CACHE_SCHEMA = "chzzk-kirinuki-short-video-cache/v1";
export const EDITING_SESSION_CHECKPOINT_SCHEMA =
  "chzzk-kirinuki-editing-session-checkpoint/v1";
const MAX_LOCAL_DRAFTS = 5;
const LOCAL_DRAFT_REASONS = new Set(["manual", "auto", "pre-restore"]);

type LocalDraftReason = "manual" | "auto" | "pre-restore";

interface ImageAssetReference {
  id?: string;
  source?: {
    kind?: string;
    value?: string;
  };
}

interface ShortFormStoredBranch {
  imageAssets?: ImageAssetReference[];
  videoAssets?: Array<{ id?: string }>;
  sourceAudioAssets?: Array<{ id?: string }>;
}

export interface StoredProject extends Record<string, unknown> {
  id: string;
  imageAssets?: ImageAssetReference[];
  shortForm?: ShortFormStoredBranch;
  shortFormWorkspaces?: {
    workspaces?: Array<{
      shortForm?: ShortFormStoredBranch;
    }>;
  };
}

export interface LocalDraftRecord extends Record<string, unknown> {
  schema: typeof LOCAL_DRAFT_SCHEMA;
  id: string;
  projectId: string;
  createdAt: string;
  createdAtMs: number;
  reason: LocalDraftReason;
  restoredFromDraftId: string | null;
  /**
   * Exact browser-local file handle present when this snapshot was written.
   * Legacy drafts omit this field and therefore recover without guessing a
   * handle. Origin migration strips it before producing portable JSON.
   */
  mediaHandleBinding?: LocalDraftMediaHandleBinding;
  project: StoredProject;
}

export type LocalDraftMediaHandleBinding =
  | { kind: "none" }
  | {
      kind: "file-system-file-handle";
      handle: FileSystemFileHandle;
    };

export interface ShortVideoCacheRecord extends Record<string, unknown> {
  schema: typeof SHORT_VIDEO_CACHE_SCHEMA;
  projectId: string;
  assetId: string;
  blob: Blob;
  sourceStartMs: number;
  sourceEndMs: number;
  /** Exact logical cache start inside keyframe-aligned media. Legacy v1 = 0. */
  mediaOffsetMs?: number;
  /** Whether this cache contains a usable audio track. Legacy v1 records omit it. */
  hasAudio?: boolean;
  sourceFingerprint: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ShortVideoCacheInput {
  schema?: typeof SHORT_VIDEO_CACHE_SCHEMA;
  projectId: string;
  assetId: string;
  blob: Blob;
  sourceStartMs: number;
  sourceEndMs: number;
  mediaOffsetMs?: number;
  hasAudio?: boolean;
  sourceFingerprint: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ProjectSessionDeletionCounts {
  deletedProjectCount: number;
  deletedLocalDraftCount: number;
  deletedImageAssetCount: number;
  deletedShortVideoCacheCount: number;
  deletedMediaHandleCount: number;
  deletedEditingSessionCheckpointCount: number;
}

export interface EditingSessionImageAssetSnapshot {
  key: IDBValidKey;
  blob: Blob;
}

export interface EditingSessionMediaHandleSnapshot {
  present: boolean;
  handle: FileSystemFileHandle | null;
}

export interface EditingSessionBaselineSnapshot {
  project: StoredProject | null;
  localDrafts: LocalDraftRecord[];
  imageAssets: EditingSessionImageAssetSnapshot[];
  shortVideoCaches: ShortVideoCacheRecord[];
  mediaHandle: EditingSessionMediaHandleSnapshot;
}

export interface EditingSessionCheckpointRecord {
  schema: typeof EDITING_SESSION_CHECKPOINT_SCHEMA;
  projectId: string;
  sessionId: string;
  createdAt: string;
  baseline: EditingSessionBaselineSnapshot;
}

interface LocalDraftOptions {
  reason?: LocalDraftReason;
  restoredFromDraftId?: string | null;
  now?: number | string | Date;
  id?: string | null;
}

interface StoredFileHandle extends FileSystemFileHandle {
  queryPermission(options?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
}

type StoreMap = Record<string, IDBObjectStore>;
type ResultCarrier<T> = { readonly result: T };
const transactionAbortReasons = new WeakMap<IDBTransaction, unknown>();

function requiredStore(stores: StoreMap, storeName: string): IDBObjectStore {
  const store = stores[storeName];
  if (!store) {
    throw new Error(`IndexedDB 스토어를 찾지 못했습니다: ${storeName}`);
  }
  return store;
}

function abortTransaction(
  transaction: IDBTransaction,
  reason: unknown
): void {
  transactionAbortReasons.set(transaction, reason);
  try {
    transaction.abort();
  } catch {
    // A request failure may already have started aborting the transaction.
  }
}

let databasePromise: Promise<IDBDatabase> | null = null;
let activeDatabase: IDBDatabase | null = null;

function clearCachedDatabase(
  database: IDBDatabase,
  attempt: Promise<IDBDatabase>
): void {
  if (activeDatabase === database) {
    activeDatabase = null;
  }
  if (databasePromise === attempt) {
    databasePromise = null;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) {
    return databasePromise;
  }

  let resolveAttempt!: (database: IDBDatabase) => void;
  let rejectAttempt!: (reason?: unknown) => void;
  let settled = false;
  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    resolveAttempt = resolve;
    rejectAttempt = reject;
  });
  databasePromise = attempt;

  const rejectOpen = (error: unknown): void => {
    if (settled) {
      return;
    }
    settled = true;
    if (databasePromise === attempt) {
      databasePromise = null;
    }
    rejectAttempt(error);
  };

  let request: IDBOpenDBRequest;
  try {
    request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  } catch (error) {
    rejectOpen(error);
    return attempt;
  }

  request.onerror = () => rejectOpen(
    request.error || new Error("편집기 저장소를 열지 못했습니다.")
  );
  request.onblocked = () => rejectOpen(new Error(
    "다른 편집기 탭이 저장소 업그레이드를 막고 있습니다. "
    + "다른 편집기 탭을 닫고 다시 시도해 주세요."
  ));
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(PROJECTS)) {
      database.createObjectStore(PROJECTS, { keyPath: "id" });
    }
    if (!database.objectStoreNames.contains(HANDLES)) {
      database.createObjectStore(HANDLES);
    }
    if (!database.objectStoreNames.contains(IMAGE_ASSETS)) {
      database.createObjectStore(IMAGE_ASSETS);
    }
    const localDraftStore = database.objectStoreNames.contains(LOCAL_DRAFTS)
      ? request.transaction!.objectStore(LOCAL_DRAFTS)
      : database.createObjectStore(LOCAL_DRAFTS, { keyPath: "id" });
    if (!localDraftStore.indexNames.contains(LOCAL_DRAFT_PROJECT_INDEX)) {
      localDraftStore.createIndex(
        LOCAL_DRAFT_PROJECT_INDEX,
        LOCAL_DRAFT_PROJECT_INDEX,
        { unique: false }
      );
    }
    const shortVideoCacheStore = database.objectStoreNames.contains(
      SHORT_VIDEO_CACHES
    )
      ? request.transaction!.objectStore(SHORT_VIDEO_CACHES)
      : database.createObjectStore(SHORT_VIDEO_CACHES, {
          keyPath: ["projectId", "assetId"]
        });
    if (!shortVideoCacheStore.indexNames.contains(
      SHORT_VIDEO_CACHE_PROJECT_INDEX
    )) {
      shortVideoCacheStore.createIndex(
        SHORT_VIDEO_CACHE_PROJECT_INDEX,
        SHORT_VIDEO_CACHE_PROJECT_INDEX,
        { unique: false }
      );
    }
    if (!database.objectStoreNames.contains(EDITING_SESSION_CHECKPOINTS)) {
      database.createObjectStore(EDITING_SESSION_CHECKPOINTS, {
        keyPath: "projectId"
      });
    }
  };
  request.onsuccess = () => {
    const database = request.result;
    if (settled) {
      database.close();
      return;
    }
    settled = true;
    activeDatabase = database;
    database.onversionchange = () => {
      database.close();
      clearCachedDatabase(database, attempt);
    };
    database.onclose = () => clearCachedDatabase(database, attempt);
    resolveAttempt(database);
  };

  return attempt;
}

function isClosedDatabaseError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "name" in error
    && error.name === "InvalidStateError"
  );
}

function discardDatabase(database: IDBDatabase): void {
  if (activeDatabase === database) {
    activeDatabase = null;
    databasePromise = null;
  }
  try {
    database?.close();
  } catch {
    // A connection that is already closing does not need further cleanup.
  }
}

function runTransaction<T>(
  database: IDBDatabase,
  storeNames: string | string[],
  mode: IDBTransactionMode,
  operation: (
    target: IDBObjectStore | StoreMap,
    transaction: IDBTransaction
  ) => ResultCarrier<T>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    let tx: IDBTransaction;
    try {
      tx = database.transaction(storeNames, mode);
    } catch (error) {
      reject(error);
      return;
    }
    const stores = Object.fromEntries(
      names.map((storeName) => [storeName, tx.objectStore(storeName)])
    ) as StoreMap;
    const operationTarget = Array.isArray(storeNames)
      ? stores
      : tx.objectStore(storeNames);
    let result: ResultCarrier<T>;
    try {
      result = operation(operationTarget, tx);
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // The transaction may already have been aborted by IndexedDB.
      }
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(result.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => {
      const reason = transactionAbortReasons.get(tx);
      transactionAbortReasons.delete(tx);
      reject(reason || tx.error || new Error("저장 작업이 중단되었습니다."));
    };
  });
}

type TransactionTarget<S extends string | string[]> =
  S extends string[] ? StoreMap : IDBObjectStore;

type SingleStoreOperation<T> = (
  target: IDBObjectStore,
  transaction: IDBTransaction
) => ResultCarrier<T>;

type MultiStoreOperation<T> = (
  target: StoreMap,
  transaction: IDBTransaction
) => ResultCarrier<T>;

async function transaction<T, S extends string | string[]>(
  storeNames: S,
  mode: IDBTransactionMode,
  operation: (
    target: TransactionTarget<S>,
    transaction: IDBTransaction
  ) => ResultCarrier<T>,
  retryClosedDatabase = true
): Promise<T> {
  const database = await openDatabase();
  try {
    return await runTransaction(
      database,
      storeNames,
      mode,
      (target, activeTransaction) => (
        Array.isArray(storeNames)
          ? (operation as MultiStoreOperation<T>)(
              target as StoreMap,
              activeTransaction
            )
          : (operation as SingleStoreOperation<T>)(
              target as IDBObjectStore,
              activeTransaction
            )
      )
    );
  } catch (error) {
    if (retryClosedDatabase && isClosedDatabaseError(error)) {
      discardDatabase(database);
      return transaction(storeNames, mode, operation, false);
    }
    throw error;
  }
}

export async function loadProject(
  projectId: IDBValidKey
): Promise<StoredProject | undefined> {
  return transaction(PROJECTS, "readonly", (store) => store.get(projectId));
}

/**
 * Returns detached snapshots of every browser-local project. IndexedDB does
 * not promise a useful ordering here; callers should sort by their own
 * presentation metadata instead of relying on object-store key order.
 */
export async function listProjects(): Promise<StoredProject[]> {
  const projects = await transaction(
    PROJECTS,
    "readonly",
    (store) => store.getAll()
  );
  return (projects || []).map((value) => {
    if (
      !value
      || typeof value !== "object"
      || Array.isArray(value)
      || typeof value.id !== "string"
      || !value.id.trim()
    ) {
      throw new TypeError("브라우저에 저장된 편집 프로젝트 형식이 올바르지 않습니다.");
    }
    return cloneStoredValue(value as StoredProject);
  });
}

export async function saveProject<T extends StoredProject>(project: T): Promise<T> {
  await transaction(PROJECTS, "readwrite", (store) => store.put(project));
  return project;
}

function cloneStoredValue<T>(value: T): T {
  return structuredClone(value);
}

function requiredCacheText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.trim() !== value) {
    throw new TypeError(`${label}이(가) 올바르지 않습니다.`);
  }
  return value;
}

function requiredCacheTime(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label}이(가) 올바르지 않습니다.`);
  }
  return value;
}

function requiredCacheCreatedAt(value: unknown): string {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value))
  ) {
    throw new TypeError("숏폼 영상 캐시 생성 시각이 올바른 ISO 문자열이 아닙니다.");
  }
  return value;
}

function parseShortVideoCacheRecord(
  value: unknown,
  expectedProjectId: string | null = null,
  expectedAssetId: string | null = null
): ShortVideoCacheRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("숏폼 영상 캐시 레코드가 올바르지 않습니다.");
  }
  const candidate = value as Partial<ShortVideoCacheRecord>;
  if (candidate.schema !== SHORT_VIDEO_CACHE_SCHEMA) {
    throw new TypeError("지원하지 않는 숏폼 영상 캐시 스키마입니다.");
  }
  const projectId = requiredCacheText(candidate.projectId, "프로젝트 ID");
  const assetId = requiredCacheText(candidate.assetId, "숏폼 영상 에셋 ID");
  if (
    (expectedProjectId !== null && projectId !== expectedProjectId)
    || (expectedAssetId !== null && assetId !== expectedAssetId)
  ) {
    throw new TypeError("숏폼 영상 캐시 키와 레코드 식별자가 일치하지 않습니다.");
  }
  if (!(candidate.blob instanceof Blob) || candidate.blob.size <= 0) {
    throw new TypeError("숏폼 영상 캐시 Blob이 비어 있거나 올바르지 않습니다.");
  }
  const sourceStartMs = requiredCacheTime(
    candidate.sourceStartMs,
    "숏폼 영상 캐시 시작 시각"
  );
  const sourceEndMs = requiredCacheTime(
    candidate.sourceEndMs,
    "숏폼 영상 캐시 종료 시각"
  );
  if (sourceEndMs <= sourceStartMs) {
    throw new TypeError("숏폼 영상 캐시 종료 시각은 시작 시각보다 커야 합니다.");
  }
  if (
    candidate.mediaOffsetMs !== undefined
    && (
      typeof candidate.mediaOffsetMs !== "number"
      || !Number.isFinite(candidate.mediaOffsetMs)
      || candidate.mediaOffsetMs < 0
    )
  ) {
    throw new TypeError("숏폼 영상 캐시 미디어 오프셋이 올바르지 않습니다.");
  }
  if (
    candidate.hasAudio !== undefined
    && typeof candidate.hasAudio !== "boolean"
  ) {
    throw new TypeError("숏폼 영상 캐시 음성 포함 정보가 올바르지 않습니다.");
  }
  requiredCacheText(candidate.sourceFingerprint, "숏폼 영상 원본 fingerprint");
  const mimeType = requiredCacheText(candidate.mimeType, "숏폼 영상 MIME 타입");
  if (!/^video\/[^\s/]+$/i.test(mimeType) || mimeType !== candidate.blob.type) {
    throw new TypeError("숏폼 영상 캐시 MIME 타입이 Blob과 일치하지 않습니다.");
  }
  if (
    typeof candidate.sizeBytes !== "number"
    || !Number.isSafeInteger(candidate.sizeBytes)
    || candidate.sizeBytes <= 0
    || candidate.sizeBytes !== candidate.blob.size
  ) {
    throw new TypeError("숏폼 영상 캐시 크기가 Blob과 일치하지 않습니다.");
  }
  requiredCacheCreatedAt(candidate.createdAt);
  return candidate as ShortVideoCacheRecord;
}

function shortVideoCacheKey(projectId: unknown, assetId: unknown): [string, string] {
  return [
    requiredCacheText(projectId, "프로젝트 ID"),
    requiredCacheText(assetId, "숏폼 영상 에셋 ID")
  ];
}

export async function saveShortVideoCache(
  input: ShortVideoCacheInput
): Promise<ShortVideoCacheRecord> {
  if (
    Object.prototype.hasOwnProperty.call(input, "schema")
    && input.schema !== SHORT_VIDEO_CACHE_SCHEMA
  ) {
    throw new TypeError("지원하지 않는 숏폼 영상 캐시 스키마입니다.");
  }
  const record: ShortVideoCacheRecord = cloneStoredValue({
    schema: SHORT_VIDEO_CACHE_SCHEMA,
    projectId: input.projectId,
    assetId: input.assetId,
    blob: input.blob,
    sourceStartMs: input.sourceStartMs,
    sourceEndMs: input.sourceEndMs,
    mediaOffsetMs: input.mediaOffsetMs ?? 0,
    hasAudio: input.hasAudio ?? false,
    sourceFingerprint: input.sourceFingerprint,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    createdAt: input.createdAt
  });
  parseShortVideoCacheRecord(record);
  await transaction(
    SHORT_VIDEO_CACHES,
    "readwrite",
    (store) => store.put(record)
  );
  return cloneStoredValue(record);
}

export async function loadShortVideoCache(
  projectId: unknown,
  assetId: unknown
): Promise<ShortVideoCacheRecord | null> {
  const [normalizedProjectId, normalizedAssetId] = shortVideoCacheKey(
    projectId,
    assetId
  );
  const value = await transaction(
    SHORT_VIDEO_CACHES,
    "readonly",
    (store) => store.get([normalizedProjectId, normalizedAssetId])
  );
  if (value === undefined) {
    return null;
  }
  return cloneStoredValue(parseShortVideoCacheRecord(
    value,
    normalizedProjectId,
    normalizedAssetId
  ));
}

export async function listShortVideoCaches(
  projectId: unknown
): Promise<ShortVideoCacheRecord[]> {
  const normalizedProjectId = requiredCacheText(projectId, "프로젝트 ID");
  const values = await transaction(
    SHORT_VIDEO_CACHES,
    "readonly",
    (store) => store.index(SHORT_VIDEO_CACHE_PROJECT_INDEX).getAll(
      normalizedProjectId
    )
  );
  return (values || []).map((value) => cloneStoredValue(
    parseShortVideoCacheRecord(value, normalizedProjectId)
  ));
}

export async function deleteShortVideoCache(
  projectId: unknown,
  assetId: unknown
): Promise<void> {
  const key = shortVideoCacheKey(projectId, assetId);
  await transaction(
    SHORT_VIDEO_CACHES,
    "readwrite",
    (store) => store.delete(key)
  );
}

function deleteProjectShortVideoCaches(
  projectId: string,
  keepAssetIds: ReadonlySet<string>
): Promise<number> {
  return transaction(
    SHORT_VIDEO_CACHES,
    "readwrite",
    (store) => {
      let count = 0;
      const keysRequest = store
        .index(SHORT_VIDEO_CACHE_PROJECT_INDEX)
        .getAllKeys(projectId);
      keysRequest.onsuccess = () => {
        for (const key of keysRequest.result || []) {
          if (
            !Array.isArray(key)
            || key.length !== 2
            || String(key[0]) !== projectId
          ) {
            throw new TypeError("숏폼 영상 캐시 인덱스 키가 올바르지 않습니다.");
          }
          const assetId = requiredCacheText(key[1], "숏폼 영상 에셋 ID");
          if (!keepAssetIds.has(assetId)) {
            store.delete(key);
            count += 1;
          }
        }
      };
      return {
        get result() {
          return count;
        }
      };
    }
  );
}

export async function deleteAllShortVideoCaches(
  projectId: unknown
): Promise<number> {
  return deleteProjectShortVideoCaches(
    requiredCacheText(projectId, "프로젝트 ID"),
    new Set<string>()
  );
}

export async function pruneShortVideoCaches(
  projectId: unknown,
  keepAssetIds: Iterable<unknown> = []
): Promise<number> {
  const normalizedProjectId = requiredCacheText(projectId, "프로젝트 ID");
  const keep = new Set<string>();
  for (const assetId of keepAssetIds) {
    keep.add(requiredCacheText(assetId, "숏폼 영상 에셋 ID"));
  }
  return deleteProjectShortVideoCaches(normalizedProjectId, keep);
}

function requiredProjectId(project: Partial<StoredProject> | null | undefined): string {
  const projectId = String(project?.id || "").trim();
  if (!projectId) {
    throw new TypeError("임시저장할 프로젝트 ID가 없습니다.");
  }
  return projectId;
}

function localDraftTimestamp(now: number | string | Date): {
  createdAt: string;
  createdAtMs: number;
} {
  const date = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  const createdAtMs = date.getTime();
  if (!Number.isFinite(createdAtMs)) {
    throw new TypeError("임시저장 시각이 올바르지 않습니다.");
  }
  return {
    createdAt: date.toISOString(),
    createdAtMs
  };
}

function localDraftId(value: unknown): string {
  const id = String(value || `local-draft-${crypto.randomUUID()}`).trim();
  if (!id) {
    throw new TypeError("임시저장 ID가 없습니다.");
  }
  return id;
}

function localDraftReason(value: unknown): LocalDraftReason {
  const reason = String(value || "manual").trim();
  if (!LOCAL_DRAFT_REASONS.has(reason)) {
    throw new TypeError(`지원하지 않는 임시저장 사유입니다: ${reason}`);
  }
  return reason as LocalDraftReason;
}

function createLocalDraftRecord(project: StoredProject, {
  reason = "manual",
  restoredFromDraftId = null,
  now = Date.now(),
  id = null
}: LocalDraftOptions = {}): LocalDraftRecord {
  const projectId = requiredProjectId(project);
  const timestamp = localDraftTimestamp(now);
  return {
    schema: LOCAL_DRAFT_SCHEMA,
    id: localDraftId(id),
    projectId,
    ...timestamp,
    reason: localDraftReason(reason),
    restoredFromDraftId: restoredFromDraftId
      ? String(restoredFromDraftId)
      : null,
    mediaHandleBinding: { kind: "none" },
    project: cloneStoredValue(project)
  };
}

function projectExpectsStoredMediaHandle(project: StoredProject): boolean {
  const mediaAsset = project.mediaAsset;
  return Boolean(
    mediaAsset
    && typeof mediaAsset === "object"
    && !Array.isArray(mediaAsset)
    && (mediaAsset as Record<string, unknown>).fileHandleStored === true
  );
}

function isLocalDraftMediaHandleBinding(
  value: unknown
): value is LocalDraftMediaHandleBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<LocalDraftMediaHandleBinding> & {
    handle?: unknown;
  };
  return candidate.kind === "none"
    || (
      candidate.kind === "file-system-file-handle"
      && Boolean(candidate.handle)
      && typeof candidate.handle === "object"
    );
}

function localDraftMediaHandleBinding(
  project: StoredProject,
  storedHandle: unknown
): LocalDraftMediaHandleBinding {
  if (
    !projectExpectsStoredMediaHandle(project)
    || !storedHandle
    || typeof storedHandle !== "object"
  ) {
    return { kind: "none" };
  }
  return {
    kind: "file-system-file-handle",
    handle: cloneStoredValue(storedHandle as FileSystemFileHandle)
  };
}

function exactLocalDraftMediaHandle(
  draft: LocalDraftRecord | null | undefined
): FileSystemFileHandle | null {
  if (
    !draft
    || !projectExpectsStoredMediaHandle(draft.project)
    || draft.mediaHandleBinding?.kind !== "file-system-file-handle"
  ) {
    return null;
  }
  return cloneStoredValue(draft.mediaHandleBinding.handle);
}

function isLocalDraftRecord(
  value: unknown,
  projectId: string | null = null
): value is LocalDraftRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<LocalDraftRecord>;
  if (
    candidate.schema !== LOCAL_DRAFT_SCHEMA
    || !String(candidate.id || "")
    || !String(candidate.projectId || "")
    || !Number.isFinite(Number(candidate.createdAtMs))
    || !candidate.project
    || String(candidate.project.id || "") !== String(candidate.projectId)
    || (
      candidate.mediaHandleBinding !== undefined
      && !isLocalDraftMediaHandleBinding(candidate.mediaHandleBinding)
    )
  ) {
    return false;
  }
  return projectId == null
    || String(candidate.projectId) === String(projectId);
}

function compareLocalDraftsNewestFirst(
  first: LocalDraftRecord,
  second: LocalDraftRecord
): number {
  return (
    Number(second.createdAtMs) - Number(first.createdAtMs)
    || String(second.id).localeCompare(String(first.id))
  );
}

function trimLocalDrafts(
  store: IDBObjectStore,
  projectId: string,
  removedIds: string[]
): void {
  const request = store.index(LOCAL_DRAFT_PROJECT_INDEX).getAll(projectId);
  request.onsuccess = () => {
    const drafts = (request.result || [])
      .filter((draft) => isLocalDraftRecord(draft, projectId))
      .sort(compareLocalDraftsNewestFirst);
    for (const draft of drafts.slice(MAX_LOCAL_DRAFTS)) {
      store.delete(draft.id);
      removedIds.push(draft.id);
    }
  };
}

export async function listLocalDrafts(
  projectId: unknown,
  { limit = MAX_LOCAL_DRAFTS }: { limit?: number } = {}
): Promise<LocalDraftRecord[]> {
  const normalizedProjectId = String(projectId || "").trim();
  if (!normalizedProjectId) {
    return [];
  }
  const requestedLimit = Number(limit);
  const normalizedLimit = Number.isFinite(requestedLimit)
    ? Math.max(0, Math.min(MAX_LOCAL_DRAFTS, Math.floor(requestedLimit)))
    : MAX_LOCAL_DRAFTS;
  if (normalizedLimit === 0) {
    return [];
  }
  const drafts = await transaction(
    LOCAL_DRAFTS,
    "readonly",
    (store) => store.index(LOCAL_DRAFT_PROJECT_INDEX).getAll(normalizedProjectId)
  );
  return (drafts || [])
    .filter((draft) => isLocalDraftRecord(draft, normalizedProjectId))
    .sort(compareLocalDraftsNewestFirst)
    .slice(0, normalizedLimit)
    .map(cloneStoredValue);
}

export async function loadLocalDraft(
  projectId: unknown,
  draftId: unknown
): Promise<LocalDraftRecord | null> {
  const normalizedProjectId = String(projectId || "").trim();
  const normalizedDraftId = String(draftId || "").trim();
  if (!normalizedProjectId || !normalizedDraftId) {
    return null;
  }
  const draft = await transaction(
    LOCAL_DRAFTS,
    "readonly",
    (store) => store.get(normalizedDraftId)
  );
  return isLocalDraftRecord(draft, normalizedProjectId)
    ? cloneStoredValue(draft)
    : null;
}

export async function saveLocalDraft(project: StoredProject, {
  reason = "manual",
  restoredFromDraftId = null,
  now = Date.now(),
  id = null
}: LocalDraftOptions = {}): Promise<LocalDraftRecord> {
  const storedProject = cloneStoredValue(project);
  const draft = createLocalDraftRecord(storedProject, {
    reason,
    restoredFromDraftId,
    now,
    id
  });
  const removedIds: string[] = [];
  await transaction(
    [PROJECTS, LOCAL_DRAFTS, HANDLES],
    "readwrite",
    (stores, activeTransaction) => {
      const projectStore = requiredStore(stores, PROJECTS);
      const draftStore = requiredStore(stores, LOCAL_DRAFTS);
      const handleStore = requiredStore(stores, HANDLES);
      const handleRequest = handleStore.get(draft.projectId);
      handleRequest.onsuccess = () => {
        try {
          draft.mediaHandleBinding = localDraftMediaHandleBinding(
            storedProject,
            handleRequest.result
          );
          projectStore.put(storedProject);
          draftStore.put(draft);
          trimLocalDrafts(draftStore, draft.projectId, removedIds);
        } catch (error) {
          abortTransaction(activeTransaction, error);
        }
      };
      return {
        get result() {
          return {
            draft,
            removedIds
          };
        }
      };
    }
  );
  return cloneStoredValue(draft);
}

export async function restoreLocalDraft(
  currentProject: StoredProject,
  draftRecord: unknown,
  {
  now = Date.now(),
  id = null
  }: Pick<LocalDraftOptions, "now" | "id"> = {}
): Promise<{
  project: StoredProject;
  preRestoreDraft: LocalDraftRecord;
  restoredMediaHandle: FileSystemFileHandle | null;
}> {
  const projectId = requiredProjectId(currentProject);
  if (!isLocalDraftRecord(draftRecord, projectId)) {
    throw new TypeError("이 프로젝트에서 불러올 수 있는 임시저장본이 아닙니다.");
  }
  const restoredProject = cloneStoredValue(draftRecord.project);
  if (requiredProjectId(restoredProject) !== projectId) {
    throw new TypeError("임시저장본의 프로젝트 ID가 현재 프로젝트와 다릅니다.");
  }
  const storedCurrentProject = cloneStoredValue(currentProject);
  const restoredMediaHandle = exactLocalDraftMediaHandle(
    draftRecord as LocalDraftRecord
  );
  const preRestoreDraft = createLocalDraftRecord(storedCurrentProject, {
    reason: "pre-restore",
    restoredFromDraftId: draftRecord.id,
    now,
    id
  });
  const removedIds: string[] = [];
  await transaction(
    [PROJECTS, LOCAL_DRAFTS, HANDLES],
    "readwrite",
    (stores, activeTransaction) => {
      const projectStore = requiredStore(stores, PROJECTS);
      const draftStore = requiredStore(stores, LOCAL_DRAFTS);
      const handleStore = requiredStore(stores, HANDLES);
      const handleRequest = handleStore.get(projectId);
      handleRequest.onsuccess = () => {
        try {
          preRestoreDraft.mediaHandleBinding = localDraftMediaHandleBinding(
            storedCurrentProject,
            handleRequest.result
          );
          projectStore.put(restoredProject);
          draftStore.put(preRestoreDraft);
          handleStore.delete(projectId);
          if (restoredMediaHandle) {
            handleStore.put(restoredMediaHandle, projectId);
          }
          trimLocalDrafts(draftStore, projectId, removedIds);
        } catch (error) {
          abortTransaction(activeTransaction, error);
        }
      };
      return {
        get result() {
          return {
            project: restoredProject,
            preRestoreDraft,
            restoredMediaHandle,
            removedIds
          };
        }
      };
    }
  );
  return {
    project: cloneStoredValue(restoredProject),
    preRestoreDraft: cloneStoredValue(preRestoreDraft),
    restoredMediaHandle: restoredMediaHandle
      ? cloneStoredValue(restoredMediaHandle)
      : null
  };
}

function requiredEditingSessionId(value: unknown): string {
  const sessionId = requiredCacheText(value, "편집 세션 ID");
  if (sessionId.length > 256) {
    throw new TypeError("편집 세션 ID는 256자를 넘을 수 없습니다.");
  }
  return sessionId;
}

function editingSessionCheckpointTimestamp(
  now: number | string | Date
): string {
  const date = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError("편집 세션 체크포인트 시각이 올바르지 않습니다.");
  }
  return date.toISOString();
}

function parseEditingSessionCheckpointRecord(
  value: unknown,
  expectedProjectId: string | null = null
): EditingSessionCheckpointRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("편집 세션 체크포인트 형식이 올바르지 않습니다.");
  }
  const candidate = value as Partial<EditingSessionCheckpointRecord>;
  if (candidate.schema !== EDITING_SESSION_CHECKPOINT_SCHEMA) {
    throw new TypeError("지원하지 않는 편집 세션 체크포인트입니다.");
  }
  const projectId = requiredCacheText(candidate.projectId, "프로젝트 ID");
  if (expectedProjectId !== null && projectId !== expectedProjectId) {
    throw new TypeError("편집 세션 체크포인트의 프로젝트 ID가 저장 키와 다릅니다.");
  }
  requiredEditingSessionId(candidate.sessionId);
  editingSessionCheckpointTimestamp(String(candidate.createdAt || ""));
  const baseline = candidate.baseline;
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline)) {
    throw new TypeError("편집 세션 baseline 형식이 올바르지 않습니다.");
  }
  if (baseline.project !== null) {
    if (
      !baseline.project
      || typeof baseline.project !== "object"
      || Array.isArray(baseline.project)
      || requiredProjectId(baseline.project) !== projectId
    ) {
      throw new TypeError("편집 세션 baseline 프로젝트가 대상과 다릅니다.");
    }
  }
  if (!Array.isArray(baseline.localDrafts)) {
    throw new TypeError("편집 세션 baseline 복구본 목록이 올바르지 않습니다.");
  }
  for (const draft of baseline.localDrafts) {
    if (!isLocalDraftRecord(draft, projectId)) {
      throw new TypeError("편집 세션 baseline에 다른 프로젝트의 복구본이 있습니다.");
    }
  }
  if (!Array.isArray(baseline.imageAssets)) {
    throw new TypeError("편집 세션 baseline 이미지 목록이 올바르지 않습니다.");
  }
  for (const entry of baseline.imageAssets) {
    if (
      !entry
      || typeof entry !== "object"
      || !Array.isArray(entry.key)
      || String(entry.key[0] || "") !== projectId
      || !(entry.blob instanceof Blob)
    ) {
      throw new TypeError("편집 세션 baseline 이미지가 대상과 다릅니다.");
    }
  }
  if (!Array.isArray(baseline.shortVideoCaches)) {
    throw new TypeError("편집 세션 baseline 미리보기 캐시 목록이 올바르지 않습니다.");
  }
  for (const cache of baseline.shortVideoCaches) {
    parseShortVideoCacheRecord(cache, projectId);
  }
  const mediaHandle = baseline.mediaHandle;
  if (
    !mediaHandle
    || typeof mediaHandle !== "object"
    || typeof mediaHandle.present !== "boolean"
    || (
      mediaHandle.present
        ? !mediaHandle.handle || typeof mediaHandle.handle !== "object"
        : mediaHandle.handle !== null
    )
  ) {
    throw new TypeError("편집 세션 baseline 파일 연결이 올바르지 않습니다.");
  }
  if (
    baseline.project === null
    && (
      baseline.localDrafts.length > 0
      || baseline.imageAssets.length > 0
      || baseline.shortVideoCaches.length > 0
      || baseline.mediaHandle.present
    )
  ) {
    throw new TypeError(
      "새 프로젝트 체크포인트에 기존 프로젝트 종속 데이터가 섞여 있습니다."
    );
  }
  return candidate as EditingSessionCheckpointRecord;
}

function assertEditingSessionCheckpointOwner(
  checkpoint: EditingSessionCheckpointRecord,
  sessionId: string
): void {
  if (checkpoint.sessionId !== sessionId) {
    throw new Error(
      "이 프로젝트에는 다른 편집 세션의 미완료 체크포인트가 있습니다. "
      + "기존 편집 탭을 복구하거나 종료한 뒤 다시 시도해 주세요."
    );
  }
}

export async function listEditingSessionCheckpoints(): Promise<
  EditingSessionCheckpointRecord[]
> {
  const checkpoints = await transaction(
    EDITING_SESSION_CHECKPOINTS,
    "readonly",
    (store) => store.getAll()
  );
  return (checkpoints || []).map((checkpoint) => cloneStoredValue(
    parseEditingSessionCheckpointRecord(checkpoint)
  ));
}

/** Lightweight inventory for start-screen cleanup; baseline Blobs stay in IDB. */
export async function listEditingSessionCheckpointProjectIds(): Promise<
  string[]
> {
  const keys = await transaction(
    EDITING_SESSION_CHECKPOINTS,
    "readonly",
    (store) => store.getAllKeys()
  );
  return (keys || []).map((key) => requiredCacheText(
    key,
    "체크포인트 프로젝트 ID"
  ));
}

/**
 * Captures the exact browser-local project range before an editor session can
 * write to it. Re-entering with the same session ID returns the durable
 * checkpoint unchanged; a different owner fails closed.
 */
export async function beginEditingSessionCheckpoint(
  projectId: unknown,
  sessionId: unknown,
  { now = Date.now() }: { now?: number | string | Date } = {}
): Promise<EditingSessionCheckpointRecord> {
  const normalizedProjectId = requiredCacheText(projectId, "프로젝트 ID");
  const normalizedSessionId = requiredEditingSessionId(sessionId);
  const createdAt = editingSessionCheckpointTimestamp(now);
  return transaction(
    [
      PROJECTS,
      LOCAL_DRAFTS,
      IMAGE_ASSETS,
      SHORT_VIDEO_CACHES,
      HANDLES,
      EDITING_SESSION_CHECKPOINTS
    ],
    "readwrite",
    (stores, activeTransaction) => {
      const projectStore = requiredStore(stores, PROJECTS);
      const draftStore = requiredStore(stores, LOCAL_DRAFTS);
      const imageStore = requiredStore(stores, IMAGE_ASSETS);
      const cacheStore = requiredStore(stores, SHORT_VIDEO_CACHES);
      const handleStore = requiredStore(stores, HANDLES);
      const checkpointStore = requiredStore(
        stores,
        EDITING_SESSION_CHECKPOINTS
      );
      let result: EditingSessionCheckpointRecord | null = null;
      const checkpointRequest = checkpointStore.get(normalizedProjectId);
      checkpointRequest.onsuccess = () => {
        try {
          if (checkpointRequest.result !== undefined) {
            const existing = parseEditingSessionCheckpointRecord(
              checkpointRequest.result,
              normalizedProjectId
            );
            assertEditingSessionCheckpointOwner(existing, normalizedSessionId);
            result = cloneStoredValue(existing);
            return;
          }

          let remainingReads = 6;
          let storedProject: StoredProject | null = null;
          let localDrafts: LocalDraftRecord[] = [];
          let imageKeys: IDBValidKey[] = [];
          let imageValues: unknown[] = [];
          let shortVideoCaches: ShortVideoCacheRecord[] = [];
          let storedMediaHandle: FileSystemFileHandle | null = null;
          let mediaHandlePresent = false;

          const finishRead = (): void => {
            remainingReads -= 1;
            if (remainingReads !== 0) {
              return;
            }
            if (imageKeys.length !== imageValues.length) {
              throw new Error(
                "이미지 저장소의 키와 값 개수가 달라 체크포인트를 만들지 않았습니다."
              );
            }
            const imageAssets: EditingSessionImageAssetSnapshot[] = [];
            imageKeys.forEach((key, index) => {
              if (!Array.isArray(key) || String(key[0] || "") !== normalizedProjectId) {
                return;
              }
              const blob = imageValues[index];
              if (!(blob instanceof Blob)) {
                throw new TypeError(
                  "프로젝트 이미지 저장소에 Blob이 아닌 값이 있습니다."
                );
              }
              imageAssets.push({
                key: cloneStoredValue(key),
                blob: cloneStoredValue(blob)
              });
            });
            if (
              storedProject === null
              && (
                localDrafts.length > 0
                || imageAssets.length > 0
                || shortVideoCaches.length > 0
                || mediaHandlePresent
              )
            ) {
              throw new Error(
                "프로젝트 본문 없이 종속 로컬 데이터가 남아 있어 새 세션 baseline을 만들지 않았습니다."
              );
            }
            const checkpoint: EditingSessionCheckpointRecord = {
              schema: EDITING_SESSION_CHECKPOINT_SCHEMA,
              projectId: normalizedProjectId,
              sessionId: normalizedSessionId,
              createdAt,
              baseline: {
                project: storedProject,
                localDrafts,
                imageAssets,
                shortVideoCaches,
                mediaHandle: {
                  present: mediaHandlePresent,
                  handle: storedMediaHandle
                }
              }
            };
            parseEditingSessionCheckpointRecord(
              checkpoint,
              normalizedProjectId
            );
            result = cloneStoredValue(checkpoint);
            checkpointStore.add(checkpoint);
          };
          const guardRead = (operation: () => void): void => {
            try {
              operation();
              finishRead();
            } catch (error) {
              abortTransaction(activeTransaction, error);
            }
          };

          const projectRequest = projectStore.get(normalizedProjectId);
          projectRequest.onsuccess = () => guardRead(() => {
            const value = projectRequest.result;
            if (value === undefined) {
              storedProject = null;
              return;
            }
            if (
              !value
              || typeof value !== "object"
              || Array.isArray(value)
              || requiredProjectId(value as StoredProject) !== normalizedProjectId
            ) {
              throw new TypeError("체크포인트 대상 프로젝트 형식이 올바르지 않습니다.");
            }
            storedProject = cloneStoredValue(value as StoredProject);
          });

          const draftRequest = draftStore
            .index(LOCAL_DRAFT_PROJECT_INDEX)
            .getAll(normalizedProjectId);
          draftRequest.onsuccess = () => guardRead(() => {
            localDrafts = (draftRequest.result || []).map((draft) => {
              if (!isLocalDraftRecord(draft, normalizedProjectId)) {
                throw new TypeError("체크포인트 대상 복구본 형식이 올바르지 않습니다.");
              }
              return cloneStoredValue(draft);
            });
          });

          const imageKeyRequest = imageStore.getAllKeys();
          imageKeyRequest.onsuccess = () => guardRead(() => {
            imageKeys = cloneStoredValue(imageKeyRequest.result || []);
          });
          const imageValueRequest = imageStore.getAll();
          imageValueRequest.onsuccess = () => guardRead(() => {
            imageValues = cloneStoredValue(imageValueRequest.result || []);
          });

          const cacheRequest = cacheStore
            .index(SHORT_VIDEO_CACHE_PROJECT_INDEX)
            .getAll(normalizedProjectId);
          cacheRequest.onsuccess = () => guardRead(() => {
            shortVideoCaches = (cacheRequest.result || []).map((cache) => (
              cloneStoredValue(parseShortVideoCacheRecord(
                cache,
                normalizedProjectId
              ))
            ));
          });

          const handleRequest = handleStore.get(normalizedProjectId);
          handleRequest.onsuccess = () => guardRead(() => {
            mediaHandlePresent = handleRequest.result !== undefined;
            storedMediaHandle = mediaHandlePresent
              ? cloneStoredValue(handleRequest.result as FileSystemFileHandle)
              : null;
          });
        } catch (error) {
          abortTransaction(activeTransaction, error);
        }
      };

      return {
        get result() {
          if (!result) {
            throw new Error("편집 세션 체크포인트가 저장되지 않았습니다.");
          }
          return cloneStoredValue(result);
        }
      };
    }
  );
}

/**
 * Commits a session by optionally saving its final CURRENT and deleting the
 * checkpoint in the same transaction. Missing checkpoints are an idempotent
 * no-op; a checkpoint owned by another session fails closed.
 */
export async function commitEditingSessionCheckpoint(
  projectId: unknown,
  sessionId: unknown,
  finalProject?: StoredProject
): Promise<boolean> {
  const normalizedProjectId = requiredCacheText(projectId, "프로젝트 ID");
  const normalizedSessionId = requiredEditingSessionId(sessionId);
  let storedFinalProject: StoredProject | undefined;
  if (finalProject !== undefined) {
    if (
      !finalProject
      || typeof finalProject !== "object"
      || Array.isArray(finalProject)
      || requiredProjectId(finalProject) !== normalizedProjectId
    ) {
      throw new TypeError("완료할 CURRENT 프로젝트가 체크포인트 대상과 다릅니다.");
    }
    storedFinalProject = cloneStoredValue(finalProject);
  }
  return transaction(
    [PROJECTS, EDITING_SESSION_CHECKPOINTS],
    "readwrite",
    (stores, activeTransaction) => {
      const projectStore = requiredStore(stores, PROJECTS);
      const checkpointStore = requiredStore(
        stores,
        EDITING_SESSION_CHECKPOINTS
      );
      let committed = false;
      const request = checkpointStore.get(normalizedProjectId);
      request.onsuccess = () => {
        try {
          if (request.result === undefined) {
            return;
          }
          const checkpoint = parseEditingSessionCheckpointRecord(
            request.result,
            normalizedProjectId
          );
          assertEditingSessionCheckpointOwner(
            checkpoint,
            normalizedSessionId
          );
          if (storedFinalProject) {
            projectStore.put(storedFinalProject);
          }
          checkpointStore.delete(normalizedProjectId);
          committed = true;
        } catch (error) {
          abortTransaction(activeTransaction, error);
        }
      };
      return {
        get result() {
          return committed;
        }
      };
    }
  );
}

function referencedImageAssetBlobIds(
  candidateProject: Partial<StoredProject> | null | undefined
): Set<string> {
  const result = new Set<string>();
  const assets = [
    ...(candidateProject?.imageAssets || []),
    ...(candidateProject?.shortForm?.imageAssets || []),
    ...(candidateProject?.shortFormWorkspaces?.workspaces || []).flatMap(
      (workspace) => workspace.shortForm?.imageAssets || []
    )
  ];
  for (const asset of assets) {
    if (asset?.source?.kind !== "blob-key") {
      continue;
    }
    const blobKey = String(asset.source.value || asset.id || "");
    if (blobKey) {
      result.add(blobKey);
    }
  }
  return result;
}

function referencedShortVideoCacheIds(
  candidateProject: Partial<StoredProject> | null | undefined
): Set<string> {
  const result = new Set<string>();
  const branches = [
    candidateProject?.shortForm,
    ...(candidateProject?.shortFormWorkspaces?.workspaces || []).map(
      (workspace) => workspace.shortForm
    )
  ];
  for (const branch of branches) {
    for (const asset of branch?.videoAssets || []) {
      const assetId = String(asset?.id || "");
      if (assetId) {
        result.add(assetId);
      }
    }
    for (const asset of branch?.sourceAudioAssets || []) {
      const assetId = String(asset?.id || "");
      if (assetId) {
        result.add(assetId);
        result.add(`source-audio-cache:${assetId}`);
      }
    }
  }
  return result;
}

/**
 * Restores the exact project-scoped browser data captured on entry and then
 * removes the checkpoint, all in one transaction. Manual drafts created after
 * entry are explicit user saves: keep the newest five and only the local
 * assets they reference. If a new session has such a draft, its newest
 * snapshot becomes CURRENT so the start screen can actually offer recovery;
 * only that exact snapshot's bound file handle may follow it. An existing
 * baseline always restores its own handle instead of the session's last one.
 */
async function discardEditingSessionCheckpointInternal(
  normalizedProjectId: string,
  expectedSessionId: string | null
): Promise<boolean> {
  return transaction(
    [
      PROJECTS,
      LOCAL_DRAFTS,
      IMAGE_ASSETS,
      SHORT_VIDEO_CACHES,
      HANDLES,
      EDITING_SESSION_CHECKPOINTS
    ],
    "readwrite",
    (stores, activeTransaction) => {
      const projectStore = requiredStore(stores, PROJECTS);
      const draftStore = requiredStore(stores, LOCAL_DRAFTS);
      const imageStore = requiredStore(stores, IMAGE_ASSETS);
      const cacheStore = requiredStore(stores, SHORT_VIDEO_CACHES);
      const handleStore = requiredStore(stores, HANDLES);
      const checkpointStore = requiredStore(
        stores,
        EDITING_SESSION_CHECKPOINTS
      );
      let discarded = false;
      const request = checkpointStore.get(normalizedProjectId);
      request.onsuccess = () => {
        try {
          if (request.result === undefined) {
            return;
          }
          const checkpoint = parseEditingSessionCheckpointRecord(
            request.result,
            normalizedProjectId
          );
          if (expectedSessionId !== null) {
            assertEditingSessionCheckpointOwner(
              checkpoint,
              expectedSessionId
            );
          }
          const baseline = cloneStoredValue(checkpoint.baseline);
          let currentDrafts: LocalDraftRecord[] = [];
          let currentImageKeys: IDBValidKey[] = [];
          let currentImageValues: unknown[] = [];
          let currentShortVideoCaches: ShortVideoCacheRecord[] = [];
          let remainingKeyReads = 4;
          const restoreBaseline = (): void => {
            remainingKeyReads -= 1;
            if (remainingKeyReads !== 0) {
              return;
            }
            if (currentImageKeys.length !== currentImageValues.length) {
              throw new Error(
                "명시적 임시저장의 이미지 키와 Blob 개수가 달라 롤백하지 않았습니다."
              );
            }
            const baselineDraftIds = new Set(
              baseline.localDrafts.map((draft) => draft.id)
            );
            const newManualDrafts = currentDrafts.filter((draft) => (
              draft.reason === "manual" && !baselineDraftIds.has(draft.id)
            ));
            const finalDrafts = [
              ...baseline.localDrafts,
              ...newManualDrafts
            ].sort(compareLocalDraftsNewestFirst).filter((draft, index, all) => (
              all.findIndex((candidate) => candidate.id === draft.id) === index
            )).slice(0, MAX_LOCAL_DRAFTS);
            const keptNewManualIds = new Set(
              finalDrafts
                .filter((draft) => !baselineDraftIds.has(draft.id))
                .map((draft) => draft.id)
            );
            const keptNewManualDrafts = newManualDrafts
              .filter((draft) => keptNewManualIds.has(draft.id))
              .sort(compareLocalDraftsNewestFirst);
            const newestExplicitProject = keptNewManualDrafts[0]?.project
              ?? null;
            const restoredProject = baseline.project ?? newestExplicitProject;
            const promotedExplicitDraft = baseline.project === null
              ? keptNewManualDrafts[0] ?? null
              : null;
            const explicitImageIds = new Set<string>();
            const explicitCacheIds = new Set<string>();
            for (const draft of keptNewManualDrafts) {
              for (const assetId of referencedImageAssetBlobIds(draft.project)) {
                explicitImageIds.add(assetId);
              }
              for (const assetId of referencedShortVideoCacheIds(draft.project)) {
                explicitCacheIds.add(assetId);
              }
            }

            projectStore.delete(normalizedProjectId);
            handleStore.delete(normalizedProjectId);
            for (const draft of currentDrafts) {
              draftStore.delete(draft.id);
            }
            const currentImages = new Map<string, EditingSessionImageAssetSnapshot>();
            currentImageKeys.forEach((key, index) => {
              if (!Array.isArray(key) || String(key[0] || "") !== normalizedProjectId) {
                return;
              }
              const blob = currentImageValues[index];
              if (!(blob instanceof Blob)) {
                throw new TypeError(
                  "명시적 임시저장의 이미지 저장소에 Blob이 아닌 값이 있습니다."
                );
              }
              const assetId = String(key[1] || "");
              imageStore.delete(key);
              if (assetId && explicitImageIds.has(assetId)) {
                currentImages.set(assetId, { key, blob });
              }
            });
            for (const cache of currentShortVideoCaches) {
              cacheStore.delete([cache.projectId, cache.assetId]);
            }

            if (restoredProject) {
              projectStore.put(restoredProject);
            }
            for (const draft of finalDrafts) {
              draftStore.put(draft);
            }
            for (const image of baseline.imageAssets) {
              imageStore.put(image.blob, image.key);
            }
            for (const image of currentImages.values()) {
              imageStore.put(image.blob, image.key);
            }
            for (const cache of baseline.shortVideoCaches) {
              cacheStore.put(cache);
            }
            for (const cache of currentShortVideoCaches) {
              if (explicitCacheIds.has(cache.assetId)) {
                cacheStore.put(cache);
              }
            }
            if (baseline.mediaHandle.present && baseline.mediaHandle.handle) {
              handleStore.put(baseline.mediaHandle.handle, normalizedProjectId);
            } else {
              const explicitHandle = exactLocalDraftMediaHandle(
                promotedExplicitDraft
              );
              if (explicitHandle) {
                handleStore.put(explicitHandle, normalizedProjectId);
              }
            }
            checkpointStore.delete(normalizedProjectId);
            discarded = true;
          };
          const guardKeys = (operation: () => void): void => {
            try {
              operation();
              restoreBaseline();
            } catch (error) {
              abortTransaction(activeTransaction, error);
            }
          };

          const draftValues = draftStore
            .index(LOCAL_DRAFT_PROJECT_INDEX)
            .getAll(normalizedProjectId);
          draftValues.onsuccess = () => guardKeys(() => {
            currentDrafts = (draftValues.result || []).map((draft) => {
              if (!isLocalDraftRecord(draft, normalizedProjectId)) {
                throw new TypeError(
                  "편집 세션의 현재 임시저장 형식이 올바르지 않습니다."
                );
              }
              return cloneStoredValue(draft);
            });
          });

          const imageKeys = imageStore.getAllKeys();
          imageKeys.onsuccess = () => guardKeys(() => {
            currentImageKeys = cloneStoredValue(imageKeys.result || []);
          });
          const imageValues = imageStore.getAll();
          imageValues.onsuccess = () => guardKeys(() => {
            currentImageValues = cloneStoredValue(imageValues.result || []);
          });

          const cacheValues = cacheStore
            .index(SHORT_VIDEO_CACHE_PROJECT_INDEX)
            .getAll(normalizedProjectId);
          cacheValues.onsuccess = () => guardKeys(() => {
            currentShortVideoCaches = (cacheValues.result || []).map((cache) => (
              cloneStoredValue(parseShortVideoCacheRecord(
                cache,
                normalizedProjectId
              ))
            ));
          });
        } catch (error) {
          abortTransaction(activeTransaction, error);
        }
      };
      return {
        get result() {
          return discarded;
        }
      };
    }
  );
}

export async function discardEditingSessionCheckpoint(
  projectId: unknown,
  sessionId: unknown
): Promise<boolean> {
  return discardEditingSessionCheckpointInternal(
    requiredCacheText(projectId, "프로젝트 ID"),
    requiredEditingSessionId(sessionId)
  );
}

/**
 * Rolls an abandoned checkpoint back without knowing its owner session ID.
 * The caller MUST hold the project's exclusive external Web Lock for the
 * entire call; this storage layer cannot prove that no live editor is writing.
 */
export async function discardAbandonedEditingSessionCheckpoint(
  projectId: unknown
): Promise<boolean> {
  return discardEditingSessionCheckpointInternal(
    requiredCacheText(projectId, "프로젝트 ID"),
    null
  );
}

export async function saveMediaHandle(
  projectId: IDBValidKey,
  handle: FileSystemFileHandle
): Promise<boolean> {
  try {
    await transaction(HANDLES, "readwrite", (store) => store.put(handle, projectId));
    return true;
  } catch (error) {
    console.warn("영상 파일 핸들을 저장하지 못했습니다.", error);
    return false;
  }
}

export async function deleteMediaHandle(projectId: IDBValidKey): Promise<boolean> {
  try {
    await transaction(HANDLES, "readwrite", (store) => store.delete(projectId));
    return true;
  } catch (error) {
    console.warn("이전 영상 파일 핸들을 지우지 못했습니다.", error);
    return false;
  }
}

export async function loadMediaHandle(
  projectId: IDBValidKey
): Promise<StoredFileHandle | null> {
  try {
    return await transaction(HANDLES, "readonly", (store) => store.get(projectId));
  } catch (error) {
    console.warn("영상 파일 핸들을 복구하지 못했습니다.", error);
    return null;
  }
}

export async function getFileFromStoredHandle(projectId: IDBValidKey) {
  try {
    const handle = await loadMediaHandle(projectId);
    if (!handle) {
      return null;
    }
    const permission = await handle.queryPermission({ mode: "read" });
    if (permission !== "granted") {
      return { handle, file: null, permission };
    }
    return { handle, file: await handle.getFile(), permission };
  } catch (error) {
    console.warn("저장된 원본 파일을 다시 열지 못했습니다.", error);
    return {
      handle: null,
      file: null,
      permission: "error",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

const imageAssetKey = (projectId: unknown, assetId: unknown): string[] => [
  String(projectId || ""),
  String(assetId || "")
];

export async function saveImageAssetBlob(
  projectId: unknown,
  assetId: unknown,
  blob: Blob
): Promise<Blob> {
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new TypeError("저장할 이미지 에셋 Blob이 비어 있습니다.");
  }
  await transaction(
    IMAGE_ASSETS,
    "readwrite",
    (store) => store.put(blob, imageAssetKey(projectId, assetId))
  );
  return blob;
}

export async function saveProjectWithImageAssetBlob<T extends StoredProject>(
  project: T,
  assetId: unknown,
  blob: Blob
): Promise<T> {
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new TypeError("저장할 이미지 에셋 Blob이 비어 있습니다.");
  }
  await transaction(
    [PROJECTS, IMAGE_ASSETS],
    "readwrite",
    (stores) => {
      requiredStore(stores, PROJECTS).put(project);
      requiredStore(stores, IMAGE_ASSETS).put(
        blob,
        imageAssetKey(project?.id, assetId)
      );
      return {
        get result() {
          return project;
        }
      };
    }
  );
  return project;
}

/** Atomically saves one project and every supplied image Blob. */
export async function saveProjectWithImageAssetBlobs<T extends StoredProject>(
  project: T,
  blobs: ReadonlyMap<string, Blob>
): Promise<T> {
  const projectId = requiredProjectId(project);
  const entries = [...blobs.entries()].map(([assetId, blob]) => {
    const normalizedAssetId = String(assetId || "").trim();
    if (!normalizedAssetId) {
      throw new TypeError("복원할 이미지 에셋 ID가 없습니다.");
    }
    if (!(blob instanceof Blob) || blob.size <= 0) {
      throw new TypeError(`복원할 이미지 에셋 ${normalizedAssetId} Blob이 비어 있습니다.`);
    }
    return [normalizedAssetId, blob] as const;
  });
  if (new Set(entries.map(([assetId]) => assetId)).size !== entries.length) {
    throw new TypeError("복원할 이미지 에셋 ID가 중복되어 있습니다.");
  }

  await transaction(
    [PROJECTS, IMAGE_ASSETS],
    "readwrite",
    (stores) => {
      const projectStore = requiredStore(stores, PROJECTS);
      const imageStore = requiredStore(stores, IMAGE_ASSETS);
      for (const [assetId, blob] of entries) {
        imageStore.put(blob, imageAssetKey(projectId, assetId));
      }
      projectStore.put(project);
      return {
        get result() {
          return project;
        }
      };
    }
  );
  return project;
}

/**
 * Atomically replaces a one-session project, writes supplied embedded images,
 * resets short-preview caches, and applies the stored-file-handle policy. A
 * failed transaction leaves the previous session fully intact.
 */
export async function replaceProjectSessionAtomically<T extends StoredProject>(
  project: T,
  blobs: ReadonlyMap<string, Blob>,
  { deleteStoredMediaHandle }: { deleteStoredMediaHandle: boolean }
): Promise<{ project: T; deletedShortVideoCacheCount: number }> {
  const projectId = requiredProjectId(project);
  const entries = [...blobs.entries()].map(([assetId, blob]) => {
    const normalizedAssetId = String(assetId || "").trim();
    if (!normalizedAssetId) {
      throw new TypeError("복원할 이미지 에셋 ID가 없습니다.");
    }
    if (!(blob instanceof Blob) || blob.size <= 0) {
      throw new TypeError(`복원할 이미지 에셋 ${normalizedAssetId} Blob이 비어 있습니다.`);
    }
    return [normalizedAssetId, blob] as const;
  });
  if (new Set(entries.map(([assetId]) => assetId)).size !== entries.length) {
    throw new TypeError("복원할 이미지 에셋 ID가 중복되어 있습니다.");
  }

  return transaction(
    [PROJECTS, IMAGE_ASSETS, SHORT_VIDEO_CACHES, HANDLES],
    "readwrite",
    (stores) => {
      const projectStore = requiredStore(stores, PROJECTS);
      const imageStore = requiredStore(stores, IMAGE_ASSETS);
      const cacheStore = requiredStore(stores, SHORT_VIDEO_CACHES);
      const handleStore = requiredStore(stores, HANDLES);
      let deletedShortVideoCacheCount = 0;
      for (const [assetId, blob] of entries) {
        imageStore.put(blob, imageAssetKey(projectId, assetId));
      }
      projectStore.put(project);
      if (deleteStoredMediaHandle) {
        handleStore.delete(projectId);
      }
      const cacheKeys = cacheStore
        .index(SHORT_VIDEO_CACHE_PROJECT_INDEX)
        .getAllKeys(projectId);
      cacheKeys.onsuccess = () => {
        for (const key of cacheKeys.result || []) {
          if (
            !Array.isArray(key)
            || key.length !== 2
            || String(key[0]) !== projectId
          ) {
            throw new TypeError("숏폼 영상 캐시 인덱스 키가 올바르지 않습니다.");
          }
          cacheStore.delete(key);
          deletedShortVideoCacheCount += 1;
        }
      };
      return {
        get result() {
          return {
            project,
            deletedShortVideoCacheCount
          };
        }
      };
    }
  );
}

/**
 * Deletes one browser-local editing session as a single IndexedDB commit.
 * Every key is selected by the exact project ID; an abort in any store rolls
 * back the project record and all of its dependent records together.
 */
export async function deleteProjectSessionAtomically(
  projectId: unknown
): Promise<ProjectSessionDeletionCounts> {
  const normalizedProjectId = requiredCacheText(projectId, "프로젝트 ID");
  return transaction(
    [
      PROJECTS,
      LOCAL_DRAFTS,
      IMAGE_ASSETS,
      SHORT_VIDEO_CACHES,
      HANDLES,
      EDITING_SESSION_CHECKPOINTS
    ],
    "readwrite",
    (stores) => {
      const projectStore = requiredStore(stores, PROJECTS);
      const draftStore = requiredStore(stores, LOCAL_DRAFTS);
      const imageStore = requiredStore(stores, IMAGE_ASSETS);
      const cacheStore = requiredStore(stores, SHORT_VIDEO_CACHES);
      const handleStore = requiredStore(stores, HANDLES);
      const checkpointStore = requiredStore(
        stores,
        EDITING_SESSION_CHECKPOINTS
      );
      const counts: ProjectSessionDeletionCounts = {
        deletedProjectCount: 0,
        deletedLocalDraftCount: 0,
        deletedImageAssetCount: 0,
        deletedShortVideoCacheCount: 0,
        deletedMediaHandleCount: 0,
        deletedEditingSessionCheckpointCount: 0
      };

      const deleteSingleProjectKey = (
        store: IDBObjectStore,
        countKey:
          | "deletedProjectCount"
          | "deletedMediaHandleCount"
          | "deletedEditingSessionCheckpointCount"
      ): void => {
        const request = store.getAllKeys(normalizedProjectId);
        request.onsuccess = () => {
          for (const key of request.result || []) {
            if (String(key) !== normalizedProjectId) {
              throw new TypeError("프로젝트 저장소 키가 요청한 프로젝트와 일치하지 않습니다.");
            }
            store.delete(key);
            counts[countKey] += 1;
          }
        };
      };

      deleteSingleProjectKey(projectStore, "deletedProjectCount");
      deleteSingleProjectKey(handleStore, "deletedMediaHandleCount");
      deleteSingleProjectKey(
        checkpointStore,
        "deletedEditingSessionCheckpointCount"
      );

      const draftRequest = draftStore
        .index(LOCAL_DRAFT_PROJECT_INDEX)
        .getAllKeys(normalizedProjectId);
      draftRequest.onsuccess = () => {
        for (const key of draftRequest.result || []) {
          draftStore.delete(key);
          counts.deletedLocalDraftCount += 1;
        }
      };

      const imageRequest = imageStore.getAllKeys();
      imageRequest.onsuccess = () => {
        for (const key of imageRequest.result || []) {
          if (
            Array.isArray(key)
            && key.length >= 2
            && String(key[0]) === normalizedProjectId
          ) {
            imageStore.delete(key);
            counts.deletedImageAssetCount += 1;
          }
        }
      };

      const cacheRequest = cacheStore
        .index(SHORT_VIDEO_CACHE_PROJECT_INDEX)
        .getAllKeys(normalizedProjectId);
      cacheRequest.onsuccess = () => {
        for (const key of cacheRequest.result || []) {
          if (
            !Array.isArray(key)
            || key.length !== 2
            || String(key[0]) !== normalizedProjectId
          ) {
            throw new TypeError("숏폼 영상 캐시 인덱스 키가 올바르지 않습니다.");
          }
          cacheStore.delete(key);
          counts.deletedShortVideoCacheCount += 1;
        }
      };

      return {
        get result() {
          return { ...counts };
        }
      };
    }
  );
}

/**
 * Deletes every browser-local editing session in one IndexedDB transaction.
 * Static site assets and files selected or exported by the user are outside
 * these stores and are therefore intentionally untouched.
 */
export async function deleteAllProjectSessionsAtomically(): Promise<
  ProjectSessionDeletionCounts
> {
  return transaction(
    [
      PROJECTS,
      LOCAL_DRAFTS,
      IMAGE_ASSETS,
      SHORT_VIDEO_CACHES,
      HANDLES,
      EDITING_SESSION_CHECKPOINTS
    ],
    "readwrite",
    (stores) => {
      const countedStores = [
        [PROJECTS, "deletedProjectCount"],
        [LOCAL_DRAFTS, "deletedLocalDraftCount"],
        [IMAGE_ASSETS, "deletedImageAssetCount"],
        [SHORT_VIDEO_CACHES, "deletedShortVideoCacheCount"],
        [HANDLES, "deletedMediaHandleCount"],
        [
          EDITING_SESSION_CHECKPOINTS,
          "deletedEditingSessionCheckpointCount"
        ]
      ] as const;
      const counts: ProjectSessionDeletionCounts = {
        deletedProjectCount: 0,
        deletedLocalDraftCount: 0,
        deletedImageAssetCount: 0,
        deletedShortVideoCacheCount: 0,
        deletedMediaHandleCount: 0,
        deletedEditingSessionCheckpointCount: 0
      };

      // Queue every count before any clear. IndexedDB executes requests in
      // transaction order, so the returned numbers describe the committed
      // deletion rather than the empty stores after it.
      for (const [storeName, countKey] of countedStores) {
        const request = requiredStore(stores, storeName).count();
        request.onsuccess = () => {
          counts[countKey] = request.result;
        };
      }
      for (const [storeName] of countedStores) {
        requiredStore(stores, storeName).clear();
      }

      return {
        get result() {
          return { ...counts };
        }
      };
    }
  );
}

export async function loadImageAssetBlob(
  projectId: unknown,
  assetId: unknown
): Promise<Blob | null> {
  const value = await transaction(
    IMAGE_ASSETS,
    "readonly",
    (store) => store.get(imageAssetKey(projectId, assetId))
  );
  return value instanceof Blob ? value : null;
}

export async function deleteImageAssetBlob(
  projectId: unknown,
  assetId: unknown
): Promise<void> {
  await transaction(
    IMAGE_ASSETS,
    "readwrite",
    (store) => store.delete(imageAssetKey(projectId, assetId))
  );
}

export async function pruneImageAssetBlobs(
  projectId: unknown,
  keepAssetIds: Iterable<unknown> = []
): Promise<number> {
  const targetProjectId = String(projectId || "");
  const requestedKeep = new Set(
    Array.from(keepAssetIds || [], (assetId) => String(assetId || ""))
  );
  const deletedCount = await transaction(
    [PROJECTS, LOCAL_DRAFTS, IMAGE_ASSETS],
    "readwrite",
    (stores) => {
      const projectStore = requiredStore(stores, PROJECTS);
      const draftStore = requiredStore(stores, LOCAL_DRAFTS);
      const imageAssetStore = requiredStore(stores, IMAGE_ASSETS);
      let count = 0;
      let pendingReferenceReads = 2;
      const keep = new Set(requestedKeep);
      const collectReferencedAssets = (
        candidateProject: Partial<StoredProject> | null | undefined
      ): void => {
        const assets = [
          ...(candidateProject?.imageAssets || []),
          ...(candidateProject?.shortForm?.imageAssets || []),
          ...(candidateProject?.shortFormWorkspaces?.workspaces || []).flatMap(
            (workspace) => workspace.shortForm?.imageAssets || []
          )
        ];
        for (const asset of assets) {
          if (asset?.source?.kind !== "blob-key") {
            continue;
          }
          const blobKey = String(asset.source.value || asset.id || "");
          if (blobKey) {
            keep.add(blobKey);
          }
        }
      };
      const scanImageAssetsAfterReferences = () => {
        pendingReferenceReads -= 1;
        if (pendingReferenceReads > 0) {
          return;
        }
        const request = imageAssetStore.openKeyCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            return;
          }
          const key = cursor.primaryKey ?? cursor.key;
          if (
            Array.isArray(key)
            && key.length >= 2
            && String(key[0]) === targetProjectId
            && !keep.has(String(key[1]))
          ) {
            imageAssetStore.delete(key);
            count += 1;
          }
          cursor.continue();
        };
      };

      const projectRequest = projectStore.get(targetProjectId);
      projectRequest.onsuccess = () => {
        collectReferencedAssets(projectRequest.result);
        scanImageAssetsAfterReferences();
      };
      const draftsRequest = draftStore
        .index(LOCAL_DRAFT_PROJECT_INDEX)
        .getAll(targetProjectId);
      draftsRequest.onsuccess = () => {
        for (const draft of draftsRequest.result || []) {
          if (isLocalDraftRecord(draft, targetProjectId)) {
            collectReferencedAssets(draft.project);
          }
        }
        scanImageAssetsAfterReferences();
      };
      return {
        get result() {
          return count;
        }
      };
    }
  );
  return Number(deletedCount) || 0;
}
