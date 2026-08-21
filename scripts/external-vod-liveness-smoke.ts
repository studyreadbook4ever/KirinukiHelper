#!/usr/bin/env node

/**
 * Opt-in, network-backed liveness gate for the managed VOD-only materializer.
 *
 * This is deliberately a source/materializer test, not evidence that a native
 * installer was installed successfully. It uses the same pinned standalone
 * yt-dlp, FFmpeg, FFprobe, Node-runtime, and sanitized-process contract as the
 * headless local engine. Every platform gets a brand-new temporary VOD state
 * directory and random consumer identity; a cached receipt is a hard failure.
 *
 * The public fixtures require no login. The materializer itself enforces
 * --no-cookies, ignores user configuration/plugins, forbids remote components,
 * and never enables a DRM bypass. Any metadata, network, acquisition, or media
 * verification failure terminates this process with a non-zero exit status.
 */

import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  mkdir,
  mkdtemp,
  open,
  readdir,
  rm
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_EXTERNAL_VOD_HANDLE_MS,
  MAX_EXTERNAL_VOD_FRAME_RATE,
  MAX_EXTERNAL_VOD_HEIGHT,
  MAX_EXTERNAL_VOD_WIDTH,
  createExternalProcessEnvironment,
  externalPublishedArtifactInspectionBinding,
  inspectExternalMp4,
  materializeExternalVod,
  normalizeExternalVodUrl
} from "./external-vod-materializer.js";
import type {
  ExternalMediaInspection,
  ExternalVodMaterializationProgress,
  ExternalVodMaterializationResult,
  ExternalVodPlatform
} from "./external-vod-materializer.js";
import { prepareDesktopTools } from "./prepare-desktop-tools.js";
import {
  DESKTOP_YT_DLP_RELEASE,
  DESKTOP_PACKAGED_TARGETS,
  desktopToolTargetManifest
} from "../src/desktop/tool-manifest.js";
import {
  MAX_MATERIALIZED_MEDIA_DRIFT_MS
} from "../src/lib/chzzk-vod-materialization.js";
import {
  resolveDesktopBundledTools
} from "../src/desktop/runtime-spec.js";
import type {
  DesktopArchitecture,
  DesktopBundleTarget,
  DesktopPlatform
} from "../src/desktop/runtime-spec.js";

export interface ExternalVodLiveFixture {
  readonly platform: ExternalVodPlatform;
  readonly sourceUrl: string;
  readonly clip: Readonly<{
    id: string;
    startMs: number;
    endMs: number;
  }>;
}

export const EXTERNAL_VOD_LIVE_FIXTURES = Object.freeze<
  readonly Readonly<ExternalVodLiveFixture>[]
>([
  Object.freeze({
    platform: "CHZZK",
    sourceUrl: "https://chzzk.naver.com/video/14514980",
    clip: Object.freeze({ id: "fresh-chzzk", startMs: 20_000, endMs: 21_000 })
  }),
  Object.freeze({
    platform: "YOUTUBE",
    sourceUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    clip: Object.freeze({ id: "fresh-youtube", startMs: 5_000, endMs: 6_000 })
  }),
  Object.freeze({
    platform: "SOOP",
    sourceUrl: "https://vod.sooplive.com/player/169475287",
    clip: Object.freeze({ id: "fresh-soop", startMs: 20_000, endMs: 21_000 })
  })
]);

interface PublishedArtifactInspection {
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly media: ExternalMediaInspection;
}

