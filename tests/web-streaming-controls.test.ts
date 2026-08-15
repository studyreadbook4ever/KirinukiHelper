import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  StreamingBridgeClient
} from "../src/web/streaming-bridge-client.js";
import {
  STREAMING_BRIDGE_PROTOCOL,
  STREAMING_BRIDGE_RESPONSE,
  createStreamingBridgeSourceIdentity,
  parseStreamingBridgeRequest,
  parseStreamingBridgeResponse
} from "../src/web/streaming-bridge-protocol.js";
import type {
  StreamingBridgeRequest,
  StreamingBridgeResponse
} from "../src/web/streaming-bridge-protocol.js";
import {
  SOOP_VOD_SOURCE_CLOCK_IDENTITY_SCHEMA
} from "../src/lib/soop-vod-source-clock.js";

type BridgeResponseListener = (response: unknown) => void;

interface StreamingBridgeClientHarness {
  readonly client: StreamingBridgeClient;
  readonly requests: StreamingBridgeRequest[];
  readonly emit: (response: unknown) => void;
}

function createStreamingBridgeClientHarness(
  source: unknown
): StreamingBridgeClientHarness {
  const requests: StreamingBridgeRequest[] = [];
  const listeners = new Set<BridgeResponseListener>();
  let requestSequence = 0;
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
    createRequestId: () => `test-request-${++requestSequence}`
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

function successfulResponse(
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
            schema: SOOP_VOD_SOURCE_CLOCK_IDENTITY_SCHEMA,
            platform: "SOOP" as const,
            contentId: request.source.sessionId.slice("soop:vod:".length),
            totalDurationSeconds: 3_600,
            parts: [{
              id: "20260814_TEST_SOOP_PART_1",
              index: 0,
              order: 1,
              durationSeconds: 3_600
            }]
          },
          sourceClockPosition: {
            partId: "20260814_TEST_SOOP_PART_1",
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

async function flushBridgeTasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function sourceSection(
  source: string,
  startMarker: string,
  endMarker: string
): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0, `시작 marker를 찾지 못했습니다: ${startMarker}`);
  assert(end > start, `끝 marker를 찾지 못했습니다: ${endMarker}`);
  return source.slice(start, end);
}

