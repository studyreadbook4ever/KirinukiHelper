import {
  STREAMING_BRIDGE_PROTOCOL,
  STREAMING_BRIDGE_REQUEST,
  createStreamingBridgeSourceIdentity,
  parseStreamingBridgeRequest,
  parseStreamingBridgeResponse,
  parseStreamingBridgeShortcutMessage,
  sameStreamingBridgeSourceIdentity
} from "./streaming-bridge-protocol.js";
import type {
  StreamingBridgePlayerSnapshot,
  StreamingBridgeRequest,
  StreamingBridgeResponse,
  StreamingBridgeShortcutMessage,
  StreamingBridgeSourceIdentity
} from "./streaming-bridge-protocol.js";

export interface StreamingBridgeClientOptions {
  readonly source: unknown;
  readonly send: (
    request: StreamingBridgeRequest
  ) => void | Promise<void>;
  readonly subscribe: (
    listener: (response: unknown) => void
  ) => () => void;
  readonly requestTimeoutMs?: number;
  readonly maxDeliveryAttempts?: number;
  readonly createRequestId?: () => string;
}

interface PendingRequest {
  readonly request: StreamingBridgeRequest;
  readonly resolve: (player: StreamingBridgePlayerSnapshot) => void;
  readonly reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
  attempts: number;
}

export class StreamingBridgeRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "StreamingBridgeRequestError";
    this.code = code;
  }
}

