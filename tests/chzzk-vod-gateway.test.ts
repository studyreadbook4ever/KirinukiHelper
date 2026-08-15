import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  KIRINUKI_LOCAL_STUDIO_ORIGIN
} from "../src/lib/local-runtime-origin.js";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  open,
  rm,
  writeFile
} from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import type {
  IncomingHttpHeaders,
  OutgoingHttpHeaders
} from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import {
  DEFAULT_GATEWAY_SHUTDOWN_DEADLINE_MS,
  MAX_CHZZK_VOD_REQUEST_BYTES,
  createPlatformMaterializationRunner,
  createCaptionGatewayServer,
  parseHttpByteRange,
  sendLocalMedia
} from "../scripts/caption-gateway.js";
import type {
  ChzzkVodMaterializerImplementation,
  ExternalVodMaterializerImplementation
} from "../scripts/caption-gateway.js";
import {
  CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA,
  CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA,
  CHZZK_VOD_CACHE_PURGE_RESULT_SCHEMA,
  CHZZK_VOD_CONSUMER_CACHE_PURGE_REQUEST_SCHEMA,
  CHZZK_VOD_CONSUMER_CACHE_PURGE_RESULT_SCHEMA,
  VOD_CONSUMER_PURGE_QUARANTINE_DIRECTORY,
  VOD_ARTIFACT_CHUNK_BYTES,
  normalizedChzzkVodArtifactDeviceId,
  vodConsumerPurgeQuarantineChildName
} from "../scripts/chzzk-vod-job-manager.js";
import {
  vodConsumerScopeHash,
  vodConsumerScopeRoot
} from "../scripts/vod-consumer-scope.js";
import type {
  ChzzkVodMaterializationRunner
} from "../scripts/chzzk-vod-job-manager.js";
import {
  EXTERNAL_PROCESS_KILL_GRACE_MS,
  ExternalVodMaterializationError
} from "../scripts/external-vod-materializer.js";
import {
  SOOP_VOD_SOURCE_CLOCK_IDENTITY_SCHEMA
} from "../src/lib/soop-vod-source-clock.js";
import type {
  ExternalVodMaterializationRequest
} from "../scripts/external-vod-materializer.js";
import {
  ChzzkVodMaterializationError
} from "../scripts/chzzk-vod-materializer.js";
import {
  LOCAL_VOD_RUNTIME_SCHEMA,
  PINNED_YT_DLP
} from "../scripts/local-vod-runtime-core.js";
import {
  CHZZK_VOD_MATERIALIZATION_SCHEMA,
  createMaterializationClipCoverages,
  mergeMaterializationClipCoverages
} from "../src/lib/chzzk-vod-materialization.js";

const ORIGIN = KIRINUKI_LOCAL_STUDIO_ORIGIN;
const TOKEN = "chzzk-vod-gateway-test-token";
const VOD_INSTANCE_NONCE =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const CAPTION_ONLY_TEST_ENV = Object.freeze({
  KIRINUKI_STT_MODE: "local-whispercpp",
  KIRINUKI_STT_ENDPOINT: "http://127.0.0.1:4318/inference",
  KIRINUKI_STT_MODEL: "tiny-q5_1",
  KIRINUKI_AGENT_TOKEN: TOKEN,
  KIRINUKI_ALLOWED_ORIGIN: ORIGIN,
  KIRINUKI_MAX_AUDIO_BYTES: "1048576"
});
const TEST_ENV = Object.freeze({
  ...CAPTION_ONLY_TEST_ENV,
  KIRINUKI_VOD_RUNTIME_SCHEMA: LOCAL_VOD_RUNTIME_SCHEMA,
  KIRINUKI_VOD_RUNTIME_KIND: "caption-vod",
  KIRINUKI_VOD_RUNTIME_READY: "1",
  KIRINUKI_VOD_YT_DLP_VERSION: PINNED_YT_DLP.version,
  KIRINUKI_VOD_EJS_VERSION: PINNED_YT_DLP.bundledJavascript.version,
  KIRINUKI_VOD_INSTANCE_NONCE: VOD_INSTANCE_NONCE,
  KIRINUKI_VOD_STATE_DIR: path.join(
    tmpdir(),
    "kirinuki-vod-gateway-test-state"
  )
});

interface HttpResult {
  status: number | undefined;
  headers: IncomingHttpHeaders;
  bytes: Buffer;
}

const SOOP_SOURCE_CLOCK_IDENTITY = Object.freeze({
  schema: SOOP_VOD_SOURCE_CLOCK_IDENTITY_SCHEMA,
  platform: "SOOP" as const,
  contentId: "123456789",
  totalDurationSeconds: 300,
  parts: Object.freeze([
    Object.freeze({
      id: "20260814_TEST_123456789_1",
      index: 0,
      order: 1,
      durationSeconds: 120
    }),
    Object.freeze({
      id: "20260814_TEST_123456789_2",
      index: 1,
      order: 2,
      durationSeconds: 180
    })
  ])
});

function requestBody(
  sourceUrl = "https://chzzk.naver.com/video/14252987"
) {
  const soop = /(?:sooplive|afreecatv)\.com/iu.test(sourceUrl);
  return {
    schema: CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA,
    consumerId: "gateway-project-1",
    sourceUrl,
    ...(soop ? { sourceClockIdentity: SOOP_SOURCE_CLOCK_IDENTITY } : {}),
    clips: [{ id: "clip-a", startMs: 70_000, endMs: 80_000 }],
    handleMs: 10_000,
    permission: {
      confirmed: true,
      scope: "owned-or-authorized-public-vod"
    }
  };
}

function localRequest({
  port,
  requestPath,
  method = "GET",
  headers = {},
  body
}: {
  port: number;
  requestPath: string;
  method?: string;
  headers?: OutgoingHttpHeaders;
  body?: unknown;
}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const requestBody = body === undefined
      ? null
      : Buffer.from(
        typeof body === "string" ? body : JSON.stringify(body),
        "utf8"
      );
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      path: requestPath,
      method,
      headers: requestBody
        ? {
          ...headers,
          "content-length": String(requestBody.byteLength)
        }
        : headers
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.once("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        bytes: Buffer.concat(chunks)
      }));
    });
    request.once("error", reject);
    request.end(requestBody);
  });
}

function json(result: HttpResult): Record<string, unknown> {
  return JSON.parse(result.bytes.toString("utf8")) as Record<string, unknown>;
}

function integrity(value: string | Buffer) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return {
    hashSha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.byteLength
  };
}

