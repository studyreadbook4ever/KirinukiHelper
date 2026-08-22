import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  shouldBlockEditorOnClient
} from "../src/lib/editor-mobile-access.js";

const root = new URL("../", import.meta.url);

async function read(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, root), "utf8");
}

function header(html: string): string {
  return html.match(/<header class="topbar">[\s\S]*?<\/header>/u)?.[0] ?? "";
}

test("편집기 상단은 Kirinuki 상표·728x90 슬롯과 두 행의 원래 크기 action을 둔다", async () => {
  const [webHtml, webCss] = await Promise.all([
    read("web/editor.html"),
    read("web/editor/editor.css")
  ]);

  for (const html of [webHtml]) {
    const topbar = header(html);
    assert.doesNotMatch(
      topbar,
      />\s*(?:CHZZK|VOD 쇼츠 전용 편집|키리누키 프로젝트|이번 사용 확인|이번 1회 사용자 확인)\s*</u
    );
    assert.ok(
      topbar.indexOf('id="editor-brand-slot"') < topbar.indexOf('id="editor-leaderboard-ad-slot"'),
      "상표는 leaderboard 광고 왼쪽에 있어야 합니다."
    );
    assert.doesNotMatch(
      topbar.match(/id="editor-leaderboard-ad-slot"[\s\S]*?<\/div>/u)?.[0] ?? "",
      /<(?:script|iframe)\b/iu
    );

    const firstRow = topbar.indexOf("top-actions-primary");
    const secondRow = topbar.indexOf("top-actions-secondary");
    assert.ok(firstRow >= 0 && secondRow > firstRow);
    for (const id of [
      "prepare-chzzk-vod",
      "pick-media",
      "open-short-form",
      "exit-short-form",
      "export-video"
    ]) {
      const index = topbar.indexOf(`id="${id}"`);
      assert.ok(index > firstRow && index < secondRow, `${id}는 위 행이어야 합니다.`);
    }
    for (const id of [
      "undo",
      "redo",
      "create-local-draft",
      "open-local-drafts",
      "finish-editing-session"
    ]) {
      assert.ok(topbar.indexOf(`id="${id}"`) > secondRow, `${id}는 아래 행이어야 합니다.`);
    }
    assert.match(topbar, /id="editor-leaderboard-ad-slot"[^>]*aria-hidden="true"/u);
    assert.doesNotMatch(topbar, /editor-leaderboard-ad-slot"[^>]*role=/u);
  }

  const webTopbar = header(webHtml);
  assert.match(
    webTopbar,
    /id="editor-brand-slot"[^>]*role="img"[^>]*aria-label="Kirinuki 상표"/u
  );
  assert.doesNotMatch(webTopbar, /id="editor-brand-slot"[^>]*aria-hidden="true"/u);
  assert.match(
    webTopbar,
    /<svg class="kirinuki-mark"[^>]*aria-hidden="true"[^>]*focusable="false">[\s\S]*class="kirinuki-mark-k"[\s\S]*class="kirinuki-mark-cut"[\s\S]*>KIRINUKI<\/text>[\s\S]*<\/svg>/u
  );
  assert.doesNotMatch(
    webTopbar.match(/<svg class="kirinuki-mark"[\s\S]*?<\/svg>/u)?.[0] ?? "",
    /<(?:title|desc)>/u,
    "상표 이름은 바깥 role=img 한 곳에서만 제공해야 합니다."
  );

  for (const css of [webCss]) {
    assert.match(css, /\.editor-brand-slot\s*\{\s*width:\s*100px;/u);
    assert.match(css, /\.editor-leaderboard-ad-slot\s*\{\s*width:\s*728px;/u);
    assert.match(
      css,
      /\.editor-brand-slot,\s*\.editor-leaderboard-ad-slot\s*\{[^}]*height:\s*90px;/u
    );
    assert.match(css, /\.top-actions\s*\{[^}]*display:\s*grid;/u);
    assert.match(css, /\.top-actions-row\s*\{[^}]*min-height:\s*38px;/u);
    assert.doesNotMatch(css, /\.editor-brand-slot\s*\{\s*display:\s*none;/u);
    assert.match(css, /\.editor-shell\s*\{[^}]*min-height:\s*706px;/u);
    assert.doesNotMatch(
      css,
      /\.clip-sidebar\s*\{\s*display:\s*none;/u,
      "좁거나 낮은 데스크톱에서도 160×600 광고 rail을 숨기면 안 됩니다."
    );
  }

  assert.match(webCss, /\.kirinuki-mark\s*\{[^}]*width:\s*100px;[^}]*height:\s*90px;/u);
  assert.match(webCss, /\.kirinuki-mark-k\s*\{[^}]*stroke:\s*#f6f8fb;/u);
  assert.match(webCss, /\.kirinuki-mark-cut\s*\{[^}]*stroke:\s*var\(--mint\);/u);
});

test("모바일 판정은 실제 모바일 신호만 차단하고 viewport·터치 데스크톱은 허용한다", () => {
  assert.equal(shouldBlockEditorOnClient({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    platform: "iPhone",
    maxTouchPoints: 5,
    viewportWidth: 1179
  }), true);
  assert.equal(shouldBlockEditorOnClient({
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro)",
    platform: "Linux armv8l",
    maxTouchPoints: 5,
    viewportWidth: 1400
  }), true);
  assert.equal(shouldBlockEditorOnClient({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15",
    platform: "MacIntel",
    maxTouchPoints: 5
  }), true);
  assert.equal(shouldBlockEditorOnClient({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140 Safari/537.36",
    platform: "Win32",
    maxTouchPoints: 10,
    viewportWidth: 390,
    coarsePointer: true
  }), false);
  assert.equal(shouldBlockEditorOnClient({
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/140 Safari/537.36",
    platform: "Linux x86_64",
    maxTouchPoints: 0,
    viewportWidth: 320
  }), false);
});

test("시작 화면과 직접 editor URL 모두 모바일 진입을 fail-closed로 막는다", async () => {
  const [studioHtml, studioSource, editorSource, webEditorHtml] = await Promise.all([
    read("web/index.html"),
    read("src/web/main.ts"),
    read("src/editor/main.ts"),
    read("web/editor.html")
  ]);

  assert.match(studioHtml, /id="mobile-editor-notice"[^>]*hidden/u);
  assert.match(studioHtml, /편집기는 모바일에서 사용할 수 없습니다/u);
  assert.match(
    studioSource,
    /const mobileEditorBlocked = currentClientCannotUseEditor\(\);[\s\S]*elements\.startEditor\.disabled = Boolean\([\s\S]*mobileEditorBlocked \|\| openingEditor \|\| invalidRow[\s\S]*\);/u
  );
  assert.match(
    studioSource,
    /elements\.form\.addEventListener\("submit"[\s\S]*if \(mobileEditorBlocked\) \{[\s\S]*explainMobileEditorBlock\(\);[\s\S]*return;/u
  );
  assert.match(
    editorSource,
    /async function initialize\(\) \{\s*if \(!isKirinukiStudioOrigin\(location\.origin\)\) \{\s*showEditorOriginGate\(\);\s*return;\s*\}\s*if \(currentClientCannotUseEditor\(\)\) \{\s*showEditorMobileGate\(\);\s*return;\s*\}\s*const verifiedProjectId = await verifyEditorUsagePolicyGate\(\);/u
  );
  for (const html of [webEditorHtml]) {
    assert.match(html, /id="editor-mobile-gate"[^>]*hidden/u);
    assert.match(html, /편집기는 모바일에서 사용할 수 없습니다/u);
  }
});

test("시작 화면의 단일 편집기 CTA가 신뢰 안내 위에 있고 실제 오픈소스 저장소를 연다", async () => {
  const [html, source] = await Promise.all([
    read("web/index.html"),
    read("src/web/main.ts")
  ]);
  const cta = html.indexOf('id="start-editor"');
  const trust = html.indexOf('class="site-trust-notice"');
  assert.ok(cta >= 0 && trust > cta);
  assert.equal((html.match(/id="start-editor"/gu) || []).length, 1);
  assert.match(html, /id="start-editor"[^>]*>편집기 열기<\/button>/u);
  assert.doesNotMatch(html, /class="start-bar"|원본과 구간을 입력해 주세요|새 편집 시작/u);
  assert.match(
    html,
    /href="https:\/\/github\.com\/studyreadbook4ever\/KirinukiHelper"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/u
  );
  assert.doesNotMatch(source, /startEditor\.textContent = "(?:새 편집 시작|별도 새 편집 시작)"/u);
});
