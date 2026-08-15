import assert from "node:assert/strict";
import test from "node:test";

import {
  StreamingBridgeClient,
  createStreamingBridgeWindowTransport
} from "../src/web/streaming-bridge-client.js";
import {
  installStreamingBridgeContentEndpoint
} from "../src/web/streaming-bridge-content.js";
import {
  STREAMING_BRIDGE_PROTOCOL,
  STREAMING_BRIDGE_REQUEST,
  STREAMING_BRIDGE_RESPONSE,
  STREAMING_BRIDGE_SHORTCUT
} from "../src/web/streaming-bridge-protocol.js";
import type {
  StreamingBridgePlayerSnapshot,
  StreamingBridgeRequest,
  StreamingBridgeShortcutMessage
} from "../src/web/streaming-bridge-protocol.js";
import {
  SOOP_VOD_SOURCE_CLOCK_IDENTITY_SCHEMA
} from "../src/lib/soop-vod-source-clock.js";

type EventListenerLike = (event: Record<string, unknown>) => void;

interface FakeWindowHarness {
  readonly hostWindow: Window;
  readonly parentWindow: Window;
  readonly posted: Array<{ message: unknown; targetOrigin: string }>;
  readonly listenerCaptures: ReadonlyMap<string, boolean>;
  readonly dispatch: (type: string, event: Record<string, unknown>) => void;
}

function fakeChildWindow(): FakeWindowHarness {
  const listeners = new Map<string, Set<EventListenerLike>>();
  const posted: Array<{ message: unknown; targetOrigin: string }> = [];
  const listenerCaptures = new Map<string, boolean>();
  const parentWindow = {
    postMessage(message: unknown, targetOrigin: string) {
      posted.push({ message, targetOrigin });
    }
  } as unknown as Window;
  const hostWindow = {
    parent: parentWindow,
    addEventListener(
      type: string,
      listener: EventListenerLike,
      options?: boolean | AddEventListenerOptions
    ) {
      const bucket = listeners.get(type) || new Set<EventListenerLike>();
      bucket.add(listener);
      listeners.set(type, bucket);
      listenerCaptures.set(
        type,
        typeof options === "boolean" ? options : Boolean(options?.capture)
      );
    },
    removeEventListener(type: string, listener: EventListenerLike) {
      listeners.get(type)?.delete(listener);
    }
  } as unknown as Window;
  return {
    hostWindow,
    parentWindow,
    posted,
    listenerCaptures,
    dispatch(type, event) {
      for (const listener of listeners.get(type) || []) {
        listener(event);
      }
    }
  };
}

function snapshot(currentTime = 80.5): StreamingBridgePlayerSnapshot {
  return {
    found: true,
    currentTime,
    duration: 200,
    paused: false,
    playbackRate: 1,
    readyState: 4,
    seekableStart: 0,
    seekableEnd: 200,
    sourceClockIdentity: {
      schema: SOOP_VOD_SOURCE_CLOCK_IDENTITY_SCHEMA,
      platform: "SOOP",
      contentId: "169475287",
      totalDurationSeconds: 200,
      parts: [{
        id: "20260814_TEST_169475287_1",
        index: 0,
        order: 1,
        durationSeconds: 200
      }]
    },
    sourceClockPosition: {
      partId: "20260814_TEST_169475287_1",
      partIndex: 0,
      partOrder: 1,
      partTimeSeconds: currentTime,
      globalTimeSeconds: currentTime
    }
  };
}

function request(
  overrides: Partial<StreamingBridgeRequest> = {}
): StreamingBridgeRequest {
  return {
    protocol: STREAMING_BRIDGE_PROTOCOL,
    type: STREAMING_BRIDGE_REQUEST,
    requestId: "shortcut-request-0001",
    generation: 1,
    source: {
      platform: "SOOP",
      sessionId: "soop:vod:169475287"
    },
    action: "snapshot",
    ...overrides
  } as StreamingBridgeRequest;
}

