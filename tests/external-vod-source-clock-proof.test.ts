import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  EXTERNAL_VOD_CLOCK_PROOF_SET_SCHEMA,
  EXTERNAL_VOD_PART_CLOCK_PROOF_SCHEMA,
  externalVodClockProofSetId
} from "../scripts/external-vod-clock-resolver.js";
import type {
  ExternalVodPersistedClockProofSet,
  ExternalVodPersistedPartClockProof
} from "../scripts/external-vod-clock-resolver.js";
import {
  ExternalVodSourceClockProofError,
  assertExternalVodSourceClockProofMatchesAcquisitionClockProofSet,
  assertExternalVodSourceClockProofUnchanged,
  createExternalVodSourceClockProof,
  parseExternalVodSourceClockProof
} from "../scripts/external-vod-source-clock-proof.js";

const METADATA_ID = "1".repeat(64);
const digest = (value: string): string => (
  createHash("sha256").update(value).digest("hex")
);

function persistedPart({
  platform,
  partIndex,
  partId,
  sourceStartMs,
  sourceEndMs,
  metadataDurationMs = sourceEndMs - sourceStartMs,
  resolvedDurationUs = metadataDurationMs * 1_000
}: {
  platform: "CHZZK" | "YOUTUBE" | "SOOP";
  partIndex: number;
  partId: string;
  sourceStartMs: number;
  sourceEndMs: number;
  metadataDurationMs?: number;
  resolvedDurationUs?: number;
}): ExternalVodPersistedPartClockProof {
  const hls = platform !== "YOUTUBE";
  const withoutId: Omit<ExternalVodPersistedPartClockProof, "partProofId"> = {
    schemaId: EXTERNAL_VOD_PART_CLOCK_PROOF_SCHEMA,
    partIndex,
    playlistItem: platform === "SOOP" ? partIndex + 1 : null,
    partIdentitySha256: digest(partId),
    sourceStartMs,
    sourceEndMs,
    metadataDurationMs,
    resolvedDurationUs,
    transport: hls ? "HLS" : "DIRECT",
    formatIdentitySha256: digest(`${platform}:format:${partIndex}`),
    clockProofId: digest(`${platform}:clock:${partIndex}`),
    playlistFingerprintSha256: hls
      ? digest(`${platform}:playlist:${partIndex}`)
      : null,
    renditionFingerprintSha256: hls
      ? digest(`${platform}:rendition:${partIndex}`)
      : null
  };
  return {
    ...withoutId,
    partProofId: digest(JSON.stringify(withoutId))
  };
}

function proofSet({
  platform,
  contentId,
  sourceVersionId = METADATA_ID,
  sourceDurationMs,
  metadataPartCount,
  parts
}: {
  platform: "CHZZK" | "YOUTUBE" | "SOOP";
  contentId: string;
  sourceVersionId?: string;
  sourceDurationMs: number;
  metadataPartCount: number;
  parts: readonly ExternalVodPersistedPartClockProof[];
}): ExternalVodPersistedClockProofSet {
  const withoutId: Omit<ExternalVodPersistedClockProofSet, "proofSetId"> = {
    schemaId: EXTERNAL_VOD_CLOCK_PROOF_SET_SCHEMA,
    platform,
    contentIdentitySha256: digest(contentId),
    sourceVersionId,
    sourceDurationMs,
    metadataPartCount,
    parts
  };
  return {
    ...withoutId,
    proofSetId: externalVodClockProofSetId(withoutId)
  };
}

function soopAcquisition({
  contentId = "99",
  sourceVersionId = METADATA_ID,
  sourceDurationMs = 12_000,
  metadataPartCount = 2,
  parts = [persistedPart({
    platform: "SOOP",
    partIndex: 1,
    partId: "part-b",
    sourceStartMs: 5_000,
    sourceEndMs: 12_000
  })]
}: {
  contentId?: string;
  sourceVersionId?: string;
  sourceDurationMs?: number;
  metadataPartCount?: number;
  parts?: readonly ExternalVodPersistedPartClockProof[];
} = {}): ExternalVodPersistedClockProofSet {
  return proofSet({
    platform: "SOOP",
    contentId,
    sourceVersionId,
    sourceDurationMs,
    metadataPartCount,
    parts
  });
}

