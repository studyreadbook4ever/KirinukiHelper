import assert from "node:assert/strict";
import test from "node:test";

import {
  DESKTOP_PUBLIC_RELEASE_ASSET_FILES,
  DESKTOP_INSTALLER_TARGETS,
  WINDOWS_PREVIEW_RELEASE_ASSET_FILES,
  desktopInstallerArtifactFileName,
  desktopInstallerBuilderArtifactFileName,
  desktopInstallerManifestFileName,
  desktopInstallerTarget
} from "../src/desktop/installer-contract.js";
import {
  resolveDesktopInstallerBuildRequest
} from "../src/desktop/installer-release-contract.js";
import { DESKTOP_PACKAGED_TARGETS } from "../src/desktop/tool-manifest.js";

test("installer support matrix와 latest release 파일명은 정확히 세 target으로 고정된다", () => {
  assert.deepEqual([...DESKTOP_INSTALLER_TARGETS], [
    "darwin-arm64",
    "linux-x64",
    "win32-x64"
  ]);
  assert.deepEqual([...DESKTOP_PACKAGED_TARGETS], [...DESKTOP_INSTALLER_TARGETS]);
  assert.deepEqual(
    DESKTOP_INSTALLER_TARGETS.map((target) => desktopInstallerTarget(target).fileName),
    [
      "Kirinuki-Engine-macos-arm64.dmg",
      "Kirinuki-Engine-linux-x64.deb",
      "Kirinuki-Engine-windows-x64-setup.exe"
    ]
  );
  assert.equal(Object.isFrozen(DESKTOP_INSTALLER_TARGETS), true);
  assert.equal(Object.isFrozen(desktopInstallerTarget("linux-x64")), true);
});

test("Windows preview 공개 파일은 installer·checksum·manifest·source offer 네 개뿐이다", () => {
  assert.deepEqual(WINDOWS_PREVIEW_RELEASE_ASSET_FILES, [
    "Kirinuki-Engine-windows-preview-SHA256.txt",
    "Kirinuki-Engine-windows-preview-SOURCE-OFFER.txt",
    "Kirinuki-Engine-windows-preview-manifest.json",
    "Kirinuki-Engine-windows-x64-preview-setup.exe"
  ]);
  assert.equal(Object.isFrozen(WINDOWS_PREVIEW_RELEASE_ASSET_FILES), true);
});

test("unsigned CI artifact 이름은 public latest asset과 혼동할 수 없다", () => {
  for (const target of DESKTOP_INSTALLER_TARGETS) {
    const contract = desktopInstallerTarget(target);
    assert.equal(
      desktopInstallerArtifactFileName(target, "public-release"),
      contract.fileName
    );
    assert.equal(
      desktopInstallerArtifactFileName(target, "ci-test-only"),
      contract.ciTestFileName
    );
    assert.match(contract.ciTestFileName, /^UNSIGNED-TEST-ONLY-/u);
    assert.equal(
      desktopInstallerBuilderArtifactFileName(target, "public-release"),
      contract.releaseCandidateFileName
    );
    assert.equal(
      desktopInstallerBuilderArtifactFileName(target, "ci-test-only"),
      contract.ciTestFileName
    );
    assert.match(
      contract.releaseCandidateFileName,
      /^QUARANTINED-NOT-FOR-PUBLISH-/u
    );
    assert.notEqual(contract.releaseCandidateFileName, contract.fileName);
    assert.equal(
      DESKTOP_PUBLIC_RELEASE_ASSET_FILES.some((name) => (
        name === contract.ciTestFileName
      )),
      false
    );
    assert.equal(
      DESKTOP_PUBLIC_RELEASE_ASSET_FILES.includes(
        contract.releaseCandidateFileName
      ),
      false
    );
    assert.equal(
      desktopInstallerManifestFileName(target, "public-release"),
      contract.releaseEvidenceFileName
    );
  }
  assert.equal(
    desktopInstallerManifestFileName("linux-x64", "ci-test-only"),
    "UNSIGNED-TEST-ONLY-installer-manifest.json"
  );
  assert.deepEqual(DESKTOP_PUBLIC_RELEASE_ASSET_FILES, [
    "Kirinuki-Engine-SHA256SUMS.txt",
    "Kirinuki-Engine-SHA256SUMS.txt.asc",
    "Kirinuki-Engine-linux-x64.deb",
    "Kirinuki-Engine-linux-x64.deb.asc",
    "Kirinuki-Engine-macos-arm64.dmg",
    "Kirinuki-Engine-release-manifest.json",
    "Kirinuki-Engine-source-provenance.tar.gz",
    "Kirinuki-Engine-windows-x64-setup.exe"
  ]);
});

