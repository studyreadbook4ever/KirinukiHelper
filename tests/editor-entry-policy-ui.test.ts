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

test("편집기 HTML은 검증 중 경고를 숨기고 실제 작업공간도 기본 잠금 상태다", async () => {
  const html = await readFile(
    new URL("../web/editor.html", import.meta.url),
    "utf8"
  );
  const gateStart = /<main id="editor-policy-gate"[^>]*>/u.exec(html)?.[0] ?? "";
  const shellStart = /<div id="editor-shell"[^>]*>/u.exec(html)?.[0] ?? "";

  assert.ok(gateStart);
  assert.ok(shellStart);
  assert.match(gateStart, /aria-labelledby="editor-policy-gate-title"/u);
  assert.match(gateStart, /\bhidden\b/u);
  assert.match(shellStart, /\bhidden\b/u);
  assert.match(html, /이번 사용의 사용자 권한 진술이 필요합니다/u);
  assert.match(html, /시작 화면에서 매번 직접 확인한 뒤에만 열립니다/u);
  assert.match(html, /책임은 전적으로\(100%\) 사용자/u);
  assert.match(html, /실제 권리나 법적 적합성을 심사·보증/u);
  assert.match(
    html,
    /href="\/"[^>]*target="_blank"[^>]*rel="noopener"/u
  );
  assert.match(
    html,
    /id="editor-policy-gate-status"[^>]*role="alert"/u
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
  assert.match(
    initialize,
    /const verifiedProjectId = await verifyEditorUsagePolicyGate\(\);[\s\S]*bindActions\(\);[\s\S]*await loadSeed\(\)/u
  );
  assert.match(initialize, /projectId !== verifiedProjectId/u);
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
    /!isRecord\(response\) \|\| response\.ok !== true[\s\S]*Kirinuki 런타임[\s\S]*시작 화면/u
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
  assert.match(source, /event\.persisted[\s\S]*reverifyUsagePolicyLeaseAfterPageRestore/u);
  assert.match(
    source,
    /usagePolicyRevalidationPending = true;[\s\S]*editor_shell\.inert = true;[\s\S]*reverifyUsagePolicyLeaseAfterPageRestore\(previousSession\)/u
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
    /function showVerifiedEditorShell[\s\S]*editor_policy_gate\.hidden = true;[\s\S]*editor_shell\.hidden = false;/u
  );
  assert.match(
    source,
    /function showEditorPolicyGateError[\s\S]*editor_shell\.hidden = true;[\s\S]*editor_policy_gate\.hidden = false;/u
  );
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
  const firstLoadIndex = initialize.indexOf("await loadProject(projectId)");

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
  assert.ok(
    firstLoadIndex > checkpointIndex,
    "CURRENT를 읽거나 쓰기 전에 편집 baseline을 먼저 저장해야 합니다."
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
