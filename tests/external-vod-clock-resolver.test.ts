import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  EXTERNAL_VOD_CLOCK_PROOF_SET_SCHEMA,
  ExternalVodClockResolverError,
  assertExternalVodDirectAcquisitionMatchesPartProof,
  assertExternalVodHlsAcquisitionMatchesPartProof,
  assertExternalVodClockProofSetUnchanged,
  externalVodClockProofSetId,
  parseExternalVodPersistedClockProofSet,
  resolveExternalVodClockProofSet,
  resolveExternalVodSelectedSourceDump
} from "../scripts/external-vod-clock-resolver.js";
import {
  EXTERNAL_VOD_DIRECT_ENCODING_PROFILE_SHA256,
  EXTERNAL_VOD_DIRECT_SECTION_EVIDENCE_SCHEMA,
  externalVodDirectClockProofId,
  externalVodDirectSectionEvidenceId
} from "../scripts/external-vod-direct-acquirer.js";
import type {
  ExternalVodDirectSectionEvidence
} from "../scripts/external-vod-direct-acquirer.js";
import type {
  ExternalVodClockMetadataPart,
  ExternalVodDirectSelectedSource,
  ExternalVodHlsSelectedSource,
  ExternalVodPersistedClockProofSet,
  ExternalVodPersistedPartClockProof,
  ResolveExternalVodClockProofSetRequest
} from "../scripts/external-vod-clock-resolver.js";
import type { ExternalVodHlsTimeline } from "../scripts/external-vod-hls-acquirer.js";
import {
  EXTERNAL_VOD_HLS_SECTION_CLOCK_SCHEMA,
  compactExternalVodHlsSectionClockEvidence,
  externalVodHlsPlaylistFingerprintSha256,
  externalVodHlsSectionClockEvidenceId
} from "../scripts/external-vod-hls-acquirer.js";
import type {
  ExternalVodHlsSectionClockEvidence
} from "../scripts/external-vod-hls-acquirer.js";
import { secretFreeExternalVodUrlIdentity } from "../scripts/external-vod-transfer.js";

const digest = (value: string): string => (
  createHash("sha256").update(value).digest("hex")
);

function withRecomputedProofIds(
  value: ExternalVodPersistedClockProofSet,
  mutatePart: (part: ExternalVodPersistedPartClockProof) => ExternalVodPersistedPartClockProof
): ExternalVodPersistedClockProofSet {
  const parts = value.parts.map((originalPart) => {
    const changed = mutatePart({ ...originalPart });
    const withoutId: Omit<ExternalVodPersistedPartClockProof, "partProofId"> = {
      schemaId: changed.schemaId,
      partIndex: changed.partIndex,
      playlistItem: changed.playlistItem,
      partIdentitySha256: changed.partIdentitySha256,
      sourceStartMs: changed.sourceStartMs,
      sourceEndMs: changed.sourceEndMs,
      metadataDurationMs: changed.metadataDurationMs,
      resolvedDurationUs: changed.resolvedDurationUs,
      transport: changed.transport,
      formatIdentitySha256: changed.formatIdentitySha256,
      clockProofId: changed.clockProofId,
      playlistFingerprintSha256: changed.playlistFingerprintSha256,
      renditionFingerprintSha256: changed.renditionFingerprintSha256
    };
    return {
      ...withoutId,
      partProofId: digest(JSON.stringify(withoutId))
    };
  });
  const withoutId: Omit<ExternalVodPersistedClockProofSet, "proofSetId"> = {
    schemaId: value.schemaId,
    platform: value.platform,
    contentIdentitySha256: value.contentIdentitySha256,
    sourceVersionId: value.sourceVersionId,
    sourceDurationMs: value.sourceDurationMs,
    metadataPartCount: value.metadataPartCount,
    parts
  };
  return {
    ...withoutId,
    proofSetId: externalVodClockProofSetId(withoutId)
  };
}

function assertCode(error: unknown, code: string): boolean {
  assert.ok(error instanceof ExternalVodClockResolverError);
  assert.equal(error.code, code);
  return true;
}