function abortError(message: string): Error {
  if (typeof DOMException === "function") {
    return new DOMException(message, "AbortError");
  }
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function defaultRequestId(): string {
  return `request-${crypto.randomUUID()}`;
}

function boundedTimeout(value: unknown): number {
  const timeout = Number(value ?? 5_000);
  if (!Number.isFinite(timeout) || timeout < 50 || timeout > 30_000) {
    throw new TypeError("스트리밍 브리지 응답 제한 시간은 50~30000ms여야 합니다.");
  }
  return Math.round(timeout);
}

function boundedDeliveryAttempts(value: unknown): number {
  const attempts = Number(value ?? 2);
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 3) {
    throw new TypeError("스트리밍 브리지 전달 시도는 1~3회여야 합니다.");
  }
  return attempts;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class StreamingBridgeClient {
  #source: StreamingBridgeSourceIdentity;
  #generation = 1;
  #destroyed = false;
  #queueTail: Promise<void> = Promise.resolve();
  #pending = new Map<string, PendingRequest>();
  #issuedRequestIds = new Set<string>();
  #seenShortcutEventIds = new Set<string>();
  #shortcutListeners = new Set<(
    message: StreamingBridgeShortcutMessage
  ) => void>();
  readonly #send: StreamingBridgeClientOptions["send"];
  readonly #requestTimeoutMs: number;
  readonly #maxDeliveryAttempts: number;
  readonly #createRequestId: () => string;
  readonly #unsubscribe: () => void;

  constructor(options: StreamingBridgeClientOptions) {
    this.#source = createStreamingBridgeSourceIdentity(options.source);
    this.#send = options.send;
    this.#requestTimeoutMs = boundedTimeout(options.requestTimeoutMs);
    this.#maxDeliveryAttempts = boundedDeliveryAttempts(
      options.maxDeliveryAttempts
    );
    this.#createRequestId = options.createRequestId || defaultRequestId;
    this.#unsubscribe = options.subscribe((message) => {
      this.#acceptResponse(message);
      this.#acceptShortcut(message);
    });
    if (typeof this.#unsubscribe !== "function") {
      throw new TypeError("스트리밍 브리지 구독 해제 함수를 받지 못했습니다.");
    }
  }

  get source(): StreamingBridgeSourceIdentity {
    return this.#source;
  }

  get generation(): number {
    return this.#generation;
  }

  snapshot(): Promise<StreamingBridgePlayerSnapshot> {
    return this.#enqueue({ action: "snapshot" });
  }

  seekAbsolute(targetSeconds: number): Promise<StreamingBridgePlayerSnapshot> {
    if (
      !Number.isFinite(targetSeconds)
      || targetSeconds < 0
      || targetSeconds > 2_592_000
    ) {
      return Promise.reject(new TypeError(
        "스트리밍 절대 이동 시각은 0초 이상 30일 이하여야 합니다."
      ));
    }
    return this.#enqueue({ action: "seek-absolute", targetSeconds });
  }

  setPlaybackRate(
    playbackRate: 0.25 | 2
  ): Promise<StreamingBridgePlayerSnapshot> {
    if (playbackRate !== 0.25 && playbackRate !== 2) {
      return Promise.reject(new TypeError(
        "스트리밍 재생 속도는 0.25배 또는 2배만 지원합니다."
      ));
    }
    return this.#enqueue({ action: "set-playback-rate", playbackRate });
  }

  /**
   * Receives iframe-focused Studio shortcut keys only after the transport's
   * exact WindowProxy/origin checks and this client's source/generation checks.
   */
  subscribeShortcuts(
    listener: (message: StreamingBridgeShortcutMessage) => void
  ): () => void {
    if (this.#destroyed) {
      throw abortError("스트리밍 브리지 연결이 닫혔습니다.");
    }
    this.#shortcutListeners.add(listener);
    return () => this.#shortcutListeners.delete(listener);
  }

  replaceSource(source: unknown): void {
    const next = createStreamingBridgeSourceIdentity(source);
    if (sameStreamingBridgeSourceIdentity(this.#source, next)) {
      return;
    }
    this.invalidate("스트리밍 원본 회차가 바뀌었습니다.");
    this.#source = next;
  }

  invalidate(message = "스트리밍 브리지 요청이 무효화되었습니다."): void {
    if (this.#destroyed) {
      return;
    }
    this.#generation += 1;
    this.#issuedRequestIds.clear();
    this.#seenShortcutEventIds.clear();
    const error = abortError(message);
    for (const pending of this.#pending.values()) {
      if (pending.timeoutId !== null) {
        clearTimeout(pending.timeoutId);
      }
      pending.reject(error);
    }
    this.#pending.clear();
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.invalidate("스트리밍 브리지 연결을 닫았습니다.");
    this.#destroyed = true;
    this.#shortcutListeners.clear();
    this.#unsubscribe();
  }

  #enqueue(
    operation:
      | { readonly action: "snapshot" }
      | { readonly action: "seek-absolute"; readonly targetSeconds: number }
      | { readonly action: "set-playback-rate"; readonly playbackRate: 0.25 | 2 }
  ): Promise<StreamingBridgePlayerSnapshot> {
    if (this.#destroyed) {
      return Promise.reject(abortError("스트리밍 브리지 연결이 닫혔습니다."));
    }
    const requestedGeneration = this.#generation;
    const result = this.#queueTail.then(async () => {
      if (this.#destroyed || requestedGeneration !== this.#generation) {
        throw abortError("오래된 스트리밍 브리지 요청을 실행하지 않았습니다.");
      }
      const requestId = this.#createRequestId();
      if (this.#issuedRequestIds.has(requestId)) {
        throw new TypeError(
          `스트리밍 브리지 요청 ID가 중복되었습니다: ${requestId}`
        );
      }
      this.#issuedRequestIds.add(requestId);
      // The live clock probes several times per second. Keep replay defense
      // bounded so a long editing session cannot grow this set forever.
      if (this.#issuedRequestIds.size > 4_096) {
        const oldest = this.#issuedRequestIds.values().next().value;
        if (typeof oldest === "string") {
          this.#issuedRequestIds.delete(oldest);
        }
      }
      const common = {
        protocol: STREAMING_BRIDGE_PROTOCOL,
        type: STREAMING_BRIDGE_REQUEST,
        requestId,
        generation: requestedGeneration,
        source: this.#source
      } as const;
      const request: StreamingBridgeRequest = operation.action === "seek-absolute"
        ? { ...common, action: operation.action, targetSeconds: operation.targetSeconds }
        : operation.action === "set-playback-rate"
          ? { ...common, action: operation.action, playbackRate: operation.playbackRate }
          : { ...common, action: operation.action };
      if (!parseStreamingBridgeRequest(request)) {
        throw new TypeError(
          "스트리밍 브리지 요청 ID 또는 요청 형식이 올바르지 않습니다."
        );
      }
      return this.#dispatch(request);
    });
    this.#queueTail = result.then(() => undefined, () => undefined);
    return result;
  }

  #dispatch(
    request: StreamingBridgeRequest
  ): Promise<StreamingBridgePlayerSnapshot> {
    if (this.#pending.has(request.requestId)) {
      return Promise.reject(new TypeError(
        `스트리밍 브리지 요청 ID가 중복되었습니다: ${request.requestId}`
      ));
    }
    return new Promise<StreamingBridgePlayerSnapshot>((resolve, reject) => {
      const pending: PendingRequest = {
        request,
        resolve,
        reject,
        timeoutId: null,
        attempts: 0
      };
      this.#pending.set(request.requestId, pending);
      const failDelivery = (error: unknown): void => {
        const active = this.#pending.get(request.requestId);
        if (!active) {
          return;
        }
        if (active.timeoutId !== null) {
          clearTimeout(active.timeoutId);
        }
        this.#pending.delete(request.requestId);
        active.reject(new StreamingBridgeRequestError(
          "send-failed",
          `스트리밍 플레이어에 요청을 전달하지 못했습니다: ${errorMessage(error)}`
        ));
      };
      const deliver = (): void => {
        const active = this.#pending.get(request.requestId);
        if (!active) {
          return;
        }
        active.attempts += 1;
        active.timeoutId = setTimeout(() => {
          const timedOut = this.#pending.get(request.requestId);
          if (!timedOut) {
            return;
          }
          timedOut.timeoutId = null;
          if (timedOut.attempts < this.#maxDeliveryAttempts) {
            // Retry the exact same request ID. The iframe endpoint replays a
            // cached result, so a late response can never apply a mutation a
            // second time.
            deliver();
            return;
          }
          this.#pending.delete(request.requestId);
          timedOut.reject(new StreamingBridgeRequestError(
            "timeout",
            `스트리밍 플레이어가 ${this.#requestTimeoutMs * timedOut.attempts}ms 안에 응답하지 않았습니다.`
          ));
        }, this.#requestTimeoutMs);
        try {
          Promise.resolve(this.#send(request)).catch(failDelivery);
        } catch (error) {
          failDelivery(error);
        }
      };
      deliver();
    });
  }

  #acceptResponse(value: unknown): void {
    const response = parseStreamingBridgeResponse(value);
    if (!response) {
      return;
    }
    const pending = this.#pending.get(response.requestId);
    if (!pending || !this.#responseMatchesRequest(response, pending.request)) {
      return;
    }
    if (pending.timeoutId !== null) {
      clearTimeout(pending.timeoutId);
    }
    this.#pending.delete(response.requestId);
    if (response.ok) {
      pending.resolve(response.player);
      return;
    }
    pending.reject(new StreamingBridgeRequestError(
      response.error.code,
      response.error.message
    ));
  }

  #acceptShortcut(value: unknown): void {
    const message = parseStreamingBridgeShortcutMessage(value);
    if (
      !message
      || message.generation !== this.#generation
      || !sameStreamingBridgeSourceIdentity(message.source, this.#source)
      || this.#seenShortcutEventIds.has(message.eventId)
    ) {
      return;
    }
    this.#seenShortcutEventIds.add(message.eventId);
    if (this.#seenShortcutEventIds.size > 512) {
      const oldest = this.#seenShortcutEventIds.values().next().value;
      if (typeof oldest === "string") {
        this.#seenShortcutEventIds.delete(oldest);
      }
    }
    for (const listener of this.#shortcutListeners) {
      listener(message);
    }
  }

  #responseMatchesRequest(
    response: StreamingBridgeResponse,
    request: StreamingBridgeRequest
  ): boolean {
    return response.requestId === request.requestId
      && response.generation === request.generation
      && response.generation === this.#generation
      && response.action === request.action
      && sameStreamingBridgeSourceIdentity(response.source, request.source)
      && sameStreamingBridgeSourceIdentity(response.source, this.#source);
  }
}

