import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertSafeRepositoryPath(repositoryPath: string): void {
  invariant(
    repositoryPath.length > 0
      && !path.isAbsolute(repositoryPath)
      && !repositoryPath.includes("\\")
      && !repositoryPath.includes("\0")
      && !repositoryPath.includes("\n")
      && repositoryPath.split("/").every((part) => (
        part.length > 0 && part !== "." && part !== ".."
      )),
    `패키지 source 경로가 안전하지 않습니다: ${repositoryPath}`
  );
}

function gitBlobObjectId(content: Uint8Array, objectId: string): string {
  const bytes = Buffer.from(
    content.buffer,
    content.byteOffset,
    content.byteLength
  );
  const digest = createHash(objectId.length === 40 ? "sha1" : "sha256");
  digest.update(`blob ${String(bytes.byteLength)}\0`, "utf8");
  digest.update(bytes);
  return digest.digest("hex");
}

function runGit(
  repositoryRoot: string,
  args: readonly string[]
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const environment = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))
      ),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_NO_REPLACE_OBJECTS: "1"
    } satisfies NodeJS.ProcessEnv;
    const child = spawn("git", ["--no-replace-objects", ...args], {
      cwd: repositoryRoot,
      env: environment,
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
        resolve(Buffer.concat(stdout));
        return;
      }
      reject(new Error(
        signal
          ? `git가 ${signal} 신호로 종료됐습니다.`
          : `git가 종료 코드 ${String(code)}로 끝났습니다.`
            + (stderr.length > 0
              ? `\n${Buffer.concat(stderr).toString("utf8").trim()}`
              : "")
      ));
    });
  });
}

async function readCommittedRegularBlob(
  repositoryRoot: string,
  repositoryPath: string,
  revision: string
): Promise<Buffer> {
  invariant(
    /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(revision),
    "릴리스 패키지의 source revision이 올바르지 않습니다."
  );
  const record = (await runGit(repositoryRoot, [
    "-c",
    "core.quotepath=false",
    "ls-tree",
    "-z",
    revision,
    "--",
    repositoryPath
  ])).toString("utf8");
  const match = /^(\d{6}) blob ([0-9a-f]{40}|[0-9a-f]{64})\t([^\0]+)\0$/u
    .exec(record);
  invariant(
    match !== null && match[3] === repositoryPath,
    `release commit에 source가 정확히 하나 존재하지 않습니다: ${repositoryPath}`
  );
  invariant(
    match[1] === "100644",
    `릴리스 source는 100644 regular blob이어야 합니다: ${repositoryPath} (${match[1]})`
  );
  const objectId = match[2]!;
  const content = await runGit(repositoryRoot, ["cat-file", "blob", objectId]);
  invariant(
    gitBlobObjectId(content, objectId) === objectId,
    `릴리스 source blob identity가 일치하지 않습니다: ${repositoryPath}`
  );
  return content;
}

async function readWorktreeRegularFile(
  repositoryRoot: string,
  repositoryPath: string
): Promise<Buffer> {
  const canonicalRoot = await realpath(repositoryRoot);
  const expectedPath = path.join(canonicalRoot, ...repositoryPath.split("/"));
  const unresolvedMetadata = await lstat(expectedPath);
  invariant(
    !unresolvedMetadata.isSymbolicLink(),
    `릴리스 source 경로에 심볼릭 링크가 있습니다: ${repositoryPath}`
  );
  const canonicalSource = await realpath(expectedPath);
  invariant(
    canonicalSource === expectedPath,
    `릴리스 source 경로에 심볼릭 링크가 있습니다: ${repositoryPath}`
  );
  const handle = await open(
    expectedPath,
    constants.O_RDONLY | constants.O_NOFOLLOW
  );
  try {
    const metadata = await handle.stat();
    invariant(
      metadata.isFile(),
      `릴리스 source가 regular file이 아닙니다: ${repositoryPath}`
    );
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function readPackageSourceFile({
  repositoryRoot,
  repositoryPath,
  sourceRevision
}: {
  readonly repositoryRoot: string;
  readonly repositoryPath: string;
  readonly sourceRevision?: string;
}): Promise<Buffer> {
  assertSafeRepositoryPath(repositoryPath);
  return sourceRevision === undefined
    ? await readWorktreeRegularFile(repositoryRoot, repositoryPath)
    : await readCommittedRegularBlob(
      await realpath(repositoryRoot),
      repositoryPath,
      sourceRevision
    );
}
