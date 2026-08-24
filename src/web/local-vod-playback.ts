import Hls from "hls.js";

import {
  localMediaEngineLoopbackRequestInit
} from "../lib/local-media-engine-contract.js";
import {
  LOCAL_VOD_PLAYBACK_CREATE_PROTOCOL,
  localVodPlaybackPartForSourceTime,
  localVodPlaybackSourceSeconds,
  localVodPlaybackCreateRequest,
  parseLocalVodPlaybackSession
} from "../lib/local-vod-playback.js";
import type {
  LocalVodPlaybackSession
} from "../lib/local-vod-playback.js";

const CREATE_ENDPOINT = "http://127.0.0.1:4319/v1/playback";
const SEEK_TOLERANCE_SECONDS = 0.05;
const SEEK_TIMEOUT_MS = 15_000;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function waitForMediaTime(
  video: HTMLVideoElement,
  targetSeconds: number
): Promise<void> {
  const deadline = Date.now() + SEEK_TIMEOUT_MS;
  do {
    if (
      video.readyState >= HTMLMediaElement.HAVE_METADATA
      && !video.seeking
      && Number.isFinite(video.currentTime)
      && Math.abs(video.currentTime - targetSeconds) <= SEEK_TOLERANCE_SECONDS
    ) {
      return;
    }
    await delay(25);
  } while (Date.now() <= deadline);
  throw new Error("원본 영상과 컷 시각을 같은 위치로 맞추지 못했습니다.");
}

export interface LocalVodWebPlaybackSnapshot {
  readonly currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly playbackRate: number;
  readonly readyState: number;
}

export class LocalVodWebPlaybackController {
  readonly session: LocalVodPlaybackSession;
  readonly video: HTMLVideoElement;
  readonly #hls: Hls;
  #partIndex = 0;
  #loadGeneration = 0;
  #disposed = false;

