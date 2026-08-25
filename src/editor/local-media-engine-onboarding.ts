import {
  LOCAL_MEDIA_ENGINE_API_PROTOCOL,
  LOCAL_MEDIA_ENGINE_HEALTH_SCHEMA as SHARED_LOCAL_MEDIA_ENGINE_HEALTH_SCHEMA,
  LOCAL_MEDIA_ENGINE_PRODUCT,
  LOCAL_MEDIA_ENGINE_VOD_RUNTIME_SCHEMA,
  MINIMUM_LOCAL_MEDIA_ENGINE_EJS_VERSION,
  MINIMUM_LOCAL_MEDIA_ENGINE_VERSION,
  MINIMUM_LOCAL_MEDIA_ENGINE_YT_DLP_VERSION,
  dottedReleaseAtLeast,
  isLocalMediaEngineVersion,
  localMediaEngineLoopbackRequestInit
} from "../lib/local-media-engine-contract.js";
import {
  LOCAL_MEDIA_ENGINE_AUTHENTICATED_HEALTH_PROTOCOL,
  LOCAL_MEDIA_ENGINE_PAIRING_POLL_PROTOCOL,
  LOCAL_MEDIA_ENGINE_PAIRING_POLL_STATUS_SCHEMA,
  LOCAL_MEDIA_ENGINE_PAIRING_STATE_HEADER,
  LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER,
  freshLocalMediaEngineChallenge,
  localMediaEnginePairingUrl,
  localMediaEngineProofTranscript,
  localMediaEnginePublicKeyId,
  pairingResponseUnsignedPayload,
  parseLocalMediaEngineDeviceProof,
  parseLocalMediaEnginePairingResponse,
  parseLocalMediaEngineSessionEncryptionOffer,
  verifyLocalMediaEngineSignature
} from "../lib/local-media-engine-auth.js";
import {
  LOCAL_MEDIA_ENGINE_TRUST_SCHEMA,
  LocalMediaEnginePinMismatchError,
  forgetAuthenticatedLocalMediaEngine,
  localMediaEngineTrustStore,
  rememberAuthenticatedLocalMediaEngine
} from "./local-media-engine-trust.js";
import type {
  LocalMediaEngineDevicePin,
  LocalMediaEngineTrustStore
} from "./local-media-engine-trust.js";
import {
  LOCAL_MEDIA_ENGINE_ARCH_PREVIEW_FILE,
  LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL,
  LOCAL_MEDIA_ENGINE_RELEASE_FILES,
  LOCAL_MEDIA_ENGINE_LINUX_PREVIEW_FILE,
  LOCAL_MEDIA_ENGINE_RELEASE_UNAVAILABLE_MESSAGE,
  LOCAL_MEDIA_ENGINE_WINDOWS_PREVIEW_CHANNEL,
  LOCAL_MEDIA_ENGINE_WINDOWS_PREVIEW_FILE
} from "./local-media-engine-release.js";
import type {
  LocalMediaEngineReleaseChannel,
  LocalMediaEngineWindowsPreviewChannel
} from "./local-media-engine-release.js";

export const LOCAL_MEDIA_ENGINE_ORIGIN = "http://127.0.0.1:4319";
export const LOCAL_MEDIA_ENGINE_HEALTH_ENDPOINT =
  `${LOCAL_MEDIA_ENGINE_ORIGIN}/v1/health`;
export const LOCAL_MEDIA_ENGINE_PAIRING_ENDPOINT =
  `${LOCAL_MEDIA_ENGINE_ORIGIN}/v1/pairing`;
export const LOCAL_MEDIA_ENGINE_HEALTH_SCHEMA =
  SHARED_LOCAL_MEDIA_ENGINE_HEALTH_SCHEMA;
export const LOCAL_MEDIA_ENGINE_PROTOCOL =
  LOCAL_MEDIA_ENGINE_AUTHENTICATED_HEALTH_PROTOCOL;

const MAXIMUM_HEALTH_RESPONSE_BYTES = 64 * 1024;
const HEALTH_PROBE_TIMEOUT_MS = 5_000;
const INSTALL_POLL_INTERVAL_MS = 1_500;
const INSTALL_POLL_TIMEOUT_MS = 10 * 60 * 1_000;
const PAIRING_RESPONSE_MAX_AGE_MS = 5 * 60 * 1_000;
const PAIRING_RESPONSE_FUTURE_SKEW_MS = 60_000;
const PAIRING_TIMEOUT_MS = 30_000;
const PAIRING_POLL_INTERVAL_MS = 150;
const PINNED_ENGINE_WAKE_TIMEOUT_MS = 8_000;
const INITIAL_HEALTH_PRIME_TIMEOUT_MS = 1_000;
const ENGINE_UNAVAILABLE_MESSAGE =
  "이 PC의 영상 준비 도우미에 연결하지 못했습니다. 이미 설치했다면 주소창의 사이트 설정에서 로컬 네트워크 접근을 허용한 뒤 ‘설치 후 연결 확인’을 눌러 주세요.";
const ENGINE_RECOVERY_MESSAGE =
  "아직 이 PC의 영상 준비 도우미가 연결되지 않았습니다. 처음이라면 아래 다운로드부터, 이미 설치했다면 ‘설치 후 연결 확인’을 눌러 주세요.";

export type LocalMediaEngineTarget =
  | "windows-x64"
  | "macos-arm64"
  | "linux-x64"
  | "unsupported";

interface NavigatorUserAgentDataLike {
  readonly platform?: string;
  getHighEntropyValues?(hints: readonly string[]): Promise<{
    readonly architecture?: string;
    readonly bitness?: string;
    readonly platform?: string;
    readonly platformVersion?: string;
  }>;
}

interface EngineDialogElements {
  readonly dialog: HTMLDialogElement;
  readonly download: HTMLAnchorElement;
  readonly archDownload: HTMLAnchorElement;
  readonly downloadLabel: HTMLElement;
  readonly sourceOffer: HTMLAnchorElement;
  readonly retry: HTMLButtonElement;
  readonly reset: HTMLButtonElement;
  readonly cancel: HTMLButtonElement;
  readonly status: HTMLElement;
  readonly unsupported: HTMLElement;
}

export interface LocalMediaEnginePairingOptions {
  readonly trustStore?: Readonly<LocalMediaEngineTrustStore>;
  readonly openProtocol?: (url: string) => void;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

export class LocalMediaEngineConnectionError extends Error {
  readonly code:
    | "ENGINE_UNAVAILABLE"
    | "ENGINE_INCOMPATIBLE"
    | "ENGINE_UNPAIRED"
    | "ENGINE_IDENTITY_MISMATCH";

