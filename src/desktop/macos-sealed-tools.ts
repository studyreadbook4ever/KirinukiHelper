import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  open,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import {
  DESKTOP_TOOL_MANIFEST_SCHEMA,
  desktopToolTargetManifest
} from "./tool-manifest.js";
import type {
  DesktopToolArtifact,
  DesktopToolTargetManifest
} from "./tool-manifest.js";

export const MACOS_SEALED_TOOL_MANIFEST_SCHEMA =
  "kirinuki/macos-sealed-tools/v1" as const;
export const MACOS_SEALED_TOOL_MANIFEST_FILE_NAME =
  "codesigned-manifest.json" as const;
export const MACOS_CODESIGN_EXECUTABLE = "/usr/bin/codesign" as const;
export const MACOS_CODESIGN_TIMEOUT_MS = 30_000;

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const TEAM_IDENTIFIER_PATTERN = /^[A-Z0-9]{10}$/u;
const DEVELOPER_ID_AUTHORITY_PATTERN =
  /^Developer ID Application: [^\r\n=]{1,180} \([A-Z0-9]{10}\)$/u;
const MACOS_TOOL_ROLES = Object.freeze([
  "ffmpeg",
  "ffprobe",
  "ytDlp"
] as const);

type MacosToolRole = typeof MACOS_TOOL_ROLES[number];

interface FileIdentity {
  readonly bytes: number;
  readonly sha256: string;
}

export interface MacosCodeSealEvidence {
  readonly authority: string;
  readonly teamIdentifier: string;
  readonly hardenedRuntime: true;
  readonly timestamped: true;
}

export interface MacosSealedToolArtifact {
  readonly fileName: string;
  readonly upstream: Readonly<FileIdentity>;
  readonly signed: Readonly<FileIdentity>;
}

export interface MacosSealedToolManifest {
  readonly schema: typeof MACOS_SEALED_TOOL_MANIFEST_SCHEMA;
  readonly target: "darwin-arm64";
  readonly sourceManifest: Readonly<{
    readonly schema: typeof DESKTOP_TOOL_MANIFEST_SCHEMA;
    readonly canonicalSha256: string;
  }>;
  readonly signing: Readonly<MacosCodeSealEvidence>;
  readonly artifacts: Readonly<Record<MacosToolRole, MacosSealedToolArtifact>>;
}

export interface MacosSealedToolVerification {
  readonly manifest: Readonly<MacosSealedToolManifest>;
  readonly appBundlePath: string;
  readonly ffmpeg: string;
  readonly ffprobe: string;
  readonly ytDlp: string;
}

type MacosSealedToolPaths = Pick<
  typeof path.posix,
  "isAbsolute" | "normalize" | "basename" | "dirname" | "join"
>;

/**
 * Explicit host-filesystem seam for the cross-platform verification suite.
 * Signed macOS production calls omit it and therefore always require POSIX
 * paths and executable permission bits.
 */
export interface MacosSealedToolFileSystemSemantics {
  readonly paths: MacosSealedToolPaths;
  readonly executableMode: "required" | "unavailable-on-windows";
}

export type MacosCodesignCommandRunner = (
  command: typeof MACOS_CODESIGN_EXECUTABLE,
  args: readonly string[],
  timeoutMs: typeof MACOS_CODESIGN_TIMEOUT_MS
) => Promise<Readonly<{ stdout: string; stderr: string }>>;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const macosProductionFileSystemSemantics = Object.freeze({
  paths: path.posix,
  executableMode: "required"
}) satisfies MacosSealedToolFileSystemSemantics;