function hlsTimeline(
  platform: "CHZZK" | "SOOP",
  token: string,
  prefix = "part-1",
  durationUs = 6_000_000
): ExternalVodHlsTimeline {
  const host = platform === "CHZZK"
    ? "vod.pstatic.net"
    : "vod.sooplive.com";
  const runtime = (name: string): string => (
    `https://${host}/hdntl=${token}/${prefix}/${name}?token=${token}`
  );
  const stable = (name: string): string => (
    secretFreeExternalVodUrlIdentity(runtime(name))
  );
  const firstDurationUs = Math.floor(durationUs / 2);
  const withoutFingerprint: Omit<
    ExternalVodHlsTimeline,
    "playlistFingerprintSha256"
  > = {
    playlistUri: runtime("index.m3u8"),
    playlistSemanticUri: stable("index.m3u8"),
    renditionFingerprintSha256: digest(`${platform}:${prefix}:1080p`),
    durationUs,
    hasEndList: true,
    hasIndependentSegments: true,
    map: {
      uri: runtime("init.mp4"),
      semanticUri: stable("init.mp4")
    },
    segments: [
      {
        sequence: 10,
        startUs: 0,
        durationUs: firstDurationUs,
        uri: runtime("segment-10.m4s"),
        semanticUri: stable("segment-10.m4s")
      },
      {
        sequence: 11,
        startUs: firstDurationUs,
        durationUs: durationUs - firstDurationUs,
        uri: runtime("segment-11.m4s"),
        semanticUri: stable("segment-11.m4s")
      }
    ]
  };
  return {
    ...withoutFingerprint,
    playlistFingerprintSha256: externalVodHlsPlaylistFingerprintSha256(
      withoutFingerprint
    )
  };
}

function withRecomputedHlsFingerprint(
  timeline: ExternalVodHlsTimeline
): ExternalVodHlsTimeline {
  const withoutFingerprint: Omit<
    ExternalVodHlsTimeline,
    "playlistFingerprintSha256"
  > = {
    playlistUri: timeline.playlistUri,
    ...(timeline.playlistSemanticUri === undefined
      ? {}
      : { playlistSemanticUri: timeline.playlistSemanticUri }),
    renditionFingerprintSha256: timeline.renditionFingerprintSha256,
    durationUs: timeline.durationUs,
    hasEndList: true,
    hasIndependentSegments: true,
    map: { ...timeline.map },
    segments: timeline.segments.map((segment) => ({ ...segment }))
  };
  return {
    ...withoutFingerprint,
    playlistFingerprintSha256: externalVodHlsPlaylistFingerprintSha256(
      withoutFingerprint
    )
  };
}

function reroutedHlsTimeline(
  timeline: ExternalVodHlsTimeline,
  host: string,
  route: string
): ExternalVodHlsTimeline {
  const runtime = (name: string): string => (
    `https://${host}/${route}/${name}?policy=rotated-route`
  );
  const semantic = (name: string): string => (
    secretFreeExternalVodUrlIdentity(runtime(name))
  );
  return withRecomputedHlsFingerprint({
    ...timeline,
    playlistUri: runtime("media.m3u8"),
    playlistSemanticUri: semantic("media.m3u8"),
    map: {
      uri: runtime("bootstrap.mp4"),
      semanticUri: semantic("bootstrap.mp4")
    },
    segments: timeline.segments.map((segment) => ({
      ...segment,
      uri: runtime(`chunk-${segment.sequence}.m4s`),
      semanticUri: semantic(`chunk-${segment.sequence}.m4s`)
    }))
  });
}

function withHlsContentEvidence(
  timeline: ExternalVodHlsTimeline,
  generation: string
): ExternalVodHlsTimeline {
  return withRecomputedHlsFingerprint({
    ...timeline,
    segments: timeline.segments.map((segment) => ({
      ...segment,
      expectedSha256: digest(`${generation}:${segment.sequence}`)
    }))
  });
}

const singlePart: ExternalVodClockMetadataPart = {
  partIndex: 0,
  partId: "content-part-1",
  sourceStartMs: 0,
  sourceEndMs: 6_000,
  durationMs: 6_000
};

function chzzkRequest(): ResolveExternalVodClockProofSetRequest {
  return {
    platform: "CHZZK",
    contentId: "123456789",
    sourceVersionId: digest("chzzk-source-version"),
    sourceDurationMs: 6_000,
    metadataPartCount: 1,
    parts: [singlePart]
  };
}

function chzzkSelected(token: string, formatIdentity = "chzzk:hls:1080p"):
ExternalVodHlsSelectedSource {
  return {
    kind: "hls",
    platform: "CHZZK",
    contentId: "123456789",
    partId: singlePart.partId,
    formatIdentity,
    timeline: hlsTimeline("CHZZK", token)
  };
}

