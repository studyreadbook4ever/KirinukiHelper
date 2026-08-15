import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  link,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA,
  CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA,
  CHZZK_VOD_CONSUMER_CACHE_PURGE_REQUEST_SCHEMA,
  VOD_CONSUMER_PURGE_QUARANTINE_DIRECTORY,
  DEFAULT_COMPLETED_VOD_JOB_TTL_MS,
  VOD_ARTIFACT_CHUNK_BYTES,
  createChzzkVodJobManager,
  normalizeChzzkVodMaterializationRequest,
  sameChzzkVodArtifactObjectIdentity
} from "../scripts/chzzk-vod-job-manager.js";
import {
  vodConsumerScopeHash,
  vodConsumerScopeRoot
} from "../scripts/vod-consumer-scope.js";
import type {
  ChzzkVodMaterializationRunner,
  ChzzkVodRunnerResult
} from "../scripts/chzzk-vod-job-manager.js";
import {
  CHZZK_VOD_MATERIALIZATION_SCHEMA,
  createMaterializationClipCoverages,
  mergeMaterializationClipCoverages
} from "../src/lib/chzzk-vod-materialization.js";
import {
  SOOP_VOD_SOURCE_CLOCK_IDENTITY_SCHEMA
} from "../src/lib/soop-vod-source-clock.js";

const SOOP_SOURCE_CLOCK_IDENTITY = Object.freeze({
  schema: SOOP_VOD_SOURCE_CLOCK_IDENTITY_SCHEMA,
  platform: "SOOP" as const,
  contentId: "169475287",
  totalDurationSeconds: 300,
  parts: Object.freeze([
    Object.freeze({
      id: "20260814_TEST_169475287_1",
      index: 0,
      order: 1,
      durationSeconds: 120
    }),
    Object.freeze({
      id: "20260814_TEST_169475287_2",
      index: 1,
      order: 2,
      durationSeconds: 180
    })
  ])
});

function request(overrides: Record<string, unknown> = {}) {
  return {
    schema: CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA,
    consumerId: "project-consumer-1",
    sourceUrl: "https://chzzk.naver.com/video/14252987",
    clips: [{ id: "clip-a", startMs: 70_000, endMs: 80_000 }],
    handleMs: 10_000,
    permission: {
      confirmed: true,
      scope: "owned-or-authorized-public-vod"
    },
    ...overrides
  };
}

function deferredRunner() {
  let resolve!: (value: ChzzkVodRunnerResult) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<ChzzkVodRunnerResult>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  const calls: Parameters<ChzzkVodMaterializationRunner>[0][] = [];
  const runner: ChzzkVodMaterializationRunner = async (input) => {
    calls.push(input);
    return promise;
  };
  return { runner, calls, resolve, reject };
}

async function nextTurn() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function integrity(value: string | Buffer) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return {
    hashSha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.byteLength
  };
}

function verification(value: string | Buffer) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const chunkHashesSha256: string[] = [];
  for (
    let offset = 0;
    offset < bytes.byteLength;
    offset += VOD_ARTIFACT_CHUNK_BYTES
  ) {
    chunkHashesSha256.push(createHash("sha256").update(
      bytes.subarray(offset, offset + VOD_ARTIFACT_CHUNK_BYTES)
    ).digest("hex"));
  }
  return {
    hashSha256: integrity(bytes).hashSha256,
    chunkSizeBytes: VOD_ARTIFACT_CHUNK_BYTES,
    chunkHashesSha256
  };
}

function validManifest({
  platform = "CHZZK",
  contentId = "14252987",
  clips = [{ id: "clip-a", startMs: 70_000, endMs: 80_000 }],
  editableRanges
}: {
  platform?: "CHZZK" | "YOUTUBE" | "SOOP";
  contentId?: string;
  clips?: Array<{ id: string; startMs: number; endMs: number }>;
  editableRanges?: Array<{ id: string; startMs: number; endMs: number }>;
} = {}) {
  const sourceDurationMs = 200_000;
  const clipRanges = createMaterializationClipCoverages(
    clips.map((clip) => ({
      clipId: clip.id,
      sourceStartMs: clip.startMs,
      sourceEndMs: clip.endMs
    })),
    sourceDurationMs,
    10_000,
    editableRanges?.map((range) => ({
      clipId: range.id,
      editableSourceStartMs: range.startMs,
      editableSourceEndMs: range.endMs
    }))
  );
  let mediaCursorMs = 0;
  const windows = mergeMaterializationClipCoverages(clipRanges)
    .map((window, index) => {
      const durationMs = window.editableSourceEndMs
        - window.editableSourceStartMs;
      const result = {
        id: `window-${index + 1}`,
        editableSourceStartMs: window.editableSourceStartMs,
        editableSourceEndMs: window.editableSourceEndMs,
        fetchedSourceStartMs: window.editableSourceStartMs,
        fetchedSourceEndMs: window.editableSourceEndMs,
        mediaStartMs: mediaCursorMs,
        mediaEndMs: mediaCursorMs + durationMs,
        clipIds: [...window.clipIds]
      };
      mediaCursorMs += durationMs;
      return result;
    });
  const planFingerprint = createHash("sha256").update(JSON.stringify({
    platform,
    contentId,
    clipRanges
  })).digest("hex");
  return {
    schema: CHZZK_VOD_MATERIALIZATION_SCHEMA,
    materializationId: planFingerprint.slice(0, 32),
    planFingerprint,
    source: {
      platform,
      contentType: "vod" as const,
      contentId,
      sourceVersionId: "c".repeat(64)
    },
    sourceDurationMs,
    handleMs: 10_000,
    mediaDurationMs: mediaCursorMs,
    windows,
    clipRanges,
    preparedAt: "2026-08-10T00:00:00.000Z",
    localOnly: true as const
  };
}

function purgeIdentity(
  jobId: string,
  manifest = validManifest()
) {
  return {
    schema: CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA,
    jobId,
    materialization: {
      materializationId: manifest.materializationId,
      planFingerprint: manifest.planFingerprint
    },
    source: {
      platform: manifest.source.platform,
      contentId: manifest.source.contentId,
      sourceVersionId: manifest.source.sourceVersionId
    }
  };
}

function consumerPurgeIdentity(
  jobId: string,
  consumerId: string,
  manifest = validManifest()
) {
  return {
    schema: CHZZK_VOD_CONSUMER_CACHE_PURGE_REQUEST_SCHEMA,
    jobId,
    consumerId,
    materialization: {
      materializationId: manifest.materializationId,
      planFingerprint: manifest.planFingerprint
    },
    source: {
      platform: manifest.source.platform,
      contentId: manifest.source.contentId,
      sourceVersionId: manifest.source.sourceVersionId
    }
  };
}

function quarantineScopePath(
  artifactRoot: string,
  consumerId: string,
  nonce: string
): string {
  return path.join(
    artifactRoot,
    VOD_CONSUMER_PURGE_QUARANTINE_DIRECTORY,
    `consumer-${vodConsumerScopeHash(consumerId)}-${nonce}`
  );
}

function inspected(
  value: string | Buffer,
  {
    version = 1,
    mtimeMs = 1_800_000_000_000
  }: { version?: number; mtimeMs?: number } = {}
) {
  const artifact = integrity(value);
  const mtimeNs = BigInt(Math.round(mtimeMs)) * 1_000_000n + BigInt(version);
  return {
    size: artifact.sizeBytes,
    mtimeMs,
    dev: "2049",
    ino: "424242",
    mtimeNs: mtimeNs.toString(),
    ctimeNs: (mtimeNs + BigInt(version)).toString(),
    regular: true,
    symlink: false
  };
}

test("path lstat과 fd stat은 timestamp 표현이 달라도 같은 파일 객체를 식별한다", () => {
  const pathIdentity = inspected("same-object", { version: 1 });
  const handleIdentity = {
    ...pathIdentity,
    mtimeNs: (BigInt(pathIdentity.mtimeNs) + 100n).toString(),
    ctimeNs: (BigInt(pathIdentity.ctimeNs) + 200n).toString()
  };
  assert.equal(
    sameChzzkVodArtifactObjectIdentity(pathIdentity, handleIdentity),
    true
  );
  assert.equal(sameChzzkVodArtifactObjectIdentity(pathIdentity, {
    ...handleIdentity,
    ino: "different-file"
  }), false);
  assert.equal(sameChzzkVodArtifactObjectIdentity(pathIdentity, {
    ...handleIdentity,
    symlink: true
  }), false);
});

