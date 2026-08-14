import assert from "node:assert/strict";
import test from "node:test";

import {
  createHtmlVideoStreamingBridgeAdapter,
  createSoopVodStreamingBridgeAdapter
} from "../src/web/streaming-bridge-content.js";
import {
  normalizeStreamingBridgePlayerSnapshot
} from "../src/web/streaming-bridge-protocol.js";
import {
  SOOP_VOD_SOURCE_CLOCK_IDENTITY_SCHEMA
} from "../src/lib/soop-vod-source-clock.js";

interface VideoMetrics {
  rectReads: number;
  currentTimeReads: number;
  seekableReads: number;
}

interface FakeVideoOptions {
  readonly width?: number;
  readonly height?: number;
  readonly currentTime?: number | (() => number);
  readonly duration?: number | (() => number);
  readonly paused?: boolean | (() => boolean);
  readonly playbackRate?: number | (() => number);
  readonly readyState?: number | (() => number);
  readonly seekable?: () => TimeRanges;
}

function readOption<T>(value: T | (() => T) | undefined, fallback: T): T {
  return typeof value === "function"
    ? (value as () => T)()
    : value ?? fallback;
}

function staticTimeRanges(start: number, end: number): TimeRanges {
  return {
    length: 1,
    start(index: number): number {
      assert.equal(index, 0);
      return start;
    },
    end(index: number): number {
      assert.equal(index, 0);
      return end;
    }
  } as TimeRanges;
}

function fakeVideo(options: FakeVideoOptions = {}): {
  readonly element: HTMLVideoElement;
  readonly metrics: VideoMetrics;
} {
  const metrics: VideoMetrics = {
    rectReads: 0,
    currentTimeReads: 0,
    seekableReads: 0
  };
  const element = {
    getBoundingClientRect(): DOMRect {
      metrics.rectReads += 1;
      return {
        width: options.width ?? 1280,
        height: options.height ?? 720
      } as DOMRect;
    },
    get currentTime(): number {
      metrics.currentTimeReads += 1;
      return readOption(options.currentTime, 42.5);
    },
    get duration(): number {
      return readOption(options.duration, 180);
    },
    get paused(): boolean {
      return readOption(options.paused, false);
    },
    get playbackRate(): number {
      return readOption(options.playbackRate, 1);
    },
    get readyState(): number {
      return readOption(options.readyState, 4);
    },
    get seekable(): TimeRanges {
      metrics.seekableReads += 1;
      return options.seekable?.() || staticTimeRanges(0, 180);
    }
  } as HTMLVideoElement;
  return { element, metrics };
}

function fakeDocument(
  readVideos: () => readonly HTMLVideoElement[]
): Document {
  return {
    defaultView: {
      getComputedStyle: () => ({
        visibility: "visible",
        display: "block"
      })
    },
    querySelectorAll(selector: string): readonly HTMLVideoElement[] {
      assert.equal(selector, "video");
      return readVideos();
    }
  } as unknown as Document;
}

function adapterFor(hostDocument: Document) {
  return createHtmlVideoStreamingBridgeAdapter({
    hostDocument,
    readSource: () => ({
      platform: "CHZZK",
      contentType: "vod",
      contentId: "169475287"
    })
  });
}

function transientIndexSizeError(): Error {
  const error = new Error("sensitive MSE implementation detail");
  error.name = "IndexSizeError";
  return error;
}

test("video 후보 점수는 한 번씩만 읽고 DOM 교체 뒤 새 primary video를 고른다", async () => {
  const small = fakeVideo({ width: 320, height: 180, currentTime: 11 });
  const large = fakeVideo({ width: 1280, height: 720, currentTime: 22 });
  const replacement = fakeVideo({
    width: 1920,
    height: 1080,
    currentTime: 33
  });
  let videos: readonly HTMLVideoElement[] = [small.element, large.element];
  const adapter = adapterFor(fakeDocument(() => videos));

  const first = await adapter.snapshot();
  assert.equal(first.found, true);
  assert.equal(first.currentTime, 22);
  assert.equal(small.metrics.rectReads, 1);
  assert.equal(large.metrics.rectReads, 1);
  assert.equal(small.metrics.currentTimeReads, 0);
  assert.equal(large.metrics.currentTimeReads, 1);

  videos = [replacement.element];
  const second = await adapter.snapshot();
  assert.equal(second.found, true);
  assert.equal(second.currentTime, 33);
  assert.equal(small.metrics.rectReads, 1);
  assert.equal(large.metrics.rectReads, 1);
  assert.equal(replacement.metrics.rectReads, 1);
  assert.equal(replacement.metrics.currentTimeReads, 1);
});

