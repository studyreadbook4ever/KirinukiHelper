import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function studioSources(): Promise<{
  html: string;
  css: string;
  source: string;
}> {
  const [html, css, source] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../web/studio.css", import.meta.url), "utf8"),
    readFile(new URL("../src/web/main.ts", import.meta.url), "utf8")
  ]);
  return { html, css, source };
}

test("공개 웹이 URL 입력·PR16 컷 좌표·전체 편집 진입을 모두 소유한다", async () => {
  const { html, source } = await studioSources();
  assert.match(html, /id="source-url"[^>]*type="url"/u);
  assert.match(html, /id="stream-preview-frame"/u);
  assert.match(html, /id="stream-preview-video"/u);
  assert.match(html, /id="stream-cut-console"[\s\S]*id="clip-list"/u);
  assert.match(html, /id="start-editor"[^>]*aria-keyshortcuts="A"/u);
  assert.match(source, /setDocumentSurface\("local"\)/u);
  assert.match(source, /installStudioCaptureConsole\(\)/u);
  assert.doesNotMatch(
    `${html}\n${source}`,
    /kirinuki-engine:\/\/cut|cut-host|kirinukiCutHost|BrowserWindow|editor-handoff|StreamingBridgeClient/u
  );
});

test("원본과 구간 rail은 PR16처럼 한 화면에 나란히 있고 직접 입력도 유지한다", async () => {
  const { html, css } = await studioSources();
  const workspace = html.indexOf('class="source-capture-workspace"');
  const stream = html.indexOf('class="stream-preview"', workspace);
  const rail = html.indexOf('class="selection-rail"', workspace);
  assert.ok(workspace >= 0 && stream > workspace && rail > stream);
  assert.match(
    css,
    /\.source-capture-workspace \{[^}]*grid-template-columns: minmax\(720px, 2fr\) minmax\(420px, \.9fr\)/u
  );
  assert.match(css, /\.clip-list \{[^}]*overflow-y: auto/u);
  assert.match(html, /data-field="start"[^>]*inputmode="decimal"/u);
  assert.match(html, /data-field="end"[^>]*inputmode="decimal"/u);
  assert.match(html, /data-field="note"/u);
});

test("복원 JSON은 서버 업로드 없이 검증 후 원본·구간만 원자 교체한다", async () => {
  const { html, source } = await studioSources();
  assert.match(html, /id="session-archive-input"[^>]*type="file"[^>]*hidden/u);
  assert.match(source, /file\.size > SESSION_ARCHIVE_MAX_JSON_BYTES/u);
  assert.match(source, /sessionArchiveCaptureFromJson\(await file\.text\(\)\)/u);
  assert.match(
    source,
    /const importedRows = imported\.segments\.map[\s\S]*elements\.clipList\.replaceChildren\(\.\.\.importedRows\)/u
  );
  assert.doesNotMatch(source, /fetch\([^)]*session-archive/iu);
});

test("매 사용 권리 확인은 여섯 항목이며 개인정보·오픈소스 경계를 설명한다", async () => {
  const { html, source } = await studioSources();
  assert.equal((html.match(/data-ack/gu) || []).length, 6);
  assert.match(html, /허용된 VOD에만 사용하세요/u);
  assert.match(html, /사용기록과 개인정보를 일절 수집하지 않으며/u);
  assert.match(html, /href="mailto:lostfragment@naver\.com"/u);
  assert.match(html, /https:\/\/github\.com\/studyreadbook4ever\/KirinukiHelper/u);
  assert.match(source, /allAcknowledgementsChecked\(\)[\s\S]*createPerUseConfirmationAttestation/u);
  assert.doesNotMatch(html, /name="basis"|id="evidence-fields"|id="confirmation-text"/u);
});

test("초기 컷은 도우미 없이도 진행하고 연결 시 단축키를 확장한 뒤 같은 탭 편집기로 이동한다", async () => {
  const { html, source } = await studioSources();
  assert.match(html, /도우미 없이 플레이어 시각을 시작·끝 칸에 직접 입력해도 됩니다/u);
  assert.match(html, /id="source-capture-workspace"[^>]*hidden/u);
  assert.match(html, /id="recent-section"[^>]*hidden/u);
  assert.match(html, /id="cut-preparation-progress"[\s\S]*도우미는 별도 창을 열지 않습니다/u);
  assert.match(source, /case "refresh-source":[\s\S]*reloadActivePlayerFrame\(\)[\s\S]*prepareLocalPreview/u);
  assert.match(source, /configureHelperDownload[\s\S]*monitorHelperDownloadConnection/u);
  const prepare = source.indexOf("await prepareSelectedVodForEditor(");
  const begin = source.indexOf("await beginWebEditorSession({", prepare);
  const navigate = source.indexOf("location.assign(session.editorUrl);", begin);
  assert.ok(prepare >= 0 && begin > prepare && navigate > begin);
});

