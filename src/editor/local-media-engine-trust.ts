import {
  LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
  exactBase64UrlBytes,
  parseLocalMediaEngineSessionEncryptionOffer
} from "../lib/local-media-engine-auth.js";
import type {
  LocalMediaEngineSessionEncryptionOffer
} from "../lib/local-media-engine-auth.js";
import {
  dottedReleaseAtLeast,
  isLocalMediaEngineVersion
} from "../lib/local-media-engine-contract.js";

export const LOCAL_MEDIA_ENGINE_TRUST_SCHEMA =
  "kirinuki-local-media-engine/device-pin-v1" as const;
export const LOCAL_MEDIA_ENGINE_TRUST_DATABASE =
  "kirinuki-local-media-engine-trust-v1" as const;
export const LOCAL_MEDIA_ENGINE_TRUST_STORE = "device-pins" as const;
const LOCAL_MEDIA_ENGINE_TRUST_KEY = "active";

export interface LocalMediaEngineDevicePin {
  readonly schema: typeof LOCAL_MEDIA_ENGINE_TRUST_SCHEMA;
  readonly algorithm: typeof LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM;
  readonly keyId: string;
  readonly publicKeySpki: string;
  readonly enrolledAt: string;
  readonly maxSeenVersion: string;
}

export interface LocalMediaEngineTrustStore {
  readonly read: () => Promise<Readonly<LocalMediaEngineDevicePin> | null>;
  readonly pin: (
    candidate: Readonly<LocalMediaEngineDevicePin>
  ) => Promise<Readonly<LocalMediaEngineDevicePin>>;
  readonly observeVersion: (
    keyId: string,
    engineVersion: string
  ) => Promise<Readonly<LocalMediaEngineDevicePin>>;
  readonly reset: (expectedKeyId: string) => Promise<void>;
}

export interface AuthenticatedLocalMediaEngine {
  readonly keyId: string;
  readonly publicKeySpki: string;
  readonly instanceNonce: string;
  readonly engineVersion: string;
  readonly sessionEncryption: Readonly<LocalMediaEngineSessionEncryptionOffer>;
  readonly verifiedAt: number;
}

export class LocalMediaEnginePinMismatchError extends Error {
  constructor(message = "이 브라우저에 고정된 Kirinuki 엔진 identity와 현재 응답이 다릅니다.") {
    super(message);
    this.name = "LocalMediaEnginePinMismatchError";
  }
}

function exactPin(value: unknown): Readonly<LocalMediaEngineDevicePin> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",")
      !== "algorithm,enrolledAt,keyId,maxSeenVersion,publicKeySpki,schema"
    || record.schema !== LOCAL_MEDIA_ENGINE_TRUST_SCHEMA
    || record.algorithm !== LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM
    || !exactBase64UrlBytes(record.keyId, 32)
    || typeof record.publicKeySpki !== "string"
    || record.publicKeySpki.length < 100
    || record.publicKeySpki.length > 240
    || typeof record.enrolledAt !== "string"
    || !Number.isFinite(Date.parse(record.enrolledAt))
    || !isLocalMediaEngineVersion(record.maxSeenVersion)
  ) {
    return null;
  }
  return Object.freeze({
    schema: LOCAL_MEDIA_ENGINE_TRUST_SCHEMA,
    algorithm: LOCAL_MEDIA_ENGINE_SIGNATURE_ALGORITHM,
    keyId: record.keyId,
    publicKeySpki: record.publicKeySpki,
    enrolledAt: record.enrolledAt,
    maxSeenVersion: record.maxSeenVersion
  });
}

function openTrustDatabase(
  indexedDb: IDBFactory
): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDb.open(LOCAL_MEDIA_ENGINE_TRUST_DATABASE, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(LOCAL_MEDIA_ENGINE_TRUST_STORE)) {
        database.createObjectStore(LOCAL_MEDIA_ENGINE_TRUST_STORE);
      }
    };
    request.onerror = () => reject(
      request.error ?? new Error("로컬 엔진 identity 저장소를 열지 못했습니다.")
    );
    request.onblocked = () => reject(
      new Error("다른 탭이 로컬 엔진 identity 저장소 갱신을 막고 있습니다.")
    );
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionFailure(
  transaction: IDBTransaction,
  fallback: string
): Error {
  return transaction.error ?? new Error(fallback);
}