function youtubeSelected(token: string): ExternalVodDirectSelectedSource {
  const videoIdentity = "youtube:format:136:video";
  const audioIdentity = "youtube:format:140:audio";
  const clockProofWithoutId: Omit<
    ExternalVodDirectSelectedSource["clockProof"],
    "proofId"
  > = {
    playerDurationUs: 6_000_000,
    zeroOrigin: true,
    video: {
      semanticIdentitySha256: digest(videoIdentity),
      startUs: 0,
      durationUs: 6_000_000
    },
    audio: {
      semanticIdentitySha256: digest(audioIdentity),
      startUs: 0,
      durationUs: 6_000_000
    }
  };
  return {
    kind: "direct",
    platform: "YOUTUBE",
    contentId: "M7lc1UVf-VE",
    partId: "M7lc1UVf-VE",
    formatIdentity: "youtube:136+140",
    clockProof: {
      ...clockProofWithoutId,
      proofId: externalVodDirectClockProofId(clockProofWithoutId)
    },
    runtimeInputs: {
      video: {
        url: `https://rr1.googlevideo.com/hdntl=${token}/videoplayback?sig=${token}`,
        semanticIdentity: videoIdentity,
        publicHeaders: {
          "User-Agent": "Mozilla/5.0",
          Referer: "https://www.youtube.com/",
          Cookie: "must-never-survive"
        }
      },
      audio: {
        url: `https://rr1.googlevideo.com/hdntl=${token}/audioplayback?sig=${token}`,
        semanticIdentity: audioIdentity,
        publicHeaders: { "User-Agent": "Mozilla/5.0" }
      }
    }
  };
}

function youtubeRequest(): ResolveExternalVodClockProofSetRequest {
  return {
    platform: "YOUTUBE",
    contentId: "M7lc1UVf-VE",
    sourceVersionId: digest("youtube-source-version"),
    sourceDurationMs: 6_000,
    metadataPartCount: 1,
    parts: [{ ...singlePart, partId: "M7lc1UVf-VE" }]
  };
}

test("CHZZK HLS proof is URL-free and stable across signed URL rotation", async () => {
  const resolve = async (token: string) => await resolveExternalVodClockProofSet(
    chzzkRequest(),
    { async resolveSelectedPart() { return chzzkSelected(token); } }
  );
  const first = await resolve("first-secret-hmac");
  const second = await resolve("second-secret-hmac");
  assert.equal(first.persisted.schemaId, EXTERNAL_VOD_CLOCK_PROOF_SET_SCHEMA);
  assert.equal(first.persisted.proofSetId, second.persisted.proofSetId);
  assert.equal(first.persisted.parts[0]?.transport, "HLS");
  assert.deepEqual(
    parseExternalVodPersistedClockProofSet(
      JSON.parse(JSON.stringify(first.persisted)) as unknown
    ),
    first.persisted
  );
  const persisted = JSON.stringify(first.persisted);
  assert.doesNotMatch(persisted, /pstatic|hdntl|first-secret|content-part/u);
  const runtime = first.runtime.parts[0];
  assert.equal(runtime?.kind, "hls");
  if (runtime?.kind === "hls") {
    assert.match(runtime.timeline.playlistUri, /first-secret-hmac/u);
  }
});

test("YouTube direct proof filters runtime headers and remains stable across tokens", async () => {
  const resolve = async (token: string) => await resolveExternalVodClockProofSet(
    youtubeRequest(),
    { async resolveSelectedPart() { return youtubeSelected(token); } }
  );
  const first = await resolve("first-token");
  const second = await resolve("second-token");
  assert.equal(first.persisted.proofSetId, second.persisted.proofSetId);
  assert.equal(first.persisted.parts[0]?.transport, "DIRECT");
  assert.doesNotMatch(JSON.stringify(first.persisted), /googlevideo|token|Mozilla|Cookie/u);
  const runtime = first.runtime.parts[0];
  assert.equal(runtime?.kind, "direct");
  if (runtime?.kind === "direct") {
    assert.deepEqual(runtime.runtimeInputs.video.publicHeaders, {
      referer: "https://www.youtube.com/",
      "user-agent": "Mozilla/5.0"
    });
    assert.match(runtime.runtimeInputs.video.url, /first-token/u);
  }
});

test("resolver rejects shape-valid forged direct and HLS clock IDs", async () => {
  await assert.rejects(
    resolveExternalVodClockProofSet(youtubeRequest(), {
      async resolveSelectedPart() {
        const selected = youtubeSelected("token");
        return {
          ...selected,
          clockProof: { ...selected.clockProof, proofId: "0".repeat(64) }
        };
      }
    }),
    (error) => assertCode(error, "INVALID_SELECTED_SOURCE")
  );

  await assert.rejects(
    resolveExternalVodClockProofSet(chzzkRequest(), {
      async resolveSelectedPart() {
        const selected = chzzkSelected("token");
        return {
          ...selected,
          timeline: {
            ...selected.timeline,
            playlistFingerprintSha256: "0".repeat(64)
          }
        };
      }
    }),
    (error) => assertCode(error, "INVALID_SELECTED_SOURCE")
  );
});

