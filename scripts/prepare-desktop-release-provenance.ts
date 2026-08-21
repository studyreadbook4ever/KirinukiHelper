import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  appendFile,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rm
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { extract, list } from "tar";

import {
  DESKTOP_RELEASE_PROVENANCE_ARCHIVE_FILE
} from "../src/desktop/installer-contract.js";
import {
  DESKTOP_RELEASE_PROVENANCE_FILES
} from "./verify-desktop-release-provenance.js";

const root = fileURLToPath(new URL("..", import.meta.url));
export const DESKTOP_RELEASE_PROVENANCE_STAGE_ROOT = path.join(
  root,
  "dist",
  "release-provenance"
);
export const DESKTOP_RELEASE_PROVENANCE_ARCHIVE_PATH = path.join(
  DESKTOP_RELEASE_PROVENANCE_STAGE_ROOT,
  DESKTOP_RELEASE_PROVENANCE_ARCHIVE_FILE
);
export const DESKTOP_RELEASE_PROVENANCE_EXTRACTED_ROOT = path.join(
  DESKTOP_RELEASE_PROVENANCE_STAGE_ROOT,
  "contents"
);

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1_000;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function requiredEnvironment(key: string): string {
  const value = process.env[key];
  invariant(
    typeof value === "string"
      && value.length > 0
      && value.trim() === value
      && !/[\u0000-\u001f\u007f]/u.test(value),
    `release provenance 준비 환경이 빠졌거나 올바르지 않습니다: ${key}`
  );
  return value;
}

function exactHttpsUrl(value: string): URL {
  const url = new URL(value);
  invariant(
    url.protocol === "https:"
      && url.username === ""
      && url.password === ""
      && url.hash === "",
    "release provenance URL은 credential/fragment 없는 HTTPS URL이어야 합니다."
  );
  return url;
}

async function responseWithBoundedRedirects(initialUrl: URL): Promise<Response> {
  let current = initialUrl;
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: Object.freeze({
        "Accept": "application/octet-stream",
        "User-Agent": "Kirinuki-release-provenance/1"
      })
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      invariant(location !== null && redirect < 5, "release provenance redirect가 올바르지 않습니다.");
      current = exactHttpsUrl(new URL(location, current).href);
      continue;
    }
    invariant(response.status === 200 && response.body !== null, "release provenance download가 200 body가 아닙니다.");
    return response;
  }
  throw new Error("release provenance redirect 제한을 넘었습니다.");
}

async function downloadArchive(url: URL, expectedSha256: string): Promise<number> {
  const response = await responseWithBoundedRedirects(url);
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const numericLength = Number(declaredLength);
    invariant(
      Number.isSafeInteger(numericLength)
        && numericLength >= 1024 * 1024
        && numericLength <= MAX_ARCHIVE_BYTES,
      "release provenance Content-Length가 허용 범위를 벗어났습니다."
    );
  }
  const handle = await open(
    DESKTOP_RELEASE_PROVENANCE_ARCHIVE_PATH,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
    0o600
  );
  const hash = createHash("sha256");
  const reader = response.body!.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      invariant(value.byteLength > 0, "release provenance download가 진행되지 않습니다.");
      bytes += value.byteLength;
      invariant(bytes <= MAX_ARCHIVE_BYTES, "release provenance archive가 크기 제한을 넘었습니다.");
      hash.update(value);
      let offset = 0;
      while (offset < value.byteLength) {
        const result = await handle.write(
          value,
          offset,
          value.byteLength - offset,
          bytes - value.byteLength + offset
        );
        invariant(result.bytesWritten > 0, "release provenance archive를 끝까지 쓰지 못했습니다.");
        offset += result.bytesWritten;
      }
    }
    await handle.sync();
  } finally {
    await reader.cancel().catch(() => undefined);
    await handle.close();
  }
  invariant(bytes >= 1024 * 1024, "release provenance archive가 비정상적으로 작습니다.");
  invariant(hash.digest("hex") === expectedSha256, "release provenance archive SHA-256이 secret pin과 다릅니다.");
  return bytes;
}