function validMaterialization({
  platform = "CHZZK",
  contentId = "14252987",
  clips = [{ id: "clip-a", startMs: 70_000, endMs: 80_000 }],
  editableRanges
}: {
  platform?: "CHZZK" | "YOUTUBE" | "SOOP";
  contentId?: string;
  clips?: readonly { id: string; startMs: number; endMs: number }[];
  editableRanges?: readonly { id: string; startMs: number; endMs: number }[];
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

function purgeBody(
  jobId: string,
  materialization: ReturnType<typeof validMaterialization>
) {
  return {
    schema: CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA,
    jobId,
    materialization: {
      materializationId: materialization.materializationId,
      planFingerprint: materialization.planFingerprint
    },
    source: {
      platform: materialization.source.platform,
      contentId: materialization.source.contentId,
      sourceVersionId: materialization.source.sourceVersionId
    }
  };
}

function consumerPurgeBody(
  jobId: string,
  consumerId: string,
  materialization: ReturnType<typeof validMaterialization>
) {
  return {
    schema: CHZZK_VOD_CONSUMER_CACHE_PURGE_REQUEST_SCHEMA,
    jobId,
    consumerId,
    materialization: {
      materializationId: materialization.materializationId,
      planFingerprint: materialization.planFingerprint
    },
    source: {
      platform: materialization.source.platform,
      contentId: materialization.source.contentId,
      sourceVersionId: materialization.source.sourceVersionId
    }
  };
}

function chunkVerification(value: Buffer) {
  const chunkHashesSha256: string[] = [];
  for (
    let offset = 0;
    offset < value.byteLength;
    offset += VOD_ARTIFACT_CHUNK_BYTES
  ) {
    chunkHashesSha256.push(createHash("sha256").update(
      value.subarray(offset, offset + VOD_ARTIFACT_CHUNK_BYTES)
    ).digest("hex"));
  }
  return {
    hashSha256: integrity(value).hashSha256,
    chunkSizeBytes: VOD_ARTIFACT_CHUNK_BYTES,
    chunkHashesSha256
  };
}

function identityFromBigIntStats(
  status: Awaited<ReturnType<typeof lstat>>
) {
  const bigintStatus = status as unknown as {
    dev: bigint;
    ino: bigint;
    nlink: bigint;
    size: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
    isFile: () => boolean;
    isSymbolicLink: () => boolean;
  };
  return {
    size: Number(bigintStatus.size),
    mtimeMs: Number(bigintStatus.mtimeNs) / 1_000_000,
    rawDev: bigintStatus.dev.toString(),
    dev: normalizedChzzkVodArtifactDeviceId(bigintStatus.dev),
    ino: bigintStatus.ino.toString(),
    nlink: bigintStatus.nlink.toString(),
    mtimeNs: bigintStatus.mtimeNs.toString(),
    ctimeNs: bigintStatus.ctimeNs.toString(),
    regular: bigintStatus.isFile(),
    symlink: bigintStatus.isSymbolicLink()
  };
}

async function listen(
  t: TestContext,
  runner: ChzzkVodMaterializationRunner
) {
  return await listenWithOptions(t, { materializationRunner: runner });
}

async function listenWithOptions(
  t: TestContext,
  options: Parameters<typeof createCaptionGatewayServer>[0] = {}
) {
  const { server } = createCaptionGatewayServer({
    env: TEST_ENV,
    ...options
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return (address as AddressInfo).port;
}

async function waitForCompleted(
  port: number,
  jobId: string,
  namespace: "chzzk-vod" | "vod" = "chzzk-vod"
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await localRequest({
      port,
      requestPath: `/v1/${namespace}/materializations/${jobId}`,
      headers: {
        origin: ORIGIN,
        authorization: `Bearer ${TOKEN}`,
        "x-kirinuki-protocol": CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
      }
    });
    const payload = json(result);
    if (payload.state === "completed") {
      return payload;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("VOD gateway 테스트 작업이 완료되지 않았습니다.");
}

test("HTTP Range 파서는 반열림이 아닌 포함 end 범위를 정확히 제한한다", () => {
  assert.deepEqual(parseHttpByteRange("bytes=2-5", 10), { start: 2, end: 5 });
  assert.deepEqual(parseHttpByteRange("bytes=8-", 10), { start: 8, end: 9 });
  assert.deepEqual(parseHttpByteRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.deepEqual(parseHttpByteRange("", 10), null);
  assert.throws(() => parseHttpByteRange("bytes=10-", 10), RangeError);
  assert.throws(() => parseHttpByteRange("bytes=0-1,4-5", 10), RangeError);
});

test("gateway ready는 listen 전에 남은 consumer quarantine만 회수하고 현재 scope는 보존한다", async (t) => {
  const directory = await mkdtemp(path.join(
    tmpdir(),
    "kirinuki-vod-gateway-quarantine-startup-"
  ));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const vodStateDir = path.join(directory, "managed-vod");
  const consumerId = "gateway-startup-consumer";
  const orphanRoot = path.join(
    vodStateDir,
    VOD_CONSUMER_PURGE_QUARANTINE_DIRECTORY,
    vodConsumerPurgeQuarantineChildName(
      vodConsumerScopeHash(consumerId),
      "a".repeat(32)
    )
  );
  const orphanFile = path.join(orphanRoot, "orphan.bin");
  const currentFile = path.join(
    vodConsumerScopeRoot(vodStateDir, consumerId),
    "current.bin"
  );
  const orphanBytes = Buffer.from("gateway-startup-orphan", "utf8");
  await Promise.all([
    mkdir(path.dirname(orphanFile), { recursive: true }),
    mkdir(path.dirname(currentFile), { recursive: true })
  ]);
  await Promise.all([
    writeFile(orphanFile, orphanBytes),
    writeFile(currentFile, "gateway-current-scope")
  ]);
  const runtime = createCaptionGatewayServer({
    env: {
      ...TEST_ENV,
      KIRINUKI_VOD_STATE_DIR: vodStateDir
    },
    materializationRunner: async () => {
      assert.fail("startup quarantine 회수는 materializer를 실행하면 안 됩니다.");
    }
  });
  assert.deepEqual(await runtime.ready, {
    releasedBytes: orphanBytes.byteLength,
    releasedFiles: 1,
    releasedScopes: 1
  });
  await assert.rejects(access(orphanRoot), { code: "ENOENT" });
  await access(currentFile);
  await runtime.chzzkVodJobs.close();
});

test("동일 inode 내용이 바뀌어 identity 검사를 통과해도 receipt 청크가 아니면 한 바이트도 전송하지 않는다", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "kirinuki-vod-inode-race-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifactPath = path.join(directory, "artifact.mp4");
  const original = Buffer.alloc(VOD_ARTIFACT_CHUNK_BYTES + 64, 0x41);
  original.fill(0x42, VOD_ARTIFACT_CHUNK_BYTES);
  await writeFile(artifactPath, original);
  const originalStatus = await lstat(artifactPath, { bigint: true });
  const tampered = Buffer.from(original);
  tampered.fill(0x5a, VOD_ARTIFACT_CHUNK_BYTES);
  await writeFile(artifactPath, tampered);
  const tamperedStatus = await lstat(artifactPath, { bigint: true });
  assert.equal(tamperedStatus.ino, originalStatus.ino);

  const controller = new AbortController();
  const server = createServer((request, response) => {
    void sendLocalMedia(
      request,
      response,
      artifactPath,
      identityFromBigIntStats(tamperedStatus),
      integrity(original),
      chunkVerification(original),
      controller.signal
    ).catch(() => {
      if (!response.headersSent) {
        response.removeHeader("content-length");
        response.removeHeader("content-range");
        response.statusCode = 500;
        response.setHeader("content-type", "text/plain; charset=utf-8");
        response.end("blocked");
      } else {
        response.destroy();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await localRequest({
    port: (address as AddressInfo).port,
    requestPath: "/artifact.mp4",
    headers: {
      range: `bytes=${VOD_ARTIFACT_CHUNK_BYTES}-${original.byteLength - 1}`
    }
  });
  assert.equal(response.status, 500);
  assert.equal(response.bytes.toString("utf8"), "blocked");
  assert.equal(response.bytes.includes(Buffer.from("ZZZZ", "ascii")), false);
});

test("VOD runtime identity가 없는 caption gateway는 모든 VOD endpoint를 fail-closed 한다", async (t) => {
  const port = await listenWithOptions(t, {
    env: CAPTION_ONLY_TEST_ENV
  });
  for (const requestPath of [
    "/v1/vod/materializations",
    "/v1/vod/materializations/abcdefghijklmnop",
    "/v1/vod/media/abcdefghijklmnop?access=test"
  ]) {
    const response = await localRequest({
      port,
      requestPath,
      method: requestPath.endsWith("materializations") ? "POST" : "GET",
      headers: {
        origin: ORIGIN,
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        "x-kirinuki-protocol": CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
      },
      ...(requestPath.endsWith("materializations")
        ? { body: requestBody() }
        : {})
    });
    assert.equal(response.status, 503);
    assert.equal(json(response).error && (
      json(response).error as Record<string, unknown>
    ).code, "VOD_RUNTIME_NOT_READY");
  }
});

test("VOD 작업 API는 bearer·프로토콜을 요구하고 로컬 MP4를 Range로 제공한다", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "kirinuki-vod-gateway-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifactPath = path.join(directory, "artifact.mp4");
  const artifact = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz", "ascii");
  await writeFile(artifactPath, artifact);
  const runner: ChzzkVodMaterializationRunner = async ({
    onProgress,
    clips,
    editableRanges
  }) => {
    onProgress({
      stage: "downloading",
      progress: 0.5,
      message: "필요한 조각 1/2"
    });
    return {
      manifest: validMaterialization({
        clips,
        ...(editableRanges ? { editableRanges } : {})
      }),
      artifactPath,
      artifact: integrity(artifact),
      reused: false
    };
  };
  const port = await listen(t, runner);

  const unauthorized = await localRequest({
    port,
    requestPath: "/v1/chzzk-vod/materializations",
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      "x-kirinuki-protocol": CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
    },
    body: requestBody()
  });
  assert.equal(unauthorized.status, 401);

  const legacyProtocol = await localRequest({
    port,
    requestPath: "/v1/chzzk-vod/materializations",
    method: "POST",
    headers: {
      origin: ORIGIN,
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "x-kirinuki-protocol": "chzzk-kirinuki-vod-materialization-request/v2"
    },
    body: {
      ...requestBody(),
      schema: "chzzk-kirinuki-vod-materialization-request/v2"
    }
  });
  assert.equal(legacyProtocol.status, 400);
  assert.equal(
    ((json(legacyProtocol).error as Record<string, unknown>) || {}).code,
    "PROTOCOL_REQUIRED"
  );

  const created = await localRequest({
    port,
    requestPath: "/v1/chzzk-vod/materializations",
    method: "POST",
    headers: {
      origin: ORIGIN,
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "x-kirinuki-protocol": CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
    },
    body: requestBody()
  });
  assert.equal(created.status, 202);
  const jobId = String(json(created).jobId || "");
  assert.match(jobId, /^vod_[a-zA-Z0-9_-]{40}$/u);
  const completed = await waitForCompleted(port, jobId);
  const media = completed.media as Record<string, unknown>;
  const mediaUrl = new URL(String(media.url));
  assert.equal(mediaUrl.origin, `http://127.0.0.1:${port}`);
  assert.equal(JSON.stringify(completed).includes(artifactPath), false);

  const ranged = await localRequest({
    port,
    requestPath: `${mediaUrl.pathname}${mediaUrl.search}`,
    headers: {
      origin: ORIGIN,
      range: "bytes=4-11"
    }
  });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.bytes.toString("ascii"), artifact.subarray(4, 12).toString("ascii"));
  assert.equal(ranged.headers["content-range"], `bytes 4-11/${artifact.length}`);
  assert.equal(ranged.headers["accept-ranges"], "bytes");
  assert.equal(
    ranged.headers.etag,
    `"sha256-${integrity(artifact).hashSha256}"`
  );
  assert.equal(ranged.headers["access-control-allow-origin"], ORIGIN);

  const originlessMediaGet = await localRequest({
    port,
    requestPath: `${mediaUrl.pathname}${mediaUrl.search}`,
    headers: {
      range: "bytes=0-3",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "none"
    }
  });
  assert.equal(originlessMediaGet.status, 403);
  assert.equal(
    (json(originlessMediaGet).error as Record<string, unknown>)?.code,
    "ORIGIN_NOT_ALLOWED"
  );
  assert.equal(originlessMediaGet.headers["access-control-allow-origin"], undefined);

  const invalidRange = await localRequest({
    port,
    requestPath: `${mediaUrl.pathname}${mediaUrl.search}`,
    headers: { origin: ORIGIN, range: "bytes=999-" }
  });
  assert.equal(invalidRange.status, 416);
  assert.equal(invalidRange.headers["content-range"], `bytes */${artifact.length}`);

  const noAccess = await localRequest({
    port,
    requestPath: mediaUrl.pathname,
    headers: { origin: ORIGIN }
  });
  assert.equal(noAccess.status, 404);
  const wrongOrigin = await localRequest({
    port,
    requestPath: `${mediaUrl.pathname}${mediaUrl.search}`,
    headers: { origin: "chrome-extension://not-kirinuki" }
  });
  assert.equal(wrongOrigin.status, 403);
});

test("별도 cache DELETE는 완료된 exact job만 지우며 취소 DELETE와 수동 파일은 건드리지 않는다", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "kirinuki-vod-gateway-purge-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const vodStateDir = path.join(directory, "managed-vod");
  const artifactPath = path.join(
    vodStateDir,
    "jobs",
    "exact",
    "materialized.mp4"
  );
  const otherCache = path.join(
    vodStateDir,
    "jobs",
    "other",
    "materialized.mp4"
  );
  const userSelectedFile = path.join(directory, "user-selected-original.mp4");
  await Promise.all([
    mkdir(path.dirname(artifactPath), { recursive: true }),
    mkdir(path.dirname(otherCache), { recursive: true })
  ]);
  const artifact = Buffer.from("gateway-exact-materialized-cache", "utf8");
  await Promise.all([
    writeFile(artifactPath, artifact),
    writeFile(otherCache, "other-cache"),
    writeFile(userSelectedFile, "user-selected-file")
  ]);
  const materialization = validMaterialization();
  const port = await listenWithOptions(t, {
    env: {
      ...TEST_ENV,
      KIRINUKI_VOD_STATE_DIR: vodStateDir
    },
    materializationRunner: async () => ({
      manifest: materialization,
      artifactPath,
      artifact: integrity(artifact),
      reused: false
    })
  });
  const created = await localRequest({
    port,
    requestPath: "/v1/vod/materializations",
    method: "POST",
    headers: {
      origin: ORIGIN,
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "x-kirinuki-protocol": CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
    },
    body: requestBody()
  });
  const jobId = String(json(created).jobId || "");
  const completed = await waitForCompleted(port, jobId, "vod");
  const mediaUrl = new URL(String(
    (completed.media as Record<string, unknown>).url
  ));
  const exactBody = purgeBody(jobId, materialization);
  const purgePath = `/v1/vod/materializations/${jobId}/cache`;

  const legacyCancel = await localRequest({
    port,
    requestPath: `/v1/vod/materializations/${jobId}`,
    method: "DELETE",
    headers: {
      origin: ORIGIN,
      authorization: `Bearer ${TOKEN}`,
      "x-kirinuki-protocol": CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
    }
  });
  assert.equal(legacyCancel.status, 200);
  assert.equal(json(legacyCancel).state, "completed");
  await access(artifactPath);

  const unauthorized = await localRequest({
    port,
    requestPath: purgePath,
    method: "DELETE",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      "x-kirinuki-protocol": CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA,
      "x-kirinuki-media-access": mediaUrl.searchParams.get("access") || ""
    },
    body: exactBody
  });
  assert.equal(unauthorized.status, 401);
  await access(artifactPath);

  const mismatch = structuredClone(exactBody);
  mismatch.source.sourceVersionId = "d".repeat(64);
  const mismatched = await localRequest({
    port,
    requestPath: purgePath,
    method: "DELETE",
    headers: {
      origin: ORIGIN,
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "x-kirinuki-protocol": CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA,
      "x-kirinuki-media-access": mediaUrl.searchParams.get("access") || ""
    },
    body: mismatch
  });
  assert.equal(mismatched.status, 409, mismatched.bytes.toString("utf8"));
  assert.equal(
    ((json(mismatched).error as Record<string, unknown>) || {}).code,
    "PURGE_IDENTITY_MISMATCH"
  );
  await access(artifactPath);

  const purgeHeaders = {
    origin: ORIGIN,
    authorization: `Bearer ${TOKEN}`,
    "content-type": "application/json",
    "x-kirinuki-protocol": CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA,
    "x-kirinuki-media-access": mediaUrl.searchParams.get("access") || ""
  };
  const purged = await localRequest({
    port,
    requestPath: purgePath,
    method: "DELETE",
    headers: purgeHeaders,
    body: exactBody
  });
  assert.equal(purged.status, 200);
  assert.equal(json(purged).schema, CHZZK_VOD_CACHE_PURGE_RESULT_SCHEMA);
  assert.equal(json(purged).alreadyPurged, false);
  assert.equal(json(purged).releasedBytes, artifact.byteLength);
  await assert.rejects(access(artifactPath), { code: "ENOENT" });
  await Promise.all([access(otherCache), access(userSelectedFile)]);

  const repeated = await localRequest({
    port,
    requestPath: purgePath,
    method: "DELETE",
    headers: purgeHeaders,
    body: exactBody
  });
  assert.equal(repeated.status, 200);
  assert.equal(json(repeated).alreadyPurged, true);
  await Promise.all([access(otherCache), access(userSelectedFile)]);
});

test("별도 session-cache DELETE는 인증된 consumer scope 전체만 지우고 멱등 결과를 돌려준다", async (t) => {
  const directory = await mkdtemp(path.join(
    tmpdir(),
    "kirinuki-vod-gateway-session-purge-"
  ));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const vodStateDir = path.join(directory, "managed-vod");
  const consumerA = "gateway-session-project-a";
  const consumerB = "gateway-session-project-b";
  const materialization = validMaterialization();
  const scopeA = vodConsumerScopeRoot(vodStateDir, consumerA);
  const scopeB = vodConsumerScopeRoot(vodStateDir, consumerB);
  const artifactA = path.join(
    scopeA,
    "jobs",
    "chzzk",
    materialization.materializationId,
    "materialized.mp4"
  );
  const artifactB = path.join(
    scopeB,
    "jobs",
    "chzzk",
    materialization.materializationId,
    "materialized.mp4"
  );
  const segmentA = path.join(
    scopeA,
    "content",
    "chzzk",
    "14252987",
    "segment.ts"
  );
  const oldRootA = path.join(
    scopeA,
    "jobs",
    "soop",
    "a".repeat(32),
    "roots",
    "old-root.mp4"
  );
  await Promise.all([
    mkdir(path.dirname(artifactA), { recursive: true }),
    mkdir(path.dirname(artifactB), { recursive: true }),
    mkdir(path.dirname(segmentA), { recursive: true }),
    mkdir(path.dirname(oldRootA), { recursive: true })
  ]);
  const bytesA = Buffer.from("gateway-session-a-artifact", "utf8");
  const bytesB = Buffer.from("gateway-session-b-artifact", "utf8");
  const segmentBytes = Buffer.from("gateway-session-a-segment", "utf8");
  const oldRootBytes = Buffer.from("gateway-session-a-old-root", "utf8");
  await Promise.all([
    writeFile(artifactA, bytesA),
    writeFile(artifactB, bytesB),
    writeFile(segmentA, segmentBytes),
    writeFile(oldRootA, oldRootBytes)
  ]);
  const port = await listenWithOptions(t, {
    env: {
      ...TEST_ENV,
      KIRINUKI_VOD_STATE_DIR: vodStateDir
    },
    materializationRunner: async ({ consumerId }) => {
      const bytes = consumerId === consumerA ? bytesA : bytesB;
      return {
        manifest: materialization,
        artifactPath: consumerId === consumerA ? artifactA : artifactB,
        artifact: integrity(bytes),
        reused: false
      };
    }
  });
  const createFor = async (consumerId: string) => {
    const created = await localRequest({
      port,
      requestPath: "/v1/vod/materializations",
      method: "POST",
      headers: {
        origin: ORIGIN,
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        "x-kirinuki-protocol": CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
      },
      body: { ...requestBody(), consumerId }
    });
    assert.equal(created.status, 202, created.bytes.toString("utf8"));
    const jobId = String(json(created).jobId || "");
    return {
      jobId,
      completed: await waitForCompleted(port, jobId, "vod")
    };
  };
  const first = await createFor(consumerA);
  const second = await createFor(consumerB);
  const firstMedia = new URL(String(
    (first.completed.media as Record<string, unknown>).url
  ));
  const secondMedia = new URL(String(
    (second.completed.media as Record<string, unknown>).url
  ));
  const purgePath = `/v1/vod/materializations/${first.jobId}/session-cache`;
  const purgeBodyValue = consumerPurgeBody(
    first.jobId,
    consumerA,
    materialization
  );
  const commonHeaders = {
    origin: ORIGIN,
    authorization: `Bearer ${TOKEN}`,
    "content-type": "application/json",
    "x-kirinuki-media-access": firstMedia.searchParams.get("access") || ""
  };

  const wrongProtocol = await localRequest({
    port,
    requestPath: purgePath,
    method: "DELETE",
    headers: {
      ...commonHeaders,
      "x-kirinuki-protocol": CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA
    },
    body: purgeBodyValue
  });
  assert.equal(wrongProtocol.status, 400);
  await access(scopeA);

  const mismatchBody = { ...purgeBodyValue, consumerId: consumerB };
  const mismatch = await localRequest({
    port,
    requestPath: purgePath,
    method: "DELETE",
    headers: {
      ...commonHeaders,
      "x-kirinuki-protocol": CHZZK_VOD_CONSUMER_CACHE_PURGE_REQUEST_SCHEMA
    },
    body: mismatchBody
  });
  assert.equal(mismatch.status, 409, mismatch.bytes.toString("utf8"));
  assert.equal(
    (json(mismatch).error as Record<string, unknown>).code,
    "PURGE_IDENTITY_MISMATCH"
  );
  await access(scopeA);

  const purgeHeaders = {
    ...commonHeaders,
    "x-kirinuki-protocol": CHZZK_VOD_CONSUMER_CACHE_PURGE_REQUEST_SCHEMA
  };
  const purged = await localRequest({
    port,
    requestPath: purgePath,
    method: "DELETE",
    headers: purgeHeaders,
    body: purgeBodyValue
  });
  assert.equal(purged.status, 200, purged.bytes.toString("utf8"));
  assert.equal(
    json(purged).schema,
    CHZZK_VOD_CONSUMER_CACHE_PURGE_RESULT_SCHEMA
  );
  assert.equal(json(purged).consumerId, consumerA);
  assert.equal(json(purged).alreadyPurged, false);
  assert.equal(json(purged).releasedFiles, 3);
  assert.equal(
    json(purged).releasedBytes,
    bytesA.byteLength + segmentBytes.byteLength + oldRootBytes.byteLength
  );
  await assert.rejects(access(scopeA), { code: "ENOENT" });
  await Promise.all([access(scopeB), access(artifactB)]);

  const repeated = await localRequest({
    port,
    requestPath: purgePath,
    method: "DELETE",
    headers: purgeHeaders,
    body: purgeBodyValue
  });
  assert.equal(repeated.status, 200, repeated.bytes.toString("utf8"));
  assert.equal(json(repeated).alreadyPurged, true);
  assert.equal(json(repeated).releasedFiles, json(purged).releasedFiles);
  assert.equal(json(repeated).releasedBytes, json(purged).releasedBytes);

  const surviving = await localRequest({
    port,
    requestPath: `${secondMedia.pathname}${secondMedia.search}`,
    headers: { origin: ORIGIN }
  });
  assert.equal(surviving.status, 200, surviving.bytes.toString("utf8"));
  assert.deepEqual(surviving.bytes, bytesB);
});

test("프로젝트별 VOD 캐시는 물리적으로 격리되어 한쪽 DELETE 뒤 다른 미디어가 유지된다", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "kirinuki-vod-consumer-gateway-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const vodStateDir = path.join(directory, "managed-vod");
  const artifactA = path.join(vodStateDir, "jobs", "scope-a", "materialized.mp4");
  const artifactB = path.join(vodStateDir, "jobs", "scope-b", "materialized.mp4");
  const bytesA = Buffer.from("consumer-a-local-video", "utf8");
  const bytesB = Buffer.from("consumer-b-local-video", "utf8");
  await Promise.all([
    mkdir(path.dirname(artifactA), { recursive: true }),
    mkdir(path.dirname(artifactB), { recursive: true })
  ]);
  await Promise.all([
    writeFile(artifactA, bytesA),
    writeFile(artifactB, bytesB)
  ]);
  const materialization = validMaterialization();
  const port = await listenWithOptions(t, {
    env: {
      ...TEST_ENV,
      KIRINUKI_VOD_STATE_DIR: vodStateDir
    },
    materializationRunner: async ({ consumerId }) => {
      const isA = consumerId === "gateway-project-a";
      const bytes = isA ? bytesA : bytesB;
      return {
        manifest: materialization,
        artifactPath: isA ? artifactA : artifactB,
        artifact: integrity(bytes),
        reused: false
      };
    }
  });
  const createFor = async (consumerId: string) => {
    const created = await localRequest({
      port,
      requestPath: "/v1/vod/materializations",
      method: "POST",
      headers: {
        origin: ORIGIN,
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        "x-kirinuki-protocol": CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
      },
      body: {
        ...requestBody(),
        consumerId
      }
    });
    assert.equal(created.status, 202, created.bytes.toString("utf8"));
    const jobId = String(json(created).jobId || "");
    return { jobId, completed: await waitForCompleted(port, jobId, "vod") };
  };
  const first = await createFor("gateway-project-a");
  const second = await createFor("gateway-project-b");
  assert.notEqual(first.jobId, second.jobId);
  const firstMedia = new URL(String(
    (first.completed.media as Record<string, unknown>).url
  ));
  const secondMedia = new URL(String(
    (second.completed.media as Record<string, unknown>).url
  ));
  assert.notEqual(firstMedia.searchParams.get("access"), secondMedia.searchParams.get("access"));
  const purged = await localRequest({
    port,
    requestPath: `/v1/vod/materializations/${first.jobId}/cache`,
    method: "DELETE",
    headers: {
      origin: ORIGIN,
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "x-kirinuki-protocol": CHZZK_VOD_CACHE_PURGE_REQUEST_SCHEMA,
      "x-kirinuki-media-access": firstMedia.searchParams.get("access") || ""
    },
    body: purgeBody(first.jobId, materialization)
  });
  assert.equal(purged.status, 200, purged.bytes.toString("utf8"));
  await assert.rejects(access(artifactA), { code: "ENOENT" });
  await access(artifactB);
  const surviving = await localRequest({
    port,
    requestPath: `${secondMedia.pathname}${secondMedia.search}`,
    headers: { origin: ORIGIN }
  });
  assert.equal(surviving.status, 200, surviving.bytes.toString("utf8"));
  assert.deepEqual(surviving.bytes, bytesB);
});

test("플랫폼 중립 VOD 경로가 CHZZK와 YouTube·SOOP materializer를 자동 분기한다", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "kirinuki-vod-dispatch-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifactPath = path.join(directory, "artifact.mp4");
  await writeFile(artifactPath, "platform-dispatch-local-mp4");
  const platformArtifact = integrity("platform-dispatch-local-mp4");
  const chzzkCalls: string[] = [];
  const externalCalls: string[] = [];
  const externalClockIdentities: unknown[] = [];
  const chzzkMaterializer: ChzzkVodMaterializerImplementation = async (request) => {
    chzzkCalls.push(request.sourceUrl);
    request.onProgress?.({
      phase: "downloading",
      completedSegments: 1,
      totalSegments: 1,
      completedBytes: 128
    });
    return {
      manifest: validMaterialization({
        clips: request.clips,
        ...(request.editableRanges
          ? { editableRanges: request.editableRanges }
          : {})
      }),
      receipt: { artifact: platformArtifact },
      artifactPath,
      reused: false
    };
  };
  const externalMaterializer: ExternalVodMaterializerImplementation = async (request) => {
    externalCalls.push(request.sourceUrl);
    externalClockIdentities.push(request.sourceClockIdentity ?? null);
    request.onProgress?.({
      phase: "downloading",
      completedSections: 1,
      totalSections: 1,
      completedBytes: 256
    });
    const platform = request.sourceUrl.includes("youtube.com")
      ? "YOUTUBE"
      : "SOOP";
    const contentId = platform === "YOUTUBE"
      ? "abcdefghijk"
      : "123456789";
    return {
      manifest: validMaterialization({
        platform,
        contentId,
        clips: request.clips,
        ...(request.editableRanges
          ? { editableRanges: request.editableRanges }
          : {})
      }),
      receipt: { artifact: platformArtifact },
      artifactPath,
      reused: false
    };
  };
  const port = await listenWithOptions(t, {
    chzzkMaterializer,
    externalMaterializer
  });
  const cases = [
    {
      sourceUrl: "https://chzzk.naver.com/video/14252987",
      platform: "CHZZK"
    },
    {
      sourceUrl: "https://youtu.be/abcdefghijk?t=30",
      platform: "YOUTUBE"
    },
    {
      sourceUrl: "https://vod.sooplive.com/PLAYER/STATION/123456789",
      platform: "SOOP"
    }
  ] as const;
  for (const entry of cases) {
    const created = await localRequest({
      port,
      requestPath: "/v1/vod/materializations",
      method: "POST",
      headers: {
        origin: ORIGIN,
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        "x-kirinuki-protocol": CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
      },
      body: requestBody(entry.sourceUrl)
    });
    assert.equal(created.status, 202);
    assert.doesNotMatch(String(json(created).message), /CHZZK/u);
    const completed = await waitForCompleted(
      port,
      String(json(created).jobId || ""),
      "vod"
    );
    assert.equal(
      ((completed.materialization as Record<string, unknown>).source as
        Record<string, unknown>).platform,
      entry.platform
    );
    const mediaUrl = new URL(String(
      (completed.media as Record<string, unknown>).url
    ));
    assert.match(mediaUrl.pathname, /^\/v1\/vod\/media\/vod_/u);
  }
  assert.deepEqual(chzzkCalls, [
    "https://chzzk.naver.com/video/14252987"
  ]);
  assert.deepEqual(externalCalls, [
    "https://www.youtube.com/watch?v=abcdefghijk",
    "https://vod.sooplive.com/player/123456789"
  ]);
  assert.deepEqual(externalClockIdentities, [
    null,
    SOOP_SOURCE_CLOCK_IDENTITY
  ]);

  const capability = await localRequest({
    port,
    requestPath: "/v1/captions",
    headers: {
      origin: ORIGIN,
      authorization: `Bearer ${TOKEN}`
    }
  });
  assert.equal(capability.status, 200);
  const vodCapability = json(capability).vodMaterialization as
    Record<string, unknown>;
  assert.equal(vodCapability.source, "public-vod");
  assert.deepEqual(vodCapability.platforms, ["CHZZK", "YOUTUBE", "SOOP"]);
  assert.equal(vodCapability.handleMs, 10_000);
  assert.equal(vodCapability.incremental, true);
  assert.equal(vodCapability.incrementMs, 30_000);
  assert.equal(vodCapability.loginOrCookies, false);
});

test("공개 CHZZK live-rewind HLS는 typed VOD_UNAVAILABLE에서만 external 취득기로 전환한다", async () => {
  const artifact = integrity("chzzk-public-hls-fallback");
  const externalCalls: ExternalVodMaterializationRequest[] = [];
  const progressMessages: string[] = [];
  const runner = createPlatformMaterializationRunner({
    chzzkMaterializer: async () => {
      throw new ChzzkVodMaterializationError(
        "현재 공개 원본 조각을 받을 수 있는 CHZZK VOD가 아닙니다.",
        "VOD_UNAVAILABLE"
      );
    },
    externalMaterializer: async (input) => {
      externalCalls.push(input);
      input.onProgress?.({
        phase: "downloading",
        completedSections: 1,
        totalSections: 2,
        completedBytes: 1024
      });
      return {
        manifest: validMaterialization({
          platform: "CHZZK",
          contentId: "14514980",
          clips: input.clips,
          ...(input.editableRanges
            ? { editableRanges: input.editableRanges }
            : {})
        }),
        receipt: { artifact },
        artifactPath: "/safe/local/chzzk-public-hls.mp4",
        reused: false
      };
    }
  });
  const result = await runner({
    consumerId: "chzzk-hls-fallback-project",
    sourceUrl: "https://chzzk.naver.com/video/14514980",
    clips: [{ id: "clip-a", startMs: 30_000, endMs: 32_000 }],
    editableRanges: [{ id: "clip-a", startMs: 20_000, endMs: 42_000 }],
    handleMs: 10_000,
    signal: new AbortController().signal,
    onProgress: (progress) => progressMessages.push(progress.message)
  });
  assert.equal(externalCalls.length, 1);
  assert.equal(externalCalls[0]?.sourceUrl, "https://chzzk.naver.com/video/14514980");
  assert.deepEqual(externalCalls[0]?.editableRanges, [
    { id: "clip-a", startMs: 20_000, endMs: 42_000 }
  ]);
  assert.deepEqual(result.artifact, artifact);
  assert(progressMessages.some((message) => /VOD|구간|조각/u.test(message)));
});

test("CHZZK native 성공과 VOD_UNAVAILABLE 이외 오류는 external fallback을 호출하지 않는다", async () => {
  const artifact = integrity("chzzk-native-only");
  let externalCallCount = 0;
  const nativeRunner = createPlatformMaterializationRunner({
    chzzkMaterializer: async (input) => ({
      manifest: validMaterialization({ clips: input.clips }),
      receipt: { artifact },
      artifactPath: "/safe/local/chzzk-native.mp4",
      reused: true
    }),
    externalMaterializer: async () => {
      externalCallCount += 1;
      throw new Error("호출되면 안 됩니다.");
    }
  });
  await nativeRunner({
    consumerId: "chzzk-native-project",
    sourceUrl: "https://chzzk.naver.com/video/14252987",
    clips: [{ id: "clip-a", startMs: 1_000, endMs: 2_000 }],
    handleMs: 10_000,
    signal: new AbortController().signal,
    onProgress: () => undefined
  });
  assert.equal(externalCallCount, 0);

  const failedRunner = createPlatformMaterializationRunner({
    chzzkMaterializer: async () => {
      throw new ChzzkVodMaterializationError(
        "CHZZK 메타데이터 요청 실패",
        "METADATA_REQUEST_FAILED"
      );
    },
    externalMaterializer: async () => {
      externalCallCount += 1;
      throw new Error("호출되면 안 됩니다.");
    }
  });
  await assert.rejects(
    failedRunner({
      consumerId: "chzzk-native-error-project",
      sourceUrl: "https://chzzk.naver.com/video/14252987",
      clips: [{ id: "clip-a", startMs: 1_000, endMs: 2_000 }],
      handleMs: 10_000,
      signal: new AbortController().signal,
      onProgress: () => undefined
    }),
    (error: unknown) => (
      error instanceof ChzzkVodMaterializationError
      && error.code === "METADATA_REQUEST_FAILED"
    )
  );
  assert.equal(externalCallCount, 0);
});

test("외부 VOD 도구 누락은 비밀 경로 없이 안전한 code와 설치 안내를 상태로 돌려준다", async (t) => {
  const port = await listenWithOptions(t, {
    externalMaterializer: async () => {
      throw new ExternalVodMaterializationError(
        "yt-dlp 실행 파일을 찾을 수 없습니다. 설치 후 다시 시도해 주세요.",
        "TOOL_NOT_INSTALLED"
      );
    }
  });
  const created = await localRequest({
    port,
    requestPath: "/v1/vod/materializations",
    method: "POST",
    headers: {
      origin: ORIGIN,
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "x-kirinuki-protocol": CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
    },
    body: requestBody(`https://youtu.be/${"abcdefghijk"}`)
  });
  assert.equal(created.status, 202);
  const jobId = String(json(created).jobId || "");
  let failed: Record<string, unknown> | undefined;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await localRequest({
      port,
      requestPath: `/v1/vod/materializations/${jobId}`,
      headers: {
        origin: ORIGIN,
        authorization: `Bearer ${TOKEN}`,
        "x-kirinuki-protocol": CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
      }
    });
    const payload = json(result);
    if (payload.state === "failed") {
      failed = payload;
      break;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(failed);
  const error = failed.error as Record<string, unknown>;
  assert.equal(error.code, "TOOL_NOT_INSTALLED");
  assert.match(String(error.message), /yt-dlp.*설치/u);
  assert.doesNotMatch(JSON.stringify(failed), /sensitive|stderr|ENOENT/iu);
});

test("VOD 작업 API는 잘못된 JSON과 제한 초과 본문을 400·413으로 구분한다", async (t) => {
  const runner: ChzzkVodMaterializationRunner = async () => {
    throw new Error("유효하지 않은 요청에서는 runner가 호출되면 안 됩니다.");
  };
  const port = await listen(t, runner);
  const headers = {
    origin: ORIGIN,
    authorization: `Bearer ${TOKEN}`,
    "content-type": "application/json",
    "x-kirinuki-protocol": CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
  };
  const malformed = await localRequest({
    port,
    requestPath: "/v1/chzzk-vod/materializations",
    method: "POST",
    headers,
    body: "{not-json"
  });
  assert.equal(malformed.status, 400);
  assert.equal(
    (json(malformed).error as Record<string, unknown>).code,
    "INVALID_JSON"
  );

  const oversized = await localRequest({
    port,
    requestPath: "/v1/chzzk-vod/materializations",
    method: "POST",
    headers,
    body: JSON.stringify({ padding: "x".repeat(MAX_CHZZK_VOD_REQUEST_BYTES) })
  });
  assert.equal(oversized.status, 413);
  assert.equal(
    (json(oversized).error as Record<string, unknown>).code,
    "REQUEST_TOO_LARGE"
  );
});

test("Range 전송을 중간 취소해도 stream을 정리하고 다음 요청을 처리한다", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "kirinuki-vod-abort-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifactPath = path.join(directory, "large.mp4");
  const largeArtifact = Buffer.alloc(8 * 1024 * 1024, 0x5a);
  await writeFile(artifactPath, largeArtifact);
  const port = await listen(t, async ({ clips, editableRanges }) => ({
    manifest: validMaterialization({
      clips,
      ...(editableRanges ? { editableRanges } : {})
    }),
    artifactPath,
    artifact: integrity(largeArtifact),
    reused: false
  }));
  const created = await localRequest({
    port,
    requestPath: "/v1/chzzk-vod/materializations",
    method: "POST",
    headers: {
      origin: ORIGIN,
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "x-kirinuki-protocol": CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
    },
    body: requestBody()
  });
  const completed = await waitForCompleted(port, String(json(created).jobId));
  const mediaUrl = new URL(String((completed.media as Record<string, unknown>).url));

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      error ? reject(error) : resolve();
    };
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      path: `${mediaUrl.pathname}${mediaUrl.search}`,
      headers: { origin: ORIGIN, range: "bytes=0-" }
    }, (response) => {
      response.once("data", () => {
        response.destroy();
        request.destroy();
        finish();
      });
      response.once("error", () => finish());
    });
    request.once("error", (error) => {
      if (!settled) {
        finish(error);
      }
    });
    request.end();
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  const head = await localRequest({
    port,
    requestPath: `${mediaUrl.pathname}${mediaUrl.search}`,
    method: "HEAD",
    headers: { origin: ORIGIN }
  });
  assert.equal(head.status, 200);
  assert.equal(head.headers["content-length"], String(8 * 1024 * 1024));
});

