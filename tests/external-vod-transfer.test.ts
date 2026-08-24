import assert from "node:assert/strict";
import test from "node:test";

import {
  ExternalVodTransferError,
  assertExternalVodTransferUrl,
  fetchExternalVodBytes,
  safeExternalVodRequestHeaders,
  secretFreeExternalVodUrlIdentity
} from "../scripts/external-vod-transfer.js";

function assertCode(error: unknown, code: string): boolean {
  assert(error instanceof ExternalVodTransferError);
  assert.equal(error.code, code);
  return true;
}

test("플랫폼별 공개 CDN HTTPS만 외부 VOD 전송으로 허용한다", () => {
  assert.equal(
    assertExternalVodTransferUrl(
      "CHZZK",
      "https://light-slit.akamaized.net/chzzk/vod.m3u8?hdntl=rotating"
    ).hostname,
    "light-slit.akamaized.net"
  );
  assert.equal(
    assertExternalVodTransferUrl(
      "YOUTUBE",
      "https://r1---sn-a5mekn.googlevideo.com/videoplayback?expire=1"
    ).hostname,
    "r1---sn-a5mekn.googlevideo.com"
  );
  assert.equal(
    assertExternalVodTransferUrl(
      "SOOP",
      "https://vod-archive-kr-cdn-z01.sooplive.com/path/manifest.m3u8"
    ).hostname,
    "vod-archive-kr-cdn-z01.sooplive.com"
  );

  for (const value of [
    "http://light-slit.akamaized.net/vod.m3u8",
    "https://akamaized.net.attacker.example/vod.m3u8",
    "https://127.0.0.1/vod.m3u8",
    "https://user:password@light-slit.akamaized.net/vod.m3u8",
    "https://light-slit.akamaized.net:8443/vod.m3u8",
    "https://light-slit.akamaized.net/vod.m3u8#fragment"
  ]) {
    assert.throws(
      () => assertExternalVodTransferUrl("CHZZK", value),
      (error) => assertCode(error, "UNSAFE_TRANSFER_URL")
    );
  }
});

test("query와 CHZZK path 내 hdntl 서명은 영구 clock identity에 남지 않는다", () => {
  const first = secretFreeExternalVodUrlIdentity(
    "https://light-slit.akamaized.net/chzzk/live/"
      + "hdntl=exp=1~acl=*%2fkr%2f*~hmac=first/1080p/vod.m3u8?token=one"
  );
  const second = secretFreeExternalVodUrlIdentity(
    "https://light-slit.akamaized.net/chzzk/live/"
      + "hdntl=exp=2~acl=*%2fkr%2f*~hmac=second/1080p/vod.m3u8?token=two"
  );
  assert.equal(first, second);
  assert.doesNotMatch(first, /hmac|first|second|token|exp=/u);
  assert.match(first, /:signed-path-component:/u);
});

test("선택 source의 공개 헤더만 전달하고 자격 증명은 폐기한다", () => {
  assert.deepEqual(safeExternalVodRequestHeaders({
    "User-Agent": "Kirinuki test",
    Accept: "application/vnd.apple.mpegurl",
    Cookie: "secret",
    Authorization: "Bearer secret",
    Range: "bytes=0-10"
  }), {
    "accept-encoding": "identity",
    "user-agent": "Kirinuki test",
    accept: "application/vnd.apple.mpegurl",
    range: "bytes=0-10"
  });
  assert.throws(
    () => safeExternalVodRequestHeaders({ "User-Agent": "safe\r\nCookie: bad" }),
    (error) => assertCode(error, "UNSAFE_TRANSFER_HEADERS")
  );
});

test("리다이렉트 매 단계와 실제 본문 크기를 다시 검증한다", async () => {
  const calls: string[] = [];
  const fetched = await fetchExternalVodBytes({
    platform: "SOOP",
    url: "https://vod.sooplive.com/start",
    maximumBytes: 4,
    fetchImpl: async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/start")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://cdn.sooplive.com/final" }
        });
      }
      return new Response(Uint8Array.from([1, 2, 3, 4]), {
        status: 200,
        headers: {
          "content-length": "4",
          "content-encoding": "identity"
        }
      });
    }
  });
  assert.deepEqual(calls, [
    "https://vod.sooplive.com/start",
    "https://cdn.sooplive.com/final"
  ]);
  assert.deepEqual([...fetched.bytes], [1, 2, 3, 4]);
  assert.equal(fetched.finalUrl, "https://cdn.sooplive.com/final");

  await assert.rejects(fetchExternalVodBytes({
    platform: "SOOP",
    url: "https://vod.sooplive.com/start",
    maximumBytes: 4,
    fetchImpl: async () => new Response(null, {
      status: 302,
      headers: { location: "https://attacker.example/private" }
    })
  }), (error) => assertCode(error, "UNSAFE_TRANSFER_URL"));

  await assert.rejects(fetchExternalVodBytes({
    platform: "SOOP",
    url: "https://vod.sooplive.com/large",
    maximumBytes: 3,
    fetchImpl: async () => new Response(Uint8Array.from([1, 2, 3, 4]), {
      status: 200
    })
  }), (error) => assertCode(error, "TRANSFER_TOO_LARGE"));
});
