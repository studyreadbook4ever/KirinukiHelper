import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyWindowsPreviewReleaseDirectory } from
  "../scripts/windows-preview-release.js";
import {
  WINDOWS_PREVIEW_INSTALLER_FILE,
  WINDOWS_PREVIEW_RELEASE_CHECKSUM_FILE,
  WINDOWS_PREVIEW_RELEASE_MANIFEST_FILE,
  WINDOWS_PREVIEW_RELEASE_MANIFEST_SCHEMA,
  WINDOWS_PREVIEW_SOURCE_OFFER_FILE
} from "../src/desktop/installer-contract.js";

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

test("Windows preview readback은 exact 4-file unsigned prerelease만 허용한다", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kirinuki-win-preview-"));
  try {
    const installer = Buffer.alloc(1_000_001, 0x4b);
    const sourceOffer = Buffer.from("Kirinuki Windows source offer\n".repeat(8));
    const installerSha256 = sha256(installer);
    const sourceOfferSha256 = sha256(sourceOffer);
    const manifest = {
      schema: WINDOWS_PREVIEW_RELEASE_MANIFEST_SCHEMA,
      status: "verified-windows-preview",
      tag: "windows-preview-v3.0.20",
      commit: "a".repeat(40),
      version: "3.0.20",
      target: "win32-x64",
      platform: "win32",
      arch: "x64",
      channel: "github-prerelease",
      signed: false,
      smartScreenWarningExpected: true,
      lifecycleVerification: ["nsis-per-user-install"],
      artifact: {
        fileName: WINDOWS_PREVIEW_INSTALLER_FILE,
        bytes: installer.byteLength,
        sha256: installerSha256
      },
      sourceOffer: {
        fileName: WINDOWS_PREVIEW_SOURCE_OFFER_FILE,
        bytes: sourceOffer.byteLength,
        sha256: sourceOfferSha256
      },
      sourceCiEvidence: {
        fileName: "UNSIGNED-TEST-ONLY-installer-manifest.json",
        bytes: 1024,
        sha256: "b".repeat(64)
      }
    };
    await Promise.all([
      writeFile(path.join(directory, WINDOWS_PREVIEW_INSTALLER_FILE), installer),
      writeFile(path.join(directory, WINDOWS_PREVIEW_SOURCE_OFFER_FILE), sourceOffer),
      writeFile(
        path.join(directory, WINDOWS_PREVIEW_RELEASE_MANIFEST_FILE),
        `${JSON.stringify(manifest, null, 2)}\n`
      ),
      writeFile(
        path.join(directory, WINDOWS_PREVIEW_RELEASE_CHECKSUM_FILE),
        `${installerSha256}  ${WINDOWS_PREVIEW_INSTALLER_FILE}\n`
          + `${sourceOfferSha256}  ${WINDOWS_PREVIEW_SOURCE_OFFER_FILE}\n`
      )
    ]);
    await verifyWindowsPreviewReleaseDirectory(directory);

    await writeFile(
      path.join(directory, WINDOWS_PREVIEW_RELEASE_CHECKSUM_FILE),
      `${"0".repeat(64)}  ${WINDOWS_PREVIEW_INSTALLER_FILE}\n`
    );
    await assert.rejects(
      verifyWindowsPreviewReleaseDirectory(directory),
      /checksum 파일이 artifact와 다릅니다/u
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
