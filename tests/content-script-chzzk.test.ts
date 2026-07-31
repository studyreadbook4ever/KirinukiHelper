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
      player: {
        positionSeconds: number;
        playbackRate: number;
      };
    };
  }

  interface PlayerBridgeResponse {
    ok: true;
    player: {
      currentTime: number;
      paused: boolean;
      playbackRate: number;
    };
  }

  interface BridgeErrorResponse {
    ok: false;
    error: string;
  }

  type BridgeResponse = (
    ChzzkBridgeResponse
    | PlayerBridgeResponse
    | BridgeErrorResponse
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

  const previousVideoId = "14405629";
  const currentVideoId = "13583412";
  const retryVideoId = "11804637";
  const channelId = "088973112d8acc831ec20274f7ffbb99";
  const location = {
    href: `https://chzzk.naver.com/video/${currentVideoId}?from=spa`
  };
  const staleCanonical = new MockHTMLElement();
  staleCanonical.href = `https://chzzk.naver.com/video/${previousVideoId}`;
  const video = new MockVideo();
  let messageListener: MessageListener | null = null;
  const requestedEndpoints: string[] = [];
  const requestSignals: AbortSignal[] = [];
  let retryAttempts = 0;
  type MockFetchResponse = {
    ok: boolean;
    json(): Promise<Record<string, unknown>>;
  };
  let resolveInitialMetadataRequest: (
    response: MockFetchResponse
  ) => void = () => {
    throw new Error("초기 메타데이터 요청이 시작되지 않았습니다.");
  };
  const activeMetadataTimeouts = new Set<
    ReturnType<typeof setTimeout>
  >();
  let metadataTimeoutScheduledCount = 0;
  const nativeSetTimeout = globalThis.setTimeout;
  const nativeClearTimeout = globalThis.clearTimeout;

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
  installGlobal("setTimeout", ((
    ...args: Parameters<typeof setTimeout>
  ) => {
    const handle = nativeSetTimeout(...args);
    if (args[1] === 8_000) {
      activeMetadataTimeouts.add(handle);
      metadataTimeoutScheduledCount += 1;
    }
    return handle;
  }) as typeof setTimeout);
  installGlobal("clearTimeout", ((
    handle?: ReturnType<typeof setTimeout>
  ) => {
    if (handle) {
      activeMetadataTimeouts.delete(handle);
    }
    nativeClearTimeout(handle);
  }) as typeof clearTimeout);
  installGlobal("fetch", (
    url: URL | RequestInfo,
    init?: RequestInit
  ) => {
    requestedEndpoints.push(String(url));
    if (init?.signal) {
      requestSignals.push(init.signal);
    }
    if (String(url).endsWith(`/${retryVideoId}`)) {
      retryAttempts += 1;
      if (retryAttempts === 1) {
        return Promise.reject(new Error("일시적인 메타데이터 오류"));
      }
      return Promise.resolve({
        ok: true,
        async json() {
          return {
            code: 200,
            content: {
              channel: {
                channelId,
                channelName: "재시도 채널"
              },
              videoTitle: "재시도 VOD"
            }
          };
        }
      });
    }
    return new Promise<MockFetchResponse>((resolve) => {
      resolveInitialMetadataRequest = resolve;
    });
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
      (value: BridgeResponse) => {
        clearTimeout(timeout);
        resolve(value);
      }
    );
    assert.equal(keepChannelOpen, true);
  });

  const firstContextRequest = sendMessage({
    type: "KIRINUKI_GET_CONTEXT"
  });
  const coalescedContextRequest = sendMessage({
    type: "KIRINUKI_GET_CONTEXT"
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    requestedEndpoints.length,
    1,
    "동일 VOD 메타데이터 요청은 하나의 fetch를 공유해야 합니다."
  );
  resolveInitialMetadataRequest({
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
  });
  const [response, coalescedResponse] = await Promise.all([
    firstContextRequest,
    coalescedContextRequest
  ]);
  assert.equal(response.ok, true);
  assert.ok("context" in response);
  assert.equal(coalescedResponse.ok, true);
  assert.ok("context" in coalescedResponse);
  assert.equal(response.context.contentId, currentVideoId);
  assert.equal(
    response.context.canonicalUrl,
    `https://chzzk.naver.com/video/${currentVideoId}`
  );
  assert.equal(response.context.channelId, channelId);
  assert.equal(response.context.streamerName, "현재 채널");
  assert.equal(response.context.broadcastTitle, "현재 VOD");
  assert.equal(response.context.player.positionSeconds, 123.456);
  assert.equal(response.context.player.playbackRate, 1);
  assert.equal(requestedEndpoints.length, 1);
  assert.equal(metadataTimeoutScheduledCount, 1);
  assert.equal(activeMetadataTimeouts.size, 0);
  assert.equal(requestSignals.length, 1);
  assert.equal(requestSignals[0]?.aborted, false);
  assert.match(requestedEndpoints[0], new RegExp(`/${currentVideoId}$`, "u"));
  assert.equal(
    response.context.canonicalUrl.includes(previousVideoId),
    false,
    "DOM에 남은 이전 canonical 주소를 SOURCE에 섞으면 안 됩니다."
  );

  const cachedResponse = await sendMessage({
    type: "KIRINUKI_GET_CONTEXT"
  });
  assert.equal(cachedResponse.ok, true);
  assert.equal(requestedEndpoints.length, 1);
  assert.equal(metadataTimeoutScheduledCount, 1);

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
    Math.abs(backwardSeekResponse.player.currentTime - 118.456) < 1e-9
  );
  assert.ok(Math.abs(video.currentTime - 118.456) < 1e-9);

  const forwardSeekResponse = await sendMessage({
    type: "KIRINUKI_PLAYER_COMMAND",
    action: "seek-relative",
    deltaSeconds: 5
  });
  assert.equal(forwardSeekResponse.ok, true);
  assert.ok("player" in forwardSeekResponse);
  assert.ok(
    Math.abs(forwardSeekResponse.player.currentTime - 123.456) < 1e-9
  );
  assert.ok(Math.abs(video.currentTime - 123.456) < 1e-9);

  video.seekable.start = (_index: number) => 10;
  video.seekable.end = (_index: number) => 3_590;
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

  video.currentTime = 3_588;
  const upperClampedSeekResponse = await sendMessage({
    type: "KIRINUKI_PLAYER_COMMAND",
    action: "seek-relative",
    deltaSeconds: 5
  });
  assert.equal(upperClampedSeekResponse.ok, true);
  assert.ok("player" in upperClampedSeekResponse);
  assert.equal(upperClampedSeekResponse.player.currentTime, 3_590);
  assert.equal(video.currentTime, 3_590);

  const invalidSeekResponse = await sendMessage({
    type: "KIRINUKI_PLAYER_COMMAND",
    action: "seek-relative",
    deltaSeconds: 4
  });
  assert.equal(invalidSeekResponse.ok, false);
  assert.ok("error" in invalidSeekResponse);
  assert.match(invalidSeekResponse.error, /5초/u);
  assert.equal(video.currentTime, 3_590);

  location.href = `https://chzzk.naver.com/live/${channelId}`;
  video.currentTime = 200;
  const liveDvrSeekResponse = await sendMessage({
    type: "KIRINUKI_PLAYER_COMMAND",
    action: "seek-relative",
    deltaSeconds: 5
  });
  assert.equal(liveDvrSeekResponse.ok, true);
  assert.ok("player" in liveDvrSeekResponse);
  assert.equal(liveDvrSeekResponse.player.currentTime, 205);
  assert.equal(
    video.currentTime,
    205,
    "치지직 라이브 DVR도 wall-clock 보정값이 아닌 media currentTime을 상대 이동해야 합니다."
  );

  location.href = `https://chzzk.naver.com/video/${retryVideoId}`;
  const failedMetadataResponse = await sendMessage({
    type: "KIRINUKI_GET_CONTEXT"
  });
  assert.equal(failedMetadataResponse.ok, true);
  assert.equal(retryAttempts, 1);
  assert.equal(activeMetadataTimeouts.size, 0);

  const retriedMetadataResponse = await sendMessage({
    type: "KIRINUKI_GET_CONTEXT"
  });
  assert.equal(retriedMetadataResponse.ok, true);
  assert.ok("context" in retriedMetadataResponse);
  assert.equal(retriedMetadataResponse.context.contentId, retryVideoId);
  assert.equal(retriedMetadataResponse.context.streamerName, "재시도 채널");
  assert.equal(retriedMetadataResponse.context.broadcastTitle, "재시도 VOD");
  assert.equal(retryAttempts, 2);
  assert.equal(requestedEndpoints.length, 3);
  assert.equal(requestSignals.length, 3);
  assert.equal(metadataTimeoutScheduledCount, 3);
  assert.equal(activeMetadataTimeouts.size, 0);
});
