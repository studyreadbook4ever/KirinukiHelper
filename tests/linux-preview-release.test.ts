import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LINUX_PREVIEW_INSTALLER_FILE,
  LINUX_PREVIEW_RELEASE_CHECKSUM_FILE,
  LINUX_PREVIEW_RELEASE_MANIFEST_FILE,
  LINUX_PREVIEW_RELEASE_MANIFEST_SCHEMA
} from "../src/desktop/installer-contract.js";
import {
  verifyLinuxPreviewReleaseAssets
} from "../scripts/linux-preview-release.js";
import {
  loadVerifiedWebEngineLinuxPreviewChannel
} from "../scripts/web-engine-linux-preview-channel.js";

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

test("Linux preview readback은 exact 3-file unsigned preview contract만 허용한다", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kirinuki-linux-preview-"));
  const installer = new TextEncoder().encode("linux preview deb fixture");
  const installerSha256 = sha256(installer);
  const manifest = {
    schema: LINUX_PREVIEW_RELEASE_MANIFEST_SCHEMA,
    status: "verified-linux-preview",
    channel: "linux-preview",
    target: "linux-x64",
    tag: "v3.0.4",
    commit: "a".repeat(40),
    version: "3.0.4",
    artifact: {
      fileName: LINUX_PREVIEW_INSTALLER_FILE,
      bytes: installer.byteLength,
      sha256: installerSha256
    },
    sourceEvidence: {
      channel: "ci-test-only",
      fileName: "UNSIGNED-TEST-ONLY-Kirinuki-Engine-linux-x64.deb",
      manifestFileName: "UNSIGNED-TEST-ONLY-installer-manifest.json",
      manifestSha256: "b".repeat(64),
      status: "unsigned-ci-test-only-never-publish"
    },
    distribution: {
      support: "debian-ubuntu-linux-x64-preview",
      signedDeb: false,
      stableRelease: false,
      buildProvenance: "github-artifact-attestation"
    }
  };
  try {
    await Promise.all([
      writeFile(path.join(directory, LINUX_PREVIEW_INSTALLER_FILE), installer),
      writeFile(
        path.join(directory, LINUX_PREVIEW_RELEASE_MANIFEST_FILE),
        `${JSON.stringify(manifest, null, 2)}\n`
      ),
      writeFile(
        path.join(directory, LINUX_PREVIEW_RELEASE_CHECKSUM_FILE),
        `${installerSha256}  ${LINUX_PREVIEW_INSTALLER_FILE}\n`
      )
    ]);
    const verified = await verifyLinuxPreviewReleaseAssets(directory);
    assert.equal(verified.tag, "v3.0.4");
    assert.equal(verified.installer.sha256, installerSha256);

    const assetNames = [
      LINUX_PREVIEW_INSTALLER_FILE,
      LINUX_PREVIEW_RELEASE_CHECKSUM_FILE,
      LINUX_PREVIEW_RELEASE_MANIFEST_FILE
    ];
    const identities = new Map<string, { bytes: number; sha256: string }>();
    for (const [fileName, contents] of [
      [LINUX_PREVIEW_INSTALLER_FILE, installer],
      [
        LINUX_PREVIEW_RELEASE_CHECKSUM_FILE,
        `${installerSha256}  ${LINUX_PREVIEW_INSTALLER_FILE}\n`
      ],
      [
        LINUX_PREVIEW_RELEASE_MANIFEST_FILE,
        `${JSON.stringify(manifest, null, 2)}\n`
      ]
    ] as const) {
      const bytes = typeof contents === "string"
        ? new TextEncoder().encode(contents)
        : contents;
      identities.set(fileName, { bytes: bytes.byteLength, sha256: sha256(bytes) });
    }
    const remote = {
      draft: false,
      prerelease: true,
      tag_name: "v3.0.4",
      assets: assetNames.map((fileName) => ({
        name: fileName,
        state: "uploaded",
        size: identities.get(fileName)!.bytes,
        digest: `sha256:${identities.get(fileName)!.sha256}`,
        browser_download_url:
          `https://github.com/studyreadbook4ever/KirinukiHelper/releases/download/v3.0.4/${fileName}`
      }))
    };
    const channel = await loadVerifiedWebEngineLinuxPreviewChannel({
      directory,
      fetchImpl: async (input) => {
        assert.equal(
          String(input),
          "https://api.github.com/repos/studyreadbook4ever/KirinukiHelper/releases/tags/v3.0.4"
        );
        return new Response(JSON.stringify(remote), { status: 200 });
      }
    });
    assert.equal(channel.status, "verified-linux-preview");
    assert.deepEqual(Object.keys(channel.installers), ["linux-x64"]);
    await assert.rejects(
      loadVerifiedWebEngineLinuxPreviewChannel({
        directory,
        fetchImpl: async () => new Response(JSON.stringify({
          ...remote,
          prerelease: false
        }), { status: 200 })
      }),
      /exact published Linux prerelease/u
    );

    await writeFile(path.join(directory, "unexpected.txt"), "no");
    await assert.rejects(
      verifyLinuxPreviewReleaseAssets(directory),
      /exact allowlist/u
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
