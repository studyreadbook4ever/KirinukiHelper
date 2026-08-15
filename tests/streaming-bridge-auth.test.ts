import assert from "node:assert/strict";
import test from "node:test";

import {
  STREAMING_BRIDGE_CHANNEL_STORAGE_PREFIX,
  STREAMING_BRIDGE_FRAME_DELIVERY,
  STREAMING_BRIDGE_STUDIO_DELIVERY,
  createAuthenticatedStreamingBridgeContentTransport,
  createStreamingBridgeFrameDelivery,
  createStreamingBridgeStudioRequest,
  importStreamingBridgeChannelKey,
  installAuthenticatedStudioStreamingRelay,
  parseStreamingBridgeStudioDelivery
} from "../src/web/streaming-bridge-auth.js";
import type {
  ExtensionLocalStorageArea,
  StreamingBridgeChannelRecord
} from "../src/web/streaming-bridge-auth.js";
import {
  STREAMING_BRIDGE_PROTOCOL,
  STREAMING_BRIDGE_REQUEST,
  STREAMING_BRIDGE_RESPONSE,
  STREAMING_BRIDGE_SHORTCUT
} from "../src/web/streaming-bridge-protocol.js";
import {
  StreamingBridgeClient,
  createAuthenticatedStreamingBridgeWindowTransport
} from "../src/web/streaming-bridge-client.js";
import type {
  StreamingBridgeRequest,
  StreamingBridgeResponse,
  StreamingBridgeShortcutMessage
} from "../src/web/streaming-bridge-protocol.js";

type EventListenerLike = (event: Record<string, unknown>) => void;

function memoryStorage(
  initial: Record<string, unknown> = {}
): ExtensionLocalStorageArea & {
  readonly values: Map<string, unknown>;
  readonly setCalls: number;
} {
  const values = new Map(Object.entries(initial));
  let setCalls = 0;
  return {
    values,
    get setCalls() {
      return setCalls;
    },
    async get(keys = null) {
      const selected = keys === null || keys === undefined
        ? [...values.keys()]
        : typeof keys === "string"
          ? [keys]
          : [...keys];
      return Object.fromEntries(selected.flatMap((key) => (
        values.has(key) ? [[key, values.get(key)]] : []
      )));
    },
    async set(items) {
      setCalls += 1;
      for (const [key, value] of Object.entries(items)) {
        values.set(key, structuredClone(value));
      }
    },
    async remove(keys) {
      for (const key of typeof keys === "string" ? [keys] : keys) {
        values.delete(key);
      }
    }
  };
}

function bridgeRequest(): StreamingBridgeRequest {
  return {
    protocol: STREAMING_BRIDGE_PROTOCOL,
    type: STREAMING_BRIDGE_REQUEST,
    requestId: "authenticated-request-0001",
    generation: 1,
    source: {
      platform: "CHZZK",
      sessionId: "chzzk:vod:14514980"
    },
    action: "snapshot"
  };
}

function bridgeResponse(): Extract<StreamingBridgeResponse, { readonly ok: true }> {
  return {
    protocol: STREAMING_BRIDGE_PROTOCOL,
    type: STREAMING_BRIDGE_RESPONSE,
    requestId: "authenticated-request-0001",
    generation: 1,
    action: "snapshot",
    source: {
      platform: "CHZZK",
      sessionId: "chzzk:vod:14514980"
    },
    ok: true,
    player: {
      found: true,
      currentTime: 80.5,
      duration: 200,
      paused: false,
      playbackRate: 1,
      readyState: 4,
      seekableStart: 0,
      seekableEnd: 200
    }
  };
}

function bridgeShortcut(
  eventId = "authenticated-shortcut-0001"
): StreamingBridgeShortcutMessage {
  return {
    protocol: STREAMING_BRIDGE_PROTOCOL,
    type: STREAMING_BRIDGE_SHORTCUT,
    eventId,
    generation: 1,
    source: {
      platform: "CHZZK",
      sessionId: "chzzk:vod:14514980"
    },
    key: "E"
  };
}