test("요청은 공개 CHZZK VOD, 고정 10초, 명시적 권리 확인만 받는다", () => {
  assert.deepEqual(normalizeChzzkVodMaterializationRequest(request()), {
    consumerId: "project-consumer-1",
    sourceUrl: "https://chzzk.naver.com/video/14252987",
    clips: [{ id: "clip-a", startMs: 70_000, endMs: 80_000 }],
    handleMs: 10_000
  });
  for (const sourceUrl of [
    "http://chzzk.naver.com/video/1",
    "https://chzzk.naver.com/live/1",
    "https://www.youtube.com/watch?v=x",
    "https://chzzk.naver.com/video/1?inKey=secret"
  ]) {
    assert.throws(
      () => normalizeChzzkVodMaterializationRequest(request({ sourceUrl })),
      /VOD/
    );
  }
  assert.throws(
    () => normalizeChzzkVodMaterializationRequest(request({ consumerId: "bad\u0000id" })),
    /세션 ID/u
  );
  assert.throws(
    () => normalizeChzzkVodMaterializationRequest(request({
      schema: "chzzk-kirinuki-vod-materialization-request/v2"
    })),
    /버전/u
  );
  assert.throws(
    () => normalizeChzzkVodMaterializationRequest(request({ permission: {} })),
    /편집 허가/
  );
  assert.throws(
    () => normalizeChzzkVodMaterializationRequest(request({ handleMs: 9_999 })),
    /10초/
  );
  const resume = {
    materializationId: "a".repeat(32),
    planFingerprint: `${"a".repeat(32)}${"b".repeat(32)}`,
    contentId: "14252987"
  };
  assert.deepEqual(
    normalizeChzzkVodMaterializationRequest(request({ resume })).resume,
    resume
  );
  assert.throws(
    () => normalizeChzzkVodMaterializationRequest(request({
      resume: { ...resume, contentId: "999" }
    })),
    /현재 원본/
  );
  const base = { ...resume };
  assert.deepEqual(normalizeChzzkVodMaterializationRequest(request({
    editableRanges: [{ id: "clip-a", startMs: 30_000, endMs: 120_000 }],
    base
  })), {
    consumerId: "project-consumer-1",
    sourceUrl: "https://chzzk.naver.com/video/14252987",
    clips: [{ id: "clip-a", startMs: 70_000, endMs: 80_000 }],
    editableRanges: [{ id: "clip-a", startMs: 30_000, endMs: 120_000 }],
    handleMs: 10_000,
    base
  });
  assert.throws(
    () => normalizeChzzkVodMaterializationRequest(request({ resume, base })),
    /동시에/u
  );
  assert.throws(
    () => normalizeChzzkVodMaterializationRequest(request({
      clips: [{ id: "clip-a", startMs: 70_000.5, endMs: 80_000 }]
    })),
    /범위/u
  );
  assert.throws(
    () => normalizeChzzkVodMaterializationRequest(request({
      editableRanges: [{ id: "clip-a", startMs: 60_000.5, endMs: 90_000 }]
    })),
    /확장 편집 범위/u
  );
  assert.throws(
    () => normalizeChzzkVodMaterializationRequest(request({
      signedUrl: "https://cdn.example/video?token=secret"
    })),
    /버전/u
  );
  assert.throws(
    () => normalizeChzzkVodMaterializationRequest(request({
      permission: {
        confirmed: true,
        scope: "owned-or-authorized-public-vod",
        evidence: "must-not-enter-runtime"
      }
    })),
    /편집 허가/u
  );
});

test("SOOP 요청은 브라우저 공식 part vector를 exact-key로 검증하고 작업 identity에 보존한다", () => {
  const normalized = normalizeChzzkVodMaterializationRequest(request({
    sourceUrl: "https://vod.sooplive.com/player/169475287",
    sourceClockIdentity: SOOP_SOURCE_CLOCK_IDENTITY
  }));
  assert.deepEqual(normalized.sourceClockIdentity, SOOP_SOURCE_CLOCK_IDENTITY);
  assert.throws(
    () => normalizeChzzkVodMaterializationRequest(request({
      sourceUrl: "https://vod.sooplive.com/player/169475287"
    })),
    /part 시계 증명/u
  );
  assert.throws(
    () => normalizeChzzkVodMaterializationRequest(request({
      sourceUrl: "https://vod.sooplive.com/player/169475287",
      sourceClockIdentity: {
        ...SOOP_SOURCE_CLOCK_IDENTITY,
        parts: SOOP_SOURCE_CLOCK_IDENTITY.parts.map((part, index) => (
          index === 1 ? { ...part, durationSeconds: 181 } : part
        ))
      }
    })),
    /part 시계 증명/u
  );
  assert.throws(
    () => normalizeChzzkVodMaterializationRequest(request({
      sourceClockIdentity: SOOP_SOURCE_CLOCK_IDENTITY
    })),
    /part 시계 증명/u
  );
});

test("consumer별 작업과 access token은 분리하고 같은 물리 경로 회귀는 fail closed한다", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "kirinuki-vod-consumer-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sharedPath = path.join(directory, "shared.mp4");
  const bytes = Buffer.from("consumer-scoped-artifact", "utf8");
  await writeFile(sharedPath, bytes);
  const manifest = validManifest();
  const colliding = createChzzkVodJobManager({
    maximumConcurrentJobs: 2,
    runner: async () => ({
      manifest,
      artifactPath: sharedPath,
      artifact: integrity(bytes),
      reused: false
    })
  });
  const first = colliding.create(request({ consumerId: "project-a" }));
  assert.equal(
    colliding.create(request({ consumerId: "project-a" })),
    first
  );
  const second = colliding.create(request({ consumerId: "project-b" }));
  assert.notEqual(second.id, first.id);
  await nextTurn();
  await nextTurn();
  assert.deepEqual(
    [first.state, second.state].sort(),
    ["completed", "failed"]
  );
  const failed = first.state === "failed" ? first : second;
  assert.equal(failed.error?.code, "MEDIA_VERIFICATION_FAILED");
});

test("동일 의미 요청은 한 작업으로 합치고 완료 결과만 로컬 media URL을 낸다", async () => {
  const deferred = deferredRunner();
  const artifactBytes = Buffer.alloc(123_456, 7);
  const manager = createChzzkVodJobManager({
    runner: deferred.runner,
    inspectArtifactIdentity: async () => inspected(artifactBytes),
    hashArtifact: async () => verification(artifactBytes),
    randomBytesImpl: (() => Buffer.alloc(32, 7)) as typeof import("node:crypto").randomBytes
  });
  const first = manager.create(request());
  const duplicate = manager.create(request({
    clips: [{ id: "clip-a", startMs: 70_000, endMs: 80_000 }]
  }));
  assert.equal(first, duplicate);
  assert.equal(deferred.calls.length, 1);
  deferred.calls[0]?.onProgress({
    stage: "downloading",
    progress: 0.5,
    message: "4/8 조각 받는 중"
  });
  const pending = await manager.publicStatus(first, "http://127.0.0.1:4319");
  assert.equal(pending.state, "downloading");
  assert.equal(pending.media, undefined);

  deferred.resolve({
    manifest: validManifest(),
    artifactPath: "/safe/local/artifact.mp4",
    artifact: integrity(artifactBytes),
    reused: false
  });
  await nextTurn();
  const completed = await manager.publicStatus(first, "http://127.0.0.1:4319");
  assert.equal(completed.state, "completed");
  assert.match(completed.media?.url || "", /^http:\/\/127\.0\.0\.1:4319\/v1\/chzzk-vod\/media\//u);
  assert.equal(completed.media?.size, 123_456);
  assert.equal(JSON.stringify(completed).includes("artifactPath"), false);
  const mediaUrl = new URL(completed.media?.url || "");
  const resolvedMedia = await manager.resolveMedia(
    first.id,
    mediaUrl.searchParams.get("access")
  );
  assert.equal(resolvedMedia?.artifactPath, "/safe/local/artifact.mp4");
  assert.equal(
    resolvedMedia?.artifactVerification.chunkSizeBytes,
    VOD_ARTIFACT_CHUNK_BYTES
  );
  assert.deepEqual(
    resolvedMedia?.artifactVerification.chunkHashesSha256,
    verification(artifactBytes).chunkHashesSha256
  );
  assert.equal(await manager.resolveMedia(first.id, "wrong"), null);
});

test("resume/base 검증 identity가 같을 때만 진행 중 작업을 dedupe한다", async () => {
  const calls: Parameters<ChzzkVodMaterializationRunner>[0][] = [];
  const runner: ChzzkVodMaterializationRunner = async (input) => {
    calls.push(input);
    return await new Promise<ChzzkVodRunnerResult>((_resolve, reject) => {
      input.signal.addEventListener(
        "abort",
        () => reject(input.signal.reason),
        { once: true }
      );
    });
  };
  const manager = createChzzkVodJobManager({
    runner,
    maximumConcurrentJobs: 4
  });
  const resumeA = {
    materializationId: "a".repeat(32),
    planFingerprint: `${"a".repeat(32)}${"b".repeat(32)}`,
    contentId: "14252987"
  };
  const resumeB = {
    materializationId: "c".repeat(32),
    planFingerprint: `${"c".repeat(32)}${"d".repeat(32)}`,
    contentId: "14252987"
  };

  const withoutResume = manager.create(request());
  const withResumeA = manager.create(request({ resume: resumeA }));
  const duplicateResumeA = manager.create(request({ resume: { ...resumeA } }));
  const withResumeB = manager.create(request({ resume: resumeB }));
  const withBaseA = manager.create(request({ base: resumeA }));

  assert.notEqual(withoutResume, withResumeA);
  assert.equal(duplicateResumeA, withResumeA);
  assert.notEqual(withResumeA, withResumeB);
  assert.notEqual(withResumeA, withBaseA);
  assert.equal(new Set([
    withoutResume.id,
    withResumeA.id,
    withResumeB.id,
    withBaseA.id
  ]).size, 4);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map((call) => call.resume), [
    undefined,
    resumeA,
    resumeB,
    undefined
  ]);
  assert.deepEqual(calls.map((call) => call.base), [
    undefined,
    undefined,
    undefined,
    resumeA
  ]);

  await manager.close();
});