test("응답 시작 뒤 동일 inode의 뒤 청크가 변조되면 변조 청크 전송 없이 연결과 handler를 끝낸다", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "kirinuki-vod-stream-race-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifactPath = path.join(directory, "artifact.mp4");
  const artifact = Buffer.alloc(12 * VOD_ARTIFACT_CHUNK_BYTES, 0x41);
  await writeFile(artifactPath, artifact);
  const runtime = createCaptionGatewayServer({
    env: TEST_ENV,
    materializationRunner: async ({ clips, editableRanges }) => ({
      manifest: validMaterialization({
        clips,
        ...(editableRanges ? { editableRanges } : {})
      }),
      artifactPath,
      artifact: integrity(artifact),
      reused: false
    })
  });
  await new Promise<void>((resolve, reject) => {
    runtime.server.once("error", reject);
    runtime.server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => runtime.shutdown({ graceMs: 20, deadlineMs: 1_000 }));
  const address = runtime.server.address();
  assert.ok(address && typeof address !== "string");
  const port = (address as AddressInfo).port;
  const created = await localRequest({
    port,
    requestPath: "/v1/vod/materializations",
    method: "POST",
    headers: {
      origin: ORIGIN,
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "x-kirinuki-protocol": CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
    },
    body: requestBody()
  });
  const completed = await waitForCompleted(
    port,
    String(json(created).jobId),
    "vod"
  );
  const mediaUrl = new URL(String(
    (completed.media as Record<string, unknown>).url
  ));
  const before = await lstat(artifactPath, { bigint: true });

  const streamed = await new Promise<{
    bytes: Buffer;
    completed: boolean;
    etag: string;
  }>((resolve, reject) => {
    let responseSeen = false;
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      path: `${mediaUrl.pathname}${mediaUrl.search}`,
      headers: { origin: ORIGIN }
    }, (response) => {
      responseSeen = true;
      response.pause();
      const chunks: Buffer[] = [];
      let settled = false;
      const finish = (completedNormally: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve({
          bytes: Buffer.concat(chunks),
          completed: completedNormally,
          etag: String(response.headers.etag || "")
        });
      };
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.once("end", () => finish(true));
      response.once("aborted", () => finish(false));
      response.once("error", () => finish(false));
      void (async () => {
        const handle = await open(artifactPath, "r+");
        try {
          const maliciousChunk = Buffer.alloc(VOD_ARTIFACT_CHUNK_BYTES, 0x5a);
          await handle.write(
            maliciousChunk,
            0,
            maliciousChunk.byteLength,
            artifact.byteLength - maliciousChunk.byteLength
          );
        } finally {
          await handle.close();
        }
        const after = await lstat(artifactPath, { bigint: true });
        assert.equal(after.ino, before.ino);
        response.resume();
      })().catch(reject);
    });
    request.once("error", (error) => {
      if (!responseSeen) {
        reject(error);
      }
    });
    request.end();
  });
  assert.equal(streamed.completed, false);
  assert.equal(
    streamed.etag,
    `"sha256-${integrity(artifact).hashSha256}"`
  );
  assert.ok(streamed.bytes.byteLength < artifact.byteLength);
  assert.equal(streamed.bytes.includes(Buffer.from("ZZZZ", "ascii")), false);
  for (
    let attempt = 0;
    attempt < 50 && runtime.activeHandlerCount > 0;
    attempt += 1
  ) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(runtime.activeHandlerCount, 0);

  const invalidated = await localRequest({
    port,
    requestPath: `${mediaUrl.pathname}${mediaUrl.search}`,
    headers: { origin: ORIGIN }
  });
  assert.equal(invalidated.status, 404);
});