async function flushTasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("companion endpoint는 exact parent WindowProxy/origin/schema만 받고 완료 응답을 replay한다", async () => {
  const harness = fakeChildWindow();
  let snapshots = 0;
  const dispose = installStreamingBridgeContentEndpoint({
    allowedParentOrigins: ["http://127.0.0.1:4320"],
    hostWindow: harness.hostWindow,
    adapter: {
      readSource: () => ({
        platform: "SOOP",
        contentType: "vod",
        contentId: "169475287"
      }),
      snapshot: () => {
        snapshots += 1;
        return snapshot();
      },
      seekAbsolute: () => undefined,
      setPlaybackRate: () => undefined
    }
  });

  const valid = request();
  harness.dispatch("message", {
    source: {} as Window,
    origin: "http://127.0.0.1:4320",
    data: valid
  });
  harness.dispatch("message", {
    source: harness.parentWindow,
    origin: "https://attacker.example",
    data: valid
  });
  harness.dispatch("message", {
    source: harness.parentWindow,
    origin: "http://127.0.0.1:4320",
    data: { ...valid, unexpected: true }
  });
  await flushTasks();
  assert.equal(snapshots, 0);
  assert.equal(harness.posted.length, 0);

  harness.dispatch("message", {
    source: harness.parentWindow,
    origin: "http://127.0.0.1:4320",
    data: valid
  });
  harness.dispatch("message", {
    source: harness.parentWindow,
    origin: "http://127.0.0.1:4320",
    data: valid
  });
  await flushTasks();
  assert.equal(snapshots, 1, "동일 requestId replay가 두 번 실행됐습니다.");
  assert.equal(harness.posted.length, 1);
  assert.equal(harness.posted[0]?.targetOrigin, "http://127.0.0.1:4320");
  assert.deepEqual(Object.keys(harness.posted[0]?.message as object).sort(), [
    "action",
    "generation",
    "ok",
    "player",
    "protocol",
    "requestId",
    "source",
    "type"
  ]);
  harness.dispatch("message", {
    source: harness.parentWindow,
    origin: "http://127.0.0.1:4320",
    data: valid
  });
  await flushTasks();
  assert.equal(snapshots, 1, "완료된 requestId가 다시 실행됐습니다.");
  assert.equal(harness.posted.length, 2);
  assert.deepEqual(harness.posted[1], harness.posted[0]);
  dispose();
});

test("절대 탐색 request replay는 영상을 한 번만 변경한다", async () => {
  const harness = fakeChildWindow();
  let seeks = 0;
  let currentTime = 80.5;
  const dispose = installStreamingBridgeContentEndpoint({
    allowedParentOrigins: ["http://127.0.0.1:4320"],
    hostWindow: harness.hostWindow,
    adapter: {
      readSource: () => ({
        platform: "SOOP",
        contentType: "vod",
        contentId: "169475287"
      }),
      snapshot: () => snapshot(currentTime),
      seekAbsolute: (targetSeconds) => {
        seeks += 1;
        currentTime = targetSeconds;
      },
      setPlaybackRate: () => undefined
    }
  });
  const seek = request({
    requestId: "absolute-seek-request-0001",
    action: "seek-absolute",
    targetSeconds: 85.5
  });
  for (let index = 0; index < 2; index += 1) {
    harness.dispatch("message", {
      source: harness.parentWindow,
      origin: "http://127.0.0.1:4320",
      data: seek
    });
  }
  await flushTasks();
  harness.dispatch("message", {
    source: harness.parentWindow,
    origin: "http://127.0.0.1:4320",
    data: seek
  });
  await flushTasks();
  assert.equal(seeks, 1);
  assert.equal(currentTime, 85.5);
  assert.equal(harness.posted.length, 2);
  assert.deepEqual(harness.posted[1], harness.posted[0]);
  dispose();
});