  constructor(
    message: string,
    code:
      | "ENGINE_UNAVAILABLE"
      | "ENGINE_INCOMPATIBLE"
      | "ENGINE_UNPAIRED"
      | "ENGINE_IDENTITY_MISMATCH"
  ) {
    super(message);
    this.name = "LocalMediaEngineConnectionError";
    this.code = code;
  }
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`로컬 영상 준비 안내 요소가 없습니다: ${selector}`);
  }
  return element;
}

function dialogElements(): EngineDialogElements {
  return {
    dialog: requiredElement<HTMLDialogElement>("#local-media-engine-dialog"),
    download: requiredElement<HTMLAnchorElement>("#local-media-engine-download"),
    archDownload: requiredElement<HTMLAnchorElement>(
      "#local-media-engine-arch-download"
    ),
    downloadLabel: requiredElement<HTMLElement>("#local-media-engine-download-label"),
    sourceOffer: requiredElement<HTMLAnchorElement>("#local-media-engine-source-offer"),
    retry: requiredElement<HTMLButtonElement>("#local-media-engine-retry"),
    reset: requiredElement<HTMLButtonElement>("#local-media-engine-reset"),
    cancel: requiredElement<HTMLButtonElement>("#local-media-engine-cancel"),
    status: requiredElement<HTMLElement>("#local-media-engine-status"),
    unsupported: requiredElement<HTMLElement>("#local-media-engine-unsupported")
  };
}