test("clip별 목표 coverage가 다르면 별도 작업이고 배열 순서만 다르면 dedupe한다", async () => {
  const calls: Parameters<ChzzkVodMaterializationRunner>[0][] = [];
  const runner: ChzzkVodMaterializationRunner = async (input) => {
    calls.push(input);
    return await new Promise<ChzzkVodRunnerResult>((_resolve, reject) => {
      input.signal.addEventListener("abort", () => reject(input.signal.reason), {
        once: true
      });
    });
  };
  const manager = createChzzkVodJobManager({
    runner,
    maximumConcurrentJobs: 4
  });
  const clips = [
    { id: "clip-a", startMs: 70_000, endMs: 80_000 },
    { id: "clip-b", startMs: 120_000, endMs: 130_000 }
  ];
  const first = manager.create(request({
    clips,
    editableRanges: [
      { id: "clip-a", startMs: 60_000, endMs: 90_000 },
      { id: "clip-b", startMs: 110_000, endMs: 140_000 }
    ]
  }));
  const reordered = manager.create(request({
    clips: [...clips].reverse(),
    editableRanges: [
      { id: "clip-b", startMs: 110_000, endMs: 140_000 },
      { id: "clip-a", startMs: 60_000, endMs: 90_000 }
    ]
  }));
  const expanded = manager.create(request({
    clips,
    editableRanges: [
      { id: "clip-a", startMs: 30_000, endMs: 120_000 },
      { id: "clip-b", startMs: 110_000, endMs: 140_000 }
    ]
  }));

  assert.equal(first, reordered);
  assert.notEqual(first, expanded);
  assert.equal(calls.length, 2);
  await manager.close();
});

test("runner manifest의 원본·schema·exact clip coverage가 요청과 다르면 완료하지 않는다", async () => {
  const artifactBytes = Buffer.from("wrong-source-artifact", "utf8");
  const inflatedWindow = validManifest();
  inflatedWindow.windows[0] = {
    ...inflatedWindow.windows[0]!,
    editableSourceStartMs:
      inflatedWindow.windows[0]!.editableSourceStartMs - 1_000,
    fetchedSourceStartMs:
      inflatedWindow.windows[0]!.fetchedSourceStartMs - 1_000,
    mediaEndMs: inflatedWindow.windows[0]!.mediaEndMs + 1_000
  };
  inflatedWindow.mediaDurationMs += 1_000;
  const malformedSourceVersion = validManifest();
  malformedSourceVersion.source.sourceVersionId = "not-a-sha256";
  const mismatchedManifests = [
    validManifest({ platform: "YOUTUBE" }),
    validManifest({ contentId: "99999999" }),
    validManifest({
      clips: [{ id: "clip-a", startMs: 70_000, endMs: 81_000 }]
    }),
    inflatedWindow,
    malformedSourceVersion,
    { schema: "test/v1" }
  ];

  for (const manifest of mismatchedManifests) {
    const manager = createChzzkVodJobManager({
      runner: async () => ({
        manifest,
        artifactPath: "/safe/local/wrong-source.mp4",
        artifact: integrity(artifactBytes),
        reused: false
      })
    });
    const job = manager.create(request());
    await nextTurn();
    const status = await manager.publicStatus(job, "http://127.0.0.1:4319");
    assert.equal(status.state, "failed");
    assert.equal(status.error?.code, "MEDIA_VERIFICATION_FAILED");
    assert.equal(status.media, undefined);
  }
});

test("외부 VOD runner가 exact clip보다 넓은 fetched window를 반환하면 완료하지 않는다", async () => {
  const artifactBytes = Buffer.from("inflated-external-window", "utf8");
  const manifest = validManifest({
    platform: "YOUTUBE",
    contentId: "abcdefghijk"
  });
  manifest.windows[0] = {
    ...manifest.windows[0]!,
    fetchedSourceStartMs: manifest.windows[0]!.fetchedSourceStartMs - 1_000,
    mediaEndMs: manifest.windows[0]!.mediaEndMs + 1_000
  };
  manifest.mediaDurationMs += 1_000;
  const manager = createChzzkVodJobManager({
    runner: async () => ({
      manifest,
      artifactPath: "/safe/local/inflated-external-window.mp4",
      artifact: integrity(artifactBytes),
      reused: false
    })
  });
  const job = manager.create(request({
    sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk"
  }));
  await nextTurn();

  const status = await manager.publicStatus(job, "http://127.0.0.1:4319");
  assert.equal(status.state, "failed");
  assert.equal(status.error?.code, "MEDIA_VERIFICATION_FAILED");
  await manager.close();
});

test("wrong editable coverage 완료는 캐시하지 않고 같은 요청의 즉시 재시도를 허용한다", async () => {
  const artifactBytes = Buffer.from("coverage-retry-artifact", "utf8");
  let calls = 0;
  const manager = createChzzkVodJobManager({
    runner: async () => {
      calls += 1;
      return {
        manifest: calls === 1
          ? validManifest()
          : validManifest({
            editableRanges: [
              { id: "clip-a", startMs: 30_000, endMs: 120_000 }
            ]
          }),
        artifactPath: "/safe/local/coverage-retry.mp4",
        artifact: integrity(artifactBytes),
        reused: false
      };
    },
    inspectArtifactIdentity: async () => inspected(artifactBytes),
    hashArtifact: async () => verification(artifactBytes)
  });
  const expandedRequest = request({
    editableRanges: [
      { id: "clip-a", startMs: 30_000, endMs: 120_000 }
    ]
  });
  const first = manager.create(expandedRequest);
  await nextTurn();
  assert.equal(manager.get(first.id)?.state, "failed");
  assert.equal(manager.get(first.id)?.error?.code, "MEDIA_VERIFICATION_FAILED");

  const retried = manager.create(expandedRequest);
  await nextTurn();
  assert.notEqual(retried, first);
  assert.equal(retried.id, first.id);
  assert.equal(calls, 2);
  assert.equal(
    (await manager.publicStatus(retried, "http://127.0.0.1:4319")).state,
    "completed"
  );
});

test("오류 메시지에서는 transfer URL과 토큰을 제거한다", async () => {
  const deferred = deferredRunner();
  const manager = createChzzkVodJobManager({
    runner: deferred.runner
  });
  const job = manager.create(request());
  deferred.reject(new Error(
    "fetch https://cdn.example/seg.ts?_lsu_sa_=supersecret inKey=anothersecret 실패"
  ));
  await nextTurn();
  const status = await manager.publicStatus(job, "http://127.0.0.1:4319");
  assert.equal(status.state, "failed");
  const serialized = JSON.stringify(status);
  assert.equal(serialized.includes("supersecret"), false);
  assert.equal(serialized.includes("anothersecret"), false);
  assert.equal(serialized.includes("cdn.example"), false);
});

