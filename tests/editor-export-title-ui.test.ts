import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function read(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, root), "utf8");
}

test("편집기 상단의 장식성 브랜드 문구를 없애고 출력 제목은 내보내기 단계에서 받는다", async () => {
  const webHtml = await read("web/editor.html");

  for (const html of [webHtml]) {
    const topbar = html.match(/<header class="topbar">[\s\S]*?<\/header>/u)?.[0] ?? "";
    assert.doesNotMatch(topbar, /class="brand"|Cut & Caption Studio|CHZZK \+ YOUTUBE \+ SOOP KIRINUKI/u);
    assert.match(topbar, /<input id="project-name" type="hidden"/u);
    assert.doesNotMatch(topbar, /id="project-name" type="text"/u);

    const exportDialog = html.match(/<dialog id="export-options-dialog"[\s\S]*?<\/dialog>/u)?.[0] ?? "";
    assert.match(exportDialog, /<label class="export-title-field" for="export-file-title">[\s\S]*출력 영상 제목/u);
    assert.match(exportDialog, /id="export-file-title"[\s\S]*maxlength="80"[\s\S]*required/u);
    assert.match(exportDialog, /id="export-file-name-preview"/u);
    assert.match(exportDialog, /id="confirm-export-options"[^>]*type="submit"/u);
  }
});

test("사용자가 확인한 출력 제목만 영상·복원 JSON·SRT의 공통 파일명이 된다", async () => {
  const source = await read("src/editor/main.ts");

  assert.match(source, /"export-file-title",\s*"export-file-name-preview"/u);
  assert.match(
    source,
    /function renderExportOutputTitle\(\): string \| null \{[\s\S]*confirm_export_options\.disabled = !valid[\s\S]*sanitizeFileName\(rawTitle\)/u
  );
  assert.match(
    source,
    /function openExportOptionsDialog[\s\S]*export_file_title\.value = suggestedExportOutputTitle\(exportKind\)[\s\S]*export_file_title\.focus[\s\S]*export_file_title\.select/u
  );
  assert.match(
    source,
    /const outputTitle = renderExportOutputTitle\(\)[\s\S]*exportVideoWithLock\(exportKind, outputTitle\)/u
  );
  assert.match(
    source,
    /const options = \{[\s\S]*preparedDirectoryHandle,[\s\S]*destinationSelectionHandled,[\s\S]*outputTitle[\s\S]*\}/u
  );
  assert.match(source, /let baseName = sanitizeFileName\(outputTitle \|\| fallbackOutputTitle\)/u);
  assert.match(source, /`\$\{baseName\}\.kirinuki-session\.json`/u);
  assert.match(source, /`\$\{baseName\}\.ko\.srt`/u);
});