async function boundedResponseText(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null
    && (
      !/^(?:0|[1-9]\d*)$/u.test(declaredLength)
      || Number(declaredLength) > MAXIMUM_HEALTH_RESPONSE_BYTES
    )
  ) {
    throw new LocalMediaEngineConnectionError(
      "설치된 영상 준비 도구의 응답 크기가 올바르지 않습니다.",
      "ENGINE_INCOMPATIBLE"
    );
  }
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      total += result.value.byteLength;
      if (total > MAXIMUM_HEALTH_RESPONSE_BYTES) {
        await reader.cancel();
        throw new LocalMediaEngineConnectionError(
          "설치된 영상 준비 도구의 응답이 허용 크기를 넘었습니다.",
          "ENGINE_INCOMPATIBLE"
        );
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new LocalMediaEngineConnectionError(
      "설치된 영상 준비 도구의 응답 문자가 올바르지 않습니다.",
      "ENGINE_INCOMPATIBLE"
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function acceptLocalMediaEnginePairingResponse({
  responseValue,
  state,
  challenge,
  trustStore = localMediaEngineTrustStore,
  now = Date.now
}: {
  readonly responseValue: unknown;
  readonly state: string;
  readonly challenge: string;
  readonly trustStore?: Readonly<LocalMediaEngineTrustStore>;
  readonly now?: () => number;
}): Promise<Readonly<LocalMediaEngineDevicePin> | null> {
  const response = parseLocalMediaEnginePairingResponse(responseValue);
  if (
    !response
    || response.state !== state
    || response.challenge !== challenge
  ) {
    return null;
  }
  const timestamp = now();
  const issuedAt = Date.parse(response.issuedAt);
  if (
    !Number.isFinite(timestamp)
    || issuedAt > timestamp + PAIRING_RESPONSE_FUTURE_SKEW_MS
    || timestamp - issuedAt > PAIRING_RESPONSE_MAX_AGE_MS
    || !dottedReleaseAtLeast(
      response.engineVersion,
      MINIMUM_LOCAL_MEDIA_ENGINE_VERSION
    )
  ) {
    throw new LocalMediaEngineConnectionError(
      "Kirinuki 엔진 연결 응답이 만료됐거나 지원 version보다 오래됐습니다.",
      "ENGINE_INCOMPATIBLE"
    );
  }
  const derivedKeyId = await localMediaEnginePublicKeyId(
    response.publicKeySpki
  );
  const signatureValid = derivedKeyId === response.keyId
    && await verifyLocalMediaEngineSignature({
      publicKeySpki: response.publicKeySpki,
      signature: response.signature,
      transcript: localMediaEngineProofTranscript({
        kind: "pairing",
        challenge: response.challenge,
        instanceNonce: "",
        requestBinding: response.state,
        payload: pairingResponseUnsignedPayload(response)
      })
    });
  if (!signatureValid) {
    throw new LocalMediaEngineConnectionError(
      "Kirinuki 엔진 연결 응답의 설치 identity 서명이 올바르지 않습니다.",
      "ENGINE_INCOMPATIBLE"
    );
  }
  const candidate: LocalMediaEngineDevicePin = Object.freeze({
    schema: LOCAL_MEDIA_ENGINE_TRUST_SCHEMA,
    algorithm: response.algorithm,
    keyId: response.keyId,
    publicKeySpki: response.publicKeySpki,
    enrolledAt: new Date(timestamp).toISOString(),
    maxSeenVersion: response.engineVersion
  });
  try {
    const pin = await trustStore.pin(candidate);
    primedDevicePin = pin;
    return pin;
  } catch (error) {
    if (error instanceof LocalMediaEnginePinMismatchError) {
      throw new LocalMediaEngineConnectionError(
        "이 브라우저가 이전에 연결한 영상 준비 도우미와 현재 도우미의 identity가 다릅니다. 자동 교체하지 않았습니다. 설치를 확인한 뒤 ‘연결 기억 지우기’를 명시적으로 선택해 주세요.",
        "ENGINE_IDENTITY_MISMATCH"
      );
    }
    throw error;
  }
}

export async function pairLocalMediaEngine(
  signal?: AbortSignal,
  {
    trustStore = localMediaEngineTrustStore,
    openProtocol = (url) => globalThis.location.assign(url),
    fetchImpl = fetch,
    timeoutMs = PAIRING_TIMEOUT_MS,
    now = Date.now
  }: LocalMediaEnginePairingOptions = {}
): Promise<Readonly<LocalMediaEngineDevicePin>> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new TypeError("Kirinuki 엔진 연결 제한 시간이 올바르지 않습니다.");
  }
  if (signal?.aborted) {
    throw signal.reason;
  }
  const state = freshLocalMediaEngineChallenge();
  const challenge = freshLocalMediaEngineChallenge();
  return new Promise<Readonly<LocalMediaEngineDevicePin>>((resolve, reject) => {
    let settled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let pollController: AbortController | null = null;
    const finish = (
      outcome: { readonly pin: Readonly<LocalMediaEngineDevicePin> }
        | { readonly error: unknown }
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      globalThis.clearTimeout(timer);
      if (pollTimer !== null) {
        globalThis.clearTimeout(pollTimer);
      }
      pollController?.abort();
      signal?.removeEventListener("abort", abort);
      if ("pin" in outcome) {
        resolve(outcome.pin);
      } else {
        reject(outcome.error);
      }
    };
    const abort = () => finish({
      error: signal?.reason ?? new DOMException(
        "Kirinuki 엔진 연결을 취소했습니다.",
        "AbortError"
      )
    });
    const timer = globalThis.setTimeout(() => finish({
      error: new LocalMediaEngineConnectionError(
        "영상 준비 도우미에서 연결 응답을 받지 못했습니다. 도우미 설치가 끝났는지 확인해 주세요.",
        "ENGINE_UNAVAILABLE"
      )
    }), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    const poll = async (): Promise<void> => {
      if (settled) {
        return;
      }
      pollController = new AbortController();
      const forwardAbort = () => pollController?.abort(signal?.reason);
      signal?.addEventListener("abort", forwardAbort, { once: true });
      try {
        const response = await fetchImpl(
          LOCAL_MEDIA_ENGINE_PAIRING_ENDPOINT,
          localMediaEngineLoopbackRequestInit({
          method: "GET",
          headers: {
            "X-Kirinuki-Protocol": LOCAL_MEDIA_ENGINE_PAIRING_POLL_PROTOCOL,
            [LOCAL_MEDIA_ENGINE_PAIRING_STATE_HEADER]: state,
            [LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER]: challenge
          },
          mode: "cors",
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          signal: pollController.signal
          })
        );
        const text = await boundedResponseText(response);
        let value: unknown;
        try {
          value = JSON.parse(text);
        } catch {
          throw new LocalMediaEngineConnectionError(
            "Kirinuki 엔진 pairing poll 응답이 JSON이 아닙니다.",
            "ENGINE_INCOMPATIBLE"
          );
        }
        if (response.status === 202) {
          if (
            !isRecord(value)
            || Object.keys(value).sort().join(",") !== "schema,status"
            || value.schema !== LOCAL_MEDIA_ENGINE_PAIRING_POLL_STATUS_SCHEMA
            || value.status !== "pending"
          ) {
            throw new LocalMediaEngineConnectionError(
              "Kirinuki 엔진 pairing 대기 응답이 올바르지 않습니다.",
              "ENGINE_INCOMPATIBLE"
            );
          }
        } else if (response.status === 200) {
          const pin = await acceptLocalMediaEnginePairingResponse({
            responseValue: value,
            state,
            challenge,
            trustStore,
            now
          });
          if (!pin) {
            throw new LocalMediaEngineConnectionError(
              "Kirinuki 엔진 pairing 응답이 현재 요청과 다릅니다.",
              "ENGINE_INCOMPATIBLE"
            );
          }
          finish({ pin });
          return;
        }
      } catch (error) {
        if (signal?.aborted) {
          finish({ error: signal.reason });
          return;
        }
        if (error instanceof LocalMediaEngineConnectionError) {
          finish({ error });
          return;
        }
        // Connection refusal is expected while the custom-scheme launch wakes
        // the installed background helper. Keep the retry bounded by the outer
        // timeout; no helper UI owns this browser flow.
      } finally {
        signal?.removeEventListener("abort", forwardAbort);
        pollController = null;
      }
      if (!settled) {
        pollTimer = globalThis.setTimeout(() => {
          void poll();
        }, PAIRING_POLL_INTERVAL_MS);
      }
    };
    try {
      openProtocol(localMediaEnginePairingUrl({ state, challenge }));
      void poll();
    } catch (error) {
      finish({ error });
    }
  });
}

function safeVersionString(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 80
    && /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/u.test(value);
}

function isCompatibleLocalMediaEngineHealth(payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }
  const engine = isRecord(payload.engine) ? payload.engine : null;
  const vodRuntime = isRecord(payload.vodRuntime) ? payload.vodRuntime : null;
  const ytDlp = isRecord(vodRuntime?.ytDlp) ? vodRuntime.ytDlp : null;
  const ejs = isRecord(vodRuntime?.ejs) ? vodRuntime.ejs : null;
  const expectedOriginBinding = globalThis.location?.origin
    === "http://127.0.0.1:4320"
    ? "exact-local-studio"
    : "exact-public-studio";
  return payload.schema === LOCAL_MEDIA_ENGINE_HEALTH_SCHEMA
    && payload.status === "ok"
    && payload.managed === true
    && payload.originBinding === expectedOriginBinding
    && payload.authentication === "bearer-memory-capability"
    && engine?.backgroundStart === "ready"
    && engine.product === LOCAL_MEDIA_ENGINE_PRODUCT
    && engine.protocol === LOCAL_MEDIA_ENGINE_API_PROTOCOL
    && isLocalMediaEngineVersion(engine.version)
    && dottedReleaseAtLeast(
      engine.version,
      MINIMUM_LOCAL_MEDIA_ENGINE_VERSION
    )
    && vodRuntime?.schema === LOCAL_MEDIA_ENGINE_VOD_RUNTIME_SCHEMA
    && vodRuntime.kind === "vod-only"
    && vodRuntime.ready === true
    && typeof vodRuntime.instanceNonce === "string"
    && /^[A-Za-z0-9_-]{43}$/u.test(vodRuntime.instanceNonce)
    && safeVersionString(ytDlp?.version)
    && dottedReleaseAtLeast(
      ytDlp.version,
      MINIMUM_LOCAL_MEDIA_ENGINE_YT_DLP_VERSION
    )
    && safeVersionString(ejs?.version)
    && dottedReleaseAtLeast(
      ejs.version,
      MINIMUM_LOCAL_MEDIA_ENGINE_EJS_VERSION
    );
}

function authenticatedHealthPayload(
  value: unknown
): Readonly<Record<string, unknown>> | null {
  if (
    !isRecord(value)
    || Object.keys(value).sort().join(",")
      !== "authentication,deviceProof,engine,managed,originBinding,schema,sessionEncryption,status,transcriptionMode,vodRuntime"
  ) {
    return null;
  }
  return Object.freeze({
    schema: value.schema,
    status: value.status,
    managed: value.managed,
    engine: value.engine,
    originBinding: value.originBinding,
    authentication: value.authentication,
    transcriptionMode: value.transcriptionMode,
    vodRuntime: value.vodRuntime,
    sessionEncryption: value.sessionEncryption
  });
}

