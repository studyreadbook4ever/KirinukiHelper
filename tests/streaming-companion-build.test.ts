import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  SOOP_STREAMING_COMPANION_JAVASCRIPT_PATH,
  STREAMING_COMPANION_DEFAULT_STUDIO_ORIGIN,
  STREAMING_COMPANION_HTTPS_ORIGINS_ENV,
  STREAMING_COMPANION_STUDIO_ORIGIN_ENV,
  STREAMING_COMPANION_JAVASCRIPT_PATH,
  STREAMING_COMPANION_MANIFEST_PATH,
  buildStreamingCompanion,
  resolveStreamingCompanionStudioOrigins
} from "../scripts/build-streaming-companion.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("companion Studio origin은 localhost 기본값과 명시적 공개 Origin 하나만 허용한다", () => {
  assert.deepEqual(resolveStreamingCompanionStudioOrigins({}), [
    STREAMING_COMPANION_DEFAULT_STUDIO_ORIGIN
  ]);
  assert.deepEqual(resolveStreamingCompanionStudioOrigins({
    [STREAMING_COMPANION_STUDIO_ORIGIN_ENV]:
      "https://kirinuki.eff0rtchung.kr"
  }), [
    "https://kirinuki.eff0rtchung.kr"
  ]);
  assert.deepEqual(resolveStreamingCompanionStudioOrigins({
    [STREAMING_COMPANION_HTTPS_ORIGINS_ENV]:
      "https://kirinuki.eff0rtchung.kr"
  }), ["https://kirinuki.eff0rtchung.kr"]);
  for (const invalid of [
    "http://studio.example",
    "https://*.example",
    "https://studio.example/path",
    "https://studio.example?x=1",
    " https://studio.example",
    "https://studio.example, https://other.example",
    "https://studio.example:443",
    "https://kirinuki.eff0rtchung.kr/"
  ]) {
    assert.throws(
      () => resolveStreamingCompanionStudioOrigins({
        [STREAMING_COMPANION_HTTPS_ORIGINS_ENV]: invalid
      }),
      /Origin/u
    );
  }
  assert.throws(() => resolveStreamingCompanionStudioOrigins({
    [STREAMING_COMPANION_STUDIO_ORIGIN_ENV]:
      "https://kirinuki.eff0rtchung.kr",
    [STREAMING_COMPANION_HTTPS_ORIGINS_ENV]:
      STREAMING_COMPANION_DEFAULT_STUDIO_ORIGIN
  }), /서로 다릅니다/u);
});

test("companion manifest와 JavaScript는 같은 입력에서 바이트 단위로 결정적이다", async () => {
  const env = {
    [STREAMING_COMPANION_STUDIO_ORIGIN_ENV]:
      "https://kirinuki.eff0rtchung.kr"
  };
  const [first, second] = await Promise.all([
    buildStreamingCompanion({
      rootDirectory: root,
      env,
      write: false,
      logLevel: "silent"
    }),
    buildStreamingCompanion({
      rootDirectory: root,
      env,
      write: false,
      logLevel: "silent"
    })
  ]);
  assert.deepEqual(first.allowedStudioOrigins, second.allowedStudioOrigins);
  for (const relativePath of [
    STREAMING_COMPANION_JAVASCRIPT_PATH,
    SOOP_STREAMING_COMPANION_JAVASCRIPT_PATH,
    STREAMING_COMPANION_MANIFEST_PATH
  ]) {
    assert.deepEqual(
      first.outputs.get(relativePath),
      second.outputs.get(relativePath)
    );
  }
  const javascriptBytes = first.outputs.get(
    STREAMING_COMPANION_JAVASCRIPT_PATH
  );
  const soopJavaScriptBytes = first.outputs.get(
    SOOP_STREAMING_COMPANION_JAVASCRIPT_PATH
  );
  const manifestBytes = first.outputs.get(STREAMING_COMPANION_MANIFEST_PATH);
  assert(javascriptBytes && soopJavaScriptBytes && manifestBytes);
  const javascript = new TextDecoder().decode(javascriptBytes);
  const soopJavaScript = new TextDecoder().decode(soopJavaScriptBytes);
  for (const bundle of [javascript, soopJavaScript]) {
    assert.match(bundle, /https:\/\/kirinuki\.eff0rtchung\.kr/u);
    assert.doesNotMatch(bundle, /http:\/\/127\.0\.0\.1:4320/u);
    assert.doesNotMatch(bundle, /<all_urls>|chrome\.runtime|sidePanel/u);
  }
  assert.match(soopJavaScript, /vodCore/u);

  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
    readonly version?: string;
    readonly content_scripts?: ReadonlyArray<{
      readonly all_frames?: boolean;
      readonly js?: readonly string[];
      readonly matches?: readonly string[];
      readonly run_at?: string;
      readonly world?: string;
    }>;
  };
  const contentScript = manifest.content_scripts?.[0];
  const soopContentScript = manifest.content_scripts?.[1];
  assert.equal(manifest.version, "2.0.0");
  assert.equal(manifest.content_scripts?.length, 2);
  assert.equal(contentScript?.all_frames, true);
  assert.equal(contentScript?.run_at, "document_start");
  assert.deepEqual(contentScript?.matches, [
    "https://chzzk.naver.com/*",
    "https://www.youtube-nocookie.com/*"
  ]);
  assert.deepEqual(contentScript?.js, [STREAMING_COMPANION_JAVASCRIPT_PATH]);
  assert.equal(contentScript?.world, undefined);
  assert.equal(soopContentScript?.all_frames, true);
  assert.equal(soopContentScript?.run_at, "document_start");
  assert.equal(soopContentScript?.world, "MAIN");
  assert.deepEqual(soopContentScript?.matches, [
    "https://vod.sooplive.com/*"
  ]);
  assert.deepEqual(soopContentScript?.js, [
    SOOP_STREAMING_COMPANION_JAVASCRIPT_PATH
  ]);
  assert.deepEqual(
    contentScript?.matches?.filter((match) => match.includes("youtube")),
    ["https://www.youtube-nocookie.com/*"]
  );
  assert.match(javascript, /www\.youtube-nocookie\.com/u);
  assert.match(javascript, /A-Za-z0-9_-\]\{11\}/u);
});
