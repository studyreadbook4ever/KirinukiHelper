import assert from "node:assert/strict";
import type { ChildProcess, SpawnOptions, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  link,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  EXTERNAL_VOD_CACHE_SCHEMA,
  EXTERNAL_VOD_CONSUMER_SCOPE_DOMAIN,
  LEGACY_EXTERNAL_VOD_CACHE_SCHEMA,
  EXTERNAL_METADATA_TIMEOUT_MS,
  MAX_EXTERNAL_VOD_MATERIALIZED_MS,
  MAX_EXTERNAL_VOD_WORK_BYTES,
  ExternalVodMaterializationError,
  FORBIDDEN_EXTERNAL_YT_DLP_FLAGS,
  assertExternalDiskHeadroom,
  assertExternalMaterializationByteQuota,
  assertExternalYtDlpArgsSafe,
  buildExternalConcatArgs,
  buildExternalDirectClockProbeArgs,
  buildExternalFfprobeArgs,
  buildExternalMetadataProbeArgs,
  buildExternalSelectedSourceProbeArgs,
  compatibleExternalPacketCopySignatures,
  createExternalProcessEnvironment,
  externalPublishedArtifactInspectionBinding,
  externalVodConsumerScopeHash,
  externalYtDlpCommand,
  materializeExternalVod as strictMaterializeExternalVod,
  missingExternalVodSections,
  normalizeExternalVodUrl,
  parseExternalMediaInspection,
  parseExternalVodMetadata,
  planExternalVodSections,
  probeExternalVodMetadata,
  runExternalProcess,
  terminateWindowsExternalProcessTree
} from "../scripts/external-vod-materializer.js";
import type {
  ExternalMediaInspection,
  ExternalProcessResult,
  ExternalProcessRunOptions,
  ExternalProcessRunner,
  ExternalVodMaterializerDependencies,
  ExternalVodMaterializationRequest,
  ExternalVodMaterializationResult,
  ExternalVodMetadata
} from "../scripts/external-vod-materializer.js";
import { windowsTaskkillOuterGuardTimeoutMs } from
  "../scripts/process-tree-termination.js";
import {
  resolveExternalVodClockProofSet
} from "../scripts/external-vod-clock-resolver.js";
import type {
  ExternalVodClockProofSetResolution
} from "../scripts/external-vod-clock-resolver.js";
import { externalVodDirectClockProofId } from
  "../scripts/external-vod-direct-acquirer.js";
import type { ExternalVodDirectClockProof } from
  "../scripts/external-vod-direct-acquirer.js";
import { externalVodHlsPlaylistFingerprintSha256 } from
  "../scripts/external-vod-hls-acquirer.js";
import type { ExternalVodHlsTimeline } from
  "../scripts/external-vod-hls-acquirer.js";
import { normalizeChzzkVodMaterialization } from
  "../src/lib/chzzk-vod-materialization.js";

const YOUTUBE_ID = "abcdefghijk";
const YOUTUBE_URL = `https://www.youtube.com/watch?v=${YOUTUBE_ID}`;
const CHZZK_ID = "14514980";
const CHZZK_URL = `https://chzzk.naver.com/video/${CHZZK_ID}`;
const SOOP_ID = "123456789";
const SOOP_URL = `https://vod.sooplive.com/player/${SOOP_ID}`;
const PYTHON_BINARY = "/usr/bin/python3";
const YT_DLP_ARTIFACT = "/opt/kirinuki/yt-dlp";
const TEST_CONSUMER_ID = "kirinuki-test-editor-project";

function soopSourceClockIdentity(
  parts: readonly { id: string; durationSeconds: number }[]
): unknown {
  return {
    schema: "kirinuki-soop-vod-source-clock/v1",
    platform: "SOOP",
    contentId: SOOP_ID,
    totalDurationSeconds: parts.reduce((total, part) => (
      total + part.durationSeconds
    ), 0),
    parts: parts.map((part, index) => ({
      id: part.id,
      index,
      order: index + 1,
      durationSeconds: part.durationSeconds
    }))
  };
}

function optionValue(args: readonly string[], name: string): string {
  const index = args.indexOf(name);
  assert.notEqual(index, -1, `${name} 옵션이 없습니다.`);
  const value = args[index + 1];
  assert.ok(value, `${name} 값이 없습니다.`);
  return value;
}

function assertIsolatedYtDlpInvocation(args: readonly string[]): void {
  assert.equal(args[0], "-I");
  assert.equal(args[1], YT_DLP_ARTIFACT);
}

function editorSafeInspection(
  durationMs: number,
  audioCodec: "aac" | null = "aac"
): ExternalMediaInspection {
  return {
    durationMs,
    streamTimelines: {
      video: { startMs: 0, durationMs, endMs: durationMs },
      ...(audioCodec === "aac"
        ? { audio: { startMs: 0, durationMs, endMs: durationMs } }
        : {})
    },
    videoCodec: "h264",
    audioCodec,
    width: 1920,
    height: 1080,
    frameRate: 60,
    ...(audioCodec === "aac"
      ? {
        audioSampleRate: 48_000,
        audioChannels: 2,
        audioChannelLayout: "stereo"
      }
      : {})
  };
}

function fixtureBox(type: string): Buffer {
  const value = Buffer.alloc(8);
  value.writeUInt32BE(8, 0);
  value.write(type, 4, 4, "latin1");
  return value;
}

const FIXTURE_HLS_INIT = Buffer.concat([
  fixtureBox("ftyp"),
  fixtureBox("moov")
]);
const FIXTURE_HLS_FRAGMENT = Buffer.concat([
  fixtureBox("moof"),
  fixtureBox("mdat")
]);

async function fixtureClockProofSet(
  metadata: ExternalVodMetadata,
  parts: readonly ExternalVodMetadata["parts"][number][]
): Promise<ExternalVodClockProofSetResolution> {
  return await resolveExternalVodClockProofSet({
    platform: metadata.platform,
    contentId: metadata.contentId,
    sourceVersionId: metadata.sourceVersionId,
    sourceDurationMs: metadata.durationMs,
    metadataPartCount: metadata.parts.length,
    parts: parts.map((part) => ({
      partIndex: metadata.parts.findIndex((candidate) => (
        candidate.id === part.id
        && candidate.sourceStartMs === part.sourceStartMs
        && candidate.sourceEndMs === part.sourceEndMs
        && candidate.playlistItem === part.playlistItem
      )),
      ...(part.playlistItem === undefined
        ? {}
        : { playlistItem: part.playlistItem }),
      partId: part.id,
      sourceStartMs: part.sourceStartMs,
      sourceEndMs: part.sourceEndMs,
      durationMs: part.durationMs
    }))
  }, {
    async resolveSelectedPart(part) {
      const durationUs = part.durationMs * 1_000;
      if (metadata.platform === "YOUTUBE") {
        const videoIdentity = `youtube:${metadata.contentId}:fixture-video`;
        const audioIdentity = `youtube:${metadata.contentId}:fixture-audio`;
        const clockProofWithoutId: Omit<
          ExternalVodDirectClockProof,
          "proofId"
        > = {
          playerDurationUs: durationUs,
          zeroOrigin: true,
          video: {
            semanticIdentitySha256: sha256Buffer(videoIdentity),
            startUs: 0,
            durationUs
          },
          audio: {
            semanticIdentitySha256: sha256Buffer(audioIdentity),
            startUs: 0,
            durationUs
          }
        };
        return {
          kind: "direct",
          platform: "YOUTUBE",
          contentId: metadata.contentId,
          partId: part.partId,
          formatIdentity: `format:${sha256Buffer("youtube-fixture-format")}`,
          clockProof: {
            ...clockProofWithoutId,
            proofId: externalVodDirectClockProofId(clockProofWithoutId)
          },
          runtimeInputs: {
            video: {
              url: "https://rr1.googlevideo.com/fixture/video",
              semanticIdentity: videoIdentity,
              publicHeaders: {}
            },
            audio: {
              url: "https://rr1.googlevideo.com/fixture/audio",
              semanticIdentity: audioIdentity,
              publicHeaders: {}
            }
          }
        };
      }
      const host = metadata.platform === "CHZZK"
        ? "vod.pstatic.net"
        : "vod.sooplive.com";
      const prefix = `https://${host}/kirinuki-fixture/${metadata.contentId}/${part.partIndex}`;
      const timelineWithoutFingerprint: Omit<
        ExternalVodHlsTimeline,
        "playlistFingerprintSha256"
      > = {
        playlistUri: `${prefix}/index.m3u8`,
        playlistSemanticUri: `${prefix}/index.m3u8`,
        renditionFingerprintSha256: sha256Buffer(`${prefix}:rendition`),
        durationUs,
        hasEndList: true,
        hasIndependentSegments: true,
        map: {
          uri: `${prefix}/init.mp4`,
          semanticUri: `${prefix}/init.mp4`
        },
        segments: [{
          sequence: 0,
          startUs: 0,
          durationUs,
          uri: `${prefix}/segment-0.m4s`,
          semanticUri: `${prefix}/segment-0.m4s`
        }]
      };
      return {
        kind: "hls",
        platform: metadata.platform,
        contentId: metadata.contentId,
        partId: part.partId,
        formatIdentity: `format:${sha256Buffer(`${metadata.platform}:fixture-format`)}`,
        requestHeaders: {
          "User-Agent": "Kirinuki strict HLS fixture",
          Referer: "https://kirinuki.eff0rtchung.kr/"
        },
        timeline: {
          ...timelineWithoutFingerprint,
          playlistFingerprintSha256: externalVodHlsPlaylistFingerprintSha256(
            timelineWithoutFingerprint
          )
        }
      };
    }
  });
}

const fixtureFetch: typeof globalThis.fetch = async (input, init) => {
  const url = input instanceof URL
    ? input
    : new URL(typeof input === "string" ? input : input.url);
  const headers = new Headers(init?.headers);
  assert.equal(headers.get("accept-encoding"), "identity");
  assert.equal(headers.get("user-agent"), "Kirinuki strict HLS fixture");
  assert.equal(headers.get("referer"), "https://kirinuki.eff0rtchung.kr/");
  const body = url.pathname.endsWith("init.mp4")
    ? FIXTURE_HLS_INIT
    : FIXTURE_HLS_FRAGMENT;
  return new Response(body, {
    status: 200,
    headers: {
      "content-length": String(body.byteLength),
      "content-encoding": "identity"
    }
  });
};

async function materializeExternalVod(
  request: ExternalVodMaterializationRequest,
  dependencies: ExternalVodMaterializerDependencies = {}
): Promise<ExternalVodMaterializationResult> {
  return await strictMaterializeExternalVod(request, {
    resolveClockProofSet: fixtureClockProofSet,
    fetchImpl: fixtureFetch,
    ...dependencies
  });
}

function sha256Buffer(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function youtubeFixtureDependencies(
  overrides: Partial<ExternalVodMaterializerDependencies> = {},
  afterMux?: (outputPath: string) => Promise<void>
): ExternalVodMaterializerDependencies {
  const runProcess: ExternalProcessRunner = async (command, args) => {
    if (command === PYTHON_BINARY && args.includes("--dump-single-json")) {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          id: YOUTUBE_ID,
          extractor: "youtube",
          duration: 120,
          availability: "public",
          live_status: "not_live",
          timestamp: 1_700_000_000
        }),
        stderr: ""
      };
    }
    if (command === PYTHON_BINARY) {
      const outputPath = path.join(
        optionValue(args, "--paths"),
        optionValue(args, "--output").replace("%(ext)s", "mp4")
      );
      await writeFile(outputPath, "youtube-section");
      return { exitCode: 0, stdout: `${outputPath}\n`, stderr: "" };
    }
    assert.equal(command, "ffmpeg");
    const outputPath = args.at(-1);
    assert.ok(outputPath);
    await writeFile(outputPath, "youtube-final-mp4");
    await afterMux?.(outputPath);
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  return {
    runProcess,
    pythonBinary: PYTHON_BINARY,
    ytDlpBinary: YT_DLP_ARTIFACT,
    inspectMedia: async () => editorSafeInspection(21_000),
    statFileSystem: async () => ({
      bavail: BigInt(MAX_EXTERNAL_VOD_WORK_BYTES),
      bsize: 1n
    }),
    ...overrides
  };
}

test("외부 VOD consumer scope는 domain-separated SHA-256만 경로 식별자로 사용한다", () => {
  const consumerId = "../조직/프로젝트?raw-consumer";
  const expected = createHash("sha256")
    .update(EXTERNAL_VOD_CONSUMER_SCOPE_DOMAIN, "utf8")
    .update("\0", "utf8")
    .update(consumerId, "utf8")
    .digest("hex");
  const scopeHash = externalVodConsumerScopeHash(consumerId);
  assert.equal(scopeHash, expected);
  assert.match(scopeHash, /^[a-f0-9]{64}$/u);
  assert.notEqual(scopeHash, sha256Buffer(consumerId));
  assert.equal(
    externalVodConsumerScopeHash(`  ${consumerId}  `),
    scopeHash,
    "주변 공백은 consumer identity가 아니어야 합니다."
  );
  for (const invalid of [
    undefined,
    "",
    " \t ",
    "consumer\nconfusion",
    "x".repeat(257)
  ]) {
    assert.throws(
      () => externalVodConsumerScopeHash(invalid),
      (error: unknown) => {
        assert(error instanceof ExternalVodMaterializationError);
        assert.equal(error.code, "INVALID_CONSUMER_ID");
        return true;
      }
    );
  }
});

test("동일 semantic 계획도 consumer별 물리 job을 격리하고 같은 consumer만 재사용한다", async (t) => {
  const stateDir = await mkdtemp(path.join(
    os.tmpdir(),
    "kirinuki-external-consumer-scope-"
  ));
  t.after(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });
  const consumerA = "../tenant/A/raw";
  const consumerB = "조직/B/편집 세션";
  const commonRequest = {
    sourceUrl: YOUTUBE_URL,
    clips: [{ id: "clip", startMs: 20_000, endMs: 21_000 }],
    stateDir
  } as const;
  const firstA = await materializeExternalVod({
    ...commonRequest,
    consumerId: consumerA
  }, youtubeFixtureDependencies());
  const firstAJobDirectory = path.dirname(firstA.artifactPath);
  assert.equal(firstAJobDirectory, path.join(
    stateDir,
    "consumers",
    externalVodConsumerScopeHash(consumerA),
    "jobs",
    "youtube",
    firstA.manifest.materializationId
  ));
  assert.equal(firstAJobDirectory.includes(consumerA), false);

  await assert.rejects(
    materializeExternalVod({
      ...commonRequest,
      consumerId: consumerB,
      base: {
        materializationId: firstA.manifest.materializationId,
        planFingerprint: firstA.manifest.planFingerprint,
        contentId: YOUTUBE_ID
      }
    }, youtubeFixtureDependencies()),
    (error: unknown) => {
      assert(error instanceof ExternalVodMaterializationError);
      assert.equal(error.code, "INVALID_BASE_MATERIALIZATION");
      return true;
    }
  );

  // Put a fully valid old-layout job exactly where pre-scope code used to
  // look. A different consumer must still materialize its own physical job.
  const legacyUnscopedJobDirectory = path.join(
    stateDir,
    "jobs",
    "youtube",
    firstA.manifest.materializationId
  );
  await mkdir(path.dirname(legacyUnscopedJobDirectory), { recursive: true });
  await rename(firstAJobDirectory, legacyUnscopedJobDirectory);
  const resume = {
    materializationId: firstA.manifest.materializationId,
    planFingerprint: firstA.manifest.planFingerprint,
    contentId: YOUTUBE_ID
  } as const;
  const firstB = await materializeExternalVod({
    ...commonRequest,
    consumerId: consumerB,
    resume
  }, youtubeFixtureDependencies());
  assert.equal(firstB.reused, false, "unscoped legacy job을 읽으면 안 됩니다.");

  const rebuiltA = await materializeExternalVod({
    ...commonRequest,
    consumerId: consumerA,
    resume
  }, youtubeFixtureDependencies());
  assert.equal(rebuiltA.reused, false);
  assert.equal(rebuiltA.manifest.planFingerprint, firstB.manifest.planFingerprint);
  assert.equal(rebuiltA.manifest.materializationId, firstB.manifest.materializationId);
  assert.notEqual(rebuiltA.artifactPath, firstB.artifactPath);
  assert.equal(path.dirname(firstB.artifactPath), path.join(
    stateDir,
    "consumers",
    externalVodConsumerScopeHash(consumerB),
    "jobs",
    "youtube",
    firstB.manifest.materializationId
  ));
  assert.equal(firstB.artifactPath.includes(consumerB), false);

  const reusedB = await materializeExternalVod({
    ...commonRequest,
    consumerId: consumerB,
    resume
  }, {
    processEnv: {},
    runProcess: async () => {
      assert.fail("같은 consumer의 검증된 job은 offline 재사용되어야 합니다.");
    },
    inspectMedia: async () => {
      assert.fail("같은 consumer의 offline 재개는 ffprobe가 필요하지 않습니다.");
    }
  });
  assert.equal(reusedB.reused, true);
  assert.equal(reusedB.artifactPath, firstB.artifactPath);

  await rm(path.dirname(rebuiltA.artifactPath), { recursive: true });
  assert.equal(await readFile(firstB.artifactPath, "utf8"), "youtube-final-mp4");
  assert.equal(
    await readFile(
      path.join(
        legacyUnscopedJobDirectory,
        firstA.receipt.artifact.cacheFileName
      ),
      "utf8"
    ),
    "youtube-final-mp4"
  );
  const afterOtherConsumerDeletion = await materializeExternalVod({
    ...commonRequest,
    consumerId: consumerB,
    resume
  }, {
    processEnv: {},
    runProcess: async () => {
      assert.fail("다른 consumer 삭제가 이 consumer의 offline 재개를 깨면 안 됩니다.");
    }
  });
  assert.equal(afterOtherConsumerDeletion.reused, true);
  assert.equal(afterOtherConsumerDeletion.artifactPath, firstB.artifactPath);
});