function createSoopSourceClock() {
  return createExternalVodSourceClockProof({
    platform: "SOOP",
    contentId: "99",
    metadataIdentityId: METADATA_ID,
    metadataParts: [
      {
        partIndex: 0,
        playlistItem: 1,
        partId: "part-a",
        sourceStartMs: 0,
        sourceEndMs: 5_000,
        durationMs: 5_000
      },
      {
        partIndex: 1,
        playlistItem: 2,
        partId: "part-b",
        sourceStartMs: 5_000,
        sourceEndMs: 12_000,
        durationMs: 7_000
      }
    ],
    soopSourceClockIdentity: {
      schema: "kirinuki-soop-vod-source-clock/v1",
      platform: "SOOP",
      contentId: "99",
      totalDurationSeconds: 12,
      parts: [
        { id: "part-a", index: 0, order: 1, durationSeconds: 5 },
        { id: "part-b", index: 1, order: 2, durationSeconds: 7 }
      ]
    }
  });
}

function assertSourceClockMismatch(error: unknown): boolean {
  assert.ok(error instanceof ExternalVodSourceClockProofError);
  assert.equal(error.code, "SOURCE_CLOCK_MISMATCH");
  return true;
}

function acquisition(
  platform: "CHZZK" | "YOUTUBE",
  resolvedDurationUs: number
): ExternalVodPersistedClockProofSet {
  const partId = platform === "CHZZK" ? "123" : "abcdefghijk";
  const authoritativeDurationMs = Math.floor(resolvedDurationUs / 1_000);
  const contentIdentitySha256 = createHash("sha256")
    .update(partId)
    .digest("hex");
  const partWithoutId: Omit<ExternalVodPersistedPartClockProof, "partProofId"> = {
    schemaId: EXTERNAL_VOD_PART_CLOCK_PROOF_SCHEMA,
    partIndex: 0,
    playlistItem: null,
    partIdentitySha256: contentIdentitySha256,
    sourceStartMs: 0,
    sourceEndMs: authoritativeDurationMs,
    metadataDurationMs: platform === "CHZZK" ? 31_556_000 : 1_344_000,
    resolvedDurationUs,
    transport: platform === "YOUTUBE" ? "DIRECT" : "HLS",
    formatIdentitySha256: "c".repeat(64),
    clockProofId: "d".repeat(64),
    playlistFingerprintSha256: platform === "CHZZK" ? "e".repeat(64) : null,
    renditionFingerprintSha256: platform === "CHZZK" ? "f".repeat(64) : null
  };
  const part = {
    ...partWithoutId,
    partProofId: "placeholder"
  } as ExternalVodPersistedPartClockProof;
  // Resolver IDs are JSON-order-sensitive by construction. Obtain a real
  // normalized fixture through its public formula using the production field
  // order copied above.
  part.partProofId = createHash("sha256")
    .update(JSON.stringify(partWithoutId))
    .digest("hex");
  const withoutId: Omit<ExternalVodPersistedClockProofSet, "proofSetId"> = {
    schemaId: EXTERNAL_VOD_CLOCK_PROOF_SET_SCHEMA,
    platform,
    contentIdentitySha256,
    sourceVersionId: METADATA_ID,
    sourceDurationMs: authoritativeDurationMs,
    metadataPartCount: 1,
    parts: [part]
  };
  return {
    ...withoutId,
    proofSetId: externalVodClockProofSetId(withoutId)
  };
}

