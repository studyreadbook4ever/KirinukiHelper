#!/usr/bin/env node

/**
 * Opt-in, network-backed liveness gate for the external VOD path.
 *
 * It deliberately creates a brand-new state directory and consumer identity,
 * so no persisted root, receipt, browser profile or HTTP cache can satisfy the
 * request. The fixture is long enough to expose the former 92% double-encode.
 */

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  materializeExternalVod,
  type ExternalVodMaterializationProgress
} from "./external-vod-materializer.js";
import {
  readVodRuntimeConfig,
  resolveVodRuntimePaths
} from "./local-vod-runtime-core.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceUrl = "https://chzzk.naver.com/video/14514980";
const maximumMuxMs = 15_000;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

if (process.env.KIRINUKI_EXTERNAL_VOD_LIVENESS_SMOKE !== "1") {
  throw new Error(
    "실제 공개 VOD 네트워크 테스트입니다. "
      + "KIRINUKI_EXTERNAL_VOD_LIVENESS_SMOKE=1을 명시해 주세요."
  );
}

const paths = resolveVodRuntimePaths({
  env: process.env,
  homeDir: os.homedir(),
  packageRoot
});
const config = await readVodRuntimeConfig(paths, { required: true });
assert(config, "검증된 로컬 VOD runtime 설정이 없습니다.");

const stateDir = await mkdtemp(
  path.join(os.tmpdir(), "kirinuki-external-vod-liveness-")
);
const startedAt = performance.now();
const timeline: Array<{
  phase: ExternalVodMaterializationProgress["phase"];
  elapsedMs: number;
}> = [];
let previousPhase = "";
let muxStartedAt: number | undefined;

try {
  const result = await materializeExternalVod({
    consumerId: `fresh-liveness-${randomUUID()}`,
    sourceUrl,
    clips: [{ id: "fresh-clip", startMs: 20_000, endMs: 25_000 }],
    handleMs: 10_000,
    stateDir,
    onProgress(progress) {
      if (progress.phase === previousPhase) {
        return;
      }
      previousPhase = progress.phase;
      const elapsedMs = Math.round(performance.now() - startedAt);
      timeline.push({ phase: progress.phase, elapsedMs });
      if (progress.phase === "muxing") {
        muxStartedAt = performance.now();
      }
    }
  }, {
    ytDlpBinary: config.ytDlp.path,
    pythonBinary: config.python.path,
    nodeBinary: config.node.path,
    ffmpegBinary: config.ffmpeg.path,
    ffprobeBinary: config.ffprobe.path,
    processEnv: process.env
  });
  const completedAt = performance.now();
  assert(result.reused === false, "fresh state가 기존 materialization을 재사용했습니다.");
  assert(muxStartedAt !== undefined, "최종 muxing 단계가 관찰되지 않았습니다.");
  const muxMs = Math.round(completedAt - muxStartedAt);
  assert(
    result.manifest.mediaDurationMs === 25_000,
    `fresh 결과 길이가 25000ms가 아닙니다: ${result.manifest.mediaDurationMs}`
  );
  assert(
    muxMs <= maximumMuxMs,
    `최종 mux가 ${muxMs}ms 걸려 ${maximumMuxMs}ms liveness 상한을 넘었습니다.`
  );
  process.stdout.write(`${JSON.stringify({
    ok: true,
    cache: "brand-new-state-and-consumer",
    sourceUrl,
    selectedRangeMs: [20_000, 25_000],
    expectedMaterializedDurationMs: 25_000,
    actualMaterializedDurationMs: result.manifest.mediaDurationMs,
    muxMs,
    totalMs: Math.round(completedAt - startedAt),
    timeline
  }, null, 2)}\n`);
} finally {
  await rm(stateDir, { recursive: true, force: true });
}