test("CHZZK·YouTube·SOOP 단일 VOD 주소를 의미가 같은 canonical 주소로 만든다", () => {
  for (const value of [
    `https://youtube.com/watch?v=${YOUTUBE_ID}&t=12&list=ignored`,
    `https://m.youtube.com/shorts/${YOUTUBE_ID}?feature=share`,
    `https://youtu.be/${YOUTUBE_ID}?t=90`
  ]) {
    assert.deepEqual(normalizeExternalVodUrl(value), {
      platform: "YOUTUBE",
      canonicalUrl: YOUTUBE_URL,
      contentId: YOUTUBE_ID
    });
  }
  for (const value of [
    `${CHZZK_URL}?from=share#ignored`,
    `${CHZZK_URL}/`
  ]) {
    assert.deepEqual(normalizeExternalVodUrl(value), {
      platform: "CHZZK",
      canonicalUrl: CHZZK_URL,
      contentId: CHZZK_ID
    });
  }
  for (const value of [
    `${SOOP_URL}?change_second=30`,
    `https://vod.sooplive.co.kr/PLAYER/STATION/${SOOP_ID}`,
    `https://vod.afreecatv.com/player/${SOOP_ID}/`
  ]) {
    assert.deepEqual(normalizeExternalVodUrl(value), {
      platform: "SOOP",
      canonicalUrl: SOOP_URL,
      contentId: SOOP_ID
    });
  }
});

test("라이브·목록·스푸핑·인증 포함·플랫폼 불일치 주소를 거부한다", () => {
  for (const value of [
    "https://chzzk.naver.com/live/channel-id",
    "https://chzzk.naver.com/video/not-numeric",
    `https://chzzk.naver.com.evil.test/video/${CHZZK_ID}`,
    "https://play.sooplive.com/channel/123",
    "https://www.sooplive.com/station/channel/video",
    `https://vod.sooplive.com.evil.test/player/${SOOP_ID}`,
    `http://vod.sooplive.com/player/${SOOP_ID}`,
    `https://user:secret@vod.sooplive.com/player/${SOOP_ID}`,
    "https://www.youtube.com/playlist?list=abc",
    "not-a-url"
  ]) {
    assert.throws(
      () => normalizeExternalVodUrl(value),
      /VOD|HTTPS|SOOP|YouTube/u
    );
  }
  assert.throws(
    () => normalizeExternalVodUrl(YOUTUBE_URL, "SOOP"),
    /플랫폼/u
  );
  assert.throws(
    () => normalizeExternalVodUrl(CHZZK_URL, "YOUTUBE"),
    /플랫폼/u
  );
});

test("메타데이터 probe는 설정·플러그인·캐시·netrc를 차단하고 플랫폼별 목록 의미를 고정한다", () => {
  const youtubeArgs = buildExternalMetadataProbeArgs(YOUTUBE_URL);
  const chzzkArgs = buildExternalMetadataProbeArgs(CHZZK_URL);
  const soopArgs = buildExternalMetadataProbeArgs(SOOP_URL);
  for (const args of [youtubeArgs, chzzkArgs, soopArgs]) {
    for (const required of [
      "--ignore-config",
      "--no-config-locations",
      "--no-plugin-dirs",
      "--no-cache-dir",
      "--no-batch-file",
      "--no-cookies",
      "--no-cookies-from-browser",
      "--no-exec",
      "--no-update",
      "--no-remote-components",
      "--no-js-runtimes",
      "--js-runtimes",
      "--dump-single-json",
      "--skip-download"
    ]) {
      assert(args.includes(required), `${required}가 없습니다.`);
    }
    for (const forbidden of FORBIDDEN_EXTERNAL_YT_DLP_FLAGS) {
      assert(!args.includes(forbidden), `${forbidden}가 포함되었습니다.`);
    }
    assert.equal(args.at(-2), "--");
    assert.equal(
      optionValue(args, "--js-runtimes"),
      `node:${process.execPath}`
    );
    assert.doesNotThrow(() => assertExternalYtDlpArgsSafe(args));
  }
  assert(youtubeArgs.includes("--no-playlist"));
  assert(!youtubeArgs.includes("--yes-playlist"));
  assert(chzzkArgs.includes("--no-playlist"));
  assert(!chzzkArgs.includes("--yes-playlist"));
  assert(soopArgs.includes("--yes-playlist"));
  assert(!soopArgs.includes("--no-playlist"));
  assert.equal(optionValue(soopArgs, "--playlist-end"), "501");
  assert.throws(
    () => buildExternalMetadataProbeArgs(YOUTUBE_URL, {
      nodeBinary: "node"
    }),
    /Node 실행 파일은 검증된 절대 경로/u
  );
  assert.throws(
    () => assertExternalYtDlpArgsSafe(
      youtubeArgs.filter((argument) => argument !== "--no-remote-components")
    ),
    /원격 실행 구성요소/u
  );
  const separator = youtubeArgs.indexOf("--");
  const insertBeforeUrl = (...extra: string[]) => [
    ...youtubeArgs.slice(0, separator),
    ...extra,
    ...youtubeArgs.slice(separator)
  ];
  for (const forbidden of [
    "--cookies=/tmp/browser.txt",
    "--plugin-dirs=/tmp/plugin",
    "--config-locations=/tmp/config",
    "--remote-components=ejs:github",
    "--update-to=nightly"
  ]) {
    assert.throws(
      () => assertExternalYtDlpArgsSafe(insertBeforeUrl(forbidden)),
      /사용할 수 없습니다/u,
      `${forbidden} equals 형식을 거부해야 합니다.`
    );
  }
  assert.throws(
    () => assertExternalYtDlpArgsSafe(
      insertBeforeUrl("--no-plugin-dirs")
    ),
    /정확히 한 번/u
  );
  assert.throws(
    () => assertExternalYtDlpArgsSafe(
      insertBeforeUrl("--js-runtimes=node:/usr/bin/node")
    ),
    /단일 Node 절대 경로/u
  );
  const runtimeValueIndex = youtubeArgs.indexOf("--js-runtimes") + 1;
  const multiRuntimeArgs = [...youtubeArgs];
  multiRuntimeArgs[runtimeValueIndex] = "node:/usr/bin/node,deno:/usr/bin/deno";
  assert.throws(
    () => assertExternalYtDlpArgsSafe(multiRuntimeArgs),
    /단일 Node 절대 경로/u
  );
});

test("CHZZK external metadata는 정확한 extractor와 원본 ID에만 결합한다", () => {
  const metadata = parseExternalVodMetadata(CHZZK_URL, JSON.stringify({
    id: CHZZK_ID,
    extractor: "chzzk:video",
    duration: 14_671,
    live_status: "was_live",
    is_live: false,
    age_limit: 0,
    webpage_url: CHZZK_URL,
    timestamp: 1_785_762_919
  }));
  assert.equal(metadata.platform, "CHZZK");
  assert.equal(metadata.canonicalUrl, CHZZK_URL);
  assert.equal(metadata.contentId, CHZZK_ID);
  assert.equal(metadata.durationMs, 14_671_000);
  assert.deepEqual(metadata.parts, [{
    id: CHZZK_ID,
    sourceStartMs: 0,
    sourceEndMs: 14_671_000,
    durationMs: 14_671_000
  }]);

  for (const payload of [
    {
      id: CHZZK_ID,
      extractor: "generic",
      duration: 14_671,
      live_status: "was_live"
    },
    {
      id: "14514981",
      extractor: "chzzk:video",
      duration: 14_671,
      live_status: "was_live"
    },
    {
      id: CHZZK_ID,
      extractor: "chzzk:video",
      duration: 14_671,
      live_status: "is_live"
    }
  ]) {
    assert.throws(
      () => parseExternalVodMetadata(CHZZK_URL, JSON.stringify(payload)),
      /VOD|라이브|원본|extractor/u
    );
  }
});

test("CHZZK selected-source probe는 무쿠키 1080p60 H.264/AAC 포맷만 고른다", () => {
  const args = buildExternalSelectedSourceProbeArgs({
    source: normalizeExternalVodUrl(CHZZK_URL)
  });
  assert(args.includes("--no-playlist"));
  assert(!args.includes("--yes-playlist"));
  assert(args.includes("--no-cookies"));
  assert(args.includes("--no-cookies-from-browser"));
  assert(!args.includes("--download-sections"));
  assert(!args.includes("--downloader-args"));
  assert.match(optionValue(args, "--format"), /1920/u);
  assert.match(optionValue(args, "--format"), /1080/u);
  assert.match(optionValue(args, "--format"), /60/u);
  assert.doesNotThrow(() => assertExternalYtDlpArgsSafe(args));
});

test("사용자 환경에서 경로·로케일 외 쿠키와 자격 증명 가능 값을 프로세스에 전달하지 않는다", () => {
  assert.deepEqual(createExternalProcessEnvironment({
    PATH: "/usr/bin",
    LANG: "ko_KR.UTF-8",
    TEMP: "/attacker/temp",
    TMP: "/attacker/tmp",
    TMPDIR: "/attacker/tmpdir",
    HOME: "/sensitive/home",
    YTDLP_COOKIES: "secret",
    API_TOKEN: "secret",
    PASSWORD: "secret"
  }), {
    PATH: "/usr/bin",
    LANG: "ko_KR.UTF-8",
    NO_COLOR: "1"
  });
  assert.deepEqual(createExternalProcessEnvironment({
    PATH: "/usr/bin",
    TEMP: "/attacker/temp"
  }, "/private/job"), {
    PATH: "/usr/bin",
    NO_COLOR: "1",
    TEMP: "/private/job",
    TMP: "/private/job",
    TMPDIR: "/private/job"
  });
});

test("yt-dlp 실행 파일 누락은 외부 stderr 없이 명확한 안전 오류로 보고한다", async () => {
  await assert.rejects(
    probeExternalVodMetadata(YOUTUBE_URL, {
      cwd: "/tmp",
      processEnv: {
        PATH: "/usr/bin",
        KIRINUKI_YT_DLP_PYTHON_BINARY: PYTHON_BINARY,
        KIRINUKI_YT_DLP_BINARY: YT_DLP_ARTIFACT
      },
      runProcess: async (command, args, options) => {
        assert.equal(command, PYTHON_BINARY);
        assertIsolatedYtDlpInvocation(args);
        assert.equal(options.env.KIRINUKI_YT_DLP_PYTHON_BINARY, undefined);
        assert.equal(options.env.KIRINUKI_YT_DLP_BINARY, undefined);
        assert.equal(options.timeoutMs, EXTERNAL_METADATA_TIMEOUT_MS);
        throw Object.assign(new Error("spawn /sensitive/path ENOENT"), {
          code: "ENOENT"
        });
      }
    }),
    (error: unknown) => {
      assert(error instanceof ExternalVodMaterializationError);
      assert.equal(error.code, "TOOL_NOT_INSTALLED");
      assert.match(error.message, /yt-dlp 실행 파일을 찾을 수 없습니다/u);
      assert.doesNotMatch(error.message, /sensitive/u);
      return true;
    }
  );
  await assert.rejects(
    probeExternalVodMetadata(YOUTUBE_URL, {
      processEnv: {},
      pythonBinary: "python3",
      ytDlpBinary: YT_DLP_ARTIFACT,
      runProcess: async () => {
        assert.fail("상대 Python 경로로 프로세스를 실행하면 안 됩니다.");
      }
    }),
    /Python 실행 경로는 검증된 절대 경로/u
  );
  await assert.rejects(
    probeExternalVodMetadata(YOUTUBE_URL, {
      processEnv: {},
      pythonBinary: PYTHON_BINARY,
      ytDlpBinary: "yt-dlp",
      runProcess: async () => {
        assert.fail("상대 yt-dlp artifact 경로로 프로세스를 실행하면 안 됩니다.");
      }
    }),
    /yt-dlp artifact 실행 경로는 검증된 절대 경로/u
  );
});

test("standalone yt-dlp는 Python 없이 검증된 실행 파일을 직접 호출한다", async () => {
  const args = buildExternalMetadataProbeArgs(YOUTUBE_URL, {
    nodeBinary: process.execPath
  });
  const command = externalYtDlpCommand({
    mode: "standalone",
    ytDlpBinary: YT_DLP_ARTIFACT,
    args
  });
  assert.equal(command.executable, YT_DLP_ARTIFACT);
  assert.deepEqual(command.args, args);
  assert.notEqual(command.args, args);
  assert.notEqual(command.args[0], "-I");
  assert.equal(Object.isFrozen(command), true);
  assert.equal(Object.isFrozen(command.args), true);
  assert.deepEqual(externalYtDlpCommand({
    mode: "python-zipimport",
    ytDlpBinary: YT_DLP_ARTIFACT,
    pythonBinary: PYTHON_BINARY,
    args
  }), {
    executable: PYTHON_BINARY,
    args: ["-I", YT_DLP_ARTIFACT, ...args]
  });

  const metadata = await probeExternalVodMetadata(YOUTUBE_URL, {
    cwd: "/tmp",
    processEnv: {},
    ytDlpMode: "standalone",
    ytDlpBinary: YT_DLP_ARTIFACT,
    nodeBinary: process.execPath,
    runProcess: async (executable, actualArgs, options) => {
      assert.equal(executable, YT_DLP_ARTIFACT);
      assert.deepEqual(actualArgs, args);
      assert.equal(options.shell, false);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          id: YOUTUBE_ID,
          extractor: "youtube",
          duration: 120,
          availability: "public",
          live_status: "not_live",
          webpage_url: YOUTUBE_URL,
          timestamp: 1_700_000_000
        }),
        stderr: ""
      };
    }
  });
  assert.equal(metadata.contentId, YOUTUBE_ID);

  assert.throws(() => externalYtDlpCommand({
    mode: "standalone",
    ytDlpBinary: "yt-dlp",
    args
  }), /절대 경로/u);
  assert.throws(() => externalYtDlpCommand({
    mode: "python-zipimport",
    ytDlpBinary: YT_DLP_ARTIFACT,
    args
  }), /Python/u);
});

test("published ffprobe binding은 Linux·macOS·Windows의 exact handle 경계를 만든다", () => {
  const linuxBinding = externalPublishedArtifactInspectionBinding({
    platform: "linux",
    processId: 12_345,
    fileDescriptor: 17
  });
  assert.deepEqual(linuxBinding, {
    inputPath: "/proc/12345/fd/17"
  });
  assert.equal(Object.isFrozen(linuxBinding), true);
  assert.deepEqual(externalPublishedArtifactInspectionBinding({
    platform: "darwin",
    processId: 12_345,
    fileDescriptor: 17
  }), {
    inputPath: "/dev/fd/3",
    inheritedInputFileDescriptor: 17
  });
  assert.deepEqual(externalPublishedArtifactInspectionBinding({
    platform: "win32",
    processId: 12_345,
    fileDescriptor: 17
  }), {
    inputPath: "pipe:3",
    inheritedInputFileDescriptor: 17
  });
  for (const invalid of [
    { platform: "freebsd", processId: 1, fileDescriptor: 3 },
    { platform: "linux", processId: 0, fileDescriptor: 3 },
    { platform: "darwin", processId: 1, fileDescriptor: -1 },
    { platform: "win32", processId: 1, fileDescriptor: 1.5 }
  ]) {
    assert.throws(
      () => externalPublishedArtifactInspectionBinding(invalid),
      (error: unknown) => (
        error instanceof ExternalVodMaterializationError
        && error.code === "MEDIA_VERIFICATION_FAILED"
      )
    );
  }
  assert.equal(
    buildExternalFfprobeArgs("/dev/fd/3", {
      inheritedInputFileDescriptor: 17
    }).at(-1),
    "/dev/fd/3"
  );
  assert.equal(
    buildExternalFfprobeArgs("pipe:3", {
      inheritedInputFileDescriptor: 17
    }).at(-1),
    "pipe:3"
  );
  assert.throws(
    () => buildExternalFfprobeArgs("relative.mp4", {
      inheritedInputFileDescriptor: 17
    }),
    (error: unknown) => (
      error instanceof ExternalVodMaterializationError
      && error.code === "MEDIA_VERIFICATION_FAILED"
    )
  );
});

test("YouTube 공개 완료 VOD 메타데이터만 유한한 단일 파트로 정규화한다", () => {
  const metadata = parseExternalVodMetadata(YOUTUBE_URL, JSON.stringify({
    id: YOUTUBE_ID,
    extractor: "youtube",
    duration: 125.25,
    availability: "public",
    live_status: "not_live",
    timestamp: 1_700_000_000
  }));
  assert.equal(metadata.platform, "YOUTUBE");
  assert.equal(metadata.durationMs, 125_250);
  assert.deepEqual(metadata.parts, [{
    id: YOUTUBE_ID,
    sourceStartMs: 0,
    sourceEndMs: 125_250,
    durationMs: 125_250
  }]);
  assert.match(metadata.sourceVersionId, /^[a-f0-9]{64}$/u);
  assert.throws(
    () => parseExternalVodMetadata(YOUTUBE_URL, JSON.stringify({
      extractor: "youtube",
      duration: 100,
      availability: "public",
      live_status: "not_live"
    })),
    /원본 ID/u
  );

  for (const payload of [
    { id: YOUTUBE_ID, extractor: "youtube", duration: 100, is_live: true },
    { id: YOUTUBE_ID, extractor: "youtube", duration: 100, live_status: "is_upcoming" },
    { id: YOUTUBE_ID, extractor: "youtube", duration: 100, availability: "private" },
    { id: YOUTUBE_ID, extractor: "youtube", duration: 100, availability: "subscriber_only" },
    { id: YOUTUBE_ID, extractor: "youtube", duration: 100, age_limit: 19 }
  ]) {
    assert.throws(
      () => parseExternalVodMetadata(YOUTUBE_URL, JSON.stringify(payload)),
      /라이브|완료된 VOD|로그인|구독|비공개|성인/u
    );
  }
});

function soopMetadata(): ExternalVodMetadata {
  return parseExternalVodMetadata(SOOP_URL, JSON.stringify({
    id: SOOP_ID,
    extractor: "soop",
    webpage_url: SOOP_URL,
    original_url: `${SOOP_URL}?change_second=30`,
    availability: "public",
    live_status: "was_live",
    duration: 120,
    timestamp: 1_700_000_000,
    entries: [
      { id: "part_1", duration: 60, availability: "public" },
      { id: "part_2", duration: 60, availability: "public" }
    ]
  }));
}

