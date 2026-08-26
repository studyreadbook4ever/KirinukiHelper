import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(relativePath: string): Promise<string> {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("개인정보 안내는 서버·로컬·외부 제공자의 처리 경계를 구분한다", async () => {
  const [privacy, index, editor] = await Promise.all([
    read("web/privacy.html"),
    read("web/index.html"),
    read("web/editor.html")
  ]);
  assert.match(privacy, /회원 계정·로그인이나 서버 프로젝트\s*데이터베이스가 없으며/u);
  assert.match(privacy, /IP 주소, 요청 시각, 요청 경로/u);
  assert.match(privacy, /브라우저 저장소/u);
  assert.match(privacy, /Kakao AdFit 스크립트가 같은 웹 문서에서\s*실행/u);
  assert.match(privacy, /\?source=…/u);
  assert.match(privacy, /#source=…/u);
  for (const provider of [
    "cloudflare.com/policies/privacy/",
    "policies.google.com/privacy",
    "policy.naver.com/policy/privacy.html",
    "sooplive.com/policy/policy2.html",
    "adfit.kakao.com/web/html/stipulation.html",
    "info.ds.kakao.com/optout.do"
  ]) {
    assert.ok(privacy.includes(provider), `외부 제공자 고지 링크 누락: ${provider}`);
  }
  assert.doesNotMatch(privacy, /일절 수집하지/u);
  assert.match(index, /href="\/privacy\.html"/u);
  assert.match(editor, /href="\/privacy\.html"[^>]*target="_blank"/u);
});

test("개인정보 안내 문서는 스크립트와 외부 리소스를 실행하지 않는다", async () => {
  const privacy = await read("web/privacy.html");
  assert.match(privacy, /<meta name="referrer" content="no-referrer">/u);
  assert.match(privacy, /script-src 'none'/u);
  assert.match(privacy, /connect-src 'none'/u);
  assert.doesNotMatch(privacy, /<script\b/iu);
  assert.doesNotMatch(privacy, /<(?:iframe|img)\b[^>]*(?:src|srcdoc)=/iu);
});
