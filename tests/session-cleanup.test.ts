import assert from "node:assert/strict";
import test from "node:test";

import {
  isSafeSessionCleanupMediaUrl,
  sessionCleanupMarkerMatchesMaterializedBinding
} from "../src/lib/session-cleanup.js";

const ENDPOINT = "http://127.0.0.1:4319/v1/captions";
const MEDIA_URL =
  "http://127.0.0.1:4319/v1/vod/media/job_0123456789abcdef?access=ephemeral";
const PLAN_FINGERPRINT = `${"a".repeat(32)}${"b".repeat(32)}`;

function materialization() {
  return {
    schema: "chzzk-kirinuki-chzzk-vod-materialization/v2",
    materializationId: PLAN_FINGERPRINT.slice(0, 32),
    planFingerprint: PLAN_FINGERPRINT,
    source: {
      platform: "CHZZK",
      contentType: "vod",
      contentId: "14252987",
      sourceVersionId: "c".repeat(64)
    },
    sourceDurationMs: 200_000,
    handleMs: 10_000,
    mediaDurationMs: 30_000,
    windows: [{
      id: "window-1",
      editableSourceStartMs: 60_000,
      editableSourceEndMs: 90_000,
      fetchedSourceStartMs: 60_000,
      fetchedSourceEndMs: 90_000,
      mediaStartMs: 0,
      mediaEndMs: 30_000,
      clipIds: ["clip-a"]
    }],
    clipRanges: [{
      clipId: "clip-a",
      sourceStartMs: 70_000,
      sourceEndMs: 80_000,
      editableSourceStartMs: 60_000,
      editableSourceEndMs: 90_000
    }],
    preparedAt: "2026-08-10T00:00:00.000Z",
    localOnly: true
  };
}

function marker(overrides: Record<string, unknown> = {}) {
  return {
    mediaUrl: MEDIA_URL,
    platform: "CHZZK",
    contentId: "14252987",
    sourceVersionId: "c".repeat(64),
    materializationId: PLAN_FINGERPRINT.slice(0, 32),
    planFingerprint: PLAN_FINGERPRINT,
    ...overrides
  };
}

function mediaAsset(overrides: Record<string, unknown> = {}) {
  return {
    mediaMode: "source-vod-selection",
    materialization: materialization(),
    sessionCleanupMediaUrl: MEDIA_URL,
    ...overrides
  };
}

test("삭제 완료 표식은 현재 loopback URL과 materialization 전체가 같을 때만 일치한다", () => {
  assert.equal(
    sessionCleanupMarkerMatchesMaterializedBinding(
      marker(),
      mediaAsset(),
      ENDPOINT
    ),
    true
  );

  for (const mismatch of [
    marker({ mediaUrl: MEDIA_URL.replace("ephemeral", "other") }),
    marker({ platform: "SOOP" }),
    marker({ contentId: "other" }),
    marker({ sourceVersionId: "d".repeat(64) }),
    marker({ materializationId: "d".repeat(32) }),
    marker({ planFingerprint: "e".repeat(64) })
  ]) {
    assert.equal(
      sessionCleanupMarkerMatchesMaterializedBinding(
        mismatch,
        mediaAsset(),
        ENDPOINT
      ),
      false
    );
  }
});

test("수동 파일·다른 포트·추가 query·legacy materialization은 정리 대상으로 인정하지 않는다", () => {
  assert.equal(
    sessionCleanupMarkerMatchesMaterializedBinding(
      marker(),
      mediaAsset({ mediaMode: "manual-file" }),
      ENDPOINT
    ),
    false
  );
  assert.equal(
    sessionCleanupMarkerMatchesMaterializedBinding(
      marker({
        mediaUrl: MEDIA_URL.replace(":4319", ":4320")
      }),
      mediaAsset({
        sessionCleanupMediaUrl: MEDIA_URL.replace(":4319", ":4320")
      }),
      ENDPOINT
    ),
    false
  );
  const extraQueryUrl = `${MEDIA_URL}&extra=1`;
  assert.equal(
    sessionCleanupMarkerMatchesMaterializedBinding(
      marker({ mediaUrl: extraQueryUrl }),
      mediaAsset({ sessionCleanupMediaUrl: extraQueryUrl }),
      ENDPOINT
    ),
    false
  );
  assert.equal(
    sessionCleanupMarkerMatchesMaterializedBinding(
      marker(),
      mediaAsset({
        materialization: {
          ...materialization(),
          schema: "chzzk-kirinuki-chzzk-vod-materialization/v1"
        }
      }),
      ENDPOINT
    ),
    false
  );
});

test("marker parser와 exact matcher가 localhost loopback 계약을 동일하게 인정한다", () => {
  const localhostUrl = MEDIA_URL.replace("127.0.0.1", "localhost");
  assert.equal(
    isSafeSessionCleanupMediaUrl(localhostUrl, ENDPOINT),
    true
  );
  assert.equal(
    sessionCleanupMarkerMatchesMaterializedBinding(
      marker({ mediaUrl: localhostUrl }),
      mediaAsset({ sessionCleanupMediaUrl: localhostUrl }),
      ENDPOINT
    ),
    true
  );
});
