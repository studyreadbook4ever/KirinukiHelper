export const YOUTUBE_IFRAME_API_SCRIPT_URL =
  "https://www.youtube.com/iframe_api";
export const YOUTUBE_IFRAME_API_SCRIPT_ID = "kirinuki-youtube-iframe-api";
export const YOUTUBE_IFRAME_API_LOAD_TIMEOUT_MS = 15_000;

export interface YouTubeIframePlayer {
  destroy(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlaybackRate(): number;
  getPlayerState(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setPlaybackRate(rate: number): void;
}

export interface YouTubeIframePlayerEvent {
  readonly target: YouTubeIframePlayer;
  readonly data?: number;
}

export interface YouTubeIframePlayerOptions {
  readonly events: {
    readonly onReady: (event: YouTubeIframePlayerEvent) => void;
    readonly onStateChange?: (event: YouTubeIframePlayerEvent) => void;
    readonly onPlaybackRateChange?: (event: YouTubeIframePlayerEvent) => void;
    readonly onError?: (event: YouTubeIframePlayerEvent) => void;
  };
}

export interface YouTubeIframeApi {
  readonly Player: new (
    element: HTMLIFrameElement,
    options: YouTubeIframePlayerOptions
  ) => YouTubeIframePlayer;
}

export interface YouTubePlayerSnapshot {
  readonly currentTime: number;
  readonly duration: number | null;
  readonly playbackRate: number;
  readonly playerState: number | null;
}

declare global {
  interface Window {
    YT?: YouTubeIframeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YouTubeIframeApi> | null = null;

export interface YouTubeIframeApiLoadOptions {
  /** Primarily exposed so a stalled-load regression can run without waiting 15 seconds. */
  readonly timeoutMs?: number;
}

function usableApi(value: unknown): value is YouTubeIframeApi {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as { Player?: unknown }).Player === "function"
  );
}

function finiteNonNegative(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function finitePositive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Reads only the documented YT.Player getters. Player errors and transient
 * pre-ready values degrade to null instead of fabricating a local clock.
 */
export function readYouTubePlayerSnapshot(
  player: YouTubeIframePlayer
): YouTubePlayerSnapshot | null {
  try {
    const currentTime = finiteNonNegative(player.getCurrentTime());
    if (currentTime === null) {
      return null;
    }
    const duration = finiteNonNegative(player.getDuration());
    const playbackRate = finitePositive(player.getPlaybackRate()) ?? 1;
    const stateCandidate = Number(player.getPlayerState());
    const playerState = Number.isInteger(stateCandidate)
      && stateCandidate >= -1
      && stateCandidate <= 5
      ? stateCandidate
      : null;
    return Object.freeze({
      currentTime,
      duration: duration && duration > 0 ? duration : null,
      playbackRate,
      playerState
    });
  } catch {
    return null;
  }
}

/**
 * Loads Google's documented browser API lazily and once. This remains a
 * client-only integration: the localhost server only serves Kirinuki files.
 */
export function loadYouTubeIframeApi({
  timeoutMs = YOUTUBE_IFRAME_API_LOAD_TIMEOUT_MS
}: YouTubeIframeApiLoadOptions = {}): Promise<YouTubeIframeApi> {
  if (usableApi(window.YT)) {
    return Promise.resolve(window.YT);
  }
  if (apiPromise) {
    return apiPromise;
  }
  const boundedTimeoutMs = Number.isFinite(timeoutMs)
    ? Math.max(1, Math.floor(timeoutMs))
    : YOUTUBE_IFRAME_API_LOAD_TIMEOUT_MS;
  let resolvePending!: (api: YouTubeIframeApi) => void;
  let rejectPending!: (error: Error) => void;
  const pending = new Promise<YouTubeIframeApi>((resolve, reject) => {
    resolvePending = resolve;
    rejectPending = reject;
  });
  // Publish the exact attempt before installing script callbacks. A synchronous
  // DOM failure can therefore clear only itself, never a later retry.
  apiPromise = pending;
  const previousReady = window.onYouTubeIframeAPIReady;
  let settled = false;
  let script: HTMLScriptElement | null = null;
  let timer: number | null = null;

  const restoreReadyCallback = (): void => {
    if (window.onYouTubeIframeAPIReady !== ready) {
      return;
    }
    if (previousReady) {
      window.onYouTubeIframeAPIReady = previousReady;
    } else {
      delete window.onYouTubeIframeAPIReady;
    }
  };
  const settle = (
    result: { api: YouTubeIframeApi } | { error: Error }
  ): void => {
    if (settled) {
      return;
    }
    settled = true;
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    script?.removeEventListener("error", onError);
    restoreReadyCallback();
    if ("api" in result) {
      resolvePending(result.api);
      return;
    }
    if (script?.id === YOUTUBE_IFRAME_API_SCRIPT_ID) {
      script.remove();
    }
    if (apiPromise === pending) {
      apiPromise = null;
    }
    rejectPending(result.error);
  };
  const ready = (): void => {
    try {
      previousReady?.();
    } catch (error) {
      console.warn("기존 YouTube IFrame API 준비 콜백이 실패했습니다.", error);
    }
    if (usableApi(window.YT)) {
      settle({ api: window.YT });
      return;
    }
    settle({
      error: new Error("YouTube IFrame Player API가 준비되지 않았습니다.")
    });
  };
  const onError = (): void => {
    settle({
      error: new Error("YouTube IFrame Player API를 불러오지 못했습니다.")
    });
  };

  try {
    window.onYouTubeIframeAPIReady = ready;
    const existing = document.getElementById(YOUTUBE_IFRAME_API_SCRIPT_ID);
    let appendScript = false;
    if (existing instanceof HTMLScriptElement) {
      script = existing;
    } else {
      existing?.remove();
      script = document.createElement("script");
      script.id = YOUTUBE_IFRAME_API_SCRIPT_ID;
      script.src = YOUTUBE_IFRAME_API_SCRIPT_URL;
      script.async = true;
      // The official IFrame Player API requires an HTTP Referer/client
      // identity (error 153 without one). Only the localhost origin is sent.
      script.referrerPolicy = "strict-origin-when-cross-origin";
      appendScript = true;
    }
    script.addEventListener("error", onError, { once: true });
    timer = window.setTimeout(() => {
      settle({
        error: new Error(
          `YouTube IFrame Player API가 ${boundedTimeoutMs}ms 안에 준비되지 않았습니다.`
        )
      });
    }, boundedTimeoutMs);
    if (appendScript) {
      document.head.append(script);
    }
  } catch (error) {
    settle({
      error: error instanceof Error
        ? error
        : new Error("YouTube IFrame Player API 초기화에 실패했습니다.")
    });
  }
  return pending;
}