test("endpoint는 원본·플레이어의 일시 예외를 안전한 복구 코드로만 응답한다", async () => {
  for (const fixture of [
    {
      expectedCode: "source-unavailable",
      readSource: () => {
        throw new Error("secret source implementation detail");
      },
      snapshot: () => snapshot()
    },
    {
      expectedCode: "player-state-transient",
      readSource: () => ({
        platform: "SOOP",
        contentType: "vod",
        contentId: "169475287"
      }),
      snapshot: () => {
        throw new Error("secret player implementation detail");
      }
    }
  ] as const) {
    const harness = fakeChildWindow();
    const dispose = installStreamingBridgeContentEndpoint({
      allowedParentOrigins: ["http://127.0.0.1:4320"],
      hostWindow: harness.hostWindow,
      adapter: {
        readSource: fixture.readSource,
        snapshot: fixture.snapshot,
        seekAbsolute: () => undefined,
        setPlaybackRate: () => undefined
      }
    });
    harness.dispatch("message", {
      source: harness.parentWindow,
      origin: "http://127.0.0.1:4320",
      data: request({
        requestId: `transient-${fixture.expectedCode}-0001`
      })
    });
    await flushTasks();
    assert.equal(harness.posted.length, 1);
    const response = harness.posted[0]?.message as {
      ok?: unknown;
      error?: { code?: unknown; message?: unknown };
    };
    assert.equal(response.ok, false);
    assert.equal(response.error?.code, fixture.expectedCode);
    assert.doesNotMatch(
      String(response.error?.message || ""),
      /secret|implementation detail/iu
    );
    dispose();
  }
});

test("companion shortcut은 VIDEO 포커스만 허용하고 INPUT·IME·modifier·repeat을 차단한다", async () => {
  const harness = fakeChildWindow();
  let eventSequence = 0;
  const dispose = installStreamingBridgeContentEndpoint({
    allowedParentOrigins: ["http://127.0.0.1:4320"],
    hostWindow: harness.hostWindow,
    createEventId: () => `shortcut-event-${++eventSequence}`,
    adapter: {
      readSource: () => ({
        platform: "SOOP",
        contentType: "vod",
        contentId: "169475287"
      }),
      snapshot: () => snapshot(),
      seekAbsolute: () => undefined,
      setPlaybackRate: () => undefined
    }
  });
  harness.dispatch("message", {
    source: harness.parentWindow,
    origin: "http://127.0.0.1:4320",
    data: request()
  });
  await flushTasks();
  harness.posted.length = 0;

  const keyEvent = (
    target: { tagName: string },
    extras: Record<string, unknown> = {}
  ) => {
    let prevented = false;
    harness.dispatch("keydown", {
      key: "f",
      code: "KeyF",
      target,
      preventDefault: () => {
        prevented = true;
      },
      ...extras
    });
    return () => prevented;
  };

  const videoPrevented = keyEvent({ tagName: "VIDEO" });
  keyEvent({ tagName: "INPUT" });
  keyEvent({ tagName: "VIDEO" }, { isComposing: true });
  keyEvent({ tagName: "VIDEO" }, { keyCode: 229 });
  keyEvent({ tagName: "VIDEO" }, { ctrlKey: true });
  keyEvent({ tagName: "VIDEO" }, { repeat: true });
  await flushTasks();

  assert.equal(harness.listenerCaptures.get("keydown"), true);
  assert.equal(videoPrevented(), true);
  assert.equal(harness.posted.length, 1);
  const shortcut = harness.posted[0]?.message as StreamingBridgeShortcutMessage;
  assert.deepEqual(shortcut, {
    protocol: STREAMING_BRIDGE_PROTOCOL,
    type: STREAMING_BRIDGE_SHORTCUT,
    eventId: "shortcut-event-1",
    generation: 1,
    source: {
      platform: "SOOP",
      sessionId: "soop:vod:169475287"
    },
    key: "F"
  });
  assert.deepEqual(Object.keys(shortcut).sort(), [
    "eventId",
    "generation",
    "key",
    "protocol",
    "source",
    "type"
  ]);
  dispose();
});