test("SOOP acquisition parts are identity-checked and emitted in part order", async () => {
  const parts: ExternalVodClockMetadataPart[] = [
    {
      partIndex: 1,
      playlistItem: 2,
      partId: "soop-part-2",
      sourceStartMs: 6_000,
      sourceEndMs: 12_000,
      durationMs: 6_000
    },
    {
      partIndex: 0,
      playlistItem: 1,
      partId: "soop-part-1",
      sourceStartMs: 0,
      sourceEndMs: 6_000,
      durationMs: 6_000
    }
  ];
  const seen: number[] = [];
  const result = await resolveExternalVodClockProofSet({
    platform: "SOOP",
    contentId: "204255303",
    sourceVersionId: digest("soop-source-version"),
    sourceDurationMs: 12_000,
    metadataPartCount: 2,
    parts
  }, {
    async resolveSelectedPart(part) {
      seen.push(part.partIndex);
      return {
        kind: "hls",
        platform: "SOOP",
        contentId: "204255303",
        partId: part.partId,
        formatIdentity: `soop:hls:part-${part.partIndex + 1}`,
        timeline: hlsTimeline("SOOP", "runtime-token", `part-${part.partIndex + 1}`)
      };
    }
  });
  assert.deepEqual(seen, [0, 1]);
  assert.deepEqual(result.persisted.parts.map(({ partIndex }) => partIndex), [0, 1]);
  assert.deepEqual(result.persisted.parts.map(({ playlistItem }) => playlistItem), [1, 2]);
});

test("proof-set parser allows bounded sparse SOOP parts", async () => {
  const result = await resolveExternalVodClockProofSet({
    platform: "SOOP",
    contentId: "204255303",
    sourceVersionId: digest("soop-sparse-source-version"),
    sourceDurationMs: 24_000,
    metadataPartCount: 4,
    parts: [
      {
        partIndex: 1,
        playlistItem: 2,
        partId: "soop-part-2",
        sourceStartMs: 5_000,
        sourceEndMs: 11_000,
        durationMs: 6_000
      },
      {
        partIndex: 3,
        playlistItem: 4,
        partId: "soop-part-4",
        sourceStartMs: 18_000,
        sourceEndMs: 24_000,
        durationMs: 6_000
      }
    ]
  }, {
    async resolveSelectedPart(part) {
      return {
        kind: "hls",
        platform: "SOOP",
        contentId: "204255303",
        partId: part.partId,
        formatIdentity: `soop:hls:part-${part.partIndex + 1}`,
        timeline: hlsTimeline(
          "SOOP",
          "runtime-token",
          `part-${part.partIndex + 1}`
        )
      };
    }
  });
  assert.deepEqual(
    parseExternalVodPersistedClockProofSet(result.persisted).parts.map(
      ({ partIndex }) => partIndex
    ),
    [1, 3]
  );
});

test("proof-set parser rejects valid-ID parts outside metadataPartCount", async () => {
  const result = await resolveExternalVodClockProofSet({
    platform: "SOOP",
    contentId: "204255303",
    sourceVersionId: digest("soop-bounds-source-version"),
    sourceDurationMs: 12_000,
    metadataPartCount: 2,
    parts: [{
      partIndex: 1,
      playlistItem: 2,
      partId: "soop-part-2",
      sourceStartMs: 6_000,
      sourceEndMs: 12_000,
      durationMs: 6_000
    }]
  }, {
    async resolveSelectedPart(part) {
      return {
        kind: "hls",
        platform: "SOOP",
        contentId: "204255303",
        partId: part.partId,
        formatIdentity: "soop:hls:part-2",
        timeline: hlsTimeline("SOOP", "runtime-token", "part-2")
      };
    }
  });
  const forged = withRecomputedProofIds(result.persisted, (part) => ({
    ...part,
    partIndex: 2,
    playlistItem: 3
  }));
  assert.throws(
    () => parseExternalVodPersistedClockProofSet(forged),
    (error) => assertCode(error, "INVALID_CLOCK_PROOF_SET")
  );
});

