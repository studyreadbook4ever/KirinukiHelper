import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { readPackageSourceFile } from "./package-source-reader.js";

const root = fileURLToPath(new URL("..", import.meta.url));
if (process.argv.slice(2).length > 0) {
  throw new TypeError("사용법: verify-web-package-reproducibility.ts");
}

interface PackageResult {
  readonly archive: Buffer;
  readonly archiveMode: number;
  readonly checksum: Buffer;
  readonly checksumMode: number;
  readonly sha256: string;
}

function runPackagerWithUmask(
  timezone: string,
  mask: number
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const previousMask = process.umask(mask);
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(process.execPath, [
        "--import",
        "tsx",
        path.join(root, "scripts", "package-web.ts")
      ], {
        cwd: root,
        env: {
          ...process.env,
          TZ: timezone
        },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } finally {
      process.umask(previousMask);
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0 && signal === null) {
        resolve();
        return;
      }
      reject(new Error(
        `공개 web packager가 TZ=${timezone}, umask=${mask.toString(8)}에서 실패했습니다: `
          + `${signal || String(code)}\n`
          + Buffer.concat(stderr).toString("utf8").trim()
          + (stdout.length > 0
            ? `\nstdout:\n${Buffer.concat(stdout).toString("utf8").trim()}`
            : "")
      ));
    });
  });
}

async function packageResult(
  archivePath: string,
  checksumPath: string,
  timezone: string,
  mask: number
): Promise<PackageResult> {
  await runPackagerWithUmask(timezone, mask);
  const [archive, checksum, archiveMetadata, checksumMetadata] = await Promise.all([
    readFile(archivePath),
    readFile(checksumPath),
    stat(archivePath),
    stat(checksumPath)
  ]);
  return {
    archive,
    archiveMode: archiveMetadata.mode & 0o777,
    checksum,
    checksumMode: checksumMetadata.mode & 0o777,
    sha256: createHash("sha256").update(archive).digest("hex")
  };
}

const metadata = JSON.parse(
  (await readPackageSourceFile({
    repositoryRoot: root,
    repositoryPath: "package.json",
    ...(process.env.KIRINUKI_RELEASE_SOURCE_REVISION === undefined
      ? {}
      : { sourceRevision: process.env.KIRINUKI_RELEASE_SOURCE_REVISION })
  })).toString("utf8")
) as { readonly version?: string };
if (
  typeof metadata.version !== "string"
  || !/^\d+\.\d+\.\d+$/u.test(metadata.version)
) {
  throw new Error("package.json version이 유효하지 않습니다.");
}
const archivePath = path.join(
  root,
  "dist",
  `kirinuki-web-v${metadata.version}.zip`
);
const checksumPath = `${archivePath}.sha256`;
const permissive = await packageResult(
  archivePath,
  checksumPath,
  "UTC",
  0o022
);
const restrictive = await packageResult(
  archivePath,
  checksumPath,
  "Asia/Seoul",
  0o077
);
if (!permissive.archive.equals(restrictive.archive)) {
  throw new Error(
    "공개 web ZIP bytes가 builder TZ/umask에 따라 달라집니다: "
      + `${permissive.sha256} != ${restrictive.sha256}`
  );
}
if (!permissive.checksum.equals(restrictive.checksum)) {
  throw new Error("공개 web ZIP checksum sidecar가 builder TZ/umask에 따라 달라집니다.");
}
for (const result of [permissive, restrictive]) {
  if (result.archiveMode !== 0o644 || result.checksumMode !== 0o644) {
    throw new Error("공개 web ZIP과 checksum sidecar의 mode가 0644로 고정되지 않았습니다.");
  }
}
console.log(JSON.stringify({
  ok: true,
  archive: path.relative(root, archivePath),
  bytes: restrictive.archive.byteLength,
  sha256: restrictive.sha256,
  comparedBuilders: [
    { timezone: "UTC", umask: "022" },
    { timezone: "Asia/Seoul", umask: "077" }
  ]
}, null, 2));