test("SOOP 실제 extractor의 내부 파일 ID와 숫자 player ID를 혼동하지 않는다", () => {
  const metadata = parseExternalVodMetadata(SOOP_URL, JSON.stringify({
    _type: "video",
    id: "BE689A0E_190960999_1_2_A",
    display_id: "BE689A0E_190960999_1_2_A",
    extractor: "soop",
    extractor_key: "AfreecaTV",
    duration: 213,
    webpage_url: `https://vod.sooplive.com/PLAYER/STATION/${SOOP_ID}`,
    original_url: `https://vod.sooplive.com/PLAYER/STATION/${SOOP_ID}`
  }));
  assert.equal(metadata.contentId, SOOP_ID);
  assert.equal(metadata.durationMs, 213_000);
  assert.deepEqual(metadata.parts, [{
    id: "BE689A0E_190960999_1_2_A",
    playlistItem: 1,
    sourceStartMs: 0,
    sourceEndMs: 213_000,
    durationMs: 213_000
  }]);

  for (const payload of [
    {
      id: "BE689A0E_190960999_1_2_A",
      extractor: "soop",
      duration: 213
    },
    {
      id: "BE689A0E_190960999_1_2_A",
      extractor: "soop",
      duration: 213,
      webpage_url: "https://vod.sooplive.com/player/999999999"
    },
    {
      id: "BE689A0E_190960999_1_2_A",
      extractor: "soop",
      duration: 213,
      webpage_url: SOOP_URL,
      original_url: "https://vod.sooplive.com/player/999999999"
    }
  ]) {
    assert.throws(
      () => parseExternalVodMetadata(SOOP_URL, JSON.stringify(payload)),
      /재생 페이지/u
    );
  }
});

test("SOOP probe가 501번째 파트를 관측해 500개 상한 초과를 숨기지 않는다", () => {
  const entries = Array.from({ length: 501 }, (_, index) => ({
    id: `part-${index + 1}`,
    duration: 1,
    availability: "public"
  }));
  assert.throws(
    () => parseExternalVodMetadata(SOOP_URL, JSON.stringify({
      id: SOOP_ID,
      extractor: "soop",
      webpage_url: SOOP_URL,
      original_url: SOOP_URL,
      availability: "public",
      live_status: "was_live",
      entries
    })),
    /파트 수가 안전한 처리 상한/u
  );
});

test("SOOP multi-video는 root 길이·완전한 고유 part vector로만 전역 시간축을 증명한다", () => {
  const payload = {
    id: SOOP_ID,
    extractor: "soop",
    webpage_url: SOOP_URL,
    original_url: SOOP_URL,
    availability: "public",
    live_status: "was_live",
    entries: [
      { id: "part-1", duration: 60, availability: "public" },
      { id: "part-2", duration: 60, availability: "public" }
    ]
  };
  assert.throws(
    () => parseExternalVodMetadata(SOOP_URL, JSON.stringify(payload)),
    /재생 시간/u
  );
  assert.throws(
    () => parseExternalVodMetadata(SOOP_URL, JSON.stringify({
      ...payload,
      duration: 121,
      entries: [
        { id: "same-part", duration: 60, availability: "public" },
        { id: "same-part", duration: 60, availability: "public" }
      ]
    })),
    /중복/u
  );
  assert.throws(
    () => parseExternalVodMetadata(SOOP_URL, JSON.stringify({
      ...payload,
      duration: 180
    })),
    /완전한 원본 시간축/u
  );
  assert.doesNotThrow(
    () => parseExternalVodMetadata(SOOP_URL, JSON.stringify({
      ...payload,
      // Each extractor entry is integer seconds. At most one truncated
      // fractional second per part may be represented only by the root.
      duration: 121.999
    }))
  );
});

test("SOOP multi-video를 연속 원본 시간축 파트로 만들고 ±10초 합집합을 파트 경계에서 나눈다", () => {
  const metadata = soopMetadata();
  assert.deepEqual(metadata.parts, [
    {
      id: "part_1",
      playlistItem: 1,
      sourceStartMs: 0,
      sourceEndMs: 60_000,
      durationMs: 60_000
    },
    {
      id: "part_2",
      playlistItem: 2,
      sourceStartMs: 60_000,
      sourceEndMs: 120_000,
      durationMs: 60_000
    }
  ]);

  const plan = planExternalVodSections(metadata, [
    { id: "a", startMs: 55_000, endMs: 56_000 },
    { id: "b", startMs: 63_000, endMs: 64_000 },
    { id: "c", startMs: 100_000, endMs: 105_000 }
  ]);
  assert.deepEqual(plan.windows, [
    {
      editableSourceStartMs: 45_000,
      editableSourceEndMs: 74_000,
      clipIds: ["a", "b"]
    },
    {
      editableSourceStartMs: 90_000,
      editableSourceEndMs: 115_000,
      clipIds: ["c"]
    }
  ]);
  assert.deepEqual(plan.sections.map((section) => ({
    playlistItem: section.playlistItem,
    source: [section.sourceStartMs, section.sourceEndMs],
    local: [section.partStartMs, section.partEndMs]
  })), [
    { playlistItem: 1, source: [45_000, 60_000], local: [45_000, 60_000] },
    { playlistItem: 2, source: [60_000, 74_000], local: [0, 14_000] },
    { playlistItem: 2, source: [90_000, 115_000], local: [30_000, 55_000] }
  ]);
});

test("clip anchor는 불변으로 두고 per-clip hot-load 범위만 정확히 확장한다", () => {
  const metadata = soopMetadata();
  const clips = [
    { id: "a", startMs: 55_000, endMs: 56_000 },
    { id: "b", startMs: 90_000, endMs: 91_000 }
  ] as const;
  const plan = planExternalVodSections(metadata, clips, 10_000, [
    { id: "a", startMs: 30_000, endMs: 80_000 },
    { id: "b", startMs: 80_000, endMs: 110_000 }
  ]);
  assert.deepEqual(plan.clipRanges, [
    {
      clipId: "a",
      sourceStartMs: 55_000,
      sourceEndMs: 56_000,
      editableSourceStartMs: 30_000,
      editableSourceEndMs: 80_000
    },
    {
      clipId: "b",
      sourceStartMs: 90_000,
      sourceEndMs: 91_000,
      editableSourceStartMs: 80_000,
      editableSourceEndMs: 110_000
    }
  ]);
  assert.deepEqual(plan.windows, [{
    editableSourceStartMs: 30_000,
    editableSourceEndMs: 110_000,
    clipIds: ["a", "b"]
  }]);
  assert.deepEqual(plan.sections.map((section) => ({
    playlistItem: section.playlistItem,
    source: [section.sourceStartMs, section.sourceEndMs],
    local: [section.partStartMs, section.partEndMs]
  })), [
    { playlistItem: 1, source: [30_000, 60_000], local: [30_000, 60_000] },
    { playlistItem: 2, source: [60_000, 110_000], local: [0, 50_000] }
  ]);
  assert.throws(
    () => planExternalVodSections(metadata, clips, 10_000, [
      { id: "a", startMs: 30_000, endMs: 80_000 }
    ]),
    /모든 VOD 컷/u
  );
  assert.throws(
    () => planExternalVodSections(metadata, clips, 10_000, [
      { id: "a", startMs: 46_000, endMs: 80_000 },
      { id: "b", startMs: 80_000, endMs: 110_000 }
    ]),
    /기존 ±10초/u
  );
});

test("병합된 선택 구간은 6시간·64 GiB 상한과 사전 디스크 headroom을 강제한다", async () => {
  const sourceDurationMs = MAX_EXTERNAL_VOD_MATERIALIZED_MS + 60_000;
  const metadata: ExternalVodMetadata = {
    ...normalizeExternalVodUrl(YOUTUBE_URL),
    durationMs: sourceDurationMs,
    sourceVersionId: "a".repeat(64),
    parts: [{
      id: YOUTUBE_ID,
      sourceStartMs: 0,
      sourceEndMs: sourceDurationMs,
      durationMs: sourceDurationMs
    }]
  };
  assert.throws(
    () => planExternalVodSections(metadata, [{
      id: "too-long",
      startMs: 0,
      endMs: MAX_EXTERNAL_VOD_MATERIALIZED_MS + 1
    }]),
    /최대 6시간/u
  );
  assert.equal(
    assertExternalMaterializationByteQuota(
      MAX_EXTERNAL_VOD_WORK_BYTES - 1,
      1
    ),
    MAX_EXTERNAL_VOD_WORK_BYTES
  );
  assert.throws(
    () => assertExternalMaterializationByteQuota(
      MAX_EXTERNAL_VOD_WORK_BYTES,
      1
    ),
    /64 GiB/u
  );
  await assert.rejects(
    assertExternalDiskHeadroom("/tmp", 1_000, async () => ({
      bavail: 1,
      bsize: 4_096
    })),
    /디스크 여유 공간이 부족/u
  );
  await assert.doesNotReject(
    assertExternalDiskHeadroom("/tmp", 1_000, async () => ({
      bavail: BigInt(MAX_EXTERNAL_VOD_WORK_BYTES),
      bsize: 1n
    }))
  );
  for (const fileSystem of [
    { bavail: -1, bsize: 4_096 },
    { bavail: 1, bsize: 0 },
    { bavail: 1, bsize: -1 }
  ]) {
    await assert.rejects(
      assertExternalDiskHeadroom("/tmp", 1_000, async () => fileSystem),
      (error: unknown) => {
        assert(error instanceof ExternalVodMaterializationError);
        assert.equal(error.code, "DISK_SPACE_CHECK_FAILED");
        return true;
      }
    );
  }
});

test("selected-source probe는 SOOP 파트와 YouTube 분리 video+audio를 엄격히 고정한다", () => {
  const args = buildExternalSelectedSourceProbeArgs({
    source: normalizeExternalVodUrl(SOOP_URL),
    playlistItem: 2
  });
  assert.equal(optionValue(args, "--playlist-items"), "2");
  assert(args.includes("--skip-download"));
  assert(args.includes("--dump-single-json"));
  assert(!args.includes("--download-sections"));
  assert(!args.includes("--downloader-args"));
  assert.match(optionValue(args, "--format"), /width<=\?1920/u);
  assert.match(optionValue(args, "--format"), /height<=\?1080/u);
  assert.match(optionValue(args, "--format"), /fps<=\?60/u);
  assert.equal(args.at(-1), SOOP_URL);

  const youtubeArgs = buildExternalSelectedSourceProbeArgs({
    source: normalizeExternalVodUrl(YOUTUBE_URL)
  });
  assert(youtubeArgs.includes("--no-playlist"));
  assert(!youtubeArgs.includes("--playlist-items"));
  assert(!youtubeArgs.includes("--downloader-args"));
  const youtubeSelector = optionValue(youtubeArgs, "--format");
  assert.equal(
    youtubeSelector,
    "bv[ext=mp4][vcodec^=avc1][width<=1920][height<=1080][fps<=60]"
      + "+ba[ext=m4a][acodec^=mp4a]"
  );
  assert.doesNotMatch(youtubeSelector, /\//u);
});

test("YouTube direct clock probe는 ffprobe 옵션 경계와 공개 헤더를 정확히 만든다", () => {
  const semanticIdentity = "youtube:format:136:video";
  const args = buildExternalDirectClockProbeArgs({
    url: "https://rr1.googlevideo.com/videoplayback?sig=runtime-only",
    semanticIdentity,
    semanticIdentitySha256: sha256Buffer(semanticIdentity),
    publicHeaders: {
      "user-agent": "Kirinuki fixture",
      accept: "*/*"
    }
  });
  assert(!args.includes("-nostdin"), "ffprobe는 -nostdin을 값 옵션으로 오해합니다.");
  assert.equal(optionValue(args, "-protocol_whitelist"), "https,tls,tcp");
  assert.equal(
    optionValue(args, "-headers"),
    "accept: */*\r\nuser-agent: Kirinuki fixture\r\n"
  );
  assert.equal(args.at(-1), (
    "https://rr1.googlevideo.com/videoplayback?sig=runtime-only"
  ));
});

test("정규화 root의 최종 concat은 packet-copy faststart MP4를 만든다", () => {
  const args = buildExternalConcatArgs({
    concatListPath: "/tmp/job/sections.concat.txt",
    outputPath: "/tmp/job/materialized.tmp.mp4",
    durationMs: 21_000,
    packetCopy: true
  });
  assert.equal(optionValue(args, "-c"), "copy");
  assert(!args.includes("libx264"));
  assert(!args.includes("-preset"));
  assert(!args.includes("-crf"));
  assert.equal(optionValue(args, "-map"), "0:v:0");
  const firstMapIndex = args.indexOf("-map");
  assert.equal(args[firstMapIndex + 3], "0:a:0?");
  assert.equal(optionValue(args, "-map_metadata"), "-1");
  assert.equal(optionValue(args, "-map_chapters"), "-1");
  assert.equal(optionValue(args, "-t"), "21.000");
  assert.equal(optionValue(args, "-movflags"), "+faststart");
  const outputFormatIndex = args.lastIndexOf("-f");
  assert.notEqual(outputFormatIndex, -1);
  assert.equal(args[outputFormatIndex + 1], "mp4");
  assert.equal(args.at(-1), "/tmp/job/materialized.tmp.mp4");
});

test("strict packet-copy 검증이 없으면 최종 concat은 안전하게 재인코딩한다", () => {
  const args = buildExternalConcatArgs({
    concatListPath: "/tmp/job/sections.concat.txt",
    outputPath: "/tmp/job/materialized.tmp.mp4",
    durationMs: 21_000
  });
  assert.equal(optionValue(args, "-c:v"), "libx264");
  assert.equal(optionValue(args, "-c:a"), "aac");
  assert(!args.includes("copy"));
});

test("packet-copy signature는 전부 존재하고 정확히 같을 때만 허용한다", () => {
  assert.equal(
    compatibleExternalPacketCopySignatures(["strict-a", "strict-a"]),
    true
  );
  assert.equal(
    compatibleExternalPacketCopySignatures(["strict-a", "strict-b"]),
    false
  );
  assert.equal(
    compatibleExternalPacketCopySignatures(["strict-a", undefined]),
    false
  );
  assert.equal(compatibleExternalPacketCopySignatures([]), false);
});

test("ffprobe 결과는 H.264와 선택적 AAC만 로컬 편집 MP4로 받는다", () => {
  assert.deepEqual(parseExternalMediaInspection(JSON.stringify({
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        width: 1920,
        height: 1080,
        avg_frame_rate: "60000/1001"
      },
      {
        codec_type: "audio",
        codec_name: "aac",
        sample_rate: "48000",
        channels: 2,
        channel_layout: "stereo"
      }
    ],
    format: {
      duration: "21.000",
      format_name: "mov,mp4,m4a,3gp,3g2,mj2"
    }
  })), {
    durationMs: 21_000,
    videoCodec: "h264",
    audioCodec: "aac",
    width: 1920,
    height: 1080,
    frameRate: 60_000 / 1_001,
    audioSampleRate: 48_000,
    audioChannels: 2,
    audioChannelLayout: "stereo"
  });
  assert.throws(() => parseExternalMediaInspection(JSON.stringify({
    streams: [{ codec_type: "video", codec_name: "vp9" }],
    format: { duration: 21, format_name: "mp4" }
  })), /H\.264/u);
  for (const video of [
    {
      codec_type: "video",
      codec_name: "h264",
      width: 3_840,
      height: 2_160,
      avg_frame_rate: "60/1"
    },
    {
      codec_type: "video",
      codec_name: "h264",
      width: 1_920,
      height: 1_080,
      avg_frame_rate: "120/1"
    }
  ]) {
    assert.throws(() => parseExternalMediaInspection(JSON.stringify({
      streams: [video],
      format: { duration: 21, format_name: "mp4" }
    })), /1920x1080, 60fps/u);
  }
  assert.throws(() => parseExternalMediaInspection(JSON.stringify({
    streams: [{
      codec_type: "video",
      codec_name: "h264",
      width: 1920,
      height: 1080,
      avg_frame_rate: "60/1"
    }],
    format: { duration: 21, format_name: "matroska,webm" }
  })), /MP4 컨테이너/u);
  assert.throws(() => parseExternalMediaInspection(JSON.stringify({
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        width: 1920,
        height: 1080,
        avg_frame_rate: "60/1"
      },
      {
        codec_type: "video",
        codec_name: "h264",
        width: 640,
        height: 360,
        avg_frame_rate: "30/1"
      }
    ],
    format: { duration: 21, format_name: "mp4" }
  })), /비디오 스트림이 정확히 하나/u);
  assert.throws(() => parseExternalMediaInspection(JSON.stringify({
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        width: 1920,
        height: 1080,
        avg_frame_rate: "60/1"
      },
      { codec_type: "audio", codec_name: "aac" },
      { codec_type: "audio", codec_name: "aac" }
    ],
    format: { duration: 21, format_name: "mp4" }
  })), /오디오 스트림이 최대 하나/u);
  const validVideo = {
    codec_type: "video",
    codec_name: "h264",
    width: 1920,
    height: 1080,
    avg_frame_rate: "60/1"
  };
  for (const unsupportedStream of [
    { codec_type: "subtitle", codec_name: "mov_text" },
    { codec_type: "data", codec_name: "bin_data" },
    { codec_type: "attachment", codec_name: "ttf" },
    { codec_type: "unknown", codec_name: "unknown" },
    { codec_name: "aac" },
    null,
    "malformed-stream"
  ]) {
    assert.throws(() => parseExternalMediaInspection(JSON.stringify({
      streams: [validVideo, unsupportedStream],
      format: { duration: 21, format_name: "mp4" }
    })), /인식된 비디오·오디오 스트림만/u);
  }
});

