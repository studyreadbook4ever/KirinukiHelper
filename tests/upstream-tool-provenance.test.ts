import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseYtDlpSignedChecksums
} from "../scripts/verify-upstream-tool-provenance.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("yt-dlp signed checksum parser는 canonical unique rows만 받는다", () => {
  assert.deepEqual({ ...parseYtDlpSignedChecksums(
    `${"a".repeat(64)}  yt-dlp\n${"b".repeat(64)}  yt-dlp.exe\n`
  ) }, {
    "yt-dlp": "a".repeat(64),
    "yt-dlp.exe": "b".repeat(64)
  });
  assert.throws(
    () => parseYtDlpSignedChecksums(`${"a".repeat(64)} *yt-dlp\n`),
    /canonical/u
  );
  assert.throws(
    () => parseYtDlpSignedChecksums(
      `${"a".repeat(64)}  yt-dlp\n${"b".repeat(64)}  yt-dlp\n`
    ),
    /중복/u
  );
});

test("repository pins the reviewed yt-dlp release signing key and fingerprint", async () => {
  const [source, key] = await Promise.all([
    readFile(path.join(root, "scripts/verify-upstream-tool-provenance.ts"), "utf8"),
    readFile(path.join(root, "security/yt-dlp-2026.07.04-public.key"), "utf8")
  ]);
  assert.match(source, /AC0CBBE6848D6A873464AF4E57CF65933B5A7581/u);
  assert.match(source, /VALIDSIG/u);
  assert.match(key, /^-----BEGIN PGP PUBLIC KEY BLOCK-----/u);
});
