import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

import {
  pinnedElectronArchiveChecksums
} from "../scripts/electron-archive-checksums.js";

const require = createRequire(import.meta.url);

test("npm-integrity-bound Electron package의 exact target archive checksum만 packager에 제공한다", async () => {
  const checksums = await pinnedElectronArchiveChecksums({
    electronPackageRoot: path.dirname(require.resolve("electron/package.json")),
    version: "43.4.1",
    platform: "linux",
    arch: "x64"
  });
  assert.deepEqual(checksums, {
    "electron-v43.4.1-linux-x64.zip":
      "79d4efd69f0ccf1fc11891ea5075329c7b3faddad79a08d9fb395bbd63169acf"
  });
});

test("Electron version·target checksum 누락과 symlink checksum map은 fail closed한다", async (t) => {
  if (process.platform === "win32") {
    t.skip("symlink 생성 권한에 의존하지 않는 POSIX provenance test입니다.");
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "kirinuki-electron-provenance-"));
  const packageRoot = path.join(root, "electron");
  const outside = path.join(root, "outside.json");
  try {
    await mkdir(packageRoot);
    await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
      name: "electron",
      version: "43.4.1"
    }));
    await writeFile(outside, JSON.stringify({
      "electron-v43.4.1-linux-x64.zip": "a".repeat(64)
    }));
    await symlink(outside, path.join(packageRoot, "checksums.json"));
    await assert.rejects(pinnedElectronArchiveChecksums({
      electronPackageRoot: packageRoot,
      version: "43.4.1",
      platform: "linux",
      arch: "x64"
    }), /regular file/u);
    await rm(path.join(packageRoot, "checksums.json"));
    await writeFile(path.join(packageRoot, "checksums.json"), "{}\n");
    await assert.rejects(pinnedElectronArchiveChecksums({
      electronPackageRoot: packageRoot,
      version: "43.4.1",
      platform: "linux",
      arch: "x64"
    }), /exact target archive/u);
    await assert.rejects(pinnedElectronArchiveChecksums({
      electronPackageRoot: packageRoot,
      version: "43.4.0",
      platform: "linux",
      arch: "x64"
    }), /package identity/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
