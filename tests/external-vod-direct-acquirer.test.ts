import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EXTERNAL_VOD_DIRECT_ENCODING_PROFILE_SHA256,
  EXTERNAL_VOD_DIRECT_SECTION_EVIDENCE_SCHEMA,
  ExternalVodDirectAcquisitionError,
  acquireExternalVodDirectSection,
  buildExternalVodDirectFfmpegArgs,
  externalVodDirectClockProofId,
  parseExternalVodDirectSectionEvidence
} from "../scripts/external-vod-direct-acquirer.js";
import type {
  ExternalVodDirectAcquirerDependencies,
  ExternalVodDirectClockProof,
  ExternalVodDirectRuntimeInputs
} from "../scripts/external-vod-direct-acquirer.js";

const digest = (value: string): string => (
  createHash("sha256").update(value).digest("hex")
);
const videoIdentity = "youtube:format:136:video";
const audioIdentity = "youtube:format:140:audio";
const PART_PROOF_ID = digest("youtube-selected-part-proof");

function clockProof(withAudio = true): ExternalVodDirectClockProof {
  const withoutId: Omit<ExternalVodDirectClockProof, "proofId"> = {
    playerDurationUs: 600_000_000,
    zeroOrigin: true,
    video: {
      semanticIdentitySha256: digest(videoIdentity),
      startUs: 0,
      durationUs: 600_000_000
    },
    ...(withAudio
      ? {
        audio: {
          semanticIdentitySha256: digest(audioIdentity),
          startUs: 0 as const,
          durationUs: 600_000_000
        }
      }
      : {})
  };
  return {
    ...withoutId,
    proofId: externalVodDirectClockProofId(withoutId)
  };
}

function runtimeInputs(token = "first", withAudio = true): ExternalVodDirectRuntimeInputs {
  return {
    video: {
      url: `https://rr1.googlevideo.com/hdntl=${token}/videoplayback?expire=999&sig=${token}`,
      semanticIdentity: videoIdentity,
      publicHeaders: {
        "User-Agent": "Mozilla/5.0 Kirinuki",
        Accept: "*/*",
        Referer: "https://www.youtube.com/"
      }
    },
    ...(withAudio
      ? {
        audio: {
          url: `https://rr1.googlevideo.com/hdntl=${token}/audioplayback?expire=999&sig=${token}`,
          semanticIdentity: audioIdentity,
          publicHeaders: {
            "Sec-Fetch-Mode": "navigate",
            "User-Agent": "Mozilla/5.0 Kirinuki"
          }
        }
      }
      : {})
  };
}

function dependencies(
  overrides: Partial<ExternalVodDirectAcquirerDependencies> = {}
): ExternalVodDirectAcquirerDependencies {
  return {
    assertAllowedUrl(url) {
      assert.equal(url.protocol, "https:");
      assert.equal(url.hostname, "rr1.googlevideo.com");
    },
    async runProcess(_command, args) {
      const outputPath = args.at(-1);
      assert.ok(outputPath);
      const caPaths = args.flatMap((value, index) => (
        value === "-ca_file" && args[index + 1] ? [args[index + 1]!] : []
      ));
      assert.ok(caPaths.length >= 1);
      assert.equal(new Set(caPaths).size, 1);
      assert.equal(path.dirname(caPaths[0]!), path.dirname(outputPath));
      const caBundle = await readFile(caPaths[0]!, "utf8");
      assert.match(caBundle, /^-----BEGIN CERTIFICATE-----/u);
      assert.match(caBundle, /-----END CERTIFICATE-----\n$/u);
      await writeFile(outputPath, Buffer.from("mock-direct-mp4"), { flag: "wx" });
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    async inspectOutput() {
      return {
        durationMs: 30_000,
        video: { startMs: 0, durationMs: 30_000, endMs: 30_000 },
        audio: { startMs: 0, durationMs: 30_000, endMs: 30_000 }
      };
    },
    ffmpegBinary: "ffmpeg",
    ...overrides
  };
}

async function temporaryRoot(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), "kirinuki-direct-acquirer-test-"));
}

function assertCode(error: unknown, code: string): boolean {
  assert.ok(error instanceof ExternalVodDirectAcquisitionError);
  assert.equal(error.code, code);
  return true;
}

