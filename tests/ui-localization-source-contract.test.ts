import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { EDITOR_STATIC_UI_COPY } from "../src/editor/ui-copy-static.js";
import type { UiCopyCatalog } from "../src/lib/ui-localization.js";
import { translateUiCopy } from "../src/lib/ui-localization.js";
import { CUT_UI_COPY_CATALOG } from "../src/web/ui-copy.js";

const hangulPattern = /[가-힣]/u;
const translatableAttributePattern =
  /\b(?:aria-label|aria-description|aria-roledescription|title|placeholder|value)\s*=\s*(["'])([^"']*[가-힣][^"']*)\1/gu;

function normalizedCopy(source: string): string {
  return source
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, "\"")
    .replace(/&#39;|&apos;/gu, "'")
    .trim()
    .replace(/\s+/gu, " ");
}

function koreanStaticCopy(html: string): Set<string> {
  const authoredMarkup = html
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/<script\b[\s\S]*?<\/script>/giu, "")
    .replace(/<style\b[\s\S]*?<\/style>/giu, "");
  const result = new Set<string>();

  for (const match of authoredMarkup.matchAll(/>([^<>]*[가-힣][^<>]*)</gu)) {
    const source = normalizedCopy(String(match[1]));
    if (source) {
      result.add(source);
    }
  }
  for (const match of authoredMarkup.matchAll(translatableAttributePattern)) {
    const source = normalizedCopy(String(match[2]));
    if (source) {
      result.add(source);
    }
  }
  return result;
}

function attributeValue(tag: string, attribute: string): string | null {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = tag.match(new RegExp(`\\b${escaped}=(?:"([^"]*)"|'([^']*)')`, "u"));
  return match ? String(match[1] ?? match[2]) : null;
}