test("single-part platform proof parser requires part index zero", async () => {
  const chzzk = await resolveExternalVodClockProofSet(chzzkRequest(), {
    async resolveSelectedPart() { return chzzkSelected("token"); }
  });
  const youtube = await resolveExternalVodClockProofSet(youtubeRequest(), {
    async resolveSelectedPart() { return youtubeSelected("token"); }
  });
  for (const proofSet of [chzzk.persisted, youtube.persisted]) {
    const forged = withRecomputedProofIds(proofSet, (part) => ({
      ...part,
      partIndex: 1
    }));
    assert.throws(
      () => parseExternalVodPersistedClockProofSet(forged),
      (error) => assertCode(error, "INVALID_CLOCK_PROOF_SET")
    );
  }
});

test("platform, content, part, and duration mismatches fail closed", async () => {
  await assert.rejects(
    resolveExternalVodClockProofSet(chzzkRequest(), {
      async resolveSelectedPart() {
        return { ...chzzkSelected("token"), contentId: "different" };
      }
    }),
    (error) => assertCode(error, "SOURCE_CHANGED")
  );
  await assert.rejects(
    resolveExternalVodClockProofSet(youtubeRequest(), {
      async resolveSelectedPart() {
        const selected = youtubeSelected("token");
        const changedClockWithoutId: Omit<
          ExternalVodDirectSelectedSource["clockProof"],
          "proofId"
        > = {
          playerDurationUs: 4_000_000,
          zeroOrigin: true,
          video: { ...selected.clockProof.video, durationUs: 4_000_000 },
          audio: { ...selected.clockProof.audio!, durationUs: 4_000_000 }
        };
        return {
          ...selected,
          clockProof: {
            ...changedClockWithoutId,
            proofId: externalVodDirectClockProofId(changedClockWithoutId)
          }
        };
      }
    }),
    (error) => assertCode(error, "SELECTED_SOURCE_DURATION_MISMATCH")
  );
  await assert.rejects(
    resolveExternalVodClockProofSet(chzzkRequest(), {
      async resolveSelectedPart() {
        return youtubeSelected("token") as unknown as ExternalVodHlsSelectedSource;
      }
    }),
    (error) => assertCode(error, "SOURCE_CHANGED")
  );
});

test("CHZZK HLS duration becomes the safe whole-millisecond planning authority", async () => {
  const result = await resolveExternalVodClockProofSet({
    ...chzzkRequest(),
    partDurationToleranceMs: 20_000
  }, {
    async resolveSelectedPart() {
      return {
        ...chzzkSelected("token"),
        timeline: hlsTimeline("CHZZK", "token", "part-1", 21_000_000)
      };
    }
  });
  assert.equal(result.persisted.parts[0]?.metadataDurationMs, 6_000);
  assert.equal(result.persisted.parts[0]?.resolvedDurationUs, 21_000_000);
  assert.equal(result.persisted.sourceDurationMs, 21_000);
  assert.equal(result.authoritative.sourceDurationMs, 21_000);
  assert.equal(result.authoritative.parts[0]?.sourceEndMs, 21_000);
  assert.notEqual(
    result.persisted.parts[0]?.metadataDurationMs * 1_000,
    result.persisted.parts[0]?.resolvedDurationUs
  );
});