test("FFmpeg arguments seek both exact inputs and use deterministic public headers", () => {
  const args = buildExternalVodDirectFfmpegArgs({
    inputs: {
      video: {
        url: "https://rr1.googlevideo.com/video?sig=secret",
        semanticIdentity: videoIdentity,
        headerNames: ["accept", "user-agent"],
        headerBlock: "accept: */*\r\nuser-agent: Test\r\n"
      },
      audio: {
        url: "https://rr1.googlevideo.com/audio?sig=secret",
        semanticIdentity: audioIdentity,
        headerNames: ["user-agent"],
        headerBlock: "user-agent: Test\r\n"
      }
    },
    outputPath: "/private/work/output.mp4",
    sourceStartUs: 123_456_000,
    durationUs: 30_000_000,
    tlsCaFile: "/private/work/node-root-ca.pem"
  });
  assert.equal(args.filter((value) => value === "-ss").length, 2);
  const seekValues = args.flatMap((value, index) => (
    value === "-ss" ? [args[index + 1]] : []
  ));
  assert.deepEqual(seekValues, ["123.456000", "123.456000"]);
  assert.equal(args.filter((value) => value === "-headers").length, 2);
  assert.equal(args.filter((value) => value === "-tls_verify").length, 2);
  assert.equal(args.filter((value) => value === "1").length >= 2, true);
  assert.equal(args.filter((value) => value === "-ca_file").length, 2);
  assert.equal(
    args.filter((value) => value === "/private/work/node-root-ca.pem").length,
    2
  );
  assert.equal(args.filter((value) => value === "-max_redirects").length, 2);
  for (const inputIndex of args.flatMap((value, index) => (
    value === "-i" ? [index] : []
  ))) {
    const previousInput = args.slice(0, inputIndex).lastIndexOf("-i");
    const inputArgs = args.slice(previousInput < 0 ? 0 : previousInput + 2, inputIndex);
    const exactOption = (name: string, expected: string): void => {
      const optionIndex = inputArgs.indexOf(name);
      assert.notEqual(optionIndex, -1, name);
      assert.equal(inputArgs[optionIndex + 1], expected, name);
    };
    exactOption("-protocol_whitelist", "https,tls,tcp");
    exactOption("-tls_verify", "1");
    exactOption("-ca_file", "/private/work/node-root-ca.pem");
    exactOption("-max_redirects", "0");
  }
  assert.ok(args.includes("1:a:0?"));
  assert.ok(args.includes("setpts=PTS-STARTPTS"));
  assert.ok(args.includes("asetpts=PTS-STARTPTS"));
  assert.equal(args.at(-1), path.resolve("/private/work/output.mp4"));
});