test("광고 의미 조상의 video를 제외하고 연결된 원본 video 선택을 유지한다", async () => {
  const main = fakeVideo({
    width: 640,
    height: 360,
    currentTime: 31,
    duration: 4_000
  });
  const alternate = fakeVideo({
    width: 320,
    height: 180,
    currentTime: 62,
    duration: 3_000
  });
  const advertising = fakeVideo({
    width: 1920,
    height: 1080,
    currentTime: 7,
    duration: 90
  });
  const adAncestor = {
    getAttribute(name: string): string | null {
      return name === "data-role" ? "imaAdContainerEl" : null;
    },
    parentElement: null
  } as unknown as Element;
  Object.defineProperty(advertising.element, "parentElement", {
    configurable: true,
    value: adAncestor
  });
  let videos: readonly HTMLVideoElement[] = [
    advertising.element,
    alternate.element,
    main.element
  ];
  const adapter = adapterFor(fakeDocument(() => videos));

  const first = await adapter.snapshot();
  assert.equal(first.currentTime, 31, "광고 video가 원본 시계로 선택됐습니다.");

  videos = [alternate.element, main.element, advertising.element];
  const second = await adapter.snapshot();
  assert.equal(second.currentTime, 31, "연결된 원본 video 선택이 흔들렸습니다.");
  assert.equal(advertising.metrics.currentTimeReads, 0);
});

test("snapshot은 하나의 seekable reference와 length만 사용한다", async () => {
  let lengthReads = 0;
  const ranges = {
    get length(): number {
      lengthReads += 1;
      if (lengthReads > 1) {
        throw transientIndexSizeError();
      }
      return 1;
    },
    start(index: number): number {
      assert.equal(index, 0);
      return 12;
    },
    end(index: number): number {
      assert.equal(index, 0);
      return 150;
    }
  } as TimeRanges;
  const video = fakeVideo({
    seekable: () => {
      if (video.metrics.seekableReads > 1) {
        throw transientIndexSizeError();
      }
      return ranges;
    }
  });
  const snapshot = await adapterFor(
    fakeDocument(() => [video.element])
  ).snapshot();

  assert.equal(snapshot.found, true);
  assert.equal(snapshot.seekableStart, 12);
  assert.equal(snapshot.seekableEnd, 150);
  assert.equal(video.metrics.seekableReads, 1);
  assert.equal(lengthReads, 1);
  assert.deepEqual(normalizeStreamingBridgePlayerSnapshot(snapshot), snapshot);
});

test("TimeRanges IndexSizeError는 유효한 재생 시계를 버리지 않고 범위만 null로 낮춘다", async () => {
  const ranges = {
    length: 1,
    start(): number {
      throw transientIndexSizeError();
    },
    end(): number {
      return 180;
    }
  } as TimeRanges;
  const video = fakeVideo({ currentTime: 73.25, seekable: () => ranges });
  const snapshot = await adapterFor(
    fakeDocument(() => [video.element])
  ).snapshot();

  assert.equal(snapshot.found, true);
  assert.equal(snapshot.currentTime, 73.25);
  assert.equal(snapshot.seekableStart, null);
  assert.equal(snapshot.seekableEnd, null);
  assert.deepEqual(normalizeStreamingBridgePlayerSnapshot(snapshot), snapshot);
});

test("필수 media getter가 순간 실패하면 raw 오류 대신 strict unavailable snapshot을 반환한다", async () => {
  const video = fakeVideo({
    currentTime: () => {
      throw new Error("sensitive player internals");
    }
  });
  const snapshot = await adapterFor(
    fakeDocument(() => [video.element])
  ).snapshot();

  assert.deepEqual(snapshot, {
    found: false,
    currentTime: null,
    duration: null,
    paused: null,
    playbackRate: null,
    readyState: null,
    seekableStart: null,
    seekableEnd: null
  });
  assert.deepEqual(normalizeStreamingBridgePlayerSnapshot(snapshot), snapshot);
});

interface SoopFixturePart {
  readonly idx: number;
  readonly file_order: number;
  readonly id: string;
  readonly duration: number;
}

interface SoopFixtureOptions {
  readonly contentId?: string;
  readonly logicalParts?: readonly SoopFixturePart[];
  readonly coreParts?: readonly unknown[];
  readonly controllerParts?: readonly unknown[];
  readonly currentIndex?: number;
  readonly localTime?: number;
  readonly playingTimeOffset?: number;
  readonly totalFileDuration?: number;
  readonly titleNo?: string | number;
  readonly currentFileItem?: unknown;
  readonly media?: unknown;
  readonly transitioning?: boolean;
  readonly includeCore?: boolean;
  readonly includeController?: boolean;
  readonly includeSeek?: boolean;
}

