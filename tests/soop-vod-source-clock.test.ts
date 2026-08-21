import assert from "node:assert/strict";
import test from "node:test";

import {
  SOOP_VOD_SOURCE_CLOCK_IDENTITY_SCHEMA,
  deriveSoopVodSourceClockIdentity,
  normalizeSoopVodSourceClockIdentity,
  sameSoopVodSourceClockIdentity
} from "../src/lib/soop-vod-source-clock.js";

function identity() {
  return {
    schema: SOOP_VOD_SOURCE_CLOCK_IDENTITY_SCHEMA,
    platform: "SOOP",
    contentId: "296331085",
    totalDurationSeconds: 300,
    parts: [
      {
        id: "20260814_TEST_296331085_1",
        index: 0,
        order: 1,
        durationSeconds: 120
      },
      {
        id: "20260814_TEST_296331085_2",
        index: 1,
        order: 2,
        durationSeconds: 180
      }
    ]
  };
}

test("SOOP source clock identity는 ordered official integer part vector만 수용한다", () => {
  const normalized = normalizeSoopVodSourceClockIdentity(identity());
  assert(normalized);
  assert.equal(normalized.totalDurationSeconds, 300);
  assert.equal(sameSoopVodSourceClockIdentity(normalized, normalized), true);

  for (const malformed of [
    { ...identity(), totalDurationSeconds: 301 },
    {
      ...identity(),
      parts: identity().parts.map((part, index) => (
        index === 1 ? { ...part, index: 0 } : part
      ))
    },
    {
      ...identity(),
      parts: identity().parts.map((part, index) => (
        index === 1 ? { ...part, id: identity().parts[0]!.id } : part
      ))
    },
    {
      ...identity(),
      parts: identity().parts.map((part, index) => (
        index === 1 ? { ...part, durationSeconds: 180.5 } : part
      ))
    },
    { ...identity(), signedUrl: "https://cdn.example/?token=secret" }
  ]) {
    assert.equal(normalizeSoopVodSourceClockIdentity(malformed), null);
  }
});

test("SOOP 공식 root·entries는 브라우저 없이 동일한 canonical identity를 만든다", () => {
  const derived = deriveSoopVodSourceClockIdentity({
    contentId: "296331085",
    totalDurationSeconds: 300,
    parts: [
      { id: "20260814_TEST_296331085_1", durationSeconds: 120 },
      { id: "20260814_TEST_296331085_2", durationSeconds: 180 }
    ]
  });
  assert.deepEqual(derived, identity());

  assert.equal(deriveSoopVodSourceClockIdentity({
    contentId: "296331085",
    totalDurationSeconds: 301,
    parts: [
      { id: "part-1", durationSeconds: 120 },
      { id: "part-2", durationSeconds: 180 }
    ]
  }), null, "root 합계가 다른 partial vector를 받아서는 안 됩니다.");
  assert.equal(deriveSoopVodSourceClockIdentity({
    contentId: "296331085",
    totalDurationSeconds: 240,
    parts: [
      { id: "same", durationSeconds: 120 },
      { id: "same", durationSeconds: 120 }
    ]
  }), null, "중복 part ID를 받아서는 안 됩니다.");
});
