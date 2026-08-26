import assert from "node:assert/strict";
import test from "node:test";

import {
  consumeSourceLocation,
  SOURCE_LOCATION_SANITIZED_EVENT
} from "../src/web/source-location.js";

test("source query is consumed and the address is canonicalized", () => {
  assert.deepEqual(
    consumeSourceLocation(
      "https://kirinuki.eff0rtchung.kr/?source=https%3A%2F%2Fchzzk.naver.com%2Fvideo%2F123&utm=x"
    ),
    {
      source: "https://chzzk.naver.com/video/123",
      shouldSanitize: true,
      canonicalPath: "/"
    }
  );
});

test("source fragment avoids the request URL and is consumed identically", () => {
  assert.deepEqual(
    consumeSourceLocation(
      "https://kirinuki.eff0rtchung.kr/#source=https%3A%2F%2Fvod.sooplive.com%2Fplayer%2F456"
    ),
    {
      source: "https://vod.sooplive.com/player/456",
      shouldSanitize: true,
      canonicalPath: "/"
    }
  );
});

test("legacy query precedence and empty-query fragment fallback are preserved", () => {
  assert.equal(
    consumeSourceLocation(
      "https://kirinuki.eff0rtchung.kr/?source=query#source=fragment"
    ).source,
    "query"
  );
  assert.equal(
    consumeSourceLocation(
      "https://kirinuki.eff0rtchung.kr/?source=#source=fragment"
    ).source,
    "fragment"
  );
});

test("an empty source key is still removed and unrelated URLs are untouched", () => {
  assert.deepEqual(
    consumeSourceLocation("https://kirinuki.eff0rtchung.kr/?source="),
    { source: null, shouldSanitize: true, canonicalPath: "/" }
  );
  assert.deepEqual(
    consumeSourceLocation("https://kirinuki.eff0rtchung.kr/?utm=x#section"),
    { source: null, shouldSanitize: false, canonicalPath: "/" }
  );
  assert.equal(
    SOURCE_LOCATION_SANITIZED_EVENT,
    "kirinuki:source-location-sanitized"
  );
});