const soopMultipartParts = Object.freeze([
  Object.freeze({
    idx: 0,
    file_order: 1,
    id: "20260813_957F0226_296331085_1",
    duration: 9_263
  }),
  Object.freeze({
    idx: 1,
    file_order: 2,
    id: "20260813_2E5CCAED_296331085_2",
    duration: 17_747
  }),
  Object.freeze({
    idx: 2,
    file_order: 3,
    id: "20260813_83AC2B9F_296331085_3",
    duration: 6_709
  })
] satisfies readonly SoopFixturePart[]);

function fixturePartStart(
  parts: readonly SoopFixturePart[],
  index: number
): number {
  return parts.slice(0, index).reduce((total, part) => (
    total + part.duration
  ), 0);
}

function createSoopFixture(options: SoopFixtureOptions = {}) {
  const contentId = options.contentId || "296331085";
  const logicalParts = [...(options.logicalParts || soopMultipartParts)];
  const coreParts = options.coreParts || logicalParts;
  const controllerParts = options.controllerParts || coreParts;
  let currentIndex = options.currentIndex ?? 1;
  let localTime = options.localTime ?? 11_860.000371;
  let playbackRate = 1;
  const seekCalls: number[] = [];
  const video = fakeVideo({
    currentTime: () => localTime,
    duration: () => logicalParts[currentIndex]!.duration + 0.75,
    paused: true,
    playbackRate: () => playbackRate,
    readyState: 4
  });
  Object.defineProperty(video.element, "playbackRate", {
    configurable: true,
    get: () => playbackRate,
    set: (value: number) => {
      playbackRate = Number(value);
    }
  });
  const controller: Record<string, unknown> = {
    get fileItems() {
      return controllerParts;
    },
    get playIdx() {
      return currentIndex;
    },
    get currentFileItem() {
      return options.currentFileItem === undefined
        ? logicalParts[currentIndex]
        : options.currentFileItem;
    },
    get playingTime() {
      return fixturePartStart(logicalParts, currentIndex)
        + localTime
        + (options.playingTimeOffset || 0);
    },
    get media() {
      return options.media === undefined ? video.element : options.media;
    },
    get isChangeFileSeeking() {
      return options.transitioning || false;
    },
    get isSeeking() {
      return false;
    },
    get isPreloadingNextMedia() {
      return false;
    }
  };
  const core: Record<string, unknown> = {
    fileItems: coreParts,
    config: {
      titleNo: options.titleNo ?? contentId,
      totalFileDuration: options.totalFileDuration ?? 33_720
    }
  };
  if (options.includeController !== false) {
    core.playerController = controller;
  }
  if (options.includeSeek !== false) {
    core.seek = (targetSeconds: number): void => {
      seekCalls.push(targetSeconds);
      const total = logicalParts.reduce((sum, part) => sum + part.duration, 0);
      currentIndex = targetSeconds === total
        ? logicalParts.length - 1
        : logicalParts.findIndex((part, index) => (
          targetSeconds < fixturePartStart(logicalParts, index) + part.duration
        ));
      localTime = targetSeconds - fixturePartStart(logicalParts, currentIndex);
    };
  }
  const hostWindow = {
    vodCore: options.includeCore === false ? undefined : core
  } as unknown as Window;
  const hostDocument = fakeDocument(() => [video.element]);
  return {
    adapter: createSoopVodStreamingBridgeAdapter({
      hostDocument,
      hostWindow,
      seekVerificationTimeoutMs: 25,
      readSource: () => ({
        platform: "SOOP",
        contentType: "vod",
        contentId
      })
    }),
    controller,
    core,
    video,
    seekCalls,
    readPlaybackRate: () => playbackRate
  };
}

