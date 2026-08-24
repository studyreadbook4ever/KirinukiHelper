import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PAPERLOGY_FONT } from "./paperlogy-font.js";
import { PRETENDARD_FONT } from "./pretendard-font.js";
import { buildWebJavaScript } from "./web-javascript-build.js";
import type {
  LocalMediaEngineReleaseChannel
} from "../src/editor/local-media-engine-release.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const webRoot = path.join(root, "web");

async function assertSha256(
  relativePath: string,
  expectedSha256: string,
  label: string
): Promise<void> {
  const file = await readFile(path.join(root, relativePath));
  const actualSha256 = createHash("sha256").update(file).digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `${label} 원본 무결성 검증 실패: ${relativePath}\n`
      + `expected=${expectedSha256}\nactual=${actualSha256}`
    );
  }
}

export async function buildWebDistribution({
  engineRelease = null
}: {
  readonly engineRelease?: Readonly<LocalMediaEngineReleaseChannel> | null;
} = {}): Promise<void> {
  await Promise.all([
    mkdir(path.join(webRoot, "editor", "fonts"), { recursive: true }),
    mkdir(path.join(webRoot, "licenses"), { recursive: true })
  ]);

  await Promise.all([
    assertSha256(
      PRETENDARD_FONT.sourceFontPath,
      PRETENDARD_FONT.fontSha256,
      "Pretendard"
    ),
    assertSha256(
      PRETENDARD_FONT.sourceLicensePath,
      PRETENDARD_FONT.licenseSha256,
      "Pretendard"
    ),
    assertSha256(
      PAPERLOGY_FONT.sourceFontPath,
      PAPERLOGY_FONT.fontSha256,
      "Paperlogy"
    ),
    assertSha256(
      PAPERLOGY_FONT.sourceLicensePath,
      PAPERLOGY_FONT.licenseSha256,
      "Paperlogy"
    )
  ]);

  await buildWebJavaScript({
    rootDirectory: root,
    engineRelease
  });

  await Promise.all([
    copyFile(
      path.join(root, "UNLICENSE"),
      path.join(webRoot, "licenses", "UNLICENSE.txt")
    ),
    copyFile(
      path.join(root, "legal", "WEB_THIRD_PARTY_NOTICES.md"),
      path.join(webRoot, "THIRD_PARTY_NOTICES.md")
    ),
    copyFile(
      path.join(root, "node_modules", "mediabunny", "LICENSE"),
      path.join(webRoot, "licenses", "MEDIABUNNY-MPL-2.0.txt")
    ),
    copyFile(
      path.join(root, "node_modules", "hls.js", "LICENSE"),
      path.join(webRoot, "licenses", "HLS-JS-APACHE-2.0.txt")
    ),
    copyFile(
      path.join(root, "AudSeg", "LICENSE"),
      path.join(webRoot, "licenses", "AUDSEG-MIT.txt")
    ),
    copyFile(
      path.join(root, PRETENDARD_FONT.sourceFontPath),
      path.join(webRoot, PRETENDARD_FONT.webFontPath)
    ),
    copyFile(
      path.join(root, PRETENDARD_FONT.sourceLicensePath),
      path.join(webRoot, PRETENDARD_FONT.webLicensePath)
    ),
    copyFile(
      path.join(root, PAPERLOGY_FONT.sourceFontPath),
      path.join(webRoot, PAPERLOGY_FONT.webFontPath)
    ),
    copyFile(
      path.join(root, PAPERLOGY_FONT.sourceLicensePath),
      path.join(webRoot, PAPERLOGY_FONT.webLicensePath)
    ),
    copyFile(
      path.join(root, "public-shell", "_headers"),
      path.join(webRoot, "_headers")
    ),
    copyFile(
      path.join(root, "public-shell", ".popovic-hosts"),
      path.join(webRoot, ".popovic-hosts")
    )
  ]);

  console.log("Kirinuki 웹 편집기 빌드 완료");
}

const invokedPath = process.argv[1];
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  await buildWebDistribution();
}
