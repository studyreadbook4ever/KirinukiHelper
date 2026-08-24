import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_VOD_PLAYBACK_SESSION_SCHEMA,
  localVodPlaybackPartForSourceTime,
  localVodPlaybackSourceSeconds,
  parseLocalVodPlaybackSession
} from "../src/lib/local-vod-playback.js";

const TOKEN = "a".repeat(43);

function multipartSession() {
  return parseLocalVodPlaybackSession({
    schema: LOCAL_VOD_PLAYBACK_SESSION_SCHEMA,
    platform: "SOOP",
    contentId: "169475287",
    sourceUrl: "https://vod.sooplive.com/player/169475287",
    durationSeconds: 30,
    parts: [{
      index: 0,
      startSeconds: 0,
      endSeconds: 10,
      manifestUrl: `http://127.0.0.1:4319/v1/playback/${TOKEN}/part/0/index.m3u8`
    }, {
      index: 1,
      startSeconds: 10,
      endSeconds: 30,
      manifestUrl: `http://127.0.0.1:4319/v1/playback/${TOKEN}/part/1/index.m3u8`
    }]
  });
}

test("SOOP 분할 VOD는 보이는 파트 재생 시각을 하나의 원본 컷 시계로 환산한다", () => {
  const session = multipartSession();
  assert.ok(session);
  const first = localVodPlaybackPartForSourceTime(session, 9.999);
  const secondAtBoundary = localVodPlaybackPartForSourceTime(session, 10);
  const second = localVodPlaybackPartForSourceTime(session, 17.25);
  assert.equal(first.index, 0);
  assert.equal(secondAtBoundary.index, 1);
  assert.equal(second.index, 1);
  assert.equal(localVodPlaybackSourceSeconds(first, 9.999), 9.999);
  assert.equal(localVodPlaybackSourceSeconds(secondAtBoundary, 0), 10);
  assert.equal(localVodPlaybackSourceSeconds(second, 7.25), 17.25);
  assert.equal(localVodPlaybackSourceSeconds(second, 999), 30);
});

test("재생 session은 파트 사이의 틈·중첩과 비-loopback manifest를 거절한다", () => {
  const session = multipartSession();
  assert.ok(session);
  const base = {
    ...session,
    parts: session.parts.map((part) => ({ ...part }))
  };
  assert.equal(parseLocalVodPlaybackSession({
    ...base,
    parts: [base.parts[0], { ...base.parts[1], startSeconds: 10.1 }]
  }), null);
  assert.equal(parseLocalVodPlaybackSession({
    ...base,
    parts: [base.parts[0], {
      ...base.parts[1],
      manifestUrl: "https://example.com/index.m3u8"
    }]
  }), null);
});