function exactFileSystemSemantics(
  value: Readonly<MacosSealedToolFileSystemSemantics> | undefined
): Readonly<MacosSealedToolFileSystemSemantics> {
  const semantics = value ?? macosProductionFileSystemSemantics;
  invariant(
    semantics !== null
      && typeof semantics.paths?.isAbsolute === "function"
      && typeof semantics.paths.normalize === "function"
      && typeof semantics.paths.basename === "function"
      && typeof semantics.paths.dirname === "function"
      && typeof semantics.paths.join === "function"
      && (
        (
          semantics.executableMode === "required"
          && semantics.paths === path.posix
        )
        || (
          semantics.executableMode === "unavailable-on-windows"
          && process.platform === "win32"
          && semantics.paths === path.win32
        )
      ),
    "macOS 봉인 도구 파일시스템 의미가 올바르지 않습니다."
  );
  return semantics;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  return JSON.stringify(Object.keys(value).sort())
    === JSON.stringify([...expected].sort());
}

function canonicalManifestSha256(
  manifest: Readonly<DesktopToolTargetManifest>
): string {
  return createHash("sha256")
    .update(JSON.stringify(manifest), "utf8")
    .digest("hex");
}

export function macosDesktopToolManifestCanonicalSha256(): string {
  return canonicalManifestSha256(desktopToolTargetManifest("darwin-arm64"));
}

function safeResourcesRoot(
  resourcesRoot: string,
  fileSystemSemantics: Readonly<MacosSealedToolFileSystemSemantics>
): string {
  const paths = fileSystemSemantics.paths;
  invariant(
    typeof resourcesRoot === "string"
      && resourcesRoot.trim() === resourcesRoot
      && paths.isAbsolute(resourcesRoot)
      && !/[\u0000-\u001f\u007f]/u.test(resourcesRoot),
    "macOS Resources root는 안전한 절대 경로여야 합니다."
  );
  const normalized = paths.normalize(resourcesRoot);
  invariant(
    paths.basename(normalized) === "Resources"
      && paths.basename(paths.dirname(normalized)) === "Contents"
      && paths.basename(paths.dirname(paths.dirname(normalized)))
        .endsWith(".app"),
    "macOS Resources root가 .app/Contents/Resources 구조가 아닙니다."
  );
  return normalized;
}

export function macosAppBundlePathFromResourcesRoot(
  resourcesRoot: string,
  fileSystemSemanticsInput?: Readonly<MacosSealedToolFileSystemSemantics>
): string {
  const fileSystemSemantics = exactFileSystemSemantics(
    fileSystemSemanticsInput
  );
  return fileSystemSemantics.paths.dirname(
    fileSystemSemantics.paths.dirname(
      safeResourcesRoot(resourcesRoot, fileSystemSemantics)
    )
  );
}

export function macosSealedToolManifestPath(
  resourcesRoot: string,
  fileSystemSemanticsInput?: Readonly<MacosSealedToolFileSystemSemantics>
): string {
  const fileSystemSemantics = exactFileSystemSemantics(
    fileSystemSemanticsInput
  );
  return fileSystemSemantics.paths.join(
    safeResourcesRoot(resourcesRoot, fileSystemSemantics),
    "desktop-tools",
    "darwin-arm64",
    MACOS_SEALED_TOOL_MANIFEST_FILE_NAME
  );
}

async function stableRegularFileBytes(
  filePath: string,
  maximumBytes: number
): Promise<Buffer> {
  const metadata = await lstat(filePath, { bigint: true });
  invariant(
    metadata.isFile()
      && !metadata.isSymbolicLink()
      && metadata.size > 0n
      && metadata.size <= BigInt(maximumBytes),
    `macOS 봉인 파일이 bounded regular file이 아닙니다: ${filePath}`
  );
  const handle = await open(
    filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)
  );
  try {
    const before = await handle.stat({ bigint: true });
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    invariant(
      before.dev === after.dev
        && before.ino === after.ino
        && before.size === after.size
        && before.mtimeNs === after.mtimeNs
        && before.ctimeNs === after.ctimeNs
        && before.size === BigInt(bytes.byteLength),
      `검증 중 macOS 봉인 파일이 바뀌었습니다: ${filePath}`
    );
    return bytes;
  } finally {
    await handle.close();
  }
}

