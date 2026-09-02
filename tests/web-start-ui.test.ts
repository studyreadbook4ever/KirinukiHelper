import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function studioSources(): Promise<{
  html: string;
  css: string;
  source: string;
  sourceLocation: string;
}> {
  const [html, css, source, sourceLocation] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../web/studio.css", import.meta.url), "utf8"),
    readFile(new URL("../src/web/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/web/source-location.ts", import.meta.url), "utf8")
  ]);
  return { html, css, source, sourceLocation };
}

test("공개 웹이 URL 입력·PR16 컷 좌표·전체 편집 진입을 모두 소유한다", async () => {
  const { html, css, source } = await studioSources();
  assert.match(html, /id="source-url"[^>]*type="url"/u);
  assert.match(html, /id="stream-preview-frame"/u);
  assert.match(html, /id="stream-preview-video"/u);
  assert.match(html, /id="stream-cut-console"[\s\S]*id="clip-list"/u);
  assert.match(
    html,
    /현재 편집본 영상 길이: <output id="current-edit-duration"[^>]*>--:--<\/output>/u
  );
  assert.match(
    html,
    /id="cut-leaderboard-ad-slot" class="cut-leaderboard-ad-slot" aria-hidden="true"><\/div>/u
  );
  assert.match(
    css,
    /\.cut-leaderboard-ad-slot \{[^}]*width: 728px;[^}]*height: 90px;/u
  );
  assert.match(
    html,
    /id="cut-rectangle-ad-slot" class="cut-rectangle-ad-slot" aria-hidden="true"><\/div>/u
  );
  assert.match(
    css,
    /\.cut-rectangle-ad-slot \{[^}]*width: 300px;[^}]*height: 250px;/u
  );
  assert.match(html, /id="start-editor"[^>]*aria-keyshortcuts="A"/u);
  assert.match(source, /setDocumentSurface\("local"\)/u);
  assert.match(source, /installStudioCaptureConsole\(\)/u);
  assert.match(source, /connectLocalVodWebPlayback[\s\S]*LocalVodWebPlaybackController\.connect/u);
  assert.doesNotMatch(source, /ElectronCutSession|openElectronControlledPlayer|kirinukiSurface=cut-host/u);
  assert.doesNotMatch(`${html}\n${source}`, /chrome-extension:\/\/|createWebCodexJobFolder/u);
});