async function flushCrypto(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 40));
}

test("top-frame relay는 exact 현재 iframe의 HMAC 응답·단축키만 Studio로 전달한다", async () => {
  const listeners = new Map<string, Set<EventListenerLike>>();
  const studioPosted: Array<{ message: unknown; targetOrigin: string }> = [];
  const framePosted: Array<{ message: unknown; targetOrigin: string }> = [];
  const frameWindow = {
    postMessage(message: unknown, targetOrigin: string) {
      framePosted.push({ message, targetOrigin });
    }
  } as unknown as Window;
  const studioWindow = {
    location: { origin: "http://127.0.0.1:4320" },
    postMessage(message: unknown, targetOrigin: string) {
      studioPosted.push({ message, targetOrigin });
    },
    addEventListener(type: string, listener: EventListenerLike) {
      const bucket = listeners.get(type) || new Set<EventListenerLike>();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    removeEventListener(type: string, listener: EventListenerLike) {
      listeners.get(type)?.delete(listener);
    }
  } as unknown as Window;
  Object.defineProperty(studioWindow, "parent", { value: studioWindow });
  const frameElement = {
    tagName: "IFRAME",
    isConnected: true,
    contentWindow: frameWindow,
    src: "https://chzzk.naver.com/video/14514980",
    getAttribute(name: string) {
      return name === "src" ? this.src : null;
    }
  };
  const studioDocument = {
    baseURI: "http://127.0.0.1:4320/",
    getElementById(id: string) {
      return id === "stream-preview-frame" ? frameElement : null;
    }
  } as unknown as Document;
  const staleKey = `${STREAMING_BRIDGE_CHANNEL_STORAGE_PREFIX}${"A".repeat(43)}`;
  const storage = memoryStorage({
    unrelated: { keep: true },
    [staleKey]: {
      schema: "kirinuki-streaming-channel/v1",
      channelId: "A".repeat(43),
      studioOrigin: "http://127.0.0.1:4320",
      key: "B".repeat(43),
      expiresAt: 1
    }
  });
  const dispatch = (type: string, event: Record<string, unknown>): void => {
    for (const listener of listeners.get(type) || []) {
      listener(event);
    }
  };
  const dispose = await installAuthenticatedStudioStreamingRelay({
    allowedStudioOrigins: ["http://127.0.0.1:4320"],
    hostWindow: studioWindow,
    hostDocument: studioDocument,
    storageArea: storage,
    isTrustedMessageEvent: () => true
  });
  assert.equal(storage.values.has(staleKey), false);
  assert.deepEqual(storage.values.get("unrelated"), { keep: true });
  assert.equal(storage.setCalls, 1);

  dispatch("message", {
    source: studioWindow,
    origin: "http://127.0.0.1:4320",
    data: createStreamingBridgeStudioRequest(
      bridgeRequest(),
      "https://chzzk.naver.com"
    )
  });
  await flushCrypto();
  assert.equal(framePosted.length, 1);
  assert.equal(framePosted[0]?.targetOrigin, "https://chzzk.naver.com");
  assert.equal(
    storage.setCalls,
    1,
    "정상 snapshot마다 chrome.storage.local을 다시 쓰고 있습니다."
  );

  const exerciseFrameTransport = async (
    trustEvent: boolean
  ): Promise<number> => {
    const platformListeners = new Set<EventListenerLike>();
    const platformWindow = {
      parent: studioWindow,
      location: { origin: "https://chzzk.naver.com" },
      addEventListener(type: string, listener: EventListenerLike) {
        if (type === "message") platformListeners.add(listener);
      },
      removeEventListener(type: string, listener: EventListenerLike) {
        if (type === "message") platformListeners.delete(listener);
      }
    } as unknown as Window;
    const transport = createAuthenticatedStreamingBridgeContentTransport({
      allowedParentOrigins: ["http://127.0.0.1:4320"],
      hostWindow: platformWindow,
      storageArea: storage,
      ...(trustEvent ? { isTrustedMessageEvent: () => true } : {})
    });
    let received = 0;
    const unsubscribe = transport.subscribe(() => {
      received += 1;
    });
    for (const listener of platformListeners) {
      listener({
        isTrusted: false,
        source: studioWindow,
        origin: "http://127.0.0.1:4320",
        data: framePosted[0]?.message
      });
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    unsubscribe();
    return received;
  };
  assert.equal(
    await exerciseFrameTransport(false),
    0,
    "synthetic signed FRAME_REQUEST replay가 인증 endpoint에 도달했습니다."
  );
  assert.equal(
    await exerciseFrameTransport(true),
    1,
    "trusted postMessage test seam이 정상 signed request를 전달하지 못했습니다."
  );

  const channelEntry = [...storage.values.entries()].find(([key]) => (
    key.startsWith(STREAMING_BRIDGE_CHANNEL_STORAGE_PREFIX)
  ));
  assert(channelEntry);
  const channel = channelEntry[1] as StreamingBridgeChannelRecord;
  const key = await importStreamingBridgeChannelKey(channel);

  for (const unsigned of [bridgeResponse(), bridgeShortcut()]) {
    dispatch("message", {
      source: frameWindow,
      origin: "https://chzzk.naver.com",
      data: unsigned
    });
  }
  await flushCrypto();
  assert.equal(studioPosted.length, 0);

  const signedResponse = await createStreamingBridgeFrameDelivery(
    bridgeResponse(),
    channel,
    "https://chzzk.naver.com",
    key
  );
  dispatch("message", {
    source: frameWindow,
    origin: "https://chzzk.naver.com",
    data: {
      ...signedResponse,
      type: STREAMING_BRIDGE_FRAME_DELIVERY,
      authTag: "C".repeat(43)
    }
  });
  await flushCrypto();
  assert.equal(studioPosted.length, 0);

  dispatch("message", {
    source: frameWindow,
    origin: "https://chzzk.naver.com",
    data: signedResponse
  });
  await flushCrypto();
  assert.equal(studioPosted.length, 1);
  assert.equal(studioPosted[0]?.targetOrigin, "http://127.0.0.1:4320");
  const relayedResponse = parseStreamingBridgeStudioDelivery(
    studioPosted[0]?.message
  );
  assert.equal(relayedResponse?.type, STREAMING_BRIDGE_STUDIO_DELIVERY);
  assert.deepEqual(relayedResponse?.inner, bridgeResponse());

  const signedShortcut = await createStreamingBridgeFrameDelivery(
    bridgeShortcut(),
    channel,
    "https://chzzk.naver.com",
    key
  );
  dispatch("message", {
    source: frameWindow,
    origin: "https://chzzk.naver.com",
    data: signedShortcut
  });
  await flushCrypto();
  assert.equal(studioPosted.length, 2);
  assert.deepEqual(
    parseStreamingBridgeStudioDelivery(studioPosted[1]?.message)?.inner,
    bridgeShortcut()
  );

  frameElement.src = "https://chzzk.naver.com/video/14514981";
  const staleFrameDelivery = await createStreamingBridgeFrameDelivery(
    bridgeShortcut(),
    channel,
    "https://chzzk.naver.com",
    key
  );
  // Same origin and WindowProxy are insufficient after the exact iframe URL
  // has been replaced; a new Studio request must bind the current document.
  frameElement.contentWindow = {} as Window;
  dispatch("message", {
    source: frameWindow,
    origin: "https://chzzk.naver.com",
    data: staleFrameDelivery
  });
  await flushCrypto();
  assert.equal(studioPosted.length, 2);

  dispose();
  await flushCrypto();
  assert.equal(storage.values.has(channelEntry[0]), false);
});

test("CHZZK app transport는 같은 top WindowProxy/origin의 relay delivery만 받는다", async (t) => {
  const listeners = new Set<EventListenerLike>();
  const posted: unknown[] = [];
  const frameWindow = {} as Window;
  const studioWindow = {
    location: { origin: "http://127.0.0.1:4320" },
    postMessage(message: unknown) {
      posted.push(message);
    },
    addEventListener(type: string, listener: EventListenerLike) {
      if (type === "message") listeners.add(listener);
    },
    removeEventListener(type: string, listener: EventListenerLike) {
      if (type === "message") listeners.delete(listener);
    }
  } as unknown as Window;
  Object.defineProperty(studioWindow, "parent", { value: studioWindow });
  const transport = createAuthenticatedStreamingBridgeWindowTransport({
    targetOrigin: "https://chzzk.naver.com",
    studioOrigin: "http://127.0.0.1:4320",
    hostWindow: studioWindow
  });
  const client = new StreamingBridgeClient({
    source: {
      platform: "CHZZK",
      contentType: "vod",
      contentId: "14514980"
    },
    ...transport,
    requestTimeoutMs: 500,
    maxDeliveryAttempts: 1,
    createRequestId: () => "authenticated-request-0001"
  });
  t.after(() => client.destroy());
  const shortcuts: string[] = [];
  client.subscribeShortcuts((message) => shortcuts.push(message.key));
  const pending = client.snapshot();
  await flushCrypto();
  assert.equal(posted.length, 1);

  const emit = (data: unknown, source: Window, origin: string): void => {
    for (const listener of listeners) {
      listener({ data, source, origin });
    }
  };
  emit(bridgeResponse(), frameWindow, "https://chzzk.naver.com");
  emit(bridgeShortcut(), frameWindow, "https://chzzk.naver.com");
  emit({
    protocol: "kirinuki-streaming-bridge-auth/v1",
    type: STREAMING_BRIDGE_STUDIO_DELIVERY,
    targetOrigin: "https://chzzk.naver.com",
    inner: bridgeResponse()
  }, frameWindow, "http://127.0.0.1:4320");
  assert.deepEqual(shortcuts, []);

  emit({
    protocol: "kirinuki-streaming-bridge-auth/v1",
    type: STREAMING_BRIDGE_STUDIO_DELIVERY,
    targetOrigin: "https://chzzk.naver.com",
    inner: bridgeResponse()
  }, studioWindow, "http://127.0.0.1:4320");
  assert.deepEqual(await pending, bridgeResponse().player);
  emit({
    protocol: "kirinuki-streaming-bridge-auth/v1",
    type: STREAMING_BRIDGE_STUDIO_DELIVERY,
    targetOrigin: "https://chzzk.naver.com",
    inner: bridgeShortcut()
  }, studioWindow, "http://127.0.0.1:4320");
  assert.deepEqual(shortcuts, ["E"]);

  for (let index = 2; index <= 513; index += 1) {
    emit({
      protocol: "kirinuki-streaming-bridge-auth/v1",
      type: STREAMING_BRIDGE_STUDIO_DELIVERY,
      targetOrigin: "https://chzzk.naver.com",
      inner: bridgeShortcut(
        `authenticated-shortcut-${String(index).padStart(4, "0")}`
      )
    }, studioWindow, "http://127.0.0.1:4320");
  }
  emit({
    protocol: "kirinuki-streaming-bridge-auth/v1",
    type: STREAMING_BRIDGE_STUDIO_DELIVERY,
    targetOrigin: "https://chzzk.naver.com",
    inner: bridgeShortcut()
  }, studioWindow, "http://127.0.0.1:4320");
  assert.equal(
    shortcuts.length,
    513,
    "513개 뒤 캡처된 signed shortcut replay가 다시 수락됐습니다."
  );
});
