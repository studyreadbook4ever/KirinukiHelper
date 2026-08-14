import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const editorHtmlUrl = new URL("../web/editor.html", import.meta.url);
const editorCssUrl = new URL("../web/editor/editor.css", import.meta.url);
const editorMainUrl = new URL("../src/editor/main.ts", import.meta.url);

function cssRule(css: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]+)\\}`, "u"));
  assert.ok(match, `${selector} CSS 규칙을 찾을 수 없습니다.`);
  const body = match[1];
  assert.ok(body, `${selector} CSS 규칙 본문이 비어 있습니다.`);
  return body;
}

function assertDeclaration(
  rule: string,
  property: string,
  valuePattern: string
) {
  assert.match(
    rule,
    new RegExp(`${property}\\s*:\\s*${valuePattern}\\s*;`, "u"),
    `${property} 선언이 미리보기 레이아웃 계약과 다릅니다.`
  );
}

function openingTag(html: string, id: string) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(
    new RegExp(`<([a-z][a-z0-9-]*)\\b[^>]*\\bid="${escapedId}"[^>]*>`, "iu")
  );
  assert.ok(match, `#${id} 여는 태그를 찾을 수 없습니다.`);
  return {
    name: match[1],
    source: match[0],
    index: match.index
  };
}

function elementBlock(html: string, tagName: string, id: string) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(
    new RegExp(
      `<${tagName}\\b[^>]*\\bid="${escapedId}"[^>]*>([\\s\\S]*?)<\\/${tagName}>`,
      "iu"
    )
  );
  assert.ok(match, `#${id} ${tagName} 영역을 찾을 수 없습니다.`);
  return match[0];
}

test("미리보기 영상은 원본 종횡비와 무관하게 stage 안에서 contain 된다", async () => {
  const [html, css] = await Promise.all([
    readFile(editorHtmlUrl, "utf8"),
    readFile(editorCssUrl, "utf8")
  ]);
  const stageRule = cssRule(css, ".stage");
  const videoRule = cssRule(css, ".preview-video");

  assert.match(
    html,
    /<video\s+id="preview-video"\s+class="preview-video preview-video-active"/u
  );
  assertDeclaration(stageRule, "position", "relative");
  assertDeclaration(stageRule, "min-height", "0");
  assertDeclaration(stageRule, "overflow", "hidden");

  assertDeclaration(videoRule, "position", "absolute");
  assertDeclaration(videoRule, "inset", "0");
  assertDeclaration(videoRule, "display", "block");
  assertDeclaration(videoRule, "min-width", "0");
  assertDeclaration(videoRule, "min-height", "0");
  assertDeclaration(videoRule, "width", "100%");
  assertDeclaration(videoRule, "height", "100%");
  assertDeclaration(videoRule, "max-width", "100%");
  assertDeclaration(videoRule, "max-height", "100%");
  assertDeclaration(videoRule, "object-fit", "contain");
  assertDeclaration(videoRule, "object-position", "center");
});

test("이미지 에셋 선택선은 미리보기 이미지의 실측 크기를 바꾸지 않는다", async () => {
  const css = await readFile(editorCssUrl, "utf8");
  const overlayRule = cssRule(css, ".image-asset-overlay");
  const selectedRule = cssRule(
    css,
    ".image-asset-overlay:hover,\n.image-asset-overlay.selected"
  );

  assertDeclaration(overlayRule, "border", "0");
  assertDeclaration(selectedRule, "outline", "1px solid #64b5ff");
  assertDeclaration(selectedRule, "outline-offset", "-1px");
});

test("편집기 chrome은 장식 문구와 중복 상태 표시를 없애고 저장 상태를 의미로 노출한다", async () => {
  const [html, css, main] = await Promise.all([
    readFile(editorHtmlUrl, "utf8"),
    readFile(editorCssUrl, "utf8"),
    readFile(editorMainUrl, "utf8")
  ]);

  assert.doesNotMatch(
    html,
    /DESKTOP EDITOR|PER-USE POLICY REQUIRED|LONG-FORM → SHORTS SOURCE|CAPTION STYLE REVIEW|LOCAL RECOVERY|LOCAL MEDIA JOB/u
  );
  assert.doesNotMatch(html, /class="spark"|id="selection-lock"/u);
  assert.doesNotMatch(css, /content:\s*"ADVERTISEMENT"|\.spark\b|\.locked-label\b/u);
  assert.match(html, /id="exit-short-form"[^>]*aria-label="본편 편집으로 돌아가기"[\s\S]*본편 편집으로/u);
  assert.match(html, /id="create-local-draft"[\s\S]*지금 저장/u);
  assert.match(html, /id="open-local-drafts"[\s\S]*저장본 목록/u);
  assert.match(main, /local_draft_status\.dataset\.state = state/u);
  assert.match(main, /state === "saved"[\s\S]*자동 저장됨/u);
});

