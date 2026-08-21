import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  DESKTOP_PACKAGED_TARGETS,
  DESKTOP_YT_DLP_RELEASE,
  desktopToolTargetManifest
} from "../src/desktop/tool-manifest.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const execFileAsync = promisify(execFile);
const YT_DLP_SIGNING_FINGERPRINT =
  "AC0CBBE6848D6A873464AF4E57CF65933B5A7581";
const YT_DLP_PUBLIC_KEY_SHA256 =
  "45d6b415928b5f3e228b461fa9e6d7eb56a824931c785ece00279a06c7a6d6e5";
const YT_DLP_SUMS_SHA256 =
  "eca42575010efc77b8dc1e263c57e19c4bddc42d3e08ba789ccde72c97d48c64";
const YT_DLP_SUMS_SIGNATURE_SHA256 =
  "3fb88fc2f120ccae9572e5018136a25ff74954da2366936b87bd09eab2ac09c6";
const MAX_PROVENANCE_BYTES = 256 * 1024;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function downloadPinnedReleaseAsset(
  fileName: "SHA2-256SUMS" | "SHA2-256SUMS.sig",
  expectedSha256: string
): Promise<Buffer> {
  const response = await fetch(
    `${DESKTOP_YT_DLP_RELEASE.baseUrl}/${fileName}`,
    {
      redirect: "follow",
      headers: { "Accept-Encoding": "identity" },
      signal: AbortSignal.timeout(60_000)
    }
  );
  invariant(response.ok, `yt-dlp ${fileName} 다운로드가 실패했습니다: ${response.status}`);
  const finalUrl = new URL(response.url);
  invariant(
    finalUrl.protocol === "https:"
      && !finalUrl.username
      && !finalUrl.password
      && ["github.com", "release-assets.githubusercontent.com"].includes(
        finalUrl.hostname
      ),
    `yt-dlp ${fileName} redirect가 trusted GitHub 경계를 벗어났습니다.`
  );
  const advertised = response.headers.get("content-length");
  invariant(
    advertised === null || Number(advertised) <= MAX_PROVENANCE_BYTES,
    `yt-dlp ${fileName} 응답 크기가 상한을 넘었습니다.`
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  invariant(
    bytes.byteLength > 0
      && bytes.byteLength <= MAX_PROVENANCE_BYTES
      && sha256(bytes) === expectedSha256,
    `yt-dlp ${fileName} immutable release identity가 다릅니다.`
  );
  return bytes;
}

export function parseYtDlpSignedChecksums(
  body: string
): Readonly<Record<string, string>> {
  invariant(
    typeof body === "string" && Buffer.byteLength(body, "utf8") <= MAX_PROVENANCE_BYTES,
    "yt-dlp signed checksum 목록 크기가 올바르지 않습니다."
  );
  const entries: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const line of body.split("\n")) {
    if (line === "") {
      continue;
    }
    const match = /^([0-9a-f]{64})  ([A-Za-z0-9._+-]{1,180})$/u.exec(line);
    invariant(match, "yt-dlp signed checksum 행이 canonical 형식이 아닙니다.");
    const [, digest, fileName] = match;
    invariant(
      digest !== undefined
        && fileName !== undefined
        && entries[fileName] === undefined,
      "yt-dlp signed checksum 목록에 중복 파일이 있습니다."
    );
    entries[fileName] = digest;
  }
  return Object.freeze(entries);
}

function assertManifestMatchesSignedChecksums(
  signed: Readonly<Record<string, string>>
): void {
  for (const target of DESKTOP_PACKAGED_TARGETS) {
    const artifact = desktopToolTargetManifest(target).ytDlp;
    const upstreamName = new URL(artifact.url).pathname.split("/").at(-1);
    invariant(
      upstreamName !== undefined && signed[upstreamName] === artifact.sha256,
      `yt-dlp signed checksum이 ${target} pinned manifest와 다릅니다.`
    );
  }
}

export async function verifyUpstreamToolProvenance(): Promise<void> {
  invariant(
    process.platform !== "win32",
    "signed upstream provenance gate는 gpg가 고정된 POSIX release-authorize runner에서 실행해야 합니다."
  );
  const keyPath = path.join(
    root,
    "security",
    `yt-dlp-${DESKTOP_YT_DLP_RELEASE.version}-public.key`
  );
  const key = await readFile(keyPath);
  invariant(
    key.byteLength === 1_676 && sha256(key) === YT_DLP_PUBLIC_KEY_SHA256,
    "repository의 pinned yt-dlp signing key identity가 다릅니다."
  );
  const [sums, signature] = await Promise.all([
    downloadPinnedReleaseAsset("SHA2-256SUMS", YT_DLP_SUMS_SHA256),
    downloadPinnedReleaseAsset(
      "SHA2-256SUMS.sig",
      YT_DLP_SUMS_SIGNATURE_SHA256
    )
  ]);
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-upstream-proof-"));
  await chmod(temporaryRoot, 0o700);
  const sumsPath = path.join(temporaryRoot, "SHA2-256SUMS");
  const signaturePath = path.join(temporaryRoot, "SHA2-256SUMS.sig");
  const keyCopyPath = path.join(temporaryRoot, "public.key");
  const gpgEnvironment = { ...process.env, GNUPGHOME: temporaryRoot };
  try {
    await Promise.all([
      writeFile(sumsPath, sums, { flag: "wx", mode: 0o600 }),
      writeFile(signaturePath, signature, { flag: "wx", mode: 0o600 }),
      writeFile(keyCopyPath, key, { flag: "wx", mode: 0o600 })
    ]);
    await execFileAsync("gpg", ["--batch", "--import", keyCopyPath], {
      env: gpgEnvironment,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });
    const keys = await execFileAsync("gpg", [
      "--batch",
      "--with-colons",
      "--fingerprint",
      "--list-keys"
    ], {
      env: gpgEnvironment,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });
    invariant(
      keys.stdout.split(/\r?\n/u).filter((line) => line.startsWith("fpr:"))
        .map((line) => line.split(":")[9])
        .filter(Boolean)
        .includes(YT_DLP_SIGNING_FINGERPRINT),
      "pinned yt-dlp signing key fingerprint readback이 다릅니다."
    );
    const verified = await execFileAsync("gpg", [
      "--batch",
      "--status-fd",
      "1",
      "--verify",
      signaturePath,
      sumsPath
    ], {
      env: gpgEnvironment,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });
    invariant(
      verified.stdout.split(/\r?\n/u).some((line) => (
        line.startsWith(`[GNUPG:] VALIDSIG ${YT_DLP_SIGNING_FINGERPRINT} `)
      )),
      "yt-dlp checksum signature가 pinned fingerprint로 검증되지 않았습니다."
    );
    assertManifestMatchesSignedChecksums(
      parseYtDlpSignedChecksums(sums.toString("utf8"))
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1];
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    throw new TypeError("사용법: verify-upstream-tool-provenance.ts");
  }
  await verifyUpstreamToolProvenance();
  console.log(JSON.stringify({
    schema: "kirinuki-upstream-tool-provenance/v1",
    status: "verified",
    ytDlpVersion: DESKTOP_YT_DLP_RELEASE.version,
    signingFingerprint: YT_DLP_SIGNING_FINGERPRINT,
    targets: DESKTOP_PACKAGED_TARGETS
  }, null, 2));
}

