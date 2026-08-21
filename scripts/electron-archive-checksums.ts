import { constants as fsConstants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function stableJson(filePath: string): Promise<unknown> {
  const metadata = await lstat(filePath);
  invariant(
    metadata.isFile() && !metadata.isSymbolicLink() && metadata.size <= 1024 * 1024,
    `Electron provenance 파일이 bounded regular file이 아닙니다: ${filePath}`
  );
  const handle = await open(
    filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)
  );
  try {
    const before = await handle.stat();
    const bytes = await handle.readFile();
    const after = await handle.stat();
    invariant(
      before.dev === after.dev
        && before.ino === after.ino
        && before.size === after.size
        && before.mtimeMs === after.mtimeMs
        && before.ctimeMs === after.ctimeMs,
      `Electron provenance 파일이 readback 중 바뀌었습니다: ${filePath}`
    );
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } finally {
    await handle.close();
  }
}

export async function pinnedElectronArchiveChecksums({
  electronPackageRoot,
  version,
  platform,
  arch
}: {
  readonly electronPackageRoot: string;
  readonly version: string;
  readonly platform: "darwin" | "linux" | "win32";
  readonly arch: "arm64" | "x64";
}): Promise<Readonly<Record<string, string>>> {
  invariant(
    path.isAbsolute(electronPackageRoot)
      && /^\d+\.\d+\.\d+$/u.test(version)
      && ["darwin", "linux", "win32"].includes(platform)
      && ["arm64", "x64"].includes(arch),
    "Electron archive provenance 요청이 올바르지 않습니다."
  );
  const packageValue = await stableJson(path.join(electronPackageRoot, "package.json"));
  const checksumsValue = await stableJson(path.join(electronPackageRoot, "checksums.json"));
  invariant(
    packageValue !== null
      && typeof packageValue === "object"
      && !Array.isArray(packageValue)
      && (packageValue as Record<string, unknown>).name === "electron"
      && (packageValue as Record<string, unknown>).version === version,
    "설치된 Electron npm package identity가 pinned runtime과 다릅니다."
  );
  invariant(
    checksumsValue !== null
      && typeof checksumsValue === "object"
      && !Array.isArray(checksumsValue),
    "Electron checksum map이 객체가 아닙니다."
  );
  const fileName = `electron-v${version}-${platform}-${arch}.zip`;
  const digest = (checksumsValue as Record<string, unknown>)[fileName];
  invariant(
    typeof digest === "string" && SHA256_PATTERN.test(digest),
    `Electron checksum map에 exact target archive가 없습니다: ${fileName}`
  );
  return Object.freeze({ [fileName]: digest });
}