async function stableRegularFileIdentity(
  filePath: string,
  fileSystemSemantics: Readonly<MacosSealedToolFileSystemSemantics>
): Promise<FileIdentity> {
  const metadata = await lstat(filePath, { bigint: true });
  invariant(
    metadata.isFile()
      && !metadata.isSymbolicLink()
      && metadata.size >= 100_000n
      && metadata.size <= 512n * 1_024n * 1_024n
      && (
        fileSystemSemantics.executableMode === "unavailable-on-windows"
        || (metadata.mode & 0o111n) !== 0n
      ),
    `macOS 서명 도구가 bounded regular file이 아닙니다: ${filePath}`
  );
  const handle = await open(
    filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)
  );
  try {
    const before = await handle.stat({ bigint: true });
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < Number(before.size)) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, Number(before.size) - position),
        position
      );
      invariant(bytesRead > 0, `macOS 서명 도구를 끝까지 읽지 못했습니다: ${filePath}`);
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    invariant(
      before.dev === after.dev
        && before.ino === after.ino
        && before.size === after.size
        && before.mtimeNs === after.mtimeNs
        && before.ctimeNs === after.ctimeNs,
      `검증 중 macOS 서명 도구가 바뀌었습니다: ${filePath}`
    );
    return Object.freeze({
      bytes: Number(before.size),
      sha256: hash.digest("hex")
    });
  } finally {
    await handle.close();
  }
}

function expectedToolArtifacts(): Readonly<
  Record<MacosToolRole, Readonly<DesktopToolArtifact>>
> {
  const manifest = desktopToolTargetManifest("darwin-arm64");
  return Object.freeze({
    ffmpeg: manifest.ffmpeg,
    ffprobe: manifest.ffprobe,
    ytDlp: manifest.ytDlp
  });
}

function validateIdentity(value: unknown): value is FileIdentity {
  const identity = asRecord(value);
  return identity !== null
    && hasExactKeys(identity, ["bytes", "sha256"])
    && Number.isSafeInteger(identity.bytes)
    && Number(identity.bytes) >= 100_000
    && Number(identity.bytes) <= 512 * 1_024 * 1_024
    && typeof identity.sha256 === "string"
    && SHA256_PATTERN.test(identity.sha256);
}

export function parseMacosSealedToolManifest(
  value: unknown
): Readonly<MacosSealedToolManifest> {
  const manifest = asRecord(value);
  const sourceManifest = asRecord(manifest?.sourceManifest);
  const signing = asRecord(manifest?.signing);
  const artifacts = asRecord(manifest?.artifacts);
  const expected = expectedToolArtifacts();
  invariant(
    manifest !== null
      && sourceManifest !== null
      && signing !== null
      && artifacts !== null
      && hasExactKeys(manifest, [
        "schema",
        "target",
        "sourceManifest",
        "signing",
        "artifacts"
      ])
      && hasExactKeys(sourceManifest, ["schema", "canonicalSha256"])
      && hasExactKeys(signing, [
        "authority",
        "teamIdentifier",
        "hardenedRuntime",
        "timestamped"
      ])
      && hasExactKeys(artifacts, MACOS_TOOL_ROLES)
      && manifest.schema === MACOS_SEALED_TOOL_MANIFEST_SCHEMA
      && manifest.target === "darwin-arm64"
      && sourceManifest.schema === DESKTOP_TOOL_MANIFEST_SCHEMA
      && sourceManifest.canonicalSha256
        === macosDesktopToolManifestCanonicalSha256()
      && typeof signing.authority === "string"
      && DEVELOPER_ID_AUTHORITY_PATTERN.test(signing.authority)
      && typeof signing.teamIdentifier === "string"
      && TEAM_IDENTIFIER_PATTERN.test(signing.teamIdentifier)
      && signing.authority.endsWith(`(${signing.teamIdentifier})`)
      && signing.hardenedRuntime === true
      && signing.timestamped === true,
    "macOS 봉인 도구 manifest가 exact contract와 다릅니다."
  );
  const parsedArtifacts = new Map<
    MacosToolRole,
    Readonly<MacosSealedToolArtifact>
  >();
  for (const role of MACOS_TOOL_ROLES) {
    const artifact = asRecord(artifacts[role]);
    const upstream = asRecord(artifact?.upstream);
    const signed = asRecord(artifact?.signed);
    invariant(
      artifact !== null
        && upstream !== null
        && signed !== null
        && hasExactKeys(artifact, ["fileName", "upstream", "signed"])
        && artifact.fileName === expected[role].fileName
        && validateIdentity(upstream)
        && upstream.bytes === expected[role].size
        && upstream.sha256 === expected[role].sha256
        && validateIdentity(signed),
      `macOS 봉인 도구 manifest의 ${role} identity가 다릅니다.`
    );
    parsedArtifacts.set(role, Object.freeze({
      fileName: expected[role].fileName,
      upstream: Object.freeze({
        bytes: Number(upstream.bytes),
        sha256: upstream.sha256
      }),
      signed: Object.freeze({
        bytes: Number(signed.bytes),
        sha256: signed.sha256
      })
    }));
  }
  const ffmpeg = parsedArtifacts.get("ffmpeg");
  const ffprobe = parsedArtifacts.get("ffprobe");
  const ytDlp = parsedArtifacts.get("ytDlp");
  invariant(
    ffmpeg !== undefined && ffprobe !== undefined && ytDlp !== undefined,
    "macOS 봉인 도구 manifest에 필수 도구가 빠졌니다."
  );
  return Object.freeze({
    schema: MACOS_SEALED_TOOL_MANIFEST_SCHEMA,
    target: "darwin-arm64",
    sourceManifest: Object.freeze({
      schema: DESKTOP_TOOL_MANIFEST_SCHEMA,
      canonicalSha256: sourceManifest.canonicalSha256
    }),
    signing: Object.freeze({
      authority: signing.authority,
      teamIdentifier: signing.teamIdentifier,
      hardenedRuntime: true,
      timestamped: true
    }),
    artifacts: Object.freeze({ ffmpeg, ffprobe, ytDlp })
  });
}

