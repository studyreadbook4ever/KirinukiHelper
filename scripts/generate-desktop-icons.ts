import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourcePath = path.join(root, "build", "icon.svg");
const icoPath = path.join(root, "build", "icon.ico");
const icnsPath = path.join(root, "build", "icon.icns");
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ICO_SIZES = Object.freeze([16, 24, 32, 48, 64, 128, 256]);
const ICNS_FRAMES = Object.freeze([
  ["icp4", 16],
  ["ic11", 32],
  ["icp5", 32],
  ["ic12", 64],
  ["icp6", 64],
  ["ic07", 128],
  ["ic13", 256],
  ["ic08", 256],
  ["ic14", 512],
  ["ic09", 512],
  ["ic10", 1024]
] as const);
const EXPECTED_SHA256 = Object.freeze({
  svg: "4649cadf90d5105c3ef3eb5fc785ef3839d4123777058552f9919817a8e7cfc7",
  ico: "97b815984c855580057982b247b766a8ce149c72d99d279dcbf98dfff42dfa9c",
  icns: "2d9b2bcbd75312db98a02f9e24a49e2b40da805402134126f5b642c0ec069ddb"
});

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function pngSize(bytes: Buffer, label: string): number {
  invariant(bytes.length >= 33, `${label} PNG가 너무 짧습니다.`);
  invariant(
    bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE),
    `${label} PNG signature가 다릅니다.`
  );
  invariant(
    bytes.readUInt32BE(8) === 13
      && bytes.subarray(12, 16).toString("ascii") === "IHDR",
    `${label} PNG IHDR가 올바르지 않습니다.`
  );
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  invariant(width === height && width > 0, `${label} PNG가 정사각형이 아닙니다.`);
  return width;
}

function buildIco(pngBySize: ReadonlyMap<number, Buffer>): Buffer {
  const directoryBytes = 6 + ICO_SIZES.length * 16;
  let offset = directoryBytes;
  const entries: Buffer[] = [];
  const images: Buffer[] = [];
  for (const size of ICO_SIZES) {
    const png = pngBySize.get(size);
    invariant(png && pngSize(png, `ICO ${size}`) === size, `ICO ${size}px PNG가 없습니다.`);
    const entry = Buffer.alloc(16);
    entry[0] = size === 256 ? 0 : size;
    entry[1] = size === 256 ? 0 : size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    images.push(png);
    offset += png.length;
  }
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(ICO_SIZES.length, 4);
  return Buffer.concat([header, ...entries, ...images], offset);
}

function buildIcns(pngBySize: ReadonlyMap<number, Buffer>): Buffer {
  const chunks = ICNS_FRAMES.map(([type, size]) => {
    const png = pngBySize.get(size);
    invariant(png && pngSize(png, `ICNS ${type}`) === size, `ICNS ${size}px PNG가 없습니다.`);
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, "ascii");
    header.writeUInt32BE(8 + png.length, 4);
    return Buffer.concat([header, png]);
  });
  const total = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(total, 4);
  return Buffer.concat([header, ...chunks], total);
}

function inspectIco(bytes: Buffer): void {
  invariant(bytes.length >= 6, "ICO가 너무 짧습니다.");
  invariant(
    bytes.readUInt16LE(0) === 0
      && bytes.readUInt16LE(2) === 1
      && bytes.readUInt16LE(4) === ICO_SIZES.length,
    "ICO header가 올바르지 않습니다."
  );
  let expectedOffset = 6 + ICO_SIZES.length * 16;
  for (const [index, expectedSize] of ICO_SIZES.entries()) {
    const entryOffset = 6 + index * 16;
    const width = bytes[entryOffset] === 0 ? 256 : bytes[entryOffset];
    const height = bytes[entryOffset + 1] === 0 ? 256 : bytes[entryOffset + 1];
    const length = bytes.readUInt32LE(entryOffset + 8);
    const imageOffset = bytes.readUInt32LE(entryOffset + 12);
    invariant(
      width === expectedSize
        && height === expectedSize
        && bytes.readUInt16LE(entryOffset + 4) === 1
        && bytes.readUInt16LE(entryOffset + 6) === 32
        && imageOffset === expectedOffset
        && length > 0
        && imageOffset + length <= bytes.length,
      `ICO ${expectedSize}px directory entry가 올바르지 않습니다.`
    );
    const image = bytes.subarray(imageOffset, imageOffset + length);
    invariant(pngSize(image, `ICO ${expectedSize}`) === expectedSize, "ICO PNG 크기가 다릅니다.");
    expectedOffset += length;
  }
  invariant(expectedOffset === bytes.length, "ICO 끝에 예상하지 않은 bytes가 있습니다.");
}

