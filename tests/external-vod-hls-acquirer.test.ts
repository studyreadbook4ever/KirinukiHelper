import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EXTERNAL_VOD_HLS_PERSISTED_CLOCK_SCHEMA,
  EXTERNAL_VOD_HLS_SECTION_CLOCK_SCHEMA,
  MAX_EXTERNAL_VOD_HLS_STREAM_EDGE_TOLERANCE_MS,
  ExternalVodHlsAcquisitionError,
  acquireExternalVodHlsSection as acquireExternalVodHlsSectionImplementation,
  buildExternalVodHlsConcatDescription,
  externalVodHlsFragmentFileName,
  buildExternalVodHlsTrimArgs,
  externalVodHlsPlaylistFingerprintSha256,
  parseExternalVodHlsPersistedClockEvidence,
  parseExternalVodHlsSectionClockEvidence,
  selectExternalVodHlsSegmentRange
} from "../scripts/external-vod-hls-acquirer.js";
import type {
  ExternalVodHlsAcquirerDependencies,
  ExternalVodHlsTimeline,
  ExternalVodHlsTimelineSegment
} from "../scripts/external-vod-hls-acquirer.js";

const fingerprint = (label: string): string => (
  createHash("sha256").update(label).digest("hex")
);

const TEST_PART_PROOF_ID = fingerprint("test-part-proof");
const TEST_CLOCK_PROOF_ID = fingerprint("test-clock-proof");

async function acquireExternalVodHlsSection(
  request: Omit<
    Parameters<typeof acquireExternalVodHlsSectionImplementation>[0],
    "partProofId" | "clockProofId"
  >,
  deps: Parameters<typeof acquireExternalVodHlsSectionImplementation>[1]
): ReturnType<typeof acquireExternalVodHlsSectionImplementation> {
  return await acquireExternalVodHlsSectionImplementation({
    ...request,
    partProofId: TEST_PART_PROOF_ID,
    clockProofId: TEST_CLOCK_PROOF_ID
  }, deps);
}

function box(type: string, payload = Buffer.alloc(0)): Buffer {
  assert.equal(type.length, 4);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.byteLength, 0);
  header.write(type, 4, 4, "latin1");
  return Buffer.concat([header, payload]);
}

const initBytes = Buffer.concat([box("ftyp"), box("moov")]);
const fragmentBytes = Buffer.concat([box("moof"), box("mdat")]);

function timeline(
  segments: ExternalVodHlsTimelineSegment[] = [
    {
      sequence: 7,
      startUs: 0,
      durationUs: 2_000_000,
      uri: "https://media.example/segment-7.m4s?token=first-secret",
      semanticUri: "https://media.example/segment-7.m4s"
    },
    {
      sequence: 8,
      startUs: 2_000_000,
      durationUs: 2_000_000,
      uri: "https://media.example/segment-8.m4s?token=second-secret",
      semanticUri: "https://media.example/segment-8.m4s"
    },
    {
      sequence: 9,
      startUs: 4_000_000,
      durationUs: 2_000_000,
      uri: "https://media.example/segment-9.m4s?token=third-secret",
      semanticUri: "https://media.example/segment-9.m4s"
    }
  ]
): ExternalVodHlsTimeline {
  const lastSegment = segments.at(-1);
  assert.ok(lastSegment);
  const withoutFingerprint: Omit<
    ExternalVodHlsTimeline,
    "playlistFingerprintSha256"
  > = {
    playlistUri: "https://media.example/vod.m3u8?token=playlist-secret",
    playlistSemanticUri: "https://media.example/vod.m3u8",
    renditionFingerprintSha256: fingerprint("rendition"),
    durationUs: lastSegment.startUs + lastSegment.durationUs,
    hasEndList: true,
    hasIndependentSegments: true,
    map: {
      uri: "https://media.example/init.mp4?token=init-secret",
      semanticUri: "https://media.example/init.mp4"
    },
    segments
  };
  return {
    ...withoutFingerprint,
    playlistFingerprintSha256: externalVodHlsPlaylistFingerprintSha256(
      withoutFingerprint
    )
  };
}

