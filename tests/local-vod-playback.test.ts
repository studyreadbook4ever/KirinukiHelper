import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_VOD_PLAYBACK_SESSION_SCHEMA,
  localVodPlaybackPartForSourceTime,
  localVodPlaybackSourceSeconds,
  parseLocalVodPlaybackSession
} from "../src/lib/local-vod-playback.js";
import {
  resolveLocalVodPlayback
} from "../scripts/local-vod-playback-resolver.js";
import {
  resolveExternalVodPlaylistResourceUrl
} from "../scripts/local-vod-playback-proxy.js";

const TOKEN = "a".repeat(43);

function multipartSession() {
  return parseLocalVodPlaybackSession({
    schema: LOCAL_VOD_PLAYBACK_SESSION_SCHEMA,
    platform: "SOOP",
    contentId: "169475287",
    sourceUrl: "https://vod.sooplive.com/player/169475287",
    durationSeconds: 30,
    parts: [{
      index: 0,
      startSeconds: 0,
      endSeconds: 10,
      manifestUrl: `http://127.0.0.1:4319/v1/playback/${TOKEN}/part/0/index.m3u8`
    }, {
      index: 1,
      startSeconds: 10,
      endSeconds: 30,
      manifestUrl: `http://127.0.0.1:4319/v1/playback/${TOKEN}/part/1/index.m3u8`
    }]
  });
}

test("SOOP 분할 VOD는 보이는 파트 재생 시각을 하나의 원본 컷 시계로 환산한다", () => {
  const session = multipartSession();
  assert.ok(session);
  const first = localVodPlaybackPartForSourceTime(session, 9.999);
  const secondAtBoundary = localVodPlaybackPartForSourceTime(session, 10);
  const second = localVodPlaybackPartForSourceTime(session, 17.25);
  assert.equal(first.index, 0);
  assert.equal(secondAtBoundary.index, 1);
  assert.equal(second.index, 1);
  assert.equal(localVodPlaybackSourceSeconds(first, 9.999), 9.999);
  assert.equal(localVodPlaybackSourceSeconds(secondAtBoundary, 0), 10);
  assert.equal(localVodPlaybackSourceSeconds(second, 7.25), 17.25);
  assert.equal(localVodPlaybackSourceSeconds(second, 999), 30);
});

test("재생 session은 파트 사이의 틈·중첩과 비-loopback manifest를 거절한다", () => {
  const session = multipartSession();
  assert.ok(session);
  const base = {
    ...session,
    parts: session.parts.map((part) => ({ ...part }))
  };
  assert.equal(parseLocalVodPlaybackSession({
    ...base,
    parts: [base.parts[0], { ...base.parts[1], startSeconds: 10.1 }]
  }), null);
  assert.equal(parseLocalVodPlaybackSession({
    ...base,
    parts: [base.parts[0], {
      ...base.parts[1],
      manifestUrl: "https://example.com/index.m3u8"
    }]
  }), null);
});

function currentChzzkPlaybackMpd(): string {
  return `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" xmlns:nvod="urn:naver:vod"
  mediaPresentationDuration="PT10M28.267S">
  <Period>
    <AdaptationSet mimeType="video/mp2t">
      <Representation id="1080p60" width="1920" height="1080" bandwidth="8054000"
        frameRate="60" codecs="avc1.64002a,mp4a.40.2"
        nvod:m3u="https://vod.pstatic.net/current/1080p.m3u8?sig=runtime-only">
        <SegmentTemplate timescale="1000" startNumber="0" media="chunk.ts">
          <SegmentTimeline><S t="0" d="4000" r="156"/></SegmentTimeline>
        </SegmentTemplate>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;
}

test("현재 CHZZK ABR_HLS는 깨진 yt-dlp JSON 대신 공식 MPD HLS로 즉시 연결한다", async () => {
  let processCalls = 0;
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "api.chzzk.naver.com") {
      return Response.json({
        content: {
          vodStatus: "ABR_HLS",
          videoId: "internal-video-id",
          inKey: "runtime-only-key"
        }
      });
    }
    assert.equal(url.hostname, "apis.naver.com");
    return new Response(currentChzzkPlaybackMpd(), {
      status: 200,
      headers: { "content-type": "application/dash+xml" }
    });
  }) as typeof globalThis.fetch;
  const resolved = await resolveLocalVodPlayback(
    "https://chzzk.naver.com/video/14822756",
    {
      ytDlpBinary: "/opt/kirinuki/yt-dlp",
      fetchImpl,
      runProcess: async () => {
        processCalls += 1;
        throw new Error("현재 CHZZK ABR_HLS에서 yt-dlp를 실행하면 안 됩니다.");
      }
    }
  );
  assert.equal(processCalls, 0);
  assert.equal(resolved.platform, "CHZZK");
  assert.equal(resolved.contentId, "14822756");
  assert.equal(resolved.durationSeconds, 628.267);
  assert.equal(
    resolved.parts[0]?.manifestUrl,
    "https://vod.pstatic.net/current/1080p.m3u8?sig=runtime-only"
  );
  assert.equal(resolved.parts[0]?.requestHeaders.referer,
    "https://chzzk.naver.com/video/14822756");
  assert.doesNotMatch(
    JSON.stringify(resolved.parts[0]?.requestHeaders),
    /runtime-only-key/u
  );
});

test("구형 CHZZK VOD 상태는 기존 yt-dlp HLS fallback을 보존한다", async () => {
  let processCalls = 0;
  const resolved = await resolveLocalVodPlayback(
    "https://chzzk.naver.com/video/14514980",
    {
      ytDlpBinary: "/opt/kirinuki/yt-dlp",
      fetchImpl: (async () => Response.json({
        content: { vodStatus: "NONE" }
      })) as typeof globalThis.fetch,
      runProcess: async () => {
        processCalls += 1;
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            duration: 120,
            formats: [{
              protocol: "m3u8_native",
              url: "https://vod.pstatic.net/legacy/index.m3u8",
              vcodec: "h264",
              acodec: "aac",
              height: 1080,
              tbr: 5000
            }]
          }),
          stderr: ""
        };
      }
    }
  );
  assert.equal(processCalls, 1);
  assert.equal(resolved.durationSeconds, 120);
  assert.equal(
    resolved.parts[0]?.manifestUrl,
    "https://vod.pstatic.net/legacy/index.m3u8"
  );
});

test("현재 CHZZK HLS의 상대 조각은 재생목록의 일회성 CDN 서명만 상속한다", () => {
  const base = "https://b01-kr-naver-vod.pstatic.net/path/index.m3u8?_lsu_sa_=runtime-only";
  const resolved = resolveExternalVodPlaylistResourceUrl(
    "CHZZK",
    "segment-0001.ts",
    base
  );
  assert.equal(
    resolved.href,
    "https://b01-kr-naver-vod.pstatic.net/path/segment-0001.ts?_lsu_sa_=runtime-only"
  );
  assert.equal(
    resolveExternalVodPlaylistResourceUrl(
      "CHZZK",
      "segment-0001.ts?part=1",
      base
    ).search,
    "?part=1"
  );
  assert.equal(
    resolveExternalVodPlaylistResourceUrl(
      "SOOP",
      "segment-0001.ts",
      "https://vod.sooplive.com/path/index.m3u8?token=runtime-only"
    ).search,
    ""
  );
});
