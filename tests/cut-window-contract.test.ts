import assert from "node:assert/strict";
import test from "node:test";

import {
  CUT_WINDOW_URL,
  isExactCutWindowUrl,
  normalizeCutWindowPlayerActionEnvelope,
  normalizeTrustedCutShortcutMessage
} from "../src/desktop/cut-window-contract.js";
import {
  STREAMING_BRIDGE_PROTOCOL,
  STREAMING_BRIDGE_REQUEST
} from "../src/web/streaming-bridge-protocol.js";

function snapshotRequest() {
  return {
    protocol: STREAMING_BRIDGE_PROTOCOL,
    type: STREAMING_BRIDGE_REQUEST,
    requestId: "request-0001",
    generation: 3,
    source: {
      platform: "YOUTUBE",
      sessionId: "youtube:vod:dQw4w9WgXcQ"
    },
    action: "snapshot"
  };
}

test("player envelope는 exact document·transport·bridge request만 받는다", () => {
  const valid = {
    type: "request",
    transportEpoch: 2,
    documentGeneration: 7,
    request: snapshotRequest()
  };
  assert.deepEqual(normalizeCutWindowPlayerActionEnvelope(valid), valid);
  assert.deepEqual(normalizeCutWindowPlayerActionEnvelope({
    type: "invalidate",
    transportEpoch: 3
  }), {
    type: "invalidate",
    transportEpoch: 3
  });
  for (const invalid of [
    { ...valid, extra: true },
    { ...valid, transportEpoch: 0 },
    { ...valid, documentGeneration: 0 },
    { ...valid, request: { ...snapshotRequest(), extra: true } },
    { type: "invalidate", transportEpoch: 1, documentGeneration: 1 }
  ]) {
    assert.equal(normalizeCutWindowPlayerActionEnvelope(invalid), null);
  }
});

test("trusted shortcut message는 플랫폼 content와 네 세대를 exact 검증한다", () => {
  const valid = {
    key: "A",
    platform: "YOUTUBE",
    contentId: "dQw4w9WgXcQ",
    windowGeneration: 2,
    documentGeneration: 3,
    transportEpoch: 4,
    bridgeGeneration: 5
  };
  assert.deepEqual(normalizeTrustedCutShortcutMessage(valid), valid);
  for (const invalid of [
    { ...valid, extra: true },
    { ...valid, contentId: "too-short" },
    { ...valid, platform: "SOOP" },
    { ...valid, key: "S" },
    { ...valid, documentGeneration: 0 },
    { ...valid, transportEpoch: 0 },
    { ...valid, bridgeGeneration: 0 }
  ]) {
    assert.equal(normalizeTrustedCutShortcutMessage(invalid), null);
  }
});

test("컷 top document URL은 query·hash 변형 없이 하나뿐이다", () => {
  assert.equal(isExactCutWindowUrl(CUT_WINDOW_URL), true);
  assert.equal(isExactCutWindowUrl(`${CUT_WINDOW_URL}#x`), false);
  assert.equal(isExactCutWindowUrl(`${CUT_WINDOW_URL}&extra=1`), false);
});
