import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SOURCE_URL,
  KIRINUKI_DEEP_LINK,
  parseKirinukiDeepLink,
  parseLinuxHelperArgs,
  validateSourceUrl
} from "../scripts/linux-helper.js";
import { sourceEmbedDescriptor } from "../src/lib/source-embed.js";

const VALID_SOURCE_CASES = Object.freeze([
  [
    "https://chzzk.naver.com/video/14514980",
    "https://chzzk.naver.com/video/14514980"
  ],
  [
    "https://chzzk.naver.com/video/14514980/?utm_source=copy",
    "https://chzzk.naver.com/video/14514980"
  ],
  [
    "https://www.youtube.com/watch?v=nixLJx1UhfY&t=10s",
    "https://www.youtube.com/watch?v=nixLJx1UhfY"
  ],
  [
    "https://m.youtube.com/shorts/nixLJx1UhfY?feature=share",
    "https://www.youtube.com/watch?v=nixLJx1UhfY"
  ],
  [
    "https://youtube.com/embed/nixLJx1UhfY",
    "https://www.youtube.com/watch?v=nixLJx1UhfY"
  ],
  [
    "https://youtube.com/live/nixLJx1UhfY?si=copy",
    "https://www.youtube.com/watch?v=nixLJx1UhfY"
  ],
  [
    "https://youtu.be/nixLJx1UhfY?si=copy",
    "https://www.youtube.com/watch?v=nixLJx1UhfY"
  ],
  [
    "https://vod.sooplive.com/player/123456?change_second=20",
    "https://vod.sooplive.com/player/123456"
  ],
  [
    "https://vod.sooplive.co.kr/player/123456/",
    "https://vod.sooplive.com/player/123456"
  ],
  [
    "https://vod.afreecatv.com/PLAYER/STATION/123456",
    "https://vod.sooplive.com/player/123456"
  ]
] as const);

test("Linux 진입점이 승인한 모든 원본은 공용 embed 계약이 처리하고 canonicalize한다", () => {
  assert(sourceEmbedDescriptor(DEFAULT_SOURCE_URL));
  for (const [input, canonical] of VALID_SOURCE_CASES) {
    const descriptor = sourceEmbedDescriptor(input);
    assert(descriptor, input);
    assert.equal(descriptor.sourceUrl, canonical, input);
    assert.equal(validateSourceUrl(input), canonical, input);
    assert(sourceEmbedDescriptor(validateSourceUrl(input)), input);

    const deepLink = `${KIRINUKI_DEEP_LINK}?${new URLSearchParams({
      source: input
    })}`;
    assert.deepEqual(parseKirinukiDeepLink(deepLink), {
      sourceUrl: canonical
    }, input);
    assert.equal(
      parseLinuxHelperArgs(["open", input]).options.url,
      canonical,
      input
    );
  }
});

test("Linux 진입점은 redirector·홈·라이브·클립·잘못된 VOD path를 거절한다", () => {
  for (const input of [
    "",
    "https://naver.me/xJcAj1dV",
    "https://chzzk.naver.com/",
    "https://chzzk.naver.com/live/0123456789abcdef0123456789abcdef",
    "https://chzzk.naver.com/clips/123456",
    "https://chzzk.naver.com/video/not-numeric",
    "https://chzzk.naver.com/video/123456/extra",
    "https://youtube.com/",
    "https://youtube.com/watch?v=short",
    "https://youtube.com/channel/UC0123456789012345678901",
    "https://youtu.be/nixLJx1UhfY/extra",
    "https://vod.sooplive.com/",
    "https://vod.sooplive.com/player/not-numeric",
    "https://vod.sooplive.com/player/123456/extra",
    "https://chzzk.naver.com:443/video/14514980",
    "https://youtu.be/nixLJx1UhfY#fragment",
    "https://user:secret@youtube.com/watch?v=nixLJx1UhfY",
    "https://youtube.com.evil.example/watch?v=nixLJx1UhfY",
    "http://youtube.com/watch?v=nixLJx1UhfY"
  ]) {
    assert.throws(
      () => validateSourceUrl(input),
      /VOD|URL|HTTPS|계정|port|fragment|원본/u,
      input
    );
  }
});