test("strict clock·acquisition 내부 오류는 안정적인 공개 코드와 비밀 없는 안내로 접는다", async () => {
  const cases = [
    ["CLOCK_PROOF_MISMATCH", "SOURCE_CLOCK_VERIFICATION_FAILED"],
    ["INVALID_HLS_CLOCK_EVIDENCE", "SOURCE_CLOCK_VERIFICATION_FAILED"],
    ["DIRECT_CLOCK_PROBE_FAILED", "SOURCE_CLOCK_VERIFICATION_FAILED"],
    ["HLS_RESOURCE_CHANGED", "SOURCE_CHANGED"],
    ["HLS_FETCH_FAILED", "DOWNLOAD_FAILED"],
    ["UNSAFE_TRANSFER_URL", "DOWNLOAD_FAILED"],
    ["TRANSFER_TOO_LARGE", "MATERIALIZATION_QUOTA_EXCEEDED"],
    ["INVALID_FMP4_FRAGMENT", "MEDIA_VERIFICATION_FAILED"],
    ["UNSUPPORTED_HLS_PLAYLIST", "UNSUPPORTED_MEDIA"],
    ["UNSAFE_OUTPUT_PATH", "LOCAL_WRITE_FAILED"],
    ["ABORTED", "CANCELLED"]
  ] as const;

  for (const [internalCode, expectedPublicCode] of cases) {
    const manager = createChzzkVodJobManager({
      runner: async () => {
        const error = new Error(
          `internal ${internalCode} /private/cache/root https://cdn.example/segment.m4s?token=supersecret`
        ) as Error & { code: string };
        error.code = internalCode;
        throw error;
      }
    });
    const job = manager.create(request());
    await nextTurn();
    const status = await manager.publicStatus(job, "http://127.0.0.1:4319");
    assert.equal(status.state, "failed");
    assert.equal(status.error?.code, expectedPublicCode, internalCode);
    const serialized = JSON.stringify(status.error);
    assert.doesNotMatch(serialized, /internal|private|cdn\.example|supersecret/iu);
    assert.match(status.error?.message || "", /VOD|구간|원본|기기/u);
    await manager.close();
  }
});

test("알 수 없는 runner 오류는 내부 코드·메시지를 공개하지 않는다", async () => {
  const manager = createChzzkVodJobManager({
    runner: async () => {
      const error = new Error("internal parser /private/root fingerprint deadbeef") as (
        Error & { code: string }
      );
      error.code = "NEW_INTERNAL_FAILURE";
      throw error;
    }
  });
  const job = manager.create(request());
  await nextTurn();
  const status = await manager.publicStatus(job, "http://127.0.0.1:4319");
  assert.equal(status.error?.code, "MATERIALIZATION_FAILED");
  assert.equal(
    status.error?.message,
    "VOD 구간 준비에 실패했습니다. 다시 시도해 주세요."
  );
  assert.doesNotMatch(JSON.stringify(status), /NEW_INTERNAL|private|deadbeef/iu);
  await manager.close();
});

test("대기 작업 취소는 runner를 시작하지 않고, 실행 작업 취소는 signal을 끊는다", async () => {
  const deferred = deferredRunner();
  const manager = createChzzkVodJobManager({
    runner: deferred.runner,
    maximumConcurrentJobs: 1
  });
  const running = manager.create(request());
  const queued = manager.create(request({
    clips: [{ id: "clip-b", startMs: 90_000, endMs: 100_000 }]
  }));
  assert.equal(deferred.calls.length, 1);
  manager.cancel(queued.id);
  assert.equal(manager.get(queued.id)?.state, "cancelled");
  manager.cancel(running.id);
  assert.equal(deferred.calls[0]?.signal.aborted, true);
  assert.equal(manager.get(running.id)?.state, "cancelled");
});

test("identity가 같으면 SHA를 캐시하고 same-size 변경 때만 다시 해시해 변조를 차단한다", async () => {
  const goodBytes = Buffer.from("verified-local-mp4", "utf8");
  let actualBytes = goodBytes;
  let actualInspection = inspected(goodBytes);
  let calls = 0;
  let hashCalls = 0;
  const runner: ChzzkVodMaterializationRunner = async () => {
    calls += 1;
    return {
      manifest: validManifest(),
      artifactPath: "/safe/local/artifact.mp4",
      artifact: integrity(goodBytes),
      reused: calls > 1
    };
  };
  const manager = createChzzkVodJobManager({
    runner,
    inspectArtifactIdentity: async () => actualInspection,
    hashArtifact: async () => {
      hashCalls += 1;
      return verification(actualBytes);
    }
  });
  const resume = {
    materializationId: "a".repeat(32),
    planFingerprint: `${"a".repeat(32)}${"b".repeat(32)}`,
    contentId: "14252987"
  };
  const first = manager.create(request());
  await nextTurn();
  const completed = await manager.publicStatus(first, "http://127.0.0.1:4319");
  assert.equal(completed.state, "completed");
  const access = new URL(completed.media?.url || "").searchParams.get("access");
  assert.ok(await manager.resolveMedia(first.id, access));
  assert.equal(
    (await manager.publicStatus(first, "http://127.0.0.1:4319")).state,
    "completed"
  );
  assert.equal(hashCalls, 1);

  actualBytes = Buffer.from("tampered-local-mp4", "utf8");
  actualInspection = inspected(actualBytes, { version: 2 });
  const duplicateResume = manager.create(request());
  assert.equal(duplicateResume, first);
  const invalid = await manager.publicStatus(
    duplicateResume,
    "http://127.0.0.1:4319"
  );
  assert.equal(invalid.state, "failed");
  assert.equal(invalid.error?.code, "MEDIA_VERIFICATION_FAILED");
  assert.equal(hashCalls, 2);
  assert.equal(await manager.resolveMedia(first.id, access), null);

  actualBytes = goodBytes;
  actualInspection = inspected(goodBytes, { version: 3 });
  const retried = manager.create(request({ resume }));
  assert.notEqual(retried, first);
  await nextTurn();
  assert.equal(calls, 2);
  const retriedStatus = await manager.publicStatus(
    retried,
    "http://127.0.0.1:4319"
  );
  assert.equal(retriedStatus.state, "completed");
  assert.equal(hashCalls, 3);
  const retriedAccess = new URL(
    retriedStatus.media?.url || ""
  ).searchParams.get("access");

  actualInspection = {
    ...inspected(goodBytes, { version: 4 }),
    regular: false,
    symlink: true
  };
  assert.equal(await manager.resolveMedia(retried.id, retriedAccess), null);
  assert.equal(hashCalls, 3);
});

test("작업 기록·queue 상한은 active를 보존하고 종료 시 runner signal부터 취소한다", async () => {
  const observedSignals: AbortSignal[] = [];
  const runner: ChzzkVodMaterializationRunner = async ({ signal }) => {
    observedSignals.push(signal);
    return await new Promise<ChzzkVodRunnerResult>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  };
  const manager = createChzzkVodJobManager({
    runner,
    maximumConcurrentJobs: 1,
    maximumJobRecords: 2,
    maximumQueuedJobs: 1
  });
  const running = manager.create(request());
  const queued = manager.create(request({
    clips: [{ id: "clip-b", startMs: 90_000, endMs: 100_000 }]
  }));
  assert.equal(manager.size, 2);
  assert.equal(manager.get(running.id)?.state, "resolving");
  assert.equal(manager.get(queued.id)?.state, "queued");
  assert.equal(manager.queuedSize, 1);
  assert.throws(
    () => manager.create(request({
      clips: [{ id: "clip-c", startMs: 110_000, endMs: 120_000 }]
    })),
    (error: unknown) => Boolean(
      error instanceof Error
      && "code" in error
      && error.code === "BUSY"
    )
  );
  manager.cancel(queued.id);
  assert.equal(manager.queuedSize, 0);
  await manager.close();
  assert.equal(observedSignals[0]?.aborted, true);
  assert.equal(manager.get(running.id)?.state, "cancelled");
  assert.equal(manager.get(queued.id)?.state, "cancelled");
});

test("완료·실패 작업은 각 TTL 뒤 제거되지만 TTL 전 active 작업은 제거하지 않는다", async () => {
  assert.ok(DEFAULT_COMPLETED_VOD_JOB_TTL_MS >= 24 * 60 * 60 * 1_000);
  const bytes = Buffer.from("ttl-artifact", "utf8");
  let clock = 10_000;
  const manager = createChzzkVodJobManager({
    runner: async ({ clips }) => {
      if (clips[0]?.id === "fail") {
        throw new Error("fixture failure");
      }
      return {
        manifest: validManifest({ clips }),
        artifactPath: "/safe/local/ttl.mp4",
        artifact: integrity(bytes),
        reused: false
      };
    },
    inspectArtifactIdentity: async () => inspected(bytes),
    hashArtifact: async () => verification(bytes),
    completedTtlMs: 1_000,
    failedTtlMs: 1_000,
    now: () => clock
  });
  const completed = manager.create(request());
  await nextTurn();
  const initialStatus = await manager.publicStatus(
    completed,
    "http://127.0.0.1:4319"
  );
  assert.equal(initialStatus.state, "completed");
  const access = new URL(initialStatus.media?.url || "")
    .searchParams.get("access");
  clock += 999;
  assert.equal(
    (await manager.publicStatus(completed, "http://127.0.0.1:4319")).state,
    "completed"
  );
  clock += 999;
  assert.ok(await manager.resolveMedia(completed.id, access));
  clock += 999;
  assert.ok(manager.get(completed.id));
  clock += 1;
  assert.equal(manager.get(completed.id), null);
  assert.equal(manager.size, 0);

  const failed = manager.create(request({
    clips: [{ id: "fail", startMs: 5_000, endMs: 6_000 }]
  }));
  await nextTurn();
  assert.equal(manager.get(failed.id)?.state, "failed");
  clock += 999;
  assert.ok(manager.get(failed.id));
  clock += 1;
  assert.equal(manager.get(failed.id), null);
});

