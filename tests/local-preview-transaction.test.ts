import assert from "node:assert/strict";
import test from "node:test";

import {
  StreamingBridgeClient
} from "../src/web/streaming-bridge-client.js";
import {
  STREAMING_BRIDGE_PROTOCOL,
  STREAMING_BRIDGE_RESPONSE
} from "../src/web/streaming-bridge-protocol.js";
import type {
  StreamingBridgeRequest,
  StreamingBridgeResponse
} from "../src/web/streaming-bridge-protocol.js";

type ResponseListener = (value: unknown) => void;

interface BridgeHarness {
  readonly client: StreamingBridgeClient;
  readonly requests: StreamingBridgeRequest[];
  readonly emit: (response: unknown) => void;
}

function createBridgeHarness(source: unknown): BridgeHarness {
  const requests: StreamingBridgeRequest[] = [];
  const listeners = new Set<ResponseListener>();
  let sequence = 0;
  const client = new StreamingBridgeClient({
    source,
    send: (request) => {
      requests.push(request);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    requestTimeoutMs: 1_000,
    createRequestId: () => `transaction-${++sequence}`
  });
  return {
    client,
    requests,
    emit: (response) => {
      for (const listener of listeners) {
        listener(response);
      }
    }
  };
}

function successResponse(
  request: StreamingBridgeRequest,
  currentTime: number
): StreamingBridgeResponse {
  return {
    protocol: STREAMING_BRIDGE_PROTOCOL,
    type: STREAMING_BRIDGE_RESPONSE,
    requestId: request.requestId,
    generation: request.generation,
    action: request.action,
    source: request.source,
    ok: true,
    player: {
      found: true,
      currentTime,
      duration: 3_600,
      paused: false,
      playbackRate: 1,
      readyState: 4,
      seekableStart: 0,
      seekableEnd: 3_600,
      ...(request.source.platform === "SOOP"
        ? {
          sourceClockIdentity: {
            schema: "kirinuki-soop-vod-source-clock/v1" as const,
            platform: "SOOP" as const,
            contentId: "169475287",
            totalDurationSeconds: 3_600,
            parts: [{
              id: "fixture-part",
              index: 0,
              order: 1,
              durationSeconds: 3_600
            }]
          },
          sourceClockPosition: {
            partId: "fixture-part",
            partIndex: 0,
            partOrder: 1,
            partTimeSeconds: currentTime,
            globalTimeSeconds: currentTime
          }
        }
        : {})
    }
  };
}

async function flushTasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("bridge transaction은 플레이어 명령만 싣고 media acquisition 정보를 보내지 않는다", async (t) => {
  const harness = createBridgeHarness({
    platform: "CHZZK",
    contentType: "vod",
    contentId: "14514980"
  });
  t.after(() => harness.client.destroy());

  const pending = harness.client.seekAbsolute(85.5);
  await flushTasks();
  assert.equal(harness.requests.length, 1);
  const request = harness.requests[0]!;
  assert.deepEqual(request, {
    protocol: "kirinuki-streaming-bridge/v2",
    type: "KIRINUKI_STREAMING_BRIDGE_REQUEST",
    requestId: "transaction-1",
    generation: 1,
    source: {
      platform: "CHZZK",
      sessionId: "chzzk:vod:14514980"
    },
    action: "seek-absolute",
    targetSeconds: 85.5
  });
  assert.doesNotMatch(
    JSON.stringify(request),
    /url|file|path|blob|bytes|range|media|materializ|download/iu
  );

  harness.emit(successResponse(request, 85.5));
  assert.equal((await pending).currentTime, 85.5);
});

test("source 교체는 진행 중·대기 중 명령을 중단하고 이전 응답을 폐기한다", async (t) => {
  const harness = createBridgeHarness({
    platform: "CHZZK",
    contentType: "vod",
    contentId: "14514980"
  });
  t.after(() => harness.client.destroy());

  const previousSnapshot = harness.client.snapshot();
  const previousSeek = harness.client.seekAbsolute(85.5);
  const snapshotRejection = assert.rejects(previousSnapshot, {
    name: "AbortError"
  });
  const seekRejection = assert.rejects(previousSeek, { name: "AbortError" });
  await flushTasks();
  assert.equal(harness.requests.length, 1);
  const staleRequest = harness.requests[0]!;

  harness.client.replaceSource({
    platform: "SOOP",
    contentType: "vod",
    contentId: "169475287"
  });
  await Promise.all([snapshotRejection, seekRejection]);
  harness.emit(successResponse(staleRequest, 42));
  await flushTasks();
  assert.equal(
    harness.requests.length,
    1,
    "이전 source에서 대기하던 seek를 전송하면 안 됩니다."
  );

  const currentSnapshot = harness.client.snapshot();
  await flushTasks();
  assert.equal(harness.requests.length, 2);
  const currentRequest = harness.requests[1]!;
  assert.equal(currentRequest.generation, 2);
  assert.deepEqual(currentRequest.source, {
    platform: "SOOP",
    sessionId: "soop:vod:169475287"
  });

  let currentSettled = false;
  void currentSnapshot.then(() => {
    currentSettled = true;
  });
  harness.emit({
    ...successResponse(currentRequest, 999),
    generation: staleRequest.generation,
    source: staleRequest.source
  });
  await flushTasks();
  assert.equal(currentSettled, false, "이전 source 응답을 새 요청으로 수락했습니다.");

  harness.emit(successResponse(currentRequest, 90));
  assert.equal((await currentSnapshot).currentTime, 90);
});

test("같은 source를 다시 지정하면 정상적인 in-flight transaction을 보존한다", async (t) => {
  const source = {
    platform: "SOOP",
    contentType: "vod",
    contentId: "169475287"
  } as const;
  const harness = createBridgeHarness(source);
  t.after(() => harness.client.destroy());

  const pending = harness.client.snapshot();
  await flushTasks();
  const request = harness.requests[0]!;
  harness.client.replaceSource(source);
  assert.equal(harness.client.generation, 1);
  harness.emit(successResponse(request, 12.25));
  assert.equal((await pending).currentTime, 12.25);
});
