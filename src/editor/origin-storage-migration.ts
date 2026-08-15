import { EDITOR_DATABASE_NAME } from "../lib/editor-core.js";
import {
  ORIGIN_STORAGE_MIGRATION_TARGET_ORIGIN,
  OriginStorageMigrationError,
  buildOriginStorageMigration,
  parseOriginStorageMigration
} from "../lib/origin-storage-migration.js";
import type {
  OriginStorageMigrationEnvelope,
  OriginStorageMigrationImageInput
} from "../lib/origin-storage-migration.js";

const DATABASE_VERSION = 5;
const PROJECTS = "projects";
const MEDIA_HANDLES = "media-handles";
const IMAGE_ASSETS = "image-assets";
const LOCAL_DRAFTS = "local-drafts";
const LOCAL_DRAFT_PROJECT_INDEX = "projectId";
const SHORT_VIDEO_CACHES = "short-video-caches";
const SHORT_VIDEO_CACHE_PROJECT_INDEX = "projectId";
const EDITING_SESSION_CHECKPOINTS = "editing-session-checkpoints";
const REQUIRED_MIGRATION_STORES = Object.freeze([
  PROJECTS,
  LOCAL_DRAFTS,
  IMAGE_ASSETS
]);

export interface OriginStorageMigrationExportOptions {
  factory?: IDBFactory;
  sourceOrigin?: string;
  createdAt?: string;
  transferId?: string;
}

export interface OriginStorageMigrationImportOptions {
  factory?: IDBFactory;
  targetOrigin?: string;
  expectedSourceOrigin?: string;
}

export interface OriginStorageMigrationImportResult {
  transferId: string;
  projectCount: number;
  localDraftCount: number;
  imageAssetCount: number;
}

function migrationError(message: string, code: string): OriginStorageMigrationError {
  return new OriginStorageMigrationError(message, code);
}

function createCurrentDatabaseStores(
  database: IDBDatabase,
  transaction: IDBTransaction
): void {
  if (!database.objectStoreNames.contains(PROJECTS)) {
    database.createObjectStore(PROJECTS, { keyPath: "id" });
  }
  if (!database.objectStoreNames.contains(MEDIA_HANDLES)) {
    database.createObjectStore(MEDIA_HANDLES);
  }
  if (!database.objectStoreNames.contains(IMAGE_ASSETS)) {
    database.createObjectStore(IMAGE_ASSETS);
  }
  const localDraftStore = database.objectStoreNames.contains(LOCAL_DRAFTS)
    ? transaction.objectStore(LOCAL_DRAFTS)
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
    ? transaction.objectStore(SHORT_VIDEO_CACHES)
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
}

function requiredMigrationStores(database: IDBDatabase): void {
  const missing = REQUIRED_MIGRATION_STORES.find((storeName) => (
    !database.objectStoreNames.contains(storeName)
  ));
  if (missing) {
    throw migrationError(
      `Kirinuki IndexedDB에 필요한 스토어가 없습니다: ${missing}`,
      "ORIGIN_STORAGE_MIGRATION_DATABASE_MISMATCH"
    );
  }
}

function openExistingDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let absent = false;
    const request = factory.open(EDITOR_DATABASE_NAME);
    request.onupgradeneeded = (event) => {
      if (event.oldVersion === 0) {
        absent = true;
        request.transaction?.abort();
      }
    };
    request.onerror = () => reject(absent
      ? migrationError(
        "이전 Kirinuki 편집 저장소에 옮길 데이터가 없습니다.",
        "ORIGIN_STORAGE_MIGRATION_SOURCE_EMPTY"
      )
      : request.error || migrationError(
        "이전 Kirinuki IndexedDB를 열지 못했습니다.",
        "ORIGIN_STORAGE_MIGRATION_DATABASE_OPEN_FAILED"
      ));
    request.onblocked = () => reject(migrationError(
      "다른 이전 Kirinuki 편집 창이 데이터 이동을 막고 있습니다.",
      "ORIGIN_STORAGE_MIGRATION_DATABASE_BLOCKED"
    ));
    request.onsuccess = () => {
      if (absent) {
        request.result.close();
        reject(migrationError(
          "이전 Kirinuki 편집 저장소에 옮길 데이터가 없습니다.",
          "ORIGIN_STORAGE_MIGRATION_SOURCE_EMPTY"
        ));
        return;
      }
      resolve(request.result);
    };
  });
}

function openImportDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(EDITOR_DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => createCurrentDatabaseStores(
      request.result,
      request.transaction!
    );
    request.onerror = () => reject(
      request.error || migrationError(
        "이 기기의 Kirinuki 편집 저장소를 열지 못했습니다.",
        "ORIGIN_STORAGE_MIGRATION_DATABASE_OPEN_FAILED"
      )
    );
    request.onblocked = () => reject(migrationError(
      "다른 Kirinuki 편집 탭이 이전 저장 데이터 이동을 막고 있습니다.",
      "ORIGIN_STORAGE_MIGRATION_DATABASE_BLOCKED"
    ));
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error || migrationError(
        "IndexedDB 마이그레이션 트랜잭션이 실패했습니다.",
        "ORIGIN_STORAGE_MIGRATION_TRANSACTION_FAILED"
      )
    );
    transaction.onabort = () => reject(
      transaction.error || migrationError(
        "IndexedDB 마이그레이션 트랜잭션이 중단되었습니다.",
        "ORIGIN_STORAGE_MIGRATION_TRANSACTION_ABORTED"
      )
    );
  });
}

