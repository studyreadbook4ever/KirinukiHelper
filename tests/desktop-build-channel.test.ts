import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DESKTOP_BUILD_CHANNEL,
  normalizeDesktopBuildChannel
} from "../src/desktop/build-channel.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("desktop source defaults only unsigned CI to static upstream hashes", () => {
  assert.equal(DESKTOP_BUILD_CHANNEL, "ci-test-only");
  assert.equal(normalizeDesktopBuildChannel(undefined), "ci-test-only");
  assert.equal(normalizeDesktopBuildChannel("public-release"), "public-release");
  for (const invalid of [null, "", "release", "PUBLIC-RELEASE", 1]) {
    assert.throws(
      () => normalizeDesktopBuildChannel(invalid),
      /exact contract/u
    );
  }
});

test("public mac channel is app.asar-bound and cannot fall back on a missing sidecar", async () => {
  const [builder, supervisor] = await Promise.all([
    readFile(path.join(root, "scripts/build-desktop.ts"), "utf8"),
    readFile(path.join(root, "src/desktop/runtime-supervisor.ts"), "utf8")
  ]);
  assert.match(
    builder,
    /__KIRINUKI_DESKTOP_BUILD_CHANNEL__:\s*JSON\.stringify\(buildChannel\)/u
  );
  assert.match(
    supervisor,
    /bundleTarget === "darwin-arm64"[\s\S]*?DESKTOP_BUILD_CHANNEL === "public-release"[\s\S]*?verifyMacosSealedDesktopTools/u
  );
  assert.doesNotMatch(supervisor, /hasMacosSealedToolManifest/u);
});