test("purge는 완료 작업의 exact MP4 하나만 지우고 동일 identity 재요청은 멱등 응답한다", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "kirinuki-vod-purge-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifactRoot = path.join(directory, "managed-vod");
  const artifactPath = path.join(artifactRoot, "jobs", "target", "materialized.mp4");
  const otherArtifactPath = path.join(
    artifactRoot,
    "jobs",
    "other",
    "materialized.mp4"
  );
  const localUserFile = path.join(directory, "user-selected-original.mp4");
  await Promise.all([
    mkdir(path.dirname(artifactPath), { recursive: true }),
    mkdir(path.dirname(otherArtifactPath), { recursive: true })
  ]);
  const bytes = Buffer.from("exact-managed-materialized-vod", "utf8");
  await Promise.all([
    writeFile(artifactPath, bytes),
    writeFile(otherArtifactPath, "other-cache"),
    writeFile(localUserFile, "user-file")
  ]);
  const manifest = validManifest();
  const manager = createChzzkVodJobManager({
    artifactRoot,
    runner: async () => ({
      manifest,
      artifactPath,
      artifact: integrity(bytes),
      reused: false
    })
  });
  const job = manager.create(request());
  await nextTurn();
  const status = await manager.publicStatus(job, "http://127.0.0.1:4319");
  const mediaAccess = new URL(status.media?.url || "")
    .searchParams.get("access");

  const purged = await manager.purge(
    job.id,
    mediaAccess,
    purgeIdentity(job.id, manifest)
  );
  assert.deepEqual(purged, {
    schema: "chzzk-kirinuki-vod-cache-purge-result/v1",
    jobId: job.id,
    state: "purged",
    alreadyPurged: false,
    releasedBytes: bytes.byteLength,
    materialization: {
      materializationId: manifest.materializationId,
      planFingerprint: manifest.planFingerprint
    },
    source: {
      platform: manifest.source.platform,
      contentId: manifest.source.contentId,
      sourceVersionId: manifest.source.sourceVersionId
    }
  });
  await assert.rejects(access(artifactPath), { code: "ENOENT" });
  await Promise.all([access(otherArtifactPath), access(localUserFile)]);
  assert.equal(manager.get(job.id), null);

  const repeated = await manager.purge(
    job.id,
    mediaAccess,
    purgeIdentity(job.id, manifest)
  );
  assert.equal(repeated?.alreadyPurged, true);
  assert.equal(repeated?.releasedBytes, bytes.byteLength);
  assert.equal(
    await manager.purge(job.id, "wrong-media-access", purgeIdentity(job.id, manifest)),
    null
  );
});

test("단일 artifact purge는 scope 밖 hard link를 보존하고 releasedBytes를 확정하지 않는다", async (t) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "kirinuki-vod-purge-hardlink-")
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifactRoot = path.join(directory, "managed-vod");
  const artifactPath = path.join(
    artifactRoot,
    "jobs",
    "target",
    "materialized.mp4"
  );
  const externalHardlink = path.join(directory, "external-materialized.mp4");
  await mkdir(path.dirname(artifactPath), { recursive: true });
  const bytes = Buffer.from("externally-linked-managed-vod", "utf8");
  await writeFile(artifactPath, bytes);
  const manifest = validManifest();
  const manager = createChzzkVodJobManager({
    artifactRoot,
    runner: async () => ({
      manifest,
      artifactPath,
      artifact: integrity(bytes),
      reused: false
    })
  });
  const job = manager.create(request());
  await nextTurn();
  const status = await manager.publicStatus(job, "http://127.0.0.1:4319");
  const mediaAccess = new URL(status.media?.url || "")
    .searchParams.get("access");
  await link(artifactPath, externalHardlink);

  await assert.rejects(
    manager.purge(job.id, mediaAccess, purgeIdentity(job.id, manifest)),
    (error: unknown) => Boolean(
      error instanceof Error
      && "code" in error
      && error.code === "PURGE_NOT_ALLOWED"
    )
  );
  await Promise.all([access(artifactPath), access(externalHardlink)]);
  assert.equal(manager.get(job.id)?.state, "completed");

  await unlink(externalHardlink);
  const purged = await manager.purge(
    job.id,
    mediaAccess,
    purgeIdentity(job.id, manifest)
  );
  assert.equal(purged?.releasedBytes, bytes.byteLength);
  await assert.rejects(access(artifactPath), { code: "ENOENT" });
});

test("purge는 진행 중 작업·active media read·identity 불일치를 모두 거부한다", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "kirinuki-vod-purge-busy-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifactPath = path.join(directory, "jobs", "target", "materialized.mp4");
  await mkdir(path.dirname(artifactPath), { recursive: true });
  const bytes = Buffer.from("leased-materialized-vod", "utf8");
  await writeFile(artifactPath, bytes);
  const deferred = deferredRunner();
  const manager = createChzzkVodJobManager({
    artifactRoot: directory,
    runner: deferred.runner,
    randomBytesImpl: (() => Buffer.alloc(32, 9)) as typeof import("node:crypto").randomBytes
  });
  const job = manager.create(request());
  const mediaAccess = Buffer.alloc(32, 9).toString("base64url");
  await assert.rejects(
    manager.purge(job.id, mediaAccess, purgeIdentity(job.id)),
    (error: unknown) => Boolean(
      error instanceof Error
      && "code" in error
      && error.code === "PURGE_NOT_ALLOWED"
    )
  );

  const manifest = validManifest();
  deferred.resolve({
    manifest,
    artifactPath,
    artifact: integrity(bytes),
    reused: false
  });
  await nextTurn();
  const status = await manager.publicStatus(job, "http://127.0.0.1:4319");
  const completedMediaAccess = new URL(status.media?.url || "")
    .searchParams.get("access");
  const lease = await manager.acquireMedia(job.id, completedMediaAccess);
  assert.ok(lease);
  await assert.rejects(
    manager.purge(job.id, completedMediaAccess, purgeIdentity(job.id, manifest)),
    (error: unknown) => Boolean(
      error instanceof Error
      && "code" in error
      && error.code === "PURGE_NOT_ALLOWED"
    )
  );
  lease.release();

  const mismatched = purgeIdentity(job.id, manifest);
  mismatched.source.sourceVersionId = "d".repeat(64);
  await assert.rejects(
    manager.purge(job.id, completedMediaAccess, mismatched),
    (error: unknown) => Boolean(
      error instanceof Error
      && "code" in error
      && error.code === "PURGE_IDENTITY_MISMATCH"
    )
  );
  await access(artifactPath);
});

test("purge는 새 media read를 막고 이미 열린 read가 짧게 종료되면 bounded drain 뒤 삭제한다", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "kirinuki-vod-purge-drain-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifactPath = path.join(directory, "jobs", "target", "materialized.mp4");
  await mkdir(path.dirname(artifactPath), { recursive: true });
  const bytes = Buffer.from("draining-materialized-vod", "utf8");
  await writeFile(artifactPath, bytes);
  const manifest = validManifest();
  const manager = createChzzkVodJobManager({
    artifactRoot: directory,
    runner: async () => ({
      manifest,
      artifactPath,
      artifact: integrity(bytes),
      reused: false
    }),
    randomBytesImpl: (() => Buffer.alloc(32, 12)) as typeof import("node:crypto").randomBytes
  });
  const job = manager.create(request());
  await nextTurn();
  const status = await manager.publicStatus(job, "http://127.0.0.1:4319");
  const mediaAccess = new URL(status.media?.url || "").searchParams.get("access");
  const lease = await manager.acquireMedia(job.id, mediaAccess);
  assert.ok(lease);

  const purgePromise = manager.purge(
    job.id,
    mediaAccess,
    purgeIdentity(job.id, manifest)
  );
  await nextTurn();
  assert.throws(() => manager.create(request()), (error: unknown) => Boolean(
    error instanceof Error
    && "code" in error
    && error.code === "BUSY"
  ));
  await assert.rejects(
    manager.publicStatus(job, "http://127.0.0.1:4319"),
    (error: unknown) => Boolean(
      error instanceof Error
      && "code" in error
      && error.code === "BUSY"
    )
  );
  assert.equal(
    await manager.acquireMedia(job.id, mediaAccess),
    null,
    "drain 중에는 새 range lease를 열면 안 됩니다."
  );
  lease.release();
  const result = await purgePromise;
  assert.equal(result?.releasedBytes, bytes.byteLength);
  await assert.rejects(access(artifactPath), { code: "ENOENT" });

  const recreated = manager.create(request());
  assert.notEqual(recreated, job);
  await nextTurn();
  assert.equal(manager.get(recreated.id), recreated);
});