test("YouTube·SOOP runner는 resume와 hot-load 범위를 외부 materializer에 그대로 전달한다", async () => {
  const artifact = integrity("external-resume-artifact");
  const calls: ExternalVodMaterializationRequest[] = [];
  const runner = createPlatformMaterializationRunner({
    externalMaterializer: async (input) => {
      calls.push(input);
      return {
        manifest: validMaterialization({
          platform: "YOUTUBE",
          contentId: "abcdefghijk",
          clips: input.clips,
          ...(input.editableRanges
            ? { editableRanges: input.editableRanges }
            : {})
        }),
        receipt: { artifact },
        artifactPath: "/safe/local/external.mp4",
        reused: true
      };
    }
  });
  const resume = {
    materializationId: "a".repeat(32),
    planFingerprint: `${"a".repeat(32)}${"b".repeat(32)}`,
    contentId: "abcdefghijk"
  };
  const result = await runner({
    consumerId: "gateway-runner-project",
    sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    clips: [{ id: "clip-a", startMs: 1_000, endMs: 2_000 }],
    handleMs: 10_000,
    resume,
    signal: new AbortController().signal,
    onProgress: () => undefined
  });
  assert.deepEqual(calls[0]?.resume, resume);
  assert.deepEqual(result.artifact, artifact);

  const base = {
    materializationId: "c".repeat(32),
    planFingerprint: `${"c".repeat(32)}${"d".repeat(32)}`,
    contentId: "abcdefghijk"
  };
  await runner({
    consumerId: "gateway-runner-project",
    sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    clips: [{ id: "clip-a", startMs: 1_000, endMs: 2_000 }],
    editableRanges: [{ id: "clip-a", startMs: 0, endMs: 42_000 }],
    handleMs: 10_000,
    base,
    signal: new AbortController().signal,
    onProgress: () => undefined
  });
  assert.deepEqual(calls[1]?.editableRanges, [
    { id: "clip-a", startMs: 0, endMs: 42_000 }
  ]);
  assert.deepEqual(calls[1]?.base, base);
});