test("CHZZK HLS player duration overrides rounded extractor duration", () => {
  const result = createExternalVodSourceClockProof({
    platform: "CHZZK",
    contentId: "123",
    metadataIdentityId: METADATA_ID,
    metadataParts: [{
      partIndex: 0,
      partId: "123",
      sourceStartMs: 0,
      sourceEndMs: 31_556_000,
      durationMs: 31_556_000
    }],
    acquisitionClockProofSet: acquisition("CHZZK", 31_571_100_554)
  });
  assert.equal(result.sourceDurationMs, 31_571_100);
  assert.equal(result.authoritativeParts[0]?.sourceEndMs, 31_571_100);
  assert.match(result.sourceVersionId, /^[a-f0-9]{64}$/u);
  assert.deepEqual(parseExternalVodSourceClockProof(
    JSON.parse(JSON.stringify(result.proof)) as unknown
  ), result.proof);
});

test("YouTube source clock clamps planning to the shortest proven direct input", () => {
  const result = createExternalVodSourceClockProof({
    platform: "YOUTUBE",
    contentId: "abcdefghijk",
    metadataIdentityId: METADATA_ID,
    metadataParts: [{
      partIndex: 0,
      partId: "abcdefghijk",
      sourceStartMs: 0,
      sourceEndMs: 1_344_000,
      durationMs: 1_344_000
    }],
    acquisitionClockProofSet: acquisition("YOUTUBE", 1_343_600_000)
  });
  assert.equal(result.sourceDurationMs, 1_343_600);
});

test("whole-clock binding accepts CHZZK and YouTube rounded metadata semantics", () => {
  const fixtures = [
    {
      platform: "CHZZK" as const,
      contentId: "123",
      metadataDurationMs: 31_556_000,
      resolvedDurationUs: 31_571_100_554
    },
    {
      platform: "YOUTUBE" as const,
      contentId: "abcdefghijk",
      metadataDurationMs: 1_344_000,
      resolvedDurationUs: 1_343_600_000
    }
  ];
  for (const fixture of fixtures) {
    const acquisitionProof = acquisition(
      fixture.platform,
      fixture.resolvedDurationUs
    );
    const source = createExternalVodSourceClockProof({
      platform: fixture.platform,
      contentId: fixture.contentId,
      metadataIdentityId: METADATA_ID,
      metadataParts: [{
        partIndex: 0,
        partId: fixture.contentId,
        sourceStartMs: 0,
        sourceEndMs: fixture.metadataDurationMs,
        durationMs: fixture.metadataDurationMs
      }],
      acquisitionClockProofSet: acquisitionProof
    });
    assert.deepEqual(
      assertExternalVodSourceClockProofMatchesAcquisitionClockProofSet(
        source.proof,
        acquisitionProof
      ),
      acquisitionProof
    );
  }
});

test("whole-clock binding accepts a valid sparse SOOP acquisition subset", () => {
  const source = createSoopSourceClock();
  const sparseAcquisition = soopAcquisition();
  assert.deepEqual(
    assertExternalVodSourceClockProofMatchesAcquisitionClockProofSet(
      source.proof,
      sparseAcquisition
    ),
    sparseAcquisition
  );
});

