import assert from "node:assert/strict";
import test from "node:test";

test("치지직 SPA에서는 stale canonical 대신 현재 URL의 VOD 식별자를 사용한다", async (t) => {
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
  }

  class MockHTMLElement {
    readonly attributes: Record<string, string>;
    readonly rect: { width: number; height: number };
    readonly classList = { contains: (_name: string) => false };
    textContent = "";
    href = "";

    constructor({
      attributes = {},
      rect = { width: 1280, height: 720 }
    }: MockElementOptions = {}) {
      this.attributes = { ...attributes };
      this.rect = rect;
    }

    getAttribute(name: string) {
      return this.attributes[name] ?? null;
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

  class MockVideo extends MockHTMLElement {
    currentTime = 123.456;
    duration = 3_600;
    paused = false;
    playbackRate = 1;
    readyState = 4;
    seekable = {
      length: 1,
      start: (_index: number) => 0,
      end: (_index: number) => 3_600
    };

    constructor() {
      super();
    }
  }

  interface ChzzkBridgeResponse {
    ok: true;
    context: {
      contentId: string;
      canonicalUrl: string;
      channelId: string;
      streamerName: string;
      broadcastTitle: string;
      player: { positionSeconds: number };
    };
  }

  type MessageListener = (
    message: { type: string },
    sender: Record<string, unknown>,
    sendResponse: (response: ChzzkBridgeResponse) => void
  ) => boolean;

  const previousVideoId = "14405629";
  const currentVideoId = "13583412";
  const channelId = "088973112d8acc831ec20274f7ffbb99";
  const location = {
    href: `https://chzzk.naver.com/video/${currentVideoId}?from=spa`
  };
  const staleCanonical = new MockHTMLElement();
  staleCanonical.href = `https://chzzk.naver.com/video/${previousVideoId}`;
  const video = new MockVideo();
  let messageListener: MessageListener | null = null;
  const requestedEndpoints: string[] = [];

  const document = {
    title: "fallback title - CHZZK",
    querySelector(selector: string) {
      if (selector === "link[rel='canonical']") {
        return staleCanonical;
      }
      return null;
    },
    querySelectorAll(selector: string) {
      if (selector === "video") {
        return [video];
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
  installGlobal("fetch", async (url: URL | RequestInfo) => {
    requestedEndpoints.push(String(url));
    return {
      ok: true,
      async json() {
        return {
          code: 200,
          content: {
            channel: {
              channelId,
              channelName: "현재 채널"
            },
            videoTitle: "현재 VOD",
            liveOpenDate: "2026-07-28 21:00:00",
            clipActive: true,
            videoCategoryValue: "게임"
          }
        };
      }
    };
  });
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
    `../src/content-script.js?chzzk-spa=${Date.now()}`,
    import.meta.url
  );
  await import(sourceUrl.href);
  assert.equal(typeof messageListener, "function");

  const response = await new Promise<ChzzkBridgeResponse>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("content-script 응답 시간 초과")),
      2_000
    );
    const listener = messageListener;
    assert.ok(listener);
    const keepChannelOpen = listener(
      { type: "KIRINUKI_GET_CONTEXT" },
      {},
      (value: ChzzkBridgeResponse) => {
        clearTimeout(timeout);
        resolve(value);
      }
    );
    assert.equal(keepChannelOpen, true);
  });

  assert.equal(response.ok, true);
  assert.equal(response.context.contentId, currentVideoId);
  assert.equal(
    response.context.canonicalUrl,
    `https://chzzk.naver.com/video/${currentVideoId}`
  );
  assert.equal(response.context.channelId, channelId);
  assert.equal(response.context.streamerName, "현재 채널");
  assert.equal(response.context.broadcastTitle, "현재 VOD");
  assert.equal(response.context.player.positionSeconds, 123.456);
  assert.equal(requestedEndpoints.length, 1);
  assert.match(requestedEndpoints[0], new RegExp(`/${currentVideoId}$`, "u"));
  assert.equal(
    response.context.canonicalUrl.includes(previousVideoId),
    false,
    "DOM에 남은 이전 canonical 주소를 SOURCE에 섞으면 안 됩니다."
  );
});