test("자막 스타일 비교 trigger와 dialog가 접근 가능한 이름·설명을 연결한다", async () => {
  const html = await readFile(editorHtmlUrl, "utf8");
  const trigger = openingTag(html, "open-caption-sheet");
  const dialog = openingTag(html, "caption-sheet-dialog");
  const inspectorTabs = openingTag(html, "cue-selected-tab");

  assert.equal(trigger.name, "button");
  assert.match(trigger.source, /\btype="button"/u);
  assert.match(trigger.source, /\baria-haspopup="dialog"/u);
  assert.match(trigger.source, /\baria-controls="caption-sheet-dialog"/u);
  assert.ok(
    trigger.index !== undefined
      && inspectorTabs.index !== undefined
      && trigger.index < inspectorTabs.index,
    "자막 속성 시트 trigger는 기존 자막 보기 tabs보다 앞에 있어야 합니다."
  );

  assert.equal(dialog.name, "dialog");
  assert.match(dialog.source, /\baria-labelledby="caption-sheet-title"/u);
  assert.match(dialog.source, /\baria-describedby="caption-sheet-description"/u);
  assert.match(html, /id="caption-sheet-title">자막 스타일 비교<\/h2>/u);
  assert.match(
    html,
    /id="close-caption-sheet-dialog"[\s\S]*?aria-label="자막 스타일 비교 닫기"/u
  );
});