function dependencies(
  overrides: Partial<ExternalVodHlsAcquirerDependencies> = {}
): ExternalVodHlsAcquirerDependencies {
  return {
    assertAllowedUrl(url) {
      assert.equal(url.protocol, "https:");
      assert.equal(url.hostname, "media.example");
    },
    async fetchValidatedBinary(request) {
      return {
        bytes: request.kind === "init" ? initBytes : fragmentBytes,
        finalUrl: request.url.href
      };
    },
    async runProcess(_command, args) {
      const outputPath = args.at(-1);
      assert.ok(outputPath);
      await writeFile(outputPath, Buffer.from("mock-mp4"), { flag: "wx" });
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    async inspectOutput() {
      return {
        durationMs: 3_000,
        video: { startMs: 0, durationMs: 3_000, endMs: 3_000 },
        audio: { startMs: 0, durationMs: 3_000, endMs: 3_000 }
      };
    },
    ffmpegBinary: "ffmpeg",
    ...overrides
  };
}

async function temporaryRoot(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), "kirinuki-hls-acquirer-test-"));
}

function assertCode(error: unknown, code: string): boolean {
  assert.ok(error instanceof ExternalVodHlsAcquisitionError);
  assert.equal(error.code, code);
  return true;
}

test("segment selection uses the cumulative EXTINF clock with exact boundaries", () => {
  const selected = selectExternalVodHlsSegmentRange(timeline(), 2_000, 4_000);
  assert.deepEqual(selected.segments.map(({ sequence }) => sequence), [8]);
  assert.equal(selected.firstSegmentOffsetUs, 0);

  const crossing = selectExternalVodHlsSegmentRange(timeline(), 1_501, 4_499);
  assert.deepEqual(crossing.segments.map(({ sequence }) => sequence), [7, 8, 9]);
  assert.equal(crossing.firstSegmentOffsetUs, 1_501_000);
  assert.equal(crossing.sourceEndUs - crossing.sourceStartUs, 2_998_000);
});

test("concat manifest and FFmpeg args retain microsecond clock precision", () => {
  const description = buildExternalVodHlsConcatDescription([
    { durationUs: 2_001_234 },
    { durationUs: 1_998_766 }
  ], "linux");
  assert.equal(description, [
    "ffconcat version 1.0",
    "file 'fragment-000001.mp4'",
    "duration 2.001234",
    "file 'fragment-000002.mp4'",
    "duration 1.998766",
    ""
  ].join("\n"));
  assert.equal(externalVodHlsFragmentFileName(0, "win32"), "f-000001.mp4");
  assert.equal(buildExternalVodHlsConcatDescription([
    { durationUs: 2_001_234 }
  ], "win32"), [
    "ffconcat version 1.0",
    "file 'f-000001.mp4'",
    "duration 2.001234",
    ""
  ].join("\n"));

  const args = buildExternalVodHlsTrimArgs({
    concatListPath: "/private/work/fragments.ffconcat",
    outputPath: "/private/work/output.mp4",
    firstSegmentOffsetUs: 699_576,
    durationUs: 5_000_000
  });
  assert.equal(args[args.indexOf("-ss") + 1], "0.699576");
  assert.equal(args[args.indexOf("-t") + 1], "5.000000");
  assert.ok(args.includes("-map_metadata"));
  assert.ok(args.includes("yuv420p"));
});

