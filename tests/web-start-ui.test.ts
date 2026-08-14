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

test("PC 시작 화면은 넓은 원본 영역 오른쪽에 스크롤 가능한 구간 rail을 둔다", async () => {
  const { html, css } = await studioSources();
  const workspace = html.indexOf('class="source-capture-workspace"');
  const stream = html.indexOf('class="stream-preview"', workspace);
  const rail = html.indexOf('class="selection-rail"', workspace);
  const policy = html.indexOf('id="policy-section"', workspace);
  assert(workspace >= 0 && stream > workspace && rail > stream && policy > rail);
  assert.match(css, /main \{ width: min\(1560px, calc\(100% - 40px\)\)/u);
  assert.match(
    css,
    /\.source-capture-workspace \{[^}]*grid-template-columns: minmax\(720px, 2fr\) minmax\(420px, \.9fr\)/u
  );
  assert.match(
    css,
    /\.clip-list \{[^}]*overflow-y: auto[^}]*scrollbar-gutter: stable[^}]*overscroll-behavior: contain/u
  );
  assert.match(
    css,
    /\.stream-cut-buttons button \{[^}]*min-height: 38px[^}]*inline-flex/u
  );
  assert.match(
    css,
    /\.clip-row \.clip-start input, \.clip-row \.clip-end input \{[^}]*ui-monospace[^}]*tabular-nums[^}]*text-overflow: clip/u
  );
});

test("복원 JSON 선택은 서버 업로드 없이 검증 성공 뒤 원본과 구간만 원자 교체한다", async () => {
  const { html, source } = await studioSources();
  assert.match(html, /id="import-session-archive"/u);
  assert.match(
    html,
    /id="session-archive-input"[^>]*type="file"[^>]*accept="application\/json,\.json"[^>]*hidden/u
  );
  assert.match(source, /file\.size > SESSION_ARCHIVE_MAX_JSON_BYTES/u);
  assert.match(source, /sessionArchiveCaptureFromJson\(await file\.text\(\)\)/u);
  assert.match(
    source,
    /const importedRows = imported\.segments\.map[\s\S]*elements\.clipList\.replaceChildren\(\.\.\.importedRows\)/u
  );
  assert.match(source, /clearResumeMode\(\)[\s\S]*elements\.sourceUrl\.value = imported\.sourceUrl/u);
  assert.doesNotMatch(source, /fetch\([^)]*session-archive/iu);
});

test("매 사용 정책은 근거 입력·문구 타이핑 없이 여섯 확인과 신뢰 안내만 요구한다", async () => {
  const { html, source } = await studioSources();
  assert.equal((html.match(/data-ack/gu) || []).length, 6);
  assert.doesNotMatch(html, /name="basis"|id="evidence-fields"|id="confirmation-text"/u);
  assert.match(html, /허용된 VOD에만 사용하세요/u);
  assert.match(html, /사용기록과 개인정보를 일절 수집하지 않으며/u);
  assert.match(
    html,
    /원본 미리보기와 구간 준비는 브라우저와 이 PC에서 직접 처리되며,[\s\S]*선택한 플랫폼의 개인정보 처리방침과 이용 정책이 적용됩니다/u
  );
  assert.match(html, /href="mailto:lostfragment@naver\.com"/u);
  assert.match(html, /이 프로젝트는 오픈소스입니다:/u);
  assert.match(
    html,
    /class="github-link"[^>]*href="https:\/\/github\.com\/studyreadbook4ever\/KirinukiHelper"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/u
  );
  assert.doesNotMatch(html, /github-placeholder|GitHub 링크 준비 중/u);
  assert.match(source, /allAcknowledgementsChecked\(\)[\s\S]*createPerUseConfirmationAttestation/u);
  assert.doesNotMatch(source, /selectedBasis|updatePolicyEvidenceFields|confirmationText\.value/u);
});