test("ffprobe codec 초기화 정보는 엄격한 ephemeral packet-copy signature가 된다", () => {
  const payload = {
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        codec_tag_string: "avc1",
        profile: "High",
        level: 42,
        width: 1920,
        height: 1080,
        coded_width: 1920,
        coded_height: 1080,
        sample_aspect_ratio: "1:1",
        pix_fmt: "yuv420p",
        field_order: "progressive",
        color_range: "tv",
        color_space: "bt709",
        color_transfer: "bt709",
        color_primaries: "bt709",
        chroma_location: "left",
        is_avc: "true",
        nal_length_size: "4",
        r_frame_rate: "60/1",
        avg_frame_rate: "60/1",
        time_base: "1/15360",
        extradata_hash: `SHA256:${"a".repeat(64)}`
      },
      {
        codec_type: "audio",
        codec_name: "aac",
        codec_tag_string: "mp4a",
        profile: "LC",
        sample_fmt: "fltp",
        sample_rate: "48000",
        channels: 2,
        channel_layout: "stereo",
        time_base: "1/48000",
        extradata_hash: `SHA256:${"b".repeat(64)}`
      }
    ],
    format: { duration: "21.000", format_name: "mov,mp4" }
  };
  const strict = parseExternalMediaInspection(JSON.stringify(payload));
  assert.equal(typeof strict.packetCopySignature, "string");

  const changedColor = structuredClone(payload);
  changedColor.streams[0]!.color_range = "pc";
  const changed = parseExternalMediaInspection(JSON.stringify(changedColor));
  assert.notEqual(changed.packetCopySignature, strict.packetCopySignature);

  const missingHash = structuredClone(payload);
  delete (missingHash.streams[0] as { extradata_hash?: string }).extradata_hash;
  const incomplete = parseExternalMediaInspection(JSON.stringify(missingHash));
  assert.equal(incomplete.packetCopySignature, undefined);
});

test("ffprobe는 packet-copy 결정을 위해 codec extradata SHA-256을 요청한다", () => {
  const args = buildExternalFfprobeArgs("/tmp/job/root.mp4");
  assert(args.includes("-show_data"));
  assert.equal(optionValue(args, "-show_data_hash"), "sha256");
  assert.equal(args.at(-1), "/tmp/job/root.mp4");
});

test("CHZZK 0초·비영점 조각은 컨테이너 합집합과 각 A/V 스트림 범위를 따로 검증한다", async (t) => {
  const stateDir = await mkdtemp(path.join(
    os.tmpdir(),
    "kirinuki-chzzk-zero-timeline-"
  ));
  t.after(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });
  const inspectionJson = (audioDuration: string) => JSON.stringify({
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        width: 1920,
        height: 1080,
        avg_frame_rate: "60/1",
        start_time: "1.000000",
        duration: "15.000000"
      },
      {
        codec_type: "audio",
        codec_name: "aac",
        sample_rate: "48000",
        channels: 2,
        channel_layout: "stereo",
        start_time: "0.000000",
        duration: audioDuration
      }
    ],
    format: {
      start_time: "0.000000",
      duration: "16.000000",
      format_name: "mov,mp4,m4a,3gp,3g2,mj2"
    }
  });
  const exactStreamInspection = parseExternalMediaInspection(
    inspectionJson("15.000000")
  );
  assert.equal(exactStreamInspection.durationMs, 16_000);
  assert.deepEqual(exactStreamInspection.streamTimelines, {
    video: { startMs: 1_000, endMs: 16_000, durationMs: 15_000 },
    audio: { startMs: 0, endMs: 15_000, durationMs: 15_000 }
  });
  const nonzeroStreamInspection = parseExternalMediaInspection(JSON.stringify({
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        width: 1920,
        height: 1080,
        avg_frame_rate: "60/1",
        start_time: "0.366016",
        duration: "21.000000"
      },
      {
        codec_type: "audio",
        codec_name: "aac",
        sample_rate: "48000",
        channels: 2,
        channel_layout: "stereo",
        start_time: "0.324000",
        duration: "20.676000"
      }
    ],
    format: {
      start_time: "0.324000",
      duration: "21.042016",
      format_name: "mov,mp4,m4a,3gp,3g2,mj2"
    }
  }));
  assert.deepEqual(nonzeroStreamInspection.streamTimelines, {
    video: { startMs: 366, endMs: 21_366, durationMs: 21_000 },
    audio: { startMs: 324, endMs: 21_000, durationMs: 20_676 }
  });

  let sectionInspection = editorSafeInspection(15_000);
  const runProcess: ExternalProcessRunner = async (command, args) => {
    if (command === PYTHON_BINARY && args.includes("--dump-single-json")) {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          id: CHZZK_ID,
          extractor: "chzzk:video",
          duration: 120,
          availability: "public",
          live_status: "was_live",
          timestamp: 1_700_000_000
        }),
        stderr: ""
      };
    }
    assert.equal(command, "ffmpeg");
    const outputPath = args.at(-1);
    assert.ok(outputPath);
    await writeFile(
      outputPath,
      outputPath.includes(".hls-acquire-")
        ? "chzzk-strict-section"
        : "chzzk-zero-final"
    );
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const dependencies: ExternalVodMaterializerDependencies = {
    runProcess,
    pythonBinary: PYTHON_BINARY,
    ytDlpBinary: YT_DLP_ARTIFACT,
    inspectMedia: async (filePath) => {
      const content = await readFile(filePath, "utf8");
      return content === "chzzk-strict-section"
        ? sectionInspection
        : editorSafeInspection(15_000);
    },
    statFileSystem: async () => ({
      bavail: BigInt(MAX_EXTERNAL_VOD_WORK_BYTES),
      bsize: 1n
    })
  };
  const request = {
    consumerId: `${TEST_CONSUMER_ID}-chzzk-zero`,
    sourceUrl: CHZZK_URL,
    clips: [{ id: "zero", startMs: 0, endMs: 5_000 }],
    stateDir
  } as const;
  const completed = await materializeExternalVod(request, dependencies);
  assert.equal(completed.manifest.mediaDurationMs, 15_000);
  assert.equal(completed.receipt.sourceRoots?.[0]?.durationMs, 15_000);
  assert.equal(completed.receipt.artifact.durationMs, 15_000);

  sectionInspection = nonzeroStreamInspection;
  await assert.rejects(
    materializeExternalVod({
      ...request,
      consumerId: `${TEST_CONSUMER_ID}-chzzk-nonzero`,
      clips: [{ id: "nonzero", startMs: 79_500, endMs: 80_500 }]
    }, dependencies),
    (error: unknown) => {
      assert(error instanceof ExternalVodMaterializationError);
      assert.equal(error.code, "MEDIA_VERIFICATION_FAILED");
      return true;
    }
  );

  sectionInspection = parseExternalMediaInspection(inspectionJson("12.000000"));
  await assert.rejects(
    materializeExternalVod({
      ...request,
      consumerId: `${TEST_CONSUMER_ID}-chzzk-zero-short-audio`
    }, dependencies),
    (error: unknown) => {
      assert(error instanceof ExternalVodMaterializationError);
      assert.equal(error.code, "MEDIA_VERIFICATION_FAILED");
      return true;
    }
  );
});

test("기본 프로세스 경계는 argv 배열과 shell:false를 사용한다", async () => {
  let captured: {
    command: string;
    args: readonly string[];
    options: SpawnOptions;
  } | undefined;
  const spawnImpl = ((
    command: string,
    args: readonly string[],
    options: SpawnOptions
  ) => {
    captured = { command, args, options };
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => boolean;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    queueMicrotask(() => {
      child.stdout.write("ok\n");
      child.emit("exit", 0, null);
      child.stdout.end("drained\n");
      child.stderr.end();
      child.emit("close", 0, null);
    });
    return child as unknown as ChildProcess;
  }) as unknown as typeof spawn;
  const result = await runExternalProcess("yt-dlp", ["--version"], {
    cwd: "/tmp",
    env: {
      PATH: "/usr/bin",
      temp: "/attacker/lowercase-temp",
      TMPDIR: "/attacker/tmpdir"
    },
    shell: false
  }, { spawnImpl });
  assert.equal(result.stdout, "ok\ndrained\n");
  assert.equal(captured?.command, "yt-dlp");
  assert.deepEqual(captured?.args, ["--version"]);
  assert.equal(captured?.options.shell, false);
  assert.equal(captured?.options.detached, true);
  assert.equal(captured?.options.env?.TEMP, "/tmp");
  assert.equal(captured?.options.env?.TMP, "/tmp");
  assert.equal(captured?.options.env?.TMPDIR, "/tmp");
  assert.equal(captured?.options.env?.temp, undefined);
});

test("ffprobe용 열린 파일은 모든 OS에서 child fd 3에 매핑하고 Windows만 process group을 만들지 않는다", async () => {
  for (const platform of ["linux", "darwin", "win32"] as const) {
    let captured: SpawnOptions | undefined;
    const spawnImpl = ((_command: string, _args: readonly string[], options: SpawnOptions) => {
      captured = options;
      const child = new EventEmitter() as EventEmitter & {
        stdout: PassThrough;
        stderr: PassThrough;
        kill: () => boolean;
      };
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => true;
      queueMicrotask(() => {
        child.stdout.end("{}\n");
        child.stderr.end();
        child.emit("close", 0, null);
      });
      return child as unknown as ChildProcess;
    }) as unknown as typeof spawn;
    await runExternalProcess("ffprobe", ["-i", "bound-input"], {
      cwd: "/tmp",
      env: {},
      shell: false,
      inheritedInputFileDescriptor: 17
    }, {
      platform,
      spawnImpl
    });
    assert.deepEqual(captured?.stdio, ["ignore", "pipe", "pipe", 17], platform);
    assert.equal(captured?.detached, platform === "win32" ? undefined : true, platform);
    assert.equal(captured?.shell, false, platform);
  }
  await assert.rejects(
    runExternalProcess("ffprobe", [], {
      cwd: "/tmp",
      env: {},
      shell: false,
      inheritedInputFileDescriptor: -1
    }),
    (error: unknown) => (
      error instanceof ExternalVodMaterializationError
      && error.code === "INVALID_PROCESS_BINARY"
    )
  );
});

test("Windows 취소는 leader kill이 아니라 exact process tree terminator 완료를 기다린다", async () => {
  const controller = new AbortController();
  let terminatedPid = 0;
  let leaderKillCount = 0;
  let child: (EventEmitter & {
    pid: number;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: () => boolean;
  }) | undefined;
  const spawnImpl = (() => {
    child = new EventEmitter() as typeof child & NonNullable<typeof child>;
    child.pid = 4_321;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      leaderKillCount += 1;
      return true;
    };
    return child as unknown as ChildProcess;
  }) as unknown as typeof spawn;
  const pending = runExternalProcess("yt-dlp.exe", ["--version"], {
    cwd: "/tmp",
    env: {},
    shell: false,
    signal: controller.signal
  }, {
    platform: "win32",
    spawnImpl,
    terminateWindowsProcessTreeImpl: async (pid) => {
      terminatedPid = pid;
      queueMicrotask(() => {
        child?.stdout.end();
        child?.stderr.end();
        child?.emit("close", 1, null);
      });
    }
  });
  controller.abort();
  await assert.rejects(pending, (error: unknown) => (
    error instanceof Error && "code" in error && error.code === "ABORT_ERR"
  ));
  assert.equal(terminatedPid, 4_321);
  assert.equal(leaderKillCount, 0);
});

test("Windows taskkill helper timeout은 killer를 종료하고 close까지 기다린다", async () => {
  let timeoutCallback: (() => void) | undefined;
  let timeoutDelay = 0;
  let timerCleared = false;
  let alive = true;
  let settled = false;
  const killerSignals: Array<NodeJS.Signals | number | undefined> = [];
  const killer = new EventEmitter() as EventEmitter & {
    kill: (signal?: NodeJS.Signals | number) => boolean;
  };
  killer.kill = (signal) => {
    killerSignals.push(signal);
    return true;
  };
  const spawnImpl = ((_command: string, _args: readonly string[], _options: SpawnOptions) => (
    killer as unknown as ChildProcess
  )) as unknown as typeof spawn;
  const timerHandle = {} as ReturnType<typeof setTimeout>;
  const pending = terminateWindowsExternalProcessTree(4_321, {
    environment: { SystemRoot: "C:\\Windows" },
    spawnImpl,
    timeoutMs: 17,
    probeProcessImpl: () => {
      if (!alive) {
        throw Object.assign(new Error("missing"), { code: "ESRCH" });
      }
    },
    setTimeoutImpl: ((callback: () => void, delay = 0) => {
      timeoutCallback = callback;
      timeoutDelay = delay;
      return timerHandle;
    }) as unknown as typeof setTimeout,
    clearTimeoutImpl: ((handle: ReturnType<typeof setTimeout>) => {
      assert.equal(handle, timerHandle);
      timerCleared = true;
    }) as typeof clearTimeout
  });
  void pending.finally(() => { settled = true; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(timeoutDelay, 2);
  timeoutCallback?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(killerSignals, ["SIGKILL"]);
  assert.equal(settled, false);
  alive = false;
  killer.emit("close", null, "SIGKILL");
  await pending;
  assert.equal(timerCleared, true);
});

test("Windows taskkill reject는 exact leader fallback 뒤 원래 취소 오류를 보존한다", async () => {
  const controller = new AbortController();
  const leaderSignals: Array<NodeJS.Signals | number | undefined> = [];
  let childRef: (EventEmitter & {
    pid: number;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: (signal?: NodeJS.Signals | number) => boolean;
  }) | undefined;
  const spawnImpl = (() => {
    const child = new EventEmitter() as NonNullable<typeof childRef>;
    child.pid = 8_765;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = (signal) => {
      leaderSignals.push(signal);
      queueMicrotask(() => {
        child.stdout.end();
        child.stderr.end();
        child.emit("close", null, "SIGKILL");
      });
      return true;
    };
    childRef = child;
    return child as unknown as ChildProcess;
  }) as unknown as typeof spawn;
  const pending = runExternalProcess("yt-dlp.exe", [], {
    cwd: "C:\\Kirinuki",
    env: {},
    shell: false,
    signal: controller.signal
  }, {
    platform: "win32",
    spawnImpl,
    terminateWindowsProcessTreeImpl: async () => {
      throw new Error("taskkill rejected");
    }
  });
  controller.abort();
  await assert.rejects(pending, (error: unknown) => (
    error instanceof Error
    && "code" in error
    && error.code === "ABORT_ERR"
  ));
  assert.deepEqual(leaderSignals, ["SIGKILL"]);
});

test("Windows taskkill never-settle은 bounded fallback 뒤 close 한 번으로 원래 timeout 오류를 보존한다", async () => {
  const scheduled: Array<{
    callback: () => void;
    delay: number;
    cleared: boolean;
  }> = [];
  const handles = new Map<object, (typeof scheduled)[number]>();
  const setTimeoutImpl = ((callback: () => void, delay = 0) => {
    const task = { callback, delay, cleared: false };
    const handle = {};
    scheduled.push(task);
    handles.set(handle, task);
    return handle;
  }) as unknown as typeof setTimeout;
  const clearTimeoutImpl = ((handle: object) => {
    const task = handles.get(handle);
    if (task) {
      task.cleared = true;
    }
  }) as unknown as typeof clearTimeout;
  const leaderSignals: Array<NodeJS.Signals | number | undefined> = [];
  let childRef: (EventEmitter & {
    pid: number;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: (signal?: NodeJS.Signals | number) => boolean;
  }) | undefined;
  const spawnImpl = (() => {
    const child = new EventEmitter() as NonNullable<typeof childRef>;
    child.pid = 9_876;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = (signal) => {
      leaderSignals.push(signal);
      queueMicrotask(() => {
        child.stdout.end();
        child.stderr.end();
        child.emit("close", null, "SIGKILL");
        child.emit("close", null, "SIGKILL");
      });
      return true;
    };
    childRef = child;
    return child as unknown as ChildProcess;
  }) as unknown as typeof spawn;
  const pending = runExternalProcess("ffmpeg.exe", [], {
    cwd: "C:\\Kirinuki",
    env: {},
    shell: false,
    timeoutMs: 123
  }, {
    platform: "win32",
    spawnImpl,
    setTimeoutImpl,
    clearTimeoutImpl,
    killGraceMs: 17,
    terminateWindowsProcessTreeImpl: async () => await new Promise<void>(() => undefined)
  });
  assert.equal(scheduled[0]?.delay, 123);
  scheduled[0]?.callback();
  assert.equal(
    scheduled[1]?.delay,
    windowsTaskkillOuterGuardTimeoutMs(17)
  );
  scheduled[1]?.callback();
  await assert.rejects(pending, (error: unknown) => (
    error instanceof Error
    && "code" in error
    && error.code === "ETIMEDOUT"
  ));
  assert.deepEqual(leaderSignals, ["SIGKILL"]);
  assert.equal(scheduled[0]?.cleared, true);
  assert.equal(scheduled[1]?.cleared, true);
  assert.equal(childRef?.listenerCount("close"), 0);
});

test("외부 프로세스 시간 제한은 전체 프로세스 그룹에 TERM 후 KILL하고 close에서 끝난다", async () => {
  const scheduled: Array<{
    callback: () => void;
    delay: number;
    cleared: boolean;
  }> = [];
  const handles = new Map<object, (typeof scheduled)[number]>();
  const setTimeoutImpl = ((callback: () => void, delay = 0) => {
    const task = { callback, delay, cleared: false };
    const handle = {};
    scheduled.push(task);
    handles.set(handle, task);
    return handle;
  }) as unknown as typeof setTimeout;
  const clearTimeoutImpl = ((handle: object) => {
    const task = handles.get(handle);
    if (task) {
      task.cleared = true;
    }
  }) as unknown as typeof clearTimeout;
  let childRef: (EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    pid: number;
    kill: (signal?: NodeJS.Signals) => boolean;
  }) | undefined;
  const spawnImpl = (() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      pid: number;
      kill: (signal?: NodeJS.Signals) => boolean;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 42_424;
    child.kill = () => true;
    childRef = child;
    return child as unknown as ChildProcess;
  }) as unknown as typeof spawn;
  const groupSignals: NodeJS.Signals[] = [];
  let groupAlive = true;
  const pending = runExternalProcess("yt-dlp", ["--version"], {
    cwd: "/tmp",
    env: { PATH: "/usr/bin" },
    shell: false,
    timeoutMs: 123
  }, {
    spawnImpl,
    setTimeoutImpl,
    clearTimeoutImpl,
    killGraceMs: 17,
    platform: "linux",
    probeProcessGroupImpl: () => {
      if (!groupAlive) {
        throw Object.assign(new Error("missing"), { code: "ESRCH" });
      }
    },
    killProcessGroupImpl: (pid, signal) => {
      assert.equal(pid, 42_424);
      groupSignals.push(signal);
    }
  });
  const rejected = assert.rejects(pending, /123ms 시간 제한/u);
  assert.equal(scheduled[0]?.delay, 123);
  scheduled[0]?.callback();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(groupSignals, ["SIGTERM"]);
  assert.equal(scheduled[1]?.delay, 17);
  scheduled[1]?.callback();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(groupSignals, ["SIGTERM", "SIGKILL"]);
  groupAlive = false;
  assert.equal(scheduled[2]?.delay, 17);
  scheduled[2]?.callback();
  await new Promise<void>((resolve) => setImmediate(resolve));
  childRef?.stdout.end();
  childRef?.stderr.end();
  childRef?.emit("close", null, "SIGKILL");
  await rejected;
  assert.equal(scheduled[0]?.cleared, true);
});