test("CHZZK completion accepts CDN route rotation but rejects clock, format and content changes", async () => {
  const initialTimeline = withHlsContentEvidence(
    hlsTimeline("CHZZK", "first-token"),
    "stable-content"
  );
  const rotatedTimeline = reroutedHlsTimeline(
    initialTimeline,
    "vod-edge.pstatic.net",
    "different-cdn-route/v2"
  );
  const resolve = async (
    timeline: ExternalVodHlsTimeline,
    formatIdentity = "chzzk:hls:1080p"
  ) => await resolveExternalVodClockProofSet(chzzkRequest(), {
    async resolveSelectedPart() {
      return {
        ...chzzkSelected("unused", formatIdentity),
        timeline
      };
    }
  });
  const first = await resolve(initialTimeline);
  const rotated = await resolve(rotatedTimeline);
  assert.notEqual(
    first.persisted.parts[0]?.playlistFingerprintSha256,
    rotated.persisted.parts[0]?.playlistFingerprintSha256
  );
  assert.notEqual(first.persisted.proofSetId, rotated.persisted.proofSetId);
  assert.throws(
    () => assertExternalVodClockProofSetUnchanged(
      first.persisted,
      rotated.persisted
    ),
    (error) => assertCode(error, "SOURCE_CHANGED")
  );
  assert.deepEqual(
    assertExternalVodClockProofSetUnchanged(
      first.persisted,
      rotated.persisted,
      {
        expectedRuntimeParts: first.runtime.parts,
        actualRuntimeParts: rotated.runtime.parts
      }
    ),
    rotated.persisted
  );

  const changedDuration = await resolve(withHlsContentEvidence(
    hlsTimeline("CHZZK", "duration-token", "part-1", 7_000_000),
    "stable-content"
  ));
  const changedSequence = await resolve(withRecomputedHlsFingerprint({
    ...rotatedTimeline,
    segments: rotatedTimeline.segments.map((segment) => ({
      ...segment,
      sequence: segment.sequence + 100
    }))
  }));
  const changedFormat = await resolve(rotatedTimeline, "chzzk:hls:720p");
  const changedRendition = await resolve({
    ...rotatedTimeline,
    renditionFingerprintSha256: digest("different-rendition")
  });
  const changedContent = await resolve(withHlsContentEvidence(
    rotatedTimeline,
    "different-content"
  ));
  const changedMetadataVersion = await resolveExternalVodClockProofSet({
    ...chzzkRequest(),
    sourceVersionId: digest("changed-raw-metadata-version")
  }, {
    async resolveSelectedPart() {
      return { ...chzzkSelected("unused"), timeline: rotatedTimeline };
    }
  });
  const changedPartRequest = {
    ...chzzkRequest(),
    parts: [{ ...singlePart, partId: "replacement-content-part" }]
  };
  const changedPart = await resolveExternalVodClockProofSet(
    changedPartRequest,
    {
      async resolveSelectedPart(part) {
        return {
          ...chzzkSelected("unused"),
          partId: part.partId,
          timeline: rotatedTimeline
        };
      }
    }
  );
  for (const candidate of [
    changedDuration,
    changedSequence,
    changedFormat,
    changedRendition,
    changedContent,
    changedMetadataVersion,
    changedPart
  ]) {
    assert.throws(
      () => assertExternalVodClockProofSetUnchanged(
        first.persisted,
        candidate.persisted,
        {
          expectedRuntimeParts: first.runtime.parts,
          actualRuntimeParts: candidate.runtime.parts
        }
      ),
      (error) => assertCode(error, "SOURCE_CHANGED")
    );
  }
});

test("completion CDN-route exception remains CHZZK-only", async () => {
  const soopRequest: ResolveExternalVodClockProofSetRequest = {
    platform: "SOOP",
    contentId: "204255303",
    sourceVersionId: digest("soop-completion-source-version"),
    sourceDurationMs: 6_000,
    metadataPartCount: 1,
    parts: [{
      ...singlePart,
      playlistItem: 1,
      partId: "soop-completion-part"
    }]
  };
  const resolveSoop = async (timeline: ExternalVodHlsTimeline) => (
    await resolveExternalVodClockProofSet(soopRequest, {
      async resolveSelectedPart(part) {
        return {
          kind: "hls" as const,
          platform: "SOOP" as const,
          contentId: soopRequest.contentId,
          partId: part.partId,
          formatIdentity: "soop:hls:1080p",
          timeline
        };
      }
    })
  );
  const firstSoop = await resolveSoop(hlsTimeline(
    "SOOP",
    "first-token",
    "completion-part"
  ));
  const firstSoopRuntime = firstSoop.runtime.parts[0];
  assert.equal(firstSoopRuntime?.kind, "hls");
  if (firstSoopRuntime?.kind !== "hls") {
    assert.fail("SOOP completion test requires an HLS runtime");
  }
  const reroutedSoop = await resolveSoop(reroutedHlsTimeline(
    firstSoopRuntime.timeline,
    "vod-edge.sooplive.com",
    "different-cdn-route/v2"
  ));
  assert.throws(
    () => assertExternalVodClockProofSetUnchanged(
      firstSoop.persisted,
      reroutedSoop.persisted,
      {
        expectedRuntimeParts: firstSoop.runtime.parts,
        actualRuntimeParts: reroutedSoop.runtime.parts
      }
    ),
    (error) => assertCode(error, "SOURCE_CHANGED")
  );

  const firstYoutube = await resolveExternalVodClockProofSet(youtubeRequest(), {
    async resolveSelectedPart() { return youtubeSelected("first-token"); }
  });
  const changedYoutube = await resolveExternalVodClockProofSet(youtubeRequest(), {
    async resolveSelectedPart() {
      return {
        ...youtubeSelected("second-token"),
        formatIdentity: "youtube:different-format"
      };
    }
  });
  assert.throws(
    () => assertExternalVodClockProofSetUnchanged(
      firstYoutube.persisted,
      changedYoutube.persisted
    ),
    (error) => assertCode(error, "SOURCE_CHANGED")
  );
});