export async function probeLocalMediaEngine(
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = HEALTH_PROBE_TIMEOUT_MS,
  trustStore: Readonly<LocalMediaEngineTrustStore> = localMediaEngineTrustStore
): Promise<void> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new TypeError("로컬 영상 준비 도구 확인 제한 시간이 올바르지 않습니다.");
  }
  if (signal?.aborted) {
    throw signal.reason;
  }
  forgetAuthenticatedLocalMediaEngine();
  let pin: Readonly<LocalMediaEngineDevicePin> | null;
  try {
    pin = await trustStore.read();
  } catch {
    throw new LocalMediaEngineConnectionError(
      "이 브라우저의 Kirinuki 엔진 identity 저장소를 읽지 못했습니다.",
      "ENGINE_INCOMPATIBLE"
    );
  }
  if (!pin) {
    throw new LocalMediaEngineConnectionError(
      "이 브라우저는 아직 영상 준비 도우미와 연결되지 않았습니다. ‘이 PC 연결’ 버튼을 눌러 한 번 연결해 주세요.",
      "ENGINE_UNPAIRED"
    );
  }
  const challenge = freshLocalMediaEngineChallenge();
  const requestController = new AbortController();
  const forwardAbort = () => requestController.abort(signal?.reason);
  signal?.addEventListener("abort", forwardAbort, { once: true });
  const timeout = globalThis.setTimeout(() => {
    requestController.abort(new DOMException(
      "로컬 영상 준비 도구 확인 시간이 초과되었습니다.",
      "TimeoutError"
    ));
  }, timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(
        LOCAL_MEDIA_ENGINE_HEALTH_ENDPOINT,
        localMediaEngineLoopbackRequestInit({
        method: "GET",
        headers: {
          "X-Kirinuki-Protocol": LOCAL_MEDIA_ENGINE_PROTOCOL,
          [LOCAL_MEDIA_ENGINE_SERVER_CHALLENGE_HEADER]: challenge
        },
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: requestController.signal
        })
      );
    } catch {
      if (signal?.aborted) {
        throw signal.reason;
      }
      throw new LocalMediaEngineConnectionError(
        ENGINE_UNAVAILABLE_MESSAGE,
        "ENGINE_UNAVAILABLE"
      );
    }
    const text = await boundedResponseText(response);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new LocalMediaEngineConnectionError(
        "설치된 영상 준비 도구의 버전을 확인하지 못했습니다.",
        "ENGINE_INCOMPATIBLE"
      );
    }
    const healthPayload = authenticatedHealthPayload(payload);
    const proof = isRecord(payload)
      ? parseLocalMediaEngineDeviceProof(payload.deviceProof)
      : null;
    const engine = healthPayload && isRecord(healthPayload.engine)
      ? healthPayload.engine
      : null;
    const vodRuntime = healthPayload && isRecord(healthPayload.vodRuntime)
      ? healthPayload.vodRuntime
      : null;
    const sessionEncryption = healthPayload
      ? parseLocalMediaEngineSessionEncryptionOffer(
        healthPayload.sessionEncryption
      )
      : null;
    const sessionEncryptionExpiry = sessionEncryption
      ? Date.parse(sessionEncryption.expiresAt)
      : Number.NaN;
    const proofValid = response.status === 200
      && healthPayload !== null
      && proof !== null
      && proof.keyId === pin.keyId
      && proof.challenge === challenge
      && proof.instanceNonce === vodRuntime?.instanceNonce
      && sessionEncryption !== null
      && sessionEncryptionExpiry > Date.now()
      && sessionEncryptionExpiry <= Date.now() + 60_000
      && await verifyLocalMediaEngineSignature({
        publicKeySpki: pin.publicKeySpki,
        signature: proof.signature,
        transcript: localMediaEngineProofTranscript({
          kind: "health",
          challenge,
          instanceNonce: proof.instanceNonce,
          payload: healthPayload
        })
      });
    if (!proofValid) {
      throw new LocalMediaEngineConnectionError(
        proof && proof.keyId !== pin.keyId
          ? "현재 도우미의 응답은 이 브라우저에 기억된 도우미 identity와 다릅니다. 연결 정보를 자동 교체하지 않았습니다."
          : "현재 영상 준비 도우미의 응답에서 기억된 도우미의 서명을 확인하지 못했습니다.",
        proof && proof.keyId !== pin.keyId
          ? "ENGINE_IDENTITY_MISMATCH"
          : "ENGINE_INCOMPATIBLE"
      );
    }
    if (
      engine?.product === LOCAL_MEDIA_ENGINE_PRODUCT
      && engine.protocol === LOCAL_MEDIA_ENGINE_API_PROTOCOL
      && engine.backgroundStart === "requires-approval"
    ) {
      throw new LocalMediaEngineConnectionError(
        "macOS 시스템 설정의 일반 > 로그인 항목에서 Kirinuki 백그라운드 실행을 한 번 허용해 주세요. 허용되면 자동으로 이어집니다.",
        "ENGINE_UNAVAILABLE"
      );
    }
    if (!isCompatibleLocalMediaEngineHealth(healthPayload)) {
      throw new LocalMediaEngineConnectionError(
        "설치된 영상 준비 도구가 현재 안전 기준과 맞지 않거나 손상됐습니다. 아래 공식 서명 설치 파일을 실행한 뒤 ‘이 PC 연결’을 한 번 눌러 주세요.",
        "ENGINE_INCOMPATIBLE"
      );
    }
    const engineVersion = String(engine?.version || "");
    try {
      await trustStore.observeVersion(pin.keyId, engineVersion);
    } catch (error) {
      throw new LocalMediaEngineConnectionError(
        error instanceof LocalMediaEnginePinMismatchError
          ? "확인 중 로컬 엔진 identity가 바뀌었습니다. 연결 정보를 자동 교체하지 않았습니다."
          : "설치된 로컬 엔진 version이 이 브라우저의 신뢰 기록과 맞지 않습니다.",
        error instanceof LocalMediaEnginePinMismatchError
          ? "ENGINE_IDENTITY_MISMATCH"
          : "ENGINE_INCOMPATIBLE"
      );
    }
    rememberAuthenticatedLocalMediaEngine({
      keyId: pin.keyId,
      publicKeySpki: pin.publicKeySpki,
      instanceNonce: proof.instanceNonce,
      engineVersion,
      sessionEncryption: sessionEncryption!,
      verifiedAt: Date.now()
    });
  } catch (error) {
    if (signal?.aborted) {
      throw signal.reason;
    }
    if (error instanceof LocalMediaEngineConnectionError) {
      throw error;
    }
    throw new LocalMediaEngineConnectionError(
      ENGINE_UNAVAILABLE_MESSAGE,
      "ENGINE_UNAVAILABLE"
    );
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

function normalizedPlatform(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export async function detectLocalMediaEngineTarget(
  sourceNavigator: Navigator = navigator
): Promise<LocalMediaEngineTarget> {
  const userAgentData = (
    sourceNavigator as Navigator & { userAgentData?: NavigatorUserAgentDataLike }
  ).userAgentData;
  let platform = normalizedPlatform(userAgentData?.platform);
  let architecture = "";
  let bitness = "";
  let platformVersion = "";
  try {
    const entropy = await userAgentData?.getHighEntropyValues?.([
      "architecture",
      "bitness",
      "platform",
      "platformVersion"
    ]);
    platform = normalizedPlatform(entropy?.platform) || platform;
    architecture = normalizedPlatform(entropy?.architecture);
    bitness = normalizedPlatform(entropy?.bitness);
    platformVersion = normalizedPlatform(entropy?.platformVersion);
  } catch {
    // Continue with the low-entropy platform. The installer itself still
    // enforces the exact OS/architecture contract.
  }
  const legacyPlatform = normalizedPlatform(sourceNavigator.platform);
  const legacyUserAgent = normalizedPlatform(sourceNavigator.userAgent);
  if (
    (platform === "windows" || legacyPlatform.startsWith("win"))
    && (
      (architecture === "x86" && bitness === "64")
      || architecture === "x86_64"
      || architecture === "x64"
      || legacyPlatform === "win64"
      || /(?:win64|x64|wow64)/u.test(legacyUserAgent)
    )
  ) {
    return "windows-x64";
  }
  if (platform === "macos" || legacyPlatform.startsWith("mac")) {
    const architectureIsArm = ["arm", "arm64", "aarch64"].includes(
      architecture
    );
    const architectureWasWithheld = architecture.length === 0;
    const versionIsSupported = platformVersion.length === 0
      || /^(?:1[5-9]|[2-9]\d)(?:\.|$)/u.test(platformVersion);
    if (
      versionIsSupported
      && (architectureIsArm || architectureWasWithheld)
    ) {
      // Chromium is allowed to withhold high-entropy architecture/version
      // values. Showing the only macOS download is preferable to rejecting a
      // supported Apple Silicon Mac; the signed bundle's arm64 + minOS 15
      // metadata remains the final fail-closed compatibility boundary.
      return "macos-arm64";
    }
  }
  if (
    (platform === "linux" || legacyPlatform.startsWith("linux"))
    && (
      (architecture === "x86" && bitness === "64")
      || architecture === "x86_64"
      || architecture === "x64"
      || legacyPlatform.includes("x86_64")
      || legacyPlatform.includes("x64")
    )
  ) {
    return "linux-x64";
  }
  return "unsupported";
}

/**
 * Reads Chrome's LNA state without triggering the prompt. Chrome currently
 * supports the older alias while the specification is moving to a separate
 * loopback permission, so probe both names and treat unknown browsers as
 * unqueryable rather than denied.
 */
export async function localMediaEnginePermissionState(
  sourceNavigator: Navigator = navigator
): Promise<PermissionState | null> {
  const permissions = sourceNavigator.permissions;
  if (!permissions?.query) {
    return null;
  }
  for (const name of [
    "loopback-network",
    "local-network-access"
  ] as const) {
    try {
      // lib.dom may lag Chrome's loopback/LNA permission names. Invoke the
      // standards API without weakening the surrounding types, then validate
      // the complete state value before it crosses this experimental boundary.
      const status: unknown = await Reflect.apply(
        permissions.query,
        permissions,
        [{ name }]
      );
      if (isRecord(status)) {
        const state = status.state;
        if (state === "granted" || state === "denied" || state === "prompt") {
          return state;
        }
      }
    } catch {
      // Try the Chromium compatibility alias, then fall back to a direct
      // user-initiated probe on browsers that do not expose LNA to Permissions.
    }
  }
  return null;
}

export function localMediaEngineInstaller(
  target: LocalMediaEngineTarget,
  releaseChannel: Readonly<LocalMediaEngineReleaseChannel> | null =
    LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL,
  windowsPreviewChannel:
    Readonly<LocalMediaEngineWindowsPreviewChannel> | null =
      LOCAL_MEDIA_ENGINE_WINDOWS_PREVIEW_CHANNEL
): {
  readonly fileName: string;
  readonly installInstruction: string;
  readonly label: string;
  readonly url: string;
} | null {
  if (target === "windows-x64" && windowsPreviewChannel) {
    const artifact = windowsPreviewChannel.installer;
    return artifact.fileName === LOCAL_MEDIA_ENGINE_WINDOWS_PREVIEW_FILE
      ? {
          fileName: artifact.fileName,
          installInstruction: "Windows 도우미 미리보기 다운로드를 요청했습니다. 다운로드한 exe를 실행하세요. Windows가 앱 보호 화면을 표시하면 ‘추가 정보’에서 실행을 선택할 수 있습니다. 설치가 끝나면 도우미가 자동으로 시작되고 이 화면이 연결을 계속 확인합니다.",
          label: "Windows 도우미 미리보기 (.exe)",
          url: artifact.url
        }
      : null;
  }
  const entry = {
    "windows-x64": {
      fileName: LOCAL_MEDIA_ENGINE_RELEASE_FILES["windows-x64"],
      installInstruction: "Windows 설치 파일 다운로드를 요청했습니다. 브라우저 다운로드 표시가 완료되면 파일을 실행하세요. 이 화면은 설치된 도우미를 자동으로 확인하고 있습니다.",
      label: "Windows용 도우미 다운로드"
    },
    "macos-arm64": {
      fileName: LOCAL_MEDIA_ENGINE_RELEASE_FILES["macos-arm64"],
      installInstruction: "macOS 설치 파일 다운로드를 요청했습니다. 완료된 DMG를 열어 Kirinuki를 응용 프로그램에 넣고 한 번 실행하세요. 이 화면은 도우미 연결을 자동으로 확인하고 있습니다.",
      label: "macOS용 도우미 다운로드"
    },
    "linux-x64": {
      fileName: LOCAL_MEDIA_ENGINE_RELEASE_FILES["linux-x64"],
      installInstruction: "Debian/Ubuntu용 다운로드를 요청했습니다. 다운로드가 끝나면 deb를 설치하고 도우미를 한 번 실행한 뒤 이 화면의 ‘설치 후 연결 확인’을 눌러 주세요. 실행 중인 도우미는 자동으로 감지합니다.",
      label: "Debian/Ubuntu용 도우미 (.deb)"
    }
  }[target as Exclude<LocalMediaEngineTarget, "unsupported">];
  if (!entry || !releaseChannel || target === "unsupported") {
    return null;
  }
  const artifact = releaseChannel.installers[target];
  if (!artifact) {
    return null;
  }
  const expectedFileName = releaseChannel.status === "verified-linux-preview"
    ? LOCAL_MEDIA_ENGINE_LINUX_PREVIEW_FILE
    : entry.fileName;
  const releaseEntry = releaseChannel.status === "verified-linux-preview"
    ? {
        fileName: LOCAL_MEDIA_ENGINE_LINUX_PREVIEW_FILE,
        installInstruction: "Debian/Ubuntu용 도우미 다운로드를 요청했습니다. 다운로드가 끝나면 deb를 설치하고 도우미를 한 번 실행한 뒤 ‘설치 후 연결 확인’을 눌러 주세요. 실행 중인 도우미는 자동으로 감지합니다.",
        label: "Debian/Ubuntu용 도우미 (.deb)"
      }
    : entry;
  return artifact.fileName === expectedFileName
    ? { ...releaseEntry, url: artifact.url }
    : null;
}

export function localMediaEngineArchInstaller(
  releaseChannel: Readonly<LocalMediaEngineReleaseChannel> | null =
    LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL
): {
  readonly fileName: string;
  readonly installInstruction: string;
  readonly label: string;
  readonly url: string;
} | null {
  const artifact = releaseChannel?.status === "verified-linux-preview"
    ? releaseChannel.archInstaller
    : undefined;
  return artifact?.fileName === LOCAL_MEDIA_ENGINE_ARCH_PREVIEW_FILE
    ? {
        fileName: LOCAL_MEDIA_ENGINE_ARCH_PREVIEW_FILE,
        installInstruction: "Arch Linux용 도우미 다운로드를 요청했습니다. 다운로드가 끝나면 pacman으로 패키지를 설치하고 도우미를 한 번 실행한 뒤 ‘설치 후 연결 확인’을 눌러 주세요. 실행 중인 도우미는 자동으로 감지합니다.",
        label: "Arch Linux용 도우미 (.pkg.tar.zst)",
        url: artifact.url
      }
    : null;
}

export function localMediaEngineReleaseMessage(
  target: LocalMediaEngineTarget,
  releaseChannel: Readonly<LocalMediaEngineReleaseChannel> | null =
    LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL,
  windowsPreviewChannel:
    Readonly<LocalMediaEngineWindowsPreviewChannel> | null =
      LOCAL_MEDIA_ENGINE_WINDOWS_PREVIEW_CHANNEL
): string {
  if (target === "windows-x64" && windowsPreviewChannel) {
    return LOCAL_MEDIA_ENGINE_RELEASE_UNAVAILABLE_MESSAGE;
  }
  if (
    releaseChannel?.status === "verified-linux-preview"
    && target !== "linux-x64"
  ) {
    if (windowsPreviewChannel) {
      return "현재 공개 테스트는 Windows x64·Debian/Ubuntu·Arch Linux x64를 지원합니다. macOS용 도우미는 아직 제공하지 않습니다.";
    }
    return "현재 공개 테스트는 Debian/Ubuntu·Arch Linux x64에서만 지원합니다. Windows와 macOS용 도우미는 아직 제공하지 않습니다.";
  }
  return LOCAL_MEDIA_ENGINE_RELEASE_UNAVAILABLE_MESSAGE;
}

export type LocalMediaEngineOnboardingResult = "ready" | "manual-file";

let activeOnboarding: Promise<LocalMediaEngineOnboardingResult> | null = null;
let primedDevicePin: Readonly<LocalMediaEngineDevicePin> | null | undefined;
let primedEngineWasHealthy = false;

export interface LocalMediaEnginePrimeOptions {
  readonly trustStore?: Readonly<LocalMediaEngineTrustStore>;
  readonly permissionState?: () => Promise<PermissionState | null>;
  readonly probe?: () => Promise<void>;
}

export interface LocalMediaEngineReadinessOptions {
  /** Set only when this function is entered directly from a trusted click. */
  readonly allowImmediateProtocolLaunch?: boolean;
  /** Start bounded install polling when an external download offer was clicked. */
  readonly beginInstallPolling?: boolean;
  readonly permissionState?: () => Promise<PermissionState | null>;
  readonly pair?: (
    signal?: AbortSignal,
    options?: LocalMediaEnginePairingOptions
  ) => Promise<Readonly<LocalMediaEngineDevicePin>>;
  readonly probe?: (signal?: AbortSignal) => Promise<void>;
}

export async function primeLocalMediaEngineTrust({
  trustStore = localMediaEngineTrustStore,
  permissionState = () => localMediaEnginePermissionState(),
  probe = () => probeLocalMediaEngine(
    undefined,
    fetch,
    INITIAL_HEALTH_PRIME_TIMEOUT_MS,
    trustStore
  )
}: LocalMediaEnginePrimeOptions = {}): Promise<void> {
  primedDevicePin = await trustStore.read();
  primedEngineWasHealthy = false;
  if (!primedDevicePin || await permissionState() !== "granted") {
    return;
  }
  try {
    // This is a permission-state-gated signed probe. It cannot cause Chrome's
    // first LNA prompt during page initialization.
    await probe();
    primedEngineWasHealthy = true;
  } catch {
    // A sleeping pinned engine is expected here. The next user-initiated
    // prepare click synchronously invokes the registered custom scheme.
    forgetAuthenticatedLocalMediaEngine();
  }
}

export function invalidatePrimedLocalMediaEngineTrust(): void {
  primedDevicePin = undefined;
  primedEngineWasHealthy = false;
}

export async function ensureLocalMediaEngineReady(
  signal?: AbortSignal,
  {
    allowImmediateProtocolLaunch = false,
    beginInstallPolling = false,
    permissionState: readPermissionState = () => (
      localMediaEnginePermissionState()
    ),
    pair = pairLocalMediaEngine,
    probe = probeLocalMediaEngine
  }: LocalMediaEngineReadinessOptions = {}
): Promise<LocalMediaEngineOnboardingResult> {
  let pinnedWakeError: LocalMediaEngineConnectionError | null = null;
  // A signed health probe performed after initialization tells us whether the
  // pinned process was already awake. Healthy engines take the direct path and
  // never show Chrome's external-protocol confirmation. A sleeping pinned
  // engine invokes the scheme synchronously in this activation. First-time
  // users remain on the explicit install/connect flow.
  if (primedDevicePin) {
    if (primedEngineWasHealthy) {
      try {
        await probe(signal);
        return "ready";
      } catch (error) {
        primedEngineWasHealthy = false;
        if (signal?.aborted) {
          throw signal.reason;
        }
        if (!(error instanceof LocalMediaEngineConnectionError)) {
          throw error;
        }
        // Do not launch a protocol handler after awaiting a failed fetch: the
        // browser's transient user activation may already be gone. The dialog
        // offers the explicit wake action instead.
        pinnedWakeError = error;
      }
    } else if (allowImmediateProtocolLaunch) {
      try {
        await pair(signal, {
          timeoutMs: PINNED_ENGINE_WAKE_TIMEOUT_MS
        });
        await probe(signal);
        primedEngineWasHealthy = true;
        return "ready";
      } catch (error) {
        primedEngineWasHealthy = false;
        if (signal?.aborted) {
          throw signal.reason;
        }
        if (!(error instanceof LocalMediaEngineConnectionError)) {
          throw error;
        }
        pinnedWakeError = error;
      }
    }
  }
  let permissionState = await readPermissionState();
  let initialConnectionError: LocalMediaEngineConnectionError | null =
    pinnedWakeError;
  // If Chrome has not asked yet, explain the one-time local connection before
  // the first request triggers its system prompt. Once permission is granted,
  // every later visit takes the ordinary direct-probe path without Kirinuki
  // storing an onboarding flag or visit history.
  if (permissionState === null || permissionState === "granted") {
    try {
      await probe(signal);
      primedEngineWasHealthy = true;
      return "ready";
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason;
      }
      if (!(error instanceof LocalMediaEngineConnectionError)) {
        throw error;
      }
      initialConnectionError = error;
    }
  }
  if (activeOnboarding) {
    return activeOnboarding;
  }
  activeOnboarding = (async () => {
    const elements = dialogElements();
    const target = await detectLocalMediaEngineTarget();
    const installer = localMediaEngineInstaller(target);
    const archInstaller = target === "linux-x64"
      ? localMediaEngineArchInstaller()
      : null;
    const releaseUnavailable = target !== "unsupported"
      && !installer
      && !archInstaller;
    const releaseMessage = localMediaEngineReleaseMessage(target);
    const permissionMustBeResolved = permissionState === "prompt"
      || permissionState === "denied";
    elements.unsupported.hidden = Boolean(installer || archInstaller);
    elements.unsupported.textContent = releaseUnavailable
      ? releaseMessage
      : "현재는 Windows 64비트, Apple Silicon macOS 15 이상, Debian/Ubuntu·Arch Linux 64비트만 지원합니다.";
    elements.download.hidden = !installer || permissionMustBeResolved;
    if (installer) {
      elements.download.href = installer.url;
      elements.download.download = installer.fileName;
      elements.downloadLabel.textContent = installer.label;
    } else {
      elements.download.removeAttribute("href");
      elements.download.removeAttribute("download");
    }
    elements.archDownload.hidden = !archInstaller || permissionMustBeResolved;
    if (archInstaller) {
      elements.archDownload.href = archInstaller.url;
      elements.archDownload.download = archInstaller.fileName;
      elements.archDownload.textContent = archInstaller.label;
    } else {
      elements.archDownload.removeAttribute("href");
      elements.archDownload.removeAttribute("download");
    }
    const sourceOffer = LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL?.status
      === "verified-linux-preview"
      ? LOCAL_MEDIA_ENGINE_RELEASE_CHANNEL.sourceOffer
      : undefined;
    elements.sourceOffer.hidden = !sourceOffer;
    if (sourceOffer) {
      elements.sourceOffer.href = sourceOffer.url;
    } else {
      elements.sourceOffer.removeAttribute("href");
    }
    elements.retry.className = permissionMustBeResolved
      ? "button primary"
      : "button secondary";
    elements.download.className = permissionMustBeResolved
      ? "button secondary"
      : "button primary";
    elements.retry.textContent = permissionState === "prompt"
      ? "이 PC 연결 허용하고 계속"
      : permissionState === "denied"
        ? "권한 설정 후 다시 확인"
        : initialConnectionError?.code === "ENGINE_UNPAIRED"
          ? "이 PC 연결"
          : initialConnectionError?.code === "ENGINE_UNAVAILABLE"
            ? "도우미 깨우고 다시 확인"
            : "설치 완료 · 다시 확인";
    elements.reset.hidden = initialConnectionError?.code
      !== "ENGINE_IDENTITY_MISMATCH";
    elements.status.dataset.state = "waiting";
    elements.status.textContent = installer
      ? permissionState === "denied"
        ? "주소창의 사이트 설정에서 로컬 네트워크 접근을 허용한 뒤 다시 확인해 주세요."
        : permissionState === "prompt"
          ? "먼저 이 사이트가 이 PC의 영상 준비 도구에 연결하도록 한 번 허용해 주세요. 이미 설치했다면 곧바로 원래 작업이 이어집니다."
          : initialConnectionError?.code === "ENGINE_INCOMPATIBLE"
            ? initialConnectionError.message
            : ENGINE_RECOVERY_MESSAGE
      : releaseUnavailable
        ? releaseMessage
        : "현재 PC는 자동 설치 지원 대상이 아닙니다.";
    let lastConnectionError = initialConnectionError;
    let pollingTimer: number | null = null;
    let pollingDeadline = 0;
    let settled = false;
    const stopPolling = () => {
      if (pollingTimer !== null) {
        window.clearTimeout(pollingTimer);
        pollingTimer = null;
      }
    };
    const cleanup = () => {
      stopPolling();
      elements.download.removeEventListener("click", beginPolling);
      elements.archDownload.removeEventListener("click", beginPolling);
      elements.retry.removeEventListener("click", retry);
      elements.reset.removeEventListener("click", resetPairing);
      elements.cancel.removeEventListener("click", useManualFile);
      elements.dialog.removeEventListener("cancel", cancelDialog);
      signal?.removeEventListener("abort", abort);
    };
    let resolveOnboarding: (
      outcome: LocalMediaEngineOnboardingResult
    ) => void = () => undefined;
    let rejectOnboarding: (error: unknown) => void = () => undefined;
    const result = new Promise<LocalMediaEngineOnboardingResult>((resolve, reject) => {
      resolveOnboarding = resolve;
      rejectOnboarding = reject;
    });
    const succeed = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      elements.status.dataset.state = "ready";
      elements.status.textContent = "준비됐습니다. 선택한 영상 구간을 이어서 불러옵니다.";
      elements.dialog.close();
      resolveOnboarding("ready");
    };
    const check = async (
      pairingAttempt?: Promise<Readonly<LocalMediaEngineDevicePin>>
    ) => {
      elements.retry.disabled = true;
      elements.status.dataset.state = "checking";
      elements.status.textContent = "이 PC의 영상 준비 도구를 확인하는 중…";
      try {
        if (pairingAttempt) {
          elements.status.textContent = "영상 준비 도우미에서 이 브라우저의 연결 요청을 확인하는 중…";
          await pairingAttempt;
        }
        await probe(signal);
        primedEngineWasHealthy = true;
        succeed();
        return true;
      } catch (error) {
        if (signal?.aborted) {
          throw signal.reason;
        }
        primedEngineWasHealthy = false;
        if (error instanceof LocalMediaEngineConnectionError) {
          lastConnectionError = error;
        }
        permissionState = await readPermissionState();
        const permissionStillBlocked = permissionState === "prompt"
          || permissionState === "denied";
        elements.download.hidden = !installer || permissionStillBlocked;
        elements.archDownload.hidden = !archInstaller || permissionStillBlocked;
        elements.retry.className = permissionStillBlocked
          ? "button primary"
          : "button secondary";
        elements.download.className = permissionStillBlocked
          ? "button secondary"
          : "button primary";
        elements.retry.textContent = permissionState === "denied"
          ? "권한 설정 후 다시 확인"
          : error instanceof LocalMediaEngineConnectionError
            && error.code === "ENGINE_UNPAIRED"
            ? "이 PC 연결"
            : error instanceof LocalMediaEngineConnectionError
              && error.code === "ENGINE_UNAVAILABLE"
              ? "도우미 깨우고 다시 확인"
              : "설치 완료 · 다시 확인";
        elements.reset.hidden = !(error instanceof LocalMediaEngineConnectionError)
          || error.code !== "ENGINE_IDENTITY_MISMATCH";
        elements.status.dataset.state = "error";
        elements.status.textContent = permissionState === "denied"
          ? "주소창의 사이트 설정에서 로컬 네트워크 접근을 허용한 뒤 다시 확인해 주세요."
          : permissionState === "prompt"
            ? "브라우저의 로컬 네트워크 접근 질문에서 허용을 선택해 주세요."
            : error instanceof LocalMediaEngineConnectionError
              && error.code === "ENGINE_INCOMPATIBLE"
              ? error.message
              : error instanceof LocalMediaEngineConnectionError
                && error.code === "ENGINE_UNPAIRED"
                ? "도우미 실행을 확인했습니다. ‘이 PC 연결’을 한 번 누르면 이 브라우저 등록과 원래 작업을 이어갑니다."
              : releaseUnavailable
                ? releaseMessage
                : ENGINE_RECOVERY_MESSAGE;
        return false;
      } finally {
        elements.retry.disabled = false;
      }
    };
    const poll = () => {
      pollingTimer = null;
      if (settled || Date.now() >= pollingDeadline) {
        return;
      }
      void check().then((ready) => {
        if (!ready && !settled && Date.now() < pollingDeadline) {
          pollingTimer = window.setTimeout(poll, INSTALL_POLL_INTERVAL_MS);
        }
      }).catch(abort);
    };
    function beginPolling(event?: Event): void {
      pollingDeadline = Date.now() + INSTALL_POLL_TIMEOUT_MS;
      stopPolling();
      pollingTimer = window.setTimeout(poll, INSTALL_POLL_INTERVAL_MS);
      elements.status.dataset.state = "waiting";
      const selectedInstaller = event?.currentTarget === elements.archDownload
        ? archInstaller
        : installer;
      elements.status.textContent = selectedInstaller?.installInstruction
        || "설치가 끝난 뒤 다시 확인해 주세요.";
    }
    function retry(): void {
      let pairingAttempt:
        | Promise<Readonly<LocalMediaEngineDevicePin>>
        | undefined;
      if (
        lastConnectionError
        && ["ENGINE_UNPAIRED", "ENGINE_UNAVAILABLE"].includes(
          lastConnectionError.code
        )
      ) {
        try {
          // Keep the custom-protocol launch inside this trusted click stack.
          // A probe before pair() would cross an await boundary and Chromium
          // could discard the transient user activation needed by the launch.
          pairingAttempt = pair(signal);
        } catch (error) {
          pairingAttempt = Promise.reject(error);
        }
      }
      void check(pairingAttempt).catch(abort);
    }
    function resetPairing(): void {
      void (async () => {
        const pin = await localMediaEngineTrustStore.read();
        if (!pin) {
          elements.reset.hidden = true;
          return;
        }
        if (!globalThis.confirm(
          "이 브라우저에 기억된 영상 준비 도우미 identity를 지울까요? 설치된 도우미를 직접 확인한 경우에만 계속하세요."
        )) {
          return;
        }
        await localMediaEngineTrustStore.reset(pin.keyId);
        primedDevicePin = null;
        primedEngineWasHealthy = false;
        forgetAuthenticatedLocalMediaEngine();
        elements.reset.hidden = true;
        elements.retry.textContent = "이 PC 연결";
        elements.status.dataset.state = "waiting";
        elements.status.textContent = "연결 identity를 초기화했습니다. ‘이 PC 연결’을 눌러 다시 확인해 주세요.";
      })().catch((error) => {
        elements.status.dataset.state = "error";
        elements.status.textContent = error instanceof Error
          ? error.message
          : "기기 연결 정보를 초기화하지 못했습니다.";
      });
    }
    function useManualFile(): void {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      elements.dialog.close();
      resolveOnboarding("manual-file");
    }
    function cancelDialog(event: Event): void {
      event.preventDefault();
      abort();
    }
    function abort(): void {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      elements.dialog.close();
      rejectOnboarding(signal?.reason ?? new DOMException(
        "영상 준비 연결을 취소했습니다.",
        "AbortError"
      ));
    }
    elements.download.addEventListener("click", beginPolling);
    elements.archDownload.addEventListener("click", beginPolling);
    elements.retry.addEventListener("click", retry);
    elements.reset.addEventListener("click", resetPairing);
    elements.cancel.addEventListener("click", useManualFile);
    elements.dialog.addEventListener("cancel", cancelDialog);
    signal?.addEventListener("abort", abort, { once: true });
    if (!elements.dialog.open) {
      elements.dialog.showModal();
    }
    if (beginInstallPolling && (installer || archInstaller)) {
      beginPolling();
    }
    elements.retry.focus({ preventScroll: true });
    return result;
  })().finally(() => {
    activeOnboarding = null;
  });
  return activeOnboarding;
}
