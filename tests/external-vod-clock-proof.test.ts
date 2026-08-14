import assert from "node:assert/strict";
import test from "node:test";

import {
  ExternalVodClockProofError,
  assertExternalVodSectionClockEvidenceMatches,
  createExternalVodSectionClockEvidence,
  parseDirectMediaFfprobeClockProof,
  parseExternalVodSectionClockEvidence,
  parseVodHlsMediaPlaylist,
  parseYtDlpSelectedInputsDump,
  planVodHlsSection
} from "../scripts/external-vod-clock-proof.js";

const SHA = "a".repeat(64);

function hlsDump(token = "one"): string {
  return JSON.stringify({
    id: "123",
    extractor: "chzzk:video",
    duration: 10,
    format_id: "hls-8000",
    protocol: "m3u8_native",
    ext: "mp4",
    vcodec: "avc1.64002a",
    acodec: "mp4a.40.2",
    width: 1920,
    height: 1080,
    fps: 60,
    url: `https://vod.example.akamaized.net/hdntl=${token}/media.m3u8?token=${token}`,
    http_headers: { "User-Agent": "public-agent" },
    requested_downloads: [{
      format_id: "hls-8000",
      protocol: "m3u8_native",
      ext: "mp4",
      vcodec: "avc1.64002a",
      acodec: "mp4a.40.2",
      width: 1920,
      height: 1080,
      fps: 60,
      url: `https://vod.example.akamaized.net/hdntl=${token}/media.m3u8?token=${token}`
    }]
  });
}

function playlist(token = "one"): string {
  return [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-INDEPENDENT-SEGMENTS",
    "#EXT-X-TARGETDURATION:2",
    "#EXT-X-MEDIA-SEQUENCE:7",
    "#EXT-X-DISCONTINUITY-SEQUENCE:0",
    `#EXT-X-MAP:URI=\"init.mp4?token=${token}\"`,
    "#EXTINF:2.000000,",
    `segment-7.m4s?token=${token}`,
    "#EXTINF:1.999999,",
    `segment-8.m4s?token=${token}`,
    "#EXTINF:2.000001,",
    `segment-9.m4s?token=${token}`,
    "#EXT-X-ENDLIST",
    ""
  ].join("\n");
}

function directDump(token = "one"): string {
  return JSON.stringify({
    id: "abcdefghijk",
    extractor: "youtube",
    duration: 10,
    format_id: "136+140",
    protocol: "https+https",
    ext: "mp4",
    vcodec: "avc1.4d401f",
    acodec: "mp4a.40.2",
    width: 1280,
    height: 720,
    fps: 30,
    requested_formats: [
      {
        format_id: "136",
        protocol: "https",
        ext: "mp4",
        vcodec: "avc1.4d401f",
        acodec: "none",
        url: `https://r1.googlevideo.com/videoplayback?id=stable&sig=${token}`,
        http_headers: { "User-Agent": "public-agent" }
      },
      {
        format_id: "140",
        protocol: "https",
        ext: "m4a",
        vcodec: "none",
        acodec: "mp4a.40.2",
        url: `https://r1.googlevideo.com/videoplayback?id=stable&sig=${token}`,
        http_headers: { "User-Agent": "public-agent" }
      }
    ],
    requested_downloads: [{
      format_id: "136+140",
      protocol: "https+https"
    }]
  });
}

function probe(codecType: "video" | "audio", duration: string): string {
  return JSON.stringify({
    streams: [{
      codec_type: codecType,
      codec_name: codecType === "video" ? "h264" : "aac",
      start_time: "0.000000",
      duration
    }],
    format: { start_time: "0.000000", duration }
  });
}

test("selected HLS dump keeps signed URLs runtime-only", () => {
  const first = parseYtDlpSelectedInputsDump(hlsDump("first-secret"), {
    platform: "CHZZK",
    contentId: "123"
  });
  const second = parseYtDlpSelectedInputsDump(hlsDump("second-secret"), {
    platform: "CHZZK",
    contentId: "123"
  });
  assert.equal(first.kind, "hls");
  assert.equal(second.kind, "hls");
  assert.equal(first.format.selectedFormatProofId, second.format.selectedFormatProofId);
  assert.equal(first.playlistSemanticIdentity, second.playlistSemanticIdentity);
  assert.match(first.playlistUrl, /first-secret/u);
  assert.doesNotMatch(first.playlistSemanticIdentity, /first-secret|token=/u);
});