test("저장된 편집은 새 편집과 분리하고 명시적으로 계속·복구·삭제한다", async () => {
  const { html, source } = await studioSources();
  for (const action of ["continue", "recover", "delete"]) {
    assert.match(html, new RegExp(`data-project-action="${action}"`, "u"));
  }
  assert.match(source, /let localPreviewProjectId = createFreshEditorProjectId\(\)/u);
  assert.match(source, /항상 별도의 새 편집을 만들며 기존 저장본과 섞지 않습니다/u);
  assert.match(
    source,
    /case "continue":[\s\S]*showResumePolicy\(entry\.project\)[\s\S]*case "recover":[\s\S]*showResumePolicy\(entry\.project, \{ recoveryDrafts: true \}\)/u
  );
  assert.match(
    source,
    /runWithExclusiveStudioProjectCollectionAccess\([\s\S]*deleteAllProjectSessionsAtomically\(\)/u
  );
});

test("닫힌 writer 정리는 focus·pageshow·visibility 복귀에 멱등적으로 재실행된다", async () => {
  const { source } = await studioSources();
  assert.match(source, /createLatestSerialOperationQueue\(\)/u);
  assert.match(source, /createCoalescedAutomaticOperation\(/u);
  assert.match(source, /window\.addEventListener\("focus", scheduleLocalProjectLifecycleRefresh\)/u);
  assert.match(
    source,
    /window\.addEventListener\("pageshow"[\s\S]*clearCurrentTabWebEditorSession\(\)[\s\S]*requestAutomaticLocalProjectLifecycleCleanup\(\)/u
  );
  assert.match(
    source,
    /document\.addEventListener\("visibilitychange"[\s\S]*scheduleLocalProjectLifecycleRefresh\(\)/u
  );
  assert.match(source, /await requireSafeLocalProjectStateForEditorEntry\(\)/u);
});

test("첫 방문 도우미 안내는 다운로드·설치·연결과 진행 상태를 웹에서 설명한다", async () => {
  const [indexHtml, editorHtml, onboarding] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../web/editor.html", import.meta.url), "utf8"),
    readFile(
      new URL("../src/editor/local-media-engine-onboarding.ts", import.meta.url),
      "utf8"
    )
  ]);
  for (const html of [indexHtml, editorHtml]) {
    assert.match(html, /Linux 도우미 받기[\s\S]*다운로드가 끝나면 설치[\s\S]*이 화면에서 자동 연결/u);
    assert.match(html, /id="local-media-engine-status"[^>]*aria-live="polite"/u);
    assert.match(html, /id="local-media-engine-download-note"[\s\S]*실제 파일 진행률은 브라우저/u);
    assert.match(html, /id="local-media-engine-source-offer"[^>]*hidden[^>]*>Linux 미리보기 소스·라이선스 안내/u);
    assert.doesNotMatch(html, /localhost|포트 번호|터미널에서/u);
  }
  assert.match(onboarding, /download[\s\S]*install[\s\S]*connect/iu);
});

test("공개 정적 산출물은 loopback 엔진만 연결하고 강제 보안 헤더를 유지한다", async () => {
  const [html, editorHtml, headers, hosts] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../web/editor.html", import.meta.url), "utf8"),
    readFile(new URL("../web/_headers", import.meta.url), "utf8"),
    readFile(new URL("../web/.popovic-hosts", import.meta.url), "utf8")
  ]);
  assert.equal(hosts, "kirinuki.eff0rtchung.kr\n");
  for (const document of [html, editorHtml]) {
    assert.match(document, /http:\/\/127\.0\.0\.1:4319/u);
    assert.doesNotMatch(document, /chrome-extension:\/\/|kirinuki-engine:\/\/cut/u);
  }
  for (const marker of [
    "frame-ancestors 'none'",
    "X-Content-Type-Options: nosniff",
    "X-Frame-Options: DENY",
    "Cross-Origin-Opener-Policy: same-origin",
    "Cross-Origin-Resource-Policy: same-origin"
  ]) {
    assert.ok(headers.includes(marker), `공개 보안 헤더 누락: ${marker}`);
  }
});