export interface StreamingBridgeWindowTransportOptions {
  readonly targetOrigin: string;
  readonly targetWindow: () => Window | null;
  readonly hostWindow?: Window;
}

export interface StreamingBridgeWindowTransport {
  readonly send: StreamingBridgeClientOptions["send"];
  readonly subscribe: StreamingBridgeClientOptions["subscribe"];
}

function exactTargetOrigin(value: unknown): string {
  const text = String(value || "").trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new TypeError("스트리밍 브리지 대상 origin이 올바르지 않습니다.");
  }
  const allowedPlatformOrigin = [
    "https://chzzk.naver.com",
    "https://vod.sooplive.com",
    "https://www.youtube-nocookie.com"
  ].includes(url.origin);
  if (
    text !== url.origin
    || !allowedPlatformOrigin
    || url.username
    || url.password
  ) {
    throw new TypeError(
      "스트리밍 브리지는 현재 embed의 exact CHZZK·SOOP·YouTube No-Cookie HTTPS origin만 허용합니다."
    );
  }
  return url.origin;
}

/**
 * Browser-only transport. It never uses `*`: both outbound targetOrigin and
 * inbound WindowProxy/origin must match the currently embedded player.
 */
export function createStreamingBridgeWindowTransport({
  targetOrigin: rawTargetOrigin,
  targetWindow,
  hostWindow = window
}: StreamingBridgeWindowTransportOptions): StreamingBridgeWindowTransport {
  const targetOrigin = exactTargetOrigin(rawTargetOrigin);
  return Object.freeze({
    send(request: StreamingBridgeRequest): void {
      const destination = targetWindow();
      if (!destination) {
        throw new Error("스트리밍 플레이어 iframe이 연결되지 않았습니다.");
      }
      destination.postMessage(request, targetOrigin);
    },
    subscribe(listener: (response: unknown) => void): () => void {
      const onMessage = (event: MessageEvent<unknown>): void => {
        const source = targetWindow();
        if (!source || event.source !== source || event.origin !== targetOrigin) {
          return;
        }
        listener(event.data);
      };
      hostWindow.addEventListener("message", onMessage);
      return () => hostWindow.removeEventListener("message", onMessage);
    }
  });
}