test("HLS parser uses cumulative EXTINF and ignores signed URL rotation", () => {
  const first = parseVodHlsMediaPlaylist(playlist("one"), {
    playlistUrl: "https://vod.example.akamaized.net/hdntl=one/media.m3u8?token=one",
    renditionFingerprintSha256: SHA
  });
  const second = parseVodHlsMediaPlaylist(playlist("two"), {
    playlistUrl: "https://vod.example.akamaized.net/hdntl=two/media.m3u8?token=two",
    renditionFingerprintSha256: SHA
  });
  assert.equal(first.durationUs, 6_000_000);
  assert.equal(first.playlistFingerprintSha256, second.playlistFingerprintSha256);
  assert.deepEqual(first.segments.map((item) => item.startUs), [0, 2_000_000, 3_999_999]);
  const range = planVodHlsSection(first, 1_500, 4_500);
  assert.deepEqual(range.segments.map((item) => item.sequence), [7, 8, 9]);
  assert.equal(range.firstSegmentOffsetUs, 1_500_000);
});

test("HLS parser rejects discontinuity, encryption and incomplete lists", () => {
  for (const line of [
    "#EXT-X-DISCONTINUITY",
    "#EXT-X-KEY:METHOD=AES-128,URI=\"key\"",
    "#EXT-X-BYTERANGE:12@0"
  ]) {
    assert.throws(
      () => parseVodHlsMediaPlaylist(playlist().replace("#EXTINF:2.000000,", `${line}\n#EXTINF:2.000000,`), {
        playlistUrl: "https://vod.example.akamaized.net/media.m3u8",
        renditionFingerprintSha256: SHA
      }),
      (error: unknown) => {
        assert(error instanceof ExternalVodClockProofError);
        assert.equal(error.code, "UNSUPPORTED_HLS_PLAYLIST");
        return true;
      }
    );
  }
  assert.throws(() => parseVodHlsMediaPlaylist(
    playlist().replace("#EXT-X-ENDLIST\n", ""),
    {
      playlistUrl: "https://vod.example.akamaized.net/media.m3u8",
      renditionFingerprintSha256: SHA
    }
  ));
});

test("YouTube exact direct inputs require zero-origin ffprobe proof", () => {
  const selected = parseYtDlpSelectedInputsDump(directDump("private-one"), {
    platform: "YOUTUBE",
    contentId: "abcdefghijk"
  });
  assert.equal(selected.kind, "direct");
  const parsed = parseDirectMediaFfprobeClockProof(selected, {
    video: probe("video", "9.600000"),
    audio: probe("audio", "9.692336")
  });
  assert.equal(parsed.clockProof.playerDurationUs, 9_600_000);
  assert.equal(parsed.clockProof.video.startUs, 0);
  assert.equal(parsed.clockProof.audio?.startUs, 0);
  assert.doesNotMatch(JSON.stringify(parsed.clockProof), /googlevideo|private-one/u);

  const nonzero = JSON.stringify({
    streams: [{ codec_type: "video", codec_name: "h264", start_time: "1.998646", duration: "9.6" }],
    format: { start_time: "1.998646", duration: "9.6" }
  });
  assert.throws(
    () => parseDirectMediaFfprobeClockProof(selected, {
      video: nonzero,
      audio: probe("audio", "9.692336")
    }),
    (error: unknown) => {
      assert(error instanceof ExternalVodClockProofError);
      assert.equal(error.code, "NONZERO_DIRECT_ORIGIN");
      return true;
    }
  );
});

