export const YOUTUBE_PRIVACY_EMBED_ORIGIN =
  "https://www.youtube-nocookie.com";

export interface YouTubeEmbedSnapshot {
  readonly currentTime: number;
  readonly duration: number | null;
  readonly playbackRate: number;
  readonly playerState: number | null;
}

export interface YouTubeEmbedControllerOptions {
  readonly frame: HTMLIFrameElement;
  readonly contentId: string;
  readonly onReady: () => void;
  readonly onUpdate: (snapshot: YouTubeEmbedSnapshot) => void;
  readonly onError: (message: string) => void;
}

interface YouTubeDelivery {
  readonly event?: unknown;
  readonly id?: unknown;
  readonly info?: unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNonNegative(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function finitePositive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function playerState(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= -1 && parsed <= 5
    ? parsed
    : null;
}

function parseDelivery(value: unknown): YouTubeDelivery | null {
  if (typeof value === "string") {
    try {
      return record(JSON.parse(value)) as YouTubeDelivery | null;
    } catch {
      return null;
    }
  }
  return record(value) as YouTubeDelivery | null;
}

export class YouTubeEmbedController {
  readonly #frame: HTMLIFrameElement;
  readonly #contentId: string;
  readonly #id: string;
  readonly #onReady: () => void;
  readonly #onUpdate: (snapshot: YouTubeEmbedSnapshot) => void;
  readonly #onError: (message: string) => void;
  #snapshot: YouTubeEmbedSnapshot | null = null;
  #ready = false;
  #destroyed = false;
  #pollTimer: number | null = null;

  constructor({
    frame,
    contentId,
    onReady,
    onUpdate,
    onError
  }: YouTubeEmbedControllerOptions) {
    if (!contentId.trim()) {
      throw new TypeError("YouTube VOD 식별자가 없습니다.");
    }
    this.#frame = frame;
    this.#contentId = contentId;
    this.#id = `kirinuki-${crypto.randomUUID()}`;
    this.#onReady = onReady;
    this.#onUpdate = onUpdate;
    this.#onError = onError;
    window.addEventListener("message", this.#receive);
    this.#pollTimer = window.setInterval(this.#poll, 250);
    this.#poll();
  }

  get snapshot(): YouTubeEmbedSnapshot | null {
    return this.#snapshot;
  }

  refresh(): void {
    if (this.#destroyed) {
      return;
    }
    this.#listen();
    this.#requestSnapshot();
  }

  seekTo(seconds: number): void {
    const target = finiteNonNegative(seconds);
    if (target === null) {
      throw new TypeError("YouTube 이동 시각이 올바르지 않습니다.");
    }
    this.#command("seekTo", [target, true]);
    this.#requestSnapshot();
  }

  setPlaybackRate(rate: number): void {
    const next = finitePositive(rate);
    if (next === null) {
      throw new TypeError("YouTube 재생 속도가 올바르지 않습니다.");
    }
    this.#command("setPlaybackRate", [next]);
    this.#requestSnapshot();
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    if (this.#pollTimer !== null) {
      window.clearInterval(this.#pollTimer);
      this.#pollTimer = null;
    }
    window.removeEventListener("message", this.#receive);
  }

  #post(message: Readonly<Record<string, unknown>>): void {
    if (this.#destroyed || !this.#frame.contentWindow) {
      return;
    }
    this.#frame.contentWindow.postMessage(
      JSON.stringify(message),
      YOUTUBE_PRIVACY_EMBED_ORIGIN
    );
  }

  #listen(): void {
    this.#post({
      event: "listening",
      id: this.#id,
      channel: "widget"
    });
    for (const eventName of [
      "onReady",
      "onStateChange",
      "onPlaybackRateChange",
      "onError"
    ]) {
      this.#command("addEventListener", [eventName]);
    }
  }

  #command(func: string, args: readonly unknown[] = []): void {
    this.#post({
      event: "command",
      func,
      args,
      id: this.#id,
      channel: "widget"
    });
  }

  #requestSnapshot(): void {
    for (const func of [
      "getCurrentTime",
      "getDuration",
      "getPlaybackRate",
      "getPlayerState"
    ]) {
      this.#command(func);
    }
  }

  #poll = (): void => {
    if (this.#destroyed) {
      return;
    }
    if (!this.#ready) {
      this.#listen();
      return;
    }
    this.#requestSnapshot();
  };

  #receive = (event: MessageEvent): void => {
    if (
      this.#destroyed
      || event.origin !== YOUTUBE_PRIVACY_EMBED_ORIGIN
      || event.source !== this.#frame.contentWindow
    ) {
      return;
    }
    const delivery = parseDelivery(event.data);
    if (!delivery) {
      return;
    }
    const eventName = String(delivery.event || "");
    if (
      delivery.id !== undefined
      && delivery.id !== null
      && delivery.id !== this.#id
    ) {
      return;
    }
    if (eventName === "onError") {
      this.#onError("YouTube 플레이어가 이 VOD를 재생하지 못했습니다.");
      return;
    }
    const info = record(delivery.info);
    if (!info) {
      if (eventName === "onReady" && !this.#ready) {
        this.#ready = true;
        this.#onReady();
        this.#requestSnapshot();
      }
      return;
    }
    const videoData = record(info.videoData);
    const deliveredContentId = String(videoData?.video_id || "");
    if (deliveredContentId && deliveredContentId !== this.#contentId) {
      this.#onError("YouTube 플레이어가 입력한 VOD와 다른 영상을 보고했습니다.");
      this.destroy();
      return;
    }
    const previous = this.#snapshot;
    const currentTime = finiteNonNegative(info.currentTime)
      ?? previous?.currentTime
      ?? null;
    if (currentTime === null) {
      return;
    }
    const duration = finiteNonNegative(info.duration)
      ?? previous?.duration
      ?? null;
    const playbackRate = finitePositive(info.playbackRate)
      ?? previous?.playbackRate
      ?? 1;
    const next: YouTubeEmbedSnapshot = Object.freeze({
      currentTime,
      duration: duration && duration > 0 ? duration : null,
      playbackRate,
      playerState: playerState(info.playerState) ?? previous?.playerState ?? null
    });
    this.#snapshot = next;
    if (!this.#ready) {
      this.#ready = true;
      this.#onReady();
    }
    this.#onUpdate(next);
  };
}