test("leader가 TERM 직후 닫혀도 무시하는 descendant group에는 grace 뒤 KILL한다", async () => {
  const scheduled: Array<{
    callback: () => void;
    delay: number;
    cleared: boolean;
  }> = [];
  const handles = new Map<object, (typeof scheduled)[number]>();
  const setTimeoutImpl = ((callback: () => void, delay = 0) => {
    const task = { callback, delay, cleared: false };
    const handle = {};
    scheduled.push(task);
    handles.set(handle, task);
    return handle;
  }) as unknown as typeof setTimeout;
  const clearTimeoutImpl = ((handle: object) => {
    const task = handles.get(handle);
    if (task) {
      task.cleared = true;
    }
  }) as unknown as typeof clearTimeout;
  let childRef: (EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    pid: number;
    kill: () => boolean;
  }) | undefined;
  const spawnImpl = (() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      pid: number;
      kill: () => boolean;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 51_515;
    child.kill = () => true;
    childRef = child;
    return child as unknown as ChildProcess;
  }) as unknown as typeof spawn;
  const groupSignals: NodeJS.Signals[] = [];
  let groupAlive = true;
  const pending = runExternalProcess("ffmpeg", [], {
    cwd: "/tmp",
    env: {},
    shell: false,
    timeoutMs: 100
  }, {
    spawnImpl,
    setTimeoutImpl,
    clearTimeoutImpl,
    killGraceMs: 25,
    platform: "linux",
    probeProcessGroupImpl: () => {
      if (!groupAlive) {
        throw Object.assign(new Error("missing"), { code: "ESRCH" });
      }
    },
    killProcessGroupImpl: (_pid, signal) => {
      groupSignals.push(signal);
    }
  });
  let settled = false;
  void pending.then(
    () => { settled = true; },
    () => { settled = true; }
  );
  const rejected = assert.rejects(pending, /100ms 시간 제한/u);
  scheduled[0]?.callback();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(groupSignals, ["SIGTERM"]);
  childRef?.stdout.end();
  childRef?.stderr.end();
  childRef?.emit("close", null, "SIGTERM");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(scheduled[1]?.delay, 25);
  scheduled[1]?.callback();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(groupSignals, ["SIGTERM", "SIGKILL"]);
  assert.equal(scheduled[2]?.delay, 25);
  groupAlive = false;
  scheduled[2]?.callback();
  await rejected;
});

test("정상 close도 남은 POSIX descendant group을 회수한 뒤에만 성공한다", async () => {
  const scheduled: Array<{ callback: () => void; delay: number }> = [];
  const setTimeoutImpl = ((callback: () => void, delay = 0) => {
    scheduled.push({ callback, delay });
    return {} as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  let groupAlive = true;
  const groupSignals: NodeJS.Signals[] = [];
  const spawnImpl = (() => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => boolean;
    };
    child.pid = 61_616;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    queueMicrotask(() => {
      child.stdout.end("ok\n");
      child.stderr.end();
      child.emit("close", 0, null);
    });
    return child as unknown as ChildProcess;
  }) as unknown as typeof spawn;
  const pending = runExternalProcess("ffmpeg", [], {
    cwd: "/tmp",
    env: {},
    shell: false
  }, {
    spawnImpl,
    setTimeoutImpl,
    clearTimeoutImpl: (() => undefined) as typeof clearTimeout,
    killGraceMs: 13,
    platform: "linux",
    probeProcessGroupImpl: () => {
      if (!groupAlive) {
        throw Object.assign(new Error("missing"), { code: "ESRCH" });
      }
    },
    killProcessGroupImpl: (_pid, signal) => groupSignals.push(signal)
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(groupSignals, ["SIGTERM"]);
  let settled = false;
  void pending.then(() => { settled = true; });
  assert.equal(settled, false);
  groupAlive = false;
  assert.equal(scheduled[1]?.delay, 13);
  scheduled[1]?.callback();
  const result = await pending;
  assert.equal(result.stdout, "ok\n");
  assert.deepEqual(groupSignals, ["SIGTERM"]);
});

test("정상 exit 뒤 POSIX descendant가 SIGKILL에도 남으면 성공으로 처리하지 않는다", async () => {
  const scheduled: Array<{ callback: () => void; delay: number }> = [];
  const setTimeoutImpl = ((callback: () => void, delay = 0) => {
    scheduled.push({ callback, delay });
    return {} as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  const groupSignals: NodeJS.Signals[] = [];
  const spawnImpl = (() => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => boolean;
    };
    child.pid = 62_626;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    queueMicrotask(() => {
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0, null);
    });
    return child as unknown as ChildProcess;
  }) as unknown as typeof spawn;
  const pending = runExternalProcess("ffmpeg", [], {
    cwd: "/tmp",
    env: {},
    shell: false
  }, {
    spawnImpl,
    setTimeoutImpl,
    clearTimeoutImpl: (() => undefined) as typeof clearTimeout,
    killGraceMs: 11,
    platform: "linux",
    probeProcessGroupImpl: () => undefined,
    killProcessGroupImpl: (_pid, signal) => groupSignals.push(signal)
  });
  const rejected = assert.rejects(pending, (error: unknown) => (
    error instanceof Error
    && "code" in error
    && error.code === "EPROCESSGROUPALIVE"
  ));
  await new Promise<void>((resolve) => setImmediate(resolve));
  scheduled[1]?.callback();
  await new Promise<void>((resolve) => setImmediate(resolve));
  scheduled[2]?.callback();
  await rejected;
  assert.deepEqual(groupSignals, ["SIGTERM", "SIGKILL"]);
});

test("실제 POSIX 정상 exit도 SIGTERM 무시 descendant를 남기지 않는다", {
  skip: process.platform === "win32"
}, async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "kirinuki-process-group-test-"));
  const pidPath = path.join(cwd, "descendant.pid");
  t.after(async () => {
    try {
      const descendantPid = Number(await readFile(pidPath, "utf8"));
      if (Number.isSafeInteger(descendantPid) && descendantPid > 0) {
        try {
          process.kill(descendantPid, "SIGKILL");
        } catch (error) {
          if (
            !(error instanceof Error)
            || !("code" in error)
            || error.code !== "ESRCH"
          ) {
            throw error;
          }
        }
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
  const parentScript = [
    "const { spawn } = require('node:child_process');",
    "const { writeFileSync } = require('node:fs');",
    "const descendant = spawn(process.execPath, ['-e', 'process.on(\\\"SIGTERM\\\", () => {}); setInterval(() => {}, 1000);'], { stdio: 'ignore' });",
    "writeFileSync(process.argv[1], String(descendant.pid));",
    "setTimeout(() => process.exit(0), 25);"
  ].join("\n");
  const result = await runExternalProcess(process.execPath, [
    "-e",
    parentScript,
    pidPath
  ], {
    cwd,
    env: process.env,
    shell: false,
    timeoutMs: 5_000
  }, {
    killGraceMs: 100,
    platform: process.platform
  });
  assert.equal(result.exitCode, 0);
  const descendantPid = Number(await readFile(pidPath, "utf8"));
  assert.throws(
    () => process.kill(descendantPid, 0),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === "ESRCH"
    )
  );
});

test("빠른 close도 진행 중인 재귀 quota 검사가 끝나기 전에 성공하지 않는다", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "kirinuki-fast-close-quota-"));
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });
  const nestedDirectory = path.join(cwd, "nested", "deeper");
  await mkdir(nestedDirectory, { recursive: true });
  await writeFile(path.join(nestedDirectory, "late.part"), "too-large");
  const spawnImpl = (() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => boolean;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    queueMicrotask(() => {
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0, null);
    });
    return child as unknown as ChildProcess;
  }) as unknown as typeof spawn;
  await assert.rejects(
    runExternalProcess("ffmpeg", [], {
      cwd,
      env: {},
      shell: false,
      workingDirectoryByteLimit: 1
    }, {
      spawnImpl,
      platform: "win32"
    }),
    (error: unknown) => {
      assert(error instanceof ExternalVodMaterializationError);
      assert.equal(error.code, "MATERIALIZATION_QUOTA_EXCEEDED");
      return true;
    }
  );
});

test("빠른 close 뒤 최종 statfs가 나빠지면 성공 대신 오류를 전파한다", async () => {
  const spawnImpl = (() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => boolean;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    queueMicrotask(() => {
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0, null);
    });
    return child as unknown as ChildProcess;
  }) as unknown as typeof spawn;
  let statFileSystemCalls = 0;
  await assert.rejects(
    runExternalProcess("ffmpeg", [], {
      cwd: "/tmp",
      env: {},
      shell: false,
      minimumAvailableDiskBytes: 1
    }, {
      spawnImpl,
      platform: "win32",
      statFileSystemImpl: async () => {
        statFileSystemCalls += 1;
        return statFileSystemCalls === 1
          ? { bavail: 1, bsize: 1 }
          : { bavail: 0, bsize: 1 };
      }
    }),
    (error: unknown) => {
      assert(error instanceof ExternalVodMaterializationError);
      assert.equal(error.code, "INSUFFICIENT_DISK_SPACE");
      return true;
    }
  );
  assert.equal(statFileSystemCalls, 2);
});

test("기본 프로세스 경계는 작업 파일이 상한을 넘는 즉시 child를 종료한다", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "kirinuki-resource-limit-"));
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });
  const nestedDirectory = path.join(cwd, "nested", "deeper");
  await mkdir(nestedDirectory, { recursive: true });
  await writeFile(path.join(nestedDirectory, "growing.part"), "too-large");
  let killed = false;
  const spawnImpl = (() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => boolean;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      killed = true;
      queueMicrotask(() => {
        child.stdout.end();
        child.stderr.end();
        child.emit("close", null, "SIGTERM");
      });
      return true;
    };
    return child as unknown as ChildProcess;
  }) as unknown as typeof spawn;
  await assert.rejects(
    runExternalProcess("ffmpeg", [], {
      cwd,
      env: {},
      shell: false,
      workingDirectoryByteLimit: 1
    }, {
      spawnImpl,
      platform: "win32"
    }),
    (error: unknown) => {
      assert(error instanceof ExternalVodMaterializationError);
      assert.equal(error.code, "MATERIALIZATION_QUOTA_EXCEEDED");
      return true;
    }
  );
  assert.equal(killed, true);
});

test("실시간 statfs도 음수 bavail과 0 이하 bsize를 곱하기 전에 거부한다", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "kirinuki-statfs-limit-"));
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });
  for (const fileSystem of [
    { bavail: -1, bsize: 4_096 },
    { bavail: 1, bsize: 0 }
  ]) {
    const spawnImpl = (() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: PassThrough;
        stderr: PassThrough;
        kill: () => boolean;
      };
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => {
        queueMicrotask(() => {
          child.stdout.end();
          child.stderr.end();
          child.emit("close", null, "SIGTERM");
        });
        return true;
      };
      return child as unknown as ChildProcess;
    }) as unknown as typeof spawn;
    await assert.rejects(
      runExternalProcess("ffmpeg", [], {
        cwd,
        env: {},
        shell: false,
        minimumAvailableDiskBytes: 1
      }, {
        spawnImpl,
        platform: "win32",
        statFileSystemImpl: async () => fileSystem
      }),
      (error: unknown) => {
        assert(error instanceof ExternalVodMaterializationError);
        assert.equal(error.code, "DISK_SPACE_CHECK_FAILED");
        return true;
      }
    );
  }
});