test("gateway는 변조된 완료 artifact를 failed 처리하고 같은 요청의 runner를 다시 호출한다", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "kirinuki-vod-integrity-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifactPath = path.join(directory, "artifact.mp4");
  const original = Buffer.from("original-artifact", "utf8");
  await writeFile(artifactPath, original);
  let calls = 0;
  const port = await listen(t, async ({ clips, editableRanges }) => {
    calls += 1;
    return {
      manifest: validMaterialization({
        clips,
        ...(editableRanges ? { editableRanges } : {})
      }),
      artifactPath,
      artifact: integrity(original),
      reused: calls > 1
    };
  });
  const post = () => localRequest({
    port,
    requestPath: "/v1/vod/materializations",
    method: "POST",
    headers: {
      origin: ORIGIN,
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "x-kirinuki-protocol": CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
    },
    body: requestBody()
  });
  const created = await post();
  const jobId = String(json(created).jobId || "");
  const completed = await waitForCompleted(port, jobId, "vod");
  const mediaUrl = new URL(String(
    (completed.media as Record<string, unknown>).url
  ));
  await writeFile(artifactPath, Buffer.from("tampered-artifact", "utf8"));
  const invalid = await localRequest({
    port,
    requestPath: `/v1/vod/materializations/${jobId}`,
    headers: {
      origin: ORIGIN,
      authorization: `Bearer ${TOKEN}`,
      "x-kirinuki-protocol": CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
    }
  });
  assert.equal(json(invalid).state, "failed");
  assert.equal(
    ((json(invalid).error as Record<string, unknown>) || {}).code,
    "MEDIA_VERIFICATION_FAILED"
  );
  const missingMedia = await localRequest({
    port,
    requestPath: `${mediaUrl.pathname}${mediaUrl.search}`,
    headers: { origin: ORIGIN }
  });
  assert.equal(missingMedia.status, 404);

  await writeFile(artifactPath, original);
  const recreated = await post();
  assert.equal(String(json(recreated).jobId), jobId);
  await waitForCompleted(port, jobId, "vod");
  assert.equal(calls, 2);
});