  get #closeUrl(): string {
    const manifest = new URL(this.session.parts[0]!.manifestUrl);
    manifest.pathname = manifest.pathname.replace(
      /\/part\/0\/index\.m3u8$/u,
      ""
    );
    return manifest.href;
  }

  private constructor(
    session: LocalVodPlaybackSession,
    video: HTMLVideoElement,
    hls: Hls
  ) {
    this.session = session;
    this.video = video;
    this.#hls = hls;
    this.#hls.attachMedia(video);
    this.video.addEventListener("ended", this.#handleEnded);
  }

  static async connect({
    sourceUrl,
    video,
    fetchImpl = fetch
  }: {
    readonly sourceUrl: string;
    readonly video: HTMLVideoElement;
    readonly fetchImpl?: typeof fetch;
  }): Promise<LocalVodWebPlaybackController> {
    if (!Hls.isSupported()) {
      throw new Error("이 브라우저가 웹 HLS 원본 재생을 지원하지 않습니다.");
    }
    const request = localVodPlaybackCreateRequest(sourceUrl);
    const response = await fetchImpl(CREATE_ENDPOINT, localMediaEngineLoopbackRequestInit({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Kirinuki-Protocol": LOCAL_VOD_PLAYBACK_CREATE_PROTOCOL
      },
      body: JSON.stringify(request),
      cache: "no-store",
      credentials: "omit",
      mode: "cors"
    }));
    if (!response.ok) {
      throw new Error("영상 준비 도우미가 원본 재생 정보를 열지 못했습니다.");
    }
    const session = parseLocalVodPlaybackSession(
      await response.json(),
      request.sourceUrl
    );
    if (!session) {
      throw new Error("영상 준비 도우미의 원본 재생 응답이 올바르지 않습니다.");
    }
    const hls = new Hls({
      backBufferLength: 60,
      enableCEA708Captions: false,
      enableDateRangeMetadataCues: false,
      enableEmsgKLVMetadata: false,
      enableEmsgMetadataCues: false,
      enableID3MetadataCues: false,
      enableWebVTT: false,
      enableWorker: true,
      lowLatencyMode: false,
      maxBufferLength: 60,
      maxMaxBufferLength: 120,
      renderTextTracksNatively: false
    });
    const controller = new LocalVodWebPlaybackController(session, video, hls);
    try {
      await controller.#loadPart(0, 0, false);
      return controller;
    } catch (error) {
      controller.dispose();
      throw error;
    }
  }

  snapshot(): LocalVodWebPlaybackSnapshot | null {
    const part = this.session.parts[this.#partIndex];
    if (
      this.#disposed
      || !part
      || this.video.readyState < HTMLMediaElement.HAVE_METADATA
      || this.video.seeking
      || !Number.isFinite(this.video.currentTime)
    ) {
      return null;
    }
    return Object.freeze({
      currentTime: localVodPlaybackSourceSeconds(part, this.video.currentTime),
      duration: this.session.durationSeconds,
      paused: this.video.paused,
      playbackRate: this.video.playbackRate,
      readyState: this.video.readyState
    });
  }

  async seekAbsolute(sourceSeconds: number): Promise<LocalVodWebPlaybackSnapshot> {
    if (!Number.isFinite(sourceSeconds) || sourceSeconds < 0) {
      throw new TypeError("이동할 원본 시각이 올바르지 않습니다.");
    }
    const target = Math.min(this.session.durationSeconds, sourceSeconds);
    const part = localVodPlaybackPartForSourceTime(this.session, target);
    const localSeconds = Math.max(
      0,
      Math.min(part.endSeconds - part.startSeconds, target - part.startSeconds)
    );
    if (part.index !== this.#partIndex) {
      await this.#loadPart(part.index, localSeconds, !this.video.paused);
    } else {
      this.video.currentTime = localSeconds;
      await waitForMediaTime(this.video, localSeconds);
    }
    const snapshot = this.snapshot();
    if (
      !snapshot
      || Math.abs(snapshot.currentTime - target) > SEEK_TOLERANCE_SECONDS
    ) {
      throw new Error("영상 재생 시각과 컷 시각이 일치하지 않습니다.");
    }
    return snapshot;
  }

  setPlaybackRate(playbackRate: 0.25 | 2): LocalVodWebPlaybackSnapshot {
    this.video.playbackRate = playbackRate;
    const snapshot = this.snapshot();
    if (!snapshot || snapshot.playbackRate !== playbackRate) {
      throw new Error("원본 영상 재생 속도를 바꾸지 못했습니다.");
    }
    return snapshot;
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#loadGeneration += 1;
    this.video.removeEventListener("ended", this.#handleEnded);
    this.#hls.destroy();
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    void fetch(this.#closeUrl, localMediaEngineLoopbackRequestInit({
      method: "DELETE",
      cache: "no-store",
      credentials: "omit",
      keepalive: true,
      mode: "cors"
    })).catch(() => undefined);
  }

  readonly #handleEnded = (): void => {
    const nextPart = this.session.parts[this.#partIndex + 1];
    if (!nextPart || this.#disposed) {
      return;
    }
    void this.#loadPart(nextPart.index, 0, true);
  };

  async #loadPart(
    partIndex: number,
    localSeconds: number,
    playAfterLoad: boolean
  ): Promise<void> {
    const part = this.session.parts[partIndex];
    if (!part || this.#disposed) {
      throw new Error("원본 VOD 파트를 열 수 없습니다.");
    }
    const generation = ++this.#loadGeneration;
    this.#partIndex = partIndex;
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        this.#hls.off(Hls.Events.MANIFEST_PARSED, parsed);
        this.#hls.off(Hls.Events.ERROR, failed);
      };
      const parsed = (): void => {
        cleanup();
        resolve();
      };
      const failed = (_event: string, data: { fatal: boolean; details: string }): void => {
        if (!data.fatal) {
          return;
        }
        cleanup();
        reject(new Error(`원본 HLS 재생 실패: ${data.details}`));
      };
      this.#hls.on(Hls.Events.MANIFEST_PARSED, parsed);
      this.#hls.on(Hls.Events.ERROR, failed);
      this.#hls.loadSource(part.manifestUrl);
    });
    if (generation !== this.#loadGeneration || this.#disposed) {
      throw new DOMException("더 새로운 원본 재생 요청이 시작됐습니다.", "AbortError");
    }
    this.video.currentTime = localSeconds;
    await waitForMediaTime(this.video, localSeconds);
    if (playAfterLoad) {
      await this.video.play();
    }
  }
}
