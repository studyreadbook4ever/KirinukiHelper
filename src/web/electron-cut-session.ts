import {
  StreamingBridgeClient
} from "./streaming-bridge-client.js";
import type {
  StreamingBridgePlayerSnapshot,
  StreamingBridgeRequest,
  StreamingBridgeSourceIdentity
} from "./streaming-bridge-protocol.js";

export interface ElectronCutHostApi {
  readonly playerAction: (request: unknown) => Promise<unknown>;
  readonly onTrustedShortcut?: (
    listener: (message: Readonly<{ key: string }>) => void
  ) => () => void;
}

export class ElectronCutSession {
  readonly #host: Readonly<ElectronCutHostApi>;
  #transportEpoch = 0;
  #client: StreamingBridgeClient | null = null;
  #snapshot: StreamingBridgePlayerSnapshot | null = null;
  #binding: Promise<Readonly<{
    transportEpoch: number;
    documentGeneration: number;
  }>> | null = null;

  constructor(host: Readonly<ElectronCutHostApi>) {
    this.#host = host;
  }

  get snapshot(): StreamingBridgePlayerSnapshot | null {
    return this.#snapshot;
  }

  get ready(): boolean {
    return Boolean(
      this.#client
      && this.#snapshot?.found
      && this.#snapshot.currentTime !== null
    );
  }

  async connect(
    source: Readonly<StreamingBridgeSourceIdentity>
  ): Promise<StreamingBridgePlayerSnapshot> {
    this.destroy();
    const transportEpoch = ++this.#transportEpoch;
    this.#binding = this.#host.playerAction({
      type: "invalidate",
      transportEpoch
    }).then((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Electron 플레이어 문서 연결 응답이 없습니다.");
      }
      const record = value as Record<string, unknown>;
      if (
        record.status !== "invalidated"
        || record.transportEpoch !== transportEpoch
        || !Number.isSafeInteger(record.documentGeneration)
        || Number(record.documentGeneration) <= 0
      ) {
        throw new Error("Electron 플레이어 문서 연결 응답이 올바르지 않습니다.");
      }
      return Object.freeze({
        transportEpoch,
        documentGeneration: Number(record.documentGeneration)
      });
    });
    const listeners = new Set<(response: unknown) => void>();
    this.#client = new StreamingBridgeClient({
      source,
      requestTimeoutMs: 900,
      maxDeliveryAttempts: 3,
      send: async (request: StreamingBridgeRequest) => {
        const binding = await this.#binding;
        if (
          !binding
          || binding.transportEpoch !== this.#transportEpoch
        ) {
          throw new DOMException("Electron 컷 세션이 바뀌었습니다.", "AbortError");
        }
        const response = await this.#host.playerAction({
          type: "request",
          transportEpoch: binding.transportEpoch,
          documentGeneration: binding.documentGeneration,
          request
        });
        for (const listener of listeners) {
          listener(response);
        }
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    });
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const snapshot = await this.#client.snapshot();
        if (snapshot.found && snapshot.currentTime !== null) {
          this.#snapshot = snapshot;
          return snapshot;
        }
      } catch (error) {
        lastError = error;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 125));
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Electron 플레이어의 재생 시각을 찾지 못했습니다.");
  }

  async refresh(): Promise<StreamingBridgePlayerSnapshot> {
    if (!this.#client) {
      throw new Error("Electron 컷 세션이 아직 연결되지 않았습니다.");
    }
    this.#snapshot = await this.#client.snapshot();
    return this.#snapshot;
  }

  async seekBy(deltaSeconds: -5 | 5): Promise<StreamingBridgePlayerSnapshot> {
    const before = await this.refresh();
    const currentTime = before.currentTime;
    if (currentTime === null || !this.#client) {
      throw new Error("Electron 플레이어의 현재 시각을 읽지 못했습니다.");
    }
    const minimum = before.seekableStart ?? 0;
    const maximum = before.seekableEnd
      ?? before.duration
      ?? Number.POSITIVE_INFINITY;
    this.#snapshot = await this.#client.seekAbsolute(
      Math.min(maximum, Math.max(minimum, currentTime + deltaSeconds))
    );
    return this.#snapshot;
  }

  async setPlaybackRate(
    playbackRate: 0.25 | 2
  ): Promise<StreamingBridgePlayerSnapshot> {
    if (!this.#client) {
      throw new Error("Electron 컷 세션이 아직 연결되지 않았습니다.");
    }
    this.#snapshot = await this.#client.setPlaybackRate(playbackRate);
    return this.#snapshot;
  }

  destroy(): void {
    this.#client?.destroy();
    this.#client = null;
    this.#snapshot = null;
    this.#binding = null;
  }
}