function defaultCodesignRunner(
  command: typeof MACOS_CODESIGN_EXECUTABLE,
  args: readonly string[],
  timeoutMs: typeof MACOS_CODESIGN_TIMEOUT_MS
): Promise<Readonly<{ stdout: string; stderr: string }>> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: timeoutMs,
      windowsHide: true,
      shell: false
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error("macOS outer app code seal 검증에 실패했습니다.", {
          cause: error
        }));
        return;
      }
      resolve(Object.freeze({ stdout, stderr }));
    });
  });
}

export async function verifyMacosOuterCodeSeal(
  appBundlePath: string,
  runCodesign: MacosCodesignCommandRunner = defaultCodesignRunner
): Promise<Readonly<MacosCodeSealEvidence>> {
  invariant(
    typeof appBundlePath === "string"
      && appBundlePath.trim() === appBundlePath
      && path.posix.isAbsolute(appBundlePath)
      && path.posix.basename(appBundlePath).endsWith(".app")
      && !/[\u0000-\u001f\u007f]/u.test(appBundlePath),
    "macOS app bundle은 안전한 절대 .app 경로여야 합니다."
  );
  const normalized = path.posix.normalize(appBundlePath);
  await runCodesign(MACOS_CODESIGN_EXECUTABLE, [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=4",
    normalized
  ], MACOS_CODESIGN_TIMEOUT_MS);
  const display = await runCodesign(MACOS_CODESIGN_EXECUTABLE, [
    "--display",
    "--verbose=4",
    normalized
  ], MACOS_CODESIGN_TIMEOUT_MS);
  const lines = `${display.stdout}\n${display.stderr}`.split(/\r?\n/u);
  const developerAuthorities = lines
    .filter((line) => line.startsWith("Authority=Developer ID Application: "))
    .map((line) => line.slice("Authority=".length));
  const teamIdentifiers = lines
    .filter((line) => line.startsWith("TeamIdentifier="))
    .map((line) => line.slice("TeamIdentifier=".length));
  const authority = developerAuthorities[0];
  const teamIdentifier = teamIdentifiers[0];
  invariant(
    developerAuthorities.length === 1
      && teamIdentifiers.length === 1
      && typeof authority === "string"
      && DEVELOPER_ID_AUTHORITY_PATTERN.test(authority)
      && typeof teamIdentifier === "string"
      && TEAM_IDENTIFIER_PATTERN.test(teamIdentifier)
      && authority.endsWith(`(${teamIdentifier})`)
      && lines.some((line) => line.startsWith("Timestamp="))
      && lines.some((line) => (
        line.startsWith("CodeDirectory ")
          && /flags=.*\(runtime\)/u.test(line)
      )),
    "macOS outer app code seal readback이 Developer ID/runtime/timestamp contract와 다릅니다."
  );
  return Object.freeze({
    authority,
    teamIdentifier,
    hardenedRuntime: true,
    timestamped: true
  });
}