test("SOOP multipart는 공식 part prefix와 현재 media 시계를 합친 전역 시각만 반환한다", async () => {
  const { adapter } = createSoopFixture();
  const snapshot = await adapter.snapshot();

  assert.deepEqual(snapshot, {
    found: true,
    currentTime: 9_263 + 11_860.000371,
    duration: 33_719,
    paused: true,
    playbackRate: 1,
    readyState: 4,
    seekableStart: 0,
    seekableEnd: 33_719,
    sourceClockIdentity: {
      schema: SOOP_VOD_SOURCE_CLOCK_IDENTITY_SCHEMA,
      platform: "SOOP",
      contentId: "296331085",
      totalDurationSeconds: 33_719,
      parts: soopMultipartParts.map((part) => ({
        id: part.id,
        index: part.idx,
        order: part.file_order,
        durationSeconds: part.duration
      }))
    },
    sourceClockPosition: {
      partId: soopMultipartParts[1]!.id,
      partIndex: 1,
      partOrder: 2,
      partTimeSeconds: 11_860.000371,
      globalTimeSeconds: 9_263 + 11_860.000371
    }
  });
  assert.deepEqual(normalizeStreamingBridgePlayerSnapshot(snapshot), snapshot);
  assert.equal(normalizeStreamingBridgePlayerSnapshot({
    ...snapshot,
    sourceClockPosition: {
      ...snapshot.sourceClockPosition,
      partIndex: 0
    }
  }), null, "현재 part와 전역 시각의 binding이 깨졌는데 snapshot이 수용됐습니다.");
});

test("SOOP 현재 player의 fileInfoKey part vector를 공식 전역 시계로 사용한다", async () => {
  const currentShapeParts = soopMultipartParts.map(({ id, ...part }) => ({
    ...part,
    fileInfoKey: id
  }));
  const fixture = createSoopFixture({
    coreParts: currentShapeParts,
    controllerParts: currentShapeParts,
    currentFileItem: currentShapeParts[1]
  });
  const snapshot = await fixture.adapter.snapshot();
  assert.equal(snapshot.found, true);
  assert.deepEqual(
    snapshot.sourceClockIdentity?.parts.map((part) => part.id),
    soopMultipartParts.map((part) => part.id)
  );
  assert.equal(snapshot.sourceClockPosition?.partId, soopMultipartParts[1]!.id);
});

test("SOOP single-part도 공식 controller·part vector·seek 증명 없이는 raw video로 fallback하지 않는다", async () => {
  const part = Object.freeze({
    idx: 0,
    file_order: 1,
    id: "20260814_SINGLE_169475287_1",
    duration: 180
  });
  const valid = createSoopFixture({
    contentId: "169475287",
    logicalParts: [part],
    currentIndex: 0,
    localTime: 42.125,
    totalFileDuration: 180,
    titleNo: 169475287
  });
  const missingCore = createSoopFixture({ includeCore: false });
  const missingSeek = createSoopFixture({ includeSeek: false });

  assert.equal((await valid.adapter.snapshot()).currentTime, 42.125);
  assert.equal((await valid.adapter.snapshot()).duration, 180);
  assert.equal((await missingCore.adapter.snapshot()).found, false);
  assert.equal((await missingSeek.adapter.snapshot()).found, false);
});

test("SOOP controller의 malformed·불일치·전환 상태는 모두 fail closed한다", async () => {
  const duplicateIds = soopMultipartParts.map((part, index) => ({
    ...part,
    id: index === 1 ? soopMultipartParts[0]!.id : part.id
  }));
  const mismatchedControllerParts = soopMultipartParts.map((part, index) => ({
    ...part,
    duration: index === 2 ? part.duration + 1 : part.duration
  }));
  const otherVideo = fakeVideo().element;
  const invalidFixtures = [
    createSoopFixture({ coreParts: duplicateIds }),
    createSoopFixture({
      coreParts: soopMultipartParts.map((part, index) => ({
        ...part,
        ...(index === 0 ? { fileInfoKey: "different-official-part" } : {})
      }))
    }),
    createSoopFixture({ controllerParts: mismatchedControllerParts }),
    createSoopFixture({ titleNo: "999999999" }),
    createSoopFixture({ totalFileDuration: 40_000 }),
    createSoopFixture({ currentFileItem: soopMultipartParts[0] }),
    createSoopFixture({ playingTimeOffset: 2 }),
    createSoopFixture({ media: otherVideo }),
    createSoopFixture({ transitioning: true }),
    createSoopFixture({ localTime: soopMultipartParts[1]!.duration + 0.1 }),
    createSoopFixture({ includeController: false })
  ];

  for (const fixture of invalidFixtures) {
    assert.equal((await fixture.adapter.snapshot()).found, false);
  }
});

test("SOOP seek는 part-local video.currentTime이 아니라 공식 global seek를 호출하고 검증한다", async () => {
  const fixture = createSoopFixture({ currentIndex: 0, localTime: 100 });

  await fixture.adapter.seekAbsolute(21_123);
  assert.deepEqual(fixture.seekCalls, [21_123]);
  assert.equal((await fixture.adapter.snapshot()).currentTime, 21_123);

  await fixture.adapter.setPlaybackRate(2);
  assert.equal(fixture.readPlaybackRate(), 2);
});