test("YouTube zero-origin proof requires both format and selected-stream start_time", () => {
  const selected = parseYtDlpSelectedInputsDump(directDump(), {
    platform: "YOUTUBE",
    contentId: "abcdefghijk"
  });
  assert.equal(selected.kind, "direct");
  const missingFormatStart = JSON.stringify({
    streams: [{
      codec_type: "video",
      codec_name: "h264",
      start_time: "0.000000",
      duration: "9.600000"
    }],
    format: { duration: "9.600000" }
  });
  const missingStreamStart = JSON.stringify({
    streams: [{
      codec_type: "video",
      codec_name: "h264",
      duration: "9.600000"
    }],
    format: { start_time: "0.000000", duration: "9.600000" }
  });
  for (const video of [missingFormatStart, missingStreamStart]) {
    assert.throws(
      () => parseDirectMediaFfprobeClockProof(selected, {
        video,
        audio: probe("audio", "9.692336")
      }),
      (error: unknown) => {
        assert(error instanceof ExternalVodClockProofError);
        assert.equal(error.code, "NONZERO_DIRECT_ORIGIN");
        return true;
      }
    );
  }
});

test("YouTube direct semantic proof ignores CDN routing but binds exact stream format", () => {
  const first = parseYtDlpSelectedInputsDump(directDump("first-secret"), {
    platform: "YOUTUBE",
    contentId: "abcdefghijk"
  });
  const rotated = parseYtDlpSelectedInputsDump(
    directDump("second-secret").replaceAll(
      "r1.googlevideo.com",
      "rr9---sn-edge.googlevideo.com"
    ),
    { platform: "YOUTUBE", contentId: "abcdefghijk" }
  );
  assert.equal(first.kind, "direct");
  assert.equal(rotated.kind, "direct");
  assert.equal(first.video.semanticIdentity, rotated.video.semanticIdentity);
  assert.equal(
    first.video.semanticIdentitySha256,
    rotated.video.semanticIdentitySha256
  );
  const firstProof = parseDirectMediaFfprobeClockProof(first, {
    video: probe("video", "9.600000"),
    audio: probe("audio", "9.692336")
  });
  const rotatedProof = parseDirectMediaFfprobeClockProof(rotated, {
    video: probe("video", "9.600000"),
    audio: probe("audio", "9.692336")
  });
  assert.equal(firstProof.clockProof.proofId, rotatedProof.clockProof.proofId);

  const changedDocument = JSON.parse(directDump("third-secret")) as {
    format_id: string;
    requested_formats: Array<{ format_id: string }>;
  };
  changedDocument.format_id = "137+140";
  changedDocument.requested_formats[0]!.format_id = "137";
  const changed = parseYtDlpSelectedInputsDump(JSON.stringify(changedDocument), {
    platform: "YOUTUBE",
    contentId: "abcdefghijk"
  });
  assert.equal(changed.kind, "direct");
  assert.notEqual(
    first.video.semanticIdentitySha256,
    changed.video.semanticIdentitySha256
  );
});

test("persisted part evidence is exact, content-addressed and change-detecting", () => {
  const selected = parseYtDlpSelectedInputsDump(directDump(), {
    platform: "YOUTUBE",
    contentId: "abcdefghijk"
  });
  assert.equal(selected.kind, "direct");
  const direct = parseDirectMediaFfprobeClockProof(selected, {
    video: probe("video", "9.600000"),
    audio: probe("audio", "9.692336")
  });
  const evidence = createExternalVodSectionClockEvidence({
    platform: "YOUTUBE",
    contentId: "abcdefghijk",
    partId: "abcdefghijk",
    partIndex: 0,
    selectedFormatProofId: selected.format.selectedFormatProofId,
    directClockProof: direct.clockProof
  });
  assert.deepEqual(parseExternalVodSectionClockEvidence(
    JSON.parse(JSON.stringify(evidence)) as unknown
  ), evidence);
  assert.doesNotThrow(() => assertExternalVodSectionClockEvidenceMatches(evidence, evidence));
  assert.throws(() => assertExternalVodSectionClockEvidenceMatches(evidence, {
    ...evidence,
    evidenceId: "b".repeat(64)
  }));
  assert.throws(() => parseExternalVodSectionClockEvidence({
    ...evidence,
    rawUrl: "https://r1.googlevideo.com/?sig=secret"
  }));
});
