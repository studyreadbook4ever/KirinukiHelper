import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMERCIAL_USE_APPROVED_LICENSE_IDS,
  THIRD_PARTY_ATTRIBUTIONS,
  THIRD_PARTY_ATTRIBUTION_IDS,
  commercialUseLicenseRejectionReason,
  commercialUseRestrictiveLicenseMarker,
  isCommercialUseApprovedLicenseId,
  thirdPartyAttributionById
} from "../src/lib/third-party-attributions.js";

test("commercial-use license policy is an exact positive allowlist", () => {
  assert.deepEqual(
    COMMERCIAL_USE_APPROVED_LICENSE_IDS,
    [
      "Apache-2.0",
      "BlueOak-1.0.0",
      "BSD-2-Clause",
      "ISC",
      "MIT",
      "MIT-or-Unlicense",
      "MIT-0-or-Unlicense",
      "MPL-2.0",
      "OFL-1.1",
      "Unlicense"
    ]
  );
  for (const license of COMMERCIAL_USE_APPROVED_LICENSE_IDS) {
    assert.equal(isCommercialUseApprovedLicenseId(license), true);
    assert.equal(commercialUseLicenseRejectionReason(license), null);
  }
  for (const nearMiss of [
    " MIT",
    "MIT ",
    "MIT OR Apache-2.0",
    "GPL-3.0-only",
    "AGPL-3.0-only",
    "CC-BY-4.0",
    "BSL-1.0"
  ]) {
    assert.equal(isCommercialUseApprovedLicenseId(nearMiss), false);
    assert.match(
      commercialUseLicenseRejectionReason(nearMiss) || "",
      /positive allowlist/u
    );
  }
});

test("commercial-use policy fails closed on restricted and unresolved licenses", () => {
  const rejectedFixtures = [
    "CC-BY-NC-4.0",
    "CC NC 3.0",
    "NonCommercial",
    "Apache-2.0 WITH Commons Clause",
    "PolyForm-Noncommercial-1.0.0",
    "PolyForm-Small-Business-1.0.0",
    "SSPL-1.0",
    "Server Side Public License v1",
    "BUSL-1.1",
    "BSL-1.1",
    "Business Source License 1.1",
    "Elastic-2.0",
    "Elastic License 2.0",
    "Prosperity Public License 3.0.0",
    "LicenseRef-Proprietary",
    "SEE LICENSE IN LICENSE.txt",
    "UNLICENSED",
    "NOASSERTION",
    "unknown",
    "",
    undefined
  ];
  for (const license of rejectedFixtures) {
    assert.ok(
      commercialUseLicenseRejectionReason(license),
      `${String(license)} must fail closed`
    );
  }
  assert.equal(
    commercialUseRestrictiveLicenseMarker(
      "MIT License\nAdditional condition: Commons Clause License Condition v1.0"
    ),
    "Commons Clause"
  );
  assert.equal(
    commercialUseRestrictiveLicenseMarker(
      "Permission is limited to NonCommercial purposes."
    ),
    "NonCommercial/Creative Commons NC"
  );
  assert.equal(
    commercialUseRestrictiveLicenseMarker("standard MIT text"),
    null
  );
});

test("boundary pseudo-license IDs stay in non-product attribution kinds", () => {
  for (const entry of THIRD_PARTY_ATTRIBUTIONS) {
    if (entry.kind === "system-provided") {
      assert.equal(entry.license, "build-dependent");
      assert.equal(entry.redistributed, false);
      continue;
    }
    if (entry.kind === "external-service-reference") {
      assert.equal(entry.license, "external-terms");
      assert.equal(entry.redistributed, false);
      continue;
    }
    if (
      entry.kind === "development-only"
      || entry.kind === "ci-only"
      || entry.kind === "desktop-local-engine-bundle"
    ) {
      assert.equal(entry.license, "mixed-see-packages");
      assert.equal(
        entry.redistributed,
        entry.kind === "desktop-local-engine-bundle"
      );
      continue;
    }
    assert.equal(commercialUseLicenseRejectionReason(entry.license), null);
    if (entry.kind === "runtime-downloaded") {
      const embeddedComponents = "embeddedComponents" in entry
        ? entry.embeddedComponents
        : [];
      for (const embedded of embeddedComponents) {
        assert.equal(
          commercialUseLicenseRejectionReason(embedded.license),
          null
        );
      }
    }
  }
});

test("third-party registry has stable unique identities", () => {
  assert.deepEqual(
    THIRD_PARTY_ATTRIBUTION_IDS,
    THIRD_PARTY_ATTRIBUTIONS.map(({ id }) => id)
  );
  assert.equal(
    new Set(THIRD_PARTY_ATTRIBUTION_IDS).size,
    THIRD_PARTY_ATTRIBUTION_IDS.length
  );
  assert.equal(thirdPartyAttributionById("missing"), undefined);
});