test("installer contract는 지원하지 않는 architecture를 fail closed한다", () => {
  for (const target of [
    "darwin-x64",
    "linux-arm64",
    "win32-arm64",
    "freebsd-x64"
  ]) {
    assert.throws(
      () => desktopInstallerTarget(target),
      /지원하는 installer target/u
    );
  }
});

test("ci-test-only는 release/signing 환경이 조금이라도 섞이면 fail closed한다", () => {
  assert.deepEqual(
    resolveDesktopInstallerBuildRequest("linux-x64", {}, "3.0.0"),
    { channel: "ci-test-only", release: null }
  );
  for (const [key, value] of [
    ["KIRINUKI_RELEASE_TAG", "v3.0.0"],
    ["KIRINUKI_LINUX_SIGNING_FINGERPRINT", "A".repeat(40)],
    ["CSC_LINK", "certificate"]
  ] as const) {
    assert.throws(
      () => resolveDesktopInstallerBuildRequest(
        "linux-x64",
        { [key]: value },
        "3.0.0"
      ),
      /ci-test-only installer/u
    );
  }
});

test("public-release는 target별 exact credential과 tag/commit 없이는 통과하지 않는다", () => {
  const common = {
    KIRINUKI_INSTALLER_CHANNEL: "public-release",
    KIRINUKI_RELEASE_TAG: "v3.0.0",
    KIRINUKI_RELEASE_COMMIT: "a".repeat(40),
    KIRINUKI_RELEASE_PROVENANCE_ARCHIVE_PATH:
      "/safe/Kirinuki-Engine-source-provenance.tar.gz",
    KIRINUKI_RELEASE_PROVENANCE_ARCHIVE_SHA256: "b".repeat(64),
    KIRINUKI_RELEASE_PROVENANCE_ROOT: "/safe/provenance"
  };
  assert.throws(
    () => resolveDesktopInstallerBuildRequest("win32-x64", common, "3.0.0"),
    /WIN_CSC_LINK/u
  );
  assert.throws(
    () => resolveDesktopInstallerBuildRequest("linux-x64", {
      ...common,
      KIRINUKI_RELEASE_TAG: "v3.0.1",
      KIRINUKI_LINUX_SIGNING_FINGERPRINT: "A".repeat(40),
      KIRINUKI_LINUX_SIGNING_PASSPHRASE: "secret"
    }, "3.0.0"),
    /package version/u
  );
  assert.deepEqual(
    resolveDesktopInstallerBuildRequest("linux-x64", {
      ...common,
      KIRINUKI_LINUX_SIGNING_FINGERPRINT: "A".repeat(40),
      KIRINUKI_LINUX_SIGNING_PASSPHRASE: "secret"
    }, "3.0.0"),
    {
      channel: "public-release",
      release: {
        tag: "v3.0.0",
        commit: "a".repeat(40),
        provenanceArchivePath:
          "/safe/Kirinuki-Engine-source-provenance.tar.gz",
        provenanceArchiveSha256: "b".repeat(64),
        provenanceRoot: "/safe/provenance",
        signingIdentity: "A".repeat(40)
      }
    }
  );
});