test("direct acquisition rejects a shape-valid forged clock-proof ID before FFmpeg", async () => {
  const root = await temporaryRoot();
  let processCalled = false;
  try {
    const forged = { ...clockProof(), proofId: "0".repeat(64) };
    await assert.rejects(
      acquireExternalVodDirectSection({
        sectionId: "forged-clock-proof",
        partProofId: PART_PROOF_ID,
        clockProof: forged,
        runtimeInputs: runtimeInputs(),
        sourceStartMs: 120_000,
        sourceEndMs: 150_000,
        workDirectory: path.join(root, "work"),
        outputPath: path.join(root, "work", "section.mp4")
      }, dependencies({
        async runProcess() {
          processCalled = true;
          return { exitCode: 0, stdout: "", stderr: "" };
        }
      })),
      (error) => assertCode(error, "INVALID_DIRECT_CLOCK_PROOF")
    );
    assert.equal(processCalled, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("strict direct acquisition emits a compact URL-free proof", async () => {
  const root = await temporaryRoot();
  const workDirectory = path.join(root, "work");
  const outputPath = path.join(workDirectory, "section.mp4");
  let observedArgs: readonly string[] = [];
  try {
    const result = await acquireExternalVodDirectSection({
      sectionId: "youtube-section-1",
      partProofId: PART_PROOF_ID,
      clockProof: clockProof(),
      runtimeInputs: runtimeInputs(),
      sourceStartMs: 120_000,
      sourceEndMs: 150_000,
      workDirectory,
      outputPath
    }, dependencies({
      async runProcess(_command, args) {
        observedArgs = args;
        const generatedPath = args.at(-1);
        assert.ok(generatedPath);
        await writeFile(generatedPath, Buffer.from("mock-direct-mp4"), { flag: "wx" });
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    }));
    assert.equal(observedArgs.filter((value) => value === "-i").length, 2);
    assert.equal(result.evidence.schemaId, EXTERNAL_VOD_DIRECT_SECTION_EVIDENCE_SCHEMA);
    assert.equal(result.evidence.partProofId, PART_PROOF_ID);
    assert.equal(result.evidence.encodingProfileSha256, EXTERNAL_VOD_DIRECT_ENCODING_PROFILE_SHA256);
    assert.equal(result.evidence.sourceStartUs, 120_000_000);
    assert.equal(result.evidence.hasSeparateAudio, true);
    assert.deepEqual(
      parseExternalVodDirectSectionEvidence(
        JSON.parse(JSON.stringify(result.evidence)) as unknown
      ),
      result.evidence
    );
    const serialized = JSON.stringify(result.evidence);
    assert.ok(serialized.length < 2_048);
    assert.doesNotMatch(serialized, /googlevideo|hdntl|expire|sig=|Mozilla|Referer/u);
    assert.equal(await readFile(outputPath, "utf8"), "mock-direct-mp4");
    assert.deepEqual(await readdir(workDirectory), ["section.mp4"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("video-only proven input remains valid when audio is not required", async () => {
  const root = await temporaryRoot();
  const workDirectory = path.join(root, "work");
  let observedArgs: readonly string[] = [];
  try {
    const result = await acquireExternalVodDirectSection({
      sectionId: "video-only",
      partProofId: PART_PROOF_ID,
      clockProof: clockProof(false),
      runtimeInputs: runtimeInputs("video-only", false),
      sourceStartMs: 120_000,
      sourceEndMs: 150_000,
      workDirectory,
      outputPath: path.join(workDirectory, "section.mp4"),
      requireAudio: false
    }, dependencies({
      async runProcess(_command, args) {
        observedArgs = args;
        const generatedPath = args.at(-1);
        assert.ok(generatedPath);
        await writeFile(generatedPath, Buffer.from("video-only"), { flag: "wx" });
        return { exitCode: 0, stdout: "", stderr: "" };
      },
      async inspectOutput() {
        return {
          durationMs: 30_000,
          video: { startMs: 0, durationMs: 30_000, endMs: 30_000 }
        };
      }
    }));
    assert.equal(observedArgs.filter((value) => value === "-i").length, 1);
    assert.ok(observedArgs.includes("0:a:0?"));
    assert.equal(result.evidence.hasSeparateAudio, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("private, duplicate, and CRLF headers are rejected before FFmpeg", async () => {
  const root = await temporaryRoot();
  const workDirectory = path.join(root, "work");
  for (const publicHeaders of [
    { Cookie: "SID=secret" },
    { "User-Agent": "safe", "user-agent": "duplicate" },
    { Referer: "https://youtube.com/\r\nAuthorization: secret" }
  ]) {
    const inputs = runtimeInputs();
    inputs.video.publicHeaders = publicHeaders;
    await assert.rejects(
      acquireExternalVodDirectSection({
        sectionId: "unsafe-header",
        partProofId: PART_PROOF_ID,
        clockProof: clockProof(),
        runtimeInputs: inputs,
        sourceStartMs: 120_000,
        sourceEndMs: 150_000,
        workDirectory,
        outputPath: path.join(workDirectory, `${digest(JSON.stringify(publicHeaders))}.mp4`)
      }, dependencies()),
      (error) => assertCode(error, "UNSAFE_DIRECT_HEADERS")
    );
  }
  await rm(root, { recursive: true, force: true });
});

test("runtime input mutation during FFmpeg is rejected without publishing", async () => {
  const root = await temporaryRoot();
  const workDirectory = path.join(root, "work");
  const outputPath = path.join(workDirectory, "section.mp4");
  const inputs = runtimeInputs();
  try {
    await assert.rejects(
      acquireExternalVodDirectSection({
        sectionId: "mutated-input",
        partProofId: PART_PROOF_ID,
        clockProof: clockProof(),
        runtimeInputs: inputs,
        sourceStartMs: 120_000,
        sourceEndMs: 150_000,
        workDirectory,
        outputPath
      }, dependencies({
        async runProcess(_command, args) {
          const generatedPath = args.at(-1);
          assert.ok(generatedPath);
          inputs.video.url = "https://rr1.googlevideo.com/replaced";
          await writeFile(generatedPath, Buffer.from("mock-direct-mp4"), { flag: "wx" });
          return { exitCode: 0, stdout: "", stderr: "" };
        }
      })),
      (error) => assertCode(error, "SOURCE_CHANGED")
    );
    assert.equal(existsSync(outputPath), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("duration mismatch and a semantic input/proof mismatch fail closed", async () => {
  const root = await temporaryRoot();
  const workDirectory = path.join(root, "work");
  try {
    await assert.rejects(
      acquireExternalVodDirectSection({
        sectionId: "wrong-duration",
        partProofId: PART_PROOF_ID,
        clockProof: clockProof(),
        runtimeInputs: runtimeInputs(),
        sourceStartMs: 120_000,
        sourceEndMs: 150_000,
        workDirectory,
        outputPath: path.join(workDirectory, "duration.mp4")
      }, dependencies({
        async inspectOutput() {
          return {
            durationMs: 29_000,
            video: { startMs: 0, durationMs: 29_000, endMs: 29_000 },
            audio: { startMs: 0, durationMs: 29_000, endMs: 29_000 }
          };
        }
      })),
      (error) => assertCode(error, "MEDIA_VERIFICATION_FAILED")
    );

    const mismatched = runtimeInputs();
    mismatched.video.semanticIdentity = "youtube:format:DIFFERENT";
    await assert.rejects(
      acquireExternalVodDirectSection({
        sectionId: "wrong-proof-input",
        partProofId: PART_PROOF_ID,
        clockProof: clockProof(),
        runtimeInputs: mismatched,
        sourceStartMs: 120_000,
        sourceEndMs: 150_000,
        workDirectory,
        outputPath: path.join(workDirectory, "identity.mp4")
      }, dependencies()),
      (error) => assertCode(error, "SOURCE_CHANGED")
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rotating query/path tokens does not rotate URL-free evidence", async () => {
  const root = await temporaryRoot();
  const workDirectory = path.join(root, "work");
  try {
    const acquire = async (token: string, outputName: string) => (
      await acquireExternalVodDirectSection({
        sectionId: "stable-signed-url",
        partProofId: PART_PROOF_ID,
        clockProof: clockProof(),
        runtimeInputs: runtimeInputs(token),
        sourceStartMs: 120_000,
        sourceEndMs: 150_000,
        workDirectory,
        outputPath: path.join(workDirectory, outputName)
      }, dependencies())
    );
    const first = await acquire("first-path-secret", "first.mp4");
    const second = await acquire("second-path-secret", "second.mp4");
    assert.equal(first.evidence.evidenceId, second.evidence.evidenceId);
    assert.doesNotMatch(
      JSON.stringify(first.evidence),
      /first-path-secret|hdntl|googlevideo/u
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persisted evidence parser rejects unknown keys and body/ID tampering", async () => {
  const root = await temporaryRoot();
  const workDirectory = path.join(root, "work");
  try {
    const result = await acquireExternalVodDirectSection({
      sectionId: "receipt-proof",
      partProofId: PART_PROOF_ID,
      clockProof: clockProof(),
      runtimeInputs: runtimeInputs(),
      sourceStartMs: 120_000,
      sourceEndMs: 150_000,
      workDirectory,
      outputPath: path.join(workDirectory, "section.mp4")
    }, dependencies());
    assert.throws(
      () => parseExternalVodDirectSectionEvidence({
        ...result.evidence,
        runtimeUrl: "https://rr1.googlevideo.com/private?sig=secret"
      }),
      (error) => assertCode(error, "INVALID_DIRECT_EVIDENCE")
    );
    const changed = JSON.parse(JSON.stringify(result.evidence)) as {
      output: { durationMs: number };
    };
    changed.output.durationMs = 29_999;
    assert.throws(
      () => parseExternalVodDirectSectionEvidence(changed),
      (error) => assertCode(error, "INVALID_DIRECT_EVIDENCE")
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