export interface VerifiedLiveVodResult {
  readonly platform: ExternalVodPlatform;
  readonly sourceUrl: string;
  readonly selectedRangeMs: readonly [number, number];
  readonly editableRangeMs: readonly [number, number];
  readonly acquiredSectionRangesMs: readonly (readonly [number, number])[];
  readonly fetchedSourceEnvelopeMs: readonly [number, number];
  readonly sourceDurationMs: number;
  readonly materializedDurationMs: number;
  readonly ffprobeDurationMs: number;
  readonly artifactBytes: number;
  readonly sourceRootBytes: number;
  readonly artifactSha256: string;
  readonly video: Readonly<{
    codec: "h264";
    width: number;
    height: number;
    frameRate: number;
    timelineMs: readonly [number, number];
  }>;
  readonly audio: Readonly<{
    codec: "aac";
    sampleRate: number;
    channels: number;
    timelineMs: readonly [number, number];
  }>;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function safeFixture(fixture: Readonly<ExternalVodLiveFixture>): void {
  invariant(
    fixture.clip.id === `fresh-${fixture.platform.toLowerCase()}`,
    `${fixture.platform} fixture consumer clip identity가 고정 계약과 다릅니다.`
  );
  invariant(
    Number.isSafeInteger(fixture.clip.startMs)
      && Number.isSafeInteger(fixture.clip.endMs)
      && fixture.clip.startMs >= 0
      && fixture.clip.endMs > fixture.clip.startMs
      && fixture.clip.endMs - fixture.clip.startMs <= 1_000,
    `${fixture.platform} live fixture는 최대 1초의 양의 구간이어야 합니다.`
  );
}

function sameRange(
  actualStart: number,
  actualEnd: number,
  expected: readonly [number, number]
): boolean {
  return actualStart === expected[0] && actualEnd === expected[1];
}

function timelineMatchesDuration(
  timeline: Readonly<{ startMs: number; endMs: number; durationMs: number }>,
  expectedDurationMs: number
): boolean {
  return Number.isSafeInteger(timeline.startMs)
    && Number.isSafeInteger(timeline.endMs)
    && Number.isSafeInteger(timeline.durationMs)
    && timeline.startMs >= 0
    && timeline.startMs <= MAX_MATERIALIZED_MEDIA_DRIFT_MS
    && Math.abs(timeline.durationMs - expectedDurationMs)
      <= MAX_MATERIALIZED_MEDIA_DRIFT_MS
    && Math.abs(timeline.endMs - expectedDurationMs)
      <= MAX_MATERIALIZED_MEDIA_DRIFT_MS;
}

async function inspectPublishedArtifact({
  artifactPath,
  cwd,
  environment,
  ffprobeBinary
}: {
  readonly artifactPath: string;
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly ffprobeBinary: string;
}): Promise<Readonly<PublishedArtifactInspection>> {
  const handle = await open(
    artifactPath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)
  );
  try {
    const before = await handle.stat({ bigint: true });
    invariant(
      before.isFile()
        && before.size > 0n
        && before.size <= BigInt(Number.MAX_SAFE_INTEGER),
      "materializer 출력이 양의 크기의 regular file이 아닙니다."
    );
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < Number(before.size)) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, Number(before.size) - position),
        position
      );
      invariant(bytesRead > 0, "materializer 출력을 끝까지 읽지 못했습니다.");
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const binding = externalPublishedArtifactInspectionBinding({
      platform: process.platform,
      processId: process.pid,
      fileDescriptor: handle.fd
    });
    const media = await inspectExternalMp4(binding.inputPath, {
      cwd,
      env: environment,
      shell: false,
      ...(binding.inheritedInputFileDescriptor === undefined
        ? {}
        : { inheritedInputFileDescriptor: binding.inheritedInputFileDescriptor })
    }, { ffprobeBinary });
    const after = await handle.stat({ bigint: true });
    invariant(
      before.dev === after.dev
        && before.ino === after.ino
        && before.size === after.size
        && before.mtimeNs === after.mtimeNs
        && before.ctimeNs === after.ctimeNs,
      "materializer 출력이 독립 ffprobe 검증 중 변경되었습니다."
    );
    return Object.freeze({
      sha256: hash.digest("hex"),
      sizeBytes: Number(before.size),
      media
    });
  } finally {
    await handle.close();
  }
}

