import assert from "node:assert/strict";
import test from "node:test";

import { sourceEmbedDescriptor } from "../src/lib/source-embed.js";

test("플랫폼별 VOD는 client-side exact embed descriptor로만 변환한다", () => {
  const youtube = sourceEmbedDescriptor("https://youtu.be/M7lc1UVf-VE?t=5");
  assert.equal(youtube?.kind, "official-embed");
  assert.equal(
    youtube?.embedUrl,
    "https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?playsinline=1&enablejsapi=1&origin=http%3A%2F%2F127.0.0.1%3A4320"
  );
  assert.deepEqual(
    sourceEmbedDescriptor("https://www.youtube.com/live/M7lc1UVf-VE?feature=share"),
    youtube
  );

  const soop = sourceEmbedDescriptor(
    "https://vod.sooplive.co.kr/player/169475287?change_second=3"
  );
  assert.equal(soop?.kind, "official-embed");
  assert.equal(
    soop?.embedUrl,
    "https://vod.sooplive.com/player/169475287/embed?autoPlay=true&showChat=false&mutePlay=true"
  );

  const chzzk = sourceEmbedDescriptor(
    "https://chzzk.naver.com/video/14514980?time=3"
  );
  assert.equal(chzzk?.kind, "framed-source");
  assert.equal(chzzk?.embedUrl, "https://chzzk.naver.com/video/14514980");
});

test("live·clip·목록·스푸핑 URL은 스트리밍 창을 만들지 않는다", () => {
  for (const value of [
    "https://chzzk.naver.com/live/channel-id",
    "https://chzzk.naver.com/clips/ABCDEF1234",
    "https://chzzk.naver.com/foo/video/14514980/extra",
    "https://chzzk.naver.com/video/not-a-vod",
    "https://www.youtube.com/playlist?list=PL123",
    "https://www.youtube.com/foo/embed/M7lc1UVf-VE",
    "https://www.youtube.com.evil.example/watch?v=M7lc1UVf-VE",
    "https://vod.sooplive.com.evil.example/player/169475287",
    "javascript:alert(1)"
  ]) {
    assert.equal(sourceEmbedDescriptor(value), null, value);
  }
});

test("YouTube embed의 origin은 localhost 또는 고정 공개 배포 origin만 허용한다", () => {
  assert.equal(
    sourceEmbedDescriptor("https://youtu.be/M7lc1UVf-VE", {
      studioOrigin: "https://kirinuki.eff0rtchung.kr"
    })?.embedUrl,
    "https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?playsinline=1&enablejsapi=1&origin=https%3A%2F%2Fkirinuki.eff0rtchung.kr"
  );
  assert.throws(
    () => sourceEmbedDescriptor("https://youtu.be/M7lc1UVf-VE", {
      studioOrigin: "http://evil.example"
    }),
    /고정된 loopback 또는 공개 배포 Origin/u
  );
  assert.throws(
    () => sourceEmbedDescriptor("https://youtu.be/M7lc1UVf-VE", {
      studioOrigin: "https://kirinuki.eff0rtchung.kr/path"
    }),
    /고정된 loopback 또는 공개 배포 Origin/u
  );
  assert.throws(
    () => sourceEmbedDescriptor("https://youtu.be/M7lc1UVf-VE", {
      studioOrigin: "https://studio.kirinuki.example"
    }),
    /고정된 loopback 또는 공개 배포 Origin/u
  );
});