test("HLS acquisition binding rejects swapped rendition and exact proof IDs", async () => {
  const resolved = await resolveExternalVodClockProofSet(chzzkRequest(), {
    async resolveSelectedPart() { return chzzkSelected("token"); }
  });
  const timeline = hlsTimeline("CHZZK", "token");
  const richEvidence = (
    renditionFingerprintSha256: string
  ): ExternalVodHlsSectionClockEvidence => {
    const withoutId: Omit<ExternalVodHlsSectionClockEvidence, "evidenceId"> = {
      schemaId: EXTERNAL_VOD_HLS_SECTION_CLOCK_SCHEMA,
      sectionId: "root-section",
      playlistFingerprintSha256: timeline.playlistFingerprintSha256,
      renditionFingerprintSha256,
      resourceSetFingerprintSha256: digest("resource-set"),
      sourceStartUs: 0,
      sourceEndUs: 1_000_000,
      firstSegmentPlayerStartUs: 0,
      firstSegmentOffsetUs: 0,
      mapping: {
        sourceAnchorUs: 0,
        outputAnchorUs: 0,
        rateNumerator: 1,
        rateDenominator: 1
      },
      init: {
        semanticUriSha256: digest("init-uri"),
        contentSha256: digest("init-bytes"),
        sizeBytes: 16
      },
      segments: [{
        semanticUriSha256: digest("segment-uri"),
        contentSha256: digest("segment-bytes"),
        sizeBytes: 16,
        sequence: 10,
        playerStartUs: 0,
        durationUs: 3_000_000
      }],
      output: {
        durationMs: 1_000,
        sizeBytes: 16,
        contentSha256: digest("output")
      }
    };
    return {
      ...withoutId,
      evidenceId: externalVodHlsSectionClockEvidenceId(withoutId)
    };
  };
  const hlsPartProof = resolved.persisted.parts[0]!;
  const matching = compactExternalVodHlsSectionClockEvidence(
    richEvidence(timeline.renditionFingerprintSha256),
    {
      partProofId: hlsPartProof.partProofId,
      clockProofId: hlsPartProof.clockProofId,
      precedingSegment: null
    }
  );
  assert.deepEqual(
    assertExternalVodHlsAcquisitionMatchesPartProof(
      resolved.persisted.parts[0],
      matching
    ),
    matching
  );
  const swapped = compactExternalVodHlsSectionClockEvidence(
    richEvidence(digest("different-rendition")),
    {
      partProofId: hlsPartProof.partProofId,
      clockProofId: hlsPartProof.clockProofId,
      precedingSegment: null
    }
  );
  assert.throws(
    () => assertExternalVodHlsAcquisitionMatchesPartProof(
      resolved.persisted.parts[0],
      swapped
    ),
    (error) => assertCode(error, "SOURCE_CHANGED")
  );
  const foreignProof = compactExternalVodHlsSectionClockEvidence(
    richEvidence(timeline.renditionFingerprintSha256),
    {
      partProofId: digest("foreign-part-proof"),
      clockProofId: digest("foreign-clock-proof"),
      precedingSegment: null
    }
  );
  assert.throws(
    () => assertExternalVodHlsAcquisitionMatchesPartProof(
      hlsPartProof,
      foreignProof
    ),
    (error) => assertCode(error, "SOURCE_CHANGED")
  );
});

