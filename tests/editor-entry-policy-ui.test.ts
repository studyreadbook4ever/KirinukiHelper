import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function sectionFrom(source: string, marker: string, endMarker: string): string {
  const start = source.indexOf(marker);
  const end = source.indexOf(endMarker, start + marker.length);
  assert.notEqual(start, -1, `${marker} 시작점을 찾지 못했습니다.`);
  assert.notEqual(end, -1, `${endMarker} 끝점을 찾지 못했습니다.`);
  return source.slice(start, end + endMarker.length);
}

test("편집기 HTML은 origin·모바일 차단과 실제 작업공간을 기본 잠금 상태로 둔다", async () => {
  const html = await readFile(
    new URL("../web/editor.html", import.meta.url),
    "utf8"
  );
  const originGateStart = /<main id="editor-origin-gate"[^>]*>/u.exec(html)?.[0] ?? "";
  const mobileGateStart = /<main id="editor-mobile-gate"[^>]*>/u.exec(html)?.[0] ?? "";
  const shellStart = /<div id="editor-shell"[^>]*>/u.exec(html)?.[0] ?? "";

  assert.ok(originGateStart);
  assert.ok(mobileGateStart);
  assert.ok(shellStart);
  assert.match(originGateStart, /aria-labelledby="editor-origin-gate-title"/u);
  assert.match(originGateStart, /\bhidden\b/u);
  assert.match(mobileGateStart, /\bhidden\b/u);
  assert.match(shellStart, /\bhidden\b/u);
  assert.doesNotMatch(html, /id="editor-policy-gate"/u);
  assert.match(html, /정식 Kirinuki 웹사이트에서 다시 시작해 주세요/u);
  assert.match(html, /편집기는 모바일에서 사용할 수 없습니다/u);
  assert.match(
    html,
    /href="https:\/\/kirinuki\.eff0rtchung\.kr\/"[^>]*>Kirinuki로 이동/u
  );
});