export async function createMacosSealedToolManifest({
  resourcesRoot,
  authority,
  teamIdentifier,
  fileSystemSemantics: fileSystemSemanticsInput
}: {
  readonly resourcesRoot: string;
  readonly authority: string;
  readonly teamIdentifier: string;
  readonly fileSystemSemantics?: Readonly<MacosSealedToolFileSystemSemantics>;
}): Promise<Readonly<MacosSealedToolManifest>> {
  const fileSystemSemantics = exactFileSystemSemantics(
    fileSystemSemanticsInput
  );
  const paths = fileSystemSemantics.paths;
  const normalizedResourcesRoot = safeResourcesRoot(
    resourcesRoot,
    fileSystemSemantics
  );
  const expectedManifest = desktopToolTargetManifest("darwin-arm64");
  const toolsRoot = paths.join(
    normalizedResourcesRoot,
    "desktop-tools",
    "darwin-arm64"
  );
  const recordedManifest = JSON.parse((await stableRegularFileBytes(
    paths.join(toolsRoot, "manifest.json"),
    1024 * 1024
  )).toString("utf8")) as unknown;
  invariant(
    JSON.stringify(recordedManifest) === JSON.stringify(expectedManifest),
    "macOS 서명 전 upstream 도구 manifest가 현재 앱과 다릅니다."
  );
  const expected = expectedToolArtifacts();
  const identities = await Promise.all(MACOS_TOOL_ROLES.map(async (role) => ({
    role,
    identity: await stableRegularFileIdentity(
      paths.join(toolsRoot, expected[role].fileName),
      fileSystemSemantics
    )
  })));
  const signedArtifact = (
    role: MacosToolRole
  ): Readonly<MacosSealedToolArtifact> => {
    const entry = identities.find((candidate) => candidate.role === role);
    invariant(entry !== undefined, `macOS ${role} signed identity가 빠졌니다.`);
    return Object.freeze({
      fileName: expected[role].fileName,
      upstream: Object.freeze({
        bytes: expected[role].size,
        sha256: expected[role].sha256
      }),
      signed: entry.identity
    });
  };
  const signed = Object.freeze({
    ffmpeg: signedArtifact("ffmpeg"),
    ffprobe: signedArtifact("ffprobe"),
    ytDlp: signedArtifact("ytDlp")
  });
  return parseMacosSealedToolManifest({
    schema: MACOS_SEALED_TOOL_MANIFEST_SCHEMA,
    target: "darwin-arm64",
    sourceManifest: {
      schema: DESKTOP_TOOL_MANIFEST_SCHEMA,
      canonicalSha256: canonicalManifestSha256(expectedManifest)
    },
    signing: {
      authority,
      teamIdentifier,
      hardenedRuntime: true,
      timestamped: true
    },
    artifacts: signed
  });
}