test("parent transport/client는 wrong WindowProxy·origin·source·generation과 shortcut replay를 무시한다", async (t) => {
  const target = { postMessage() {} } as unknown as Window;
  const wrongTarget = { postMessage() {} } as unknown as Window;
  const listeners = new Set<(event: Record<string, unknown>) => void>();
  const hostWindow = {
    addEventListener(type: string, listener: (event: Record<string, unknown>) => void) {
      if (type === "message") listeners.add(listener);
    },
    removeEventListener(type: string, listener: (event: Record<string, unknown>) => void) {
      if (type === "message") listeners.delete(listener);
    }
  } as unknown as Window;
  const transport = createStreamingBridgeWindowTransport({
    targetOrigin: "https://vod.sooplive.com",
    targetWindow: () => target,
    hostWindow
  });
  const client = new StreamingBridgeClient({
    source: {
      platform: "SOOP",
      contentType: "vod",
      contentId: "169475287"
    },
    ...transport
  });
  t.after(() => client.destroy());
  const received: string[] = [];
  client.subscribeShortcuts((message) => received.push(message.key));

  const valid: StreamingBridgeShortcutMessage = {
    protocol: STREAMING_BRIDGE_PROTOCOL,
    type: STREAMING_BRIDGE_SHORTCUT,
    eventId: "shortcut-parent-0001",
    generation: 1,
    source: {
      platform: "SOOP",
      sessionId: "soop:vod:169475287"
    },
    key: "F"
  };
  const emit = (
    data: unknown,
    source: Window = target,
    origin = "https://vod.sooplive.com"
  ) => {
    for (const listener of listeners) listener({ data, source, origin });
  };
  emit(valid, wrongTarget);
  emit(valid, target, "https://attacker.example");
  emit({
    ...valid,
    source: { platform: "SOOP", sessionId: "soop:vod:999" }
  });
  emit({ ...valid, generation: 2 });
  emit({ ...valid, unexpected: true });
  emit(valid);
  emit(valid);
  assert.deepEqual(received, ["F"]);

  const response = {
    protocol: STREAMING_BRIDGE_PROTOCOL,
    type: STREAMING_BRIDGE_RESPONSE,
    requestId: "unused-response-0001",
    generation: 1,
    action: "snapshot",
    source: valid.source,
    ok: true,
    player: snapshot()
  };
  emit(response, wrongTarget);
  emit(response, target, "https://attacker.example");
  assert.deepEqual(received, ["F"]);
});

test("parent transport는 제품이 실제로 embed하는 exact player origin만 허용한다", () => {
  const target = () => null;
  const subscribeOnlyWindow = {
    addEventListener() {},
    removeEventListener() {}
  } as unknown as Window;
  for (const targetOrigin of [
    "https://chzzk.naver.com",
    "https://vod.sooplive.com",
    "https://www.youtube-nocookie.com"
  ]) {
    assert.doesNotThrow(() => createStreamingBridgeWindowTransport({
      targetOrigin,
      targetWindow: target,
      hostWindow: subscribeOnlyWindow
    }));
  }
  for (const targetOrigin of [
    "http://chzzk.naver.com",
    "https://vod.sooplive.co.kr",
    "https://www.youtube.com",
    "https://attacker.example",
    "https://chzzk.naver.com/path"
  ]) {
    assert.throws(() => createStreamingBridgeWindowTransport({
      targetOrigin,
      targetWindow: target,
      hostWindow: subscribeOnlyWindow
    }), /exact CHZZK·SOOP·YouTube No-Cookie HTTPS origin/u);
  }
});

test("main의 companion shortcut subscriber는 enabled 버튼만 click한다", async () => {
  const mainSource = await import("node:fs/promises").then(({ readFile }) => (
    readFile(new URL("../src/web/main.ts", import.meta.url), "utf8")
  ));
  assert.match(
    mainSource,
    /subscribeShortcuts\([\s\S]*?const button = captureConsoleButton\(binding\.targetId\);[\s\S]*?if \(!button\.disabled\) \{[\s\S]*?button\.click\(\);[\s\S]*?\}/u
  );
  assert.doesNotMatch(
    mainSource,
    /subscribeShortcuts\([\s\S]*?button\.click\(\);\s*button\.disabled/u
  );
});
