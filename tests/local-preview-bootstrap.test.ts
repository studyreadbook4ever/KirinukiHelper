import assert from "node:assert/strict";
import test from "node:test";

import {
  formatStudioTimecode,
  parseStudioTimecode
} from "../src/web/studio-timecode.js";

test("studio timecode는 밀리초까지 정확히 왕복한다", () => {
  for (const seconds of [0, 0.001, 80.5, 3_723.456, 604_800]) {
    assert.equal(parseStudioTimecode(formatStudioTimecode(seconds)), seconds);
  }
  assert.equal(parseStudioTimecode("08:20"), 500);
  assert.equal(parseStudioTimecode("01:20.500"), 80.5);
});

test("studio timecode는 잘못된 형식과 7일을 넘는 시각을 거부한다", () => {
  for (const value of [
    "",
    "not-a-time",
    "00:60:00",
    "00:00:60",
    "1:2:3:4",
    "-1",
    "168:00:00.001",
    "168:00:01"
  ]) {
    assert.equal(parseStudioTimecode(value), null, value);
  }
  assert.equal(parseStudioTimecode("168:00:00"), 604_800);
});

test("표시용 timecode는 음수·소수 오차를 안전하게 정규화한다", () => {
  assert.equal(formatStudioTimecode(-1), "00:00:00");
  assert.equal(formatStudioTimecode(12.3454), "00:00:12.345");
  assert.equal(formatStudioTimecode(12.3456), "00:00:12.346");
});