test("direct acquisition binding rejects a valid proof from another selected format", async () => {
  const resolved = await resolveExternalVodClockProofSet(youtubeRequest(), {
    async resolveSelectedPart() { return youtubeSelected("token"); }
  });
  const partProof = resolved.persisted.parts[0]!;
  const evidenceWithoutId: Omit<ExternalVodDirectSectionEvidence, "evidenceId"> = {
    schemaId: EXTERNAL_VOD_DIRECT_SECTION_EVIDENCE_SCHEMA,
    sectionId: "part-0-1000-2000",
    partProofId: partProof.partProofId,
    clockProofId: partProof.clockProofId,
    encodingProfileSha256: EXTERNAL_VOD_DIRECT_ENCODING_PROFILE_SHA256,
    sourceStartUs: 1_000_000,
    sourceEndUs: 2_000_000,
    hasSeparateAudio: true,
    mapping: {
      sourceAnchorUs: 1_000_000,
      outputAnchorUs: 0,
      rateNumerator: 1,
      rateDenominator: 1
    },
    output: {
      durationMs: 1_000,
      sizeBytes: 16,
      contentSha256: digest("direct-output")
    }
  };
  const evidence = {
    ...evidenceWithoutId,
    evidenceId: externalVodDirectSectionEvidenceId(evidenceWithoutId)
  };
  assert.deepEqual(
    assertExternalVodDirectAcquisitionMatchesPartProof(partProof, evidence),
    evidence
  );
  const otherPartProofId = digest("another-selected-format-part-proof");
  const swappedWithoutId = {
    ...evidenceWithoutId,
    partProofId: otherPartProofId
  };
  const swapped = {
    ...swappedWithoutId,
    evidenceId: externalVodDirectSectionEvidenceId(swappedWithoutId)
  };
  assert.throws(
    () => assertExternalVodDirectAcquisitionMatchesPartProof(partProof, swapped),
    (error) => assertCode(error, "SOURCE_CHANGED")
  );
});

test("production dump adapter fetches and parses the exact selected HLS rendition", async () => {
  const playlistUrl = "https://vod.pstatic.net/hdntl=runtime-secret/vod/index.m3u8";
  const rawSelectedSourceJson = JSON.stringify({
    extractor: "chzzk:video",
    id: "123456789",
    duration: "6.000",
    requested_downloads: [{
      id: "123456789",
      format_id: "hls-1080p",
      protocol: "m3u8_native",
      ext: "mp4",
      vcodec: "avc1.640028",
      acodec: "mp4a.40.2",
      width: 1920,
      height: 1080,
      fps: 60,
      url: playlistUrl,
      http_headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://chzzk.naver.com/"
      }
    }]
  });
  const playlist = [
    "#EXTM3U",
    "#EXT-X-TARGETDURATION:3",
    "#EXT-X-MEDIA-SEQUENCE:10",
    "#EXT-X-INDEPENDENT-SEGMENTS",
    "#EXT-X-MAP:URI=\"init.mp4\"",
    "#EXTINF:3.000,",
    "segment-10.m4s",
    "#EXTINF:3.000,",
    "segment-11.m4s",
    "#EXT-X-ENDLIST",
    ""
  ].join("\n");
  let playlistRequestHeaders: Headers | undefined;
  const selected = await resolveExternalVodSelectedSourceDump({
    platform: "CHZZK",
    contentId: "123456789",
    partId: "content-part-1",
    rawSelectedSourceJson
  }, {
    async fetchImpl(_input, init) {
      playlistRequestHeaders = new Headers(init?.headers);
      return new Response(playlist, {
        status: 200,
        headers: { "content-type": "application/vnd.apple.mpegurl" }
      });
    },
    async probeDirectInput() {
      throw new Error("not direct");
    }
  });
  assert.equal(selected.kind, "hls");
  if (selected.kind === "hls") {
    assert.equal(playlistRequestHeaders?.get("user-agent"), "Mozilla/5.0");
    assert.equal(playlistRequestHeaders?.get("referer"), "https://chzzk.naver.com/");
    assert.equal(selected.timeline.durationUs, 6_000_000);
    assert.equal(selected.timeline.segments.length, 2);
    assert.match(selected.formatIdentity, /^format:[a-f0-9]{64}$/u);
    assert.deepEqual(selected.requestHeaders, {
      referer: "https://chzzk.naver.com/",
      "user-agent": "Mozilla/5.0"
    });
    assert.doesNotMatch(JSON.stringify({
      formatIdentity: selected.formatIdentity,
      timeline: selected.timeline
    }), /Mozilla|Referer|chzzk\.naver\.com/u);
  }
});

test("proof-set parser rejects unknown fields and recomputed-body tampering", async () => {
  const result = await resolveExternalVodClockProofSet(chzzkRequest(), {
    async resolveSelectedPart() { return chzzkSelected("token"); }
  });
  assert.throws(
    () => parseExternalVodPersistedClockProofSet({
      ...result.persisted,
      runtimeUrl: "https://vod.pstatic.net/secret"
    }),
    (error) => assertCode(error, "INVALID_CLOCK_PROOF_SET")
  );
  const changed = JSON.parse(JSON.stringify(result.persisted)) as {
    sourceDurationMs: number;
  };
  changed.sourceDurationMs += 1;
  assert.throws(
    () => parseExternalVodPersistedClockProofSet(changed),
    (error) => assertCode(error, "INVALID_CLOCK_PROOF_SET")
  );
});
