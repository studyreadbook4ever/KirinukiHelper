import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("컷 미리보기와 편집용 VOD는 명시적으로 서로 다른 실행 수명 정책을 쓴다", async () => {
  const [webMain, editorMain] = await Promise.all([
    source("src/web/main.ts"),
    source("src/editor/main.ts")
  ]);
  assert.match(
    webMain,
    /materializeLocalPreviewRange[\s\S]*?continuationPolicy: "ephemeral-preview"/u
  );
  assert.match(
    webMain,
    /startOrReattachSelectedVodMaterialization[\s\S]*?continuationPolicy: "bounded-persistent-editor"/u
  );
  assert.match(
    editorMain,
    /startWithSession[\s\S]*?continuationPolicy: "bounded-persistent-editor"/u
  );
});

test("새 편집은 helper 요청 전에 secret-free pending handoff를 저장하고 session commit 뒤 지운다", async () => {
  const webMain = await source("src/web/main.ts");
  const submitStart = webMain.indexOf('elements.form.addEventListener("submit"');
  const createIndex = webMain.indexOf(
    "await createPendingVodEditorHandoff(",
    submitStart
  );
  const saveIndex = webMain.indexOf(
    "savePendingVodEditorHandoff(pendingHandoff)",
    createIndex
  );
  const prepareIndex = webMain.indexOf(
    "await prepareSelectedVodForEditor(",
    saveIndex
  );
  const beginIndex = webMain.indexOf(
    "await beginWebEditorSession(",
    prepareIndex
  );
  const clearIndex = webMain.indexOf(
    "clearPendingVodEditorHandoff(\n          await pendingVodEditorOwnerId(),\n          pendingHandoff.requestFingerprint",
    beginIndex
  );
  const navigationIndex = webMain.indexOf(
    "location.assign(session.editorUrl)",
    clearIndex
  );
  assert.ok(createIndex > submitStart);
  assert.ok(saveIndex > createIndex);
  assert.ok(prepareIndex > saveIndex);
  assert.ok(beginIndex > prepareIndex);
  assert.ok(clearIndex > beginIndex);
  assert.ok(navigationIndex > clearIndex);

  const pendingSource = await source("src/web/pending-vod-editor-handoff.ts");
  assert.match(pendingSource, /requestFingerprint/u);
  assert.match(pendingSource, /crypto\.subtle\.digest\(\s*"SHA-256"/u);
  assert.doesNotMatch(
    pendingSource,
    /interface PendingVodEditorHandoff[\s\S]*?\b(?:token|authorization|clientNonce|capability|mediaUrl):/u
  );
});

test("focus·pageshow·visibility 복귀는 동일 pending fingerprint를 자동 재개한다", async () => {
  const webMain = await source("src/web/main.ts");
  assert.match(
    webMain,
    /function schedulePendingVodEditorHandoffResume\(\)[\s\S]*?const ownerId = await pendingVodEditorOwnerId\(\);[\s\S]*?loadPendingVodEditorHandoff\(ownerId\)[\s\S]*?lifecycle === "terminal"[\s\S]*?prepareSelectedVodForEditor\([\s\S]*?beginWebEditorSession/u
  );
  assert.match(
    webMain,
    /window\.addEventListener\("focus"[\s\S]*?schedulePendingVodEditorHandoffResume\(\)/u
  );
  assert.match(
    webMain,
    /window\.addEventListener\("pageshow"[\s\S]*?schedulePendingVodEditorHandoffResume\(\)/u
  );
  assert.match(
    webMain,
    /document\.addEventListener\("visibilitychange"[\s\S]*?!document\.hidden[\s\S]*?schedulePendingVodEditorHandoffResume\(\)/u
  );
});

test("저장된 exact job은 scoped status로만 재연결하고 누락돼도 자동 재실행하지 않는다", async () => {
  const webMain = await source("src/web/main.ts");
  const start = webMain.indexOf(
    "async function startOrReattachSelectedVodMaterialization("
  );
  const end = webMain.indexOf(
    "async function prepareSelectedVodForEditor(",
    start
  );
  assert.ok(start >= 0 && end > start);
  const reconnect = webMain.slice(start, end);
  assert.match(
    reconnect,
    /const storedJobId = pendingHandoff\?\.jobId;[\s\S]*?if \(!storedJobId\) \{[\s\S]*?return startExactRequest\(\);/u
  );
  assert.match(
    reconnect,
    /pendingHandoff\.projectId !== projectId[\s\S]*?pendingHandoff\.request\.consumerId !== projectId[\s\S]*?pendingHandoff\.request\.sourceUrl !== sourceUrl/u
  );
  assert.match(
    reconnect,
    /if \(initialCollectionPost\) \{[\s\S]*?status = await startExactRequest\(\);[\s\S]*?\} else \{[\s\S]*?status = await getChzzkVodMaterializationStatus\(\{[\s\S]*?token,[\s\S]*?jobId: storedJobId[\s\S]*?\}\);/u
  );
  assert.doesNotMatch(reconnect, /error\.code === "JOB_NOT_FOUND"/u);
  assert.match(reconnect, /status\.jobId !== storedJobId/u);
  assert.equal(
    reconnect.match(/startExactRequest\(\)/gu)?.length,
    2,
    "legacy/atomic first submit 외에는 collection POST가 없어야 한다"
  );

  const prepareStart = webMain.indexOf(
    "async function prepareSelectedVodForEditor("
  );
  const prepareEnd = webMain.indexOf(
    "function allAcknowledgementsChecked()",
    prepareStart
  );
  const prepare = webMain.slice(prepareStart, prepareEnd);
  assert.match(
    prepare,
    /if \(pendingHandoff && !pendingHandoff\.jobId\) \{[\s\S]*?pendingVodEditorHandoffWithJob\([\s\S]*?savePendingVodEditorHandoff\(pendingHandoff\);[\s\S]*?initialCollectionPost = true;[\s\S]*?startOrReattachSelectedVodMaterialization\(/u
  );

  assert.match(
    webMain,
    /async function persistPendingVodTerminal\([\s\S]*?loadPendingVodEditorHandoff\([\s\S]*?latest\?\.requestFingerprint === pending\.requestFingerprint[\s\S]*?pendingVodEditorHandoffWithTerminal\(exact, terminalCode\)/u
  );
});

test("편집기 안의 session 복구도 기존 job status만 조회하고 숨은 재실행을 하지 않는다", async () => {
  const editorMain = await source("src/editor/main.ts");
  const recoveryStart = editorMain.indexOf(
    "const recoveringJobId = status.jobId;"
  );
  const recoveryEnd = editorMain.indexOf(
    "const materialization = normalizeChzzkVodMaterialization(",
    recoveryStart
  );
  assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart);
  const recovery = editorMain.slice(recoveryStart, recoveryEnd);
  assert.match(
    recovery,
    /getChzzkVodMaterializationStatus\(\{[\s\S]*?jobId: recoveringJobId/u
  );
  assert.match(recovery, /status\.jobId !== recoveringJobId/u);
  assert.doesNotMatch(recovery, /startWithSession\(/u);
});
