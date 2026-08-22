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
  assert.match(css, /\.stream-cut-console[\s\S]*\.stream-cut-buttons/u);
  assert.match(
    css,
    /\.clip-row \.clip-start input, \.clip-row \.clip-end input \{[^}]*ui-monospace[^}]*tabular-nums[^}]*text-overflow: clip/u
  );
});

test("프로젝트 이름은 중립적인 실제 사용 예시를 보여 준다", async () => {
  const { html } = await studioSources();
  assert.match(
    html,
    /id="project-name"[^>]*placeholder="예: 0520 히오스"/u
  );
  assert.doesNotMatch(html, /유이카 쇼츠 1/u);
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

test("컷 단계는 원본 iframe과 컷 전용 브리지만 쓰고 편집 미디어 준비는 editor 진입 뒤로 미룬다", async () => {
  const { html, source } = await studioSources();
  assert.match(
    html,
    /VOD에서 편집할 구간을 선택하세요[\s\S]*편집기를 열 때 선택한 구간만 이 PC에 준비합니다/u
  );
  assert.match(html, /id="stream-preview-frame"/u);
  assert.match(html, /강조된 행에 E로 시작, R로 끝 시각을 기록합니다/u);
  assert.doesNotMatch(
    html,
    /local-preview-video|local-preview-anchor|prepare-local-preview/u
  );
  assert.match(
    source,
    /StreamingBridgeClient[\s\S]*captureCurrentPlayerTime[\s\S]*seekPlayerBy[\s\S]*setPlayerRate/u
  );
  assert.match(source, /elements\.addClip\.addEventListener\("click", \(\) => addClipRow\(\)\)/u);
  assert.doesNotMatch(
    source,
    /LOCAL_VOD_COMPANION_ENDPOINT|KIRINUKI_MEDIA_ENGINE_ENDPOINT|startChzzkVodMaterialization|waitForChzzkVodMaterialization|localPreviewVideo/u
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
    /normalizeEditorHandoffSubmission\(\{[\s\S]*captureSeed: currentCaptureState\(\)/u
  );
  assert.match(source, /const projectId = createFreshHandoffProjectId\(existingProjectIds\)/u);
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
  const refreshEnd = source.indexOf("function prefillSourceFromLocation(", refreshStart);
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
    /automaticLocalProjectLifecycleCleanup =[\s\S]*createCoalescedAutomaticOperation\([\s\S]*enqueue: \(operation\) => localProjectLifecycleCleanupQueue\.enqueue\(operation\)[\s\S]*operation: \(\) => performLocalProjectLifecycleCleanup\(\)/u
  );
  assert.match(
    source,
    /function queueMandatoryLocalProjectLifecycleCleanup\([\s\S]*automaticLocalProjectLifecycleCleanup\.supersede\(\)[\s\S]*localProjectLifecycleCleanupQueue\.enqueue/u
  );
  assert.match(
    source,
    /function scheduleLocalProjectLifecycleRefresh\(\)[\s\S]*window\.setTimeout\([\s\S]*requestAutomaticLocalProjectLifecycleCleanup\(\)/u
  );
  assert.match(
    source,
    /window\.addEventListener\("focus", scheduleLocalProjectLifecycleRefresh\)/u
  );
  assert.match(
    source,
    /window\.addEventListener\("pageshow", \(event\) => \{[\s\S]*event\.persisted[\s\S]*openingEditor = false;[\s\S]*clearCurrentTabWebEditorSession\(\);[\s\S]*requestAutomaticLocalProjectLifecycleCleanup\(\)/u
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
    /clearCurrentTabWebEditorSession\(\);[\s\S]*initialLocalProjectCleanup = localProjectLifecycleCleanupQueue\.enqueue\([\s\S]*async \(\) =>[\s\S]*await reconcileAbandonedProjectsBeforeEditorEntry\(\);[\s\S]*finally[\s\S]*localProjectManagerInitialized = true/u
  );
  assert.match(
    source,
    /async function requireSafeLocalProjectStateForEditorEntry\(\)[\s\S]*await queueMandatoryLocalProjectLifecycleCleanup\(\)[\s\S]*이전 편집 정리를 확인하지 못해 새 편집을 열지 않았습니다/u
  );
  assert.match(
    source,
    /openingEditor = true;[\s\S]*clearTimeout\(localProjectLifecycleRefreshTimer\)[\s\S]*await requireSafeLocalProjectStateForEditorEntry\(\);[\s\S]*beginWebEditorSession/u
  );
  assert.match(
    source,
    /elements\.retryLocalProjects\.addEventListener\("click"[\s\S]*queueMandatoryLocalProjectLifecycleCleanup\(\{ announce: true \}\)/u
  );
  assert.match(
    source,
    /case "refresh-recovery-sessions":[\s\S]*if \(!isElectronCutHostSurface && !openingEditor\)[\s\S]*refreshRecentProject\(\)/u
  );
});

test("공개 웹 편집기 정적 HTML은 고정 HTTPS 원본과 loopback 영상 엔진만 허용한다", async () => {
  const [{ html }, editorHtml, licensesHtml] = await Promise.all([
    studioSources(),
    readFile(new URL("../web/editor.html", import.meta.url), "utf8"),
    readFile(new URL("../web/licenses.html", import.meta.url), "utf8")
  ]);
  assert.match(
    html,
    /<meta name="referrer" content="strict-origin-when-cross-origin">/u
  );
  assert.match(
    html,
    /http-equiv="Content-Security-Policy"[^>]*default-src 'self'[^>]*frame-src https:\/\/chzzk\.naver\.com https:\/\/www\.youtube-nocookie\.com https:\/\/vod\.sooplive\.com[^>]*script-src 'self'[^>]*media-src 'self' blob: http:\/\/127\.0\.0\.1:4319[^>]*connect-src 'self' http:\/\/127\.0\.0\.1:4319/u
  );
  assert.doesNotMatch(html, /localhost|127\.0\.0\.1:(?!4319\b)|:4320/u);
  assert.match(
    editorHtml,
    /<meta name="referrer" content="strict-origin-when-cross-origin">/u
  );
  assert.match(
    editorHtml,
    /http-equiv="Content-Security-Policy"[^>]*default-src 'self'[^>]*object-src 'none'[^>]*media-src 'self' blob: http:\/\/127\.0\.0\.1:4319[^>]*connect-src 'self' http:\/\/127\.0\.0\.1:4319/u
  );
  assert.doesNotMatch(editorHtml, /localhost|127\.0\.0\.1:(?!4319\b)|:4320/u);
  assert.match(licensesHtml, /<meta name="referrer" content="no-referrer">/u);
  assert.match(
    licensesHtml,
    /http-equiv="Content-Security-Policy"[^>]*script-src 'none'[^>]*style-src 'self'/u
  );
});

test("실제 공개 배포 트리는 완전한 브라우저 편집기와 강제 보안 헤더를 포함한다", async () => {
  const [html, editorHtml, headers, hosts, notices] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../web/editor.html", import.meta.url), "utf8"),
    readFile(new URL("../web/_headers", import.meta.url), "utf8"),
    readFile(new URL("../web/.popovic-hosts", import.meta.url), "utf8"),
    readFile(new URL("../web/THIRD_PARTY_NOTICES.md", import.meta.url), "utf8")
  ]);
  assert.equal(hosts, "kirinuki.eff0rtchung.kr\n");
  assert.match(html, /id="local-app-surface"[^>]*hidden[^>]*inert/u);
  assert.match(html, /id="start-form"[\s\S]*id="start-editor"/u);
  assert.match(html, /<script type="module" src="\/studio\.js\?v=3\.0\.1"><\/script>/u);
  assert.match(editorHtml, /id="local-media-engine-dialog"/u);
  assert.doesNotMatch(`${html}\n${editorHtml}\n${notices}`, /kirinuki:\/\/|chrome-extension:\/\//iu);
  for (const requiredHeader of [
    "frame-ancestors 'none'",
    "connect-src 'self' http://127.0.0.1:4319",
    "X-Content-Type-Options: nosniff",
    "X-Frame-Options: DENY",
    "Permissions-Policy:",
    "Cross-Origin-Opener-Policy: same-origin",
    "Cross-Origin-Resource-Policy: same-origin"
  ]) {
    assert.ok(headers.includes(requiredHeader), `공개 응답 헤더 누락: ${requiredHeader}`);
  }
});

test("공개 브라우저와 Electron 컷 호스트는 저장·컷 역할을 분리한다", async () => {
  const { html, source } = await studioSources();
  const publicStart = html.indexOf('id="public-launch-shell"');
  const localStart = html.indexOf('id="local-app-surface"');
  assert.ok(publicStart >= 0 && localStart > publicStart);
  const publicShell = html.slice(publicStart, localStart);
  assert.match(publicShell, /id="public-launch-shell"[^>]*hidden[^>]*inert/u);
  assert.match(publicShell, /편집기를 준비하고 있습니다/u);
  assert.match(
    html,
    /<a id="launch-kirinuki-cut"[^>]*role="button"/u
  );
  assert.doesNotMatch(html, /href="kirinuki-engine:\/\/cut"/u);
  assert.match(html, /id="cut-host-launch-panel"[^>]*hidden[^>]*inert/u);
  assert.match(html, /id="local-app-surface"[^>]*hidden[^>]*inert/u);
  assert.match(
    source,
    /location\.search === "\?kirinukiSurface=cut-host"[\s\S]*elements\.localProjectManager\.hidden = isElectronCutHostSurface[\s\S]*elements\.form\.hidden = !isElectronCutHostSurface/u
  );
  assert.match(
    source,
    /if \(isElectronCutHostSurface\) \{[\s\S]*installStreamFrameLoadHandler\(elements\.streamFrame\)[\s\S]*\} else \{[\s\S]*clearCurrentTabWebEditorSession\(\)/u
  );
  assert.doesNotMatch(source, /chrome-extension:\/\//u);
});

test("새 컷 launcher는 readiness 전 scheme href가 없고 준비 뒤 trusted anchor click만 사용한다", async () => {
  const { html, source } = await studioSources();
  assert.match(html, /id="local-media-engine-dialog"/u);
  assert.match(html, /id="local-media-engine-download"/u);
  assert.match(
    source,
    /function armCutLauncher\(\): void \{[\s\S]*cutLauncherReady = true;[\s\S]*elements\.launchKirinukiCut\.href = "kirinuki-engine:\/\/cut"/u
  );
  const handlerStart = source.indexOf(
    'elements.launchKirinukiCut.addEventListener("click"'
  );
  const handlerEnd = source.indexOf(
    'elements.addClip.addEventListener("click"',
    handlerStart
  );
  const handler = source.slice(handlerStart, handlerEnd);
  assert.match(
    handler,
    /if \([\s\S]*cutLauncherReady[\s\S]*href === "kirinuki-engine:\/\/cut"[\s\S]*return;[\s\S]*event\.preventDefault\(\)/u
  );
  assert.doesNotMatch(handler, /location\.assign\("kirinuki-engine:\/\/cut"\)/u);
});

test("새 컷 launcher는 prime 미완료 클릭을 끝내고 다음 명시 클릭을 요구한다", async () => {
  const { source } = await studioSources();
  const handlerStart = source.indexOf(
    'elements.launchKirinukiCut.addEventListener("click"'
  );
  const handlerEnd = source.indexOf(
    'elements.addClip.addEventListener("click"',
    handlerStart
  );
  const handler = source.slice(handlerStart, handlerEnd);
  const primeGate = handler.indexOf("if (!initialLocalEngineTrustPrimeSettled)");
  const readiness = handler.indexOf(
    "const readinessAttempt = ensureLocalMediaEngineReady(undefined, {"
  );
  assert.ok(primeGate >= 0 && readiness > primeGate);
  assert.match(
    handler,
    /if \(!initialLocalEngineTrustPrimeSettled\) \{[\s\S]*잠시 뒤 다시 눌러 주세요[\s\S]*return;/u
  );
  assert.doesNotMatch(handler.slice(0, readiness), /await\s/u);
  assert.doesNotMatch(handler, /await initialLocalEngineTrustPrime/u);
});

test("새 컷 launcher는 설치 확인 취소 시 열지 않고 다시 시도할 수 있다", async () => {
  const { source } = await studioSources();
  const handlerStart = source.indexOf(
    'elements.launchKirinukiCut.addEventListener("click"'
  );
  const handlerEnd = source.indexOf(
    'elements.addClip.addEventListener("click"',
    handlerStart
  );
  const handler = source.slice(handlerStart, handlerEnd);
  assert.match(
    handler,
    /if \(readiness !== "ready"\) \{[\s\S]*컷 선택 창을 열지 않았습니다[\s\S]*return;/u
  );
  assert.match(
    handler,
    /\.finally\(\(\) => \{[\s\S]*cutLauncherBusy = false;[\s\S]*removeAttribute\("aria-disabled"\)/u
  );
});

test("새 컷 launcher는 prime 완료 뒤 readiness를 click stack에서 시작하고 두 번째 click으로 연다", async () => {
  const { source } = await studioSources();
  assert.match(
    source,
    /initialLocalEngineTrustPrime = \([\s\S]*primeLocalMediaEngineTrust\(\)[\s\S]*\.finally\(\(\) => \{[\s\S]*initialLocalEngineTrustPrimeSettled = true/u
  );
  assert.match(
    source,
    /const readinessAttempt = ensureLocalMediaEngineReady\(undefined, \{[\s\S]*allowImmediateProtocolLaunch: true[\s\S]*readinessAttempt\.then\(\(readiness\) => \{[\s\S]*if \(readiness !== "ready"\)[\s\S]*armCutLauncher\(\)[\s\S]*한 번 더 눌러 주세요/u
  );
  assert.doesNotMatch(source, /await initialLocalEngineTrustPrime/u);
});

test("편집기 인계는 fragment를 즉시 지우고 encrypted claim 뒤 ACK 확정 또는 응답 유실 보존으로 이동한다", async () => {
  const { html, source } = await studioSources();
  for (const id of [
    "local-media-engine-dialog",
    "local-media-engine-download",
    "local-media-engine-retry",
    "local-media-engine-reset",
    "local-media-engine-cancel",
    "local-media-engine-status"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`, "u"));
  }
  const fragmentRemoval = source.indexOf("history.replaceState(");
  const handoffConsumer = source.indexOf("async function consumeEditorHandoff(");
  assert.ok(fragmentRemoval >= 0 && fragmentRemoval < handoffConsumer);
  assert.match(source, /\(\[A-Za-z0-9_-\]\{43\}\)\$/u);
  assert.match(
    source,
    /editorHandoffCapabilityProjectId\(handoffNonce\)[\s\S]*purpose: "editor-handoff"[\s\S]*const claimId = freshLocalMediaEngineChallenge\(\)/u
  );
  assert.match(
    source,
    /for \(let attempt = 0; attempt < 3; attempt \+= 1\)[\s\S]*localMediaEngineTransportFetch/u
  );
  const sessionSetup = source.indexOf("session = await beginWebEditorSession({", handoffConsumer);
  const acknowledgement = source.indexOf("const acknowledgement = await postEncryptedEditorHandoff(", sessionSetup);
  const navigation = source.indexOf("location.assign(session.editorUrl);", acknowledgement);
  assert.ok(sessionSetup > handoffConsumer);
  assert.ok(acknowledgement > sessionSetup);
  assert.ok(navigation > acknowledgement);
  assert.match(
    source.slice(handoffConsumer, navigation),
    /schema: EDITOR_HANDOFF_CONSUME_REQUEST_SCHEMA,[\s\S]*handoffNonce,[\s\S]*claimId[\s\S]*schema: EDITOR_HANDOFF_ACKNOWLEDGEMENT_SCHEMA,[\s\S]*handoffNonce,[\s\S]*claimId/u
  );
  const claim = source.indexOf("const claimRequest = Object.freeze({", handoffConsumer);
  const reconciliation = source.indexOf(
    "await reconcileAbandonedBrowserProjectsForHandoff()",
    handoffConsumer
  );
  assert.ok(reconciliation > handoffConsumer && reconciliation < claim);
  assert.match(
    source,
    /async function reconcileAbandonedBrowserProjectsForHandoff\(\)[\s\S]*listEditingSessionCheckpointProjectIds\(\)[\s\S]*runWithExclusiveStudioProjectAccess\([\s\S]*discardAbandonedEditingSessionCheckpoint\(projectId\)[\s\S]*listProjects\(\)/u
  );
  assert.match(
    source,
    /catch \(error\) \{[\s\S]*await rollbackFailedEditorHandoff\(projectId\)[\s\S]*throw error;/u
  );
  assert.match(
    source,
    /async function rollbackFailedEditorHandoff\(projectId: string\)[\s\S]*runWithExclusiveStudioProjectAccess\([\s\S]*deleteProjectSessionAtomically\(projectId\)[\s\S]*studioStorageArea\(\)\.remove\([\s\S]*clearCurrentTabWebEditorSession\(\)/u
  );
  assert.match(
    source,
    /function runTrustedCutShortcut[\s\S]*message\.transportEpoch !== streamingBridgeGeneration[\s\S]*message\.documentGeneration !== activePlayerDocumentGeneration[\s\S]*message\.bridgeGeneration !== client\.generation[\s\S]*message\.platform !== client\.source\.platform[\s\S]*descriptor\.platform !== message\.platform[\s\S]*activeStudioElementIsEditable\(\)[\s\S]*function installTrustedCutShortcuts[\s\S]*onTrustedShortcut/u
  );
  assert.match(
    source,
    /binding\.action === "open-editor"[\s\S]*elements\.startEditor\.click\(\)[\s\S]*return;[\s\S]*runStudioCaptureAction\(binding\.action\)/u
  );
});

test("편집기 인계 claim은 abandoned-project reconciliation 실패를 건너뛰지 않는다", async () => {
  const { source } = await studioSources();
  const consumerStart = source.indexOf("async function consumeEditorHandoff(");
  const consumerEnd = source.indexOf("function startLocalApplication()", consumerStart);
  const consumer = source.slice(consumerStart, consumerEnd);
  const barrier = consumer.indexOf(
    "await reconcileAbandonedBrowserProjectsForHandoff()"
  );
  const claim = consumer.indexOf("const claimRequest = Object.freeze({");
  const claimPost = consumer.indexOf("token,\n      claimRequest", claim);
  assert.ok(barrier >= 0 && claim > barrier && claimPost > claim);
  assert.doesNotMatch(
    consumer.slice(barrier, claim),
    /catch\s*\([^)]*\)\s*\{[^}]*\/\/|\.catch\(\(\) =>/u
  );
});

test("ACK 명시 거절은 rollback하고 commit 여부가 모호한 응답 유실은 B를 보존한다", async () => {
  const { source } = await studioSources();
  const rollbackStart = source.indexOf(
    "async function rollbackFailedEditorHandoff(projectId: string)"
  );
  const rollbackEnd = source.indexOf(
    "async function consumeEditorHandoff(",
    rollbackStart
  );
  const rollback = source.slice(rollbackStart, rollbackEnd);
  assert.match(
    rollback,
    /runWithExclusiveStudioProjectAccess\([\s\S]*deleteProjectSessionAtomically\(projectId\)/u
  );
  assert.match(
    rollback,
    /studioStorageArea\(\)\.remove\([\s\S]*chzzkKirinukiEditorSeed:\$\{projectId\}/u
  );
  assert.match(rollback, /finally \{[\s\S]*clearCurrentTabWebEditorSession\(\)/u);
  const consumer = source.slice(rollbackEnd, source.indexOf("function startLocalApplication()", rollbackEnd));
  assert.match(
    consumer,
    /session = await beginWebEditorSession\([\s\S]*const acknowledgement = await postEncryptedEditorHandoff\([\s\S]*if \(!editorHandoffAcknowledgementFailureIsAmbiguous\(error\)\) \{[\s\S]*throw error;[\s\S]*acknowledgementUncertain = true;[\s\S]*catch \(error\) \{[\s\S]*await rollbackFailedEditorHandoff\(projectId\)[\s\S]*throw error/u
  );
  assert.match(
    source,
    /function editorHandoffAcknowledgementFailureIsAmbiguous[\s\S]*editorHandoffAcknowledgementFailureDisposition\([\s\S]*error instanceof EditorHandoffRequestError \? error\.status : null[\s\S]*=== "preserve"/u
  );
  assert.match(
    consumer,
    /acknowledgementUncertain[\s\S]*만든 편집을 보존해서 엽니다[\s\S]*location\.assign\(session\.editorUrl\)/u
  );
});