test("whole-clock binding rejects independently valid mismatched roots", () => {
  const source = createSoopSourceClock();
  const singleSoopPart = persistedPart({
    platform: "SOOP",
    partIndex: 0,
    partId: "123",
    sourceStartMs: 0,
    sourceEndMs: 6_000
  });
  const wrongPlatform = proofSet({
    platform: "SOOP",
    contentId: "123",
    sourceDurationMs: 6_000,
    metadataPartCount: 1,
    parts: [singleSoopPart]
  });
  const chzzkProof = acquisition("CHZZK", 6_000_000);
  const chzzkSource = createExternalVodSourceClockProof({
    platform: "CHZZK",
    contentId: "123",
    metadataIdentityId: METADATA_ID,
    metadataParts: [{
      partIndex: 0,
      partId: "123",
      sourceStartMs: 0,
      sourceEndMs: 31_556_000,
      durationMs: 31_556_000
    }],
    acquisitionClockProofSet: chzzkProof
  });
  const mismatches = [
    [chzzkSource.proof, wrongPlatform],
    [source.proof, soopAcquisition({ contentId: "different-content" })],
    [source.proof, soopAcquisition({ sourceVersionId: "2".repeat(64) })],
    [source.proof, soopAcquisition({ sourceDurationMs: 13_000 })],
    [source.proof, soopAcquisition({ metadataPartCount: 3 })],
    [source.proof, soopAcquisition({
      parts: [persistedPart({
        platform: "SOOP",
        partIndex: 1,
        partId: "different-part",
        sourceStartMs: 5_000,
        sourceEndMs: 12_000
      })]
    })],
    [source.proof, soopAcquisition({
      parts: [persistedPart({
        platform: "SOOP",
        partIndex: 1,
        partId: "part-b",
        sourceStartMs: 4_000,
        sourceEndMs: 11_000
      })]
    })]
  ] as const;
  for (const [sourceProof, acquisitionProof] of mismatches) {
    assert.throws(
      () => assertExternalVodSourceClockProofMatchesAcquisitionClockProofSet(
        sourceProof,
        acquisitionProof
      ),
      assertSourceClockMismatch
    );
  }
});

test("SOOP official root·entries identity must exactly match selected part IDs and seconds", () => {
  const input = {
    platform: "SOOP" as const,
    contentId: "99",
    metadataIdentityId: METADATA_ID,
    metadataParts: [
      { partIndex: 0, playlistItem: 1, partId: "part-a", sourceStartMs: 0, sourceEndMs: 5_000, durationMs: 5_000 },
      { partIndex: 1, playlistItem: 2, partId: "part-b", sourceStartMs: 5_000, sourceEndMs: 12_000, durationMs: 7_000 }
    ],
    soopSourceClockIdentity: {
      schema: "kirinuki-soop-vod-source-clock/v1",
      platform: "SOOP",
      contentId: "99",
      totalDurationSeconds: 12,
      parts: [
        { id: "part-a", index: 0, order: 1, durationSeconds: 5 },
        { id: "part-b", index: 1, order: 2, durationSeconds: 7 }
      ]
    }
  };
  const result = createExternalVodSourceClockProof(input);
  assert.equal(result.sourceDurationMs, 12_000);
  assert.ok(result.proof.browserClockIdentitySha256);
  assert.doesNotThrow(() => assertExternalVodSourceClockProofUnchanged(result.proof, result.proof));
  assert.throws(() => createExternalVodSourceClockProof({
    ...input,
    soopSourceClockIdentity: {
      ...input.soopSourceClockIdentity,
      parts: [
        { id: "part-b", index: 0, order: 1, durationSeconds: 5 },
        { id: "part-a", index: 1, order: 2, durationSeconds: 7 }
      ]
    }
  }));
});

test("source clock receipt rejects unknown keys and body/ID tampering", () => {
  const result = createExternalVodSourceClockProof({
    platform: "YOUTUBE",
    contentId: "abcdefghijk",
    metadataIdentityId: METADATA_ID,
    metadataParts: [{
      partIndex: 0,
      partId: "abcdefghijk",
      sourceStartMs: 0,
      sourceEndMs: 1_344_000,
      durationMs: 1_344_000
    }],
    acquisitionClockProofSet: acquisition("YOUTUBE", 1_343_600_000)
  });
  assert.throws(() => parseExternalVodSourceClockProof({
    ...result.proof,
    rawUrl: "https://example.invalid/?sig=secret"
  }));
  assert.throws(() => parseExternalVodSourceClockProof({
    ...result.proof,
    sourceDurationMs: result.proof.sourceDurationMs - 1
  }));
});
