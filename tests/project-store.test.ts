import assert from "node:assert/strict";
import test from "node:test";

interface ImageAssetRecord {
  id: string;
  source?: { kind: string; value: string };
}

interface ProjectRecord {
  id: string;
  name?: string;
  imageAssets?: ImageAssetRecord[];
  shortForm?: {
    imageAssets?: ImageAssetRecord[];
    videoAssets?: Array<{ id: string }>;
    sourceAudioAssets?: Array<{ id: string }>;
  };
  [key: string]: unknown;
}

interface DraftRecord {
  id: string;
  projectId: string;
  project: ProjectRecord;
  [key: string]: unknown;
}

interface ShortVideoCacheRecord {
  schema: string;
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

interface MockRequest<T = unknown> {
  result?: T;
  error?: unknown;
  transaction?: {
    objectStore(storeName: string): unknown;
  };
  onsuccess?: () => void;
  onerror?: () => void;
  onblocked?: () => void;
  onupgradeneeded?: () => void;
}

interface MockTransaction {
  mode?: string;
  error: unknown;
  oncomplete?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  abort?: () => void;
  objectStore?: (storeName: string) => unknown;
}

interface MockDatabase {
  close(): void;
  transaction(
    storeNames: string | string[],
    mode?: IDBTransactionMode
  ): MockTransaction;
  onversionchange?: () => void;
  objectStoreNames?: { contains(storeName: string): boolean };
  createObjectStore?: (
    name: string,
    options?: IDBObjectStoreParameters
  ) => unknown;
}

interface MockIndexedDb {
  open(name?: string, version?: number): MockRequest<MockDatabase>;
}

type ProjectStoreModule = typeof import("../src/editor/project-store.js");

function installIndexedDb(indexedDb: MockIndexedDb): void {
  globalThis.indexedDB = indexedDb as unknown as IDBFactory;
}

function required<T>(value: T | null | undefined): T {
  assert.ok(value !== null && value !== undefined);
  return value;
}

function freshProjectStore(label: string): Promise<ProjectStoreModule> {
  return import(
    `../src/editor/project-store.js?${label}-${Date.now()}-${Math.random()}`
  ) as Promise<ProjectStoreModule>;
}

function readableProjectDatabase(project: ProjectRecord): MockDatabase {
  return {
    close() {},
    transaction(storeName: string | string[], mode?: IDBTransactionMode) {
      assert.equal(storeName, "projects");
      assert.equal(mode, "readonly");
      const tx: MockTransaction = {
        error: null,
        objectStore() {
          return {
            get() {
              return { result: project };
            }
          };
        }
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    }
  };
}

async function waitForRequestCount(
  requests: readonly unknown[],
  expected: number
) {
  for (let attempt = 0; attempt < 20 && requests.length < expected; attempt += 1) {
    await Promise.resolve();
  }
  assert.equal(requests.length, expected);
}

function createLocalDraftDatabase({
  projects = [],
  drafts = [],
  handles = []
}: {
  projects?: ProjectRecord[];
  drafts?: DraftRecord[];
  handles?: ProjectSessionHandleRecord[];
} = {}): MockDatabase & {
  state: {
    projects: Map<string, ProjectRecord>;
    drafts: Map<string, DraftRecord>;
    handles: Map<string, unknown>;
  };
} {
  const state = {
    projects: new Map(projects.map((project) => [project.id, structuredClone(project)])),
    drafts: new Map(drafts.map((draft) => [draft.id, structuredClone(draft)])),
    handles: new Map(handles.map((handle) => [
      handle.projectId,
      structuredClone(handle.value)
    ]))
  };

  const database = {
    state,
    close() {},
    transaction(
      storeNames: string | string[],
      mode?: IDBTransactionMode
    ) {
      const requestedStores = Array.isArray(storeNames) ? storeNames : [storeNames];
      const tx: MockTransaction = {
        error: null,
        ...(mode === undefined ? {} : { mode })
      };
      let pendingRequests = 0;
      let completionQueued = false;

      const maybeComplete = () => {
        if (pendingRequests > 0 || completionQueued) {
          return;
        }
        completionQueued = true;
        queueMicrotask(() => {
          completionQueued = false;
          if (pendingRequests === 0) {
            tx.oncomplete?.();
          } else {
            maybeComplete();
          }
        });
      };
      const request = <T>(read: () => T): MockRequest<T> => {
        const result: MockRequest<T> = {};
        pendingRequests += 1;
        queueMicrotask(() => {
          try {
            result.result = structuredClone(read());
            result.onsuccess?.();
          } catch (error) {
            result.error = error;
            tx.error = error;
            result.onerror?.();
            tx.onerror?.();
          } finally {
            pendingRequests -= 1;
            maybeComplete();
          }
        });
        return result;
      };
      const projectStore = {
        put(project: ProjectRecord) {
          state.projects.set(project.id, structuredClone(project));
          return {};
        },
        get(projectId: string) {
          return request(() => state.projects.get(projectId));
        }
      };
      const draftStore = {
        put(draft: DraftRecord) {
          state.drafts.set(draft.id, structuredClone(draft));
          return {};
        },
        get(draftId: string) {
          return request(() => state.drafts.get(draftId));
        },
        delete(draftId: string) {
          state.drafts.delete(draftId);
          return {};
        },
        index(indexName: string) {
          assert.equal(indexName, "projectId");
          return {
            getAll(projectId: string) {
              return request(() => [...state.drafts.values()].filter(
                (draft) => draft.projectId === projectId
              ));
            }
          };
        }
      };
      const handleStore = {
        get(projectId: IDBValidKey) {
          return request(() => state.handles.get(String(projectId)));
        },
        put(value: unknown, projectId: IDBValidKey) {
          state.handles.set(String(projectId), structuredClone(value));
          return {};
        },
        delete(projectId: IDBValidKey) {
          state.handles.delete(String(projectId));
          return {};
        }
      };

      tx.objectStore = (storeName: string) => {
        assert(requestedStores.includes(storeName));
        if (storeName === "projects") {
          return projectStore;
        }
        if (storeName === "local-drafts") {
          return draftStore;
        }
        if (storeName === "media-handles") {
          return handleStore;
        }
        throw new Error(`Unexpected store: ${storeName}`);
      };
      queueMicrotask(maybeComplete);
      return tx;
    }
  };
  return database;
}

function useOpenedDatabase(
  database: MockDatabase,
  onOpen: (name: string | undefined, version: number | undefined) => void =
    () => undefined
) {
  installIndexedDb({
    open(name?: string, version?: number) {
      onOpen(name, version);
      const request: MockRequest<MockDatabase> = {};
      queueMicrotask(() => {
        request.result = database;
        request.onsuccess?.();
      });
      return request;
    }
  });
}

function createShortVideoCacheDatabase(initialRecords: ShortVideoCacheRecord[] = []) {
  const cacheKey = (projectId: string, assetId: string) => (
    JSON.stringify([projectId, assetId])
  );
  const caches = new Map(initialRecords.map((record) => [
    cacheKey(record.projectId, record.assetId),
    structuredClone(record)
  ]));
  const database: MockDatabase & {
    state: { caches: Map<string, ShortVideoCacheRecord> };
  } = {
    state: { caches },
    close() {},
    transaction(storeNames: string | string[], mode?: IDBTransactionMode) {
      assert.equal(storeNames, "short-video-caches");
      assert.ok(mode === "readonly" || mode === "readwrite");
      const tx: MockTransaction = {
        error: null,
        ...(mode === undefined ? {} : { mode })
      };
      let pendingRequests = 0;
      let completionQueued = false;
      const maybeComplete = () => {
        if (pendingRequests > 0 || completionQueued) {
          return;
        }
        completionQueued = true;
        queueMicrotask(() => {
          completionQueued = false;
          if (pendingRequests === 0) {
            tx.oncomplete?.();
          } else {
            maybeComplete();
          }
        });
      };
      const request = <T>(read: () => T): MockRequest<T> => {
        const result: MockRequest<T> = {};
        pendingRequests += 1;
        queueMicrotask(() => {
          try {
            result.result = structuredClone(read());
            result.onsuccess?.();
          } catch (error) {
            result.error = error;
            tx.error = error;
            result.onerror?.();
            tx.onerror?.();
          } finally {
            pendingRequests -= 1;
            maybeComplete();
          }
        });
        return result;
      };
      const recordsForProject = (projectId: string) => [...caches.values()]
        .filter((record) => record.projectId === projectId);
      const cacheStore = {
        put(record: ShortVideoCacheRecord) {
          caches.set(
            cacheKey(record.projectId, record.assetId),
            structuredClone(record)
          );
          return {};
        },
        get(key: IDBValidKey) {
          assert.ok(Array.isArray(key));
          return request(() => caches.get(cacheKey(String(key[0]), String(key[1]))));
        },
        delete(key: IDBValidKey) {
          assert.ok(Array.isArray(key));
          caches.delete(cacheKey(String(key[0]), String(key[1])));
          return {};
        },
        index(indexName: string) {
          assert.equal(indexName, "projectId");
          return {
            getAll(projectId: string) {
              return request(() => recordsForProject(projectId));
            },
            getAllKeys(projectId: string) {
              return request(() => recordsForProject(projectId).map(
                (record) => [record.projectId, record.assetId]
              ));
            }
          };
        }
      };
      tx.objectStore = (storeName: string) => {
        assert.equal(storeName, "short-video-caches");
        return cacheStore;
      };
      queueMicrotask(maybeComplete);
      return tx;
    }
  };
  return database;
}

interface ProjectSessionImageRecord {
  projectId: string;
  assetId: string;
  value: unknown;
}

interface ProjectSessionHandleRecord {
  projectId: string;
  value: unknown;
}

interface ProjectSessionDeletionState {
  projects: Map<string, ProjectRecord>;
  drafts: Map<string, DraftRecord>;
  images: Map<string, { key: [string, string]; value: unknown }>;
  caches: Map<string, ShortVideoCacheRecord>;
  handles: Map<string, unknown>;
  checkpoints: Map<string, unknown>;
}

function compoundKey(projectId: string, assetId: string): string {
  return JSON.stringify([projectId, assetId]);
}

function sessionCache(
  projectId: string,
  assetId: string
): ShortVideoCacheRecord {
  const blob = new Blob([`${projectId}:${assetId}`], { type: "video/mp4" });
  return {
    schema: "chzzk-kirinuki-short-video-cache/v1",
    projectId,
    assetId,
    blob,
    sourceStartMs: 1_000,
    sourceEndMs: 3_000,
    sourceFingerprint: `${projectId}-source`,
    mimeType: blob.type,
    sizeBytes: blob.size,
    createdAt: "2026-08-12T00:00:00.000Z"
  };
}

function sessionDraft(
  projectId: string,
  id: string,
  projectName: string,
  reason: "manual" | "auto" | "pre-restore" = "manual"
): DraftRecord {
  return {
    schema: "chzzk-kirinuki-local-draft/v1",
    id,
    projectId,
    createdAt: "2026-08-12T00:00:00.000Z",
    createdAtMs: Date.parse("2026-08-12T00:00:00.000Z"),
    reason,
    restoredFromDraftId: null,
    project: { id: projectId, name: projectName }
  };
}

function createProjectSessionDeletionDatabase({
  projects = [],
  drafts = [],
  images = [],
  caches = [],
  handles = [],
  checkpoints = [],
  failAtDelete = null
}: {
  projects?: ProjectRecord[];
  drafts?: DraftRecord[];
  images?: ProjectSessionImageRecord[];
  caches?: ShortVideoCacheRecord[];
  handles?: ProjectSessionHandleRecord[];
  checkpoints?: Array<{ projectId: string; value: unknown }>;
  failAtDelete?: number | null;
} = {}): MockDatabase & {
  state: ProjectSessionDeletionState;
  readonly attemptedDeleteCount: number;
} {
  const state: ProjectSessionDeletionState = {
    projects: new Map(projects.map((project) => [
      project.id,
      structuredClone(project)
    ])),
    drafts: new Map(drafts.map((draft) => [
      draft.id,
      structuredClone(draft)
    ])),
    images: new Map(images.map((image) => [
      compoundKey(image.projectId, image.assetId),
      {
        key: [image.projectId, image.assetId],
        value: structuredClone(image.value)
      }
    ])),
    caches: new Map(caches.map((cache) => [
      compoundKey(cache.projectId, cache.assetId),
      structuredClone(cache)
    ])),
    handles: new Map(handles.map((handle) => [
      handle.projectId,
      structuredClone(handle.value)
    ])),
    checkpoints: new Map(checkpoints.map((checkpoint) => [
      checkpoint.projectId,
      structuredClone(checkpoint.value)
    ]))
  };
  let attemptedDeleteCount = 0;

  const replaceMap = <K, V>(target: Map<K, V>, source: Map<K, V>): void => {
    target.clear();
    for (const [key, value] of source) {
      target.set(key, value);
    }
  };

  const database: MockDatabase & {
    state: ProjectSessionDeletionState;
    readonly attemptedDeleteCount: number;
  } = {
    state,
    get attemptedDeleteCount() {
      return attemptedDeleteCount;
    },
    close() {},
    transaction(storeNames: string | string[], mode?: IDBTransactionMode) {
      assert.deepEqual(storeNames, [
        "projects",
        "local-drafts",
        "image-assets",
        "short-video-caches",
        "media-handles",
        "editing-session-checkpoints"
      ]);
      assert.equal(mode, "readwrite");
      const requestedStores = new Set(storeNames as string[]);
      const staged = structuredClone(state) as ProjectSessionDeletionState;
      let activeCursors = 0;
      let completionQueued = false;
      let aborted = false;
      const tx: MockTransaction = {
        error: null,
        ...(mode === undefined ? {} : { mode })
      };

      const abort = (error: unknown): void => {
        if (aborted) {
          return;
        }
        aborted = true;
        tx.error = error;
        queueMicrotask(() => tx.onabort?.());
      };
      tx.abort = () => abort(new Error("mock transaction aborted"));

      const maybeComplete = (): void => {
        if (aborted || activeCursors > 0 || completionQueued) {
          return;
        }
        completionQueued = true;
        queueMicrotask(() => {
          completionQueued = false;
          if (aborted || activeCursors > 0) {
            return;
          }
          replaceMap(state.projects, staged.projects);
          replaceMap(state.drafts, staged.drafts);
          replaceMap(state.images, staged.images);
          replaceMap(state.caches, staged.caches);
          replaceMap(state.handles, staged.handles);
          replaceMap(state.checkpoints, staged.checkpoints);
          tx.oncomplete?.();
        });
      };

      const deleteStaged = (
        map: Map<string, unknown>,
        serializedKey: string
      ): void => {
        attemptedDeleteCount += 1;
        if (attemptedDeleteCount === failAtDelete) {
          throw new Error(`injected delete failure ${attemptedDeleteCount}`);
        }
        map.delete(serializedKey);
      };

      const openCursor = (
        entries: Array<{
          key: IDBValidKey;
          primaryKey: IDBValidKey;
          deleteRecord: () => void;
        }>
      ): MockRequest<IDBCursor | null> => {
        const request: MockRequest<IDBCursor | null> = {};
        let index = 0;
        activeCursors += 1;
        const dispatch = (): void => {
          queueMicrotask(() => {
            if (aborted) {
              return;
            }
            if (index >= entries.length) {
              request.result = null;
              try {
                request.onsuccess?.();
              } catch (error) {
                abort(error);
                return;
              }
              activeCursors -= 1;
              maybeComplete();
              return;
            }
            const entry = required(entries[index]);
            request.result = {
              key: entry.key,
              primaryKey: entry.primaryKey,
              delete() {
                entry.deleteRecord();
                return {} as IDBRequest<undefined>;
              },
              continue() {
                index += 1;
                dispatch();
              }
            } as IDBCursor;
            try {
              request.onsuccess?.();
            } catch (error) {
              abort(error);
            }
          });
        };
        dispatch();
        return request;
      };

      const allKeysRequest = (
        keys: IDBValidKey[]
      ): MockRequest<IDBValidKey[]> => {
        const request: MockRequest<IDBValidKey[]> = {};
        activeCursors += 1;
        queueMicrotask(() => {
          if (aborted) {
            return;
          }
          request.result = structuredClone(keys);
          try {
            request.onsuccess?.();
          } catch (error) {
            abort(error);
            return;
          }
          activeCursors -= 1;
          maybeComplete();
        });
        return request;
      };

      const projectStore = {
        getAllKeys(query?: IDBValidKey) {
          return allKeysRequest(
            [...staged.projects.keys()].filter(
              (projectId) => query === undefined || projectId === query
            )
          );
        },
        delete(projectId: IDBValidKey) {
          deleteStaged(staged.projects as Map<string, unknown>, String(projectId));
        },
        openKeyCursor(query?: IDBValidKey) {
          return openCursor(
            [...staged.projects.keys()]
              .filter((projectId) => query === undefined || projectId === query)
              .map((projectId) => ({
                key: projectId,
                primaryKey: projectId,
                deleteRecord: () => deleteStaged(
                  staged.projects as Map<string, unknown>,
                  projectId
                )
              }))
          );
        }
      };
      const handleStore = {
        getAllKeys(query?: IDBValidKey) {
          return allKeysRequest(
            [...staged.handles.keys()].filter(
              (projectId) => query === undefined || projectId === query
            )
          );
        },
        delete(projectId: IDBValidKey) {
          deleteStaged(staged.handles, String(projectId));
        },
        openKeyCursor(query?: IDBValidKey) {
          return openCursor(
            [...staged.handles.keys()]
              .filter((projectId) => query === undefined || projectId === query)
              .map((projectId) => ({
                key: projectId,
                primaryKey: projectId,
                deleteRecord: () => deleteStaged(staged.handles, projectId)
              }))
          );
        }
      };
      const checkpointStore = {
        getAllKeys(query?: IDBValidKey) {
          return allKeysRequest(
            [...staged.checkpoints.keys()].filter(
              (projectId) => query === undefined || projectId === query
            )
          );
        },
        delete(projectId: IDBValidKey) {
          deleteStaged(staged.checkpoints, String(projectId));
        },
        openKeyCursor(query?: IDBValidKey) {
          return openCursor(
            [...staged.checkpoints.keys()]
              .filter((projectId) => query === undefined || projectId === query)
              .map((projectId) => ({
                key: projectId,
                primaryKey: projectId,
                deleteRecord: () => deleteStaged(
                  staged.checkpoints,
                  projectId
                )
              }))
          );
        }
      };
      const draftStore = {
        index(indexName: string) {
          assert.equal(indexName, "projectId");
          return {
            getAllKeys(projectId: IDBValidKey) {
              return allKeysRequest(
                [...staged.drafts.values()]
                  .filter((draft) => draft.projectId === projectId)
                  .map((draft) => draft.id)
              );
            },
            openKeyCursor(projectId: IDBValidKey) {
              return openCursor(
                [...staged.drafts.values()]
                  .filter((draft) => draft.projectId === projectId)
                  .map((draft) => ({
                    key: draft.projectId,
                    primaryKey: draft.id,
                    deleteRecord: () => deleteStaged(
                      staged.drafts as Map<string, unknown>,
                      draft.id
                    )
                  }))
              );
            }
          };
        },
        delete(draftId: IDBValidKey) {
          deleteStaged(staged.drafts as Map<string, unknown>, String(draftId));
        }
      };
      const imageStore = {
        getAllKeys() {
          return allKeysRequest(
            [...staged.images.values()].map((image) => image.key)
          );
        },
        delete(key: IDBValidKey) {
          assert.equal(Array.isArray(key), true);
          deleteStaged(
            staged.images as Map<string, unknown>,
            compoundKey(String((key as IDBValidKey[])[0]), String((key as IDBValidKey[])[1]))
          );
        },
        openKeyCursor() {
          return openCursor([...staged.images.entries()].map(([
            serializedKey,
            image
          ]) => ({
            key: image.key,
            primaryKey: image.key,
            deleteRecord: () => deleteStaged(
              staged.images as Map<string, unknown>,
              serializedKey
            )
          })));
        }
      };
      const cacheStore = {
        index(indexName: string) {
          assert.equal(indexName, "projectId");
          return {
            getAllKeys(projectId: IDBValidKey) {
              return allKeysRequest(
                [...staged.caches.values()]
                  .filter((cache) => cache.projectId === projectId)
                  .map((cache) => [cache.projectId, cache.assetId])
              );
            },
            openKeyCursor(projectId: IDBValidKey) {
              return openCursor(
                [...staged.caches.entries()]
                  .filter(([, cache]) => cache.projectId === projectId)
                  .map(([serializedKey, cache]) => ({
                    key: cache.projectId,
                    primaryKey: [cache.projectId, cache.assetId],
                    deleteRecord: () => deleteStaged(
                      staged.caches as Map<string, unknown>,
                      serializedKey
                    )
                  }))
              );
            }
          };
        },
        delete(key: IDBValidKey) {
          assert.equal(Array.isArray(key), true);
          deleteStaged(
            staged.caches as Map<string, unknown>,
            compoundKey(String((key as IDBValidKey[])[0]), String((key as IDBValidKey[])[1]))
          );
        }
      };

      tx.objectStore = (storeName: string) => {
        assert.equal(requestedStores.has(storeName), true);
        if (storeName === "projects") {
          return projectStore;
        }
        if (storeName === "local-drafts") {
          return draftStore;
        }
        if (storeName === "image-assets") {
          return imageStore;
        }
        if (storeName === "short-video-caches") {
          return cacheStore;
        }
        if (storeName === "media-handles") {
          return handleStore;
        }
        if (storeName === "editing-session-checkpoints") {
          return checkpointStore;
        }
        throw new Error(`Unexpected store: ${storeName}`);
      };
      queueMicrotask(maybeComplete);
      return tx;
    }
  };
  return database;
}

function createEditingSessionCheckpointDatabase({
  projects = [],
  drafts = [],
  images = [],
  caches = [],
  handles = [],
  checkpoints = []
}: {
  projects?: ProjectRecord[];
  drafts?: DraftRecord[];
  images?: ProjectSessionImageRecord[];
  caches?: ShortVideoCacheRecord[];
  handles?: ProjectSessionHandleRecord[];
  checkpoints?: unknown[];
} = {}): MockDatabase & {
  state: ProjectSessionDeletionState;
  failMutationLabel: string | null;
  checkpointGetAllCount: number;
  checkpointGetAllKeysCount: number;
} {
  const state: ProjectSessionDeletionState = {
    projects: new Map(projects.map((project) => [
      project.id,
      structuredClone(project)
    ])),
    drafts: new Map(drafts.map((draft) => [
      draft.id,
      structuredClone(draft)
    ])),
    images: new Map(images.map((image) => [
      compoundKey(image.projectId, image.assetId),
      {
        key: [image.projectId, image.assetId],
        value: structuredClone(image.value)
      }
    ])),
    caches: new Map(caches.map((cache) => [
      compoundKey(cache.projectId, cache.assetId),
      structuredClone(cache)
    ])),
    handles: new Map(handles.map((handle) => [
      handle.projectId,
      structuredClone(handle.value)
    ])),
    checkpoints: new Map(checkpoints.map((checkpoint) => {
      const record = checkpoint as { projectId: string };
      return [record.projectId, structuredClone(checkpoint)];
    }))
  };

  const replaceMap = <K, V>(target: Map<K, V>, source: Map<K, V>): void => {
    target.clear();
    for (const [key, value] of source) {
      target.set(key, value);
    }
  };

  const database: MockDatabase & {
    state: ProjectSessionDeletionState;
    failMutationLabel: string | null;
    checkpointGetAllCount: number;
    checkpointGetAllKeysCount: number;
  } = {
    state,
    failMutationLabel: null,
    checkpointGetAllCount: 0,
    checkpointGetAllKeysCount: 0,
    close() {},
    transaction(storeNames: string | string[], mode?: IDBTransactionMode) {
      const requestedStores = new Set(
        Array.isArray(storeNames) ? storeNames : [storeNames]
      );
      const staged = structuredClone(state) as ProjectSessionDeletionState;
      let pendingRequests = 0;
      let completionQueued = false;
      let aborted = false;
      const tx: MockTransaction = {
        error: null,
        ...(mode === undefined ? {} : { mode })
      };

      const abort = (error: unknown): void => {
        if (aborted) {
          return;
        }
        aborted = true;
        tx.error = error;
        queueMicrotask(() => tx.onabort?.());
      };
      tx.abort = () => abort(new Error("mock checkpoint transaction aborted"));

      const maybeComplete = (): void => {
        if (aborted || pendingRequests > 0 || completionQueued) {
          return;
        }
        completionQueued = true;
        queueMicrotask(() => {
          completionQueued = false;
          if (aborted || pendingRequests > 0) {
            return;
          }
          replaceMap(state.projects, staged.projects);
          replaceMap(state.drafts, staged.drafts);
          replaceMap(state.images, staged.images);
          replaceMap(state.caches, staged.caches);
          replaceMap(state.handles, staged.handles);
          replaceMap(state.checkpoints, staged.checkpoints);
          tx.oncomplete?.();
        });
      };

      const request = <T>(read: () => T): MockRequest<T> => {
        const result: MockRequest<T> = {};
        pendingRequests += 1;
        queueMicrotask(() => {
          if (aborted) {
            pendingRequests -= 1;
            return;
          }
          try {
            result.result = structuredClone(read());
            result.onsuccess?.();
          } catch (error) {
            result.error = error;
            abort(error);
          } finally {
            pendingRequests -= 1;
            maybeComplete();
          }
        });
        return result;
      };

      const mutate = (label: string, operation: () => void): object => {
        if (database.failMutationLabel === label) {
          throw new Error(`injected checkpoint mutation failure: ${label}`);
        }
        operation();
        return {};
      };

      const projectStore = {
        get(projectId: IDBValidKey) {
          return request(() => staged.projects.get(String(projectId)));
        },
        getAll() {
          return request(() => [...staged.projects.values()]);
        },
        getAllKeys(query?: IDBValidKey) {
          return request(() => [...staged.projects.keys()].filter(
            (key) => query === undefined || key === query
          ));
        },
        put(project: ProjectRecord) {
          return mutate("project-put", () => {
            staged.projects.set(project.id, structuredClone(project));
          });
        },
        delete(projectId: IDBValidKey) {
          return mutate("project-delete", () => {
            staged.projects.delete(String(projectId));
          });
        },
        count() {
          const count = staged.projects.size;
          return request(() => count);
        },
        clear() {
          return mutate("project-clear", () => staged.projects.clear());
        }
      };

      const draftStore = {
        getAll() {
          return request(() => [...staged.drafts.values()]);
        },
        getAllKeys() {
          return request(() => [...staged.drafts.keys()]);
        },
        put(draft: DraftRecord) {
          return mutate("draft-put", () => {
            staged.drafts.set(draft.id, structuredClone(draft));
          });
        },
        delete(draftId: IDBValidKey) {
          return mutate("draft-delete", () => {
            staged.drafts.delete(String(draftId));
          });
        },
        count() {
          const count = staged.drafts.size;
          return request(() => count);
        },
        clear() {
          return mutate("draft-clear", () => staged.drafts.clear());
        },
        index(indexName: string) {
          assert.equal(indexName, "projectId");
          return {
            getAll(projectId: IDBValidKey) {
              return request(() => [...staged.drafts.values()].filter(
                (draft) => draft.projectId === projectId
              ));
            },
            getAllKeys(projectId: IDBValidKey) {
              return request(() => [...staged.drafts.values()]
                .filter((draft) => draft.projectId === projectId)
                .map((draft) => draft.id));
            }
          };
        }
      };

      const imageStore = {
        getAll() {
          return request(() => [...staged.images.values()].map(
            (entry) => entry.value
          ));
        },
        getAllKeys() {
          return request(() => [...staged.images.values()].map(
            (entry) => entry.key
          ));
        },
        put(value: unknown, key: IDBValidKey) {
          return mutate("image-put", () => {
            assert.equal(Array.isArray(key), true);
            const parts = key as IDBValidKey[];
            const normalizedKey: [string, string] = [
              String(parts[0]),
              String(parts[1])
            ];
            staged.images.set(
              compoundKey(...normalizedKey),
              { key: normalizedKey, value: structuredClone(value) }
            );
          });
        },
        delete(key: IDBValidKey) {
          return mutate("image-delete", () => {
            assert.equal(Array.isArray(key), true);
            const parts = key as IDBValidKey[];
            staged.images.delete(compoundKey(
              String(parts[0]),
              String(parts[1])
            ));
          });
        },
        count() {
          const count = staged.images.size;
          return request(() => count);
        },
        clear() {
          return mutate("image-clear", () => staged.images.clear());
        }
      };

      const cacheStore = {
        getAll() {
          return request(() => [...staged.caches.values()]);
        },
        getAllKeys() {
          return request(() => [...staged.caches.values()].map(
            (cache) => [cache.projectId, cache.assetId]
          ));
        },
        put(cache: ShortVideoCacheRecord) {
          return mutate("cache-put", () => {
            staged.caches.set(
              compoundKey(cache.projectId, cache.assetId),
              structuredClone(cache)
            );
          });
        },
        delete(key: IDBValidKey) {
          return mutate("cache-delete", () => {
            assert.equal(Array.isArray(key), true);
            const parts = key as IDBValidKey[];
            staged.caches.delete(compoundKey(
              String(parts[0]),
              String(parts[1])
            ));
          });
        },
        count() {
          const count = staged.caches.size;
          return request(() => count);
        },
        clear() {
          return mutate("cache-clear", () => staged.caches.clear());
        },
        index(indexName: string) {
          assert.equal(indexName, "projectId");
          return {
            getAll(projectId: IDBValidKey) {
              return request(() => [...staged.caches.values()].filter(
                (cache) => cache.projectId === projectId
              ));
            },
            getAllKeys(projectId: IDBValidKey) {
              return request(() => [...staged.caches.values()]
                .filter((cache) => cache.projectId === projectId)
                .map((cache) => [cache.projectId, cache.assetId]));
            }
          };
        }
      };

      const handleStore = {
        get(projectId: IDBValidKey) {
          return request(() => staged.handles.get(String(projectId)));
        },
        getAllKeys(query?: IDBValidKey) {
          return request(() => [...staged.handles.keys()].filter(
            (key) => query === undefined || key === query
          ));
        },
        put(value: unknown, projectId: IDBValidKey) {
          return mutate("handle-put", () => {
            staged.handles.set(String(projectId), structuredClone(value));
          });
        },
        delete(projectId: IDBValidKey) {
          return mutate("handle-delete", () => {
            staged.handles.delete(String(projectId));
          });
        },
        count() {
          const count = staged.handles.size;
          return request(() => count);
        },
        clear() {
          return mutate("handle-clear", () => staged.handles.clear());
        }
      };

      const checkpointStore = {
        get(projectId: IDBValidKey) {
          return request(() => staged.checkpoints.get(String(projectId)));
        },
        getAll() {
          database.checkpointGetAllCount += 1;
          return request(() => [...staged.checkpoints.values()]);
        },
        getAllKeys(query?: IDBValidKey) {
          database.checkpointGetAllKeysCount += 1;
          return request(() => [...staged.checkpoints.keys()].filter(
            (key) => query === undefined || key === query
          ));
        },
        add(checkpoint: { projectId: string }) {
          return mutate("checkpoint-add", () => {
            if (staged.checkpoints.has(checkpoint.projectId)) {
              throw new Error("checkpoint already exists");
            }
            staged.checkpoints.set(
              checkpoint.projectId,
              structuredClone(checkpoint)
            );
          });
        },
        put(checkpoint: { projectId: string }) {
          return mutate("checkpoint-put", () => {
            staged.checkpoints.set(
              checkpoint.projectId,
              structuredClone(checkpoint)
            );
          });
        },
        delete(projectId: IDBValidKey) {
          return mutate("checkpoint-delete", () => {
            staged.checkpoints.delete(String(projectId));
          });
        },
        count() {
          const count = staged.checkpoints.size;
          return request(() => count);
        },
        clear() {
          return mutate("checkpoint-clear", () => staged.checkpoints.clear());
        }
      };

      tx.objectStore = (storeName: string) => {
        assert.equal(requestedStores.has(storeName), true);
        if (storeName === "projects") return projectStore;
        if (storeName === "local-drafts") return draftStore;
        if (storeName === "image-assets") return imageStore;
        if (storeName === "short-video-caches") return cacheStore;
        if (storeName === "media-handles") return handleStore;
        if (storeName === "editing-session-checkpoints") return checkpointStore;
        throw new Error(`Unexpected store: ${storeName}`);
      };
      queueMicrotask(maybeComplete);
      return tx;
    }
  };
  return database;
}

test("IndexedDB v5 업그레이드는 체크포인트를 포함한 현재 저장소를 보존·생성한다", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const requests: Array<MockRequest<MockDatabase>> = [];
  const createdStores: Array<{
    name: string;
    options?: IDBObjectStoreParameters;
  }> = [];
  const createdIndexes: Array<{
    storeName: string;
    name: string;
    keyPath: string | string[];
    options?: IDBIndexParameters;
  }> = [];
  const existingStores = new Set(["projects", "media-handles", "image-assets"]);
  const indexedStore = (storeName: string) => ({
    indexNames: {
      contains(indexName: string) {
        return createdIndexes.some((entry) => (
          entry.storeName === storeName && entry.name === indexName
        ));
      }
    },
    createIndex(
      name: string,
      keyPath: string | string[],
      options?: IDBIndexParameters
    ) {
      createdIndexes.push({
        storeName,
        name,
        keyPath,
        ...(options === undefined ? {} : { options })
      });
      return {};
    }
  });
  const localDraftStore = indexedStore("local-drafts");
  const shortVideoCacheStore = indexedStore("short-video-caches");
  const database = readableProjectDatabase({ id: "project", name: "업그레이드됨" });
  database.objectStoreNames = {
    contains(storeName) {
      return existingStores.has(storeName);
    }
  };
  database.createObjectStore = (name, options) => {
    createdStores.push({
      name,
      ...(options === undefined ? {} : { options })
    });
    existingStores.add(name);
    if (name === "local-drafts") {
      return localDraftStore;
    }
    if (name === "short-video-caches") {
      return shortVideoCacheStore;
    }
    return {};
  };
  installIndexedDb({
    open(name?: string, version?: number) {
      assert.equal(name, "chzzk-kirinuki-studio");
      assert.equal(version, 5);
      const request: MockRequest<MockDatabase> = {};
      requests.push(request);
      return request;
    }
  });

  try {
    const store = await freshProjectStore("v4-upgrade");
    const loadPromise = store.loadProject("project");
    const request = required(requests[0]);
    request.result = database;
    request.transaction = {
      objectStore(storeName: string) {
        assert.equal(storeName, "local-drafts");
        return localDraftStore;
      }
    };
    required(request.onupgradeneeded)();
    required(request.onsuccess)();

    assert.deepEqual(await loadPromise, { id: "project", name: "업그레이드됨" });
    assert.deepEqual(createdStores, [
      {
        name: "local-drafts",
        options: { keyPath: "id" }
      },
      {
        name: "short-video-caches",
        options: { keyPath: ["projectId", "assetId"] }
      },
      {
        name: "editing-session-checkpoints",
        options: { keyPath: "projectId" }
      }
    ]);
    assert.deepEqual(createdIndexes, [
      {
        storeName: "local-drafts",
        name: "projectId",
        keyPath: "projectId",
        options: { unique: false }
      },
      {
        storeName: "short-video-caches",
        name: "projectId",
        keyPath: "projectId",
        options: { unique: false }
      }
    ]);
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("편집 세션 진입은 전체 project 범위를 durable baseline으로 잡고 같은 세션만 멱등 재진입한다", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const targetImage = new Blob(["baseline-image"], { type: "image/png" });
  const database = createEditingSessionCheckpointDatabase({
    projects: [
      { id: "target", name: "baseline project" },
      { id: "other", name: "other project" }
    ],
    drafts: [
      sessionDraft("target", "target-draft", "baseline project"),
      sessionDraft("other", "other-draft", "other project")
    ],
    images: [
      { projectId: "target", assetId: "image", value: targetImage },
      { projectId: "other", assetId: "image", value: new Blob(["other"]) }
    ],
    caches: [sessionCache("target", "video"), sessionCache("other", "video")],
    handles: [
      { projectId: "target", value: { name: "baseline.mp4" } },
      { projectId: "other", value: { name: "other.mp4" } }
    ]
  });
  useOpenedDatabase(database);

  try {
    const store = await freshProjectStore("editing-checkpoint-begin");
    const checkpoint = await store.beginEditingSessionCheckpoint(
      "target",
      "editor-session:first",
      { now: "2026-08-14T01:02:03.000Z" }
    );
    assert.equal(checkpoint.projectId, "target");
    assert.equal(checkpoint.sessionId, "editor-session:first");
    assert.equal(checkpoint.createdAt, "2026-08-14T01:02:03.000Z");
    assert.equal(checkpoint.baseline.project?.name, "baseline project");
    assert.deepEqual(
      checkpoint.baseline.localDrafts.map((draft) => draft.id),
      ["target-draft"]
    );
    assert.deepEqual(
      checkpoint.baseline.imageAssets.map((image) => image.key),
      [["target", "image"]]
    );
    assert.equal(checkpoint.baseline.imageAssets[0]?.blob.type, "image/png");
    assert.deepEqual(
      checkpoint.baseline.shortVideoCaches.map((cache) => cache.assetId),
      ["video"]
    );
    assert.deepEqual(checkpoint.baseline.mediaHandle, {
      present: true,
      handle: { name: "baseline.mp4" }
    });

    assert.deepEqual(
      await store.listEditingSessionCheckpointProjectIds(),
      ["target"]
    );
    assert.equal(database.checkpointGetAllKeysCount, 1);
    assert.equal(database.checkpointGetAllCount, 0);

    checkpoint.baseline.project!.name = "caller mutation";
    const [storedCheckpoint] = await store.listEditingSessionCheckpoints();
    assert.equal(storedCheckpoint?.baseline.project?.name, "baseline project");
    assert.equal(database.checkpointGetAllCount, 1);

    const reentered = await store.beginEditingSessionCheckpoint(
      "target",
      "editor-session:first",
      { now: "2030-01-01T00:00:00.000Z" }
    );
    assert.equal(reentered.createdAt, "2026-08-14T01:02:03.000Z");
    assert.equal(reentered.baseline.project?.name, "baseline project");

    await assert.rejects(
      store.beginEditingSessionCheckpoint(
        "target",
        "editor-session:other"
      ),
      /다른 편집 세션의 미완료 체크포인트/u
    );
    assert.equal(database.state.checkpoints.size, 1);
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("기존 프로젝트 discard는 현재 project 범위를 지우고 baseline 전체를 원자 복원한다", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const baselineImage = new Blob(["baseline"], { type: "image/png" });
  const baselineCache = sessionCache("target", "baseline-video");
  const database = createEditingSessionCheckpointDatabase({
    projects: [
      { id: "target", name: "baseline" },
      { id: "other", name: "preserved" }
    ],
    drafts: [
      sessionDraft("target", "baseline-draft", "baseline"),
      sessionDraft("other", "other-draft", "preserved")
    ],
    images: [
      { projectId: "target", assetId: "baseline-image", value: baselineImage },
      { projectId: "other", assetId: "other-image", value: new Blob(["other"]) }
    ],
    caches: [baselineCache, sessionCache("other", "other-video")],
    handles: [
      { projectId: "target", value: { name: "baseline.mp4" } },
      { projectId: "other", value: { name: "other.mp4" } }
    ]
  });
  useOpenedDatabase(database);

  try {
    const store = await freshProjectStore("editing-checkpoint-discard-existing");
    await store.beginEditingSessionCheckpoint("target", "editor-session:discard");

    database.state.projects.set("target", { id: "target", name: "changed" });
    database.state.drafts.delete("baseline-draft");
    database.state.drafts.set(
      "changed-draft",
      sessionDraft("target", "changed-draft", "changed", "auto")
    );
    database.state.images.delete(compoundKey("target", "baseline-image"));
    database.state.images.set(compoundKey("target", "changed-image"), {
      key: ["target", "changed-image"],
      value: new Blob(["changed"], { type: "image/png" })
    });
    database.state.caches.delete(compoundKey("target", "baseline-video"));
    database.state.caches.set(
      compoundKey("target", "changed-video"),
      sessionCache("target", "changed-video")
    );
    database.state.handles.set("target", { name: "changed.mp4" });

    assert.equal(
      await store.discardEditingSessionCheckpoint(
        "target",
        "editor-session:discard"
      ),
      true
    );
    assert.equal(database.state.projects.get("target")?.name, "baseline");
    assert.deepEqual(
      [...database.state.drafts.keys()].sort(),
      ["baseline-draft", "other-draft"]
    );
    assert.deepEqual(
      [...database.state.images.keys()].sort(),
      [
        compoundKey("other", "other-image"),
        compoundKey("target", "baseline-image")
      ].sort()
    );
    assert.deepEqual(
      [...database.state.caches.keys()].sort(),
      [
        compoundKey("other", "other-video"),
        compoundKey("target", "baseline-video")
      ].sort()
    );
    assert.deepEqual(database.state.handles.get("target"), {
      name: "baseline.mp4"
    });
    assert.equal(database.state.projects.get("other")?.name, "preserved");
    assert.equal(database.state.checkpoints.size, 0);
    assert.equal(
      await store.discardEditingSessionCheckpoint(
        "target",
        "editor-session:discard"
      ),
      false
    );
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("새 프로젝트 discard와 abandoned discard는 baseline null 범위를 완전히 지운다", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const database = createEditingSessionCheckpointDatabase({
    projects: [{ id: "other", name: "preserved" }]
  });
  useOpenedDatabase(database);

  try {
    const store = await freshProjectStore("editing-checkpoint-discard-new");
    const checkpoint = await store.beginEditingSessionCheckpoint(
      "new-project",
      "editor-session:new"
    );
    assert.equal(checkpoint.baseline.project, null);

    database.state.projects.set("new-project", {
      id: "new-project",
      name: "temporary"
    });
    database.state.drafts.set(
      "new-draft",
      sessionDraft("new-project", "new-draft", "temporary", "auto")
    );
    database.state.images.set(compoundKey("new-project", "image"), {
      key: ["new-project", "image"],
      value: new Blob(["temporary"], { type: "image/png" })
    });
    database.state.caches.set(
      compoundKey("new-project", "video"),
      sessionCache("new-project", "video")
    );
    database.state.handles.set("new-project", { name: "temporary.mp4" });

    assert.equal(
      await store.discardAbandonedEditingSessionCheckpoint("new-project"),
      true
    );
    assert.equal(database.state.projects.has("new-project"), false);
    assert.equal(database.state.drafts.has("new-draft"), false);
    assert.equal(
      database.state.images.has(compoundKey("new-project", "image")),
      false
    );
    assert.equal(
      database.state.caches.has(compoundKey("new-project", "video")),
      false
    );
    assert.equal(database.state.handles.has("new-project"), false);
    assert.equal(database.state.checkpoints.size, 0);
    assert.equal(database.state.projects.get("other")?.name, "preserved");
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("A 핸들 수동저장 뒤 B 핸들만 연결하고 닫아도 A 저장본과 A 핸들만 원자 보존한다", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const database = createEditingSessionCheckpointDatabase({
    projects: [{ id: "other", name: "preserved" }]
  });
  useOpenedDatabase(database);

  try {
    const store = await freshProjectStore("editing-checkpoint-manual-draft");
    await store.beginEditingSessionCheckpoint(
      "explicit-project",
      "editor-session:manual"
    );
    database.state.handles.set(
      "explicit-project",
      { name: "source-A.mp4" }
    );
    const explicitDraft = await store.saveLocalDraft({
      id: "explicit-project",
      name: "explicitly saved",
      mediaAsset: {
        name: "source-A.mp4",
        fileHandleStored: true
      },
      imageAssets: [{
        id: "manual-image",
        source: { kind: "blob-key", value: "manual-image" }
      }],
      shortForm: {
        videoAssets: [{ id: "manual-video" }]
      }
    }, {
      reason: "manual",
      id: "manual-draft",
      now: "2026-08-14T02:00:00.000Z"
    });
    assert.deepEqual(explicitDraft.mediaHandleBinding, {
      kind: "file-system-file-handle",
      handle: { name: "source-A.mp4" }
    });
    database.state.projects.set(
      "explicit-project",
      {
        id: "explicit-project",
        name: "unsaved current B",
        mediaAsset: {
          name: "source-B.mp4",
          fileHandleStored: true
        }
      }
    );
    database.state.handles.set(
      "explicit-project",
      { name: "source-B.mp4" }
    );
    database.state.drafts.set(
      "auto-draft",
      sessionDraft(
        "explicit-project",
        "auto-draft",
        "automatic only",
        "auto"
      )
    );
    database.state.images.set(compoundKey("explicit-project", "manual-image"), {
      key: ["explicit-project", "manual-image"],
      value: new Blob(["manual"], { type: "image/png" })
    });
    database.state.images.set(compoundKey("explicit-project", "orphan-image"), {
      key: ["explicit-project", "orphan-image"],
      value: new Blob(["orphan"], { type: "image/png" })
    });
    database.state.caches.set(
      compoundKey("explicit-project", "manual-video"),
      sessionCache("explicit-project", "manual-video")
    );
    database.state.caches.set(
      compoundKey("explicit-project", "orphan-video"),
      sessionCache("explicit-project", "orphan-video")
    );
    assert.equal(
      await store.discardAbandonedEditingSessionCheckpoint("explicit-project"),
      true
    );
    assert.equal(
      database.state.projects.get("explicit-project")?.name,
      "explicitly saved"
    );
    assert.deepEqual(
      [...database.state.drafts.keys()].sort(),
      ["manual-draft"].sort()
    );
    assert.deepEqual(
      [...database.state.images.keys()],
      [compoundKey("explicit-project", "manual-image")]
    );
    assert.deepEqual(
      [...database.state.caches.keys()],
      [compoundKey("explicit-project", "manual-video")]
    );
    assert.deepEqual(
      database.state.handles.get("explicit-project"),
      { name: "source-A.mp4" }
    );
    assert.equal(database.state.checkpoints.size, 0);
    assert.equal(database.state.projects.get("other")?.name, "preserved");
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("원격 VOD 수동저장은 남아 있던 로컬 핸들을 결합하거나 되살리지 않는다", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const database = createEditingSessionCheckpointDatabase();
  useOpenedDatabase(database);

  try {
    const store = await freshProjectStore("editing-checkpoint-remote-manual");
    await store.beginEditingSessionCheckpoint(
      "remote-project",
      "editor-session:remote-manual"
    );
    database.state.handles.set(
      "remote-project",
      { name: "orphan-local-source.mp4" }
    );
    const draft = await store.saveLocalDraft({
      id: "remote-project",
      name: "remote explicit save",
      mediaAsset: {
        mediaMode: "source-vod-selection",
        fileHandleStored: false
      }
    }, {
      reason: "manual",
      id: "remote-manual-draft",
      now: "2026-08-14T03:00:00.000Z"
    });

    assert.deepEqual(draft.mediaHandleBinding, { kind: "none" });
    assert.equal(
      await store.discardAbandonedEditingSessionCheckpoint("remote-project"),
      true
    );
    assert.equal(
      database.state.projects.get("remote-project")?.name,
      "remote explicit save"
    );
    assert.equal(database.state.handles.has("remote-project"), false);
    assert.deepEqual([...database.state.drafts.keys()], ["remote-manual-draft"]);
    assert.equal(database.state.checkpoints.size, 0);
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("commit은 final CURRENT와 checkpoint 삭제를 한 transaction으로 커밋하고 owner 충돌을 거절한다", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const database = createEditingSessionCheckpointDatabase({
    projects: [{ id: "target", name: "baseline" }]
  });
  useOpenedDatabase(database);

  try {
    const store = await freshProjectStore("editing-checkpoint-commit");
    await store.beginEditingSessionCheckpoint("target", "editor-session:commit");
    assert.equal(
      await store.commitEditingSessionCheckpoint(
        "target",
        "editor-session:commit",
        { id: "target", name: "final CURRENT" }
      ),
      true
    );
    assert.equal(database.state.projects.get("target")?.name, "final CURRENT");
    assert.equal(database.state.checkpoints.size, 0);
    assert.equal(
      await store.commitEditingSessionCheckpoint(
        "target",
        "editor-session:commit",
        { id: "target", name: "must not overwrite" }
      ),
      false
    );
    assert.equal(database.state.projects.get("target")?.name, "final CURRENT");

    await store.beginEditingSessionCheckpoint("target", "editor-session:owner");
    await assert.rejects(
      store.commitEditingSessionCheckpoint(
        "target",
        "editor-session:intruder",
        { id: "target", name: "intruder" }
      ),
      /다른 편집 세션의 미완료 체크포인트/u
    );
    assert.equal(database.state.projects.get("target")?.name, "final CURRENT");
    assert.equal(database.state.checkpoints.size, 1);

    database.failMutationLabel = "checkpoint-delete";
    await assert.rejects(
      store.commitEditingSessionCheckpoint(
        "target",
        "editor-session:owner",
        { id: "target", name: "partial final" }
      ),
      /injected checkpoint mutation failure/u
    );
    assert.equal(database.state.projects.get("target")?.name, "final CURRENT");
    assert.equal(database.state.checkpoints.size, 1);
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("discard 복원 중 한 저장소가 실패하면 현재 범위와 checkpoint를 모두 롤백한다", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const database = createEditingSessionCheckpointDatabase({
    projects: [{ id: "target", name: "baseline" }],
    caches: [sessionCache("target", "baseline-video")]
  });
  useOpenedDatabase(database);

  try {
    const store = await freshProjectStore("editing-checkpoint-discard-rollback");
    await store.beginEditingSessionCheckpoint("target", "editor-session:rollback");
    database.state.projects.set("target", { id: "target", name: "current" });
    database.state.caches.delete(compoundKey("target", "baseline-video"));
    database.state.caches.set(
      compoundKey("target", "current-video"),
      sessionCache("target", "current-video")
    );
    const before = structuredClone(database.state);

    database.failMutationLabel = "cache-put";
    await assert.rejects(
      store.discardEditingSessionCheckpoint(
        "target",
        "editor-session:rollback"
      ),
      /injected checkpoint mutation failure: cache-put/u
    );
    assert.deepEqual(database.state, before);

    database.failMutationLabel = null;
    assert.equal(
      await store.discardEditingSessionCheckpoint(
        "target",
        "editor-session:rollback"
      ),
      true
    );
    assert.equal(database.state.projects.get("target")?.name, "baseline");
    assert.equal(
      database.state.caches.has(compoundKey("target", "baseline-video")),
      true
    );
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("IndexedDB 업그레이드 차단은 즉시 실패하고 재시도하며 늦은 성공 DB를 닫는다", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const requests: Array<MockRequest<MockDatabase>> = [];
  installIndexedDb({
    open() {
      const request: MockRequest<MockDatabase> = {};
      requests.push(request);
      return request;
    }
  });

  try {
    const store = await freshProjectStore("blocked");
    const blockedLoad = store.loadProject("project");
    const blockedAssertion = assert.rejects(blockedLoad, /다른 편집기 탭.*닫고 다시 시도/);
    required(required(requests[0]).onblocked)();
    await blockedAssertion;

    const retryLoad = store.loadProject("project");
    assert.equal(requests.length, 2);

    let lateCloseCount = 0;
    const blockedRequest = required(requests[0]);
    blockedRequest.result = {
      close() {
        lateCloseCount += 1;
      },
      transaction() {
        throw new Error("A settled database must not start a transaction.");
      }
    };
    required(blockedRequest.onsuccess)();
    assert.equal(lateCloseCount, 1);

    let currentCloseCount = 0;
    const database = readableProjectDatabase({ id: "project", name: "복구됨" });
    database.close = () => {
      currentCloseCount += 1;
    };
    const retryRequest = required(requests[1]);
    retryRequest.result = database;
    required(retryRequest.onsuccess)();
    assert.deepEqual(await retryLoad, { id: "project", name: "복구됨" });

    required(database.onversionchange)();
    assert.equal(currentCloseCount, 1);
    const reopenedLoad = store.loadProject("project");
    assert.equal(requests.length, 3);
    const reopenedRequest = required(requests[2]);
    reopenedRequest.result = readableProjectDatabase({
      id: "project",
      name: "재개방됨"
    });
    required(reopenedRequest.onsuccess)();
    assert.deepEqual(await reopenedLoad, { id: "project", name: "재개방됨" });
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("닫힌 IndexedDB 연결은 캐시를 버리고 한 번 재개방해 트랜잭션을 재시도한다", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const requests: Array<MockRequest<MockDatabase>> = [];
  installIndexedDb({
    open() {
      const request: MockRequest<MockDatabase> = {};
      requests.push(request);
      return request;
    }
  });

  try {
    const store = await freshProjectStore("closed-retry");
    const loadPromise = store.loadProject("project");
    let closeCount = 0;
    const closedRequest = required(requests[0]);
    closedRequest.result = {
      close() {
        closeCount += 1;
      },
      transaction() {
        throw Object.assign(
          new Error("cross-realm-like closed connection"),
          { name: "InvalidStateError" }
        );
      }
    };
    required(closedRequest.onsuccess)();
    await waitForRequestCount(requests, 2);
    assert.equal(closeCount, 1);

    const reopenedRequest = required(requests[1]);
    reopenedRequest.result = readableProjectDatabase({
      id: "project",
      name: "재시도 성공"
    });
    required(reopenedRequest.onsuccess)();
    assert.deepEqual(await loadPromise, { id: "project", name: "재시도 성공" });
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("로컬 임시저장은 프로젝트별 최신 5개만 원자적으로 남기고 복사본을 반환한다", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const database = createLocalDraftDatabase();
  const openedVersions: Array<number | undefined> = [];
  useOpenedDatabase(database, (_name, version) => openedVersions.push(version));

  try {
    const store = await freshProjectStore("local-draft-retention");
    for (let index = 0; index < 6; index += 1) {
      const project = {
        id: "target",
        name: `버전 ${index}`,
        imageAssets: []
      };
      const saved = await store.saveLocalDraft(project, {
        reason: index % 2 === 0 ? "auto" : "manual",
        now: Date.UTC(2026, 6, 28, 0, index),
        id: `target-${index}`
      });
      project.name = "호출 뒤 변경";
      saved.project.name = "반환본 변경";
    }
    await store.saveLocalDraft({
      id: "other",
      name: "다른 프로젝트",
      imageAssets: []
    }, {
      reason: "manual",
      now: Date.UTC(2026, 6, 28, 1, 0),
      id: "other-0"
    });

    const targetDrafts = await store.listLocalDrafts("target");
    assert.deepEqual(
      targetDrafts.map((draft) => draft.id),
      ["target-5", "target-4", "target-3", "target-2", "target-1"]
    );
    assert.deepEqual(
      targetDrafts.map((draft) => draft.project.name),
      ["버전 5", "버전 4", "버전 3", "버전 2", "버전 1"]
    );
    assert.equal(database.state.drafts.has("target-0"), false);
    assert.equal(database.state.drafts.has("other-0"), true);
    assert.equal(required(database.state.projects.get("target")).name, "버전 5");
    assert.equal(required(database.state.projects.get("other")).name, "다른 프로젝트");
    assert.deepEqual(
      (await store.listLocalDrafts("target", { limit: 2 })).map((draft) => draft.id),
      ["target-5", "target-4"]
    );

    const loaded = required(await store.loadLocalDraft("target", "target-5"));
    assert.equal(loaded.project.name, "버전 5");
    loaded.project.name = "불러온 복사본 변경";
    assert.equal(
      required(database.state.drafts.get("target-5")).project.name,
      "버전 5"
    );
    assert.equal(await store.loadLocalDraft("other", "target-5"), null);
    assert.deepEqual(openedVersions, [5]);
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("가장 오래된 5번째 임시저장도 불러오기 직전본 생성 후 안전하게 복원한다", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const database = createLocalDraftDatabase();
  useOpenedDatabase(database);

  try {
    const store = await freshProjectStore("local-draft-restore");
    for (let index = 0; index < 5; index += 1) {
      await store.saveLocalDraft({
        id: "target",
        name: `저장본 ${index}`,
        imageAssets: []
      }, {
        reason: "manual",
        now: Date.UTC(2026, 6, 28, 0, index),
        id: `target-${index}`
      });
    }
    const oldestDraft = await store.loadLocalDraft("target", "target-0");
    assert(oldestDraft);
    const currentProject = {
      id: "target",
      name: "불러오기 직전 현재 작업",
      imageAssets: []
    };
    const restored = await store.restoreLocalDraft(currentProject, oldestDraft, {
      now: Date.UTC(2026, 6, 28, 1, 0),
      id: "target-pre-restore"
    });

    assert.equal(restored.project.name, "저장본 0");
    assert.equal(required(database.state.projects.get("target")).name, "저장본 0");
    assert.equal(restored.preRestoreDraft.reason, "pre-restore");
    assert.equal(restored.preRestoreDraft.restoredFromDraftId, "target-0");
    assert.equal(restored.preRestoreDraft.project.name, "불러오기 직전 현재 작업");
    assert.equal(database.state.drafts.has("target-0"), false);
    assert.deepEqual(
      (await store.listLocalDrafts("target")).map((draft) => draft.id),
      [
        "target-pre-restore",
        "target-4",
        "target-3",
        "target-2",
        "target-1"
      ]
    );

    currentProject.name = "호출 뒤 현재본 변경";
    oldestDraft.project.name = "호출 뒤 대상 변경";
    restored.project.name = "반환 프로젝트 변경";
    restored.preRestoreDraft.project.name = "반환 직전본 변경";
    assert.equal(required(database.state.projects.get("target")).name, "저장본 0");
    assert.equal(
      required(database.state.drafts.get("target-pre-restore")).project.name,
      "불러오기 직전 현재 작업"
    );

    await assert.rejects(
      store.restoreLocalDraft(
        { id: "other", name: "다른 프로젝트" },
        required(database.state.drafts.get("target-4"))
      ),
      /이 프로젝트에서 불러올 수 있는 임시저장본/
    );
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("명시적 A↔B 복원은 선택 저장본 핸들을 설치하고 직전본에 반대편 핸들을 보존한다", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const draftA = sessionDraft("target", "draft-A", "snapshot A");
  draftA.project.mediaAsset = {
    name: "source-A.mp4",
    fileHandleStored: true
  };
  draftA.mediaHandleBinding = {
    kind: "file-system-file-handle",
    handle: { name: "source-A.mp4" }
  };
  const currentB = {
    id: "target",
    name: "current B",
    mediaAsset: {
      name: "source-B.mp4",
      fileHandleStored: true
    }
  };
  const database = createLocalDraftDatabase({
    projects: [currentB],
    drafts: [draftA],
    handles: [{ projectId: "target", value: { name: "source-B.mp4" } }]
  });
  useOpenedDatabase(database);

  try {
    const store = await freshProjectStore("local-draft-handle-swap");
    const restoredA = await store.restoreLocalDraft(currentB, draftA, {
      now: "2026-08-14T04:00:00.000Z",
      id: "pre-B"
    });
    assert.deepEqual(restoredA.restoredMediaHandle, { name: "source-A.mp4" });
    assert.deepEqual(database.state.handles.get("target"), {
      name: "source-A.mp4"
    });
    assert.deepEqual(restoredA.preRestoreDraft.mediaHandleBinding, {
      kind: "file-system-file-handle",
      handle: { name: "source-B.mp4" }
    });

    const restoredB = await store.restoreLocalDraft(
      restoredA.project,
      restoredA.preRestoreDraft,
      {
        now: "2026-08-14T04:01:00.000Z",
        id: "pre-A"
      }
    );
    assert.equal(restoredB.project.name, "current B");
    assert.deepEqual(restoredB.restoredMediaHandle, { name: "source-B.mp4" });
    assert.deepEqual(database.state.handles.get("target"), {
      name: "source-B.mp4"
    });
    assert.deepEqual(restoredB.preRestoreDraft.mediaHandleBinding, {
      kind: "file-system-file-handle",
      handle: { name: "source-A.mp4" }
    });
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("none·legacy 저장본 복원은 현재 핸들을 빌려 쓰지 않고 제거한다", async () => {
  for (const [label, binding] of [
    ["none", { kind: "none" }],
    ["legacy", undefined]
  ] as const) {
    const originalIndexedDb = globalThis.indexedDB;
    const draft = sessionDraft("target", `draft-${label}`, `snapshot ${label}`);
    draft.project.mediaAsset = {
      name: `source-${label}.mp4`,
      fileHandleStored: true
    };
    if (binding) {
      draft.mediaHandleBinding = binding;
    }
    const current = {
      id: "target",
      name: "current B",
      mediaAsset: { name: "source-B.mp4", fileHandleStored: true }
    };
    const database = createLocalDraftDatabase({
      projects: [current],
      drafts: [draft],
      handles: [{ projectId: "target", value: { name: "source-B.mp4" } }]
    });
    useOpenedDatabase(database);
    try {
      const store = await freshProjectStore(`local-draft-${label}-closed`);
      const restored = await store.restoreLocalDraft(current, draft, {
        id: `pre-${label}`,
        now: "2026-08-14T05:00:00.000Z"
      });
      assert.equal(restored.restoredMediaHandle, null);
      assert.equal(database.state.handles.has("target"), false);
      assert.deepEqual(restored.preRestoreDraft.mediaHandleBinding, {
        kind: "file-system-file-handle",
        handle: { name: "source-B.mp4" }
      });
    } finally {
      globalThis.indexedDB = originalIndexedDb;
    }
  }
});

test("프로젝트와 새 이미지 Blob은 두 저장소의 단일 readwrite 트랜잭션에 저장한다", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const requests: Array<MockRequest<MockDatabase>> = [];
  const writes: unknown[][] = [];
  installIndexedDb({
    open() {
      const request: MockRequest<MockDatabase> = {};
      requests.push(request);
      return request;
    }
  });

  try {
    const store = await freshProjectStore("atomic-save");
    const project = { id: "target", imageAssets: [] };
    const blob = new Blob(["asset"], { type: "image/png" });
    const savePromise = store.saveProjectWithImageAssetBlob(project, "asset", blob);
    const database: MockDatabase = {
      close() {},
      transaction(
        storeNames: string | string[],
        mode?: IDBTransactionMode
      ) {
        assert.deepEqual(storeNames, ["projects", "image-assets"]);
        assert.equal(mode, "readwrite");
        const tx: MockTransaction = {
          error: null,
          objectStore(storeName: string) {
            return {
              put(...args: unknown[]) {
                writes.push([storeName, ...args]);
                return {};
              }
            };
          }
        };
        queueMicrotask(() => tx.oncomplete?.());
        return tx;
      }
    };
    const request = required(requests[0]);
    request.result = database;
    required(request.onsuccess)();

    assert.equal(await savePromise, project);
    assert.deepEqual(writes, [
      ["projects", project],
      ["image-assets", blob, ["target", "asset"]]
    ]);
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("복원 프로젝트와 여러 이미지 Blob도 한 트랜잭션에 원자적으로 저장한다", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const requests: Array<MockRequest<MockDatabase>> = [];
  const writes: unknown[][] = [];
  installIndexedDb({
    open() {
      const request: MockRequest<MockDatabase> = {};
      requests.push(request);
      return request;
    }
  });

  try {
    const store = await freshProjectStore("atomic-multi-image-save");
    const project = { id: "target", imageAssets: [] };
    const first = new Blob(["first"], { type: "image/png" });
    const second = new Blob(["second"], { type: "image/webp" });
    const savePromise = store.saveProjectWithImageAssetBlobs(
      project,
      new Map([
        ["archive-a", first],
        ["archive-b", second]
      ])
    );
    const database: MockDatabase = {
      close() {},
      transaction(storeNames: string | string[], mode?: IDBTransactionMode) {
        assert.deepEqual(storeNames, ["projects", "image-assets"]);
        assert.equal(mode, "readwrite");
        const tx: MockTransaction = {
          error: null,
          objectStore(storeName: string) {
            return {
              put(...args: unknown[]) {
                writes.push([storeName, ...args]);
                return {};
              }
            };
          }
        };
        queueMicrotask(() => tx.oncomplete?.());
        return tx;
      }
    };
    const request = required(requests[0]);
    request.result = database;
    required(request.onsuccess)();

    assert.equal(await savePromise, project);
    assert.deepEqual(writes, [
      ["image-assets", first, ["target", "archive-a"]],
      ["image-assets", second, ["target", "archive-b"]],
      ["projects", project]
    ]);
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("세션 복원은 프로젝트·이미지·쇼츠 캐시·파일 핸들 정책을 한 트랜잭션에 커밋한다", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const requests: Array<MockRequest<MockDatabase>> = [];
  const operations: unknown[][] = [];
  installIndexedDb({
    open() {
      const request: MockRequest<MockDatabase> = {};
      requests.push(request);
      return request;
    }
  });

  try {
    const store = await freshProjectStore("atomic-session-archive-replace");
    const project = { id: "target", imageAssets: [] };
    const blob = new Blob(["archive"], { type: "image/png" });
    const replacePromise = store.replaceProjectSessionAtomically(
      project,
      new Map([["archive-image", blob]]),
      { deleteStoredMediaHandle: true }
    );
    const database: MockDatabase = {
      close() {},
      transaction(storeNames: string | string[], mode?: IDBTransactionMode) {
        assert.deepEqual(storeNames, [
          "projects",
          "image-assets",
          "short-video-caches",
          "media-handles"
        ]);
        assert.equal(mode, "readwrite");
        const tx: MockTransaction = { error: null };
        const stores: Record<string, unknown> = {
          projects: {
            put(value: unknown) {
              operations.push(["project-put", value]);
              return {};
            }
          },
          "image-assets": {
            put(value: unknown, key: unknown) {
              operations.push(["image-put", value, key]);
              return {};
            }
          },
          "media-handles": {
            delete(key: unknown) {
              operations.push(["handle-delete", key]);
              return {};
            }
          },
          "short-video-caches": {
            delete(key: unknown) {
              operations.push(["cache-delete", key]);
              return {};
            },
            index(indexName: string) {
              assert.equal(indexName, "projectId");
              return {
                getAllKeys(projectId: string) {
                  assert.equal(projectId, "target");
                  const request: MockRequest<IDBValidKey[]> = {};
                  queueMicrotask(() => {
                    request.result = [
                      ["target", "video-a"],
                      ["target", "video-b"]
                    ];
                    request.onsuccess?.();
                    queueMicrotask(() => tx.oncomplete?.());
                  });
                  return request;
                }
              };
            }
          }
        };
        tx.objectStore = (storeName: string) => required(stores[storeName]);
        return tx;
      }
    };
    const request = required(requests[0]);
    request.result = database;
    required(request.onsuccess)();

    const result = await replacePromise;
    assert.equal(result.project, project);
    assert.equal(result.deletedShortVideoCacheCount, 2);
    assert.deepEqual(operations, [
      ["image-put", blob, ["target", "archive-image"]],
      ["project-put", project],
      ["handle-delete", "target"],
      ["cache-delete", ["target", "video-a"]],
      ["cache-delete", ["target", "video-b"]]
    ]);
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("프로젝트 세션 삭제는 대상 데이터만 원자적으로 지우고 저장소별 건수를 반환한다", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const database = createProjectSessionDeletionDatabase({
    projects: [
      { id: "target", name: "삭제할 프로젝트" },
      { id: "other", name: "보존할 프로젝트" }
    ],
    drafts: [
      { id: "target-draft-a", projectId: "target", project: { id: "target" } },
      { id: "target-draft-b", projectId: "target", project: { id: "target" } },
      { id: "other-draft", projectId: "other", project: { id: "other" } }
    ],
    images: [
      { projectId: "target", assetId: "image-a", value: new Blob(["a"]) },
      { projectId: "target", assetId: "image-b", value: new Blob(["b"]) },
      { projectId: "other", assetId: "image-a", value: new Blob(["other"]) },
      {
        projectId: "target-neighbor",
        assetId: "image-a",
        value: new Blob(["neighbor"])
      }
    ],
    caches: [
      sessionCache("target", "video-a"),
      sessionCache("target", "video-b"),
      sessionCache("other", "video-a"),
      sessionCache("target-neighbor", "video-a")
    ],
    handles: [
      { projectId: "target", value: { name: "target.mp4" } },
      { projectId: "other", value: { name: "other.mp4" } }
    ],
    checkpoints: [
      { projectId: "target", value: { projectId: "target" } },
      { projectId: "other", value: { projectId: "other" } }
    ]
  });
  useOpenedDatabase(database);

  try {
    const store = await freshProjectStore("delete-project-session-isolated");
    assert.deepEqual(await store.deleteProjectSessionAtomically("target"), {
      deletedProjectCount: 1,
      deletedLocalDraftCount: 2,
      deletedImageAssetCount: 2,
      deletedShortVideoCacheCount: 2,
      deletedMediaHandleCount: 1,
      deletedEditingSessionCheckpointCount: 1
    });

    assert.deepEqual([...database.state.projects.keys()], ["other"]);
    assert.deepEqual([...database.state.drafts.keys()], ["other-draft"]);
    assert.deepEqual([...database.state.images.keys()], [
      compoundKey("other", "image-a"),
      compoundKey("target-neighbor", "image-a")
    ]);
    assert.deepEqual([...database.state.caches.keys()], [
      compoundKey("other", "video-a"),
      compoundKey("target-neighbor", "video-a")
    ]);
    assert.deepEqual([...database.state.handles.keys()], ["other"]);
    assert.deepEqual([...database.state.checkpoints.keys()], ["other"]);

    assert.deepEqual(await store.deleteProjectSessionAtomically("target"), {
      deletedProjectCount: 0,
      deletedLocalDraftCount: 0,
      deletedImageAssetCount: 0,
      deletedShortVideoCacheCount: 0,
      deletedMediaHandleCount: 0,
      deletedEditingSessionCheckpointCount: 0
    });
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("모든 프로젝트 세션 삭제는 체크포인트를 포함한 여섯 저장소를 한 transaction에서 비운다", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const database = createEditingSessionCheckpointDatabase({
    projects: [{ id: "target", name: "project" }],
    drafts: [sessionDraft("target", "draft", "project")],
    images: [{
      projectId: "target",
      assetId: "image",
      value: new Blob(["image"], { type: "image/png" })
    }],
    caches: [sessionCache("target", "video")],
    handles: [{ projectId: "target", value: { name: "source.mp4" } }],
    checkpoints: [{
      schema: "chzzk-kirinuki-editing-session-checkpoint/v1",
      projectId: "target"
    }]
  });
  useOpenedDatabase(database);

  try {
    const store = await freshProjectStore("delete-all-project-sessions");
    assert.deepEqual(await store.deleteAllProjectSessionsAtomically(), {
      deletedProjectCount: 1,
      deletedLocalDraftCount: 1,
      deletedImageAssetCount: 1,
      deletedShortVideoCacheCount: 1,
      deletedMediaHandleCount: 1,
      deletedEditingSessionCheckpointCount: 1
    });
    assert.equal(database.state.projects.size, 0);
    assert.equal(database.state.drafts.size, 0);
    assert.equal(database.state.images.size, 0);
    assert.equal(database.state.caches.size, 0);
    assert.equal(database.state.handles.size, 0);
    assert.equal(database.state.checkpoints.size, 0);
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("프로젝트 세션 삭제는 유효하지 않은 프로젝트 ID를 DB 접근 전에 거절한다", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  let openCount = 0;
  installIndexedDb({
    open() {
      openCount += 1;
      throw new Error("유효성 검사 전에 IndexedDB를 열면 안 됩니다.");
    }
  });

  try {
    const store = await freshProjectStore("delete-project-session-validation");
    for (const projectId of ["", " ", " target", "target ", null, 1]) {
      await assert.rejects(
        store.deleteProjectSessionAtomically(projectId),
        /프로젝트 ID이\(가\) 올바르지 않습니다\./
      );
    }
    assert.equal(openCount, 0);
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("프로젝트 세션 삭제 중 한 저장소가 실패하면 앞선 삭제까지 전부 롤백한다", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const database = createProjectSessionDeletionDatabase({
    projects: [
      { id: "target", name: "삭제 시도" },
      { id: "other", name: "보존" }
    ],
    drafts: [
      { id: "target-draft", projectId: "target", project: { id: "target" } },
      { id: "other-draft", projectId: "other", project: { id: "other" } }
    ],
    images: [
      { projectId: "target", assetId: "image", value: new Blob(["target"]) },
      { projectId: "other", assetId: "image", value: new Blob(["other"]) }
    ],
    caches: [
      sessionCache("target", "video"),
      sessionCache("other", "video")
    ],
    handles: [
      { projectId: "target", value: { name: "target.mp4" } },
      { projectId: "other", value: { name: "other.mp4" } }
    ],
    failAtDelete: 4
  });
  const before = structuredClone(database.state);
  useOpenedDatabase(database);

  try {
    const store = await freshProjectStore("delete-project-session-rollback");
    await assert.rejects(
      store.deleteProjectSessionAtomically("target"),
      /injected delete failure 4/
    );
    assert.equal(database.attemptedDeleteCount, 4);
    assert.deepEqual(database.state, before);
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("고아 이미지 Blob 정리는 본편·쇼츠 프로젝트와 임시저장본 참조를 모두 보존한다", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const requests: Array<MockRequest<MockDatabase>> = [];
  const entries = [
    { key: ["target", "keep"], deleted: false },
    { key: ["target", "remove-a"], deleted: false },
    { key: ["target", "short-only"], deleted: false },
    { key: ["target", "draft-only"], deleted: false },
    { key: ["other", "remove-a"], deleted: false },
    { key: ["target", "remove-b"], deleted: false },
    { key: "legacy-key", deleted: false }
  ];

  installIndexedDb({
    open() {
      const request: MockRequest<MockDatabase> = {};
      requests.push(request);
      return request;
    }
  });

  try {
    const store = await freshProjectStore("prune");
    const prunePromise = store.pruneImageAssetBlobs("target", ["keep"]);
    type EntryKey = string | string[];
    interface MockCursor {
      key: EntryKey;
      primaryKey: EntryKey;
      continue(): void;
    }
    const database: MockDatabase = {
      close() {},
      transaction(
        storeName: string | string[],
        mode?: IDBTransactionMode
      ) {
        assert.deepEqual(storeName, ["projects", "local-drafts", "image-assets"]);
        assert.equal(mode, "readwrite");
        const tx: MockTransaction = { error: null };
        const projectStore = {
          get() {
            const request: MockRequest<ProjectRecord> = {
              result: {
                id: "target",
                imageAssets: [{
                  id: "remove-a",
                  source: { kind: "blob-key", value: "remove-a" }
                }],
                shortForm: {
                  imageAssets: [{
                    id: "short-only",
                    source: { kind: "blob-key", value: "short-only" }
                  }]
                }
              }
            };
            queueMicrotask(() => request.onsuccess?.());
            return request;
          }
        };
        const draftStore = {
          index(indexName: string) {
            assert.equal(indexName, "projectId");
            return {
              getAll(projectId: string) {
                assert.equal(projectId, "target");
                const request: MockRequest<DraftRecord[]> = {
                  result: [{
                    schema: "chzzk-kirinuki-local-draft/v1",
                    id: "draft-with-asset",
                    projectId: "target",
                    createdAt: "2026-07-28T00:00:00.000Z",
                    createdAtMs: Date.UTC(2026, 6, 28),
                    reason: "manual",
                    restoredFromDraftId: null,
                    project: {
                      id: "target",
                      imageAssets: [{
                        id: "draft-only",
                        source: { kind: "blob-key", value: "draft-only" }
                      }]
                    }
                  }]
                };
                queueMicrotask(() => request.onsuccess?.());
                return request;
              }
            };
          }
        };
        const imageStore = {
          delete(key: EntryKey) {
            const entry = entries.find((candidate) => (
              JSON.stringify(candidate.key) === JSON.stringify(key)
            ));
            if (entry) {
              entry.deleted = true;
            }
            return {};
          },
          openKeyCursor() {
            const request: MockRequest<MockCursor | null> = { result: null };
            let index = 0;
            const dispatch = () => {
              queueMicrotask(() => {
                if (index >= entries.length) {
                  request.result = null;
                  request.onsuccess?.();
                  queueMicrotask(() => tx.oncomplete?.());
                  return;
                }
                const entry = required(entries[index]);
                request.result = {
                  key: entry.key,
                  primaryKey: entry.key,
                  continue() {
                    index += 1;
                    dispatch();
                  }
                };
                request.onsuccess?.();
              });
            };
            dispatch();
            return request;
          }
        };
        tx.objectStore = (name: string) => {
          if (name === "projects") {
            return projectStore;
          }
          if (name === "local-drafts") {
            return draftStore;
          }
          return imageStore;
        };
        return tx;
      }
    };
    const request = required(requests[0]);
    request.result = database;
    required(request.onsuccess)();

    assert.equal(await prunePromise, 1);
    assert.deepEqual(
      entries.map(({ key, deleted }) => ({ key, deleted })),
      [
        { key: ["target", "keep"], deleted: false },
        { key: ["target", "remove-a"], deleted: false },
        { key: ["target", "short-only"], deleted: false },
        { key: ["target", "draft-only"], deleted: false },
        { key: ["other", "remove-a"], deleted: false },
        { key: ["target", "remove-b"], deleted: true },
        { key: "legacy-key", deleted: false }
      ]
    );
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("숏폼 영상 캐시는 Blob 메타데이터를 검증하며 프로젝트·에셋 키로 CRUD한다", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const database = createShortVideoCacheDatabase();
  const openedVersions: Array<number | undefined> = [];
  useOpenedDatabase(database, (_name, version) => openedVersions.push(version));

  try {
    const store = await freshProjectStore("short-video-cache-crud");
    const blobA = new Blob(["video-a"], { type: "video/mp4" });
    const blobB = new Blob(["video-bb"], { type: "video/webm" });
    const savedA = await store.saveShortVideoCache({
      projectId: "target",
      assetId: "asset-a",
      blob: blobA,
      sourceStartMs: 10_000,
      sourceEndMs: 20_000,
      mediaOffsetMs: 250,
      hasAudio: true,
      sourceFingerprint: "source:target:v1",
      mimeType: blobA.type,
      sizeBytes: blobA.size,
      createdAt: "2026-08-12T01:02:03.000Z"
    });
    await store.saveShortVideoCache({
      projectId: "target",
      assetId: "asset-b",
      blob: blobB,
      sourceStartMs: 30_000,
      sourceEndMs: 45_000,
      sourceFingerprint: "source:target:v1",
      mimeType: blobB.type,
      sizeBytes: blobB.size,
      createdAt: "2026-08-12T01:03:00+00:00"
    });
    await store.saveShortVideoCache({
      projectId: "other",
      assetId: "asset-a",
      blob: blobA,
      sourceStartMs: 0,
      sourceEndMs: 10_000,
      sourceFingerprint: "source:other:v1",
      mimeType: blobA.type,
      sizeBytes: blobA.size,
      createdAt: "2026-08-12T01:04:00.000Z"
    });

    assert.equal(savedA.schema, store.SHORT_VIDEO_CACHE_SCHEMA);
    assert.notEqual(savedA.blob, blobA);
    savedA.sourceStartMs = 999;
    const loadedA = required(await store.loadShortVideoCache("target", "asset-a"));
    assert.equal(loadedA.sourceStartMs, 10_000);
    assert.equal(loadedA.mediaOffsetMs, 250);
    assert.equal(loadedA.hasAudio, true);
    assert.equal(await loadedA.blob.text(), "video-a");
    loadedA.sourceEndMs = 999;
    assert.equal(
      required(await store.loadShortVideoCache("target", "asset-a")).sourceEndMs,
      20_000
    );
    assert.equal(await store.loadShortVideoCache("target", "missing"), null);

    const listed = await store.listShortVideoCaches("target");
    assert.deepEqual(listed.map((record) => record.assetId), ["asset-a", "asset-b"]);
    assert.equal(listed.find((record) => record.assetId === "asset-b")?.hasAudio, false);
    listed[0]!.sourceFingerprint = "mutated";
    assert.equal(
      required(await store.loadShortVideoCache("target", "asset-a"))
        .sourceFingerprint,
      "source:target:v1"
    );

    await store.deleteShortVideoCache("target", "asset-a");
    assert.equal(await store.loadShortVideoCache("target", "asset-a"), null);
    assert.equal((await store.listShortVideoCaches("other")).length, 1);
    assert.deepEqual(openedVersions, [5]);
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("숏폼 영상 캐시 prune·프로젝트 전체 삭제는 다른 프로젝트를 보존한다", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const makeRecord = (
    projectId: string,
    assetId: string
  ): ShortVideoCacheRecord => {
    const blob = new Blob([`${projectId}:${assetId}`], { type: "video/mp4" });
    return {
      schema: "chzzk-kirinuki-short-video-cache/v1",
      projectId,
      assetId,
      blob,
      sourceStartMs: 0,
      sourceEndMs: 1_000,
      sourceFingerprint: `source:${projectId}`,
      mimeType: blob.type,
      sizeBytes: blob.size,
      createdAt: "2026-08-12T02:00:00.000Z"
    };
  };
  const database = createShortVideoCacheDatabase([
    makeRecord("target", "keep"),
    makeRecord("target", "remove-a"),
    makeRecord("target", "remove-b"),
    makeRecord("other", "remove-a")
  ]);
  useOpenedDatabase(database);

  try {
    const store = await freshProjectStore("short-video-cache-cleanup");
    assert.equal(await store.pruneShortVideoCaches("target", ["keep"]), 2);
    assert.deepEqual(
      (await store.listShortVideoCaches("target")).map((record) => record.assetId),
      ["keep"]
    );
    assert.deepEqual(
      (await store.listShortVideoCaches("other")).map((record) => record.assetId),
      ["remove-a"]
    );
    assert.equal(await store.deleteAllShortVideoCaches("target"), 1);
    assert.deepEqual(await store.listShortVideoCaches("target"), []);
    assert.equal((await store.listShortVideoCaches("other")).length, 1);
    assert.equal(await store.deleteAllShortVideoCaches("other"), 1);
    assert.deepEqual(await store.listShortVideoCaches("other"), []);
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

test("숏폼 영상 캐시는 잘못된 입력과 손상된 저장 레코드를 반환하지 않는다", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  const database = createShortVideoCacheDatabase();
  useOpenedDatabase(database);

  try {
    const store = await freshProjectStore("short-video-cache-validation");
    const blob = new Blob(["video"], { type: "video/mp4" });
    const validInput = {
      projectId: "target",
      assetId: "asset",
      blob,
      sourceStartMs: 0,
      sourceEndMs: 1_000,
      sourceFingerprint: "source:v1",
      mimeType: blob.type,
      sizeBytes: blob.size,
      createdAt: "2026-08-12T03:00:00.000Z"
    };
    await assert.rejects(
      store.saveShortVideoCache({ ...validInput, sizeBytes: blob.size + 1 }),
      /크기가 Blob과 일치/
    );
    await assert.rejects(
      store.saveShortVideoCache({ ...validInput, mimeType: "video/webm" }),
      /MIME 타입이 Blob과 일치/
    );
    await assert.rejects(
      store.saveShortVideoCache({
        ...validInput,
        sourceStartMs: 2_000,
        sourceEndMs: 1_000
      }),
      /종료 시각은 시작 시각보다 커야/
    );
    await assert.rejects(
      store.saveShortVideoCache({ ...validInput, createdAt: "not-a-date" }),
      /ISO 문자열/
    );
    await assert.rejects(
      store.saveShortVideoCache({ ...validInput, mediaOffsetMs: -1 }),
      /미디어 오프셋/u
    );
    await assert.rejects(
      store.saveShortVideoCache({
        ...validInput,
        hasAudio: "yes" as unknown as boolean
      }),
      /음성 포함 정보/u
    );
    await assert.rejects(
      store.loadShortVideoCache(" target", "asset"),
      /프로젝트 ID/
    );

    const corrupt = makeCorruptRecord(validInput);
    database.state.caches.set(JSON.stringify(["target", "asset"]), corrupt);
    await assert.rejects(
      store.loadShortVideoCache("target", "asset"),
      /크기가 Blob과 일치/
    );
    await assert.rejects(
      store.listShortVideoCaches("target"),
      /크기가 Blob과 일치/
    );
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

function makeCorruptRecord(
  input: Omit<ShortVideoCacheRecord, "schema">
): ShortVideoCacheRecord {
  return {
    schema: "chzzk-kirinuki-short-video-cache/v1",
    ...input,
    sizeBytes: input.sizeBytes + 1
  };
}