export function createLocalMediaEngineTrustStore(
  indexedDb: IDBFactory
): Readonly<LocalMediaEngineTrustStore> {
  if (!indexedDb || typeof indexedDb.open !== "function") {
    throw new TypeError("IndexedDB 기반 로컬 엔진 identity 저장소가 필요합니다.");
  }
  const read = async (): Promise<Readonly<LocalMediaEngineDevicePin> | null> => {
    const database = await openTrustDatabase(indexedDb);
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(
          LOCAL_MEDIA_ENGINE_TRUST_STORE,
          "readonly"
        );
        const request = transaction.objectStore(
          LOCAL_MEDIA_ENGINE_TRUST_STORE
        ).get(LOCAL_MEDIA_ENGINE_TRUST_KEY);
        request.onerror = () => reject(
          request.error ?? new Error("로컬 엔진 identity를 읽지 못했습니다.")
        );
        request.onsuccess = () => {
          if (request.result === undefined) {
            resolve(null);
            return;
          }
          const parsed = exactPin(request.result);
          if (!parsed) {
            reject(new Error("저장된 로컬 엔진 identity가 손상되었습니다."));
            return;
          }
          resolve(parsed);
        };
      });
    } finally {
      database.close();
    }
  };

  const pin = async (
    candidateValue: Readonly<LocalMediaEngineDevicePin>
  ): Promise<Readonly<LocalMediaEngineDevicePin>> => {
    const candidate = exactPin(candidateValue);
    if (!candidate) {
      throw new TypeError("고정할 로컬 엔진 identity가 올바르지 않습니다.");
    }
    const database = await openTrustDatabase(indexedDb);
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(
          LOCAL_MEDIA_ENGINE_TRUST_STORE,
          "readwrite"
        );
        let result: Readonly<LocalMediaEngineDevicePin> | null = null;
        let semanticError: Error | null = null;
        const store = transaction.objectStore(LOCAL_MEDIA_ENGINE_TRUST_STORE);
        const request = store.get(LOCAL_MEDIA_ENGINE_TRUST_KEY);
        request.onsuccess = () => {
          if (request.result === undefined) {
            result = candidate;
            store.put(candidate, LOCAL_MEDIA_ENGINE_TRUST_KEY);
            return;
          }
          const existing = exactPin(request.result);
          if (!existing) {
            semanticError = new Error("저장된 로컬 엔진 identity가 손상되었습니다.");
            transaction.abort();
            return;
          }
          if (
            existing.keyId !== candidate.keyId
            || existing.publicKeySpki !== candidate.publicKeySpki
          ) {
            semanticError = new LocalMediaEnginePinMismatchError();
            transaction.abort();
            return;
          }
          result = existing;
        };
        request.onerror = () => reject(
          request.error ?? new Error("로컬 엔진 identity를 확인하지 못했습니다.")
        );
        transaction.oncomplete = () => {
          if (!result) {
            reject(new Error("로컬 엔진 identity를 고정하지 못했습니다."));
            return;
          }
          resolve(result);
        };
        transaction.onabort = () => reject(
          semanticError ?? transactionFailure(
            transaction,
            "로컬 엔진 identity 고정을 취소했습니다."
          )
        );
        transaction.onerror = () => undefined;
      });
    } finally {
      database.close();
    }
  };

  const observeVersion = async (
    keyId: string,
    engineVersion: string
  ): Promise<Readonly<LocalMediaEngineDevicePin>> => {
    if (!exactBase64UrlBytes(keyId, 32) || !isLocalMediaEngineVersion(engineVersion)) {
      throw new TypeError("로컬 엔진 version 관찰 값이 올바르지 않습니다.");
    }
    const database = await openTrustDatabase(indexedDb);
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(
          LOCAL_MEDIA_ENGINE_TRUST_STORE,
          "readwrite"
        );
        let result: Readonly<LocalMediaEngineDevicePin> | null = null;
        let semanticError: Error | null = null;
        const store = transaction.objectStore(LOCAL_MEDIA_ENGINE_TRUST_STORE);
        const request = store.get(LOCAL_MEDIA_ENGINE_TRUST_KEY);
        request.onsuccess = () => {
          const existing = exactPin(request.result);
          if (!existing) {
            semanticError = new Error("고정된 로컬 엔진 identity가 없습니다.");
            transaction.abort();
            return;
          }
          if (existing.keyId !== keyId) {
            semanticError = new LocalMediaEnginePinMismatchError();
            transaction.abort();
            return;
          }
          if (!dottedReleaseAtLeast(engineVersion, existing.maxSeenVersion)) {
            semanticError = new Error(
              "설치된 로컬 엔진 version이 이 브라우저에서 이미 확인한 version보다 오래됐습니다."
            );
            transaction.abort();
            return;
          }
          result = engineVersion === existing.maxSeenVersion
            ? existing
            : Object.freeze({ ...existing, maxSeenVersion: engineVersion });
          if (result !== existing) {
            store.put(result, LOCAL_MEDIA_ENGINE_TRUST_KEY);
          }
        };
        request.onerror = () => reject(
          request.error ?? new Error("로컬 엔진 version을 확인하지 못했습니다.")
        );
        transaction.oncomplete = () => result
          ? resolve(result)
          : reject(new Error("로컬 엔진 version을 기록하지 못했습니다."));
        transaction.onabort = () => reject(
          semanticError ?? transactionFailure(
            transaction,
            "로컬 엔진 version 기록을 취소했습니다."
          )
        );
        transaction.onerror = () => undefined;
      });
    } finally {
      database.close();
    }
  };

  const reset = async (expectedKeyId: string): Promise<void> => {
    if (!exactBase64UrlBytes(expectedKeyId, 32)) {
      throw new TypeError("초기화할 로컬 엔진 identity 지문이 올바르지 않습니다.");
    }
    const database = await openTrustDatabase(indexedDb);
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(
          LOCAL_MEDIA_ENGINE_TRUST_STORE,
          "readwrite"
        );
        let semanticError: Error | null = null;
        const store = transaction.objectStore(LOCAL_MEDIA_ENGINE_TRUST_STORE);
        const request = store.get(LOCAL_MEDIA_ENGINE_TRUST_KEY);
        request.onsuccess = () => {
          const existing = exactPin(request.result);
          if (!existing || existing.keyId !== expectedKeyId) {
            semanticError = new LocalMediaEnginePinMismatchError(
              "초기화 확인 중 로컬 엔진 identity가 바뀌었습니다."
            );
            transaction.abort();
            return;
          }
          store.delete(LOCAL_MEDIA_ENGINE_TRUST_KEY);
        };
        request.onerror = () => reject(
          request.error ?? new Error("로컬 엔진 identity를 확인하지 못했습니다.")
        );
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(
          semanticError ?? transactionFailure(
            transaction,
            "로컬 엔진 identity 초기화를 취소했습니다."
          )
        );
        transaction.onerror = () => undefined;
      });
    } finally {
      database.close();
    }
  };

  return Object.freeze({ read, pin, observeVersion, reset });
}