test("SOOP 외부 materializer는 두 파트의 필요한 구간만 받고 병합하며 검증된 cache를 재사용한다", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-external-vod-"));
  t.after(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });
  const rawMetadata = JSON.stringify({
    id: SOOP_ID,
    extractor: "soop",
    webpage_url: SOOP_URL,
    original_url: SOOP_URL,
    availability: "public",
    live_status: "was_live",
    duration: 120,
    timestamp: 1_700_000_000,
    entries: [
      { id: "part_1", duration: 60, availability: "public" },
      { id: "part_2", duration: 60, availability: "public" }
    ]
  });
  const sectionCalls: readonly string[][] = [];
  const concatCalls: readonly string[][] = [];
  const metadataProbeDirectories: string[] = [];
  let metadataProbeCalls = 0;
  const runProcess = async (
    command: string,
    args: readonly string[],
    options: ExternalProcessRunOptions
  ): Promise<ExternalProcessResult> => {
    assert.equal(options.shell, false);
    assert.equal(options.env.HOME, undefined);
    assert.equal(options.env.API_TOKEN, undefined);
    assert.equal(options.env.TEMP, options.cwd);
    assert.equal(options.env.TMP, options.cwd);
    assert.equal(options.env.TMPDIR, options.cwd);
    if (command === PYTHON_BINARY && args.includes("--dump-single-json")) {
      assertIsolatedYtDlpInvocation(args);
      assert.equal(options.timeoutMs, EXTERNAL_METADATA_TIMEOUT_MS);
      metadataProbeDirectories.push(options.cwd);
      metadataProbeCalls += 1;
      return { exitCode: 0, stdout: rawMetadata, stderr: "" };
    }
    assert.equal(command, "ffmpeg");
    assert.equal(options.timeoutMs, 5 * 60 * 1_000);
    const outputPath = args.at(-1);
    assert.ok(outputPath);
    if (options.cwd.includes(".hls-acquire-")) {
      (sectionCalls as string[][]).push([...args]);
      const durationMs = Math.round(Number(optionValue(args, "-t")) * 1_000);
      await writeFile(outputPath, `strict-section:${durationMs}`);
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    (concatCalls as string[][]).push([...args]);
    await writeFile(outputPath, "joined-local-mp4");
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const inspectMedia = async (
    filePath: string
  ): Promise<ExternalMediaInspection> => {
    const content = await readFile(filePath, "utf8");
    const section = /^strict-section:(\d+)$/u.exec(content);
    return editorSafeInspection(section ? Number(section[1]) : 21_000);
  };
  const inspectPacketCopyMedia = async (
    filePath: string
  ): Promise<ExternalMediaInspection> => ({
    ...(await inspectMedia(filePath)),
    packetCopySignature: "fixture-strict-codec-parameters"
  });
  const request = {
    consumerId: TEST_CONSUMER_ID,
    sourceUrl: `${SOOP_URL}?change_second=55`,
    sourceClockIdentity: soopSourceClockIdentity([
      { id: "part_1", durationSeconds: 60 },
      { id: "part_2", durationSeconds: 60 }
    ]),
    clips: [{ id: "clip-a", startMs: 55_000, endMs: 56_000 }],
    stateDir
  } as const;
  const dependencies = {
    runProcess,
    inspectMedia,
    inspectPacketCopyMedia,
    pythonBinary: PYTHON_BINARY,
    ytDlpBinary: YT_DLP_ARTIFACT,
    processEnv: {
      PATH: "/usr/bin",
      TEMP: "/attacker/temp",
      TMP: "/attacker/tmp",
      TMPDIR: "/attacker/tmpdir",
      HOME: "/sensitive/home",
      API_TOKEN: "secret"
    }
  };
  const first = await materializeExternalVod(request, dependencies);
  assert.equal(first.reused, false);
  assert.equal(first.manifest.source.platform, "SOOP");
  assert.equal(first.manifest.source.contentId, SOOP_ID);
  assert.equal(first.manifest.handleMs, 10_000);
  assert.equal(first.manifest.mediaDurationMs, 21_000);
  assert.deepEqual(first.manifest.windows, [{
    id: "window-1",
    editableSourceStartMs: 45_000,
    editableSourceEndMs: 66_000,
    fetchedSourceStartMs: 45_000,
    fetchedSourceEndMs: 66_000,
    mediaStartMs: 0,
    mediaEndMs: 21_000,
    clipIds: ["clip-a"]
  }]);
  assert.ok(normalizeChzzkVodMaterialization(first.manifest));
  assert.equal(first.receipt.schemaId, EXTERNAL_VOD_CACHE_SCHEMA);
  assert.equal(path.dirname(first.artifactPath), path.join(
    stateDir,
    "consumers",
    externalVodConsumerScopeHash(TEST_CONSUMER_ID),
    "jobs",
    "soop",
    first.manifest.materializationId
  ));
  assert.equal(first.receipt.acquiredSections.length, 2);
  assert.equal(sectionCalls.length, 2);
  assert.equal(optionValue(sectionCalls[0]!, "-ss"), "45.000000");
  assert.equal(optionValue(sectionCalls[0]!, "-t"), "15.000000");
  assert.equal(optionValue(sectionCalls[1]!, "-ss"), "0.000000");
  assert.equal(optionValue(sectionCalls[1]!, "-t"), "6.000000");
  assert.equal(concatCalls.length, 1);
  assert.equal(optionValue(concatCalls[0]!, "-c"), "copy");
  assert(!concatCalls[0]!.includes("libx264"));
  assert.equal(metadataProbeCalls, 2);
  assert.equal(await readFile(first.artifactPath, "utf8"), "joined-local-mp4");
  assert.doesNotMatch(
    JSON.stringify(first.receipt),
    /sensitive|secret|cookies|password/iu
  );

  const second = await materializeExternalVod({
    ...request,
    resume: {
      materializationId: first.manifest.materializationId,
      planFingerprint: first.manifest.planFingerprint,
      contentId: SOOP_ID
    }
  }, {
    processEnv: {},
    runProcess: async () => {
      assert.fail("검증된 resume 캐시는 외부 도구를 실행하면 안 됩니다.");
    },
    inspectMedia: async () => {
      assert.fail("검증된 resume 캐시는 ffprobe를 실행하면 안 됩니다.");
    }
  });
  assert.equal(second.reused, true);
  assert.deepEqual(second.manifest, first.manifest);
  assert.equal(sectionCalls.length, 2);
  assert.equal(concatCalls.length, 1);
  assert.equal(metadataProbeCalls, 2);

  const receiptPath = path.join(path.dirname(first.artifactPath), "manifest.json");
  const originalReceiptJson = await readFile(receiptPath, "utf8");
  interface MutableReceiptFixture {
    schemaId: string;
    canonicalUrl: string;
    sourceVersionId: string;
    manifest: {
      source: { contentId: string };
      planFingerprint: string;
      handleMs: number;
    };
    clips: Array<{ endMs: number }>;
    acquiredSections: Array<{ sourceEndMs: number }>;
    sourceRoots: Array<{ sourceEndMs: number }>;
    artifact: {
      sizeBytes: number;
      hashSha256: string;
      cacheFileName?: string;
    };
  }
  const integrityTamperers: Array<(
    receipt: MutableReceiptFixture
  ) => void> = [
    (receipt) => { receipt.schemaId = "invalid"; },
    (receipt) => { receipt.canonicalUrl = YOUTUBE_URL; },
    (receipt) => { receipt.sourceVersionId = "0".repeat(64); },
    (receipt) => { receipt.manifest.source.contentId = "987654321"; },
    (receipt) => { receipt.manifest.planFingerprint = "0".repeat(64); },
    (receipt) => { receipt.manifest.handleMs = 9_999; },
    (receipt) => { receipt.clips[0]!.endMs += 1; },
    (receipt) => { receipt.acquiredSections[0]!.sourceEndMs -= 1; },
    (receipt) => { receipt.sourceRoots.pop(); },
    (receipt) => { receipt.artifact.sizeBytes += 1; },
    (receipt) => { receipt.artifact.hashSha256 = "0".repeat(64); },
    (receipt) => { delete receipt.artifact.cacheFileName; },
    (receipt) => { receipt.artifact.cacheFileName = "materialized.mp4"; },
    (receipt) => {
      receipt.artifact.cacheFileName = (
        `materialized-${receipt.artifact.hashSha256}.mp4`
      );
    }
  ];
  let integrityFallbackCalls = 0;
  for (const tamper of integrityTamperers) {
    const receipt = JSON.parse(originalReceiptJson) as MutableReceiptFixture;
    tamper(receipt);
    await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`);
    await assert.rejects(
      materializeExternalVod({
        ...request,
        resume: {
          materializationId: first.manifest.materializationId,
          planFingerprint: first.manifest.planFingerprint,
          contentId: SOOP_ID
        }
      }, {
        pythonBinary: PYTHON_BINARY,
        ytDlpBinary: YT_DLP_ARTIFACT,
        runProcess: async () => {
          integrityFallbackCalls += 1;
          throw new Error("offline cache rejected; remote probe attempted");
        }
      }),
      (error: unknown) => {
        assert(error instanceof ExternalVodMaterializationError);
        assert.equal(error.code, "METADATA_PROBE_FAILED");
        return true;
      }
    );
  }
  await writeFile(receiptPath, originalReceiptJson);
  assert.equal(integrityFallbackCalls, integrityTamperers.length);

  const invalidFingerprint = `${first.manifest.planFingerprint.slice(0, -1)}${
    first.manifest.planFingerprint.endsWith("0") ? "1" : "0"
  }`;
  const probedFallback = await materializeExternalVod({
    ...request,
    resume: {
      materializationId: first.manifest.materializationId,
      planFingerprint: invalidFingerprint,
      contentId: SOOP_ID
    }
  }, dependencies);
  assert.equal(probedFallback.reused, true);
  assert.equal(metadataProbeCalls, 3);
  assert.equal(sectionCalls.length, 2);
  assert.match(
    path.basename(metadataProbeDirectories[0] ?? ""),
    /^metadata-probe-[a-f0-9]{32}$/u
  );
  for (const directory of metadataProbeDirectories) {
    assert.notEqual(path.resolve(directory), path.resolve(stateDir));
    await assert.rejects(
      readdir(directory),
      (error: unknown) => (
        error instanceof Error
        && "code" in error
        && error.code === "ENOENT"
      )
    );
  }
});

test("최종 ffprobe 뒤 source가 교체돼도 게시본을 다시 검사하고 receipt를 만들지 않는다", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-post-publish-probe-"));
  t.after(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });
  let sourceSwapped = false;
  let publishedProbeCalls = 0;
  await assert.rejects(
    materializeExternalVod({
      consumerId: TEST_CONSUMER_ID,
      sourceUrl: YOUTUBE_URL,
      clips: [{ id: "clip", startMs: 20_000, endMs: 21_000 }],
      stateDir
    }, youtubeFixtureDependencies({
      inspectMedia: async (filePath) => {
        const basename = path.basename(filePath);
        if (basename === "materialized.tmp.mp4" && !sourceSwapped) {
          const original = await readFile(filePath);
          await rm(filePath);
          await writeFile(filePath, Buffer.alloc(original.byteLength, 0x78));
          sourceSwapped = true;
          return editorSafeInspection(21_000);
        }
        if (filePath.startsWith(`/proc/${process.pid}/fd/`)) {
          publishedProbeCalls += 1;
          return editorSafeInspection(22_000);
        }
        return editorSafeInspection(21_000);
      }
    })),
    (error: unknown) => {
      assert(error instanceof ExternalVodMaterializationError);
      assert.equal(error.code, "MEDIA_VERIFICATION_FAILED");
      assert.match(error.message, /게시된 로컬 MP4 길이/u);
      return true;
    }
  );
  assert.equal(sourceSwapped, true);
  assert.equal(publishedProbeCalls, 1);
  const entries = await readdir(stateDir, { recursive: true });
  assert.equal(entries.some((entry) => path.basename(entry).startsWith("materialized-")), false);
  assert.equal(entries.some((entry) => entry.endsWith("manifest.json")), false);
});

test("게시 경로를 바꿨다가 복원해도 semantic probe는 열린 fd만 읽고 ABA를 거부한다", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-publish-aba-"));
  t.after(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });
  let inspectedContent = "";
  let descriptorProbeCalls = 0;
  await assert.rejects(
    materializeExternalVod({
      consumerId: TEST_CONSUMER_ID,
      sourceUrl: YOUTUBE_URL,
      clips: [{ id: "clip", startMs: 20_000, endMs: 21_000 }],
      stateDir
    }, youtubeFixtureDependencies({
      inspectMedia: async (filePath) => {
        if (!filePath.startsWith(`/proc/${process.pid}/fd/`)) {
          return editorSafeInspection(21_000);
        }
        descriptorProbeCalls += 1;
        const entries = await readdir(stateDir, { recursive: true });
        const artifactEntry = entries.find((entry) => (
          path.basename(entry).startsWith("materialized-")
          && entry.endsWith(".mp4")
        ));
        assert.ok(artifactEntry);
        const artifactPath = path.join(stateDir, artifactEntry);
        const backupPath = `${artifactPath}.aba-backup`;
        const original = await readFile(artifactPath);
        await rename(artifactPath, backupPath);
        try {
          await writeFile(artifactPath, "alternate-path-bytes");
          await writeFile(backupPath, original);
          inspectedContent = await readFile(filePath, "utf8");
        } finally {
          await rm(artifactPath, { force: true });
          await rename(backupPath, artifactPath);
        }
        return editorSafeInspection(21_000);
      }
    })),
    (error: unknown) => {
      assert(error instanceof ExternalVodMaterializationError);
      assert.equal(error.code, "CACHE_INTEGRITY_FAILED");
      assert.match(error.message, /파일 디스크립터 미디어 검사 중/u);
      return true;
    }
  );
  assert.equal(descriptorProbeCalls, 1);
  assert.equal(inspectedContent, "youtube-final-mp4");
  const entries = await readdir(stateDir, { recursive: true });
  assert.equal(entries.some((entry) => path.basename(entry).startsWith("materialized-")), false);
  assert.equal(entries.some((entry) => entry.endsWith("manifest.json")), false);
});

test("게시 후 경로 교체는 fd-bound 검증에서 막고 다른 inode의 대체 파일은 지우지 않는다", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-publish-race-"));
  t.after(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });
  let swappedPath = "";
  await assert.rejects(
    materializeExternalVod({
      consumerId: TEST_CONSUMER_ID,
      sourceUrl: YOUTUBE_URL,
      clips: [{ id: "clip", startMs: 20_000, endMs: 21_000 }],
      stateDir
    }, youtubeFixtureDependencies({
      hashFile: async (filePath) => {
        const original = await readFile(filePath);
        const originalHash = sha256Buffer(original);
        await rm(filePath);
        await writeFile(filePath, "attacker-replacement");
        swappedPath = filePath;
        return originalHash;
      }
    })),
    (error: unknown) => {
      assert(error instanceof ExternalVodMaterializationError);
      assert.equal(error.code, "CACHE_INTEGRITY_FAILED");
      return true;
    }
  );
  assert.ok(swappedPath);
  assert.equal(await readFile(swappedPath, "utf8"), "attacker-replacement");
});

test("게시 중 같은 inode가 변조되면 자신이 만든 hard-link만 정리한다", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-publish-cleanup-"));
  t.after(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });
  await assert.rejects(
    materializeExternalVod({
      consumerId: TEST_CONSUMER_ID,
      sourceUrl: YOUTUBE_URL,
      clips: [{ id: "clip", startMs: 20_000, endMs: 21_000 }],
      stateDir
    }, youtubeFixtureDependencies({
      hashFile: async (filePath) => {
        const original = await readFile(filePath);
        await writeFile(filePath, "same-inode-corruption");
        return sha256Buffer(original);
      }
    })),
    (error: unknown) => {
      assert(error instanceof ExternalVodMaterializationError);
      assert.equal(error.code, "CACHE_INTEGRITY_FAILED");
      return true;
    }
  );
  const entries = await readdir(stateDir, { recursive: true });
  assert.equal(entries.some((entry) => path.basename(entry).startsWith("materialized-")), false);
});

test("게시 원본에 기존 hard-link가 있으면 nlink 1 경계를 통과하지 못한다", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-source-link-"));
  t.after(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });
  await assert.rejects(
    materializeExternalVod({
      consumerId: TEST_CONSUMER_ID,
      sourceUrl: YOUTUBE_URL,
      clips: [{ id: "clip", startMs: 20_000, endMs: 21_000 }],
      stateDir
    }, youtubeFixtureDependencies({}, async (outputPath) => {
      await link(outputPath, `${outputPath}.unexpected-link`);
    })),
    (error: unknown) => {
      assert(error instanceof ExternalVodMaterializationError);
      assert.equal(error.code, "UNSAFE_OUTPUT_PATH");
      assert.match(error.message, /단일 일반 파일/u);
      return true;
    }
  );
});

test("resume 해시 중 artifact 경로가 바뀌면 재사용하지 않고 대체 파일도 삭제하지 않는다", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-resume-race-"));
  t.after(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });
  const request = {
    consumerId: TEST_CONSUMER_ID,
    sourceUrl: YOUTUBE_URL,
    clips: [{ id: "clip", startMs: 20_000, endMs: 21_000 }],
    stateDir
  } as const;
  const first = await materializeExternalVod(
    request,
    youtubeFixtureDependencies()
  );
  let metadataFallbackCalls = 0;
  let swapped = false;
  await assert.rejects(
    materializeExternalVod({
      ...request,
      resume: {
        materializationId: first.manifest.materializationId,
        planFingerprint: first.manifest.planFingerprint,
        contentId: YOUTUBE_ID
      }
    }, youtubeFixtureDependencies({
      hashFile: async (filePath) => {
        const original = await readFile(filePath);
        await rm(filePath);
        await writeFile(filePath, "resume-attacker-replacement");
        swapped = true;
        return sha256Buffer(original);
      },
      runProcess: async () => {
        metadataFallbackCalls += 1;
        throw new Error("offline fallback reached");
      }
    })),
    (error: unknown) => {
      assert(error instanceof ExternalVodMaterializationError);
      assert.equal(error.code, "METADATA_PROBE_FAILED");
      return true;
    }
  );
  assert.equal(swapped, true);
  assert.equal(metadataFallbackCalls, 1);
  assert.equal(
    await readFile(first.artifactPath, "utf8"),
    "resume-attacker-replacement"
  );
});

test("SOOP 선택 source proof의 파트 identity가 계획과 다르면 즉시 중단한다", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-soop-part-id-"));
  t.after(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });
  let muxCalls = 0;
  const runProcess: ExternalProcessRunner = async (command, args) => {
    if (command === PYTHON_BINARY && args.includes("--dump-single-json")) {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          id: SOOP_ID,
          extractor: "soop",
          webpage_url: SOOP_URL,
          original_url: SOOP_URL,
          availability: "public",
          live_status: "was_live",
          duration: 120,
          entries: [{ id: "expected-part", duration: 120 }]
        }),
        stderr: ""
      };
    }
    if (command === "ffmpeg") {
      const outputPath = args.at(-1);
      assert.ok(outputPath);
      if (outputPath.includes(".hls-acquire-")) {
        await writeFile(outputPath, "strict-soop-section");
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      muxCalls += 1;
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    assert.equal(command, PYTHON_BINARY);
    assertIsolatedYtDlpInvocation(args);
    const outputPath = path.join(
      optionValue(args, "--paths"),
      optionValue(args, "--output").replace("%(ext)s", "mp4")
    );
    await writeFile(outputPath, "wrong-soop-part");
    return {
      exitCode: 0,
      stdout: `kirinuki-soop-entry-id:different-part\n${outputPath}\n`,
      stderr: ""
    };
  };
  await assert.rejects(
    materializeExternalVod({
      consumerId: TEST_CONSUMER_ID,
      sourceUrl: SOOP_URL,
      sourceClockIdentity: soopSourceClockIdentity([
        { id: "expected-part", durationSeconds: 120 }
      ]),
      clips: [{ id: "clip", startMs: 20_000, endMs: 21_000 }],
      stateDir
    }, {
      runProcess,
      pythonBinary: PYTHON_BINARY,
      ytDlpBinary: YT_DLP_ARTIFACT,
      resolveClockProofSet: async () => {
        throw Object.assign(new Error("fixture part identity mismatch"), {
          code: "SOURCE_CHANGED"
        });
      },
      inspectMedia: async () => editorSafeInspection(21_000),
      statFileSystem: async () => ({
        bavail: BigInt(MAX_EXTERNAL_VOD_WORK_BYTES),
        bsize: 1n
      })
    }),
    (error: unknown) => {
      assert(error instanceof ExternalVodMaterializationError);
      assert.equal(error.code, "SOURCE_CHANGED");
      assert.match(error.message, /player clock/u);
      return true;
    }
  );
  assert.equal(muxCalls, 0);
});

test("내부 resolver가 proof와 다른 runtime part를 반환하면 취득 전에 중단한다", async (t) => {
  const stateDir = await mkdtemp(path.join(
    os.tmpdir(),
    "kirinuki-clock-resolution-boundary-"
  ));
  t.after(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });
  await assert.rejects(
    materializeExternalVod({
      consumerId: TEST_CONSUMER_ID,
      sourceUrl: YOUTUBE_URL,
      clips: [{ id: "clip", startMs: 20_000, endMs: 21_000 }],
      stateDir
    }, youtubeFixtureDependencies({
      resolveClockProofSet: async (metadata, parts) => {
        const valid = await fixtureClockProofSet(metadata, parts);
        const runtime = valid.runtime.parts[0];
        assert.ok(runtime);
        return {
          ...valid,
          runtime: {
            parts: [{ ...runtime, partIndex: 1 }]
          }
        };
      }
    })),
    (error: unknown) => {
      assert(error instanceof ExternalVodMaterializationError);
      assert.equal(error.code, "CLOCK_PROOF_MISMATCH");
      return true;
    }
  );
});

test("YouTube direct clock의 일시적 CDN 실패만 새 선택 source로 한 번 재증명한다", async (t) => {
  const stateDir = await mkdtemp(path.join(
    os.tmpdir(),
    "kirinuki-youtube-clock-retry-"
  ));
  t.after(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });
  let resolverCalls = 0;
  const completed = await materializeExternalVod({
    consumerId: TEST_CONSUMER_ID,
    sourceUrl: YOUTUBE_URL,
    clips: [{ id: "clock-retry", startMs: 20_000, endMs: 21_000 }],
    stateDir
  }, youtubeFixtureDependencies({
    resolveClockProofSet: async (metadata, parts) => {
      resolverCalls += 1;
      if (resolverCalls === 1) {
        throw Object.assign(new Error("transient signed edge URL"), {
          code: "DIRECT_CLOCK_PROBE_FAILED"
        });
      }
      return await fixtureClockProofSet(metadata, parts);
    }
  }));
  assert.equal(completed.manifest.source.platform, "YOUTUBE");
  assert.equal(resolverCalls, 3, "최초 1회 재시도와 완료 source 재검증만 허용합니다.");
});

test("다운로드 완료 전 metadata 재검증에서 sourceVersionId 변화가 보이면 publish하지 않는다", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-soop-version-"));
  t.after(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });
  let metadataProbeCalls = 0;
  let muxCalls = 0;
  const runProcess: ExternalProcessRunner = async (command, args) => {
    if (command === PYTHON_BINARY && args.includes("--dump-single-json")) {
      metadataProbeCalls += 1;
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          id: SOOP_ID,
          extractor: "soop",
          webpage_url: SOOP_URL,
          original_url: SOOP_URL,
          availability: "public",
          live_status: "was_live",
          duration: 120,
          timestamp: 1_700_000_000,
          ...(metadataProbeCalls > 1
            ? { modified_timestamp: 1_700_000_001 }
            : {}),
          entries: [{ id: "stable-part", duration: 120 }]
        }),
        stderr: ""
      };
    }
    if (command === "ffmpeg") {
      const outputPath = args.at(-1);
      assert.ok(outputPath);
      if (outputPath.includes(".hls-acquire-")) {
        await writeFile(outputPath, "stable-soop-section");
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      muxCalls += 1;
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    assert.equal(command, PYTHON_BINARY);
    assertIsolatedYtDlpInvocation(args);
    const outputPath = path.join(
      optionValue(args, "--paths"),
      optionValue(args, "--output").replace("%(ext)s", "mp4")
    );
    await writeFile(outputPath, "stable-soop-part");
    return {
      exitCode: 0,
      stdout: `kirinuki-soop-entry-id:stable-part\n${outputPath}\n`,
      stderr: ""
    };
  };
  await assert.rejects(
    materializeExternalVod({
      consumerId: TEST_CONSUMER_ID,
      sourceUrl: SOOP_URL,
      sourceClockIdentity: soopSourceClockIdentity([
        { id: "stable-part", durationSeconds: 120 }
      ]),
      clips: [{ id: "clip", startMs: 20_000, endMs: 21_000 }],
      stateDir
    }, {
      runProcess,
      pythonBinary: PYTHON_BINARY,
      ytDlpBinary: YT_DLP_ARTIFACT,
      inspectMedia: async () => editorSafeInspection(21_000),
      statFileSystem: async () => ({
        bavail: BigInt(MAX_EXTERNAL_VOD_WORK_BYTES),
        bsize: 1n
      })
    }),
    (error: unknown) => {
      assert(error instanceof ExternalVodMaterializationError);
      assert.equal(error.code, "SOURCE_CHANGED");
      assert.match(error.message, /버전 또는 파트 구성/u);
      return true;
    }
  );
  assert.equal(metadataProbeCalls, 2);
  assert.equal(muxCalls, 0);
});

test("strict section 검사 실패는 취득 작업 폴더와 부분 파일을 정리한다", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-external-cleanup-"));
  t.after(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });
  const runProcess: ExternalProcessRunner = async (
    command,
    args
  ) => {
    if (command === PYTHON_BINARY && args.includes("--dump-single-json")) {
      assertIsolatedYtDlpInvocation(args);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          id: YOUTUBE_ID,
          extractor: "youtube",
          duration: 120,
          availability: "public",
          live_status: "not_live"
        }),
        stderr: ""
      };
    }
    assert.equal(command, "ffmpeg");
    const outputPath = args.at(-1);
    assert.ok(outputPath);
    await writeFile(outputPath, "downloaded-section");
    await writeFile(`${outputPath}.part`, "partial-sidecar");
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  await assert.rejects(
    materializeExternalVod({
      consumerId: TEST_CONSUMER_ID,
      sourceUrl: YOUTUBE_URL,
      clips: [{ id: "clip", startMs: 20_000, endMs: 21_000 }],
      stateDir
    }, {
      runProcess,
      pythonBinary: PYTHON_BINARY,
      ytDlpBinary: YT_DLP_ARTIFACT,
      inspectMedia: async () => {
        throw new Error("forced ffprobe failure");
      },
      statFileSystem: async () => ({
        bavail: BigInt(MAX_EXTERNAL_VOD_WORK_BYTES),
        bsize: 1n
      })
    }),
    (error: unknown) => {
      assert(error instanceof ExternalVodMaterializationError);
      assert.equal(error.code, "MEDIA_VERIFICATION_FAILED");
      return true;
    }
  );
  const entries = await readdir(stateDir, { recursive: true });
  assert.deepEqual(
    entries.filter((entry) => (
      /section-|\.part$|\.direct-acquire-/u.test(entry)
    )),
    []
  );
});

test("필수 오디오가 없는 strict section은 최종 mux 전에 거부한다", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-external-stream-"));
  t.after(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });
  let muxCalls = 0;
  let sectionCalls = 0;
  const runProcess: ExternalProcessRunner = async (command, args) => {
    if (command === PYTHON_BINARY && args.includes("--dump-single-json")) {
      assertIsolatedYtDlpInvocation(args);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          id: SOOP_ID,
          extractor: "soop",
          webpage_url: SOOP_URL,
          original_url: SOOP_URL,
          availability: "public",
          live_status: "was_live",
          duration: 120,
          entries: [
            { id: "part-1", duration: 60, availability: "public" },
            { id: "part-2", duration: 60, availability: "public" }
          ]
        }),
        stderr: ""
      };
    }
    if (command === "ffmpeg") {
      const outputPath = args.at(-1);
      assert.ok(outputPath);
      if (outputPath.includes(".hls-acquire-")) {
        sectionCalls += 1;
        await writeFile(outputPath, `strict-section:${sectionCalls}`);
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      muxCalls += 1;
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    assert.equal(command, PYTHON_BINARY);
    assertIsolatedYtDlpInvocation(args);
    const outputPath = path.join(
      optionValue(args, "--paths"),
      optionValue(args, "--output").replace("%(ext)s", "mp4")
    );
    await writeFile(outputPath, "downloaded-section");
    const playlistItem = optionValue(args, "--playlist-items");
    return {
      exitCode: 0,
      stdout: `kirinuki-soop-entry-id:part-${playlistItem}\n${outputPath}\n`,
      stderr: ""
    };
  };
  await assert.rejects(
    materializeExternalVod({
      consumerId: TEST_CONSUMER_ID,
      sourceUrl: SOOP_URL,
      sourceClockIdentity: soopSourceClockIdentity([
        { id: "part-1", durationSeconds: 60 },
        { id: "part-2", durationSeconds: 60 }
      ]),
      clips: [{ id: "cross-part", startMs: 55_000, endMs: 56_000 }],
      stateDir
    }, {
      runProcess,
      pythonBinary: PYTHON_BINARY,
      ytDlpBinary: YT_DLP_ARTIFACT,
      inspectMedia: async (filePath) => {
        const content = await readFile(filePath, "utf8");
        return editorSafeInspection(
          content === "strict-section:2" ? 6_000 : 15_000,
          content === "strict-section:2" ? null : "aac"
        );
      },
      statFileSystem: async () => ({
        bavail: BigInt(MAX_EXTERNAL_VOD_WORK_BYTES),
        bsize: 1n
      })
    }),
    (error: unknown) => {
      assert(error instanceof ExternalVodMaterializationError);
      assert.equal(error.code, "MEDIA_VERIFICATION_FAILED");
      return true;
    }
  );
  assert.equal(muxCalls, 0);
});

test("동일 계획의 동시 attempt는 BUSY나 공유 삭제 없이 원자적 artifact를 재사용한다", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-external-concurrent-"));
  t.after(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });
  let downloadCalls = 0;
  let muxCalls = 0;
  let releaseFirstDownload: (() => void) | undefined;
  const firstDownloadWaiting = new Promise<void>((resolve) => {
    releaseFirstDownload = resolve;
  });
  const runProcess: ExternalProcessRunner = async (command, args) => {
    if (command === PYTHON_BINARY && args.includes("--dump-single-json")) {
      assertIsolatedYtDlpInvocation(args);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          id: YOUTUBE_ID,
          extractor: "youtube",
          duration: 120,
          availability: "public",
          live_status: "not_live",
          timestamp: 1_700_000_000
        }),
        stderr: ""
      };
    }
    assert.equal(command, "ffmpeg");
    const outputPath = args.at(-1);
    assert.ok(outputPath);
    if (outputPath.includes(".direct-acquire-")) {
      downloadCalls += 1;
      if (downloadCalls === 1) {
        await firstDownloadWaiting;
      } else if (downloadCalls === 2) {
        releaseFirstDownload?.();
      }
      await writeFile(outputPath, "same-section");
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    muxCalls += 1;
    await writeFile(outputPath, "same-final-mp4");
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const request = {
    consumerId: TEST_CONSUMER_ID,
    sourceUrl: YOUTUBE_URL,
    clips: [{ id: "clip", startMs: 20_000, endMs: 21_000 }],
    stateDir
  } as const;
  const dependencies = {
    runProcess,
    pythonBinary: PYTHON_BINARY,
    ytDlpBinary: YT_DLP_ARTIFACT,
    inspectMedia: async () => editorSafeInspection(21_000),
    now: () => new Date("2026-08-10T00:00:00.000Z"),
    statFileSystem: async () => ({
      bavail: BigInt(MAX_EXTERNAL_VOD_WORK_BYTES),
      bsize: 1n
    })
  };
  const [left, right] = await Promise.all([
    materializeExternalVod(request, dependencies),
    materializeExternalVod(request, dependencies)
  ]);
  assert.notEqual(left.artifactPath, right.artifactPath);
  assert.equal(await readFile(left.artifactPath, "utf8"), "same-final-mp4");
  assert.equal(await readFile(right.artifactPath, "utf8"), "same-final-mp4");
  assert.equal(downloadCalls, 2);
  assert.equal(muxCalls, 2);
  const reused = await materializeExternalVod(request, dependencies);
  assert.equal(reused.reused, true);
  assert.ok(
    reused.artifactPath === left.artifactPath
    || reused.artifactPath === right.artifactPath
  );
  assert.equal(downloadCalls, 2);
  const entries = await readdir(stateDir, { recursive: true });
  assert.equal(entries.some((entry) => entry.endsWith(".materializing.lock")), false);
  assert.equal(entries.some((entry) => /attempt-[a-f0-9]+\//u.test(entry)), false);
});

test("동시 publish 뒤 한 attempt의 검증 실패가 다른 attempt의 committed artifact를 지우지 않는다", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-publish-owner-"));
  t.after(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });
  let descriptorCalls = 0;
  let releaseFirstDescriptor: (() => void) | undefined;
  const secondDescriptorSeen = new Promise<void>((resolve) => {
    releaseFirstDescriptor = resolve;
  });
  const dependencies = youtubeFixtureDependencies({
    inspectMedia: async (filePath) => {
      if (!filePath.startsWith(`/proc/${process.pid}/fd/`)) {
        return editorSafeInspection(21_000);
      }
      descriptorCalls += 1;
      if (descriptorCalls === 1) {
        await secondDescriptorSeen;
        return editorSafeInspection(22_000);
      }
      releaseFirstDescriptor?.();
      return editorSafeInspection(21_000);
    }
  });
  const request = {
    consumerId: TEST_CONSUMER_ID,
    sourceUrl: YOUTUBE_URL,
    clips: [{ id: "clip", startMs: 20_000, endMs: 21_000 }],
    stateDir
  } as const;
  const attempt = () => materializeExternalVod(request, dependencies).catch(
    (error: unknown) => {
      // A sibling may fail before reaching the descriptor barrier (for
      // example while racing on a shared checkpoint). Never strand the actor
      // that is deliberately paused to verify publish-owner cleanup.
      releaseFirstDescriptor?.();
      throw error;
    }
  );
  const settled = await Promise.allSettled([attempt(), attempt()]);
  const success = settled.find((result) => result.status === "fulfilled");
  const failure = settled.find((result) => result.status === "rejected");
  const outcomeSummary = settled.map((result) => result.status === "fulfilled"
    ? { status: result.status }
    : {
      status: result.status,
      code: result.reason instanceof ExternalVodMaterializationError
        ? result.reason.code
        : undefined,
      message: result.reason instanceof Error
        ? result.reason.message
        : String(result.reason)
    });
  assert.ok(
    success?.status === "fulfilled",
    `동시 publish 결과: ${JSON.stringify(outcomeSummary)}`
  );
  assert.ok(failure?.status === "rejected");
  assert(
    failure.reason instanceof ExternalVodMaterializationError
  );
  assert.equal(failure.reason.code, "MEDIA_VERIFICATION_FAILED");
  assert.equal(
    await readFile(success.value.artifactPath, "utf8"),
    "youtube-final-mp4"
  );
  const resumed = await materializeExternalVod({
    ...request,
    resume: {
      materializationId: success.value.manifest.materializationId,
      planFingerprint: success.value.manifest.planFingerprint,
      contentId: YOUTUBE_ID
    }
  }, {
    runProcess: async () => {
      assert.fail("성공한 동시 attempt의 receipt는 offline 재개되어야 합니다.");
    }
  });
  assert.equal(resumed.reused, true);
  assert.equal(resumed.artifactPath, success.value.artifactPath);
});

test("immutable artifact 게시 뒤 receipt 원자 저장 실패는 그 attempt의 orphan만 회수한다", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-receipt-failure-"));
  t.after(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });
  let blockedReceiptWrite = false;
  const dependencies = youtubeFixtureDependencies({
    inspectMedia: async (filePath) => {
      if (
        !blockedReceiptWrite
        && filePath.startsWith(`/proc/${process.pid}/fd/`)
      ) {
        const platformDirectory = path.join(
          stateDir,
          "consumers",
          externalVodConsumerScopeHash(TEST_CONSUMER_ID),
          "jobs",
          "youtube"
        );
        const jobDirectories = (await readdir(platformDirectory, {
          withFileTypes: true
        })).filter((entry) => entry.isDirectory());
        assert.equal(jobDirectories.length, 1);
        await mkdir(path.join(
          platformDirectory,
          jobDirectories[0]!.name,
          "manifest.json"
        ));
        blockedReceiptWrite = true;
      }
      return editorSafeInspection(21_000);
    }
  });

  await assert.rejects(materializeExternalVod({
    consumerId: TEST_CONSUMER_ID,
    sourceUrl: YOUTUBE_URL,
    clips: [{ id: "clip", startMs: 20_000, endMs: 21_000 }],
    stateDir
  }, dependencies));

  assert.equal(blockedReceiptWrite, true);
  const entries = await readdir(stateDir, { recursive: true });
  assert.equal(
    entries.some((entry) => path.basename(entry).startsWith("materialized-")),
    false
  );
  assert.equal(
    entries.some((entry) => entry.includes("manifest.json.tmp-")),
    false
  );
  assert.equal(entries.some((entry) => /attempt-[a-f0-9]+\//u.test(entry)), false);
});

test("YouTube hot-load는 기존 clip 부분집합 root를 상속하고 새 lineage의 실제 공백만 받는다", async (t) => {
  const warmStateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-hot-warm-"));
  const coldStateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-hot-cold-"));
  t.after(async () => {
    await rm(warmStateDir, { recursive: true, force: true });
    await rm(coldStateDir, { recursive: true, force: true });
  });
  const downloadExpressions: string[] = [];
  let rejectExpression: string | undefined;
  const runProcess: ExternalProcessRunner = async (command, args) => {
    if (command === PYTHON_BINARY && args.includes("--dump-single-json")) {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          id: YOUTUBE_ID,
          extractor: "youtube",
          duration: 120,
          availability: "public",
          live_status: "not_live",
          timestamp: 1_700_000_000
        }),
        stderr: ""
      };
    }
    assert.equal(command, "ffmpeg");
    const outputPath = args.at(-1);
    assert.ok(outputPath);
    const durationMs = Math.round(Number(optionValue(args, "-t")) * 1_000);
    if (outputPath.includes(".direct-acquire-")) {
      const startMs = Math.round(Number(optionValue(args, "-ss")) * 1_000);
      const expression = `*${(startMs / 1_000).toFixed(3)}-${(
        (startMs + durationMs) / 1_000
      ).toFixed(3)}`;
      downloadExpressions.push(expression);
      if (expression === rejectExpression) {
        throw new Error("forced hot-load download failure");
      }
      await writeFile(outputPath, `section:${durationMs}`);
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    await writeFile(outputPath, `final:${durationMs}`);
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const inspectMedia = async (filePath: string): Promise<ExternalMediaInspection> => {
    const content = await readFile(filePath, "utf8");
    if (content.startsWith("final:")) {
      return editorSafeInspection(Number(content.slice("final:".length)));
    }
    const match = /^section:(\d+)$/u.exec(content);
    assert.ok(match, `알 수 없는 fixture media: ${content}`);
    return editorSafeInspection(Number(match[1]));
  };
  const dependencies: ExternalVodMaterializerDependencies = {
    runProcess,
    inspectMedia,
    pythonBinary: PYTHON_BINARY,
    ytDlpBinary: YT_DLP_ARTIFACT,
    statFileSystem: async () => ({
      bavail: BigInt(MAX_EXTERNAL_VOD_WORK_BYTES),
      bsize: 1n
    })
  };
  const clips = [{ id: "clip", startMs: 40_000, endMs: 41_000 }] as const;
  const initial = await materializeExternalVod({
    consumerId: TEST_CONSUMER_ID,
    sourceUrl: YOUTUBE_URL,
    clips,
    stateDir: warmStateDir
  }, dependencies);
  assert.deepEqual(downloadExpressions, ["*30.000-51.000"]);
  assert.equal(initial.receipt.sourceRoots?.length, 1);

  const expandedClips = [
    ...clips,
    { id: "clip-new", startMs: 90_000, endMs: 91_000 }
  ] as const;
  const expandedRequest = {
    consumerId: TEST_CONSUMER_ID,
    sourceUrl: YOUTUBE_URL,
    clips: expandedClips,
    editableRanges: [
      { id: "clip", startMs: 20_000, endMs: 70_000 },
      { id: "clip-new", startMs: 80_000, endMs: 101_000 }
    ],
    base: {
      materializationId: initial.manifest.materializationId,
      planFingerprint: initial.manifest.planFingerprint,
      contentId: YOUTUBE_ID
    },
    stateDir: warmStateDir
  } as const;
  const expanded = await materializeExternalVod(expandedRequest, dependencies);
  assert.deepEqual(downloadExpressions, [
    "*30.000-51.000",
    "*20.000-30.000",
    "*51.000-70.000",
    "*80.000-101.000"
  ]);
  assert.equal(expanded.manifest.mediaDurationMs, 71_000);
  assert.deepEqual(expanded.manifest.clipRanges, [
    {
      clipId: "clip",
      sourceStartMs: 40_000,
      sourceEndMs: 41_000,
      editableSourceStartMs: 20_000,
      editableSourceEndMs: 70_000
    },
    {
      clipId: "clip-new",
      sourceStartMs: 90_000,
      sourceEndMs: 91_000,
      editableSourceStartMs: 80_000,
      editableSourceEndMs: 101_000
    }
  ]);
  assert.equal(expanded.receipt.sourceRoots?.length, 4);
  const tamperedOffsetRoots = (expanded.receipt.sourceRoots ?? []).map(
    (root, index) => index === 0
      ? { ...root, partStartMs: root.partStartMs + 1, partEndMs: root.partEndMs + 1 }
      : root
  );
  assert.throws(
    () => missingExternalVodSections(
      planExternalVodSections({
        ...normalizeExternalVodUrl(YOUTUBE_URL),
        durationMs: 120_000,
        sourceVersionId: expanded.receipt.sourceVersionId,
        parts: [{
          id: YOUTUBE_ID,
          sourceStartMs: 0,
          sourceEndMs: 120_000,
          durationMs: 120_000
        }]
      }, expandedClips, 10_000, expandedRequest.editableRanges),
      tamperedOffsetRoots
    ),
    /새 확장 범위/u
  );
  assert.deepEqual(
    missingExternalVodSections(
      planExternalVodSections({
        ...normalizeExternalVodUrl(YOUTUBE_URL),
        durationMs: 120_000,
        sourceVersionId: expanded.receipt.sourceVersionId,
        parts: [{
          id: YOUTUBE_ID,
          sourceStartMs: 0,
          sourceEndMs: 120_000,
          durationMs: 120_000
        }]
      }, expandedClips, 10_000, expandedRequest.editableRanges),
      expanded.receipt.sourceRoots ?? []
    ),
    []
  );

  const beforeColdDownloads = downloadExpressions.length;
  const cold = await materializeExternalVod({
    consumerId: TEST_CONSUMER_ID,
    sourceUrl: YOUTUBE_URL,
    clips: expandedClips,
    editableRanges: expandedRequest.editableRanges,
    stateDir: coldStateDir
  }, dependencies);
  assert.deepEqual(
    downloadExpressions.slice(beforeColdDownloads),
    ["*20.000-70.000", "*80.000-101.000"]
  );
  assert.equal(cold.manifest.planFingerprint, expanded.manifest.planFingerprint);
  assert.equal(cold.manifest.materializationId, expanded.manifest.materializationId);

  const furtherRequest = {
    consumerId: TEST_CONSUMER_ID,
    sourceUrl: YOUTUBE_URL,
    clips: expandedClips,
    editableRanges: [
      { id: "clip", startMs: 10_000, endMs: 80_000 },
      { id: "clip-new", startMs: 75_000, endMs: 110_000 }
    ],
    base: {
      materializationId: expanded.manifest.materializationId,
      planFingerprint: expanded.manifest.planFingerprint,
      contentId: YOUTUBE_ID
    },
    stateDir: warmStateDir
  } as const;
  rejectExpression = "*101.000-110.000";
  const beforeFailedExpansion = downloadExpressions.length;
  await assert.rejects(
    materializeExternalVod(furtherRequest, dependencies),
    (error: unknown) => {
      assert(error instanceof ExternalVodMaterializationError);
      assert.equal(error.code, "MEDIA_MUX_FAILED");
      return true;
    }
  );
  assert.deepEqual(downloadExpressions.slice(beforeFailedExpansion), [
    "*10.000-20.000",
    "*70.000-80.000",
    "*101.000-110.000"
  ]);
  rejectExpression = undefined;
  const beforeRestart = downloadExpressions.length;
  const restarted = await materializeExternalVod(furtherRequest, dependencies);
  assert.deepEqual(
    downloadExpressions.slice(beforeRestart),
    ["*101.000-110.000"]
  );
  await assert.rejects(
    readFile(path.join(
      warmStateDir,
      "consumers",
      externalVodConsumerScopeHash(TEST_CONSUMER_ID),
      "jobs",
      "youtube",
      restarted.manifest.materializationId,
      "partial-roots.json"
    )),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === "ENOENT"
    )
  );
  const oldAfterFailure = await materializeExternalVod({
    consumerId: TEST_CONSUMER_ID,
    sourceUrl: YOUTUBE_URL,
    clips: expandedClips,
    editableRanges: expandedRequest.editableRanges,
    resume: {
      materializationId: expanded.manifest.materializationId,
      planFingerprint: expanded.manifest.planFingerprint,
      contentId: YOUTUBE_ID
    },
    stateDir: warmStateDir
  }, {
    runProcess: async () => {
      assert.fail("실패한 새 세대가 기존 세대의 offline resume를 깨면 안 됩니다.");
    }
  });
  assert.equal(oldAfterFailure.reused, true);
  assert.equal(oldAfterFailure.artifactPath, expanded.artifactPath);
});

test("HLS hot-load는 같은 playlist라도 겹치는 경계 fragment bytes가 바뀌면 세대를 섞지 않는다", async (t) => {
  const stateDir = await mkdtemp(path.join(
    os.tmpdir(),
    "kirinuki-hls-byte-generation-"
  ));
  t.after(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });
  let generation = "a";
  const changedFragment = Buffer.concat([
    FIXTURE_HLS_FRAGMENT,
    fixtureBox("free")
  ]);
  const fetchImpl: typeof globalThis.fetch = async (input) => {
    const url = input instanceof URL
      ? input
      : new URL(typeof input === "string" ? input : input.url);
    const body = url.pathname.endsWith("init.mp4")
      ? FIXTURE_HLS_INIT
      : generation === "a"
        ? FIXTURE_HLS_FRAGMENT
        : changedFragment;
    return new Response(body, {
      status: 200,
      headers: {
        "content-length": String(body.byteLength),
        "content-encoding": "identity"
      }
    });
  };
  const runProcess: ExternalProcessRunner = async (command, args) => {
    if (command === PYTHON_BINARY && args.includes("--dump-single-json")) {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          id: CHZZK_ID,
          extractor: "chzzk:video",
          duration: 120,
          availability: "public",
          live_status: "was_live",
          timestamp: 1_700_000_000
        }),
        stderr: ""
      };
    }
    assert.equal(command, "ffmpeg");
    const outputPath = args.at(-1);
    assert.ok(outputPath);
    const durationMs = Math.round(Number(optionValue(args, "-t")) * 1_000);
    await writeFile(
      outputPath,
      outputPath.includes(".hls-acquire-")
        ? `section:${generation}:${durationMs}`
        : `final:${durationMs}`
    );
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const dependencies: ExternalVodMaterializerDependencies = {
    runProcess,
    fetchImpl,
    pythonBinary: PYTHON_BINARY,
    ytDlpBinary: YT_DLP_ARTIFACT,
    inspectMedia: async (filePath) => {
      const duration = /:(\d+)$/u.exec(await readFile(filePath, "utf8"))?.[1];
      assert.ok(duration);
      return editorSafeInspection(Number(duration));
    },
    statFileSystem: async () => ({
      bavail: BigInt(MAX_EXTERNAL_VOD_WORK_BYTES),
      bsize: 1n
    })
  };
  const initial = await materializeExternalVod({
    consumerId: `${TEST_CONSUMER_ID}-hls-generation`,
    sourceUrl: CHZZK_URL,
    clips: [{ id: "clip", startMs: 40_000, endMs: 41_000 }],
    stateDir
  }, dependencies);
  generation = "b";
  await assert.rejects(
    materializeExternalVod({
      consumerId: `${TEST_CONSUMER_ID}-hls-generation`,
      sourceUrl: CHZZK_URL,
      clips: [{ id: "clip", startMs: 40_000, endMs: 41_000 }],
      editableRanges: [{ id: "clip", startMs: 20_000, endMs: 70_000 }],
      base: {
        materializationId: initial.manifest.materializationId,
        planFingerprint: initial.manifest.planFingerprint,
        contentId: CHZZK_ID
      },
      stateDir
    }, dependencies),
    (error: unknown) => {
      assert(error instanceof ExternalVodMaterializationError);
      assert.equal(error.code, "CACHE_INTEGRITY_FAILED");
      return true;
    }
  );
});

test("HLS hot-load는 선택 sequence가 맞닿기만 해도 선행 바이트 앵커로 세대 혼합을 막는다", async (t) => {
  const stateDir = await mkdtemp(path.join(
    os.tmpdir(),
    "kirinuki-hls-adjacent-generation-"
  ));
  t.after(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });
  let generation: "a" | "b" = "a";
  const fetchedSequences = { a: [] as number[], b: [] as number[] };
  const changedFragment = Buffer.concat([
    FIXTURE_HLS_FRAGMENT,
    fixtureBox("free")
  ]);
  const fetchImpl: typeof globalThis.fetch = async (input) => {
    const url = input instanceof URL
      ? input
      : new URL(typeof input === "string" ? input : input.url);
    const sequence = /segment-(\d+)\.m4s$/u.exec(url.pathname)?.[1];
    if (sequence !== undefined) {
      fetchedSequences[generation].push(Number(sequence));
    }
    const body = url.pathname.endsWith("init.mp4")
      ? FIXTURE_HLS_INIT
      : generation === "a"
        ? FIXTURE_HLS_FRAGMENT
        : changedFragment;
    return new Response(body, {
      status: 200,
      headers: {
        "content-length": String(body.byteLength),
        "content-encoding": "identity"
      }
    });
  };
  const resolveSegmentedClockProofSet = async (
    metadata: ExternalVodMetadata,
    parts: readonly ExternalVodMetadata["parts"][number][]
  ): Promise<ExternalVodClockProofSetResolution> => await resolveExternalVodClockProofSet({
    platform: metadata.platform,
    contentId: metadata.contentId,
    sourceVersionId: metadata.sourceVersionId,
    sourceDurationMs: metadata.durationMs,
    metadataPartCount: metadata.parts.length,
    parts: parts.map((part) => ({
      partIndex: metadata.parts.findIndex((candidate) => candidate.id === part.id),
      partId: part.id,
      sourceStartMs: part.sourceStartMs,
      sourceEndMs: part.sourceEndMs,
      durationMs: part.durationMs
    }))
  }, {
    async resolveSelectedPart(part) {
      const durationUs = part.durationMs * 1_000;
      const segmentDurationUs = 2_000_000;
      const segmentCount = Math.ceil(durationUs / segmentDurationUs);
      const prefix = `https://vod.pstatic.net/adjacent-generation/${metadata.contentId}`;
      const timelineWithoutFingerprint: Omit<
        ExternalVodHlsTimeline,
        "playlistFingerprintSha256"
      > = {
        playlistUri: `${prefix}/index.m3u8`,
        playlistSemanticUri: `${prefix}/index.m3u8`,
        renditionFingerprintSha256: sha256Buffer("adjacent-generation-rendition"),
        durationUs,
        hasEndList: true,
        hasIndependentSegments: true,
        map: {
          uri: `${prefix}/init.mp4`,
          semanticUri: `${prefix}/init.mp4`
        },
        segments: Array.from({ length: segmentCount }, (_unused, sequence) => ({
          sequence,
          startUs: sequence * segmentDurationUs,
          durationUs: Math.min(
            segmentDurationUs,
            durationUs - sequence * segmentDurationUs
          ),
          uri: `${prefix}/segment-${sequence}.m4s`,
          semanticUri: `${prefix}/segment-${sequence}.m4s`
        }))
      };
      return {
        kind: "hls",
        platform: "CHZZK",
        contentId: metadata.contentId,
        partId: part.partId,
        formatIdentity: `format:${sha256Buffer("adjacent-generation-format")}`,
        requestHeaders: {},
        timeline: {
          ...timelineWithoutFingerprint,
          playlistFingerprintSha256: externalVodHlsPlaylistFingerprintSha256(
            timelineWithoutFingerprint
          )
        }
      };
    }
  });
  const runProcess: ExternalProcessRunner = async (command, args) => {
    if (command === PYTHON_BINARY && args.includes("--dump-single-json")) {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          id: CHZZK_ID,
          extractor: "chzzk:video",
          duration: 120,
          availability: "public",
          live_status: "was_live",
          timestamp: 1_700_000_000
        }),
        stderr: ""
      };
    }
    assert.equal(command, "ffmpeg");
    const outputPath = args.at(-1);
    assert.ok(outputPath);
    const durationMs = Math.round(Number(optionValue(args, "-t")) * 1_000);
    await writeFile(
      outputPath,
      outputPath.includes(".hls-acquire-")
        ? `section:${generation}:${durationMs}`
        : `final:${durationMs}`
    );
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const dependencies: ExternalVodMaterializerDependencies = {
    runProcess,
    fetchImpl,
    resolveClockProofSet: resolveSegmentedClockProofSet,
    pythonBinary: PYTHON_BINARY,
    ytDlpBinary: YT_DLP_ARTIFACT,
    inspectMedia: async (filePath) => {
      const duration = /:(\d+)$/u.exec(await readFile(filePath, "utf8"))?.[1];
      assert.ok(duration);
      return editorSafeInspection(Number(duration));
    },
    statFileSystem: async () => ({
      bavail: BigInt(MAX_EXTERNAL_VOD_WORK_BYTES),
      bsize: 1n
    })
  };
  const initial = await materializeExternalVod({
    consumerId: `${TEST_CONSUMER_ID}-hls-adjacent-generation`,
    sourceUrl: CHZZK_URL,
    clips: [{ id: "clip", startMs: 40_000, endMs: 41_000 }],
    stateDir
  }, dependencies);
  const baseEvidence = initial.receipt.sourceRoots[0]?.clockEvidence;
  assert.ok(baseEvidence && "precedingSegment" in baseEvidence);
  assert.equal(baseEvidence.precedingSegment?.sequence, 14);

  generation = "b";
  await assert.rejects(
    materializeExternalVod({
      consumerId: `${TEST_CONSUMER_ID}-hls-adjacent-generation`,
      sourceUrl: CHZZK_URL,
      clips: [{ id: "clip", startMs: 40_000, endMs: 41_000 }],
      editableRanges: [{ id: "clip", startMs: 20_000, endMs: 51_000 }],
      base: {
        materializationId: initial.manifest.materializationId,
        planFingerprint: initial.manifest.planFingerprint,
        contentId: CHZZK_ID
      },
      stateDir
    }, dependencies),
    (error: unknown) => {
      assert(error instanceof ExternalVodMaterializationError);
      assert.equal(error.code, "CACHE_INTEGRITY_FAILED");
      return true;
    }
  );
  assert.deepEqual(fetchedSequences.a, [
    15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 14
  ]);
  assert.deepEqual(fetchedSequences.b, [10, 11, 12, 13, 14, 9]);
});