test("shutdown 시작 뒤 기존 socket에서 완성된 pipelined 요청은 새 작업 없이 거절하고 모든 handler를 정리한다", async (t) => {
  let pipelineCalls = 0;
  let abortObserved = false;
  let markStarted!: () => void;
  let releasePipeline!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const runtime = createCaptionGatewayServer({
    env: TEST_ENV,
    pipelineRunner: async (_body, { signal }) => {
      pipelineCalls += 1;
      markStarted();
      return await new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          abortObserved = true;
        }, { once: true });
        releasePipeline = () => reject(signal?.reason);
      });
    }
  });
  await new Promise<void>((resolve, reject) => {
    runtime.server.once("error", reject);
    runtime.server.listen(0, "127.0.0.1", resolve);
  });
  const address = runtime.server.address();
  assert.ok(address && typeof address !== "string");
  const socket = net.createConnection({
    host: "127.0.0.1",
    port: (address as AddressInfo).port
  });
  let released = false;
  t.after(async () => {
    if (!released && releasePipeline) {
      released = true;
      releasePipeline();
    }
    socket.destroy();
    await runtime.shutdown({ graceMs: 20, deadlineMs: 1_000 }).catch(() => undefined);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  let rawResponse = "";
  const socketClosed = new Promise<void>((resolve) => {
    socket.on("data", (chunk) => {
      rawResponse += Buffer.from(chunk).toString("latin1");
    });
    socket.once("close", () => resolve());
  });
  const firstRequest = [
    "POST /v1/captions HTTP/1.1",
    "Host: 127.0.0.1",
    `Origin: ${ORIGIN}`,
    `Authorization: Bearer ${TOKEN}`,
    "Content-Type: application/json",
    "Content-Length: 2",
    "Connection: keep-alive",
    "",
    "{}"
  ].join("\r\n");
  const partialSecondRequest = [
    "POST /v1/captions HTTP/1.1",
    "Host: 127.0.0.1",
    `Origin: ${ORIGIN}`,
    `Authorization: Bearer ${TOKEN}`,
    "Content-Type: application/json",
    "Content-Length: 2",
    "Connection: close"
  ].join("\r\n");
  socket.write(`${firstRequest}${partialSecondRequest}`);
  await started;

  const shutdownPromise = runtime.shutdown({
    graceMs: 500,
    // The full suite intentionally runs many process/socket tests in parallel.
    // Keep the production 500 ms force-close assertion, but leave enough wall
    // time for an overloaded CI event loop to dispatch the resulting close
    // callbacks before the fail-closed deadline wins the race.
    deadlineMs: 10_000
  });
  socket.write("\r\n\r\n{}");
  for (
    let attempt = 0;
    attempt < 50 && runtime.activeHandlerCount < 2;
    attempt += 1
  ) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(runtime.activeHandlerCount, 2);
  assert.equal(abortObserved, true);
  released = true;
  releasePipeline();
  await shutdownPromise;
  await socketClosed;

  assert.equal(pipelineCalls, 1);
  assert.equal(runtime.activeHandlerCount, 0);
  assert.doesNotMatch(rawResponse, /HTTP\/1\.1 200/u);
  assert.ok((rawResponse.match(/HTTP\/1\.1 503/gu) || []).length >= 1);
});