test("원본과 구간 rail은 PR16처럼 한 화면에 나란히 있고 직접 입력도 유지한다", async () => {
  const { html, css } = await studioSources();
  const toolbar = html.indexOf('class="source-capture-toolbar"');
  const leaderboardAd = html.indexOf('id="cut-leaderboard-ad-slot"', toolbar);
  const projectName = html.indexOf('class="field source-project-name"', toolbar);
  const workspace = html.indexOf('class="source-capture-workspace"');
  const stream = html.indexOf('class="stream-preview"', workspace);
  const sidebar = html.indexOf('class="selection-sidebar"', workspace);
  const rectangleAd = html.indexOf('id="cut-rectangle-ad-slot"', workspace);
  const rail = html.indexOf('class="selection-rail"', workspace);
  assert.ok(
    toolbar >= 0
      && leaderboardAd > toolbar
      && projectName > leaderboardAd
      && workspace > projectName
      && stream > workspace
      && sidebar > stream
      && rectangleAd > sidebar
      && rail > rectangleAd
  );
  assert.match(
    css,
    /\.source-capture-toolbar \{[^}]*grid-template-columns: minmax\(720px, 2fr\) minmax\(360px, \.75fr\)/u
  );
  assert.match(
    css,
    /\.source-project-name \{[^}]*height: 90px;/u
  );
  assert.match(
    css,
    /\.source-capture-workspace \{[^}]*grid-template-columns: minmax\(720px, 2fr\) minmax\(360px, \.75fr\)/u
  );
  assert.match(css, /\.source-capture-workspace \{[^}]*align-items: start;/u);
  assert.match(css, /\.selection-sidebar \{[^}]*gap: 24px;/u);
  assert.match(css, /\.selection-rail \{[^}]*height: clamp\(560px, 74vh, 700px\)/u);
  assert.match(
    html,
    /class="selection-rail-actions"[^>]*role="group"[^>]*aria-label="가져올 구간 작업"[\s\S]*id="export-session-archive"[^>]*type="button"[^>]*>현재 컷 백업<\/button>[\s\S]*id="add-clip"[^>]*>빈 구간 추가<\/button>/u
  );
  assert.ok(
    html.indexOf('id="export-session-archive"') < html.indexOf('id="add-clip"'),
    "현재 컷 백업은 빈 구간 추가 바로 왼쪽의 첫 번째 작업이어야 합니다."
  );
  assert.match(
    html,
    /id="capture-backup-status"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"[^>]*>원본 링크·프로젝트 이름·구간 메모가 백업 파일에 포함됩니다\. 영상은 포함되지 않습니다\.<\/p>/u
  );
  assert.match(
    css,
    /\.selection-rail-actions \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/u
  );
  assert.match(
    css,
    /@media \(max-width: 1250px\)[\s\S]*\.selection-rail \{[^}]*height: min\(560px, 70vh\)/u
  );
  assert.match(
    css,
    /@media \(max-width: 560px\)[\s\S]*\.selection-rail \{[^}]*height: min\(620px, 76vh\)/u
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

test("현재 컷 백업은 같은 v1 경로를 브라우저 파일로 내려받고 기존 불러오기에 연결한다", async () => {
  const { html, css, source } = await studioSources();
  assert.match(
    html,
    /id="export-session-archive"[^>]*type="button"[^>]*>현재 컷 백업<\/button>/u
  );
  assert.match(
    source,
    /sessionArchiveJsonFromCaptureState\(captureState, \{[\s\S]*projectId: createFreshEditorProjectId\(\),[\s\S]*createdAt/u
  );
  assert.match(
    source,
    /new Blob\(\[json\], \{[\s\S]*application\/json;charset=utf-8[\s\S]*download\.download = fileName/u
  );
  assert.match(source, /download\.click\(\)[\s\S]*URL\.revokeObjectURL\(objectUrl\)/u);
  assert.match(
    source,
    /elements\.exportSessionArchive\.addEventListener\("click"[\s\S]*exportCurrentCaptureSessionArchive\(\)/u
  );
  const downloadStart = source.indexOf("function startCaptureBackupDownload");
  const downloadEnd = source.indexOf("async function cancelLocalPreviewOperation", downloadStart);
  assert.ok(downloadStart >= 0 && downloadEnd > downloadStart);
  assert.doesNotMatch(source.slice(downloadStart, downloadEnd), /fetch\(/u);
  assert.match(css, /\.capture-backup-status\.error \{[^}]*#ff9292/u);
  assert.match(css, /\.capture-backup-status\.success \{[^}]*var\(--accent\)/u);
});

test("매 사용 권리 확인은 여섯 항목이며 개인정보·오픈소스 경계를 설명한다", async () => {
  const { html, source } = await studioSources();
  assert.equal((html.match(/data-ack/gu) || []).length, 6);
  assert.match(html, /허용된 VOD에만 사용하세요/u);
  assert.match(html, /운영 서버는 원본 VOD 주소, 컷, 자막과 편집 프로젝트를 애플리케이션 기록으로 보관하지 않습니다/u);
  assert.match(html, /href="\/privacy\.html"/u);
  assert.match(html, /href="mailto:lostfragment@naver\.com"/u);
  assert.match(html, /https:\/\/github\.com\/studyreadbook4ever\/KirinukiHelper/u);
  assert.match(source, /allAcknowledgementsChecked\(\)[\s\S]*createPerUseConfirmationAttestation/u);
  assert.doesNotMatch(html, /name="basis"|id="evidence-fields"|id="confirmation-text"/u);
});

test("source 딥링크는 입력에 반영한 뒤 광고 시작 신호보다 먼저 주소에서 제거한다", async () => {
  const { source, sourceLocation } = await studioSources();
  assert.match(sourceLocation, /url\.searchParams\.get\("source"\)/u);
  assert.match(sourceLocation, /hashParameters\.get\("source"\)/u);
  assert.match(sourceLocation, /canonicalPath: "\/"/u);
  const consume = source.indexOf("consumeSourceLocation(location.href)");
  const replace = source.indexOf("history.replaceState(null, \"\", consumed.canonicalPath)", consume);
  const prefill = source.indexOf("elements.sourceUrl.value = source", replace);
  const signal = source.indexOf("window.dispatchEvent(new Event(SOURCE_LOCATION_SANITIZED_EVENT))", prefill);
  assert.ok(consume >= 0 && replace > consume && prefill > replace && signal > prefill);
});

test("초기 컷은 W 연결 단계 없이 진행한 뒤 같은 탭 편집기로 이동한다", async () => {
  const { html, source } = await studioSources();
  assert.match(
    html,
    /CHZZK·SOOP은 도우미가 이 자리에 연결한 웹 플레이어/u
  );
  assert.doesNotMatch(`${html}\n${source}`, /manual-cut-clock|원본 플레이어도 같은 시각/u);
  assert.match(html, /id="source-capture-workspace"[^>]*hidden/u);
  assert.match(html, /id="recent-section"[^>]*hidden/u);
  assert.match(html, /id="cut-preparation-progress"[\s\S]*컷 선택은 이 웹 화면에서 끝납니다/u);
  assert.doesNotMatch(`${html}\n${source}`, /id="refresh-source"|aria-keyshortcuts="W"|case "refresh-source"|openElectronControlledPlayer/u);
  assert.match(source, /ensureLocalVodWebPlayback[\s\S]*captureCurrentPlayerTime/u);
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
  assert.match(
    source,
    /window\.addEventListener\("focus", \(\) => \{[\s\S]*scheduleLocalProjectLifecycleRefresh\(\)[\s\S]*schedulePendingVodEditorHandoffResume\(\)[\s\S]*\}\)/u
  );
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
    assert.match(
      html,
      /data-local-media-engine-step-title="download"[\s\S]*다운로드 후 설치·실행[\s\S]*이 화면에서 연결 확인/u
    );
    assert.match(html, /운영체제에 맞는 설치 파일/u);
    assert.match(html, /id="local-media-engine-status"[^>]*aria-live="polite"/u);
    assert.match(html, /id="local-media-engine-download-note"[\s\S]*실제 파일 진행률은 브라우저/u);
    assert.match(html, /id="local-media-engine-source-offer"[^>]*hidden[^>]*>도우미 소스·라이선스 안내/u);
    assert.doesNotMatch(html, /localhost|포트 번호|터미널에서/u);
  }
  assert.match(onboarding, /download[\s\S]*install[\s\S]*connect/iu);
  assert.match(onboarding, /Windows 도우미 받기[\s\S]*Windows 11 x64용 설치 파일/u);
  assert.match(onboarding, /Linux 도우미 받기[\s\S]*Debian\/Ubuntu 또는 Arch Linux/u);
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