test("publicStatus는 비동기 artifact 검증 도중 시작된 purge를 완료 상태로 노출하지 않는다", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "kirinuki-vod-status-purge-race-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifactPath = path.join(directory, "jobs", "target", "materialized.mp4");
  await mkdir(path.dirname(artifactPath), { recursive: true });
  const bytes = Buffer.from("status-verification-purge-race", "utf8");
  await writeFile(artifactPath, bytes);
  const manifest = validManifest();
  let releaseHash!: () => void;
  const hashGate = new Promise<void>((resolve) => {
    releaseHash = resolve;
  });
  let notifyHashStarted!: () => void;
  const hashStarted = new Promise<void>((resolve) => {
    notifyHashStarted = resolve;
  });
  let hashCalls = 0;
  const manager = createChzzkVodJobManager({
    artifactRoot: directory,
    runner: async () => ({
      manifest,
      artifactPath,
      artifact: integrity(bytes),
      reused: false
    }),
    hashArtifact: async () => {
      hashCalls += 1;
      notifyHashStarted();
      await hashGate;
      return verification(bytes);
    },
    randomBytesImpl: (() => Buffer.alloc(32, 14)) as typeof import("node:crypto").randomBytes
  });
  const job = manager.create(request());
  await nextTurn();
  const statusPromise = manager.publicStatus(job, "http://127.0.0.1:4319");
  await hashStarted;
  const mediaAccess = Buffer.alloc(32, 14).toString("base64url");
  const purgePromise = manager.purge(
    job.id,
    mediaAccess,
    purgeIdentity(job.id, manifest)
  );
  const statusRejected = assert.rejects(statusPromise, (error: unknown) => Boolean(
    error instanceof Error
    && "code" in error
    && error.code === "BUSY"
  ));
  assert.throws(() => manager.create(request()), (error: unknown) => Boolean(
    error instanceof Error
    && "code" in error
    && error.code === "BUSY"
  ));

  releaseHash();
  await statusRejected;
  assert.equal((await purgePromise)?.releasedBytes, bytes.byteLength);
  assert.equal(hashCalls, 1);
  await assert.rejects(access(artifactPath), { code: "ENOENT" });
});

test("record 상한 eviction은 진행 중인 artifact 검증 작업을 교체하지 않는다", async () => {
  const firstBytes = Buffer.from("verification-pinned-record", "utf8");
  const secondBytes = Buffer.from("record-after-verification", "utf8");
  const firstArtifactPath = "/safe/local/verification-pinned.mp4";
  const secondArtifactPath = "/safe/local/after-verification.mp4";
  const secondClips = [{ id: "clip-b", startMs: 90_000, endMs: 100_000 }];
  const secondRequest = request({ clips: secondClips });
  let releaseHash!: () => void;
  const hashGate = new Promise<void>((resolve) => {
    releaseHash = resolve;
  });
  let notifyHashStarted!: () => void;
  const hashStarted = new Promise<void>((resolve) => {
    notifyHashStarted = resolve;
  });
  let hashCalls = 0;
  const manager = createChzzkVodJobManager({
    maximumConcurrentJobs: 1,
    maximumJobRecords: 1,
    maximumQueuedJobs: 1,
    runner: async ({ clips }) => clips[0]?.id === "clip-b"
      ? {
          manifest: validManifest({ clips: secondClips }),
          artifactPath: secondArtifactPath,
          artifact: integrity(secondBytes),
          reused: false
        }
      : {
          manifest: validManifest(),
          artifactPath: firstArtifactPath,
          artifact: integrity(firstBytes),
          reused: false
        },
    inspectArtifactIdentity: async (artifactPath) => artifactPath === firstArtifactPath
      ? inspected(firstBytes)
      : inspected(secondBytes),
    hashArtifact: async (artifactPath) => {
      hashCalls += 1;
      if (artifactPath === firstArtifactPath) {
        notifyHashStarted();
        await hashGate;
        return verification(firstBytes);
      }
      return verification(secondBytes);
    }
  });
  const first = manager.create(request());
  await nextTurn();
  const firstStatusPromise = manager.publicStatus(
    first,
    "http://127.0.0.1:4319"
  );
  await hashStarted;

  assert.throws(() => manager.create(secondRequest), (error: unknown) => Boolean(
    error instanceof Error
    && "code" in error
    && error.code === "BUSY"
  ));
  assert.equal(manager.get(first.id), first);

  releaseHash();
  const firstStatus = await firstStatusPromise;
  assert.ok(firstStatus.media);
  const mediaAccess = new URL(firstStatus.media.url).searchParams.get("access");
  assert.ok(await manager.resolveMedia(first.id, mediaAccess));
  assert.equal(hashCalls, 1);

  const second = manager.create(secondRequest);
  assert.equal(manager.get(first.id), null);
  await nextTurn();
  assert.notEqual(second.id, first.id);
  assert.equal(manager.get(second.id), second);
});

test("record 상한 eviction은 active media read와 purge 중인 완료 작업을 교체하지 않는다", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "kirinuki-vod-purge-eviction-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const firstArtifactPath = path.join(
    directory,
    "jobs",
    "first",
    "materialized.mp4"
  );
  const secondArtifactPath = path.join(
    directory,
    "jobs",
    "second",
    "materialized.mp4"
  );
  await Promise.all([
    mkdir(path.dirname(firstArtifactPath), { recursive: true }),
    mkdir(path.dirname(secondArtifactPath), { recursive: true })
  ]);
  const firstBytes = Buffer.from("active-read-purge-record", "utf8");
  const secondBytes = Buffer.from("next-record-after-purge", "utf8");
  await Promise.all([
    writeFile(firstArtifactPath, firstBytes),
    writeFile(secondArtifactPath, secondBytes)
  ]);
  const firstManifest = validManifest();
  const secondClips = [{ id: "clip-b", startMs: 90_000, endMs: 100_000 }];
  const secondManifest = validManifest({ clips: secondClips });
  const secondRequest = request({ clips: secondClips });
  const manager = createChzzkVodJobManager({
    artifactRoot: directory,
    maximumConcurrentJobs: 1,
    maximumJobRecords: 1,
    maximumQueuedJobs: 1,
    runner: async ({ clips }) => clips[0]?.id === "clip-b"
      ? {
          manifest: secondManifest,
          artifactPath: secondArtifactPath,
          artifact: integrity(secondBytes),
          reused: false
        }
      : {
          manifest: firstManifest,
          artifactPath: firstArtifactPath,
          artifact: integrity(firstBytes),
          reused: false
        }
  });
  const first = manager.create(request());
  await nextTurn();
  const status = await manager.publicStatus(first, "http://127.0.0.1:4319");
  const mediaAccess = new URL(status.media?.url || "")
    .searchParams.get("access");
  const lease = await manager.acquireMedia(first.id, mediaAccess);
  assert.ok(lease);

  const busyWhileReading = () => manager.create(secondRequest);
  assert.throws(busyWhileReading, (error: unknown) => Boolean(
    error instanceof Error
    && "code" in error
    && error.code === "BUSY"
  ));
  assert.equal(manager.get(first.id), first);

  const purgePromise = manager.purge(
    first.id,
    mediaAccess,
    purgeIdentity(first.id, firstManifest)
  );
  await nextTurn();
  assert.throws(() => manager.create(secondRequest), (error: unknown) => Boolean(
    error instanceof Error
    && "code" in error
    && error.code === "BUSY"
  ));
  assert.equal(manager.get(first.id), first);

  lease.release();
  const purgeResult = await purgePromise;
  assert.equal(purgeResult?.releasedBytes, firstBytes.byteLength);
  await assert.rejects(access(firstArtifactPath), { code: "ENOENT" });

  const second = manager.create(secondRequest);
  await nextTurn();
  assert.notEqual(second.id, first.id);
  assert.equal(
    (await manager.publicStatus(second, "http://127.0.0.1:4319")).state,
    "completed"
  );
  await access(secondArtifactPath);
});

test("purge는 configured root 밖 artifact를 따라가지 않고 어떤 파일도 지우지 않는다", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "kirinuki-vod-purge-root-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifactRoot = path.join(directory, "managed");
  const outsideArtifact = path.join(directory, "outside-user-file.mp4");
  await mkdir(artifactRoot, { recursive: true });
  const bytes = Buffer.from("outside-root-must-survive", "utf8");
  await writeFile(outsideArtifact, bytes);
  const manifest = validManifest();
  const manager = createChzzkVodJobManager({
    artifactRoot,
    runner: async () => ({
      manifest,
      artifactPath: outsideArtifact,
      artifact: integrity(bytes),
      reused: false
    })
  });
  const job = manager.create(request());
  await nextTurn();
  const status = await manager.publicStatus(job, "http://127.0.0.1:4319");
  const mediaAccess = new URL(status.media?.url || "")
    .searchParams.get("access");
  await assert.rejects(
    manager.purge(job.id, mediaAccess, purgeIdentity(job.id, manifest)),
    (error: unknown) => Boolean(
      error instanceof Error
      && "code" in error
      && error.code === "PURGE_NOT_ALLOWED"
    )
  );
  await access(outsideArtifact);
  assert.ok(manager.get(job.id));
});