test("shutdown은 job abort를 먼저 전달하고 열린 소켓이 있어도 deadline 안에 끝난다", async () => {
  assert.ok(
    DEFAULT_GATEWAY_SHUTDOWN_DEADLINE_MS
      >= EXTERNAL_PROCESS_KILL_GRACE_MS + 5_000
  );
  let runnerSignal: AbortSignal | null = null;
  let abortObserved = false;
  let captionAbortObserved = false;
  let markCaptionStarted!: () => void;
  const captionStarted = new Promise<void>((resolve) => {
    markCaptionStarted = resolve;
  });
  const runtime = createCaptionGatewayServer({
    env: TEST_ENV,
    pipelineRunner: async (_body, { signal }) => {
      markCaptionStarted();
      return await new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          captionAbortObserved = true;
          reject(signal.reason);
        }, { once: true });
      });
    },
    materializationRunner: async ({ signal }) => {
      runnerSignal = signal;
      return await new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          abortObserved = true;
          reject(signal.reason);
        }, { once: true });
      });
    }
  });
  await new Promise<void>((resolve, reject) => {
    runtime.server.once("error", reject);
    runtime.server.listen(0, "127.0.0.1", resolve);
  });
  const address = runtime.server.address();
  assert.ok(address && typeof address !== "string");
  const port = (address as AddressInfo).port;
  await localRequest({
    port,
    requestPath: "/v1/vod/materializations",
    method: "POST",
    headers: {
      origin: ORIGIN,
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "x-kirinuki-protocol": CHZZK_VOD_MATERIALIZATION_REQUEST_SCHEMA
    },
    body: requestBody()
  });
  assert.ok(runnerSignal);
  const hangingCaption = localRequest({
    port,
    requestPath: "/v1/captions",
    method: "POST",
    headers: {
      origin: ORIGIN,
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json"
    },
    body: {}
  }).catch(() => null);
  await captionStarted;
  const idleSocket = net.createConnection({ host: "127.0.0.1", port });
  await new Promise<void>((resolve, reject) => {
    idleSocket.once("connect", resolve);
    idleSocket.once("error", reject);
  });
  const startedAt = Date.now();
  await runtime.shutdown({ graceMs: 10, deadlineMs: 250 });
  await hangingCaption;
  assert.equal(abortObserved, true);
  assert.equal(captionAbortObserved, true);
  assert.equal(runtime.server.listening, false);
  if (!idleSocket.destroyed) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 200);
      idleSocket.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  assert.equal(idleSocket.destroyed, true);
  assert.ok(Date.now() - startedAt < 1_000);
});
