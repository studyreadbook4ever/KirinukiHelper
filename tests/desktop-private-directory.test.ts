import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  rm,
  symlink
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  preparePrivateDirectories
} from "../src/desktop/private-directory.js";
import type {
  PrivateDirectoryFileSystem,
  PrivateDirectoryMetadata
} from "../src/desktop/private-directory.js";
import type { DesktopPlatform } from "../src/desktop/runtime-spec.js";

const hostPlatform = process.platform as DesktopPlatform;

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function missingPathError(): NodeJS.ErrnoException {
  return Object.assign(new Error("missing"), { code: "ENOENT" });
}

function directoryMetadata({
  mode = 0o40700,
  symbolicLink = false
}: {
  readonly mode?: number;
  readonly symbolicLink?: boolean;
} = {}): PrivateDirectoryMetadata {
  return {
    mode,
    isDirectory: () => !symbolicLink,
    isSymbolicLink: () => symbolicLink
  };
}

test("private desktop roots are created as canonical POSIX 0700 directories", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kirinuki-private-root-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appRoot = path.join(root, "user-data");
  const sessionRoot = path.join(appRoot, "browser-session");

  preparePrivateDirectories([
    { path: appRoot, label: "app" },
    { path: sessionRoot, label: "session", containedBy: appRoot }
  ], { platform: hostPlatform });

  const appMetadata = await lstat(appRoot);
  const sessionMetadata = await lstat(sessionRoot);
  assert.equal(appMetadata.isDirectory(), true);
  assert.equal(appMetadata.isSymbolicLink(), false);
  assert.equal(sessionMetadata.isDirectory(), true);
  assert.equal(sessionMetadata.isSymbolicLink(), false);
  if (hostPlatform !== "win32") {
    assert.equal(appMetadata.mode & 0o7777, 0o700);
    assert.equal(sessionMetadata.mode & 0o7777, 0o700);
  }
});

test("a benign operating-system ancestor symlink does not invalidate managed roots", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kirinuki-private-ancestor-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const canonicalAncestor = path.join(root, "canonical-ancestor");
  const aliasAncestor = path.join(root, "os-owned-alias");
  await mkdir(canonicalAncestor);
  await symlink(
    canonicalAncestor,
    aliasAncestor,
    hostPlatform === "win32" ? "junction" : "dir"
  );
  const appRoot = path.join(aliasAncestor, "Kirinuki");
  const cacheRoot = path.join(appRoot, "cache");

  preparePrivateDirectories([
    { path: appRoot, label: "app" },
    { path: cacheRoot, label: "cache", containedBy: appRoot }
  ], { platform: hostPlatform });

  assert.equal((await lstat(path.join(canonicalAncestor, "Kirinuki"))).isDirectory(), true);
  assert.equal((await lstat(path.join(canonicalAncestor, "Kirinuki", "cache"))).isDirectory(), true);
});

test("a preexisting final-root symlink or junction fails before any mutation", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kirinuki-private-link-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appRoot = path.join(root, "user-data");
  const outside = path.join(root, "outside");
  const linkedRoot = path.join(appRoot, "linked-root");
  const untouchedRoot = path.join(appRoot, "must-not-exist");
  await Promise.all([mkdir(appRoot), mkdir(outside)]);
  if (hostPlatform !== "win32") {
    await chmod(appRoot, 0o755);
  }
  await symlink(
    outside,
    linkedRoot,
    hostPlatform === "win32" ? "junction" : "dir"
  );

  assert.throws(() => preparePrivateDirectories([
    { path: appRoot, label: "app" },
    { path: untouchedRoot, label: "untouched", containedBy: appRoot },
    { path: linkedRoot, label: "linked", containedBy: appRoot }
  ], { platform: hostPlatform }), /심볼릭 링크\/junction/u);
  assert.equal(await pathExists(untouchedRoot), false);
  if (hostPlatform !== "win32") {
    assert.equal((await lstat(appRoot)).mode & 0o7777, 0o755);
  }
});

test("canonical containment rejects an intermediate symlink escape before mkdir", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kirinuki-private-escape-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appRoot = path.join(root, "user-data");
  const outside = path.join(root, "outside");
  const redirect = path.join(appRoot, "redirect");
  const escapedRoot = path.join(redirect, "new-root");
  await Promise.all([mkdir(appRoot), mkdir(outside)]);
  await symlink(
    outside,
    redirect,
    hostPlatform === "win32" ? "junction" : "dir"
  );

  assert.throws(() => preparePrivateDirectories([
    { path: appRoot, label: "app" },
    { path: escapedRoot, label: "escaped", containedBy: appRoot }
  ], { platform: hostPlatform }), /경계를 벗어났습니다/u);
  assert.equal(await pathExists(path.join(outside, "new-root")), false);
});

test("Windows directory preparation skips POSIX chmod semantics", () => {
  let exists = false;
  let mkdirCalls = 0;
  let chmodCalls = 0;
  const fileSystem: PrivateDirectoryFileSystem = {
    lstat: () => {
      if (!exists) {
        throw missingPathError();
      }
      return directoryMetadata();
    },
    mkdir: () => {
      mkdirCalls += 1;
      exists = true;
    },
    chmod: () => {
      chmodCalls += 1;
    },
    realpath: (targetPath) => targetPath
  };

  preparePrivateDirectories([
    { path: "C:\\Users\\User\\Kirinuki", label: "app" }
  ], { platform: "win32", fileSystem });
  assert.equal(mkdirCalls, 1);
  assert.equal(chmodCalls, 0);
});

test("Windows junction metadata and canonical drive escapes fail closed", () => {
  let mutations = 0;
  const junctionFileSystem: PrivateDirectoryFileSystem = {
    lstat: () => directoryMetadata({ symbolicLink: true }),
    mkdir: () => {
      mutations += 1;
    },
    chmod: () => {
      mutations += 1;
    },
    realpath: (targetPath) => targetPath
  };
  assert.throws(() => preparePrivateDirectories([
    { path: "C:\\Users\\User\\Kirinuki", label: "junction" }
  ], {
    platform: "win32",
    fileSystem: junctionFileSystem
  }), /심볼릭 링크\/junction/u);
  assert.equal(mutations, 0);

  const escapedFileSystem: PrivateDirectoryFileSystem = {
    lstat: () => directoryMetadata(),
    mkdir: () => {
      mutations += 1;
    },
    chmod: () => {
      mutations += 1;
    },
    realpath: (targetPath) => (
      targetPath.toLowerCase().endsWith("\\cache")
        ? "D:\\attacker\\cache"
        : "C:\\Users\\User\\Kirinuki"
    )
  };
  assert.throws(() => preparePrivateDirectories([
    { path: "C:\\Users\\User\\Kirinuki", label: "app" },
    {
      path: "C:\\Users\\User\\Kirinuki\\cache",
      label: "cache",
      containedBy: "C:\\Users\\User\\Kirinuki"
    }
  ], {
    platform: "win32",
    fileSystem: escapedFileSystem
  }), /경계를 벗어났습니다/u);
  assert.equal(mutations, 0);
});