function switcherButtons(html: string): Array<{
  language: string | null;
  label: string;
  lang: string | null;
  pressed: string | null;
}> {
  const switcherMatches = [
    ...html.matchAll(/<div\b[^>]*\bdata-kirinuki-ui-language-switcher\b[^>]*>/gu)
  ];
  assert.equal(switcherMatches.length, 1, "exactly one language switcher is required");
  const opening = switcherMatches[0];
  if (!opening) {
    assert.fail("language switcher opening element is required");
  }
  const start = opening.index ?? -1;
  const end = html.indexOf("</div>", start);
  assert.ok(start >= 0 && end > start, "language switcher must have a closing element");
  assert.equal(attributeValue(String(opening[0]), "role"), "group");
  assert.equal(attributeValue(String(opening[0]), "aria-label"), "화면 언어");

  return [...html.slice(start, end).matchAll(/<button\b[^>]*>([^<]*)<\/button>/gu)]
    .map((match) => ({
      language: attributeValue(String(match[0]), "data-kirinuki-ui-language"),
      label: normalizedCopy(String(match[1])),
      lang: attributeValue(String(match[0]), "lang"),
      pressed: attributeValue(String(match[0]), "aria-pressed")
    }));
}

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `source marker is missing: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `source end marker is missing: ${endMarker}`);
  return source.slice(start, end);
}

function assertCatalogCoversStaticHtml(
  screen: string,
  html: string,
  catalog: UiCopyCatalog
): void {
  const candidates = koreanStaticCopy(html);
  assert.ok(candidates.size > 0, `${screen} must expose Korean fallback copy`);
  for (const source of candidates) {
    const translation = catalog[source];
    assert.ok(translation, `${screen} catalog is missing: ${source}`);
    assert.notEqual(
      translateUiCopy(source, "en", catalog),
      source,
      `${screen} English copy is missing: ${source}`
    );
    assert.notEqual(
      translateUiCopy(source, "ja", catalog),
      source,
      `${screen} Japanese copy is missing: ${source}`
    );
  }
}

test("컷 화면과 편집기의 언어 선택기는 상표 아래에 정확한 KR EN JP 상태로 있다", async () => {
  const [cutHtml, editorHtml] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../web/editor.html", import.meta.url), "utf8")
  ]);
  const expected = [
    { language: "ko", label: "KR", lang: null, pressed: "true" },
    { language: "en", label: "EN", lang: null, pressed: "false" },
    { language: "ja", label: "JP", lang: null, pressed: "false" }
  ];

  for (const [screen, html] of [["cut", cutHtml], ["editor", editorHtml]] as const) {
    const buttons = switcherButtons(html);
    assert.deepEqual(buttons, expected, `${screen} language buttons must be exact`);
    assert.equal(
      buttons.filter((button) => button.pressed === "true").length,
      1,
      `${screen} must have exactly one initially pressed language`
    );
  }

  const cutBrand = cutHtml.indexOf('<div class="brand-lockup">');
  const cutMark = cutHtml.indexOf('<a class="brand"', cutBrand);
  const cutMeta = cutHtml.indexOf('<div class="brand-meta">', cutBrand);
  const cutSwitcher = cutHtml.indexOf("data-kirinuki-ui-language-switcher", cutBrand);
  const cutHeaderEnd = cutHtml.indexOf("</header>", cutBrand);
  assert.ok(
    cutBrand >= 0
      && cutMark > cutBrand
      && cutMeta > cutMark
      && cutSwitcher > cutMeta
      && cutHeaderEnd > cutSwitcher,
    "cut-screen language selector must sit in the brand lockup under the brand"
  );

  const editorBrand = editorHtml.indexOf('id="editor-brand-slot"');
  const editorMark = editorHtml.indexOf('class="editor-brand-mark"', editorBrand);
  const editorSwitcher = editorHtml.indexOf(
    "data-kirinuki-ui-language-switcher",
    editorBrand
  );
  const editorAd = editorHtml.indexOf('id="editor-leaderboard-ad-slot"', editorBrand);
  assert.ok(
    editorBrand >= 0
      && editorMark > editorBrand
      && editorSwitcher > editorMark
      && editorAd > editorSwitcher,
    "editor language selector must sit below the brand mark and before the ad slot"
  );
  const editorBrandOpening = editorHtml.slice(
    editorHtml.lastIndexOf("<div", editorBrand),
    editorHtml.indexOf(">", editorBrand) + 1
  );
  assert.doesNotMatch(editorBrandOpening, /\brole="img"/u);
  assert.match(
    editorHtml.slice(editorMark, editorSwitcher),
    /class="editor-brand-mark"\s+role="img"/u
  );
});

test("두 화면의 모든 한국어 정적 문구는 해당 영어·일본어 카탈로그에 있다", async () => {
  const [cutHtml, editorHtml] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../web/editor.html", import.meta.url), "utf8")
  ]);

  assertCatalogCoversStaticHtml("cut screen", cutHtml, CUT_UI_COPY_CATALOG);
  assertCatalogCoversStaticHtml("editor", editorHtml, EDITOR_STATIC_UI_COPY);
});

test("편집기 CSS의 pseudo-content는 locale 변수만 사용한다", async () => {
  const css = await readFile(
    new URL("../web/editor/editor.css", import.meta.url),
    "utf8"
  );
  const hardcodedKoreanContent = [...css.matchAll(/\bcontent\s*:\s*([^;]+);/gu)]
    .map((match) => String(match[1]).trim())
    .filter((value) => hangulPattern.test(value));
  assert.deepEqual(
    hardcodedKoreanContent,
    [],
    "Korean pseudo-content must be supplied through locale variables"
  );

  const root = sourceBetween(css, ":root {", ":root:lang(en)");
  const english = sourceBetween(css, ":root:lang(en) {", ":root:lang(ja)");
  const japanese = sourceBetween(css, ":root:lang(ja) {", "* {");
  assert.match(root, /--ui-copy-source-frame:\s*"원본 영상 영역";/u);
  assert.match(root, /--ui-copy-review:\s*"확인";/u);
  assert.match(english, /--ui-copy-source-frame:\s*"Source Video Area";/u);
  assert.match(english, /--ui-copy-review:\s*"Review";/u);
  assert.match(japanese, /--ui-copy-source-frame:\s*"元映像の領域";/u);
  assert.match(japanese, /--ui-copy-review:\s*"確認";/u);
  assert.match(css, /content:\s*var\(--ui-copy-source-frame\);/u);
  assert.match(css, /content:\s*var\(--ui-copy-review\);/u);
});

test("localization은 컷·편집 surface 공개보다 먼저 설치된다", async () => {
  const [cutMain, editorMain] = await Promise.all([
    readFile(new URL("../src/web/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/editor/main.ts", import.meta.url), "utf8")
  ]);

  const cutInstall = cutMain.indexOf("const uiLocalization = installUiLocalization({");
  const cutSurface = cutMain.indexOf("function setDocumentSurface(");
  assert.ok(
    cutInstall >= 0 && cutSurface > cutInstall,
    "cut-screen localization must install before either document surface can be revealed"
  );

  const editorInstall = editorMain.indexOf("const uiLocalization = installUiLocalization({");
  const verifiedShell = editorMain.indexOf("function showVerifiedEditorShell(");
  const editorReveal = editorMain.indexOf(
    "elements.editor_shell.hidden = false;",
    verifiedShell
  );
  assert.ok(
    editorInstall >= 0 && verifiedShell > editorInstall && editorReveal > verifiedShell,
    "editor localization must install before the verified shell is revealed"
  );
});

test("사용자 프로젝트·원본·자막 문구는 UI 번역 대상에서 격리된다", async () => {
  const [cutHtml, editorHtml, editorMain, localizationSource] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../web/editor.html", import.meta.url), "utf8"),
    readFile(new URL("../src/editor/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/ui-localization.ts", import.meta.url), "utf8")
  ]);

  assert.match(
    cutHtml,
    /class="local-project-title"[^>]*data-kirinuki-ui-copy-ignore/u,
    "saved project titles are user content"
  );
  assert.match(
    editorHtml,
    /id="source-title"[^>]*data-kirinuki-ui-copy-ignore/u,
    "source streamer and broadcast titles are user content"
  );

  const translatedAttributes = sourceBetween(
    localizationSource,
    "const translatedAttributes = [",
    "] as const;"
  );
  assert.doesNotMatch(
    translatedAttributes,
    /["']value["']/u,
    "input values must remain project/caption/workspace data rather than UI copy"
  );
  assert.match(editorMain, /elements\.project_name\.value = project\.name;/u);
  assert.match(editorMain, /elements\.cue_text\.value = cue\.text;/u);
  assert.match(editorMain, /elements\.short_workspace_name\.value = active\.name;/u);

  const clipList = sourceBetween(
    editorMain,
    "function renderClipList()",
    "function renderCaptionColorRegister("
  );
  assert.match(
    clipList,
    /clipTitleElement\.toggleAttribute\(\s*"data-kirinuki-ui-copy-ignore",\s*Boolean\(clip\.note\)\s*\)/u,
    "user clip notes in the clip list must opt out of UI translation"
  );

  const cueList = sourceBetween(
    editorMain,
    "function renderCueList()",
    "function formatCaptionSheetPercent("
  );
  assert.match(
    cueList,
    /text\.textContent = cue\.text \|\| "\(빈 자막\)";[\s\S]{0,180}text\.toggleAttribute\([\s\S]{0,100}Boolean\(cue\.text\)/u,
    "caption-list text must opt out of UI translation"
  );

  const timeline = sourceBetween(
    editorMain,
    "function renderTimeline({ keepScroll = false } = {})",
    "function renderSubtitleOverlay()"
  );
  assert.match(
    timeline,
    /body\.textContent = cue\.text \|\| "\(빈 자막\)";[\s\S]{0,180}body\.toggleAttribute\([\s\S]{0,100}Boolean\(cue\.text\)/u,
    "timeline caption text must opt out of UI translation"
  );
  assert.match(
    timeline,
    /body\.textContent = `\$\{index \+ 1\} · \$\{clip\.note \|\| "사용자 선택"\}`;/u,
    "timeline clip notes must retain a non-catalog index prefix as their source guard"
  );
  assert.ok(
    (timeline.match(
      /sourceLabel\.toggleAttribute\(\s*"data-kirinuki-ui-copy-ignore",\s*Boolean\(sourceNote\)\s*\)/gu
    ) || []).length >= 2,
    "Shorts video and source-audio timeline labels must guard user source notes"
  );
  assert.match(
    timeline,
    /body\.toggleAttribute\("data-kirinuki-ui-copy-ignore", Boolean\(asset\.name\)\);[\s\S]{0,220}body\.title = `\$\{asset\.name \|\| "이미지"\} · 겹친 이미지는 이미지 트랙의 별도 줄에 표시됩니다\.`/u,
    "image names must stay user copy while the timeline-title suffix remains localizable"
  );

  const shortVideoLayers = sourceBetween(
    editorMain,
    "function renderShortVideoLayerPanel(",
    "function renderShortFramingInspector()"
  );
  assert.match(
    shortVideoLayers,
    /const sourceNote = String\(rootSource\?\.note \|\| ""\)\.trim\(\);[\s\S]{0,220}title\.toggleAttribute\(\s*"data-kirinuki-ui-copy-ignore",\s*Boolean\(sourceNote\)\s*\)/u,
    "user source notes in Shorts video layers must opt out of UI translation"
  );

  const overlays = sourceBetween(
    editorMain,
    "function renderSubtitleOverlay()",
    "function renderAll(options = {})"
  );
  assert.match(
    overlays,
    /text\.dataset\.kirinukiUiCopyIgnore = "";[\s\S]{0,420}text\.textContent = displayText \|\| " ";/u,
    "program-monitor caption text must opt out of UI translation"
  );

  const mediaCard = sourceBetween(
    editorMain,
    "function renderMediaCard()",
    "function pruneClipGroupSelection()"
  );
  assert.match(
    mediaCard,
    /elements\.media_name\.(?:toggleAttribute\(\s*"data-kirinuki-ui-copy-ignore"|dataset\.kirinukiUiCopyIgnore\s*=)/u,
    "a user-selected source filename shown in the media card must be guarded"
  );

  const workspaceManager = sourceBetween(
    editorMain,
    "function renderShortWorkspaceProjectManager(): void",
    "function saveCurrentShortWorkspaceHistory()"
  );
  const selectIsGuarded = /id="short-workspace-select"[^>]*data-kirinuki-ui-copy-ignore/u
    .test(editorHtml);
  const optionIsGuarded = /option\.(?:dataset\.kirinukiUiCopyIgnore\s*=|toggleAttribute\(\s*"data-kirinuki-ui-copy-ignore")/u
    .test(workspaceManager);
  const optionHasSourceGuard = /label:\s*`\$\{index \+ 1\}\. \$\{workspace\.name\}`/u
    .test(workspaceManager);
  assert.ok(
    selectIsGuarded || optionIsGuarded || optionHasSourceGuard,
    "user-authored Shorts project names in select options must be guarded"
  );
});

test("언어 변경 경로는 reload·navigation·renderAll·프로젝트 변경을 하지 않는다", async () => {
  const [localizationSource, cutMain, editorMain] = await Promise.all([
    readFile(new URL("../src/lib/ui-localization.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/web/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/editor/main.ts", import.meta.url), "utf8")
  ]);
  const libraryTransition = sourceBetween(
    localizationSource,
    "function applyLanguage(",
    "const observer = new activeWindow.MutationObserver("
  );
  const cutTransition = sourceBetween(
    cutMain,
    "window.addEventListener(UI_LANGUAGE_CHANGE_EVENT, () => {",
    "renderMobileEditorAccess();"
  );
  const editorTransition = sourceBetween(
    editorMain,
    "window.addEventListener(UI_LANGUAGE_CHANGE_EVENT, () => {",
    "void initialize().catch("
  );
  const localeChangePath = [libraryTransition, cutTransition, editorTransition].join("\n");

  assert.doesNotMatch(localeChangePath, /\b(?:window\.)?location\s*\./u);
  assert.doesNotMatch(localeChangePath, /\b(?:reload|replace|assign)\s*\(/u);
  assert.doesNotMatch(localeChangePath, /\brenderAll\s*\(/u);
  assert.doesNotMatch(localeChangePath, /\b(?:project|rootProject)\s*=/u);
  assert.doesNotMatch(
    localeChangePath,
    /\b(?:applyFieldProject|pushHistory|scheduleSave|saveActiveWorkspaceImmediately)\s*\(/u
  );
});
