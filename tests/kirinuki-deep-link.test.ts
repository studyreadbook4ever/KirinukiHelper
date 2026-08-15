import assert from "node:assert/strict";
import test from "node:test";

import {
  KIRINUKI_DEEP_LINK,
  extractKirinukiDeepLinkFromArgv,
  parseKirinukiDeepLink,
  validateSourceUrl
} from "../src/lib/kirinuki-deep-link.js";

const CHZZK_SOURCE = "https://chzzk.naver.com/video/14514980";
const CHZZK_LINK = `${KIRINUKI_DEEP_LINK}?${new URLSearchParams({
  source: CHZZK_SOURCE
})}`;

test("공용 딥링크 parser는 exact open route와 source 하나만 허용한다", () => {
  assert.deepEqual(parseKirinukiDeepLink(KIRINUKI_DEEP_LINK), {
    sourceUrl: null
  });
  assert.deepEqual(parseKirinukiDeepLink(CHZZK_LINK), {
    sourceUrl: CHZZK_SOURCE
  });

  for (const invalid of [
    "KIRINUKI://open",
    "kirinuki://open/",
    "kirinuki://other",
    "kirinuki://user@open",
    "kirinuki://open:99",
    "kirinuki://open#fragment",
    "kirinuki://open?unknown=1",
    "kirinuki://open?source=",
    `${CHZZK_LINK}&source=${encodeURIComponent(CHZZK_SOURCE)}`
  ]) {
    assert.throws(() => parseKirinukiDeepLink(invalid), /앱 링크|source/u, invalid);
  }
});

test("공용 source 계약은 canonical VOD만 허용하고 redirector와 잘못된 path를 거절한다", () => {
  assert.equal(
    validateSourceUrl("https://youtu.be/nixLJx1UhfY?si=copy"),
    "https://www.youtube.com/watch?v=nixLJx1UhfY"
  );
  assert.equal(
    validateSourceUrl("https://vod.afreecatv.com/PLAYER/STATION/123456"),
    "https://vod.sooplive.com/player/123456"
  );

  for (const invalid of [
    "https://naver.me/xJcAj1dV",
    "https://chzzk.naver.com/video/14514980/extra",
    "https://chzzk.naver.com/live/0123456789abcdef0123456789abcdef",
    "https://youtube.com/watch/extra?v=nixLJx1UhfY",
    "https://youtu.be/nixLJx1UhfY/extra",
    "https://vod.sooplive.com/player/123456/extra",
    "https://youtube.com.evil.example/watch?v=nixLJx1UhfY"
  ]) {
    assert.throws(() => validateSourceUrl(invalid), /VOD|URL|HTTPS|원본/u, invalid);
  }
});

test("Electron cold/warm argv에서 Windows·macOS·Linux 모두 exact protocol 인자만 추출한다", () => {
  const invocations = [
    ["win32 cold", ["C:\\Program Files\\Kirinuki\\Kirinuki.exe", CHZZK_LINK]],
    ["win32 warm", ["Kirinuki.exe", "--disable-features=SpareRendererForSitePerProcess", CHZZK_LINK]],
    ["darwin cold", ["/Applications/Kirinuki.app/Contents/MacOS/Kirinuki", CHZZK_LINK]],
    ["darwin argv fallback", ["Kirinuki", "--some-electron-flag", CHZZK_LINK]],
    ["linux cold", ["/opt/Kirinuki/kirinuki", CHZZK_LINK]],
    ["linux warm", ["/opt/Kirinuki/kirinuki", "--ozone-platform=x11", CHZZK_LINK]]
  ] as const;

  for (const [label, argv] of invocations) {
    assert.deepEqual(extractKirinukiDeepLinkFromArgv(argv), {
      sourceUrl: CHZZK_SOURCE
    }, label);
  }
  assert.equal(extractKirinukiDeepLinkFromArgv([
    "Kirinuki.exe",
    "--source=kirinuki://open",
    "https://example.com/kirinuki://open"
  ]), null);
  assert.throws(
    () => extractKirinukiDeepLinkFromArgv(["Kirinuki.exe", CHZZK_LINK, KIRINUKI_DEEP_LINK]),
    /하나만/u
  );
  assert.throws(
    () => extractKirinukiDeepLinkFromArgv(["Kirinuki.exe", "KIRINUKI://open"]),
    /앱 링크/u
  );
});

test("macOS warm open-url 값은 argv 추측 없이 같은 strict parser로 검증한다", () => {
  assert.deepEqual(parseKirinukiDeepLink(CHZZK_LINK), {
    sourceUrl: CHZZK_SOURCE
  });
});
