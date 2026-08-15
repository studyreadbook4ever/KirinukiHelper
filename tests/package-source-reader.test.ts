import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readPackageSourceFile } from "../scripts/package-source-reader.js";

function runGit(root: string, args: readonly string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: root,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0 && signal === null) {
        resolve(Buffer.concat(stdout).toString("utf8").trim());
        return;
      }
      reject(new Error(Buffer.concat(stderr).toString("utf8")));
    });
  });
}

async function commitAll(root: string, message: string): Promise<string> {
  await runGit(root, ["add", "--all"]);
  await runGit(root, [
    "-c",
    "user.name=Kirinuki Test",
    "-c",
    "user.email=kirinuki-test@example.invalid",
    "commit",
    "--quiet",
    "-m",
    message
  ]);
  return await runGit(root, ["rev-parse", "HEAD"]);
}

test("공개 package source는 worktree symlink를 거부하고 release commit blob에 결속된다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kirinuki-package-source-"));
  try {
    await runGit(root, ["init", "--quiet"]);
    await mkdir(path.join(root, "public-shell"));
    const sourcePath = path.join(root, "public-shell", "index.html");
    await writeFile(sourcePath, "committed public shell\n");
    const revision = await commitAll(root, "regular public shell");

    await rm(sourcePath);
    await symlink("/etc/passwd", sourcePath);
    await assert.rejects(
      readPackageSourceFile({
        repositoryRoot: root,
        repositoryPath: "public-shell/index.html"
      }),
      /심볼릭 링크/u
    );
    assert.equal(
      (await readPackageSourceFile({
        repositoryRoot: root,
        repositoryPath: "public-shell/index.html",
        sourceRevision: revision
      })).toString("utf8"),
      "committed public shell\n"
    );

    const symlinkRevision = await commitAll(root, "symlink public shell");
    await assert.rejects(
      readPackageSourceFile({
        repositoryRoot: root,
        repositoryPath: "public-shell/index.html",
        sourceRevision: symlinkRevision
      }),
      /100644 regular blob/u
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("공개 package source는 정규화되지 않은 repository 경로를 거부한다", async () => {
  await assert.rejects(
    readPackageSourceFile({
      repositoryRoot: process.cwd(),
      repositoryPath: "public-shell/../package.json"
    }),
    /안전하지 않습니다/u
  );
});