test("consumer session purge는 같은 consumer 전체만 원자 삭제하고 read/create race와 재시도를 고정한다", async (t) => {
  const directory = await mkdtemp(path.join(
    tmpdir(),
    "kirinuki-vod-consumer-purge-"
  ));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifactRoot = path.join(directory, "managed");
  const consumerA = "project-a/session-1";
  const consumerB = "project-b/session-1";
  const manifest = validManifest();
  const scopeA = vodConsumerScopeRoot(artifactRoot, consumerA);
  const scopeB = vodConsumerScopeRoot(artifactRoot, consumerB);
  const artifactA = path.join(
    scopeA,
    "jobs",
    "chzzk",
    manifest.materializationId,
    "materialized.mp4"
  );
  const artifactB = path.join(
    scopeB,
    "jobs",
    "chzzk",
    manifest.materializationId,
    "materialized.mp4"
  );
  const segmentA = path.join(
    scopeA,
    "content",
    "chzzk",
    "14252987",
    "segments",
    "segment-1.ts"
  );
  const oldExternalRootA = path.join(
    scopeA,
    "jobs",
    "youtube",
    "a".repeat(32),
    "roots",
    "old-root.mp4"
  );
  const orphanA = path.join(
    quarantineScopePath(artifactRoot, consumerA, "1".repeat(32)),
    "old-detached-cache.bin"
  );
  const orphanB = path.join(
    quarantineScopePath(artifactRoot, consumerB, "2".repeat(32)),
    "other-consumer-cache.bin"
  );
  await Promise.all([
    mkdir(path.dirname(artifactA), { recursive: true }),
    mkdir(path.dirname(artifactB), { recursive: true }),
    mkdir(path.dirname(segmentA), { recursive: true }),
    mkdir(path.dirname(oldExternalRootA), { recursive: true }),
    mkdir(path.dirname(orphanA), { recursive: true }),
    mkdir(path.dirname(orphanB), { recursive: true })
  ]);
  const artifactBytes = Buffer.from("consumer-a-artifact", "utf8");
  const otherBytes = Buffer.from("consumer-b-artifact", "utf8");
  const segmentBytes = Buffer.from("consumer-a-segment", "utf8");
  const oldRootBytes = Buffer.from("consumer-a-old-external-root", "utf8");
  const orphanABytes = Buffer.from("consumer-a-detached-orphan", "utf8");
  const orphanBBytes = Buffer.from("consumer-b-detached-orphan", "utf8");
  await Promise.all([
    writeFile(artifactA, artifactBytes),
    writeFile(artifactB, otherBytes),
    writeFile(segmentA, segmentBytes),
    writeFile(oldExternalRootA, oldRootBytes),
    writeFile(orphanA, orphanABytes),
    writeFile(orphanB, orphanBBytes)
  ]);

  const manager = createChzzkVodJobManager({
    artifactRoot,
    maximumConcurrentJobs: 2,
    runner: async ({ consumerId }) => {
      const bytes = consumerId === consumerA ? artifactBytes : otherBytes;
      return {
        manifest,
        artifactPath: consumerId === consumerA ? artifactA : artifactB,
        artifact: integrity(bytes),
        reused: false
      };
    }
  });
  const jobA = manager.create(request({ consumerId: consumerA }));
  const jobB = manager.create(request({ consumerId: consumerB }));
  await nextTurn();
  await nextTurn();
  const statusA = await manager.publicStatus(jobA, "http://127.0.0.1:4319");
  const statusB = await manager.publicStatus(jobB, "http://127.0.0.1:4319");
  const accessA = new URL(statusA.media?.url || "").searchParams.get("access");
  const accessB = new URL(statusB.media?.url || "").searchParams.get("access");
  assert.ok(accessA);
  assert.ok(accessB);

  await assert.rejects(
    manager.purgeConsumerCache(
      jobA.id,
      accessA,
      consumerPurgeIdentity(jobA.id, consumerB, manifest)
    ),
    (error: unknown) => Boolean(
      error instanceof Error
      && "code" in error
      && error.code === "PURGE_IDENTITY_MISMATCH"
    )
  );
  const lease = await manager.acquireMedia(jobA.id, accessA);
  assert.ok(lease);
  const purgePromise = manager.purgeConsumerCache(
    jobA.id,
    accessA,
    consumerPurgeIdentity(jobA.id, consumerA, manifest)
  );
  await nextTurn();
  assert.throws(
    () => manager.create(request({
      consumerId: consumerA,
      clips: [{ id: "clip-new", startMs: 90_000, endMs: 100_000 }]
    })),
    (error: unknown) => Boolean(
      error instanceof Error
      && "code" in error
      && error.code === "BUSY"
    )
  );
  await assert.rejects(
    manager.publicStatus(jobA, "http://127.0.0.1:4319"),
    (error: unknown) => Boolean(
      error instanceof Error
      && "code" in error
      && error.code === "BUSY"
    )
  );
  assert.equal(await manager.resolveMedia(jobA.id, accessA), null);
  await Promise.all([access(scopeA), access(scopeB)]);

  lease?.release();
  const result = await purgePromise;
  assert.deepEqual(result, {
    schema: "chzzk-kirinuki-vod-consumer-cache-purge-result/v1",
    jobId: jobA.id,
    consumerId: consumerA,
    state: "purged",
    alreadyPurged: false,
    releasedBytes: artifactBytes.byteLength
      + segmentBytes.byteLength
      + oldRootBytes.byteLength
      + orphanABytes.byteLength,
    releasedFiles: 4,
    materialization: {
      materializationId: manifest.materializationId,
      planFingerprint: manifest.planFingerprint
    },
    source: {
      platform: manifest.source.platform,
      contentId: manifest.source.contentId,
      sourceVersionId: manifest.source.sourceVersionId
    }
  });
  await assert.rejects(access(scopeA), { code: "ENOENT" });
  await assert.rejects(access(orphanA), { code: "ENOENT" });
  await Promise.all([access(scopeB), access(artifactB), access(orphanB)]);
  assert.equal(manager.get(jobA.id), null);
  assert.equal(manager.get(jobB.id), jobB);
  assert.ok(await manager.resolveMedia(jobB.id, accessB));

  const repeated = await manager.purgeConsumerCache(
    jobA.id,
    accessA,
    consumerPurgeIdentity(jobA.id, consumerA, manifest)
  );
  assert.equal(repeated?.alreadyPurged, true);
  assert.equal(repeated?.releasedBytes, result?.releasedBytes);
  assert.equal(repeated?.releasedFiles, result?.releasedFiles);
});

test("consumer session purge는 scope 내부 symlink와 scope 밖 hard link를 fail closed한다", async (t) => {
  const directory = await mkdtemp(path.join(
    tmpdir(),
    "kirinuki-vod-consumer-purge-boundary-"
  ));
  t.after(() => rm(directory, { recursive: true, force: true }));

  for (const attack of ["symlink", "hardlink"] as const) {
    const artifactRoot = path.join(directory, attack, "managed");
    const consumerId = `consumer-${attack}`;
    const manifest = validManifest();
    const scopeRoot = vodConsumerScopeRoot(artifactRoot, consumerId);
    const artifactPath = path.join(
      scopeRoot,
      "jobs",
      "chzzk",
      manifest.materializationId,
      "materialized.mp4"
    );
    const outsidePath = path.join(directory, attack, "outside-user-file.mp4");
    await mkdir(path.dirname(artifactPath), { recursive: true });
    const bytes = Buffer.from(`consumer-${attack}-artifact`, "utf8");
    await writeFile(artifactPath, bytes);
    if (attack === "symlink") {
      await writeFile(outsidePath, "outside-user-file");
      await symlink(outsidePath, path.join(scopeRoot, "outside-link"));
    } else {
      await link(artifactPath, outsidePath);
    }
    const manager = createChzzkVodJobManager({
      artifactRoot,
      runner: async () => ({
        manifest,
        artifactPath,
        artifact: integrity(bytes),
        reused: false
      })
    });
    const job = manager.create(request({ consumerId }));
    await nextTurn();
    const status = await manager.publicStatus(job, "http://127.0.0.1:4319");
    const mediaAccess = new URL(status.media?.url || "")
      .searchParams.get("access");
    await assert.rejects(
      manager.purgeConsumerCache(
        job.id,
        mediaAccess,
        consumerPurgeIdentity(job.id, consumerId, manifest)
      ),
      (error: unknown) => Boolean(
        error instanceof Error
        && "code" in error
        && error.code === "PURGE_NOT_ALLOWED"
      )
    );
    await Promise.all([
      access(scopeRoot),
      access(artifactPath),
      access(outsidePath)
    ]);
    assert.equal(manager.get(job.id), job);
    await manager.close();
  }
});

