import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  SOOP_STREAMING_COMPANION_JAVASCRIPT_PATH,
  STUDIO_STREAMING_RELAY_JAVASCRIPT_PATH,
  STREAMING_COMPANION_DEFAULT_STUDIO_ORIGIN,
  STREAMING_COMPANION_HTTPS_ORIGINS_ENV,
  STREAMING_COMPANION_STUDIO_ORIGIN_ENV,
  STREAMING_COMPANION_JAVASCRIPT_PATH,
  STREAMING_COMPANION_MANIFEST_PATH,
  buildStreamingCompanion,
  resolveStreamingCompanionStudioOrigins
} from "../scripts/build-streaming-companion.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("앱의 player bridge는 앱 전용 Origin 하나만 허용한다", () => {
  assert.deepEqual(resolveStreamingCompanionStudioOrigins({}), [
    STREAMING_COMPANION_DEFAULT_STUDIO_ORIGIN
  ]);
  for (const invalid of [
    "http://studio.example",
    "https://*.example",
    "https://studio.example/path",
    "https://studio.example?x=1",
    " https://studio.example",
    "https://studio.example, https://other.example",
    "https://studio.example:443",
    "https://kirinuki.eff0rtchung.kr",
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

test("앱 player bridge manifest와 JavaScript는 같은 입력에서 바이트 단위로 결정적이다", async () => {
  const env = {
    [STREAMING_COMPANION_STUDIO_ORIGIN_ENV]:
      STREAMING_COMPANION_DEFAULT_STUDIO_ORIGIN
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
    STUDIO_STREAMING_RELAY_JAVASCRIPT_PATH,
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
  const studioRelayJavaScriptBytes = first.outputs.get(
    STUDIO_STREAMING_RELAY_JAVASCRIPT_PATH
  );
  const manifestBytes = first.outputs.get(STREAMING_COMPANION_MANIFEST_PATH);
  assert(
    javascriptBytes
      && soopJavaScriptBytes
      && studioRelayJavaScriptBytes
      && manifestBytes
  );
  const javascript = new TextDecoder().decode(javascriptBytes);
  const soopJavaScript = new TextDecoder().decode(soopJavaScriptBytes);
  const studioRelayJavaScript = new TextDecoder().decode(
    studioRelayJavaScriptBytes
  );
  for (const bundle of [javascript, soopJavaScript, studioRelayJavaScript]) {
    assert.match(bundle, /http:\/\/127\.0\.0\.1:4320/u);
    assert.doesNotMatch(bundle, /https:\/\/kirinuki\.eff0rtchung\.kr/u);
    assert.doesNotMatch(bundle, /<all_urls>|chrome\.runtime|sidePanel/u);
  }
  assert.match(soopJavaScript, /vodCore/u);

  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
    readonly version?: string;
    readonly permissions?: readonly string[];
    readonly host_permissions?: readonly string[];
    readonly content_scripts?: ReadonlyArray<{
      readonly all_frames?: boolean;
      readonly include_globs?: readonly string[];
      readonly js?: readonly string[];
      readonly matches?: readonly string[];
      readonly run_at?: string;
      readonly world?: string;
    }>;
  };
  const studioRelayContentScript = manifest.content_scripts?.[0];
  const contentScript = manifest.content_scripts?.[1];
  const soopContentScript = manifest.content_scripts?.[2];
  const appManifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  ) as { readonly version?: string };
  assert.equal(manifest.version, appManifest.version);
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts?.length, 3);
  assert.equal(studioRelayContentScript?.all_frames, false);
  assert.equal(studioRelayContentScript?.run_at, "document_start");
  assert.equal(studioRelayContentScript?.world, undefined);
  assert.deepEqual(studioRelayContentScript?.matches, [
    "http://127.0.0.1/*"
  ]);
  assert.deepEqual(studioRelayContentScript?.include_globs, [
    "http://127.0.0.1:4320/*"
  ]);
  assert.deepEqual(studioRelayContentScript?.js, [
    STUDIO_STREAMING_RELAY_JAVASCRIPT_PATH
  ]);
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
  assert.match(javascript, /HMAC/u);
  assert.match(studioRelayJavaScript, /HMAC/u);
  assert.match(
    studioRelayJavaScript,
    /KIRINUKI_STREAMING_BRIDGE_STUDIO_DELIVERY/u
  );
});
