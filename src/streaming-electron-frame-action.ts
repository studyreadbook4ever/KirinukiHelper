import {
  createHtmlVideoStreamingBridgeAdapter,
  createSoopVodStreamingBridgeAdapter
} from "./web/streaming-bridge-content.js";

const RESPONSE_SCHEMA = "kirinuki-electron-frame-action/v1" as const;

type FramePlatform = "CHZZK" | "YOUTUBE" | "SOOP";

type ActionInput =
  | Readonly<{ readonly action: "snapshot" }>
  | Readonly<{
    readonly action: "seek-absolute";
    readonly targetSeconds: number;
  }>
  | Readonly<{
    readonly action: "set-playback-rate";
    readonly playbackRate: 0.25 | 2;
  }>;

function exactInput(value: unknown): ActionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("frame action이 올바르지 않습니다.");
  }
  const record = value as Record<string, unknown>;
  if (
    record.action === "snapshot"
    && Object.keys(record).join(",") === "action"
  ) {
    return Object.freeze({ action: "snapshot" });
  }
  if (
    record.action === "seek-absolute"
    && Object.keys(record).sort().join(",") === "action,targetSeconds"
    && typeof record.targetSeconds === "number"
    && Number.isFinite(record.targetSeconds)
    && record.targetSeconds >= 0
    && record.targetSeconds <= 2_592_000
  ) {
    return Object.freeze({
      action: "seek-absolute",
      targetSeconds: record.targetSeconds
    });
  }
  if (
    record.action === "set-playback-rate"
    && Object.keys(record).sort().join(",") === "action,playbackRate"
    && (record.playbackRate === 0.25 || record.playbackRate === 2)
  ) {
    return Object.freeze({
      action: "set-playback-rate",
      playbackRate: record.playbackRate
    });
  }
  throw new TypeError("frame action 필드가 올바르지 않습니다.");
}

function exactCurrentSource(): Readonly<{
  platform: FramePlatform;
  channelId: "";
  contentId: string;
  contentType: "vod";
}> {
  const url = new URL(location.href);
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  let platform: FramePlatform | null = null;
  let contentId: string | undefined;
  if (
    url.protocol === "https:"
    && !url.port
    && !url.username
    && !url.password
    && !url.hash
  ) {
    if (
      hostname === "chzzk.naver.com"
      && !url.search
    ) {
      contentId = /^\/video\/(\d{1,32})\/?$/u.exec(url.pathname)?.[1];
      platform = contentId ? "CHZZK" : null;
    } else if (
      hostname === "www.youtube-nocookie.com"
      && url.searchParams.size === 1
      && url.searchParams.get("playsinline") === "1"
    ) {
      contentId = /^\/embed\/([A-Za-z0-9_-]{11})$/u.exec(url.pathname)?.[1];
      platform = contentId ? "YOUTUBE" : null;
    } else if (
      hostname === "vod.sooplive.com"
      && url.searchParams.size === 3
      && [...url.searchParams.keys()].sort().join(",")
        === "autoPlay,mutePlay,showChat"
      && url.searchParams.get("autoPlay") === "true"
      && url.searchParams.get("mutePlay") === "true"
      && url.searchParams.get("showChat") === "false"
    ) {
      contentId = /^\/player\/(\d{1,32})\/embed$/u.exec(url.pathname)?.[1];
      platform = contentId ? "SOOP" : null;
    }
  }
  if (!platform || !contentId) {
    throw new TypeError("현재 player frame 문서가 허용 범위를 벗어났습니다.");
  }
  return Object.freeze({
    platform,
    channelId: "",
    contentId,
    contentType: "vod"
  });
}

export async function executeKirinukiStreamingFrameAction(
  value: unknown
): Promise<unknown> {
  const input = exactInput(value);
  const sourceBefore = exactCurrentSource();
  const adapter = sourceBefore.platform === "SOOP"
    ? createSoopVodStreamingBridgeAdapter({
      readSource: exactCurrentSource,
      hostDocument: document,
      hostWindow: window,
      seekVerificationTimeoutMs: 2_500
    })
    : createHtmlVideoStreamingBridgeAdapter({
      readSource: exactCurrentSource,
      hostDocument: document,
      seekVerificationTimeoutMs: 2_400
    });
  if (input.action === "seek-absolute") {
    await adapter.seekAbsolute(input.targetSeconds);
  } else if (input.action === "set-playback-rate") {
    await adapter.setPlaybackRate(input.playbackRate);
  }
  const player = await adapter.snapshot();
  const sourceAfter = exactCurrentSource();
  if (
    sourceBefore.platform !== sourceAfter.platform
    || sourceBefore.contentId !== sourceAfter.contentId
  ) {
    throw new Error("frame action 중 원본 회차가 바뀌었습니다.");
  }
  return Object.freeze({
    schema: RESPONSE_SCHEMA,
    platform: sourceAfter.platform,
    contentId: sourceAfter.contentId,
    player
  });
}