test("browser-bundled attribution paths belong to the canonical web distribution", () => {
  const browserAssets = THIRD_PARTY_ATTRIBUTIONS.filter(
    (entry) => entry.kind === "web-bundled"
  );
  assert.deepEqual(
    browserAssets.map(({ id }) => id),
    ["mediabunny", "hls-js", "pretendard", "paperlogy"]
  );
  for (const entry of browserAssets) {
    assert.match(entry.licenseTextPath, /^web\//u);
    assert.ok(
      entry.bundledFiles.every(({ path }) => path.startsWith("web/"))
    );
  }
  const audseg = thirdPartyAttributionById("audseg");
  assert.equal(audseg?.kind, "separately-licensed-source");
  if (audseg?.kind === "separately-licensed-source") {
    assert.match(audseg.licenseTextPath, /^web\//u);
  }
});

test("every redistributed runtime download is immutable and verified", () => {
  const downloads = THIRD_PARTY_ATTRIBUTIONS.filter(
    (entry) => entry.kind === "runtime-downloaded"
  );
  assert.deepEqual(
    downloads.map(({ id }) => id),
    ["whisper-cpp", "openai-whisper-models", "silero-vad", "yt-dlp"]
  );
  for (const entry of downloads) {
    assert.equal(entry.installScope, "per-user-xdg");
    assert.ok(entry.artifacts.length > 0);
    for (const artifact of entry.artifacts) {
      assert.match(artifact.url, /^https:\/\//u);
      assert.ok(Number.isSafeInteger(artifact.size) && artifact.size > 0);
      assert.match(artifact.sha256, /^[a-f0-9]{64}$/u);
    }
  }
});

test("system tools and external service names cannot look bundled", () => {
  const systemTools = THIRD_PARTY_ATTRIBUTIONS.filter(
    (entry) => entry.kind === "system-provided"
  );
  assert.deepEqual(
    systemTools.map(({ id }) => id),
    ["ffmpeg", "ffprobe", "nodejs", "python", "chromium"]
  );
  for (const entry of systemTools) {
    assert.equal(entry.redistributed, false);
    assert.ok(entry.detection.length > 0);
    assert.equal(typeof entry.licenseDependsOnBuild, "boolean");
  }

  const services = THIRD_PARTY_ATTRIBUTIONS.filter(
    (entry) => entry.kind === "external-service-reference"
  );
  assert.deepEqual(
    services.map(({ id }) => id),
    ["chzzk-service", "youtube-service", "soop-service"]
  );
  for (const entry of services) {
    assert.equal(entry.redistributed, false);
    assert.equal(entry.affiliationClaimed, false);
  }
});

test("repository-local engine runtime is distinct from build-only tooling", () => {
  const engineRuntime = thirdPartyAttributionById("tsx-runtime");
  assert.equal(engineRuntime?.kind, "local-engine-repository-runtime");
  if (engineRuntime?.kind === "local-engine-repository-runtime") {
    assert.equal(engineRuntime.redistributed, false);
    assert.equal(engineRuntime.executionScope, "repository-local-node-modules");
    assert.deepEqual(
      engineRuntime.packages,
      [
        "tsx@4.23.1 (MIT)",
        "esbuild@0.28.1 and platform packages (MIT)",
        "fsevents@2.3.3 optional on macOS (MIT)"
      ]
    );
  }

  const buildOnly = thirdPartyAttributionById("typescript-toolchain");
  assert.equal(buildOnly?.kind, "development-only");
  if (buildOnly?.kind === "development-only") {
    assert.equal(buildOnly.redistributed, false);
    assert.ok(buildOnly.packages.every((entry) => (
      !entry.startsWith("tsx@") && !entry.startsWith("esbuild@")
    )));
  }
});

test("desktop attribution describes the windowless installer and stays release-blocked", () => {
  const engine = thirdPartyAttributionById("desktop-local-engine-runtime");
  assert.equal(engine?.kind, "desktop-local-engine-bundle");
  if (engine?.kind !== "desktop-local-engine-bundle") {
    return;
  }
  assert.equal(engine.redistributed, true);
  assert.equal(engine.publicReleaseBlocked, true);
  assert.equal(engine.releaseGate, "legal/DESKTOP_BINARY_RELEASE_GATE.md");
  assert.match(engine.name, /background local media engine installer/u);
  assert.doesNotMatch(`${engine.name} ${engine.purpose}`, /preview|editor window/iu);
  assert.ok(engine.packages.some((entry) => (
    entry.includes("electron-builder@26.15.3")
  )));
});

test("CI actions are non-distributed and pinned by full commit SHA", () => {
  const ci = thirdPartyAttributionById("github-actions-ci");
  assert.equal(ci?.kind, "ci-only");
  if (ci?.kind !== "ci-only") {
    return;
  }
  assert.equal(ci.redistributed, false);
  assert.equal(ci.workflowPath, ".github/workflows/typescript-quality.yml");
  assert.deepEqual(
    ci.actions.map(({ slug }) => slug),
    ["actions/checkout", "actions/setup-node", "browser-actions/setup-chrome"]
  );
  for (const action of ci.actions) {
    assert.match(action.ref, /^[a-f0-9]{40}$/u);
    assert.equal(action.license, "MIT");
    assert.match(action.source, /^https:\/\/github\.com\//u);
    assert.match(action.licenseSource, /^https:\/\/github\.com\//u);
  }
});