export function verifyFreshLiveVodMaterialization({
  fixture,
  result,
  published
}: {
  readonly fixture: Readonly<ExternalVodLiveFixture>;
  readonly result: Readonly<ExternalVodMaterializationResult>;
  readonly published: Readonly<PublishedArtifactInspection>;
}): Readonly<VerifiedLiveVodResult> {
  safeFixture(fixture);
  invariant(
    result.reused === false,
    `${fixture.platform} fresh state가 기존 cache/receipt를 재사용했습니다.`
  );
  const { manifest, receipt } = result;
  const normalizedSource = normalizeExternalVodUrl(
    fixture.sourceUrl,
    fixture.platform
  );
  invariant(
    manifest.source.platform === fixture.platform
      && manifest.source.contentType === "vod"
      && manifest.source.contentId === normalizedSource.contentId
      && receipt.canonicalUrl === normalizedSource.canonicalUrl,
    `${fixture.platform} materialization 원본 identity가 요청과 다릅니다.`
  );
  invariant(
    manifest.handleMs === DEFAULT_EXTERNAL_VOD_HANDLE_MS,
    `${fixture.platform} materialization handle이 고정 10초 계약과 다릅니다.`
  );
  const expectedEditableRange = Object.freeze([
    Math.max(0, fixture.clip.startMs - DEFAULT_EXTERNAL_VOD_HANDLE_MS),
    Math.min(
      manifest.sourceDurationMs,
      fixture.clip.endMs + DEFAULT_EXTERNAL_VOD_HANDLE_MS
    )
  ] as const);
  const expectedDurationMs = expectedEditableRange[1] - expectedEditableRange[0];
  invariant(expectedDurationMs > 0, `${fixture.platform} 기대 편집 범위가 비었습니다.`);

  const clipRanges = manifest.clipRanges ?? [];
  const clipRange = clipRanges.find((candidate) => (
    candidate.clipId === fixture.clip.id
  ));
  invariant(
    clipRanges.length === 1
      && clipRange !== undefined
      && sameRange(
        clipRange.sourceStartMs,
        clipRange.sourceEndMs,
        [fixture.clip.startMs, fixture.clip.endMs]
      )
      && sameRange(
        clipRange.editableSourceStartMs,
        clipRange.editableSourceEndMs,
        expectedEditableRange
      ),
    `${fixture.platform} clip/source/editable 시간축이 요청과 다릅니다.`
  );
  const window = manifest.windows[0];
  invariant(
    manifest.windows.length === 1
      && window !== undefined
      && sameRange(
        window.editableSourceStartMs,
        window.editableSourceEndMs,
        expectedEditableRange
      )
      && window.fetchedSourceStartMs <= expectedEditableRange[0]
      && window.fetchedSourceEndMs >= expectedEditableRange[1]
      && window.fetchedSourceStartMs >= 0
      && window.fetchedSourceEndMs <= manifest.sourceDurationMs
      && window.mediaStartMs === 0
      && window.mediaEndMs === expectedDurationMs
      && window.clipIds.length === 1
      && window.clipIds[0] === fixture.clip.id,
    `${fixture.platform} materialization window 시간축이 요청과 다릅니다.`
  );
  invariant(
    manifest.mediaDurationMs === expectedDurationMs,
    `${fixture.platform} materialized duration이 편집 범위와 다릅니다.`
  );

  const acquiredSections = [...receipt.acquiredSections].sort((left, right) => (
    left.sourceStartMs - right.sourceStartMs
      || left.sourceEndMs - right.sourceEndMs
  ));
  invariant(acquiredSections.length > 0, `${fixture.platform} 취득 section이 없습니다.`);
  let sectionCursor = expectedEditableRange[0];
  for (const section of acquiredSections) {
    invariant(
      section.sourceStartMs === sectionCursor
        && section.sourceEndMs > section.sourceStartMs,
      `${fixture.platform} 취득 section 시간축이 비연속이거나 겹칩니다.`
    );
    sectionCursor = section.sourceEndMs;
  }
  invariant(
    sectionCursor === expectedEditableRange[1],
    `${fixture.platform} 취득 section이 편집 범위를 끝까지 덮지 않습니다.`
  );

  invariant(
    receipt.artifact.sizeBytes === published.sizeBytes
      && receipt.artifact.hashSha256 === published.sha256,
    `${fixture.platform} receipt와 실제 출력 bytes/hash가 다릅니다: `
      + `receipt=${receipt.artifact.sizeBytes}/${receipt.artifact.hashSha256}, `
      + `actual=${published.sizeBytes}/${published.sha256}`
  );
  invariant(
    receipt.artifact.durationMs === published.media.durationMs
      && Math.abs(receipt.artifact.durationMs - manifest.mediaDurationMs)
        <= MAX_MATERIALIZED_MEDIA_DRIFT_MS,
    `${fixture.platform} receipt와 독립 ffprobe/논리 시간축이 다릅니다: `
      + `receipt=${receipt.artifact.durationMs}, `
      + `ffprobe=${published.media.durationMs}, `
      + `logical=${manifest.mediaDurationMs}`
  );
  invariant(
    Math.abs(published.media.durationMs - expectedDurationMs)
      <= MAX_MATERIALIZED_MEDIA_DRIFT_MS,
    `${fixture.platform} 독립 ffprobe duration이 편집 범위와 다릅니다.`
  );
  invariant(
    published.media.videoCodec === "h264"
      && published.media.audioCodec === "aac"
      && published.media.width > 0
      && published.media.width <= MAX_EXTERNAL_VOD_WIDTH
      && published.media.height > 0
      && published.media.height <= MAX_EXTERNAL_VOD_HEIGHT
      && published.media.frameRate > 0
      && published.media.frameRate <= MAX_EXTERNAL_VOD_FRAME_RATE + 0.001,
    `${fixture.platform} 독립 ffprobe codec/해상도/fps 검증에 실패했습니다.`
  );
  const videoTimeline = published.media.streamTimelines?.video;
  const audioTimeline = published.media.streamTimelines?.audio;
  invariant(
    videoTimeline !== undefined
      && audioTimeline !== undefined
      && timelineMatchesDuration(videoTimeline, expectedDurationMs)
      && timelineMatchesDuration(audioTimeline, expectedDurationMs),
    `${fixture.platform} 독립 ffprobe A/V 시간축이 편집 범위와 다릅니다.`
  );
  invariant(
    Number.isSafeInteger(published.media.audioSampleRate)
      && Number(published.media.audioSampleRate) > 0
      && Number.isSafeInteger(published.media.audioChannels)
      && Number(published.media.audioChannels) > 0,
    `${fixture.platform} AAC sample rate/channel 검증에 실패했습니다.`
  );
  const sourceRootBytes = receipt.sourceRoots.reduce(
    (sum, root) => sum + root.sizeBytes,
    0
  );
  invariant(sourceRootBytes > 0, `${fixture.platform} 실제 취득 source bytes가 없습니다.`);
  if (fixture.platform === "SOOP") {
    invariant(
      typeof receipt.sourceClockProof.browserClockIdentitySha256 === "string",
      "SOOP engine-derived root/entries clock identity가 receipt에 없습니다."
    );
  }

  return Object.freeze({
    platform: fixture.platform,
    sourceUrl: fixture.sourceUrl,
    selectedRangeMs: Object.freeze([
      fixture.clip.startMs,
      fixture.clip.endMs
    ] as const),
    editableRangeMs: expectedEditableRange,
    acquiredSectionRangesMs: Object.freeze(acquiredSections.map((section) => (
      Object.freeze([section.sourceStartMs, section.sourceEndMs] as const)
    ))),
    fetchedSourceEnvelopeMs: Object.freeze([
      window.fetchedSourceStartMs,
      window.fetchedSourceEndMs
    ] as const),
    sourceDurationMs: manifest.sourceDurationMs,
    materializedDurationMs: manifest.mediaDurationMs,
    ffprobeDurationMs: published.media.durationMs,
    artifactBytes: published.sizeBytes,
    sourceRootBytes,
    artifactSha256: published.sha256,
    video: Object.freeze({
      codec: "h264" as const,
      width: published.media.width,
      height: published.media.height,
      frameRate: published.media.frameRate,
      timelineMs: Object.freeze([
        videoTimeline.startMs,
        videoTimeline.endMs
      ] as const)
    }),
    audio: Object.freeze({
      codec: "aac" as const,
      sampleRate: Number(published.media.audioSampleRate),
      channels: Number(published.media.audioChannels),
      timelineMs: Object.freeze([
        audioTimeline.startMs,
        audioTimeline.endMs
      ] as const)
    })
  });
}