function inspectIcns(bytes: Buffer): void {
  invariant(
    bytes.length >= 8
      && bytes.subarray(0, 4).toString("ascii") === "icns"
      && bytes.readUInt32BE(4) === bytes.length,
    "ICNS header가 올바르지 않습니다."
  );
  let offset = 8;
  for (const [expectedType, expectedSize] of ICNS_FRAMES) {
    invariant(offset + 8 <= bytes.length, `ICNS ${expectedType} chunk가 없습니다.`);
    const type = bytes.subarray(offset, offset + 4).toString("ascii");
    const length = bytes.readUInt32BE(offset + 4);
    invariant(
      type === expectedType && length > 8 && offset + length <= bytes.length,
      `ICNS ${expectedType} chunk가 올바르지 않습니다.`
    );
    const png = bytes.subarray(offset + 8, offset + length);
    invariant(pngSize(png, `ICNS ${expectedType}`) === expectedSize, "ICNS PNG 크기가 다릅니다.");
    offset += length;
  }
  invariant(offset === bytes.length, "ICNS 끝에 예상하지 않은 chunk가 있습니다.");
}

async function runRsvg(source: string, output: string, size: number): Promise<void> {
  const command = String(process.env.KIRINUKI_RSVG_CONVERT || "rsvg-convert");
  invariant(command.length > 0 && !/[\0\r\n]/u.test(command), "rsvg-convert 명령이 올바르지 않습니다.");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [
      "-w",
      String(size),
      "-h",
      String(size),
      "-o",
      output,
      source
    ], {
      cwd: root,
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr = (stderr + String(chunk)).slice(-8_000);
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`rsvg-convert ${size}px 실행 시간이 초과됐습니다.`));
    }, 30_000);
    timeout.unref?.();
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0 && signal === null) {
        resolve();
      } else {
        reject(new Error(
          `rsvg-convert ${size}px 실패: code=${code ?? "null"} signal=${signal ?? "none"} ${stderr}`
        ));
      }
    });
  });
}

async function writeAtomically(destination: string, bytes: Buffer): Promise<void> {
  const temporary = `${destination}.${randomBytes(12).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, bytes, { mode: 0o644, flag: "wx" });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function writeIcons(): Promise<void> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "kirinuki-icons-"));
  try {
    const sizes = [...new Set([
      ...ICO_SIZES,
      ...ICNS_FRAMES.map(([, size]) => size)
    ])].sort((left, right) => left - right);
    const pngBySize = new Map<number, Buffer>();
    for (const size of sizes) {
      const output = path.join(temporaryRoot, `${size}.png`);
      await runRsvg(sourcePath, output, size);
      const png = await readFile(output);
      invariant(pngSize(png, `${size}px`) === size, `${size}px icon 생성 결과가 다릅니다.`);
      pngBySize.set(size, png);
    }
    const ico = buildIco(pngBySize);
    const icns = buildIcns(pngBySize);
    inspectIco(ico);
    inspectIcns(icns);
    await writeAtomically(icoPath, ico);
    await writeAtomically(icnsPath, icns);
    process.stdout.write(`${JSON.stringify({
      svg: sha256(await readFile(sourcePath)),
      ico: sha256(ico),
      icns: sha256(icns)
    }, null, 2)}\n`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function checkIcons(): Promise<void> {
  const [svgMetadata, icoMetadata, icnsMetadata, svg, ico, icns] = await Promise.all([
    lstat(sourcePath),
    lstat(icoPath),
    lstat(icnsPath),
    readFile(sourcePath),
    readFile(icoPath),
    readFile(icnsPath)
  ]);
  invariant(
    [svgMetadata, icoMetadata, icnsMetadata].every((entry) => (
      entry.isFile() && !entry.isSymbolicLink()
    )),
    "데스크톱 상표 asset은 symlink가 아닌 regular file이어야 합니다."
  );
  inspectIco(ico);
  inspectIcns(icns);
  const actual = { svg: sha256(svg), ico: sha256(ico), icns: sha256(icns) };
  invariant(
    JSON.stringify(actual) === JSON.stringify(EXPECTED_SHA256),
    `데스크톱 상표 asset이 검토된 bytes와 다릅니다: ${JSON.stringify(actual)}`
  );
  process.stdout.write(`${JSON.stringify({ ok: true, ...actual }, null, 2)}\n`);
}

const [mode, ...extraArguments] = process.argv.slice(2);
invariant(extraArguments.length === 0, "사용법: generate-desktop-icons.ts <write|check>");
if (mode === "write") {
  await writeIcons();
} else if (mode === "check") {
  await checkIcons();
} else {
  throw new TypeError("사용법: generate-desktop-icons.ts <write|check>");
}