test("컷 단계는 원본 iframe만 유지하고 로컬 미디어 준비 경로를 포함하지 않는다", async () => {
  const [html, mainSource] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/web/main.ts", import.meta.url), "utf8")
  ]);

  assert.match(html, /<iframe[^>]+id="stream-preview-frame"/u);
  assert.doesNotMatch(
    html,
    /local-preview-video|local-preview-anchor|prepare-local-preview/u,
    "컷 화면에는 다운로드한 대체 video 또는 로컬 준비 UX가 없어야 합니다."
  );
  assert.doesNotMatch(
    mainSource,
    /ChzzkVodMaterialization|LOCAL_VOD_COMPANION_ENDPOINT|KIRINUKI_MEDIA_ENGINE_ENDPOINT|startChzzkVodMaterialization|waitForChzzkVodMaterialization|localPreviewBootstrapClip|\/v1\/vod\/materializations/u,
    "컷 단계가 VOD materialization을 시작해서는 안 됩니다."
  );
  assert.match(mainSource, /StreamingBridgeClient/u);
  assert.match(
    mainSource,
    /requestTimeoutMs: 900,[\s\S]*maxDeliveryAttempts: 3/u,
    "실제 cross-origin player의 짧은 stall을 idempotent 세 번째 전달로 흡수해야 합니다."
  );

  const controls = sourceSection(
    mainSource,
    "async function captureCurrentPlayerTime",
    "function reportStudioCaptureActionError"
  );
  assert.match(controls, /\.snapshot\(/u);
  assert.match(controls, /\.seekAbsolute\(/u);
  assert.match(controls, /\.setPlaybackRate\(/u);
  assert.match(
    controls,
    /case "player-seek-backward-five":[\s\S]*seekPlayerBy\(-5\)/u
  );
  assert.match(
    controls,
    /case "player-seek-forward-five":[\s\S]*seekPlayerBy\(5\)/u
  );
  assert.doesNotMatch(
    controls,
    /streamFrame\.(?:hidden|src)|replaceStreamFrame|prepareLocalPreview|localPreviewVideo/u,
    "컷 명령 도중 원본 iframe을 숨기거나 대체해서는 안 됩니다."
  );
});

test("실제 bridge 요청은 플레이어 제어만 표현하고 다운로드 정보를 싣지 않는다", async (t) => {
  const rawSource = {
    platform: "SOOP",
    contentType: "vod",
    contentId: "169475287",
    canonicalUrl: "https://vod.sooplive.com/player/169475287"
  };
  assert.deepEqual(createStreamingBridgeSourceIdentity(rawSource), {
    platform: "SOOP",
    sessionId: "soop:vod:169475287"
  });
  const harness = createStreamingBridgeClientHarness(rawSource);
  t.after(() => harness.client.destroy());

  const pending = harness.client.seekAbsolute(85.5);
  await flushBridgeTasks();
  assert.equal(harness.requests.length, 1);
  const request = harness.requests[0]!;
  assert.deepEqual(parseStreamingBridgeRequest(request), request);
  assert.deepEqual(request, {
    protocol: "kirinuki-streaming-bridge/v2",
    type: "KIRINUKI_STREAMING_BRIDGE_REQUEST",
    requestId: "test-request-1",
    generation: 1,
    source: {
      platform: "SOOP",
      sessionId: "soop:vod:169475287"
    },
    action: "seek-absolute",
    targetSeconds: 85.5
  });
  assert.doesNotMatch(
    JSON.stringify(request),
    /url|file|path|blob|bytes|range|media|materializ|download/iu
  );

  const response = successfulResponse(request, 85.5);
  assert.deepEqual(parseStreamingBridgeResponse(response), response);
  assert.equal(response.ok, true);
  if (!response.ok) {
    throw new Error("성공 fixture가 실패 응답으로 만들어졌습니다.");
  }
  const prooflessPlayer = { ...response.player } as Record<string, unknown>;
  delete prooflessPlayer.sourceClockIdentity;
  delete prooflessPlayer.sourceClockPosition;
  assert.equal(parseStreamingBridgeResponse({
    ...response,
    player: prooflessPlayer
  }), null, "SOOP 성공 응답이 공식 part 시계 증명 없이 수용됐습니다.");
  harness.emit(response);
  assert.equal((await pending).currentTime, 85.5);
});

test("응답 지연 재전송은 같은 절대 탐색 requestId를 그대로 사용한다", async (t) => {
  const requests: StreamingBridgeRequest[] = [];
  const listeners = new Set<BridgeResponseListener>();
  const client = new StreamingBridgeClient({
    source: {
      platform: "SOOP",
      contentType: "vod",
      contentId: "169475287"
    },
    send: (request) => {
      requests.push(request);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    requestTimeoutMs: 50,
    maxDeliveryAttempts: 2,
    createRequestId: () => "retry-absolute-request-0001"
  });
  t.after(() => client.destroy());

  const pending = client.seekAbsolute(85.5);
  await new Promise<void>((resolve) => setTimeout(resolve, 70));
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(requests[0]?.action, "seek-absolute");
  const response = successfulResponse(requests[0]!, 85.5);
  for (const listener of listeners) {
    listener(response);
  }
  assert.equal((await pending).currentTime, 85.5);
});

test("bridge의 snapshot→절대 seek→snapshot은 단일 in-flight로 직렬화된다", async (t) => {
  const harness = createStreamingBridgeClientHarness({
    platform: "CHZZK",
    contentType: "vod",
    contentId: "14514980"
  });
  t.after(() => harness.client.destroy());

  const captureStart = harness.client.snapshot();
  const seekForward = harness.client.seekAbsolute(85.5);
  const captureEnd = harness.client.snapshot();
  await flushBridgeTasks();
  assert.deepEqual(harness.requests.map(({ action }) => action), ["snapshot"]);

  const firstRequest = harness.requests[0]!;
  harness.emit({
    ...successfulResponse(firstRequest, 999),
    requestId: "test-request-2",
    action: "seek-absolute"
  });
  await flushBridgeTasks();
  assert.deepEqual(
    harness.requests.map(({ action }) => action),
    ["snapshot"],
    "아직 보내지 않은 F의 가짜 선행 응답이 E를 완료했습니다."
  );

  harness.emit(successfulResponse(firstRequest, 80.5));
  assert.equal((await captureStart).currentTime, 80.5);
  await flushBridgeTasks();
  assert.deepEqual(harness.requests.map(({ action }) => action), [
    "snapshot",
    "seek-absolute"
  ]);
  const secondRequest = harness.requests[1]!;
  assert.equal(secondRequest.action, "seek-absolute");
  if (secondRequest.action === "seek-absolute") {
    assert.equal(secondRequest.targetSeconds, 85.5);
  }

  harness.emit(successfulResponse(secondRequest, 85.5));
  assert.equal((await seekForward).currentTime, 85.5);
  await flushBridgeTasks();
  assert.deepEqual(harness.requests.map(({ action }) => action), [
    "snapshot",
    "seek-absolute",
    "snapshot"
  ]);

  const thirdRequest = harness.requests[2]!;
  harness.emit(successfulResponse(thirdRequest, 85.5));
  assert.equal((await captureEnd).currentTime, 85.5);
});

test("replaceSource 뒤 이전 generation의 in-flight·queued·늦은 응답을 모두 폐기한다", async (t) => {
  const harness = createStreamingBridgeClientHarness({
    platform: "CHZZK",
    contentType: "vod",
    contentId: "14514980"
  });
  t.after(() => harness.client.destroy());

  const previousSnapshot = harness.client.snapshot();
  const previousQueuedSeek = harness.client.seekAbsolute(85.5);
  await flushBridgeTasks();
  assert.equal(harness.requests.length, 1);
  const staleRequest = harness.requests[0]!;

  harness.client.replaceSource({
    platform: "SOOP",
    contentType: "vod",
    contentId: "169475287"
  });
  await assert.rejects(previousSnapshot, { name: "AbortError" });
  await assert.rejects(previousQueuedSeek, { name: "AbortError" });
  harness.emit(successfulResponse(staleRequest, 42));
  await flushBridgeTasks();
  assert.equal(harness.requests.length, 1);

  const currentSnapshot = harness.client.snapshot();
  await flushBridgeTasks();
  assert.equal(harness.requests.length, 2);
  const currentRequest = harness.requests[1]!;
  assert.equal(currentRequest.generation, 2);
  assert.deepEqual(currentRequest.source, {
    platform: "SOOP",
    sessionId: "soop:vod:169475287"
  });
  harness.emit(successfulResponse(currentRequest, 90));
  assert.equal((await currentSnapshot).currentTime, 90);
});

test("browser smoke도 로컬 materialization fixture 대신 streaming bridge와 0회 acquisition을 검증한다", async () => {
  const smoke = await readFile(
    new URL("../scripts/local-studio-browser-smoke.ts", import.meta.url),
    "utf8"
  );
  const capturePhaseStart = smoke.indexOf(
    "const chzzkFrame = await setSourceAndVerify"
  );
  const capturePhaseEnd = smoke.indexOf(
    "const clipInitialState = await execute",
    capturePhaseStart
  );
  assert(
    capturePhaseStart >= 0 && capturePhaseEnd > capturePhaseStart,
    "browser smoke의 컷 캡처 동작 경계를 찾지 못했습니다."
  );
  const capturePhase = smoke.slice(capturePhaseStart, capturePhaseEnd);

  assert.doesNotMatch(capturePhase, /\/v1\/vod\/materializations/u);
  assert.doesNotMatch(capturePhase, /#local-preview-video/u);
  assert.match(capturePhase, /streamingBridge|StreamingBridge/u);
  assert.match(
    capturePhase,
    /(?:acquisition|materialization|download|gateway)\w*\s*===\s*0/iu,
    "컷 단축키 smoke는 로컬 VOD acquisition 0회를 명시적으로 단언해야 합니다."
  );
  assert.match(
    capturePhase,
    /frameHidden\s*===\s*false|!\w+\.frameHidden/u,
    "E/F/R 뒤에도 원본 iframe이 보이는지 smoke에서 확인해야 합니다."
  );
  assert.match(
    capturePhase,
    /waitForIframeTarget\([\s\S]*youtubeEmbed[\s\S]*dispatchStreamingFrameShortcut\([\s\S]*youtubeBridgeState\.calls\.every\(\(call\) => call\.action === "snapshot"\)/u,
    "YouTube smoke는 iframe VIDEO 단축키를 보내고 bridge playback 명령이 없음을 확인해야 합니다."
  );
  assert.match(
    capturePhase,
    /interceptedUrls\.some\(\(url\) => url === youtubeEmbed\)/u,
    "YouTube No-Cookie exact iframe도 production companion fixture로 실행해야 합니다."
  );
  assert.match(
    smoke,
    /failNextSnapshot[\s\S]*action-failed[\s\S]*transientFailureRecovered/u,
    "결정론적 browser smoke는 한 번의 플레이어 전환 실패 뒤 자동 복구를 검증해야 합니다."
  );
  const editorPhaseStart = smoke.indexOf("const editor = await waitFor");
  assert(editorPhaseStart > capturePhaseEnd, "browser smoke의 editor 단계 경계가 없습니다.");
  assert.match(
    smoke.slice(editorPhaseStart),
    /materialization|VOD 편집 영상을 준비하지 못했습니다/u,
    "편집기 진입 뒤 materialization 검증까지 금지해서는 안 됩니다."
  );
});

test("opt-in live VOD smoke도 컷은 streaming-only이고 editor 진입 뒤에만 media를 준비한다", async () => {
  const liveSmoke = await readFile(
    new URL("../scripts/local-studio-live-vod-smoke.ts", import.meta.url),
    "utf8"
  );
  const cutPhase = sourceSection(
    liveSmoke,
    "async function runCutPhase",
    "async function enterEditor"
  );
  assert.doesNotMatch(
    cutPhase,
    /local-preview|\/v1\/vod\/materializations|proveMediaHttp|cleanupEditorMaterialization/u
  );
  assert.match(cutPhase, /pressShortcut\("E"\)/u);
  assert.match(cutPhase, /pressShortcut\("F"\)/u);
  assert.match(cutPhase, /pressShortcut\("R"\)/u);
  assert.match(cutPhase, /iframeVisible[\s\S]*iframePreserved/u);
  assert.match(cutPhase, /acquisitionRequests\s*===\s*0/u);
  assert.match(liveSmoke, /--load-extension=\$\{companionRoot\}/u);

  const editorPhase = sourceSection(
    liveSmoke,
    "async function currentEditorMaterializationState",
    "async function runFixture"
  );
  assert.match(editorPhase, /#preview-video/u);
  assert.match(editorPhase, /proveMediaHttp/u);
  assert.match(editorPhase, /cleanupEditorMaterialization/u);
  assert.match(
    liveSmoke,
    /cutPhase = await runCutPhase[\s\S]*editorPhase = await waitForEditorMaterialization/u
  );
});