test("startup quarantine recovery는 검증된 orphan만 결정론적으로 지우고 현재 consumer scope는 보존한다", async (t) => {
  const directory = await mkdtemp(path.join(
    tmpdir(),
    "kirinuki-vod-quarantine-startup-"
  ));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifactRoot = path.join(directory, "managed");
  const consumerA = "startup-consumer-a";
  const consumerB = "startup-consumer-b";
  const currentA = path.join(
    vodConsumerScopeRoot(artifactRoot, consumerA),
    "current-a.mp4"
  );
  const currentB = path.join(
    vodConsumerScopeRoot(artifactRoot, consumerB),
    "current-b.mp4"
  );
  const orphanA = path.join(
    quarantineScopePath(artifactRoot, consumerA, "a".repeat(32)),
    "orphan-a.bin"
  );
  const orphanB = path.join(
    quarantineScopePath(artifactRoot, consumerB, "b".repeat(32)),
    "nested",
    "orphan-b.bin"
  );
  await Promise.all([
    mkdir(path.dirname(currentA), { recursive: true }),
    mkdir(path.dirname(currentB), { recursive: true }),
    mkdir(path.dirname(orphanA), { recursive: true }),
    mkdir(path.dirname(orphanB), { recursive: true })
  ]);
  const orphanABytes = Buffer.from("startup-orphan-a", "utf8");
  const orphanBBytes = Buffer.from("startup-orphan-b", "utf8");
  await Promise.all([
    writeFile(currentA, "active-current-a"),
    writeFile(currentB, "active-current-b"),
    writeFile(orphanA, orphanABytes),
    writeFile(orphanB, orphanBBytes)
  ]);
  const manager = createChzzkVodJobManager({
    artifactRoot,
    runner: async () => assert.fail("startup 복구는 materializer를 실행하면 안 됩니다.")
  });
  const recovered = await manager.initialize();
  assert.deepEqual(recovered, {
    releasedBytes: orphanABytes.byteLength + orphanBBytes.byteLength,
    releasedFiles: 2,
    releasedScopes: 2
  });
  await Promise.all([access(currentA), access(currentB)]);
  await Promise.all([
    assert.rejects(access(orphanA), { code: "ENOENT" }),
    assert.rejects(access(orphanB), { code: "ENOENT" })
  ]);
  assert.deepEqual(await manager.initialize(), recovered);

  const restarted = createChzzkVodJobManager({
    artifactRoot,
    runner: async () => assert.fail("빈 startup 복구는 materializer를 실행하면 안 됩니다.")
  });
  assert.deepEqual(await restarted.initialize(), {
    releasedBytes: 0,
    releasedFiles: 0,
    releasedScopes: 0
  });
  await Promise.all([access(currentA), access(currentB)]);
});

test("startup quarantine recovery는 이상 이름과 symlink가 있으면 어떤 orphan도 지우지 않는다", async (t) => {
  const directory = await mkdtemp(path.join(
    tmpdir(),
    "kirinuki-vod-quarantine-boundary-"
  ));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifactRoot = path.join(directory, "managed");
  const consumerId = "startup-boundary-consumer";
  const validOrphan = path.join(
    quarantineScopePath(artifactRoot, consumerId, "c".repeat(32)),
    "owned-cache.bin"
  );
  const quarantineRoot = path.join(
    artifactRoot,
    VOD_CONSUMER_PURGE_QUARANTINE_DIRECTORY
  );
  const invalidEntry = path.join(quarantineRoot, "unexpected-user-file.txt");
  const outside = path.join(directory, "outside-user-directory");
  await Promise.all([
    mkdir(path.dirname(validOrphan), { recursive: true }),
    mkdir(outside, { recursive: true })
  ]);
  await Promise.all([
    writeFile(validOrphan, "owned-orphan"),
    writeFile(invalidEntry, "must-not-be-touched"),
    writeFile(path.join(outside, "outside.bin"), "outside")
  ]);
  const invalidNameManager = createChzzkVodJobManager({
    artifactRoot,
    runner: async () => assert.fail("invalid quarantine은 작업을 시작하면 안 됩니다.")
  });
  await assert.rejects(
    invalidNameManager.initialize(),
    (error: unknown) => Boolean(
      error instanceof Error
      && "code" in error
      && error.code === "PURGE_NOT_ALLOWED"
    )
  );
  await Promise.all([access(validOrphan), access(invalidEntry)]);

  await rm(invalidEntry);
  const symlinkEntry = quarantineScopePath(
    artifactRoot,
    "other-consumer",
    "d".repeat(32)
  );
  await symlink(outside, symlinkEntry);
  const symlinkManager = createChzzkVodJobManager({
    artifactRoot,
    runner: async () => assert.fail("symlink quarantine은 작업을 시작하면 안 됩니다.")
  });
  await assert.rejects(
    symlinkManager.initialize(),
    (error: unknown) => Boolean(
      error instanceof Error
      && "code" in error
      && error.code === "PURGE_NOT_ALLOWED"
    )
  );
  await Promise.all([
    access(validOrphan),
    access(symlinkEntry),
    access(path.join(outside, "outside.bin"))
  ]);
});

test("consumer purge rm 실패로 남은 quarantine은 다음 startup에서 회수한다", async (t) => {
  const directory = await mkdtemp(path.join(
    tmpdir(),
    "kirinuki-vod-quarantine-rm-failure-"
  ));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifactRoot = path.join(directory, "managed");
  const consumerId = "rm-failure-consumer";
  const otherConsumerId = "rm-failure-other-consumer";
  const manifest = validManifest();
  const scopeRoot = vodConsumerScopeRoot(artifactRoot, consumerId);
  const artifactPath = path.join(
    scopeRoot,
    "jobs",
    "chzzk",
    manifest.materializationId,
    "materialized.mp4"
  );
  const otherCurrent = path.join(
    vodConsumerScopeRoot(artifactRoot, otherConsumerId),
    "other-current.mp4"
  );
  await Promise.all([
    mkdir(path.dirname(artifactPath), { recursive: true }),
    mkdir(path.dirname(otherCurrent), { recursive: true })
  ]);
  const bytes = Buffer.from("rm-failure-materialized-cache", "utf8");
  await Promise.all([
    writeFile(artifactPath, bytes),
    writeFile(otherCurrent, "other-current-must-survive")
  ]);
  let removalAttempts = 0;
  const manager = createChzzkVodJobManager({
    artifactRoot,
    runner: async () => ({
      manifest,
      artifactPath,
      artifact: integrity(bytes),
      reused: false
    }),
    removeConsumerCacheTree: async () => {
      removalAttempts += 1;
      throw new Error("simulated rm failure");
    }
  });
  const job = manager.create(request({ consumerId }));
  await nextTurn();
  const status = await manager.publicStatus(job, "http://127.0.0.1:4319");
  const mediaAccess = new URL(status.media?.url || "")
    .searchParams.get("access");
  await assert.rejects(
    manager.purgeConsumerCache(
      job.id,
      mediaAccess,
      consumerPurgeIdentity(job.id, consumerId, manifest)
    ),
    (error: unknown) => Boolean(
      error instanceof Error
      && "code" in error
      && error.code === "PURGE_FAILED"
    )
  );
  assert.equal(removalAttempts, 1);
  assert.equal(manager.get(job.id), null);
  await assert.rejects(access(scopeRoot), { code: "ENOENT" });
  await access(otherCurrent);
  const quarantineRoot = path.join(
    artifactRoot,
    VOD_CONSUMER_PURGE_QUARANTINE_DIRECTORY
  );
  const leftovers = await readdir(quarantineRoot);
  assert.equal(leftovers.length, 1);
  assert.match(
    leftovers[0] || "",
    new RegExp(`^consumer-${vodConsumerScopeHash(consumerId)}-[a-f0-9]{32}$`, "u")
  );
  const orphanPath = path.join(quarantineRoot, leftovers[0] || "");
  await access(path.join(orphanPath, path.relative(scopeRoot, artifactPath)));

  const restarted = createChzzkVodJobManager({
    artifactRoot,
    runner: async () => assert.fail("startup orphan 회수는 작업을 실행하면 안 됩니다.")
  });
  assert.deepEqual(await restarted.initialize(), {
    releasedBytes: bytes.byteLength,
    releasedFiles: 1,
    releasedScopes: 1
  });
  await assert.rejects(access(orphanPath), { code: "ENOENT" });
  await access(otherCurrent);
});