test("증명 없는 v1·v2 base receipt는 승격하지 않고 fail-closed 한다", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "kirinuki-legacy-reject-"));
  t.after(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });
  const rawMetadata = JSON.stringify({
    id: SOOP_ID,
    extractor: "soop",
    webpage_url: SOOP_URL,
    original_url: SOOP_URL,
    availability: "public",
    live_status: "was_live",
    duration: 120,
    timestamp: 1_700_000_000,
    entries: [
      { id: "part_1", duration: 60, availability: "public" },
      { id: "part_2", duration: 60, availability: "public" }
    ]
  });
  let mediaCalls = 0;
  const dependencies: ExternalVodMaterializerDependencies = {
    runProcess: async (command, args) => {
      if (command === PYTHON_BINARY && args.includes("--dump-single-json")) {
        return { exitCode: 0, stdout: rawMetadata, stderr: "" };
      }
      mediaCalls += 1;
      throw new Error("proofless base must fail before media acquisition");
    },
    inspectMedia: async () => {
      throw new Error("proofless base must fail before media inspection");
    },
    pythonBinary: PYTHON_BINARY,
    ytDlpBinary: YT_DLP_ARTIFACT,
    statFileSystem: async () => ({
      bavail: BigInt(MAX_EXTERNAL_VOD_WORK_BYTES),
      bsize: 1n
    })
  };
  const sourceClockIdentity = soopSourceClockIdentity([
    { id: "part_1", durationSeconds: 60 },
    { id: "part_2", durationSeconds: 60 }
  ]);
  for (const [index, schemaId] of [
    LEGACY_EXTERNAL_VOD_CACHE_SCHEMA,
    "chzzk-kirinuki/external-vod-cache-v2"
  ].entries()) {
    const planFingerprint = sha256Buffer(`proofless-plan-${index}`);
    const materializationId = planFingerprint.slice(0, 32);
    const legacyJobDirectory = path.join(
      stateDir,
      "consumers",
      externalVodConsumerScopeHash(TEST_CONSUMER_ID),
      "jobs",
      "soop",
      materializationId
    );
    await mkdir(legacyJobDirectory, { recursive: true });
    await writeFile(
      path.join(legacyJobDirectory, "manifest.json"),
      `${JSON.stringify({ schemaId })}\n`
    );
    await assert.rejects(
      materializeExternalVod({
        consumerId: TEST_CONSUMER_ID,
        sourceUrl: SOOP_URL,
        sourceClockIdentity,
        clips: [{ id: "clip", startMs: 55_000, endMs: 56_000 }],
        editableRanges: [{ id: "clip", startMs: 30_000, endMs: 80_000 }],
        base: {
          materializationId,
          planFingerprint,
          contentId: SOOP_ID
        },
        stateDir
      }, dependencies),
      (error: unknown) => {
        assert(error instanceof ExternalVodMaterializationError);
        assert.equal(error.code, "INVALID_BASE_MATERIALIZATION");
        return true;
      }
    );
    await assert.rejects(
      readFile(path.join(legacyJobDirectory, "legacy-roots.json")),
      (error: unknown) => (
        error instanceof Error
        && "code" in error
        && error.code === "ENOENT"
      )
    );
  }
  assert.equal(mediaCalls, 0);
});