export const localMediaEngineTrustStore: Readonly<LocalMediaEngineTrustStore> =
  Object.freeze({
    read: () => createLocalMediaEngineTrustStore(globalThis.indexedDB).read(),
    pin: (candidate: Readonly<LocalMediaEngineDevicePin>) => (
      createLocalMediaEngineTrustStore(globalThis.indexedDB)
        .pin(candidate)
    ),
    observeVersion: (keyId: string, engineVersion: string) => (
      createLocalMediaEngineTrustStore(globalThis.indexedDB)
        .observeVersion(keyId, engineVersion)
    ),
    reset: (expectedKeyId: string) => (
      createLocalMediaEngineTrustStore(globalThis.indexedDB)
        .reset(expectedKeyId)
    )
  });

let authenticatedEngine: Readonly<AuthenticatedLocalMediaEngine> | null = null;

export function rememberAuthenticatedLocalMediaEngine(
  value: Readonly<AuthenticatedLocalMediaEngine>
): void {
  if (
    !exactBase64UrlBytes(value.keyId, 32)
    || typeof value.publicKeySpki !== "string"
    || !exactBase64UrlBytes(value.instanceNonce, 32)
    || !isLocalMediaEngineVersion(value.engineVersion)
    || !parseLocalMediaEngineSessionEncryptionOffer(value.sessionEncryption)
    || !Number.isFinite(value.verifiedAt)
  ) {
    throw new TypeError("인증된 로컬 엔진 context가 올바르지 않습니다.");
  }
  authenticatedEngine = Object.freeze({ ...value });
}

export function currentAuthenticatedLocalMediaEngine(
  maximumAgeMs = 30_000,
  now = Date.now
): Readonly<AuthenticatedLocalMediaEngine> | null {
  if (
    !Number.isSafeInteger(maximumAgeMs)
    || maximumAgeMs < 0
    || maximumAgeMs > 5 * 60_000
  ) {
    throw new TypeError("인증된 로컬 엔진 context 최대 시간이 올바르지 않습니다.");
  }
  const current = authenticatedEngine;
  const timestamp = now();
  return current
    && Number.isFinite(timestamp)
    && timestamp >= current.verifiedAt
    && timestamp - current.verifiedAt <= maximumAgeMs
    ? current
    : null;
}

export function forgetAuthenticatedLocalMediaEngine(): void {
  authenticatedEngine = null;
}