export async function writeMacosSealedToolManifest(
  resourcesRoot: string,
  manifest: Readonly<MacosSealedToolManifest>,
  fileSystemSemantics?: Readonly<MacosSealedToolFileSystemSemantics>
): Promise<string> {
  const verified = parseMacosSealedToolManifest(manifest);
  const manifestPath = macosSealedToolManifestPath(
    resourcesRoot,
    fileSystemSemantics
  );
  await writeFile(manifestPath, `${JSON.stringify(verified, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o644
  });
  await stableRegularFileBytes(manifestPath, 1024 * 1024);
  return manifestPath;
}

export async function hasMacosSealedToolManifest(
  resourcesRoot: string,
  fileSystemSemantics?: Readonly<MacosSealedToolFileSystemSemantics>
): Promise<boolean> {
  try {
    await lstat(macosSealedToolManifestPath(
      resourcesRoot,
      fileSystemSemantics
    ));
    return true;
  } catch (error) {
    if (
      error instanceof Error
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

export async function verifyMacosSealedDesktopTools({
  resourcesRoot,
  verifyOuterSeal = verifyMacosOuterCodeSeal,
  fileSystemSemantics: fileSystemSemanticsInput
}: {
  readonly resourcesRoot: string;
  readonly verifyOuterSeal?: (
    appBundlePath: string
  ) => Promise<Readonly<MacosCodeSealEvidence>>;
  readonly fileSystemSemantics?: Readonly<MacosSealedToolFileSystemSemantics>;
}): Promise<Readonly<MacosSealedToolVerification>> {
  const fileSystemSemantics = exactFileSystemSemantics(
    fileSystemSemanticsInput
  );
  const pathApi = fileSystemSemantics.paths;
  const normalizedResourcesRoot = safeResourcesRoot(
    resourcesRoot,
    fileSystemSemantics
  );
  const appBundlePath = macosAppBundlePathFromResourcesRoot(
    normalizedResourcesRoot,
    fileSystemSemantics
  );

  // A mutable sidecar is never a trust root. The outer bundle seal is checked
  // before reading it, and again after every bound file has been hashed.
  const beforeSeal = await verifyOuterSeal(appBundlePath);
  const manifest = parseMacosSealedToolManifest(JSON.parse(
    (await stableRegularFileBytes(
      macosSealedToolManifestPath(
        normalizedResourcesRoot,
        fileSystemSemantics
      ),
      1024 * 1024
    )).toString("utf8")
  ) as unknown);
  invariant(
    JSON.stringify(manifest.signing) === JSON.stringify(beforeSeal),
    "macOS 봉인 manifest의 signing identity가 outer app seal과 다릅니다."
  );

  const expectedManifest = desktopToolTargetManifest("darwin-arm64");
  const toolsRoot = pathApi.join(
    normalizedResourcesRoot,
    "desktop-tools",
    "darwin-arm64"
  );
  const recordedManifest = JSON.parse((await stableRegularFileBytes(
    pathApi.join(toolsRoot, "manifest.json"),
    1024 * 1024
  )).toString("utf8")) as unknown;
  invariant(
    JSON.stringify(recordedManifest) === JSON.stringify(expectedManifest),
    "macOS 봉인 app의 upstream 도구 manifest가 현재 앱과 다릅니다."
  );
  const entries = await Promise.all(MACOS_TOOL_ROLES.map(async (role) => {
    const artifact = manifest.artifacts[role];
    const filePath = pathApi.join(toolsRoot, artifact.fileName);
    const actual = await stableRegularFileIdentity(
      filePath,
      fileSystemSemantics
    );
    invariant(
      JSON.stringify(actual) === JSON.stringify(artifact.signed),
      `macOS 봉인 도구 무결성 검증 실패: ${artifact.fileName}`
    );
    return [role, filePath] as const;
  }));
  const paths = Object.fromEntries(entries) as Record<MacosToolRole, string>;

  const afterSeal = await verifyOuterSeal(appBundlePath);
  invariant(
    JSON.stringify(afterSeal) === JSON.stringify(beforeSeal)
      && JSON.stringify(afterSeal) === JSON.stringify(manifest.signing),
    "macOS 도구 검증 중 outer app seal identity가 바뀌었습니다."
  );
  return Object.freeze({
    manifest,
    appBundlePath,
    ffmpeg: paths.ffmpeg,
    ffprobe: paths.ffprobe,
    ytDlp: paths.ytDlp
  });
}
