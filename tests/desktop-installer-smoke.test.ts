import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  verifyLinuxDesktopEntryProtocol,
  verifyMountedMacDiskImageApplication
} from "../scripts/desktop-installer-smoke.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const validInfoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>kr.eff0rtchung.kirinuki</string>
  <key>CFBundleURLTypes</key>
  <array><dict><key>CFBundleURLSchemes</key><array><string>kirinuki-engine</string></array></dict></array>
</dict>
</plist>`;

async function writeValidMacApplication(appRoot: string): Promise<void> {
  await mkdir(path.join(appRoot, "Contents", "MacOS"), { recursive: true });
  await Promise.all([
    writeFile(path.join(appRoot, "Contents", "Info.plist"), validInfoPlist),
    writeFile(path.join(appRoot, "Contents", "MacOS", "Kirinuki"), "fixture")
  ]);
}

test("macOS electron-builder receives the exact .app bundle instead of its wrapper", async () => {
  const source = await readFile(path.join(
    root,
    "scripts/package-desktop-installer.ts"
  ), "utf8");
  assert.match(
    source,
    /"--prepackaged",\s*target === "darwin-arm64"\s*\? path\.join\(prepackaged\.outputDirectory, "Kirinuki\.app"\)\s*:\s*prepackaged\.outputDirectory/u
  );
});

test("macOS installer smoke always detaches its exact mount point and fails closed", async () => {
  const source = await readFile(path.join(
    root,
    "scripts/desktop-installer-smoke.ts"
  ), "utf8");
  assert.match(
    source,
    /attachAttempted = true;[\s\S]*finally \{[\s\S]*if \(attachAttempted\)[\s\S]*\["detach", mountRoot, "-force"\]/u
  );
  assert.match(
    source,
    /attachSucceeded && !detachConfirmed/u
  );
});

test("Linux desktop protocol parser accepts one exact group, MIME, and argv", () => {
  assert.doesNotThrow(() => verifyLinuxDesktopEntryProtocol([
    "[Desktop Entry]",
    "Name=Kirinuki",
    "MimeType=x-scheme-handler/kirinuki-engine;",
    "Exec=/opt/Kirinuki/Kirinuki %U",
    "[Desktop Action Documentation]",
    "Name=Documentation"
  ].join("\n")));
});

test("Linux desktop protocol parser rejects ambiguous MIME, Exec, group, and key contracts", () => {
  const invalidEntries = [
    [
      "[Desktop Entry]",
      "MimeType=x-scheme-handler/kirinuki-engine",
      "Exec=/opt/Kirinuki/Kirinuki %U"
    ],
    [
      "[Desktop Entry]",
      "MimeType=x-scheme-handler/kirinuki-engine-extra;",
      "Exec=/opt/Kirinuki/Kirinuki %U"
    ],
    [
      "[Desktop Entry]",
      "MimeType=x-scheme-handler/kirinuki-engine;x-scheme-handler/kirinuki-engine;",
      "Exec=/opt/Kirinuki/Kirinuki %U"
    ],
    [
      "[Desktop Entry]",
      "MimeType=x-scheme-handler/kirinuki-engine;",
      "MimeType=video/mp4;",
      "Exec=/opt/Kirinuki/Kirinuki %U"
    ],
    [
      "[Desktop Entry]",
      "MimeType=x-scheme-handler/kirinuki-engine;",
      "Exec=/opt/Kirinuki/Kirinuki %u"
    ],
    [
      "[Desktop Entry]",
      "MimeType=x-scheme-handler/kirinuki-engine;",
      "Exec=/opt/Kirinuki/Kirinuki %U",
      "[Desktop Entry]"
    ],
    [
      "[Desktop Entry]",
      "Name=Kirinuki",
      "Name=Duplicate",
      "MimeType=x-scheme-handler/kirinuki-engine;",
      "Exec=/opt/Kirinuki/Kirinuki %U"
    ],
    [
      "[Desktop Action Wrong]",
      "MimeType=x-scheme-handler/kirinuki-engine;",
      "[Desktop Entry]",
      "Exec=/opt/Kirinuki/Kirinuki %U"
    ],
    [
      "[Desktop Action Only]",
      "Name=No desktop entry"
    ]
  ];
  for (const entry of invalidEntries) {
    assert.throws(() => verifyLinuxDesktopEntryProtocol(entry.join("\n")));
  }
});

test("macOS DMG verifier rejects symlinked Contents and MacOS intermediates", async (context) => {
  await context.test("Contents symlink", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-dmg-contents-link-"));
    const mountRoot = path.join(temporaryRoot, "mount");
    const appRoot = path.join(mountRoot, "Kirinuki.app");
    try {
      await mkdir(appRoot, { recursive: true });
      await writeValidMacApplication(path.join(temporaryRoot, "carrier.app"));
      await symlink(
        path.join(temporaryRoot, "carrier.app", "Contents"),
        path.join(appRoot, "Contents")
      );
      await assert.rejects(
        verifyMountedMacDiskImageApplication(mountRoot),
        /Contents가 symlink 없는 directory가 아닙니다/u
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  await context.test("MacOS symlink", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-dmg-macos-link-"));
    const mountRoot = path.join(temporaryRoot, "mount");
    const contentsRoot = path.join(mountRoot, "Kirinuki.app", "Contents");
    const externalMacos = path.join(temporaryRoot, "external-macos");
    try {
      await mkdir(contentsRoot, { recursive: true });
      await mkdir(externalMacos);
      await Promise.all([
        writeFile(path.join(contentsRoot, "Info.plist"), validInfoPlist),
        writeFile(path.join(externalMacos, "Kirinuki"), "fixture")
      ]);
      await symlink(externalMacos, path.join(contentsRoot, "MacOS"));
      await assert.rejects(
        verifyMountedMacDiskImageApplication(mountRoot),
        /MacOS가 symlink 없는 directory가 아닙니다/u
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});

test("macOS DMG verifier accepts one exact top-level application", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-dmg-valid-"));
  const mountRoot = path.join(temporaryRoot, "mount");
  try {
    await writeValidMacApplication(path.join(mountRoot, "Kirinuki.app"));
    await symlink("/Applications", path.join(mountRoot, "Applications"));
    const result = await verifyMountedMacDiskImageApplication(mountRoot);
    assert.equal(result.appRoot, path.join(mountRoot, "Kirinuki.app"));
    assert.equal(result.infoPlist, validInfoPlist);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("macOS DMG verifier rejects electron-builder wrapper nesting", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-dmg-nested-"));
  const mountRoot = path.join(temporaryRoot, "mount");
  try {
    await writeValidMacApplication(path.join(
      mountRoot,
      "Kirinuki.app",
      "Kirinuki.app"
    ));
    await assert.rejects(
      verifyMountedMacDiskImageApplication(mountRoot),
      /nested wrapper는 허용하지 않습니다/u
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("macOS DMG verifier rejects renamed, duplicate, and symlink app bundles", async (context) => {
  await context.test("renamed", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-dmg-renamed-"));
    const mountRoot = path.join(temporaryRoot, "mount");
    try {
      await writeValidMacApplication(path.join(mountRoot, "Renamed.app"));
      await assert.rejects(
        verifyMountedMacDiskImageApplication(mountRoot),
        /이름\/형식이 exact contract와 다릅니다/u
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  await context.test("duplicate", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-dmg-duplicate-"));
    const mountRoot = path.join(temporaryRoot, "mount");
    try {
      await Promise.all([
        writeValidMacApplication(path.join(mountRoot, "Kirinuki.app")),
        writeValidMacApplication(path.join(mountRoot, "Unexpected.app"))
      ]);
      await assert.rejects(
        verifyMountedMacDiskImageApplication(mountRoot),
        /정확히 하나가 아닙니다/u
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  await context.test("symlink", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-dmg-symlink-"));
    const mountRoot = path.join(temporaryRoot, "mount");
    const realApp = path.join(temporaryRoot, "real-app");
    try {
      await mkdir(mountRoot);
      await writeValidMacApplication(realApp);
      await symlink(realApp, path.join(mountRoot, "Kirinuki.app"));
      await assert.rejects(
        verifyMountedMacDiskImageApplication(mountRoot),
        /이름\/형식이 exact contract와 다릅니다/u
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
