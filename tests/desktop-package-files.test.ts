import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createPackage } from "@electron/asar";

import {
  DESKTOP_ASAR_PACKAGE_FILES,
  DESKTOP_LEGAL_PACKAGE_FILES,
  assertExactRegularFileTree,
  assertExactRegularFileTreeSnapshot,
  copyExactRegularFileTree,
  desktopAsarLookupPath,
  snapshotRegularFileTree,
  snapshotExactRegularFileTree,
  verifyDesktopAsar
} from "../scripts/desktop-package-files.js";

test("ASAR canonical 경로는 조회 시에만 대상 OS 구분자로 바뀐다", () => {
  assert.equal(
    desktopAsarLookupPath("web/editor/audseg-worker.js", "/"),
    "web/editor/audseg-worker.js"
  );
  assert.equal(
    desktopAsarLookupPath("web/editor/audseg-worker.js", "\\"),
    "web\\editor\\audseg-worker.js"
  );
  assert.throws(
    () => desktopAsarLookupPath("../outside", "\\"),
    /allowlist 경로/u
  );
});

async function fixture(): Promise<Readonly<{
  parent: string;
  source: string;
  destination: string;
}>> {
  const parent = await mkdtemp(path.join(os.tmpdir(), "kirinuki-desktop-files-test-"));
  const source = path.join(parent, "source");
  const destination = path.join(parent, "destination");
  await mkdir(path.join(source, "nested"), { recursive: true });
  await Promise.all([
    writeFile(path.join(source, "root.txt"), "root\n", { mode: 0o644 }),
    writeFile(path.join(source, "nested", "asset.txt"), "asset\n", { mode: 0o644 })
  ]);
  return { parent, source, destination };
}

test("desktop package allowlists stay explicit and compose the ASAR set", () => {
  assert.equal(DESKTOP_LEGAL_PACKAGE_FILES.length, 8);
  assert.deepEqual(
    DESKTOP_ASAR_PACKAGE_FILES.filter((entry) => entry.startsWith("web/")),
    []
  );
  assert.equal(DESKTOP_ASAR_PACKAGE_FILES.includes("preload.cjs"), true);
  assert.equal(
    DESKTOP_ASAR_PACKAGE_FILES.some((entry) => entry.includes("companion")),
    false
  );
  assert.deepEqual(
    DESKTOP_ASAR_PACKAGE_FILES.filter((entry) => entry.startsWith("legal/")),
    DESKTOP_LEGAL_PACKAGE_FILES.map((entry) => `legal/${entry}`).sort()
  );
});

test("exact desktop resource copy rejects contamination and copies only identities", async () => {
  const paths = await fixture();
  const expected = ["nested/asset.txt", "root.txt"];
  try {
    const identities = await copyExactRegularFileTree({
      sourceRoot: paths.source,
      destinationRoot: paths.destination,
      expectedFiles: expected,
      label: "test resource"
    });
    assert.deepEqual(
      identities.map(({ relativePath }) => relativePath),
      expected
    );
    await assertExactRegularFileTree(
      paths.destination,
      expected,
      "test destination"
    );

    await writeFile(path.join(paths.source, "secret.env"), "do-not-package\n");
    await assert.rejects(
      copyExactRegularFileTree({
        sourceRoot: paths.source,
        destinationRoot: path.join(paths.parent, "contaminated-output"),
        expectedFiles: expected,
        label: "contaminated resource"
      }),
      /파일 목록이 allowlist와 다릅니다/u
    );
  } finally {
    await rm(paths.parent, { recursive: true, force: true });
  }
});

test("exact desktop resource copy rejects source symlinks", {
  skip: process.platform === "win32"
}, async () => {
  const paths = await fixture();
  try {
    await rm(path.join(paths.source, "root.txt"));
    await symlink(
      path.join(paths.source, "nested", "asset.txt"),
      path.join(paths.source, "root.txt")
    );
    await assert.rejects(
      copyExactRegularFileTree({
        sourceRoot: paths.source,
        destinationRoot: paths.destination,
        expectedFiles: ["nested/asset.txt", "root.txt"],
        label: "symlinked resource"
      }),
      /심볼릭 링크/u
    );
  } finally {
    await rm(paths.parent, { recursive: true, force: true });
  }
});

test("runtime resource snapshots preserve exact empty directories and file identities", async () => {
  const paths = await fixture();
  try {
    await mkdir(path.join(paths.source, "ko.lproj"));
    const snapshot = await snapshotRegularFileTree(
      paths.source,
      "runtime resource fixture"
    );
    assert.deepEqual(snapshot.directories, ["ko.lproj", "nested"]);
    assert.deepEqual(
      snapshot.files.map(({ relativePath }) => relativePath),
      ["nested/asset.txt", "root.txt"]
    );
    await assertExactRegularFileTreeSnapshot(
      paths.source,
      snapshot,
      "runtime resource fixture"
    );

    await writeFile(path.join(paths.source, "root.txt"), "changed\n");
    await assert.rejects(
      assertExactRegularFileTreeSnapshot(
        paths.source,
        snapshot,
        "changed runtime resource fixture"
      ),
      /파일 identity가 pinned snapshot과 다릅니다/u
    );
  } finally {
    await rm(paths.parent, { recursive: true, force: true });
  }
});

test("runtime resource snapshots reject later empty-directory contamination", async () => {
  const paths = await fixture();
  try {
    const snapshot = await snapshotRegularFileTree(
      paths.source,
      "runtime resource fixture"
    );
    await mkdir(path.join(paths.source, "unexpected.lproj"));
    await assert.rejects(
      assertExactRegularFileTreeSnapshot(
        paths.source,
        snapshot,
        "contaminated runtime resource fixture"
      ),
      /디렉터리 목록이 pinned snapshot과 다릅니다/u
    );
  } finally {
    await rm(paths.parent, { recursive: true, force: true });
  }
});

test("ASAR verification rejects extra files and checks every staged byte", async () => {
  const paths = await fixture();
  const archive = path.join(paths.parent, "app.asar");
  const contaminatedArchive = path.join(paths.parent, "contaminated.asar");
  const expected = ["nested/asset.txt", "root.txt"];
  try {
    const identities = await snapshotExactRegularFileTree(
      paths.source,
      expected,
      "test ASAR stage"
    );
    await createPackage(paths.source, archive);
    verifyDesktopAsar(archive, identities);

    await writeFile(path.join(paths.source, "secret.env"), "do-not-package\n");
    await createPackage(paths.source, contaminatedArchive);
    assert.throws(
      () => verifyDesktopAsar(contaminatedArchive, identities),
      /ASAR 파일 목록/u
    );
  } finally {
    await rm(paths.parent, { recursive: true, force: true });
  }
});