function currentDesktopTarget(): {
  readonly target: DesktopBundleTarget;
  readonly platform: DesktopPlatform;
  readonly arch: DesktopArchitecture;
} {
  const target = `${process.platform}-${process.arch}`;
  invariant(
    (DESKTOP_PACKAGED_TARGETS as readonly string[]).includes(target),
    `현재 host는 managed desktop VOD 도구 대상이 아닙니다: ${target}`
  );
  const [platform, arch] = target.split("-") as [
    DesktopPlatform,
    DesktopArchitecture
  ];
  return { target: target as DesktopBundleTarget, platform, arch };
}

export async function runExternalVodLivenessSmoke(): Promise<void> {
  invariant(
    process.env.KIRINUKI_EXTERNAL_VOD_LIVENESS_SMOKE === "1",
    "실제 공개 VOD 네트워크 테스트입니다. "
      + "KIRINUKI_EXTERNAL_VOD_LIVENESS_SMOKE=1을 명시해 주세요."
  );
  invariant(
    new Set(EXTERNAL_VOD_LIVE_FIXTURES.map(({ platform }) => platform)).size === 3,
    "CHZZK, YouTube, SOOP live fixture가 각각 정확히 하나여야 합니다."
  );
  EXTERNAL_VOD_LIVE_FIXTURES.forEach(safeFixture);

  const { target, platform, arch } = currentDesktopTarget();
  const preparedToolsRoot = await prepareDesktopTools(target);
  const resourcesRoot = path.dirname(path.dirname(preparedToolsRoot));
  const tools = resolveDesktopBundledTools({ platform, arch, resourcesRoot });
  invariant(
    path.resolve(tools.toolsRoot) === path.resolve(preparedToolsRoot),
    "검증된 managed desktop tool cache와 runtime 도구 경로가 다릅니다."
  );
  const toolManifest = desktopToolTargetManifest(target);
  const runRoot = await mkdtemp(
    path.join(os.tmpdir(), "kirinuki-managed-vod-live-")
  );
  const allStartedAt = performance.now();
  try {
    const results = [];
    for (const fixture of EXTERNAL_VOD_LIVE_FIXTURES) {
      const fixtureRoot = path.join(runRoot, fixture.platform.toLowerCase());
      const stateDir = path.join(fixtureRoot, "fresh-vod-state");
      const processTemp = path.join(fixtureRoot, "process-temp");
      await mkdir(stateDir, { recursive: true, mode: 0o700 });
      await mkdir(processTemp, { recursive: true, mode: 0o700 });
      invariant(
        (await readdir(stateDir)).length === 0,
        `${fixture.platform} fresh VOD state가 시작 전 비어 있지 않습니다.`
      );
      const environment = createExternalProcessEnvironment({
        LANG: process.env.LANG,
        LC_ALL: process.env.LC_ALL,
        LC_CTYPE: process.env.LC_CTYPE,
        NO_COLOR: "1",
        PATH: [tools.toolsRoot, path.dirname(process.execPath)].join(path.delimiter)
      }, processTemp);
      const startedAt = performance.now();
      const timeline: Array<{
        phase: ExternalVodMaterializationProgress["phase"];
        elapsedMs: number;
        completedBytes: number;
      }> = [];
      let previousPhase = "";
      const result = await materializeExternalVod({
        consumerId: `fresh-${fixture.platform.toLowerCase()}-${randomUUID()}`,
        sourceUrl: fixture.sourceUrl,
        clips: [fixture.clip],
        handleMs: DEFAULT_EXTERNAL_VOD_HANDLE_MS,
        stateDir,
        onProgress(progress) {
          if (progress.phase === previousPhase) {
            return;
          }
          previousPhase = progress.phase;
          timeline.push({
            phase: progress.phase,
            elapsedMs: Math.round(performance.now() - startedAt),
            completedBytes: progress.completedBytes
          });
        }
      }, {
        ytDlpBinary: tools.ytDlp.command,
        ytDlpMode: "standalone",
        nodeBinary: process.execPath,
        ffmpegBinary: tools.ffmpeg.command,
        ffprobeBinary: tools.ffprobe.command,
        processEnv: environment
      });
      const published = await inspectPublishedArtifact({
        artifactPath: result.artifactPath,
        cwd: fixtureRoot,
        environment,
        ffprobeBinary: tools.ffprobe.command
      });
      const verified = verifyFreshLiveVodMaterialization({
        fixture,
        result,
        published
      });
      invariant(
        timeline.some(({ phase }) => phase === "downloading")
          && timeline.some(({ phase }) => phase === "verifying")
          && timeline.some(({ phase }) => phase === "muxing")
          && timeline.at(-1)?.phase === "completed",
        `${fixture.platform} 실제 취득/검증/mux 완료 단계를 모두 관찰하지 못했습니다.`
      );
      results.push(Object.freeze({
        ...verified,
        totalMs: Math.round(performance.now() - startedAt),
        timeline: Object.freeze(timeline)
      }));
    }
    process.stdout.write(`${JSON.stringify({
      schema: "kirinuki-managed-vod-live-liveness/v2",
      ok: true,
      boundary: {
        kind: "source-materializer-with-verified-managed-desktop-tools",
        target,
        packagedInstallerEvidence: false,
        installedGatewayEvidence: false
      },
      accessPolicy: {
        publicVodOnly: true,
        loginUsed: false,
        cookiesUsed: false,
        drmBypassUsed: false,
        networkFailureAcceptedAsSuccess: false
      },
      cache: {
        vodState: "new-temporary-directory-per-platform",
        consumer: "new-random-identity-per-platform",
        receiptReuseAccepted: false
      },
      toolContract: {
        ffmpegVersion: toolManifest.ffmpegVersion,
        ffprobeVersion: toolManifest.ffprobeVersion,
        ytDlpVersion: DESKTOP_YT_DLP_RELEASE.version
      },
      totalMs: Math.round(performance.now() - allStartedAt),
      results
    }, null, 2)}\n`);
  } finally {
    await rm(runRoot, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath
  && path.resolve(invokedPath) === fileURLToPath(import.meta.url)
) {
  await runExternalVodLivenessSmoke();
}