function requestResult<T>(
  request: IDBRequest<T>,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error || migrationError(
        `${label}을 읽지 못했습니다.`,
        "ORIGIN_STORAGE_MIGRATION_READ_FAILED"
      )
    );
  });
}

function readImageAssetEntries(
  store: IDBObjectStore
): Promise<OriginStorageMigrationImageInput[]> {
  return new Promise((resolve, reject) => {
    const entries: OriginStorageMigrationImageInput[] = [];
    const request = store.openCursor();
    request.onerror = () => reject(
      request.error || migrationError(
        "이미지 에셋을 읽지 못했습니다.",
        "ORIGIN_STORAGE_MIGRATION_READ_FAILED"
      )
    );
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(entries);
        return;
      }
      const key = cursor.primaryKey ?? cursor.key;
      if (
        !Array.isArray(key)
        || key.length !== 2
        || typeof key[0] !== "string"
        || typeof key[1] !== "string"
        || !(cursor.value instanceof Blob)
      ) {
        reject(migrationError(
          "이전 이미지 에셋 스토어에 지원하지 않는 레코드가 있습니다.",
          "ORIGIN_STORAGE_MIGRATION_DATABASE_MISMATCH"
        ));
        return;
      }
      entries.push({
        key: [key[0], key[1]],
        blob: cursor.value
      });
      cursor.continue();
    };
  });
}

/**
 * Read only the three portable stores from the legacy Extension origin.
 * media-handles and short-video-caches are deliberately never opened.
 */
export async function exportCurrentOriginStorageMigration({
  factory = indexedDB,
  sourceOrigin = location.origin,
  createdAt,
  transferId
}: OriginStorageMigrationExportOptions = {}): Promise<OriginStorageMigrationEnvelope> {
  const database = await openExistingDatabase(factory);
  try {
    requiredMigrationStores(database);
    const transaction = database.transaction(
      REQUIRED_MIGRATION_STORES,
      "readonly"
    );
    const completed = transactionCompletion(transaction);
    const records = Promise.all([
      requestResult(
        transaction.objectStore(PROJECTS).getAll(),
        "프로젝트"
      ),
      requestResult(
        transaction.objectStore(LOCAL_DRAFTS).getAll(),
        "로컬 임시저장"
      ),
      readImageAssetEntries(transaction.objectStore(IMAGE_ASSETS))
    ]);
    const [[projects, localDrafts, imageAssets]] = await Promise.all([
      records,
      completed
    ]);
    return buildOriginStorageMigration({
      sourceOrigin,
      databaseName: EDITOR_DATABASE_NAME,
      databaseVersion: database.version,
      projects,
      localDrafts,
      imageAssets,
      ...(createdAt === undefined ? {} : { createdAt }),
      ...(transferId === undefined ? {} : { transferId })
    });
  } finally {
    database.close();
  }
}

/**
 * Add the portable records in one transaction. Existing target keys cause the
 * entire transaction to abort; the importer never clears or overwrites data.
 */
export async function importCurrentOriginStorageMigration(
  value: unknown,
  {
    factory = indexedDB,
    targetOrigin = location.origin,
    expectedSourceOrigin
  }: OriginStorageMigrationImportOptions = {}
): Promise<OriginStorageMigrationImportResult> {
  if (targetOrigin !== ORIGIN_STORAGE_MIGRATION_TARGET_ORIGIN) {
    throw migrationError(
      "이전 저장 데이터는 현재 Kirinuki 앱의 고정 저장 영역에서만 가져올 수 있습니다.",
      "ORIGIN_STORAGE_MIGRATION_WRONG_TARGET"
    );
  }
  const parsed = await parseOriginStorageMigration(value, {
    ...(expectedSourceOrigin === undefined ? {} : { expectedSourceOrigin }),
    expectedTargetOrigin: targetOrigin
  });
  if (parsed.envelope.source.databaseName !== EDITOR_DATABASE_NAME) {
    throw migrationError(
      "원본 IndexedDB 이름이 Kirinuki 편집 저장소와 다릅니다.",
      "ORIGIN_STORAGE_MIGRATION_DATABASE_MISMATCH"
    );
  }

  const database = await openImportDatabase(factory);
  try {
    requiredMigrationStores(database);
    const transaction = database.transaction(
      REQUIRED_MIGRATION_STORES,
      "readwrite"
    );
    const completed = transactionCompletion(transaction);
    try {
      const projectStore = transaction.objectStore(PROJECTS);
      const draftStore = transaction.objectStore(LOCAL_DRAFTS);
      const imageStore = transaction.objectStore(IMAGE_ASSETS);
      for (const project of parsed.projects) {
        projectStore.add(project);
      }
      for (const draft of parsed.localDrafts) {
        draftStore.add(draft);
      }
      for (const image of parsed.imageAssets) {
        imageStore.add(image.blob, image.key);
      }
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The transaction can already be aborting after a synchronous error.
      }
      throw error;
    }
    await completed;
    return {
      transferId: parsed.envelope.transferId,
      projectCount: parsed.projects.length,
      localDraftCount: parsed.localDrafts.length,
      imageAssetCount: parsed.imageAssets.length
    };
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "name" in error
      && error.name === "ConstraintError"
    ) {
      throw migrationError(
        "이 기기의 Kirinuki 저장소에 같은 작업이 이미 있어 아무 데이터도 덮어쓰지 않았습니다.",
        "ORIGIN_STORAGE_MIGRATION_CONFLICT"
      );
    }
    throw error;
  } finally {
    database.close();
  }
}
