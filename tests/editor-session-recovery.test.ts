import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `${start} 시작점을 찾지 못했습니다.`);
  assert.notEqual(endIndex, -1, `${end} 끝점을 찾지 못했습니다.`);
  return source.slice(startIndex, endIndex);
}

test("임시저장 복원은 최신 CURRENT barrier 뒤에만 세대를 바꾸고 atomic restore한다", async () => {
  const source = await readFile(
    new URL("../src/editor/main.ts", import.meta.url),
    "utf8"
  );
  const restore = section(
    source,
    "async function restoreSelectedLocalDraft()",
    "function startLocalDraftAutosave()"
  );
  const barrierIndex = restore.indexOf(
    "queueCurrentProjectSessionWrite(() => saveProject("
  );
  const advanceIndex = restore.indexOf("advanceProjectSessionGeneration()");
  const restoreIndex = restore.indexOf(
    "queueCurrentProjectSessionWrite(() => restoreLocalDraft("
  );
  assert.ok(barrierIndex >= 0);
  assert.ok(advanceIndex > barrierIndex);
  assert.ok(restoreIndex > advanceIndex);
  assert.match(restore, /saveProject\(\s*currentPersistedProject\s*\)/u);
});

test("임시저장 복원은 선택 저장본의 exact transport만 설치하고 현재 B 영상을 먼저 분리한다", async () => {
  const source = await readFile(
    new URL("../src/editor/main.ts", import.meta.url),
    "utf8"
  );
  const restore = section(
    source,
    "async function restoreSelectedLocalDraft()",
    "function startLocalDraftAutosave()"
  );

  assert.match(
    restore,
    /const reusesCurrentMaterializedTransport = Boolean\([\s\S]*runtimeTransportMediaIdentityMatches\([\s\S]*normalizedDraftProject\.mediaAsset,[\s\S]*currentTransport/u
  );
  assert.match(
    restore,
    /const restoredProject = reusesCurrentMaterializedTransport[\s\S]*projectFitsMaterializedTransport\(normalizedDraftProject\)[\s\S]*projectFitsManualTransport\(normalizedDraftProject\)/u
  );
  assert.doesNotMatch(restore, /transportBoundDraft/u);
  assert.match(
    restore,
    /const exactDraft: LocalDraftRecord = \{[\s\S]*\.\.\.draft,[\s\S]*project: restoredProject[\s\S]*restoreLocalDraft\([\s\S]*exactDraft/u
  );
  assert.match(
    restore,
    /restoredBoundHandle = restoreResult\.restoredMediaHandle[\s\S]*if \(!reusesCurrentMaterializedTransport\)[\s\S]*preview_video\.removeAttribute\("src"\)[\s\S]*mediaFile = null![\s\S]*rootProject = cloneProject\(restoredProject\)/u
  );
  assert.match(
    restore,
    /!reusesCurrentMaterializedTransport && restoresMaterializedTransport[\s\S]*await restoreMedia\(\)[\s\S]*!restoresMaterializedTransport && restoredBoundHandle[\s\S]*await restoreMedia\(\)/u
  );
  assert.match(
    restore,
    /이 저장본의 원본 파일을 ‘내 파일 직접 연결’에서 다시 선택해 주세요/u
  );
});

test("삭제 완료 복구와 archive import는 exact identity와 공통 busy guard를 통과해야 한다", async () => {
  const source = await readFile(
    new URL("../src/editor/main.ts", import.meta.url),
    "utf8"
  );
  const reconcile = section(
    source,
    "async function reconcileInterruptedSessionCleanup(",
    "async function cleanupCompletedExportSessionCaches("
  );
  const cleanup = section(
    source,
    "async function cleanupCompletedExportSessionCaches(",
    "async function exportVideo("
  );
  const archiveImport = section(
    source,
    "async function importSessionArchiveFile(",
    "async function focusSourceTab("
  );
  assert.match(
    reconcile,
    /sessionCleanupMarkerMatchesMaterializedBinding\([\s\S]*KIRINUKI_MEDIA_ENGINE_ENDPOINT/u
  );
  assert.match(source, /isSafeSessionCleanupMediaUrl\([\s\S]*record\.mediaUrl/u);
  assert.match(reconcile, /아무 파일도 지우지 않았습니다/u);
  assert.match(
    reconcile,
    /stage === "purge-intent"[\s\S]*deleteProjectSessionAtomically\(candidateProject\.id\)/u,
    "VOD purge 완료 표식의 재시작 복구는 detach가 아니라 현재 세션 전체를 원자 삭제해야 합니다."
  );
  assert.doesNotMatch(
    reconcile,
    /replaceProjectSessionAtomically\(/u,
    "이미 VOD가 지워진 terminal 세션을 다시 저장 가능한 프로젝트로 되살리면 안 됩니다."
  );
  const preconditionIndex = cleanup.indexOf(
    "if (isMaterializedLoopbackMediaSource(sourceMedia))"
  );
  const discardIndex = cleanup.indexOf("discardPendingProjectSave()");
  const barrierIndex = cleanup.indexOf(
    "queueCurrentProjectSessionWrite(() => saveProject("
  );
  const advanceIndex = cleanup.indexOf("advanceProjectSessionGeneration()");
  assert.ok(preconditionIndex >= 0);
  assert.ok(discardIndex > preconditionIndex);
  assert.ok(barrierIndex > discardIndex);
  assert.ok(advanceIndex > barrierIndex);
  assert.match(cleanup, /saveProject\(\s*exportedRootProject\s*\)/u);
  const consumerPurgeIndex = cleanup.indexOf(
    "purgeChzzkVodConsumerSessionCache({"
  );
  const browserDeleteIndex = cleanup.indexOf(
    "deleteProjectSessionAtomically(exportedRootProject.id)"
  );
  const completedDialogIndex = cleanup.indexOf(
    "elements.session_completed_dialog.showModal()"
  );
  assert.ok(consumerPurgeIndex > advanceIndex);
  assert.match(
    cleanup,
    /consumerId: exportedRootProject\.id,[\s\S]*mediaUrl: sourceMedia\.url,[\s\S]*materialization/u
  );
  assert.ok(browserDeleteIndex > consumerPurgeIndex);
  assert.ok(completedDialogIndex > browserDeleteIndex);
  assert.match(
    cleanup,
    /editorSessionCompleted = true;[\s\S]*deleteProjectSessionAtomically/u
  );
  assert.match(
    cleanup,
    /completeStudioEditorSession\(\{[\s\S]*projectId: exportedRootProject\.id,[\s\S]*sourceSessionId: activePolicy\.sourceSessionId[\s\S]*usagePolicySession = null/u
  );
  assert.equal(
    [...archiveImport.matchAll(/projectReplacementBusyReason\(\)/gu)].length,
    2
  );
});

test("내보내기 성공은 영상과 모든 복원 sidecar의 바이트·해시·안정성 검증 뒤에만 성립한다", async () => {
  const source = await readFile(
    new URL("../src/editor/main.ts", import.meta.url),
    "utf8"
  );
  const sidecarHelpers = section(
    source,
    "async function saveSidecarsToDirectory(",
    "async function directoryFileExists("
  );
  const exportFlow = section(
    source,
    "async function exportVideo(",
    "async function exportVideoWithLock("
  );
  const lockedExport = section(
    source,
    "async function exportVideoWithLock(",
    "function closeExportOptionsDialog("
  );

  assert.match(
    sidecarHelpers,
    /Promise<SavedExportSidecar\[\]>[\s\S]*savedSidecars\.push\(\{ name, blob, fileHandle \}\)[\s\S]*return savedSidecars;/u,
    "저장된 각 sidecar의 실제 파일 핸들을 검증 단계로 반환해야 합니다."
  );
  assert.match(
    sidecarHelpers,
    /const expectedSha256 = await sha256BlobHex\(blob\)[\s\S]*const beforeSha256 = await sha256BlobHex\(before\)[\s\S]*const afterSha256 = await sha256BlobHex\(after\)/u
  );
  assert.match(
    sidecarHelpers,
    /parseSessionArchiveJson\(await before\.text\(\)\)/u,
    "디스크에서 다시 읽은 복원 JSON을 정식 parser로 재검증해야 합니다."
  );
  assert.match(
    sidecarHelpers,
    /after\.lastModified !== before\.lastModified[\s\S]*stable\.lastModified !== after\.lastModified/u,
    "검증 전후의 파일 안정성을 두 경계에서 확인해야 합니다."
  );
  assert.match(
    sidecarHelpers,
    /archives\.length !== 1/u,
    "필수 세션 복원 JSON이 정확히 하나인지 확인해야 합니다."
  );

  const saveIndex = exportFlow.indexOf("const savedSidecars = await saveSidecarsToDirectory(");
  const videoVerifyIndex = exportFlow.indexOf("const verifiedVideo = await verifyCompletedExportFile(");
  const sidecarVerifyIndex = exportFlow.indexOf("const verifiedSidecars = await verifySavedExportSidecars(savedSidecars)");
  const bundleCommitIndex = exportFlow.indexOf("verifiedOutput = {");
  const cleanupPromptIndex = exportFlow.indexOf("const shouldCleanup = await askExportSessionCleanup(");
  const cleanupIndex = exportFlow.indexOf("cleanupCompletedExportSessionCaches(");
  assert.ok(saveIndex >= 0);
  assert.ok(videoVerifyIndex > saveIndex);
  assert.ok(sidecarVerifyIndex > videoVerifyIndex);
  assert.ok(bundleCommitIndex > sidecarVerifyIndex);
  assert.ok(cleanupPromptIndex > bundleCommitIndex);
  assert.ok(cleanupIndex > cleanupPromptIndex);
  assert.match(
    exportFlow,
    /if \(verifiedOutput\) \{[\s\S]*askExportSessionCleanup\([\s\S]*cleanupCompletedExportSessionCaches\(/u,
    "영상과 sidecar를 모두 검증한 bundle만 캐시 삭제 선택지를 열어야 합니다."
  );
  assert.match(
    exportFlow,
    /if \(!verifiedOutput\) \{[\s\S]*임시 자료를 모두 유지했습니다/u,
    "sidecar 변조·불일치 때는 성공을 주장하거나 캐시 삭제를 제안하면 안 됩니다."
  );
  const directoryGuardIndex = exportFlow.indexOf("if (!directoryHandle) {");
  const profileIndex = exportFlow.indexOf("getPreferredOutputProfile(");
  const renderIndex = exportFlow.indexOf("renderProjectVideo(");
  assert.ok(directoryGuardIndex >= 0);
  assert.ok(profileIndex > directoryGuardIndex);
  assert.ok(renderIndex > profileIndex);
  assert.doesNotMatch(exportFlow, /showSaveFilePicker|triggerDownload|downloadSidecars/u);

  const capabilityGuardIndex = lockedExport.indexOf(
    'typeof window.showDirectoryPicker !== "function"'
  );
  const pendingIndex = lockedExport.indexOf("exportRequestPending = true;");
  const pickerIndex = lockedExport.indexOf("await window.showDirectoryPicker(");
  assert.ok(capabilityGuardIndex >= 0);
  assert.ok(pendingIndex > capabilityGuardIndex);
  assert.ok(pickerIndex > pendingIndex);
  assert.match(lockedExport, /안전하게 저장하는 기능을 지원하지 않습니다/u);
});

test("검증 완료 정리는 범위를 설명하고 편집기를 terminal 완료 상태로 잠근다", async () => {
  const [source, html] = await Promise.all([
    readFile(new URL("../src/editor/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/editor.html", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="session-completed-dialog"/u);
  assert.match(html, /작업 완료·임시 자료 삭제/u);
  assert.match(html, /다른 편집 작업과 사용자가 직접 선택한 원본 영상 파일은 삭제하지 않습니다/u);
  assert.match(html, /이 탭에서는 더 이상 자동저장하거나 편집하지 않습니다/u);
  assert.match(html, /id="close-completed-editor"[\s\S]*시작 화면으로 돌아가기/u);
  assert.match(source, /function scheduleSave\(\) \{[\s\S]*editorSessionCompleted/u);
  assert.match(source, /function flushSave\(\) \{[\s\S]*editorSessionCompleted/u);
  assert.match(source, /function scheduleLocalDraftAutosave[\s\S]*editorSessionCompleted/u);
  assert.match(source, /session_completed_dialog\.addEventListener\("cancel"[\s\S]*event\.preventDefault\(\)/u);
  const completedExit = section(
    source,
    'elements.close_completed_editor.addEventListener("click"',
    'elements.apply_source_offset.addEventListener("click"'
  );
  assert.match(completedExit, /leaveCompletedStudioEditor\(\)/u);
  assert.doesNotMatch(completedExit, /window\.close|자동으로 닫지 못했습니다/u);
  assert.match(
    source,
    /if \(startupCompletedSessionCleanup\) \{[\s\S]*editorSessionCompleted = true;[\s\S]*completeStudioEditorSession\(\{[\s\S]*sourceSessionId: activePolicy\.sourceSessionId[\s\S]*session_completed_dialog\.showModal\(\);[\s\S]*return;/u,
    "전원 중단 뒤 완료 표식을 복구한 세션도 autosave를 재개하지 않고 terminal 화면으로 끝나야 합니다."
  );
});

test("편집 세션은 진입 baseline 뒤 작업 사본을 저장하고 명시적 저장·폐기로만 확정한다", async () => {
  const [source, html] = await Promise.all([
    readFile(new URL("../src/editor/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/editor.html", import.meta.url), "utf8")
  ]);
  for (const id of [
    "finish-editing-session",
    "editing-session-exit-dialog",
    "cancel-editing-session-exit",
    "save-and-exit-editing-session",
    "discard-and-exit-editing-session"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`, "u"));
  }
  assert.match(html, /탭을 그냥 닫으면 이번 변경은 저장되지 않습니다/u);
  assert.match(
    source,
    /feature === "Whisper"[\s\S]*현재 공개 설치판은 Whisper를 제공하지 않습니다\.[\s\S]*설치 안내가 보이면 이 PC용 영상 준비 도구를 한 번 설치한 뒤 같은 버튼을 다시 눌러 주세요\./u
  );
  assert.match(
    source,
    /return `\$\{feature\}용 내부 미디어 엔진을 시작하지 못했습니다\. \$\{recovery\}`/u
  );
  assert.doesNotMatch(
    source,
    /Kirinuki를 다시 열면 이 브라우저 저장본을 유지한 채 자동으로 이어집니다/u
  );

  const initialize = section(
    source,
    "async function initialize()",
    "function normalizeLocalCaptionFirstPass("
  );
  const writerIndex = initialize.indexOf("acquireStudioProjectWriter(projectId)");
  const checkpointIndex = initialize.indexOf("beginEditingSessionCheckpoint(");
  const loadIndex = initialize.indexOf("loadProject(projectId)");
  const firstSaveIndex = initialize.indexOf("saveActiveWorkspaceImmediately()");
  assert.ok(writerIndex >= 0);
  assert.ok(checkpointIndex > writerIndex);
  assert.ok(loadIndex > checkpointIndex);
  assert.ok(firstSaveIndex > loadIndex);

  const finish = section(
    source,
    "async function finishEditingSession(",
    "function devReloadBusyReason()"
  );
  assert.match(
    finish,
    /const finalProject = await flushSave\(\)[\s\S]*await waitForProjectSaves\(\)[\s\S]*commitEditingSessionCheckpoint\([\s\S]*finalProject/u
  );
  assert.match(
    finish,
    /discardPendingProjectSave\(\)[\s\S]*await waitForProjectSaves\(\)[\s\S]*discardEditingSessionCheckpoint\(/u
  );
  assert.match(finish, /현재 편집 체크포인트가 달라 저장을 확정하지 않았습니다/u);
  assert.match(finish, /현재 편집 체크포인트가 달라 변경을 폐기하지 않았습니다/u);

  const unload = section(
    source,
    'window.addEventListener("beforeunload"',
    "function resumeEditorAfterPageShow()"
  );
  assert.match(unload, /void flushSave\(\)/u);
  assert.doesNotMatch(
    unload,
    /commitEditingSessionCheckpoint|discardEditingSessionCheckpoint/u
  );
});
