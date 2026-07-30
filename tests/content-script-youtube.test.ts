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
    };
  }
  type BridgeResponse =
    | { ok: true; context: YouTubeContext }
    | { ok: false; error: string };
  type MessageListener = (
    message: { type: string },
    sender: Record<string, unknown>,
    sendResponse: (response: BridgeResponse) => void
  ) => boolean;
  let messageListener: MessageListener | null = null;

  const meta = (content: string) => new MockHTMLElement({
    attributes: { content }
  });
  const document = {
    title: "새 영상 - YouTube",
    querySelector(selector: string) {
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

  const readContext = () => new Promise<BridgeResponse>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("content-script 응답 시간 초과")),
      2_000
    );
    const listener = messageListener;
    assert.ok(listener);
    const keepChannelOpen = listener(
      { type: "KIRINUKI_GET_CONTEXT" },
      {},
      (response: BridgeResponse) => {
        clearTimeout(timeout);
        resolve(response);
      }
    );
    assert.equal(keepChannelOpen, true);
  });

  const watchResponse = await readContext();
  assert.equal(watchResponse.ok, true);
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
  assert.equal(
    watchResponse.context.player.liveEdgeOffsetSeconds,
    null,
    "VOD의 남은 재생시간을 라이브 지연으로 노출하면 안 됩니다."
  );

  activeWatchId = ids.old;
  const transitionResponse = await readContext();
  assert.equal(transitionResponse.ok, false);
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
  assert.equal(shortsResponse.context.contentId, ids.shorts);
  assert.equal(
    shortsResponse.context.canonicalUrl,
    `https://www.youtube.com/watch?v=${ids.shorts}`
  );
});