test("자막 위치는 프리셋 버튼 없이 직접 이동과 좌표 슬라이더만 제공한다", async () => {
  const [html, css, main] = await Promise.all([
    readFile(editorHtmlUrl, "utf8"),
    readFile(editorCssUrl, "utf8"),
    readFile(editorMainUrl, "utf8")
  ]);

  assert.doesNotMatch(html, /data-position=(?:"|')/u);
  assert.doesNotMatch(html, /class=(?:"|')[^"']*position-grid/u);
  assert.doesNotMatch(css, /\.position-grid\b/u);
  assert.doesNotMatch(main, /\bpositionButtons\b/u);
  assert.match(html, /id="cue-x"[^>]*type="range"/u);
  assert.match(html, /id="cue-y"[^>]*type="range"/u);
  assert.match(
    html,
    /영상 위 자막을 직접 끌어서 원하는 곳에 놓을 수 있습니다\./u
  );
});

test("쇼츠 속성과 타임라인은 영상·이미지·자막·음성 설정 순서이고 본편 순서는 유지한다", async () => {
  const [html, css, main] = await Promise.all([
    readFile(editorHtmlUrl, "utf8"),
    readFile(editorCssUrl, "utf8"),
    readFile(editorMainUrl, "utf8")
  ]);

  assert.match(
    html,
    /id="short-framing-mode-tab"[^>]*>영상<\/button>/u
  );
  assert.match(html, /class="main-workspace-copy">이미지<\/span>/u);
  assert.match(html, /class="short-form-workspace-copy">이미지<\/span>/u);
  assert.match(
    html,
    /class="short-form-workspace-copy">영상 · 이미지 · 자막 · 음성 설정<\/span>/u
  );
  assert.doesNotMatch(html, /A\/V 영상/u);
  assert.match(
    html,
    /class="main-workspace-copy">영상 · 이미지 · 음성 · 자막<\/span>/u
  );

  for (const [id, order] of [
    ["short-framing-mode-tab", 1],
    ["asset-mode-tab", 2],
    ["caption-mode-tab", 3],
    ["audio-mode-tab", 4]
  ] as const) {
    assert.match(
      css,
      new RegExp(
        `\\.editor-shell\\[data-workspace="short-form"\\] #${id}\\s*\\{[^}]*order:\\s*${order};`,
        "u"
      )
    );
  }

  assert.match(
    main,
    /function renderWorkspaceModeChrome\(\)[\s\S]*propertyTabList\.append\([\s\S]*shortActive[\s\S]*short_framing_mode_tab,[\s\S]*asset_mode_tab,[\s\S]*caption_mode_tab,[\s\S]*audio_mode_tab[\s\S]*caption_mode_tab,[\s\S]*asset_mode_tab,[\s\S]*audio_mode_tab,[\s\S]*short_framing_mode_tab/u,
    "화면 모드가 바뀔 때 tab의 실제 DOM·스크린리더 순서도 시각 순서와 같아야 합니다."
  );

  assert.match(
    css,
    /\.editor-shell\[data-workspace="short-form"\] \.caption-track-label,[\s\S]*?\.editor-shell\[data-workspace="short-form"\] \.caption-tracks\s*\{\s*grid-row:\s*4;/u
  );
  assert.match(
    css,
    /\.editor-shell\[data-workspace="short-form"\] \.audio-track-label,[\s\S]*?\.editor-shell\[data-workspace="short-form"\] \.audio-track\s*\{\s*grid-row:\s*5;/u
  );
});

test("속성 tab은 각 panel과 양방향으로 연결되고 쇼츠에서 스크롤 위에 고정된다", async () => {
  const [html, css] = await Promise.all([
    readFile(editorHtmlUrl, "utf8"),
    readFile(editorCssUrl, "utf8")
  ]);
  for (const [tabId, panelId] of [
    ["caption-mode-tab", "caption-inspector-content"],
    ["asset-mode-tab", "asset-inspector-content"],
    ["audio-mode-tab", "audio-inspector-content"],
    ["short-framing-mode-tab", "short-framing-inspector-content"]
  ] as const) {
    const tab = openingTag(html, tabId);
    const panel = openingTag(html, panelId);
    assert.match(tab.source, /\brole="tab"/u);
    assert.match(
      tab.source,
      new RegExp(`\\baria-controls="${panelId}"`, "u")
    );
    assert.match(panel.source, /\brole="tabpanel"/u);
    assert.match(
      panel.source,
      new RegExp(`\\baria-labelledby="${tabId}"`, "u")
    );
  }

  const stickyTabs = cssRule(
    css,
    '.editor-shell[data-workspace="short-form"] .property-mode-tabs'
  );
  assertDeclaration(stickyTabs, "position", "sticky");
  assertDeclaration(stickyTabs, "top", "-1px");
  assertDeclaration(stickyTabs, "z-index", "18");
});

test("타임라인은 의미가 연결된 버튼으로 접고 레이아웃·overlay를 다시 맞춘다", async () => {
  const [html, css, main] = await Promise.all([
    readFile(editorHtmlUrl, "utf8"),
    readFile(editorCssUrl, "utf8"),
    readFile(editorMainUrl, "utf8")
  ]);
  const toggle = openingTag(html, "toggle-timeline-collapse");
  const grid = openingTag(html, "timeline-grid");

  assert.equal(toggle.name, "button");
  assert.match(toggle.source, /\btype="button"/u);
  assert.match(toggle.source, /\baria-expanded="true"/u);
  assert.match(toggle.source, /\baria-controls="timeline-grid"/u);
  assert.match(toggle.source, /\btitle="타임라인 접기"/u);
  assert.equal(grid.name, "div");
  assert.match(html, /id="toggle-timeline-collapse"[^>]*>접기<\/button>/u);
  assert.match(
    css,
    /\.editor-shell\[data-timeline-collapsed="true"\] \.workspace,\s*\.editor-shell\[data-workspace="short-form"\]\[data-timeline-collapsed="true"\] \.workspace\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\) 43px;/u,
    "접힌 타임라인은 제목줄만 남기고 미리보기 높이를 돌려줘야 합니다."
  );
  assert.match(
    main,
    /function renderTimelineCollapseState\(\): void \{[\s\S]*dataset\.timelineCollapsed = String\(timelineCollapsed\)[\s\S]*timeline_grid\.hidden = timelineCollapsed[\s\S]*"aria-expanded",[\s\S]*String\(!timelineCollapsed\)[\s\S]*timelineCollapsed[\s\S]*\? "펼치기"[\s\S]*: "접기"[\s\S]*\? "타임라인 펼치기"[\s\S]*: "타임라인 접기"/u,
    "접기 상태는 DOM visibility와 접근성 상태·문구를 한 번에 동기화해야 합니다."
  );
  assert.match(
    main,
    /function renderAfterWorkspaceLayoutChange\(\): void \{[\s\S]*requestAnimationFrame[\s\S]*renderTimeline\(\{ keepScroll: true \}\)[\s\S]*renderImageAssetOverlays\(\)[\s\S]*renderSubtitleOverlay\(\)[\s\S]*renderShortWorkspaceTransformOverlay\(\)[\s\S]*scheduleShortWorkspacePreview\(\)/u,
    "접은 뒤 타임라인과 모든 편집 overlay를 새 크기에 맞춰 다시 그려야 합니다."
  );
  assert.match(
    main,
    /toggle_timeline_collapse\.addEventListener\("click"[\s\S]*timelineCollapsed = !timelineCollapsed[\s\S]*renderTimelineCollapseState\(\)[\s\S]*renderAfterWorkspaceLayoutChange\(\)/u
  );
});

test("쇼츠 내보내기 label은 기존 문구 text node만 교체한다", async () => {
  const main = await readFile(editorMainUrl, "utf8");

  assert.match(
    main,
    /\.find\(\(node\) => \(\s*node\.nodeType === Node\.TEXT_NODE\s*&& Boolean\(node\.textContent\?\.trim\(\)\)\s*\)\);/u,
    "SVG 앞 들여쓰기 text node가 아니라 기존 내보내기 문구를 찾아야 합니다."
  );
});

test("새 자막 입력은 실제 편집칸을 드러낸 뒤 입력 focus를 유지한다", async () => {
  const main = await readFile(editorMainUrl, "utf8");

  assert.match(
    main,
    /function addCueAtPlayhead[\s\S]*?applyProject\([\s\S]*?revealSelectedPropertyEditor\(\);\s*elements\.cue_text\.focus\(\{ preventScroll: true \}\);\s*elements\.cue_text\.select\(\);/u,
    "새 cue를 만들면 긴 inspector 속 실제 본문 칸을 보여 주고 즉시 입력할 수 있어야 합니다."
  );
  assert.match(
    main,
    /function revealPropertyInspectorTarget[\s\S]*?stickyOffset[\s\S]*?inspector\.scrollTo\(\{[\s\S]*?behavior: "smooth"/u,
    "고정된 속성 tabs 아래로 선택 편집칸을 부드럽게 노출해야 합니다."
  );
  assert.doesNotMatch(
    main,
    /elements\.cue_text\.focus\(\);/u,
    "스크롤을 일으키는 기본 focus 호출을 다시 사용하면 안 됩니다."
  );
});

test("본편과 쇼츠 전환은 새 mode의 inspector 시작점을 보여 준다", async () => {
  const main = await readFile(editorMainUrl, "utf8");

  assert.match(
    main,
    /function resetPropertyInspectorScroll\(\): void \{[\s\S]*?elements\.inspector_title\.closest\("\.inspector"\)[\s\S]*?inspector\.scrollTop = 0;/u
  );
  assert.match(
    main,
    /async function enterShortFormWorkspace[\s\S]*?await seekTimeline\(project\.playheadMs \|\| 0\);[\s\S]*?resetPropertyInspectorScroll\(\);[\s\S]*?elements\.exit_short_form\.focus/u,
    "쇼츠 진입 완료 뒤 framing inspector 시작점을 보여 줘야 합니다."
  );
  assert.match(
    main,
    /async function exitShortFormWorkspace[\s\S]*?await seekTimeline\(project\.playheadMs \|\| 0\);[\s\S]*?resetPropertyInspectorScroll\(\);[\s\S]*?elements\.open_short_form\.focus/u,
    "본편 복귀 완료 뒤 caption inspector 시작점을 보여 줘야 합니다."
  );
});

test("낮고 좁은 데스크톱에서도 상단과 타임라인을 잘라내지 않는다", async () => {
  const css = await readFile(editorCssUrl, "utf8");
  const topbarRule = cssRule(css, ".topbar");

  assertDeclaration(topbarRule, "grid-template-columns", "auto max-content");
  assert.doesNotMatch(css, /\.brand(?:-symbol)?\s*\{/u);
  assertDeclaration(cssRule(css, ".editor-brand-slot"), "width", "100px");
  assert.match(css, /\.editor-leaderboard-ad-slot\s*\{\s*width:\s*728px;/u);
  assert.match(
    css,
    /\.editor-brand-slot,\s*\.editor-leaderboard-ad-slot\s*\{[^}]*height:\s*90px;/u
  );
  assert.match(
    css,
    /@media \(max-height: 820px\)\s*\{\s*\.workspace\s*\{\s*grid-template-rows:\s*minmax\(0, 1fr\) 260px;/u,
    "일반 노트북 높이에서는 timeline을 내부 scroll 가능한 높이로 줄여 preview를 키워야 합니다."
  );
  assert.match(
    css,
    /@media \(max-height: 820px\)[\s\S]*?\.editor-shell\[data-workspace="short-form"\] \.workspace\s*\{\s*grid-template-rows:\s*minmax\(340px, 48%\) minmax\(0, 52%\);/u,
    "낮은 쇼츠 화면에서는 캔버스를 읽을 높이와 7행 타임라인 scroll 공간을 함께 확보해야 합니다."
  );
  assert.match(
    css,
    /@media \(max-height: 704px\)\s*\{\s*\.workspace\s*\{\s*grid-template-rows:\s*minmax\(0, 60%\) minmax\(0, 40%\);/u,
    "낮은 화면에서는 workspace 두 행이 가용 높이 안에서 함께 줄어야 합니다."
  );
  assert.match(
    css,
    /\.editor-shell\[data-workspace="short-form"\] \.workspace\s*\{[\s\S]*?grid-template-rows:\s*minmax\(220px, 1fr\)\s*var\(--short-form-default-timeline-panel-height\);/u,
    "일반 화면에서는 캔버스와 7행 쇼츠 timeline의 최소 높이를 함께 보장해야 합니다."
  );
  assert.match(
    css,
    /@media \(max-height: 731px\)[\s\S]*?\.editor-shell\[data-workspace="short-form"\] \.workspace\s*\{\s*grid-template-rows:\s*minmax\(220px, 42%\) minmax\(0, 58%\);/u,
    "7행 고정 높이를 물리적으로 담을 수 없는 화면에서는 viewport 안의 내부 scroll로 전환해야 합니다."
  );
  assert.doesNotMatch(css, /\.timeline-title \.overline/u);
  assert.match(
    css,
    /@media \(max-width: 1449px\)\s*\{\s*body\s*\{\s*overflow:\s*auto;/u,
    "최소 940px인 workspace보다 좁은 901~939px 구간도 가로 이동할 수 있어야 합니다."
  );
  assert.match(
    css,
    /(?:^|\n)\.button\s*\{[^}]*white-space:\s*nowrap;/u,
    "상단 핵심 button label은 한 줄이어야 합니다."
  );
  assertDeclaration(
    cssRule(css, ".local-draft-button"),
    "white-space",
    "nowrap"
  );
  assert.doesNotMatch(
    css,
    /\.top-actions[^}]*font-size:\s*0|\.top-actions[^}]*width:\s*38px/gu,
    "좁은 데스크톱에서도 상단 버튼 문구와 기존 크기를 유지해야 합니다."
  );
  assert.match(
    css,
    /@media \(max-width: 1449px\)\s*\{[\s\S]*?body\s*\{\s*overflow:\s*auto;[\s\S]*?\.editor-shell\s*\{\s*min-width:\s*1450px;/u,
    "좁은 데스크톱은 모바일로 차단하거나 버튼을 축소하지 않고 가로 이동을 허용해야 합니다."
  );
});

test("자막 스타일 비교는 본문 입력 없이 속성 비교용 table 의미 구조를 가진다", async () => {
  const html = await readFile(editorHtmlUrl, "utf8");
  const dialog = elementBlock(html, "dialog", "caption-sheet-dialog");
  const table = elementBlock(dialog, "table", "caption-sheet-table");
  const headers = [...table.matchAll(/<th\s+scope="col">([^<]+)<\/th>/gu)]
    .map((match) => match[1]?.trim());

  assert.deepEqual(headers, [
    "자막",
    "컷",
    "시작 시각",
    "레인",
    "위치 X/Y",
    "설정 크기",
    "글자색",
    "검은 상자",
    "설정 묶음"
  ]);
  assert.match(
    table,
    /<caption>자막 문구를 제외한 자막별 스타일 설정 비교표<\/caption>/u
  );
  assert.match(table, /<tbody id="caption-sheet-body"><\/tbody>/u);
  assert.match(dialog, /id="caption-sheet-summary"[^>]*role="status"/u);
  assert.match(dialog, /id="caption-sheet-common-style"/u);
  assert.match(dialog, /id="caption-sheet-empty"/u);
  assert.match(
    dialog,
    /이 비교표는 편집 화면에서만 보이며 영상 출력에는 포함되지 않습니다\./u
  );
  assert.match(
    dialog,
    /출력 중인 자막의 행 번호를 누르면 해당 자막 편집기로 이동합니다\./u
  );
  assert.match(dialog, /확정된 오류가 아닙니다\./u);
  assert.doesNotMatch(
    dialog,
    /<(?:textarea|input)\b|\bcontenteditable=/iu,
    "속성 시트에 자막 본문을 담거나 편집하는 정적 slot이 있으면 안 됩니다."
  );
});

test("자막 속성 시트는 넓은 양방향 scroll·고정 header와 첫 열·명확한 focus를 보장한다", async () => {
  const css = await readFile(editorCssUrl, "utf8");
  const dialogRule = cssRule(css, ".caption-sheet-dialog");
  const scrollRule = cssRule(css, ".caption-sheet-scroll-region");
  const tableRule = cssRule(css, ".caption-sheet-table");
  const headerRule = cssRule(css, ".caption-sheet-table thead th");
  const firstColumnRule = cssRule(css, ".caption-sheet-table tr > :first-child");
  const swatchRule = cssRule(css, ".caption-sheet-color-swatch");

  assertDeclaration(
    dialogRule,
    "width",
    "min\\(1080px,\\s*calc\\(100vw\\s*-\\s*32px\\)\\)"
  );
  assertDeclaration(dialogRule, "max-width", "none");
  assertDeclaration(dialogRule, "overflow", "hidden");
  assertDeclaration(scrollRule, "overflow", "auto");
  assertDeclaration(scrollRule, "overscroll-behavior", "contain");
  assertDeclaration(scrollRule, "scrollbar-gutter", "stable both-edges");
  assertDeclaration(tableRule, "min-width", "1020px");
  assertDeclaration(tableRule, "border-collapse", "separate");
  assertDeclaration(headerRule, "position", "sticky");
  assertDeclaration(headerRule, "top", "0");
  assertDeclaration(firstColumnRule, "position", "sticky");
  assertDeclaration(firstColumnRule, "left", "0");
  assertDeclaration(
    swatchRule,
    "background",
    "var\\(--caption-sheet-color,\\s*#ffffff\\)"
  );
  assert.match(
    css,
    /\.caption-sheet-cue-button:focus-visible,\s*#close-caption-sheet-dialog:focus-visible,\s*\.caption-sheet-scroll-region:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--mint\)\s*;/u,
    "시트의 행 이동·닫기·scroll controls에 명확한 keyboard focus가 필요합니다."
  );
  for (const badge of [
    "caption-sheet-source-badge",
    "caption-sheet-variation-badge",
    "caption-sheet-group-badge",
    "caption-sheet-singleton-badge"
  ]) {
    assert.match(css, new RegExp(`\\.${badge}\\b`, "u"));
  }
});

test("자막 속성 시트 행 header와 출력 제외 이동은 fail closed한다", async () => {
  const main = await readFile(editorMainUrl, "utf8");

  assert.match(
    main,
    /const cueCell = document\.createElement\("th"\);\s*cueCell\.scope = "row";/u,
    "시트 첫 열은 각 행을 식별하는 scope=row header여야 합니다."
  );
  assert.match(
    main,
    /cueButton\.disabled = !row\.outputEnabled;/u,
    "출력 제외 자막은 null timeline range로 이동할 수 없어야 합니다."
  );
  assert.match(
    main,
    /const activeRange = cueTimelineRange\(project, cue\);\s*if \(!activeRange\) \{[\s\S]*?return;\s*\}\s*closeCaptionPropertiesSheet/u,
    "programmatic click도 출력 제외 자막을 선택하기 전에 fail closed해야 합니다."
  );
});