test("HLS acquisition rejects a shape-valid forged playlist fingerprint before fetch", async () => {
  const root = await temporaryRoot();
  let fetchCalled = false;
  try {
    const forged = {
      ...timeline(),
      playlistFingerprintSha256: "0".repeat(64)
    };
    await assert.rejects(
      acquireExternalVodHlsSection({
        sectionId: "forged-playlist-fingerprint",
        sourceStartMs: 1_500,
        sourceEndMs: 4_500,
        timeline: forged,
        workDirectory: path.join(root, "work"),
        outputPath: path.join(root, "work", "section.mp4")
      }, dependencies({
        async fetchValidatedBinary(request) {
          fetchCalled = true;
          return {
            bytes: request.kind === "init" ? initBytes : fragmentBytes,
            finalUrl: request.url.href
          };
        }
      })),
      (error) => assertCode(error, "INVALID_HLS_TIMELINE")
    );
    assert.equal(fetchCalled, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("strict acquisition writes init+fragment files, trims once, and emits no raw URL", async () => {
  const root = await temporaryRoot();
  const workDirectory = path.join(root, "work");
  const outputPath = path.join(workDirectory, "section.mp4");
  const fetchedKinds: string[] = [];
  let observedManifest = "";
  let observedArgs: readonly string[] = [];
  try {
    const result = await acquireExternalVodHlsSection({
      sectionId: "part-2-section-1",
      sourceStartMs: 1_500,
      sourceEndMs: 4_500,
      timeline: timeline(),
      workDirectory,
      outputPath
    }, dependencies({
      async fetchValidatedBinary(request) {
        fetchedKinds.push(request.kind);
        assert.ok(request.maximumBytes > 0);
        return {
          bytes: request.kind === "init" ? initBytes : fragmentBytes,
          finalUrl: request.url.href
        };
      },
      async runProcess(_command, args) {
        observedArgs = args;
        const concatPath = args[args.indexOf("-i") + 1];
        const generatedPath = args.at(-1);
        assert.ok(concatPath);
        assert.ok(generatedPath);
        observedManifest = await readFile(concatPath, "utf8");
        const fragmentPath = path.join(
          path.dirname(concatPath),
          externalVodHlsFragmentFileName(0)
        );
        const assembled = await readFile(fragmentPath);
        assert.deepEqual(assembled, Buffer.concat([initBytes, fragmentBytes]));
        await writeFile(generatedPath, Buffer.from("mock-mp4"), { flag: "wx" });
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    }));

    assert.deepEqual(fetchedKinds, ["init", "fragment", "fragment", "fragment"]);
    assert.match(observedManifest, /duration 2\.000000/u);
    assert.equal(observedArgs[observedArgs.indexOf("-ss") + 1], "1.500000");
    assert.equal(observedArgs[observedArgs.indexOf("-t") + 1], "3.000000");
    assert.equal(result.evidence.schemaId, EXTERNAL_VOD_HLS_SECTION_CLOCK_SCHEMA);
    assert.deepEqual(
      result.evidence.segments.map(({ sequence }) => sequence),
      [7, 8, 9]
    );
    assert.equal(result.evidence.mapping.sourceAnchorUs, 1_500_000);
    assert.equal(result.evidence.mapping.outputAnchorUs, 0);
    assert.match(result.evidence.evidenceId, /^[a-f0-9]{64}$/u);
    assert.equal(
      result.persistedEvidence.schemaId,
      EXTERNAL_VOD_HLS_PERSISTED_CLOCK_SCHEMA
    );
    assert.equal(result.persistedEvidence.partProofId, TEST_PART_PROOF_ID);
    assert.equal(result.persistedEvidence.clockProofId, TEST_CLOCK_PROOF_ID);
    assert.equal(result.persistedEvidence.precedingSegment, null);
    assert.deepEqual(
      result.persistedEvidence.firstSegment,
      result.evidence.segments[0]
    );
    assert.deepEqual(
      result.persistedEvidence.lastSegment,
      result.evidence.segments.at(-1)
    );
    assert.deepEqual(
      parseExternalVodHlsSectionClockEvidence(
        JSON.parse(JSON.stringify(result.evidence)) as unknown
      ),
      result.evidence
    );
    assert.deepEqual(
      parseExternalVodHlsPersistedClockEvidence(
        JSON.parse(JSON.stringify(result.persistedEvidence)) as unknown
      ),
      result.persistedEvidence
    );
    const serializedPersistedEvidence = JSON.stringify(result.persistedEvidence);
    assert.ok(serializedPersistedEvidence.length < 4_096);
    assert.equal(result.persistedEvidence.segmentCount, 3);
    const serializedEvidence = JSON.stringify(result.evidence);
    assert.doesNotMatch(serializedEvidence, /media\.example|secret|token=/u);
    assert.doesNotMatch(
      serializedPersistedEvidence,
      /https?:|media\.example|secret|token=|\.m3u8|\.m4s/u
    );
    assert.equal(await readFile(outputPath, "utf8"), "mock-mp4");
    const remaining = await readdir(workDirectory);
    assert.deepEqual(remaining, ["section.mp4"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("offline evidence parsing rejects unknown keys and any body/ID mismatch", async () => {
  const root = await temporaryRoot();
  const workDirectory = path.join(root, "work");
  try {
    const result = await acquireExternalVodHlsSection({
      sectionId: "receipt-proof",
      sourceStartMs: 1_500,
      sourceEndMs: 4_500,
      timeline: timeline(),
      workDirectory,
      outputPath: path.join(workDirectory, "section.mp4")
    }, dependencies());
    const withUnknownKey = {
      ...result.evidence,
      rawPlaylistUrl: "https://media.example/private.m3u8?token=leak"
    };
    assert.throws(
      () => parseExternalVodHlsSectionClockEvidence(withUnknownKey),
      (error) => assertCode(error, "INVALID_HLS_CLOCK_EVIDENCE")
    );
    const changedOutput = JSON.parse(JSON.stringify(result.evidence)) as {
      output: { durationMs: number };
    };
    changedOutput.output.durationMs = 2_999;
    assert.throws(
      () => parseExternalVodHlsSectionClockEvidence(changedOutput),
      (error) => assertCode(error, "INVALID_HLS_CLOCK_EVIDENCE")
    );

    const changedEdgeHash = JSON.parse(JSON.stringify(result.persistedEvidence)) as {
      firstSegment: { contentSha256: string };
    };
    changedEdgeHash.firstSegment.contentSha256 = fingerprint("different-fragment-bytes");
    assert.throws(
      () => parseExternalVodHlsPersistedClockEvidence(changedEdgeHash),
      (error) => assertCode(error, "INVALID_HLS_CLOCK_EVIDENCE")
    );

    const invalidEdgeSize = JSON.parse(JSON.stringify(result.persistedEvidence)) as {
      firstSegment: { sizeBytes: number };
    };
    invalidEdgeSize.firstSegment.sizeBytes = 0;
    assert.throws(
      () => parseExternalVodHlsPersistedClockEvidence(invalidEdgeSize),
      (error) => assertCode(error, "INVALID_HLS_CLOCK_EVIDENCE")
    );

    const legacySchema = JSON.parse(JSON.stringify(result.persistedEvidence)) as {
      schemaId: string;
    };
    legacySchema.schemaId = "chzzk-kirinuki/external-vod-hls-persisted-clock-v2";
    assert.throws(
      () => parseExternalVodHlsPersistedClockEvidence(legacySchema),
      (error) => assertCode(error, "INVALID_HLS_CLOCK_EVIDENCE")
    );

    const missingProofBinding = JSON.parse(JSON.stringify(
      result.persistedEvidence
    )) as Record<string, unknown>;
    delete missingProofBinding.partProofId;
    assert.throws(
      () => parseExternalVodHlsPersistedClockEvidence(missingProofBinding),
      (error) => assertCode(error, "INVALID_HLS_CLOCK_EVIDENCE")
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persisted edge byte anchors rotate when semantic HLS resources serve different bytes", async () => {
  const root = await temporaryRoot();
  const workDirectory = path.join(root, "work");
  const firstFragmentBytes = Buffer.concat([
    box("moof"),
    box("mdat", Buffer.from("first-byte-version"))
  ]);
  const secondFragmentBytes = Buffer.concat([
    box("moof"),
    box("mdat", Buffer.from("second-longer-byte-version"))
  ]);
  const acquiringWith = (bytes: Buffer): ExternalVodHlsAcquirerDependencies => (
    dependencies({
      async fetchValidatedBinary(request) {
        return {
          bytes: request.kind === "init" ? initBytes : bytes,
          finalUrl: request.url.href
        };
      }
    })
  );
  try {
    const first = await acquireExternalVodHlsSection({
      sectionId: "same-semantics-different-bytes",
      sourceStartMs: 1_500,
      sourceEndMs: 4_500,
      timeline: timeline(),
      workDirectory,
      outputPath: path.join(workDirectory, "first.mp4")
    }, acquiringWith(firstFragmentBytes));
    const second = await acquireExternalVodHlsSection({
      sectionId: "same-semantics-different-bytes",
      sourceStartMs: 1_500,
      sourceEndMs: 4_500,
      timeline: timeline(),
      workDirectory,
      outputPath: path.join(workDirectory, "second.mp4")
    }, acquiringWith(secondFragmentBytes));

    assert.equal(
      first.persistedEvidence.resourceSetFingerprintSha256,
      second.persistedEvidence.resourceSetFingerprintSha256
    );
    assert.equal(
      first.persistedEvidence.firstSegment.semanticUriSha256,
      second.persistedEvidence.firstSegment.semanticUriSha256
    );
    assert.notEqual(
      first.persistedEvidence.firstSegment.contentSha256,
      second.persistedEvidence.firstSegment.contentSha256
    );
    assert.notEqual(
      first.persistedEvidence.lastSegment.contentSha256,
      second.persistedEvidence.lastSegment.contentSha256
    );
    assert.notEqual(
      first.persistedEvidence.firstSegment.sizeBytes,
      second.persistedEvidence.firstSegment.sizeBytes
    );
    assert.notEqual(first.persistedEvidence.evidenceId, second.persistedEvidence.evidenceId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("single-segment persisted evidence requires byte-identical first and last anchors", async () => {
  const root = await temporaryRoot();
  const workDirectory = path.join(root, "work");
  try {
    const result = await acquireExternalVodHlsSection({
      sectionId: "single-segment-proof",
      sourceStartMs: 2_000,
      sourceEndMs: 4_000,
      timeline: timeline(),
      workDirectory,
      outputPath: path.join(workDirectory, "single.mp4")
    }, dependencies({
      async inspectOutput() {
        return {
          durationMs: 2_000,
          video: { startMs: 0, durationMs: 2_000, endMs: 2_000 },
          audio: { startMs: 0, durationMs: 2_000, endMs: 2_000 }
        };
      }
    }));
    assert.equal(result.persistedEvidence.segmentCount, 1);
    assert.equal(result.persistedEvidence.precedingSegment?.sequence, 7);
    assert.equal(result.persistedEvidence.firstSegment.sequence, 8);
    assert.deepEqual(
      result.persistedEvidence.firstSegment,
      result.persistedEvidence.lastSegment
    );

    const tampered = JSON.parse(JSON.stringify(result.persistedEvidence)) as Record<
      string,
      unknown
    > & {
      evidenceId: string;
      lastSegment: { contentSha256: string };
    };
    tampered.lastSegment.contentSha256 = fingerprint("substituted-last-edge-bytes");
    const { evidenceId: _oldEvidenceId, ...tamperedBody } = tampered;
    tampered.evidenceId = fingerprint(JSON.stringify(tamperedBody));
    assert.throws(
      () => parseExternalVodHlsPersistedClockEvidence(tampered),
      (error) => assertCode(error, "INVALID_HLS_CLOCK_EVIDENCE")
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preceding generation anchor rotates when only the adjacent boundary bytes change", async () => {
  const root = await temporaryRoot();
  const workDirectory = path.join(root, "work");
  const firstBoundaryBytes = Buffer.concat([
    box("moof"),
    box("mdat", Buffer.from("boundary-generation-a"))
  ]);
  const secondBoundaryBytes = Buffer.concat([
    box("moof"),
    box("mdat", Buffer.from("boundary-generation-b"))
  ]);
  let boundaryBytes = firstBoundaryBytes;
  const deps = dependencies({
    async fetchValidatedBinary(request) {
      const bytes = request.kind === "init"
        ? initBytes
        : request.url.pathname.endsWith("segment-7.m4s")
          ? boundaryBytes
          : fragmentBytes;
      return { bytes, finalUrl: request.url.href };
    },
    async inspectOutput() {
      return {
        durationMs: 2_000,
        video: { startMs: 0, durationMs: 2_000, endMs: 2_000 },
        audio: { startMs: 0, durationMs: 2_000, endMs: 2_000 }
      };
    }
  });
  try {
    const first = await acquireExternalVodHlsSection({
      sectionId: "boundary-generation-proof",
      sourceStartMs: 2_000,
      sourceEndMs: 4_000,
      timeline: timeline(),
      workDirectory,
      outputPath: path.join(workDirectory, "first.mp4")
    }, deps);
    boundaryBytes = secondBoundaryBytes;
    const second = await acquireExternalVodHlsSection({
      sectionId: "boundary-generation-proof",
      sourceStartMs: 2_000,
      sourceEndMs: 4_000,
      timeline: timeline(),
      workDirectory,
      outputPath: path.join(workDirectory, "second.mp4")
    }, deps);

    assert.equal(first.persistedEvidence.firstSegment.contentSha256,
      second.persistedEvidence.firstSegment.contentSha256);
    assert.notEqual(first.persistedEvidence.precedingSegment?.contentSha256,
      second.persistedEvidence.precedingSegment?.contentSha256);
    assert.notEqual(first.persistedEvidence.evidenceId, second.persistedEvidence.evidenceId);
    assert.doesNotMatch(JSON.stringify(second.persistedEvidence), /https?:|token=|secret/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rotating only signed URL queries does not rotate semantic clock evidence", async () => {
  const root = await temporaryRoot();
  const workDirectory = path.join(root, "work");
  const firstTimeline = timeline();
  const rotateQuery = (uri: string): string => {
    const url = new URL(uri);
    url.search = "?token=rotated-signature&expires=9999999999";
    return url.href;
  };
  const secondTimeline: ExternalVodHlsTimeline = {
    ...firstTimeline,
    playlistUri: rotateQuery(firstTimeline.playlistUri),
    map: { ...firstTimeline.map, uri: rotateQuery(firstTimeline.map.uri) },
    segments: firstTimeline.segments.map((segment) => ({
      ...segment,
      uri: rotateQuery(segment.uri)
    }))
  };
  try {
    const first = await acquireExternalVodHlsSection({
      sectionId: "stable-proof",
      sourceStartMs: 1_500,
      sourceEndMs: 4_500,
      timeline: firstTimeline,
      workDirectory,
      outputPath: path.join(workDirectory, "first.mp4")
    }, dependencies());
    const second = await acquireExternalVodHlsSection({
      sectionId: "stable-proof",
      sourceStartMs: 1_500,
      sourceEndMs: 4_500,
      timeline: secondTimeline,
      workDirectory,
      outputPath: path.join(workDirectory, "second.mp4")
    }, dependencies());
    assert.equal(
      first.evidence.resourceSetFingerprintSha256,
      second.evidence.resourceSetFingerprintSha256
    );
    assert.equal(first.evidence.evidenceId, second.evidence.evidenceId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rotating CHZZK-style hdntl path credentials never rotates persisted evidence", async () => {
  const root = await temporaryRoot();
  const workDirectory = path.join(root, "work");
  const withPathToken = (uri: string, token: string): string => {
    const url = new URL(uri);
    url.pathname = `/hdntl=${token}${url.pathname}`;
    return url.href;
  };
  const pathTimeline = (token: string): ExternalVodHlsTimeline => {
    const base = timeline();
    return {
      ...base,
      playlistUri: withPathToken(base.playlistUri, token),
      map: { ...base.map, uri: withPathToken(base.map.uri, token) },
      segments: base.segments.map((segment) => ({
        ...segment,
        uri: withPathToken(segment.uri, token)
      }))
    };
  };
  try {
    const first = await acquireExternalVodHlsSection({
      sectionId: "path-token-proof",
      sourceStartMs: 1_500,
      sourceEndMs: 4_500,
      timeline: pathTimeline("exp~acl~first-secret-hmac"),
      workDirectory,
      outputPath: path.join(workDirectory, "first.mp4")
    }, dependencies());
    const second = await acquireExternalVodHlsSection({
      sectionId: "path-token-proof",
      sourceStartMs: 1_500,
      sourceEndMs: 4_500,
      timeline: pathTimeline("exp~acl~second-secret-hmac"),
      workDirectory,
      outputPath: path.join(workDirectory, "second.mp4")
    }, dependencies());
    assert.equal(
      first.persistedEvidence.resourceSetFingerprintSha256,
      second.persistedEvidence.resourceSetFingerprintSha256
    );
    assert.equal(
      first.persistedEvidence.fetchedResourcesSha256,
      second.persistedEvidence.fetchedResourcesSha256
    );
    assert.equal(first.persistedEvidence.evidenceId, second.persistedEvidence.evidenceId);
    assert.doesNotMatch(
      JSON.stringify(first.persistedEvidence),
      /hdntl|first-secret|media\.example/u
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an authoritative fragment hash mismatch fails closed before FFmpeg", async () => {
  const root = await temporaryRoot();
  const workDirectory = path.join(root, "work");
  const outputPath = path.join(workDirectory, "section.mp4");
  let processCalled = false;
  const segments = timeline().segments.map((segment, index) => ({
    ...segment,
    ...(index === 0 ? { expectedSha256: "0".repeat(64) } : {})
  }));
  try {
    await assert.rejects(
      acquireExternalVodHlsSection({
        sectionId: "hash-mismatch",
        sourceStartMs: 0,
        sourceEndMs: 1_000,
        timeline: timeline(segments),
        workDirectory,
        outputPath
      }, dependencies({
        async runProcess() {
          processCalled = true;
          return { exitCode: 0, stdout: "", stderr: "" };
        }
      })),
      (error) => assertCode(error, "HLS_RESOURCE_CHANGED")
    );
    assert.equal(processCalled, false);
    assert.equal(existsSync(outputPath), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a timeline mutated during acquisition is rejected and never published", async () => {
  const root = await temporaryRoot();
  const workDirectory = path.join(root, "work");
  const outputPath = path.join(workDirectory, "section.mp4");
  const mutableSegments = [...timeline().segments];
  const mutableTimeline = timeline(mutableSegments);
  try {
    await assert.rejects(
      acquireExternalVodHlsSection({
        sectionId: "mutated-clock",
        sourceStartMs: 1_500,
        sourceEndMs: 4_500,
        timeline: mutableTimeline,
        workDirectory,
        outputPath
      }, dependencies({
        async runProcess(_command, args) {
          const generatedPath = args.at(-1);
          assert.ok(generatedPath);
          mutableSegments[0] = {
            ...mutableSegments[0]!,
            uri: "https://media.example/replaced.m4s"
          };
          await writeFile(generatedPath, Buffer.from("mock-mp4"), { flag: "wx" });
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

test("duration mismatch fails closed and leaves no output", async () => {
  const root = await temporaryRoot();
  const workDirectory = path.join(root, "work");
  const outputPath = path.join(workDirectory, "section.mp4");
  try {
    await assert.rejects(
      acquireExternalVodHlsSection({
        sectionId: "wrong-duration",
        sourceStartMs: 1_500,
        sourceEndMs: 4_500,
        timeline: timeline(),
        workDirectory,
        outputPath
      }, dependencies({
        async inspectOutput() {
          return {
            durationMs: 2_000,
            video: { startMs: 0, durationMs: 2_000, endMs: 2_000 },
            audio: { startMs: 0, durationMs: 2_000, endMs: 2_000 }
          };
        }
      })),
      (error) => assertCode(error, "MEDIA_VERIFICATION_FAILED")
    );
    assert.equal(existsSync(outputPath), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("원본 0초의 짧은 비디오 시작 공백은 보존하되 10초 이동은 거부한다", async () => {
  const acceptedRoot = await temporaryRoot();
  const rejectedRoot = await temporaryRoot();
  try {
    const accepted = await acquireExternalVodHlsSection({
      sectionId: "bounded-leading-video-gap",
      sourceStartMs: 0,
      sourceEndMs: 3_000,
      timeline: timeline(),
      workDirectory: acceptedRoot,
      outputPath: path.join(acceptedRoot, "accepted.mp4")
    }, dependencies({
      async inspectOutput() {
        return {
          durationMs: 3_021,
          video: { startMs: 1_021, durationMs: 2_000, endMs: 3_021 },
          audio: { startMs: 0, durationMs: 3_021, endMs: 3_021 }
        };
      }
    }));
    assert.equal(accepted.evidence.output.durationMs, 3_021);
    assert.equal(MAX_EXTERNAL_VOD_HLS_STREAM_EDGE_TOLERANCE_MS, 1_250);

    await assert.rejects(
      acquireExternalVodHlsSection({
        sectionId: "ten-second-video-shift",
        sourceStartMs: 0,
        sourceEndMs: 12_000,
        timeline: timeline([
          {
            sequence: 1,
            startUs: 0,
            durationUs: 12_000_000,
            uri: "https://media.example/long.m4s",
            semanticUri: "https://media.example/long.m4s"
          }
        ]),
        workDirectory: rejectedRoot,
        outputPath: path.join(rejectedRoot, "rejected.mp4")
      }, dependencies({
        async inspectOutput() {
          return {
            durationMs: 12_000,
            video: { startMs: 10_000, durationMs: 2_000, endMs: 12_000 },
            audio: { startMs: 0, durationMs: 12_000, endMs: 12_000 }
          };
        }
      })),
      (error) => assertCode(error, "MEDIA_VERIFICATION_FAILED")
    );
  } finally {
    await rm(acceptedRoot, { recursive: true, force: true });
    await rm(rejectedRoot, { recursive: true, force: true });
  }
});

test("gapped HLS timelines and malformed fMP4 fragments are rejected", async () => {
  const root = await temporaryRoot();
  const workDirectory = path.join(root, "work");
  try {
    const gapped = timeline([
      {
        sequence: 1,
        startUs: 0,
        durationUs: 2_000_000,
        uri: "https://media.example/one.m4s"
      },
      {
        sequence: 2,
        startUs: 2_001_000,
        durationUs: 3_999_000,
        uri: "https://media.example/two.m4s"
      }
    ]);
    await assert.rejects(
      acquireExternalVodHlsSection({
        sectionId: "gap",
        sourceStartMs: 0,
        sourceEndMs: 1_000,
        timeline: gapped,
        workDirectory,
        outputPath: path.join(workDirectory, "gap.mp4")
      }, dependencies()),
      (error) => assertCode(error, "INVALID_HLS_TIMELINE")
    );

    await assert.rejects(
      acquireExternalVodHlsSection({
        sectionId: "bad-fragment",
        sourceStartMs: 0,
        sourceEndMs: 1_000,
        timeline: timeline(),
        workDirectory,
        outputPath: path.join(workDirectory, "bad.mp4")
      }, dependencies({
        async fetchValidatedBinary(request) {
          return {
            bytes: request.kind === "init" ? initBytes : Buffer.from("not-an-mp4"),
            finalUrl: request.url.href
          };
        }
      })),
      (error) => assertCode(error, "INVALID_FMP4_FRAGMENT")
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
