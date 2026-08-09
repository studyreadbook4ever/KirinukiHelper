import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const editorHtmlUrl = new URL("../extension/editor.html", import.meta.url);
const editorCssUrl = new URL("../extension/editor/editor.css", import.meta.url);
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

test("자막 속성 시트 trigger와 dialog가 접근 가능한 이름·설명을 연결한다", async () => {
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
  assert.match(html, /id="caption-sheet-title">자막 속성 시트<\/h2>/u);
  assert.match(
    html,
    /id="close-caption-sheet-dialog"[\s\S]*?aria-label="자막 속성 시트 닫기"/u
  );
});

test("자막 속성 시트는 본문 입력 없이 속성 비교용 table 의미 구조를 가진다", async () => {
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
    /이 검수 시트는 편집 화면에서만 보이며 영상 출력에는 포함되지 않습니다\./u
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