test("고정된 공개 origin은 전체 웹 편집기를 열고 알 수 없는 origin만 차단한다", async () => {
  const [html, source] = await Promise.all([
    readFile(new URL("../web/editor.html", import.meta.url), "utf8"),
    readFile(new URL("../src/editor/main.ts", import.meta.url), "utf8")
  ]);
  const originGateStart = /<main id="editor-origin-gate"[^>]*>/u.exec(html)?.[0] ?? "";
  const initialize = sectionFrom(
    source,
    "async function initialize()",
    "function normalizeLocalCaptionFirstPass("
  );

  assert.match(originGateStart, /\bhidden\b/u);
  assert.match(html, /이 주소에서는 편집기를 열 수 없습니다/u);
  assert.match(html, /정식 Kirinuki 웹사이트에서 다시 시작해 주세요/u);
  assert.match(
    html,
    /href="https:\/\/kirinuki\.eff0rtchung\.kr\/"[^>]*>Kirinuki로 이동/u
  );
  assert.match(
    initialize,
    /^async function initialize\(\) \{\s*if \(!isKirinukiStudioOrigin\(location\.origin\)\) \{\s*showEditorOriginGate\(\);\s*return;\s*\}/u
  );
  assert.ok(
    initialize.indexOf("showEditorOriginGate()")
      < initialize.indexOf("verifyEditorUsagePolicyGate()"),
    "공개 origin 차단이 정책·프로젝트 초기화보다 먼저 실행되어야 합니다."
  );
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/u
    .exec(html)?.[1] ?? "";
  assert.ok(csp);
  assert.match(csp, /connect-src 'self' http:\/\/127\.0\.0\.1:4319/u);
  assert.match(csp, /media-src 'self' blob: http:\/\/127\.0\.0\.1:4319/u);
  assert.doesNotMatch(csp, /localhost|127\.0\.0\.1:(?!4319\b)\d+/u);
});

test("편집기는 내장 미디어 엔진 주소를 사용자 설정으로 노출하지 않는다", async () => {
  const [html, source] = await Promise.all([
    readFile(new URL("../web/editor.html", import.meta.url), "utf8"),
    readFile(new URL("../src/editor/main.ts", import.meta.url), "utf8")
  ]);

  assert.doesNotMatch(
    html,
    /caption-agent-endpoint|PC 도우미|companion|gateway|caption-stack:setup|caption-stack:start/iu
  );
  assert.doesNotMatch(html, /<(?:input|select)[^>]+(?:localhost|127\.0\.0\.1|4319)/iu);
  assert.match(html, /class="caption-auto-compatibility" hidden aria-hidden="true"/u);
  assert.match(html, /id="whisper-provider-tab"[^>]*aria-hidden="true"[^>]*hidden[^>]*disabled/u);
  assert.match(html, /id="test-caption-agent"[^>]*disabled[^>]*>Whisper 확인/u);
  assert.match(
    source,
    /function readCaptionAgentConfig\(\)[\s\S]*endpoint: DEFAULT_CAPTION_AGENT_SETTINGS\.endpoint/u
  );
  assert.doesNotMatch(
    source,
    /PC 도우미|Kirinuki setup|Whisper PC 도우미 주소|Kirinuki 런타임/u
  );
});

test("편집기 스크립트는 정책 검증 성공 전 프로젝트·미디어 작업을 초기화하지 않는다", async () => {
  const [source, studioRuntime] = await Promise.all([
    readFile(new URL("../src/editor/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/editor/studio-runtime-web.ts", import.meta.url), "utf8")
  ]);
  const initialize = sectionFrom(
    source,
    "async function initialize()",
    "function normalizeLocalCaptionFirstPass("
  );
  const verify = sectionFrom(
    source,
    "async function verifyEditorUsagePolicyGate()",
    "function requireActiveUsagePolicySession()"
  );
  const openDraftList = sectionFrom(
    source,
    "async function openLocalDraftDialog()",
    "function closeLocalDraftDialog()"
  );
  const restoreDraft = sectionFrom(
    source,
    "async function restoreSelectedLocalDraft()",
    "function startLocalDraftAutosave()"
  );
  const verifyIndex = initialize.indexOf(
    "await verifyEditorUsagePolicyGate()"
  );
  const writerIndex = initialize.indexOf(
    "await acquireStudioProjectWriter(projectId)"
  );
  const checkpointIndex = initialize.indexOf(
    "await beginEditingSessionCheckpoint("
  );
  const currentIndex = initialize.indexOf("loadProject(projectId)");
  const seedIndex = initialize.indexOf("loadSeed()");
  const resolutionIndex = initialize.indexOf("resolveStudioEditorEntry({");
  const bindIndex = initialize.indexOf("bindActions()");
  assert.ok(verifyIndex >= 0);
  assert.ok(writerIndex > verifyIndex);
  assert.ok(checkpointIndex > writerIndex);
  assert.ok(currentIndex > checkpointIndex);
  assert.ok(seedIndex > checkpointIndex);
  assert.ok(resolutionIndex > currentIndex && resolutionIndex > seedIndex);
  assert.ok(bindIndex > resolutionIndex);
  assert.match(initialize, /loadedSeed\.projectId !== verifiedProjectId/u);
  assert.match(
    verify,
    /verifyStudioUsagePolicyGate\(\{[\s\S]*projectId,[\s\S]*gateToken/u
  );
  assert.match(
    studioRuntime,
    /verifyStudioUsagePolicyGate\([\s\S]*projectId,[\s\S]*gateToken[\s\S]*storedWebUsageSession\(\)[\s\S]*session\.attestation\.target\.projectId !== projectId[\s\S]*gateToken !== session\.gateToken/u
  );
  assert.doesNotMatch(studioRuntime, /chrome\.|KIRINUKI_VERIFY_USAGE_POLICY_GATE/u);
  assert.match(
    verify,
    /!isRecord\(response\) \|\| response\.ok !== true[\s\S]*이 탭에서 이번 사용 확인[\s\S]*시작 화면에서 편집기를 다시 열어/u
  );
  assert.doesNotMatch(verify, /chrome:\/\/extensions|새로고침/u);
  assert.match(verify, /normalizeActiveUsagePolicySession\(/u);
  assert.match(verify, /searchParams\.delete\("usageGate"\)/u);
  assert.match(verify, /showVerifiedEditorShell\(session\)/u);
  assert.match(source, /function requireRecoveryUsagePolicySession/u);
  assert.match(openDraftList, /requireActiveUsagePolicySession\(\)/u);
  assert.doesNotMatch(openDraftList, /requireRecoveryUsagePolicySession\(\)/u);
  assert.match(restoreDraft, /requireRecoveryUsagePolicySession\(\)/u);
  assert.doesNotMatch(source, /function scheduleUsagePolicyExpiry/u);
  assert.doesNotMatch(source, /\.expiresAt|expiresAtMs/u);
  assert.match(
    source,
    /event\.persisted[\s\S]*refreshUsagePolicyLease\(expected\)[\s\S]*resumeEditorAfterPageShow\(\);[\s\S]*return;/u
  );
  assert.match(
    source,
    /class ReplacedUsagePolicyLeaseError[\s\S]*function handleUsagePolicyLeaseRefreshFailure[\s\S]*error instanceof ReplacedUsagePolicyLeaseError[\s\S]*leaveReplacedUsagePolicySession/u
  );
  assert.match(
    source,
    /function leaveReplacedUsagePolicySession[\s\S]*discardPendingProjectSave\(\)[\s\S]*advanceProjectSessionGeneration\(\)[\s\S]*location\.replace/u
  );
  assert.match(
    source,
    /function markEditorUrlReloadable\(\)[\s\S]*searchParams\.set\("session", RECOVERY_SESSION_MODE\)[\s\S]*history\.replaceState/u
  );
  assert.match(
    initialize,
    /await saveActiveWorkspaceImmediately\(\);[\s\S]*markEditorUrlReloadable\(\);/u
  );
  assert.doesNotMatch(
    source,
    /reverifyUsagePolicyLeaseAfterPageRestore|lockEditorForUsagePolicy|편집기를 잠갔습니다/u
  );
  assert.match(
    source,
    /async function applyLocalCaptionFirstPass\(detail: unknown\) \{[\s\S]*requireActiveUsagePolicySession\(\)[\s\S]*lockProjectMutations\(\);[\s\S]*requireActiveUsagePolicySession\(\);[\s\S]*saveLocalDraft/u
  );
  assert.match(
    source,
    /async function attachMediaSource\([\s\S]*requireActiveUsagePolicySession\(\);[\s\S]*project = nextProject;[\s\S]*await saveActiveWorkspaceImmediately\(\)/u
  );
  assert.match(
    source,
    /async function addImageAssetFromBlob\([\s\S]*requireActiveUsagePolicySession\(\)[\s\S]*requireActiveUsagePolicySession\(\)[\s\S]*saveProjectWithImageAssetBlob/u
  );
  assert.doesNotMatch(source, /KIRINUKI_CAPTURE_SEED_UPDATED/u);
  assert.match(
    source,
    /activePolicy\.purpose === "editor-new"[\s\S]*recoverySourceRecord\(project\.source\)[\s\S]*sourceSessionIdentity\(policySource \?\? undefined\)/u
  );
  assert.match(
    source,
    /sourceSessionIdentity\([\s\n]*recoverySourceRecord\(normalizedDraftProject\.source\) \?\? undefined[\s\n]*\)[\s\S]*recoveryPolicy\.sourceSessionId !== restoredSourceSessionId/u
  );
  assert.match(
    source,
    /function showVerifiedEditorShell[\s\S]*editor_origin_gate\.hidden = true;[\s\S]*editor_mobile_gate\.hidden = true;[\s\S]*editor_shell\.hidden = false;/u
  );
  assert.match(
    source,
    /void initialize\(\)\.catch[\s\S]*editor_shell\.hidden = true;[\s\S]*location\.replace\(new URL\("\/", location\.origin\)\.href\)/u
  );
});

test("편집기 runtime ready 신호는 정상 초기화와 미디어 복원이 끝난 뒤 한 번만 보낸다", async () => {
  const source = await readFile(
    new URL("../src/editor/main.ts", import.meta.url),
    "utf8"
  );
  const initialize = sectionFrom(
    source,
    "async function initialize()",
    "function normalizeLocalCaptionFirstPass("
  );
  const restoreMediaIndex = initialize.indexOf("await restoreMedia()");
  const startDevReloadIndex = initialize.indexOf("startDevReloadObserver()");
  const readyLatchIndex = initialize.indexOf(
    'document.documentElement.dataset.kirinukiEditorRuntimeReady = "true"'
  );
  const readyEventIndex = initialize.indexOf(
    "window.dispatchEvent(new Event(EDITOR_RUNTIME_READY_EVENT))"
  );

  assert.equal(
    source.match(/kirinuki:editor-runtime-ready/gu)?.length,
    1,
    "runtime ready event 이름은 단일 canonical 상수여야 합니다."
  );
  assert.ok(restoreMediaIndex >= 0);
  assert.ok(startDevReloadIndex > restoreMediaIndex);
  assert.ok(readyLatchIndex > startDevReloadIndex);
  assert.ok(readyEventIndex > readyLatchIndex);
  assert.match(
    initialize,
    /startDevReloadObserver\(\);\s*document\.documentElement\.dataset\.kirinukiEditorRuntimeReady = "true";\s*window\.dispatchEvent\(new Event\(EDITOR_RUNTIME_READY_EVENT\)\);\s*\}\s*function normalizeLocalCaptionFirstPass\(/u
  );
  assert.doesNotMatch(initialize, /new CustomEvent\(EDITOR_RUNTIME_READY_EVENT/u);
});

test("웹 편집 종료는 진입 baseline을 먼저 잡고 명시적 저장·폐기에서만 확정한다", async () => {
  const [html, source] = await Promise.all([
    readFile(new URL("../web/editor.html", import.meta.url), "utf8"),
    readFile(new URL("../src/editor/main.ts", import.meta.url), "utf8")
  ]);
  const initialize = sectionFrom(
    source,
    "async function initialize()",
    "function normalizeLocalCaptionFirstPass("
  );
  const finish = sectionFrom(
    source,
    "async function finishEditingSession(",
    "function devReloadBusyReason()"
  );
  const beforeUnload = sectionFrom(
    source,
    'window.addEventListener("beforeunload"',
    'window.addEventListener("pagehide"'
  );
  const pageHide = sectionFrom(
    source,
    'window.addEventListener("pagehide"',
    'document.addEventListener("visibilitychange"'
  );
  const writerLockIndex = initialize.indexOf(
    "await acquireStudioProjectWriter(projectId)"
  );
  const checkpointIndex = initialize.indexOf(
    "await beginEditingSessionCheckpoint("
  );
  const firstLoadIndex = initialize.indexOf("loadProject(projectId)");
  const firstSeedIndex = initialize.indexOf("loadSeed()");
  const resolutionIndex = initialize.indexOf("resolveStudioEditorEntry({");

  assert.match(
    html,
    /id="finish-editing-session"[^>]*aria-controls="editing-session-exit-dialog"[^>]*hidden[^>]*disabled/u
  );
  assert.match(html, /id="editing-session-exit-dialog"[^>]*aria-labelledby/u);
  assert.match(html, /id="save-and-exit-editing-session"[^>]*>이 기기에 저장하고 나가기</u);
  assert.match(html, /id="discard-and-exit-editing-session"[^>]*>저장하지 않고 나가기</u);
  assert.match(html, /id="cancel-editing-session-exit"[^>]*>취소</u);
  assert.match(html, /탭을 그냥 닫으면 이번 변경은 저장되지 않습니다/u);
  assert.match(html, /직접 만든 저장본은 남기고,[\s\S]*나머지는 열기 전 상태로 자동 정리합니다/u);
  assert.ok(writerLockIndex >= 0, "프로젝트 writer lock을 찾지 못했습니다.");
  assert.ok(
    checkpointIndex > writerLockIndex,
    "편집 baseline은 writer lock을 얻은 뒤 시작해야 합니다."
  );
  assert.ok(firstLoadIndex > checkpointIndex);
  assert.ok(firstSeedIndex > checkpointIndex);
  assert.ok(
    resolutionIndex > firstLoadIndex && resolutionIndex > firstSeedIndex,
    "CURRENT와 seed를 읽기 전에 편집 baseline을 먼저 저장하고 그 뒤 진입 모드를 판정해야 합니다."
  );
  assert.match(
    finish,
    /const finalProject = await flushSave\(\);[\s\S]*commitEditingSessionCheckpoint\([\s\S]*finalProject[\s\S]*committed !== true/u
  );
  assert.match(
    finish,
    /editorSessionCompleted = true;[\s\S]*await waitForProjectSaves\(\);[\s\S]*discardEditingSessionCheckpoint\([\s\S]*discarded !== true/u
  );
  assert.match(finish, /leaveCompletedStudioEditor\(\)/u);
  for (const passiveExit of [beforeUnload, pageHide]) {
    assert.match(passiveExit, /flushSave\(\)/u);
    assert.doesNotMatch(
      passiveExit,
      /commitEditingSessionCheckpoint|discardEditingSessionCheckpoint/u
    );
  }
});