test("컷 단계는 client-only 스트리밍 제어만 쓰고 편집 미디어 준비는 editor 진입 뒤로 미룬다", async () => {
  const { html, source } = await studioSources();
  assert.match(
    html,
    /VOD에서 편집할 구간을 선택하세요[\s\S]*편집기를 열 때 선택한 구간만 이 PC에 준비합니다/u
  );
  assert.match(html, /id="stream-preview-frame"/u);
  assert.match(html, /이 화면에서는 영상을 내려받지 않습니다/u);
  assert.doesNotMatch(
    html,
    /local-preview-video|local-preview-anchor|prepare-local-preview/u
  );
  assert.match(source, /new StreamingBridgeClient\(\{/u);
  assert.match(
    source,
    /runTransientSafeStreamingAction[\s\S]*client\.snapshot\(\)/u
  );
  assert.match(source, /client\.seekAbsolute\(/u);
  assert.match(source, /client\.setPlaybackRate\(/u);
  assert.doesNotMatch(
    source,
    /LOCAL_VOD_COMPANION_ENDPOINT|startChzzkVodMaterialization|waitForChzzkVodMaterialization|localPreviewVideo/u
  );
  assert.match(
    source,
    /const session = await beginWebEditorSession\([\s\S]*location\.assign\(session\.editorUrl\)/u
  );
  assert.doesNotMatch(source, /navigator\.storage\??\.persist|storage\.persist\(/u);
  assert.match(source, /if \(!allAcknowledgementsChecked\(\)\)[\s\S]*focusFirstMissingAcknowledgement\(\)/u);
});

test("새 편집은 같은 VOD의 저장본과 분리하고 기존 편집은 목록에서만 명시적으로 연다", async () => {
  const { html, source } = await studioSources();
  for (const id of [
    "recent-section",
    "local-projects-list",
    "refresh-local-projects",
    "clear-all-local-projects",
    "local-project-row-template",
    "local-project-delete-dialog"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`, "u"));
  }
  for (const action of ["continue", "recover", "delete"]) {
    assert.match(html, new RegExp(`data-project-action="${action}"`, "u"));
  }
  assert.match(
    source,
    /captureSeed = currentCaptureState\(\);[\s\S]*const projectId = createFreshEditorProjectId\(\);/u
  );
  assert.doesNotMatch(
    source,
    /captureSeed = currentCaptureState\(\);[\s\S]{0,160}captureProjectId\(captureSeed\)/u
  );
  assert.match(source, /항상 별도의 새 편집을 만들며 기존 저장본과 섞지 않습니다/u);
  assert.match(
    source,
    /data-project-action[\s\S]*case "continue":[\s\S]*showResumePolicy\(entry\.project\)[\s\S]*case "recover":[\s\S]*showResumePolicy\(entry\.project, \{ recoveryDrafts: true \}\)/u
  );
  assert.match(
    source,
    /function showResumePolicy[\s\S]*#policy-section \[data-ack\][\s\S]*focus\(\{ preventScroll: true \}\)/u
  );
});

test("시작 화면은 writer가 없는 미확정 작업만 rollback하고 열린 탭은 잠근다", async () => {
  const { html, source } = await studioSources();
  assert.match(html, /class="local-project-active-session"[^>]*hidden>다른 탭에서 편집 중/u);
  const refreshStart = source.indexOf("async function refreshLocalProjectManager(");
  const refreshEnd = source.indexOf("function migratedLatestProjectId(", refreshStart);
  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart);
  const refresh = source.slice(refreshStart, refreshEnd);
  const inventoryIndex = refresh.indexOf("listEditingSessionCheckpointProjectIds()");
  const lockIndex = refresh.indexOf("runWithExclusiveStudioProjectAccess(");
  const rollbackIndex = refresh.indexOf("discardAbandonedEditingSessionCheckpoint(projectId)");
  const projectListIndex = refresh.indexOf("listProjects()");
  assert.ok(inventoryIndex >= 0);
  assert.ok(lockIndex > inventoryIndex);
  assert.ok(rollbackIndex > lockIndex);
  assert.ok(projectListIndex > rollbackIndex);
  assert.match(refresh, /hasOpenEditingSession: openEditingProjectIds\.has\(project\.id\)/u);
  assert.match(
    source,
    /continueEditing\.disabled = mobileEditorBlocked \|\| hasOpenEditingSession/u
  );
  assert.match(source, /remove\.disabled = hasOpenEditingSession/u);
  assert.match(source, /row\.classList\.toggle\("is-busy", hasOpenEditingSession\)/u);
  assert.match(source, /“\$\{project\.name\}” 계속 편집/u);
  assert.match(source, /“\$\{project\.name\}” 브라우저 저장 데이터 삭제/u);
  assert.match(
    html,
    /원본 파일, 내보낸 영상, 편집용 VOD는 삭제하지 않습니다[\s\S]*작업 끝내고 임시 파일 삭제/u
  );
});

test("전체 삭제는 stale 목록이 아닌 collection lock으로 새 프로젝트 경합까지 막는다", async () => {
  const { source } = await studioSources();
  const start = source.indexOf("async function removeAllLocalProjects()");
  const end = source.indexOf("async function confirmLocalProjectDeletion", start);
  assert.ok(start >= 0 && end > start);
  const deletion = source.slice(start, end);
  assert.match(
    deletion,
    /runWithExclusiveStudioProjectCollectionAccess\([\s\S]*deleteAllProjectSessionsAtomically\(\)/u
  );
  assert.match(
    deletion,
    /storage\.get\(null\)[\s\S]*startsWith\("chzzkKirinukiEditorSeed:"\)[\s\S]*deleteAllProjectSessionsAtomically\(\)[\s\S]*storage\.remove\(seedKeys\)[\s\S]*localStorage\.removeItem\(WEB_STUDIO_LATEST_PROJECT_KEY\)/u
  );
  assert.doesNotMatch(deletion, /runWithAllLocalProjectLocks/u);
});

test("raw close 뒤 살아 있는 시작 탭은 focus·pageshow·visible 복귀를 합쳐 자동 rollback한다", async () => {
  const { source } = await studioSources();
  assert.match(
    source,
    /const localProjectLifecycleCleanupQueue = createLatestSerialOperationQueue\(\)/u
  );
  assert.match(
    source,
    /function scheduleLocalProjectLifecycleRefresh\(\)[\s\S]*window\.setTimeout\([\s\S]*observeLocalProjectLifecycleCleanup\(queueLocalProjectLifecycleCleanup\(\)\)/u
  );
  assert.match(
    source,
    /window\.addEventListener\("focus", scheduleLocalProjectLifecycleRefresh\)/u
  );
  assert.match(
    source,
    /window\.addEventListener\("pageshow", \(event\) => \{[\s\S]*event\.persisted[\s\S]*openingEditor = false;[\s\S]*clearCurrentTabWebEditorSession\(\);[\s\S]*observeLocalProjectLifecycleCleanup\(queueLocalProjectLifecycleCleanup\(\)\)/u
  );
  assert.match(
    source,
    /document\.addEventListener\("visibilitychange",[\s\S]*!document\.hidden[\s\S]*scheduleLocalProjectLifecycleRefresh\(\)/u
  );
  assert.match(
    source,
    /const refreshed = await refreshLocalProjectManager\(\);[\s\S]*if \(!refreshed\)[\s\S]*throw new Error/u
  );
  assert.match(
    source,
    /clearCurrentTabWebEditorSession\(\);[\s\S]*initialLocalProjectCleanup = localProjectLifecycleCleanupQueue\.enqueue\(async \(\) =>[\s\S]*await reconcileAbandonedProjectsBeforeEditorEntry\(\);[\s\S]*finally[\s\S]*localProjectManagerInitialized = true/u
  );
  assert.match(
    source,
    /async function requireSafeLocalProjectStateForEditorEntry\(\)[\s\S]*queueLocalProjectLifecycleCleanup\(\)[\s\S]*await localProjectLifecycleCleanupQueue\.waitForLatest\(\)[\s\S]*이전 편집 정리를 확인하지 못해 새 편집을 열지 않았습니다/u
  );
  assert.match(
    source,
    /openingEditor = true;[\s\S]*clearTimeout\(localProjectLifecycleRefreshTimer\)[\s\S]*await requireSafeLocalProjectStateForEditorEntry\(\);[\s\S]*beginWebEditorSession/u
  );
  assert.match(
    source,
    /elements\.retryLocalProjects\.addEventListener\("click"[\s\S]*queueLocalProjectLifecycleCleanup\(\{ announce: true \}\)/u
  );
});

test("Popovic 정적 배포도 공개 도메인과 브라우저 보안 경계를 잃지 않는다", async () => {
  const [{ html }, editorHtml, licensesHtml, hosts] = await Promise.all([
    studioSources(),
    readFile(new URL("../web/editor.html", import.meta.url), "utf8"),
    readFile(new URL("../web/licenses.html", import.meta.url), "utf8"),
    readFile(new URL("../web/.popovic-hosts", import.meta.url), "utf8")
  ]);
  assert.equal(hosts, "kirinuki.eff0rtchung.kr\n");
  assert.match(
    html,
    /<meta name="referrer" content="strict-origin-when-cross-origin">/u
  );
  assert.match(
    html,
    /http-equiv="Content-Security-Policy"[^>]*default-src 'self'[^>]*frame-src https:\/\/chzzk\.naver\.com https:\/\/www\.youtube-nocookie\.com https:\/\/vod\.sooplive\.com[^>]*connect-src 'self' http:\/\/127\.0\.0\.1:4319/u
  );
  assert.match(
    editorHtml,
    /<meta name="referrer" content="strict-origin-when-cross-origin">/u
  );
  assert.match(
    editorHtml,
    /http-equiv="Content-Security-Policy"[^>]*default-src 'self'[^>]*object-src 'none'[^>]*media-src 'self' blob: http:\/\/127\.0\.0\.1:4319[^>]*connect-src 'self' http:\/\/127\.0\.0\.1:4319/u
  );
  assert.match(licensesHtml, /<meta name="referrer" content="no-referrer">/u);
  assert.match(
    licensesHtml,
    /http-equiv="Content-Security-Policy"[^>]*script-src 'none'[^>]*style-src 'self'/u
  );
});