async function extractExactRegularTree(): Promise<void> {
  const entries: string[] = [];
  const invalid: string[] = [];
  await list({
    file: DESKTOP_RELEASE_PROVENANCE_ARCHIVE_PATH,
    strict: true,
    onentry: (entry) => {
      entries.push(entry.path);
      if (entry.type !== "File" || entry.path.includes("\\")) {
        invalid.push(entry.path);
      }
    }
  });
  invariant(invalid.length === 0, "release provenance archive에 regular file이 아닌 entry가 있습니다.");
  invariant(
    JSON.stringify([...entries].sort()) === JSON.stringify(DESKTOP_RELEASE_PROVENANCE_FILES),
    "release provenance archive entry set가 exact contract와 다릅니다."
  );
  await mkdir(DESKTOP_RELEASE_PROVENANCE_EXTRACTED_ROOT, {
    recursive: false,
    mode: 0o700
  });
  await extract({
    cwd: DESKTOP_RELEASE_PROVENANCE_EXTRACTED_ROOT,
    file: DESKTOP_RELEASE_PROVENANCE_ARCHIVE_PATH,
    strict: true,
    preservePaths: false,
    noChmod: true,
    noMtime: true,
    filter: (entryPath, entry) => (
      "type" in entry
        && entry.type === "File"
        && DESKTOP_RELEASE_PROVENANCE_FILES.includes(entryPath)
    )
  });
  const extracted = (await readdir(
    DESKTOP_RELEASE_PROVENANCE_EXTRACTED_ROOT,
    { withFileTypes: true }
  )).map((entry) => entry.name).sort();
  invariant(
    JSON.stringify(extracted) === JSON.stringify(DESKTOP_RELEASE_PROVENANCE_FILES),
    "release provenance extracted tree가 exact contract와 다릅니다."
  );
  for (const fileName of DESKTOP_RELEASE_PROVENANCE_FILES) {
    const filePath = path.join(DESKTOP_RELEASE_PROVENANCE_EXTRACTED_ROOT, fileName);
    const [metadata, canonical] = await Promise.all([lstat(filePath), realpath(filePath)]);
    const expectedPath = path.resolve(filePath);
    const canonicalPath = path.resolve(canonical);
    invariant(
      metadata.isFile()
        && !metadata.isSymbolicLink()
        && metadata.nlink === 1
        && (process.platform === "win32"
          ? canonicalPath.toLowerCase() === expectedPath.toLowerCase()
          : canonicalPath === expectedPath),
      `release provenance extracted file이 exact regular file이 아닙니다: ${fileName}`
    );
  }
}

async function exportGithubEnvironment(expectedSha256: string): Promise<void> {
  const environmentPath = process.env.GITHUB_ENV;
  if (!environmentPath) {
    return;
  }
  invariant(path.isAbsolute(environmentPath), "GITHUB_ENV가 절대 경로가 아닙니다.");
  await appendFile(environmentPath, [
    `KIRINUKI_RELEASE_PROVENANCE_ARCHIVE_PATH=${DESKTOP_RELEASE_PROVENANCE_ARCHIVE_PATH}`,
    `KIRINUKI_RELEASE_PROVENANCE_ARCHIVE_SHA256=${expectedSha256}`,
    `KIRINUKI_RELEASE_PROVENANCE_ROOT=${DESKTOP_RELEASE_PROVENANCE_EXTRACTED_ROOT}`,
    ""
  ].join("\n"), { encoding: "utf8" });
}

export async function prepareDesktopReleaseProvenance(): Promise<Readonly<{
  archivePath: string;
  archiveSha256: string;
  bytes: number;
  provenanceRoot: string;
}>> {
  const url = exactHttpsUrl(requiredEnvironment("KIRINUKI_RELEASE_PROVENANCE_URL"));
  const expectedSha256 = requiredEnvironment(
    "KIRINUKI_RELEASE_PROVENANCE_ARCHIVE_SHA256"
  ).toLowerCase();
  invariant(SHA256_PATTERN.test(expectedSha256), "release provenance SHA-256 pin이 올바르지 않습니다.");
  await rm(DESKTOP_RELEASE_PROVENANCE_STAGE_ROOT, {
    recursive: true,
    force: true
  });
  await mkdir(DESKTOP_RELEASE_PROVENANCE_STAGE_ROOT, {
    recursive: true,
    mode: 0o700
  });
  try {
    const bytes = await downloadArchive(url, expectedSha256);
    await extractExactRegularTree();
    await exportGithubEnvironment(expectedSha256);
    return Object.freeze({
      archivePath: DESKTOP_RELEASE_PROVENANCE_ARCHIVE_PATH,
      archiveSha256: expectedSha256,
      bytes,
      provenanceRoot: DESKTOP_RELEASE_PROVENANCE_EXTRACTED_ROOT
    });
  } catch (error) {
    await rm(DESKTOP_RELEASE_PROVENANCE_STAGE_ROOT, {
      recursive: true,
      force: true
    });
    throw error;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    throw new TypeError("사용법: prepare-desktop-release-provenance.ts");
  }
  console.log(JSON.stringify(await prepareDesktopReleaseProvenance(), null, 2));
}
