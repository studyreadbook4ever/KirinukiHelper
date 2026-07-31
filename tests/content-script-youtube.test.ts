import assert from "node:assert/strict";
import test from "node:test";

test("YouTube SPA에서는 stale og:url 대신 URL과 활성 플레이어 ID를 대조한다", async (t) => {
  const mutableGlobals = globalThis as unknown as Record<string, unknown>;
  const originalGlobals = new Map<
    string,
    { existed: boolean; value: unknown }
  >();
  const installGlobal = (name: string, value: unknown) => {
    originalGlobals.set(name, {
      existed: Object.hasOwn(globalThis, name),
      value: mutableGlobals[name]
    });
    mutableGlobals[name] = value;
  };
  t.after(() => {
    for (const [name, original] of originalGlobals) {
      if (original.existed) {
        mutableGlobals[name] = original.value;
      } else {
        delete mutableGlobals[name];
      }
    }
    delete mutableGlobals.__kirinukiSourceBridgeLoaded;
  });

  interface MockElementOptions {
    attributes?: Record<string, string>;
    rect?: { width: number; height: number };
    querySelector?: (selector: string) => MockHTMLElement | null;
  }

  class MockHTMLElement {
    readonly attributes: Record<string, string>;
    readonly rect: { width: number; height: number };
    querySelector: (selector: string) => MockHTMLElement | null;
    readonly classList = { contains: (_name: string) => false };
    textContent = "";

    constructor({
      attributes = {},
      rect = { width: 1280, height: 720 },
      querySelector = () => null
    }: MockElementOptions = {}) {
      this.attributes = { ...attributes };
      this.rect = rect;
      this.querySelector = querySelector;
    }

    getAttribute(name: string) {
      return this.attributes[name] ?? null;
    }

    hasAttribute(name: string) {
      return Object.hasOwn(this.attributes, name);
    }

    getBoundingClientRect() {
      return {
        left: 0,
        top: 0,
        right: this.rect.width,
        bottom: this.rect.height,
        ...this.rect
      };
    }
  }

  let primaryShortRenderer: MockHTMLElement | null = null;
  class MockVideo extends MockHTMLElement {
    currentTime = 42.125;
    duration = 180;
    paused = false;
    playbackRate = 1;
    readyState = 4;
    seekable = {
      length: 1,
      start: (_index: number) => 0,
      end: (_index: number) => 180
    };

    constructor() {
      super();
    }

    closest(selector: string) {
      return selector === "ytd-reel-video-renderer"
        ? primaryShortRenderer
        : null;
    }
  }

  const ids = {
    old: "jhU8rfNzAFI",
    watch: "99SPe877vkI",
    shorts: "dQw4w9WgXcQ"
  };
  const location = {
    href: `https://www.youtube.com/watch?v=${ids.watch}`
  };
  const video = new MockVideo();
  const player = new MockHTMLElement();
  let activeWatchId = ids.watch;
  interface YouTubeContext {
    contentId: string;
    canonicalUrl: string;
    broadcastTitle: string;
    streamerName: string;
    description: string;
    imageUrl: string;
    channelId: string;
    contentType: string;
    player: {
      positionSeconds: number;
      liveEdgeOffsetSeconds: number | null;
      playbackRate: number;
    };
  }
  type BridgeResponse = (
    | { ok: true; context: YouTubeContext }
    | {
      ok: true;
      player: {
        currentTime: number;
        paused: boolean;
        playbackRate: number;
      };
    }
    | { ok: false; error: string }
  );
  interface BridgeMessage {
    type: string;
    action?: string;
    deltaSeconds?: number;
    playbackRate?: number;
  }
  type MessageListener = (
    message: BridgeMessage,
    sender: Record<string, unknown>,
    sendResponse: (response: BridgeResponse) => void
  ) => boolean;
  let messageListener: MessageListener | null = null;
  let adShowing = false;

  const meta = (content: string) => new MockHTMLElement({
    attributes: { content }
  });
  const document = {
    title: "새 영상 - YouTube",
    querySelector(selector: string) {
      if (
        adShowing
        && (
          selector === "#movie_player.ad-showing"
          || selector === ".html5-video-player.ad-showing"
        )
      ) {
        return player;
      }
      const fixed: Record<string, MockHTMLElement> = {
        "meta[property='og:title']": meta("이전 영상"),
        "meta[property='og:url']": meta(
          `https://www.youtube.com/watch?v=${ids.old}`
        ),
        "meta[property='og:description']": meta("이전 영상 설명"),
        "meta[property='og:image']": meta(
          "https://i.ytimg.com/vi/old/maxresdefault.jpg"
        ),
        "meta[itemprop='channelId']": meta("UC-stale-channel"),
        "meta[itemprop='author']": meta("이전 채널"),
        "meta[itemprop='isLiveBroadcast']": meta("true"),
        "#owner #channel-name a": Object.assign(
          new MockHTMLElement(),
          { textContent: "새 채널" }
        ),
        "#movie_player, .html5-video-player": player
      };
      if (Object.hasOwn(fixed, selector)) {
        return fixed[selector];
      }
      if (selector === "ytd-watch-flexy[video-id]") {
        return activeWatchId
          ? new MockHTMLElement({
            attributes: { "video-id": activeWatchId }
          })
          : null;
      }
      return null;
    },
    querySelectorAll(selector: string) {
      if (selector === "video") {
        return [video];
      }
      if (selector === "ytd-reel-video-renderer") {
        return primaryShortRenderer ? [primaryShortRenderer] : [];
      }
      return [];
    }
  };

  installGlobal("HTMLElement", MockHTMLElement);
  installGlobal("document", document);
  installGlobal("location", location);
  installGlobal("getComputedStyle", () => ({
    display: "block",
    visibility: "visible"
  }));
  installGlobal("chrome", {
    runtime: {
      onMessage: {
        addListener(listener: MessageListener) {
          messageListener = listener;
        }
      }
    }
  });

  const sourceUrl = new URL(
    `../src/content-script.js?youtube-spa=${Date.now()}`,
    import.meta.url
  );
  await import(sourceUrl.href);
  assert.equal(typeof messageListener, "function");

  const sendMessage = (
    message: BridgeMessage
  ) => new Promise<BridgeResponse>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("content-script 응답 시간 초과")),
      2_000
    );
    const listener = messageListener;
    assert.ok(listener);
    const keepChannelOpen = listener(
      message,
      {},
      (response: BridgeResponse) => {
        clearTimeout(timeout);
        resolve(response);
      }
    );
    assert.equal(keepChannelOpen, true);
  });
  const readContext = () => sendMessage({
    type: "KIRINUKI_GET_CONTEXT"
  });

  const watchResponse = await readContext();
  assert.equal(watchResponse.ok, true);
  assert.ok("context" in watchResponse);
  assert.equal(watchResponse.context.contentId, ids.watch);
  assert.equal(
    watchResponse.context.canonicalUrl,
    `https://www.youtube.com/watch?v=${ids.watch}`
  );
  assert.equal(watchResponse.context.broadcastTitle, "새 영상");
  assert.equal(watchResponse.context.streamerName, "새 채널");
  assert.equal(watchResponse.context.description, "");
  assert.equal(watchResponse.context.imageUrl, "");
  assert.equal(watchResponse.context.channelId, "");
  assert.equal(watchResponse.context.contentType, "vod");
  assert.equal(watchResponse.context.player.positionSeconds, 42.125);
  assert.equal(watchResponse.context.player.playbackRate, 1);
  assert.equal(
    watchResponse.context.player.liveEdgeOffsetSeconds,
    null,
    "VOD의 남은 재생시간을 라이브 지연으로 노출하면 안 됩니다."
  );

  const quarterSpeedResponse = await sendMessage({
    type: "KIRINUKI_PLAYER_COMMAND",
    action: "set-playback-rate",
    playbackRate: 0.25
  });
  assert.equal(quarterSpeedResponse.ok, true);
  assert.ok("player" in quarterSpeedResponse);
  assert.equal(quarterSpeedResponse.player.playbackRate, 0.25);
  assert.equal(video.playbackRate, 0.25);

  const doubleSpeedResponse = await sendMessage({
    type: "KIRINUKI_PLAYER_COMMAND",
    action: "set-playback-rate",
    playbackRate: 2
  });
  assert.equal(doubleSpeedResponse.ok, true);
  assert.ok("player" in doubleSpeedResponse);
  assert.equal(doubleSpeedResponse.player.playbackRate, 2);
  assert.equal(video.playbackRate, 2);

  const invalidSpeedResponse = await sendMessage({
    type: "KIRINUKI_PLAYER_COMMAND",
    action: "set-playback-rate",
    playbackRate: 1
  });
  assert.equal(invalidSpeedResponse.ok, false);
  assert.ok("error" in invalidSpeedResponse);
  assert.match(invalidSpeedResponse.error, /0\.25배 또는 2배/u);
  assert.equal(video.playbackRate, 2);

  const backwardSeekResponse = await sendMessage({
    type: "KIRINUKI_PLAYER_COMMAND",
    action: "seek-relative",
    deltaSeconds: -5
  });
  assert.equal(backwardSeekResponse.ok, true);
  assert.ok("player" in backwardSeekResponse);
  assert.ok(
    Math.abs(backwardSeekResponse.player.currentTime - 37.125) < 1e-9
  );
  assert.ok(Math.abs(video.currentTime - 37.125) < 1e-9);

  const forwardSeekResponse = await sendMessage({
    type: "KIRINUKI_PLAYER_COMMAND",
    action: "seek-relative",
    deltaSeconds: 5
  });
  assert.equal(forwardSeekResponse.ok, true);
  assert.ok("player" in forwardSeekResponse);
  assert.ok(
    Math.abs(forwardSeekResponse.player.currentTime - 42.125) < 1e-9
  );
  assert.ok(Math.abs(video.currentTime - 42.125) < 1e-9);

  video.seekable.start = (_index: number) => 10;
  video.seekable.end = (_index: number) => 170;
  video.currentTime = 12;
  const lowerClampedSeekResponse = await sendMessage({
    type: "KIRINUKI_PLAYER_COMMAND",
    action: "seek-relative",
    deltaSeconds: -5
  });
  assert.equal(lowerClampedSeekResponse.ok, true);
  assert.ok("player" in lowerClampedSeekResponse);
  assert.equal(lowerClampedSeekResponse.player.currentTime, 10);
  assert.equal(video.currentTime, 10);

  video.currentTime = 168;
  const upperClampedSeekResponse = await sendMessage({
    type: "KIRINUKI_PLAYER_COMMAND",
    action: "seek-relative",
    deltaSeconds: 5
  });
  assert.equal(upperClampedSeekResponse.ok, true);
  assert.ok("player" in upperClampedSeekResponse);
  assert.equal(upperClampedSeekResponse.player.currentTime, 170);
  assert.equal(video.currentTime, 170);

  const invalidSeekResponse = await sendMessage({
    type: "KIRINUKI_PLAYER_COMMAND",
    action: "seek-relative",
    deltaSeconds: 4
  });
  assert.equal(invalidSeekResponse.ok, false);
  assert.ok("error" in invalidSeekResponse);
  assert.match(invalidSeekResponse.error, /5초/u);
  assert.equal(video.currentTime, 170);

  adShowing = true;
  video.currentTime = 42.125;
  const adBlockedSeekResponse = await sendMessage({
    type: "KIRINUKI_PLAYER_COMMAND",
    action: "seek-relative",
    deltaSeconds: 5
  });
  assert.equal(adBlockedSeekResponse.ok, false);
  assert.ok("error" in adBlockedSeekResponse);
  assert.match(adBlockedSeekResponse.error, /광고 재생 중/u);
  assert.equal(video.currentTime, 42.125);

  const adBlockedResponse = await sendMessage({
    type: "KIRINUKI_PLAYER_COMMAND",
    action: "set-playback-rate",
    playbackRate: 0.25
  });
  assert.equal(adBlockedResponse.ok, false);
  assert.ok("error" in adBlockedResponse);
  assert.match(adBlockedResponse.error, /광고 재생 중/u);
  assert.equal(video.playbackRate, 2);
  adShowing = false;

  activeWatchId = ids.old;
  const transitionResponse = await readContext();
  assert.equal(transitionResponse.ok, false);
  assert.ok("error" in transitionResponse);
  assert.match(transitionResponse.error, /전환되는 중/u);

  activeWatchId = "";
  location.href = `https://www.youtube.com/shorts/${ids.shorts}`;
  primaryShortRenderer = new MockHTMLElement({
    querySelector: (selector) => (
      selector.startsWith("a.ytp-title-link")
        ? new MockHTMLElement({
          attributes: {
            href: `https://www.youtube.com/shorts/${ids.shorts}`
          }
        })
        : null
    )
  });
  const shortsResponse = await readContext();
  assert.equal(shortsResponse.ok, true);
  assert.ok("context" in shortsResponse);
  assert.equal(shortsResponse.context.contentId, ids.shorts);
  assert.equal(
    shortsResponse.context.canonicalUrl,
    `https://www.youtube.com/watch?v=${ids.shorts}`
  );
});
