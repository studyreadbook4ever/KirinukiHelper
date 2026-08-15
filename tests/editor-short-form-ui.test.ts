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

function attributeValues(source: string, attribute: string): string[] {
  const pattern = new RegExp(`${attribute}="([^"]+)"`, "gu");
  return [...source.matchAll(pattern)].map((match) => match[1]!);
}

test("쇼츠 편집기는 최초 선택 대화상자 없이 빈 1080x1920 캔버스로 바로 들어간다", async () => {
  const html = await readFile(
    new URL("../web/editor.html", import.meta.url),
    "utf8"
  );

  assert.match(
    html,
    /id="open-short-form"[^>]*>[\s\S]*쇼츠 편집기[\s\S]*id="short-form-count"/u
  );
  assert.doesNotMatch(html, /id="short-form-dialog"/u);
  assert.doesNotMatch(html, /id="short-form-scene-list"/u);
  assert.doesNotMatch(html, /id="export-short-form"/u);
  assert.match(
    html,
    /id="short-workspace-preview"[\s\S]*width="540"[\s\S]*height="960"[\s\S]*aria-label="쇼츠 전용 9대16 합성 미리보기"/u
  );
  assert.match(
    html,
    /id="exit-short-form"[^>]*aria-label="본편 편집으로 돌아가기"[^>]*hidden[\s\S]*본편 편집으로/u
  );
});

test("본편 stage에서 시간과 원본 픽셀 영역을 정해 쇼츠 소스를 만든다", async () => {
  const html = await readFile(
    new URL("../web/editor.html", import.meta.url),
    "utf8"
  );
  const toolbar = sectionFrom(
    html,
    'id="clip-group-toolbar"',
    '<div id="clip-list"'
  );
  const composer = sectionFrom(
    html,
    'id="short-source-composer"',
    "</section>"
  );

  assert.doesNotMatch(html, /id="send-clips-to-short"/u);
  assert.doesNotMatch(toolbar, /쇼츠로 보내기/u);
  assert.match(html, /class="clip-group-checkbox"[^>]*type="checkbox"/u);
  assert.match(
    html,
    /id="start-short-source-composer"[\s\S]*aria-controls="short-source-composer"[\s\S]*쇼츠에 영상 추가/u
  );
  assert.match(composer, /hidden/u);
  for (const id of [
    "short-source-start-time",
    "short-source-end-time",
    "set-short-source-start",
    "set-short-source-end",
    "short-source-whole-clip",
    "short-source-to-clip-end",
    "short-source-start-to-clip-start",
    "short-source-end-to-clip-end",
    "preview-short-source-start",
    "preview-short-source-end",
    "toggle-short-source-composer-collapse",
    "short-source-composer-body",
    "short-source-crop-x",
    "short-source-crop-y",
    "short-source-crop-width",
    "short-source-crop-height",
    "add-short-source-only",
    "add-short-source-and-open"
  ]) {
    assert.match(composer, new RegExp(`id="${id}"`, "u"));
  }
  assert.deepEqual(
    attributeValues(composer, "data-short-source-crop-handle"),
    ["nw", "n", "ne", "e", "se", "s", "sw", "w"]
  );
  assert.deepEqual(
    attributeValues(composer, "data-short-source-aspect"),
    ["free", "9:16", "1:1", "full"]
  );
  assert.doesNotMatch(
    composer,
    /<select[^>]*id="short-source-aspect"/u,
    "원본 crop 비율은 중복 select 없이 한 segmented control에서만 고릅니다."
  );
  assert.match(composer, /id="short-source-to-clip-end"[^>]*>이 컷의 끝까지 가져오기</u);
  assert.match(
    composer,
    /id="toggle-short-source-composer-collapse"[^>]*aria-controls="short-source-composer-body"[^>]*aria-expanded="true"/u
  );
  assert.equal(
    attributeValues(composer, "data-short-source-delta-ms").length,
    8
  );
});

test("쇼츠 소스 시간은 컷 의미·미세 이동·경계 프레임 확인으로 조절하고 패널을 작게 접는다", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("../src/editor/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/editor/editor.css", import.meta.url), "utf8")
  ]);
  const rangeActions = sectionFrom(
    source,
    "function setShortSourceRange(",
    "function clearTimelineRangeSelection("
  );
  const composer = sectionFrom(
    source,
    "function renderShortSourceComposer()",
    "function setShortSourceAspect("
  );
  const bindings = sectionFrom(source, "function bindActions()", "async function initialize()");
  const rangeUi = sectionFrom(
    source,
    "function renderTimelineRange()",
    "function setShortSourceRange("
  );
  const adjustment = sectionFrom(
    source,
    "function adjustShortSourceBoundary(",
    "async function previewShortSourceBoundary("
  );
  const seekTimeline = sectionFrom(
    source,
    "async function seekTimeline(",
    "async function syncPreviewToPlayhead("
  );

  assert.match(rangeActions, /shortSourceBoundaryClip\("start"\)/u);
  assert.match(rangeActions, /const startMs = wholeClip \? clip\?\.timelineStartMs : rangeStartMs/u);
  assert.match(rangeActions, /clip\.timelineStartMs \+ clipDurationMs\(clip\)/u);
  assert.match(rangeActions, /boundaryMs! - 1/u);
  assert.match(rangeActions, /shortSourceBoundaryPreviewInFlight[\s\S]*finally \{[\s\S]*shortSourceBoundaryPreviewInFlight = false/u);
  assert.match(adjustment, /setTimelineRangeBoundary\(side, currentMs! \+ deltaMs, \{ constrain: true \}\)/u);
  assert.doesNotMatch(adjustment, /void previewShortSourceBoundary/u);
  assert.match(composer, /dataset\.collapsed = String\([\s\S]*shortSourceComposerCollapsed/u);
  assert.match(composer, /short_source_composer_body\.hidden = shortSourceComposerCollapsed/u);
  assert.match(composer, /remainingInStartClipMs < MIN_TIMELINE_RANGE_MS/u);
  assert.match(composer, /aria-busy[\s\S]*shortSourceBoundaryPreviewInFlight/u);
  assert.match(composer, /composerInteractionLocked = \([\s\S]*shortSourceBoundaryPreviewInFlight/u);
  assert.match(composer, /querySelectorAll<[\s\S]*HTMLButtonElement \| HTMLInputElement[\s\S]*>\("button, input"\)/u);
  assert.match(bindings, /short_source_to_clip_end\.addEventListener\("click"[\s\S]*setShortSourceRangeFromStartClip\(false\)/u);
  assert.match(bindings, /data-short-source-boundary.*data-short-source-delta-ms/u);
  assert.match(bindings, /event\.key !== "ArrowUp"[\s\S]*const typedMs = parseTime\(control\.value\)[\s\S]*event\.shiftKey \? 1_000 : 100[\s\S]*typedMs \+ direction \* stepMs/u);
  assert.match(bindings, /set_short_source_start\.addEventListener\("click"[\s\S]*setTimelineRangeBoundary\("start", project\.playheadMs, \{ constrain: true \}\)/u);
  assert.match(bindings, /preview_short_source_start\.addEventListener\("click"[\s\S]*previewShortSourceBoundary\("start"\)/u);
  assert.match(seekTimeline, /const expectedVideo = elements\.preview_video/u);
  assert.match(seekTimeline, /previewSeekSequence !== expectedSeekSequence[\s\S]*elements\.preview_video !== expectedVideo[\s\S]*mediaUrl !== expectedMediaUrl/u);
  assert.match(seekTimeline, /if \(seekWasSuperseded\) \{\s*return;/u);
  assert.match(rangeUi, /choosingShortSource[\s\S]*\? "쇼츠 소스 시작 시각"[\s\S]*: "삭제 구간 시작 시각"/u);
  assert.match(rangeUi, /choosingShortSource[\s\S]*\? "쇼츠 소스 끝 시각"[\s\S]*: "삭제 구간 끝 시각"/u);
  assert.doesNotMatch(rangeUi, /shortCanvasTrimActive|남길 쇼츠 캔버스/u);
  assert.match(rangeUi, /control\.value = formatTime\(canonicalMs!, \{ compact: true \}\)/u);
  assert.match(css, /\.short-source-composer-panel\[data-collapsed="true"\][\s\S]*width: 42px;[\s\S]*left: 10px;/u);
  assert.match(css, /\.short-source-crop-handle \{[\s\S]*z-index: 4;/u);
  assert.match(css, /\.short-source-composer-panel \{[\s\S]*z-index: 5;/u);
});

test("전용 쇼츠 워크스페이스는 컷·자막·에셋과 9:16 화면 맞춤을 한 편집기에 제공한다", async () => {
  const html = await readFile(
    new URL("../web/editor.html", import.meta.url),
    "utf8"
  );

  assert.match(html, /id="workspace-mode-badge"[^>]*hidden[^>]*><\/span>/u);
  assert.match(
    html,
    /id="exit-short-form"[^>]*aria-label="본편 편집으로 돌아가기"[^>]*hidden[\s\S]*본편 편집으로/u
  );
  assert.match(
    html,
    /id="short-workspace-preview"[\s\S]*width="540"[\s\S]*height="960"[\s\S]*쇼츠 전용 9대16 합성 미리보기/u
  );
  assert.match(html, /id="short-workspace-transform-layer"[^>]*role="group"[^>]*hidden/u);
  assert.match(html, /id="short-workspace-transform-box"[^>]*data-short-workspace-transform-box/u);
  assert.match(html, /id="short-workspace-transform-move"[^>]*data-short-workspace-transform-move/u);
  assert.deepEqual(
    attributeValues(html, "data-short-workspace-transform-handle"),
    ["nw", "n", "ne", "e", "se", "s", "sw", "w"]
  );
  assert.match(html, /id="short-workspace-safe-area-overlay"[^>]*aria-hidden="true"[^>]*hidden/u);
  assert.match(
    html,
    /id="short-framing-mode-tab"[^>]*role="tab"[^>]*aria-controls="short-framing-inspector-content"[^>]*hidden/u
  );
  assert.doesNotMatch(html, /id="split-short-clip"|id="merge-short-clips"/u);
  assert.match(html, /id="short-workspace-source"/u);
  assert.match(html, /id="short-workspace-duration"/u);
  assert.doesNotMatch(html, /id="short-canvas-toolbar"|id="short-canvas-add-video"/u);
  assert.doesNotMatch(html, /DETACHED SHORTS CANVAS|본편과 분리된 검은 캔버스|본편 영상 던지기/u);
  assert.match(
    html,
    /id="short-video-layer-panel"[\s\S]*id="add-short-video-layer"[\s\S]*class="short-preview-cache-feedback"[\s\S]*id="short-preview-cache-status"[\s\S]*id="retry-short-preview-cache"/u
  );
  assert.doesNotMatch(html, /id="delete-short-workspace-clip"/u);
  assert.match(html, /id="add-cue"/u);
  assert.match(html, /id="asset-paste"/u);
  assert.match(html, /id="asset-pick-file"/u);
  assert.match(html, /id="add-audio-region"/u);
});

test("쇼츠 영상 에셋은 화면·원본 음성을 한 단위로 추가·선택·삭제하고 블록별 음량을 조절한다", async () => {
  const [html, css, source] = await Promise.all([
    readFile(new URL("../web/editor.html", import.meta.url), "utf8"),
    readFile(new URL("../web/editor/editor.css", import.meta.url), "utf8"),
    readFile(new URL("../src/editor/main.ts", import.meta.url), "utf8")
  ]);
  for (const id of [
    "short-video-layer-panel",
    "short-video-layer-count",
    "add-short-video-layer",
    "short-video-layer-list",
    "short-video-layer-empty",
    "short-video-layer-controls",
    "short-video-layer-start",
    "short-video-layer-end",
    "short-video-layer-opacity",
    "short-video-layer-volume",
    "short-video-layer-volume-value",
    "toggle-short-video-layer-visibility",
    "delete-short-video-layer",
    "short-preview-cache-status",
    "retry-short-preview-cache",
    "short-source-layer-intent"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`, "u"));
  }
  assert.match(
    html,
    /위쪽 영상일수록 화면 앞에 보입니다\.[\s\S]*각 영상 행의 버튼으로 순서를 바꿀 수 있습니다/u
  );
  assert.match(
    html,
    /id="short-video-layer-controls"[^>]*role="group"[^>]*aria-label="선택 영상 설정"/u
  );
  assert.match(
    html,
    /id="short-video-layer-volume"[^>]*type="range"[^>]*min="0"[^>]*max="200"[^>]*step="1"[^>]*value="100"/u
  );
  assert.match(html, /원본 음량은 100%입니다\.[\s\S]*100%를 넘기면 큰 소리가 찌그러질 수 있습니다/u);
  assert.doesNotMatch(html, /A\/V 영상|A\/V 에셋/u);
  assert.doesNotMatch(html, /id="add-selected-video-source-audio"/u);
  assert.doesNotMatch(html, /원본 음성 에셋 추가/u);
  assert.match(html, /현재 쇼츠 화면이 비어 있습니다[\s\S]*‘영상 추가’/u);
  assert.match(html, /id="short-preview-cache-status"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/u);
  assert.match(html, /id="retry-short-preview-cache"[^>]*aria-describedby="short-preview-cache-status"[^>]*hidden/u);
  assert.doesNotMatch(html, /id="short-canvas-toolbar"|id="short-canvas-add-video"/u);
  assert.match(css, /\.short-video-layer-item\[data-selected="true"\]/u);
  assert.match(css, /\.short-video-layer-item\[data-visible="false"\]/u);
  assert.match(css, /\.short-preview-cache-feedback\s*\{/u);
  assert.doesNotMatch(css, /\.short-canvas-toolbar(?:\s|[-.:>{])/u);

  const addFlow = sectionFrom(
    source,
    "async function beginShortVideoLayerSourceSelection()",
    "function clampNumber("
  );
  const commit = sectionFrom(
    source,
    "async function commitShortSource(",
    "function replaceShortWorkspaceFraming("
  );
  const appendVideos = sectionFrom(
    source,
    "function appendShortSourceVideoAssets(",
    "async function commitShortSource("
  );
  const layerSelection = sectionFrom(
    source,
    "function shortWorkspaceVideoLayers()",
    "function updateShortWorkspaceUrl("
  );
  const layerPanel = sectionFrom(
    source,
    "function renderShortVideoLayerPanel(",
    "function renderShortFramingInspector("
  );
  const framingInspector = sectionFrom(
    source,
    "function renderShortFramingInspector()",
    "function renderPropertyInspector()"
  );
  const update = sectionFrom(
    source,
    "function replaceShortWorkspaceFraming(",
    "function deleteSelectedShortVideoLayer("
  );
  const remove = sectionFrom(
    source,
    "function deleteSelectedShortVideoLayer()",
    "function moveShortVideoLayer("
  );
  const bindings = sectionFrom(source, "function bindActions()", "async function initialize()");

  assert.match(addFlow, /const targetStartMs = Math\.max\(0, Math\.round\(project\.playheadMs\)\)/u);
  assert.match(addFlow, /canAddShortFormVideoAsset\([\s\S]*project\.shortForm,[\s\S]*targetStartMs,[\s\S]*targetStartMs \+ MIN_TIMELINE_RANGE_MS/u);
  assert.match(addFlow, /pendingShortVideoAssetTimelineMs = targetStartMs/u);
  assert.match(addFlow, /shortSourcePickerReturnState = \{[\s\S]*workspaceProject: cloneProject\(project\)[\s\S]*rootProject: cloneProject\(rootProject\)/u);
  assert.match(addFlow, /await exitShortFormWorkspace\(\{[\s\S]*render: false,[\s\S]*announce: false,[\s\S]*updateUrl: false[\s\S]*\}\)[\s\S]*startShortSourceComposer\(\)/u);
  assert.match(commit, /const videoAssetTargetTimelineMs = pendingShortVideoAssetTimelineMs/u);
  assert.match(appendVideos, /addShortFormVideoAsset\(shortForm, \{/u);
  assert.match(appendVideos, /sourceAssetId: "project-primary"/u);
  assert.match(appendVideos, /sourceSelectionStartMs: selectionStartMs,[\s\S]*sourceSelectionEndMs: selectionEndMs,/u);
  assert.match(appendVideos, /timelineStartMs: timelineCursorMs,[\s\S]*timelineEndMs,/u);
  assert.match(
    commit,
    /영상 \$\{addedCount\}개로 추가했습니다[\s\S]*화면과 원본 음성은 함께 준비되며[\s\S]*이동·자르기·삭제도 같이 적용됩니다/u
  );
  assert.doesNotMatch(commit, /원본 음성[\s\S]*명시적으로 추가/u);
  assert.doesNotMatch(commit, /appendShortFormSlices\(/u);
  assert.doesNotMatch(commit, /addShortFormVideoLayer\(/u);
  assert.doesNotMatch(commit, /pendingShortVideoLayerTargetClipId/u);

  assert.match(layerSelection, /return \[\.\.\.project\.shortForm\.videoAssets\]\.sort/u);
  assert.match(layerSelection, /right\.zIndex - left\.zIndex/u);
  assert.match(layerSelection, /const selectedId = project\.shortForm\.selectedVideoLayerId/u);
  assert.match(layerSelection, /project\.playheadMs >= layer\.timelineStartMs[\s\S]*project\.playheadMs < layer\.timelineEndMs/u);
  assert.match(layerSelection, /\|\| layers\[0\]/u);
  assert.doesNotMatch(layerSelection, /\.scenes|\.kind|base|additional/u);

  assert.match(layerPanel, /layer\.id === selectedLayer\?\.id/u);
  assert.match(
    layerPanel,
    /button\.tabIndex = layer\.id === selectedLayer\?\.id \? 0 : -1/u,
    "영상 에셋 목록은 선택 항목 하나만 tab 순서에 두어야 합니다."
  );
  assert.match(layerPanel, /const editBlocked = shortTimelineSourceEditsBlocked\(\)/u);
  assert.match(layerPanel, /button\.disabled = editBlocked/u);
  assert.match(layerPanel, /const controlsDisabled = !selectedLayer \|\| editBlocked/u);
  assert.match(layerPanel, /short_video_layer_controls\.hidden = !selectedLayer/u);
  assert.match(layerPanel, /selectedLayer\?\.timelineStartMs/u);
  assert.match(layerPanel, /selectedLayer\?\.timelineEndMs/u);
  assert.match(layerPanel, /layer\.lane \+ 1[\s\S]*layer\.audioGain \* 100/u);
  assert.match(layerPanel, /short_video_layer_volume\.disabled = controlsDisabled/u);
  assert.match(layerPanel, /selectedLayer\?\.audioGain \?\? 1/u);
  assert.match(layerPanel, /short_video_layer_volume_value\.textContent/u);
  assert.match(layerPanel, /elements\.delete_short_video_layer\.disabled = controlsDisabled/u);
  assert.match(
    layerPanel,
    /focusedLayerId[\s\S]*CSS\.escape\(focusedLayerId\)[\s\S]*focus\(\{ preventScroll: true \}\)/u,
    "목록을 다시 그려도 키보드 focus가 선택 영상에서 사라지면 안 됩니다."
  );
  assert.match(
    framingInspector,
    /short_workspace_squeegee\.hidden = \([\s\S]*!selectedLayer \|\| \(edgeGaps\.length === 0 && compositeGaps\.length === 0\)/u,
    "선택 영상이나 실제 틈이 없으면 틈 보정 도구를 숨겨야 합니다."
  );
  assert.doesNotMatch(
    layerPanel,
    /add_short_video_layer\.disabled = \([\s\S]{0,180}shortPreviewCacheOperation/u
  );
  assert.doesNotMatch(layerPanel, /index === 0|kind === "base"|kind === "additional"/u);

  assert.match(update, /updateShortFormVideoAsset\([\s\S]*project\.shortForm,[\s\S]*selected\.id/u);
  assert.match(update, /shortTimelineSourceEditsBlocked\(\)[\s\S]*reportBlockedShortTimelineSourceEdit\(\)/u);
  assert.match(remove, /removeShortFormVideoAsset\([\s\S]*project\.shortForm,[\s\S]*selected\.id/u);
  assert.match(remove, /shortTimelineSourceEditsBlocked\(\)[\s\S]*reportBlockedShortTimelineSourceEdit\(\)/u);
  assert.match(remove, /마지막 영상도 삭제했습니다\. 빈 쇼츠 화면과 사진·자막·음성은 그대로 유지됩니다/u);
  assert.doesNotMatch(remove, /removeShortFormClip|scene|base/u);
  assert.match(source, /reorderShortFormVideoAssets\(/u);
  assert.match(bindings, /delete_short_video_layer\.addEventListener\([\s\S]*"click",[\s\S]*deleteSelectedShortVideoLayer/u);
  assert.match(
    bindings,
    /short_video_layer_list\.addEventListener\("keydown"[\s\S]*\["ArrowUp", "ArrowDown", "Home", "End"\][\s\S]*filter\(\(candidate\) => !candidate\.disabled\)[\s\S]*event\.key === "Home"[\s\S]*event\.key === "End"[\s\S]*event\.key === "ArrowUp"[\s\S]*selectShortWorkspaceVideoLayer\(layerId\)[\s\S]*CSS\.escape\(layerId\)[\s\S]*focus\(\{ preventScroll: true \}\)/u,
    "영상 에셋 목록은 방향키·Home·End로 선택과 focus를 함께 옮겨야 합니다."
  );
  assert.match(
    bindings,
    /short_video_layer_volume\.addEventListener\("input"[\s\S]*audioGain: Number\(elements\.short_video_layer_volume\.value\) \/ 100[\s\S]*applyPreviewAudioSettings\(project\.playheadMs\)/u
  );
  assert.match(bindings, /endFieldEdit\("short-video-layer-volume"\)/u);
});

test("영상 에셋과 구형 독립 음성 호환도 공용 로컬 범위 +30초 hot-load와 root anchor를 쓴다", async () => {
  const [html, css, source] = await Promise.all([
    readFile(new URL("../web/editor.html", import.meta.url), "utf8"),
    readFile(new URL("../web/editor/editor.css", import.meta.url), "utf8"),
    readFile(new URL("../src/editor/main.ts", import.meta.url), "utf8")
  ]);
  const clipTemplate = sectionFrom(html, '<template id="clip-template">', "</template>");
  assert.match(clipTemplate, /data-hot-load="before"[^>]*>앞 30초/u);
  assert.match(clipTemplate, /data-hot-load="after"[^>]*>뒤 30초/u);
  assert.match(css, /\.clip-hot-load-actions\s*\{/u);
  const virtualClip = sectionFrom(
    source,
    "function shortFormSourceAssetVirtualClip(",
    "function shortFormSourceAssetForMediaEngine"
  );
  const workspaceCoverage = sectionFrom(
    source,
    "function vodWorkspaceClips(",
    "function enabledChzzkVodClips("
  );

  assert.match(virtualClip, /sourceStartMs: asset\.sourceStartMs/u);
  assert.match(virtualClip, /sourceEndMs: asset\.sourceEndMs/u);
  assert.match(virtualClip, /startMs: asset\.sourceSelectionStartMs/u);
  assert.match(virtualClip, /endMs: asset\.sourceSelectionEndMs/u);
  assert.match(virtualClip, /selectionStartMs: sourceAnchor\.startMs/u);
  assert.match(virtualClip, /selectionEndMs: sourceAnchor\.endMs/u);
  assert.match(virtualClip, /timelineStartMs: asset\.timelineStartMs/u);
  assert.match(virtualClip, /shortFormSourceClipId: asset\.sourceClipId/u);

  assert.match(workspaceCoverage, /workspaceMode === "short-form"/u);
  assert.match(workspaceCoverage, /append\(sourceClockRootProject\.clips\)/u);
  assert.match(workspaceCoverage, /append\(sourceClockProject\.clips\)/u);
  assert.match(workspaceCoverage, /candidate\?\.shortForm\?\.videoAssets/u);
  assert.match(workspaceCoverage, /candidate\?\.shortForm\?\.sourceAudioAssets/u);
  assert.match(workspaceCoverage, /vodSourceAnchorForShortAsset\(/u);
  assert.match(workspaceCoverage, /collected\.push\(shortFormSourceAssetVirtualClip\(/u);
  assert.match(workspaceCoverage, /appendSourceAssets\(sourceClockProject\)/u);
  assert.doesNotMatch(workspaceCoverage, /appendSourceAssets\(sourceClockRootProject\)/u);
  assert.match(workspaceCoverage, /clip\.shortFormCanvasClock === true/u);
  assert.doesNotMatch(workspaceCoverage, /shortForm\?\.clips/u);
});

test("쇼츠 내보내기 확인 fingerprint는 revision을 올리는 저장 snapshot을 만들지 않는다", async () => {
  const source = await readFile(
    new URL("../src/editor/main.ts", import.meta.url),
    "utf8"
  );
  const fingerprint = sectionFrom(
    source,
    "function exportOptionsProjectFingerprint(",
    "function renderExportOptionsPreflight("
  );
  assert.match(
    fingerprint,
    /exportKind === "short-form"[\s\S]*workspaceId: currentShortWorkspaceId\(\)[\s\S]*shortForm: project\.shortForm[\s\S]*: persistedProjectSnapshot\(\)/u
  );
  assert.doesNotMatch(
    fingerprint,
    /persistedProjectSnapshot\(\)\.shortForm/u
  );
});

test("v7 쇼츠 브랜치는 영상 라인·블록별 음량과 구형 독립 음성 호환 데이터를 저장한다", async () => {
  const source = await readFile(
    new URL("../src/lib/short-form.ts", import.meta.url),
    "utf8"
  );
  const videoAsset = sectionFrom(
    source,
    "export interface ShortFormVideoAsset {",
    "export type ShortFormVideoAssetInput"
  );
  const sourceAudioAsset = sectionFrom(
    source,
    "export interface ShortFormSourceAudioAsset {",
    "export type ShortFormSourceAudioAssetInput"
  );
  const branch = sectionFrom(
    source,
    "export interface EditorShortFormBranch",
    "export interface ShortFormNormalizationContext"
  );
  const compatibilityViews = sectionFrom(
    source,
    "function attachLegacyCompatibilityViews(",
    "export function createDefaultShortFormBranch("
  );
  const defaults = sectionFrom(
    source,
    "export function createDefaultShortFormBranch()",
    "export function normalizeShortFormBranch("
  );
  const migrateV6 = sectionFrom(
    source,
    "function migrateV6Branch(",
    "function migrateLegacyBranch("
  );
  const addVideoLane = sectionFrom(
    source,
    "export function addShortFormVideoLane(",
    "export function addShortFormVideoAsset("
  );
  const fromWorkspace = sectionFrom(
    source,
    "export function shortFormBranchFromWorkspace(",
    "export function deriveShortFormRenderProject("
  );
  const toWorkspace = sectionFrom(
    source,
    "export function createShortFormWorkspaceProject(",
    "export function shortFormBranchFromWorkspace("
  );
  const appendSlices = sectionFrom(
    source,
    "export function appendShortFormSlices(",
    "export function appendShortFormClips("
  );
  const removeVideo = sectionFrom(
    source,
    "export function removeShortFormVideoAsset(",
    "export function reorderShortFormVideoAssets("
  );
  const activeVideos = sectionFrom(
    source,
    "export function shortFormVideoAssetsAtTimeline(",
    "export function shortFormVideoLayersAtTimeline("
  );

  assert.match(source, /SHORT_FORM_SCHEMA_VERSION = 7/u);
  assert.match(source, /SHORT_FORM_SCHEMA = "kirinuki-short-form\/v7"/u);
  assert.match(source, /LEGACY_SHORT_FORM_SCHEMA_V6 = "kirinuki-short-form\/v6"/u);
  assert.match(source, /LEGACY_SHORT_FORM_SCHEMA_V5 = "kirinuki-short-form\/v5"/u);
  for (const field of [
    "sourceSelectionStartMs",
    "sourceSelectionEndMs",
    "sourceStartMs",
    "sourceEndMs",
    "timelineStartMs",
    "timelineEndMs",
    "sourceRect",
    "destinationRect",
    "opacity",
    "visible",
    "zIndex",
    "lane",
    "audioGain"
  ]) {
    assert.match(videoAsset, new RegExp(`${field}:`, "u"));
  }
  for (const field of [
    "sourceSelectionStartMs",
    "sourceSelectionEndMs",
    "sourceStartMs",
    "sourceEndMs",
    "timelineStartMs",
    "timelineEndMs",
    "gain",
    "muted",
    "fadeInMs",
    "fadeOutMs"
  ]) {
    assert.match(sourceAudioAsset, new RegExp(`${field}:`, "u"));
  }
  for (const field of [
    "durationMs",
    "videoLaneCount",
    "videoAssets",
    "sourceAudioAssets",
    "subtitles",
    "imageAssets",
    "audioRegions"
  ]) {
    assert.match(branch, new RegExp(`${field}:`, "u"));
  }

  assert.match(defaults, /durationMs: SHORT_FORM_DEFAULT_CANVAS_DURATION_MS/u);
  assert.match(defaults, /videoLaneCount: SHORT_FORM_MIN_VIDEO_LANES/u);
  assert.match(defaults, /videoAssets: \[\]/u);
  assert.match(defaults, /sourceAudioAssets: \[\]/u);
  assert.match(defaults, /selectedClipId: SHORT_FORM_CANVAS_CLIP_ID/u);
  assert.match(compatibilityViews, /Object\.defineProperties\(result/u);
  assert.match(compatibilityViews, /clips: \{ value: clips, enumerable: false/u);
  assert.match(compatibilityViews, /scenes: \{ value: scenes, enumerable: false/u);
  assert.match(migrateV6, /laneEndMs\.findIndex[\s\S]*endMs <= candidate\.timelineStartMs/u);
  assert.match(migrateV6, /lane: assignedLanes\.get\(index\) \?\? 0,[\s\S]*audioGain: 1/u);
  assert.match(migrateV6, /videoLaneCount: Math\.max\([\s\S]*SHORT_FORM_MIN_VIDEO_LANES[\s\S]*laneEndMs\.length/u);
  assert.match(addVideoLane, /previous\.videoLaneCount \+ 1/u);
  assert.match(addVideoLane, /videoLaneCount,[\s\S]*revision: nextRevision\(previous\)/u);

  assert.match(toWorkspace, /clips: \[shortFormCanvasClip\(shortForm\.durationMs\)\]/u);
  assert.match(toWorkspace, /shortForm,/u);
  assert.match(toWorkspace, /selectedClipId: SHORT_FORM_CANVAS_CLIP_ID/u);
  assert.doesNotMatch(toWorkspace, /shortForm\.clips\.map/u);

  assert.match(fromWorkspace, /const previous = normalizeShortFormBranch/u);
  assert.match(fromWorkspace, /\.\.\.previous,[\s\S]*durationMs,/u);
  assert.match(fromWorkspace, /subtitles: workspaceProject\.subtitles/u);
  assert.match(fromWorkspace, /imageAssets: workspaceProject\.imageAssets/u);
  assert.match(fromWorkspace, /audioRegions: workspaceProject\.audioRegions/u);
  assert.match(fromWorkspace, /selectedVideoLayerId: workspaceProject\.shortForm\?\.selectedVideoLayerId/u);
  assert.match(fromWorkspace, /selectedSourceAudioAssetId: workspaceProject\.shortForm\?\.selectedSourceAudioAssetId/u);

  assert.match(appendSlices, /previous\.videoAssets\.length > 0/u);
  assert.match(appendSlices, /previous\.sourceAudioAssets\.length > 0/u);
  assert.match(appendSlices, /timelineCursorMs = hasAuthoredCanvasContent \? previous\.durationMs : 0/u);
  assert.match(appendSlices, /rawVideoAssets\.push\(\{[\s\S]*timelineStartMs,[\s\S]*timelineEndMs,[\s\S]*sourceRect,[\s\S]*destinationRect/u);
  assert.match(appendSlices, /rawAudioAssets\.push\(\{[\s\S]*timelineStartMs,[\s\S]*timelineEndMs,[\s\S]*gain: 1,[\s\S]*muted: false/u);
  assert.match(appendSlices, /videoAssets: rawVideoAssets,[\s\S]*sourceAudioAssets: rawAudioAssets/u);

  assert.match(removeVideo, /videoAssets = previous\.videoAssets\.filter/u);
  assert.match(removeVideo, /\.\.\.previous,[\s\S]*videoAssets,/u);
  assert.doesNotMatch(removeVideo, /subtitles: \[\]|imageAssets: \[\]|audioRegions: \[\]|sourceAudioAssets: \[\]/u);
  assert.match(activeVideos, /timelineMs >= asset\.timelineStartMs && timelineMs < asset\.timelineEndMs/u);
  assert.match(activeVideos, /sourceTimeMs: asset\.sourceStartMs \+ timelineMs - asset\.timelineStartMs/u);
  assert.match(activeVideos, /left\.zIndex - right\.zIndex/u);
});

test("본편 범위를 컷 경계마다 분해해 정확한 쇼츠 조각으로 append한다", async () => {
  const source = await readFile(
    new URL("../src/editor/main.ts", import.meta.url),
    "utf8"
  );
  const bindings = sectionFrom(source, "function bindActions()", "async function initialize()");
  const composerStart = sectionFrom(
    source,
    "function startShortSourceComposer()",
    "function cancelShortSourceComposer("
  );
  const requests = sectionFrom(
    source,
    "function shortSourceSliceRequests(",
    "async function commitShortSource("
  );
  const commit = sectionFrom(
    source,
    "async function commitShortSource(",
    "function exactShortWorkspaceGeometry("
  );

  assert.match(
    bindings,
    /open_short_form\.addEventListener\("click", \(\) => \{[\s\S]*enterShortFormWorkspace\(\)/u
  );
  assert.doesNotMatch(bindings, /openShortFormDialog/u);
  assert.doesNotMatch(source, /send_clips_to_short/u);
  assert.match(bindings, /start_short_source_composer\.addEventListener\([\s\S]*startShortSourceComposer/u);
  assert.match(bindings, /add_short_source_only\.addEventListener\("click"[\s\S]*commitShortSource\(false\)/u);
  assert.match(bindings, /add_short_source_and_open\.addEventListener\("click"[\s\S]*commitShortSource\(true\)/u);
  assert.match(composerStart, /shortSourceComposerActive = true/u);
  assert.match(composerStart, /timelineRangePurpose = "short-source"/u);
  assert.match(composerStart, /shortSourceCropDraft = normalizeShortSourceCropDraft\(\{[\s\S]*x: 0,[\s\S]*y: 0,[\s\S]*width: 1,[\s\S]*height: 1/u);
  assert.match(requests, /project\.clips\.flatMap\(\(clip\) =>/u);
  assert.match(requests, /clip\.enabled === false[\s\S]*return \[\]/u);
  assert.match(requests, /overlapStartMs = Math\.max\(range\.startMs, clipStartMs\)/u);
  assert.match(requests, /overlapEndMs = Math\.min\(range\.endMs, clipEndMs\)/u);
  assert.match(requests, /clip\.sourceStartMs \+ overlapStartMs - clipStartMs/u);
  assert.match(requests, /clip\.sourceStartMs \+ overlapEndMs - clipStartMs/u);
  assert.match(requests, /sourceRect: \{ \.\.\.sourceRect \}/u);
  assert.match(requests, /destinationRect: \{ \.\.\.destinationRect \}/u);
  assert.match(commit, /appendShortSourceVideoAssets\([\s\S]*project,[\s\S]*requests,[\s\S]*videoAssetTargetTimelineMs/u);
  assert.doesNotMatch(commit, /appendShortFormSlices\(/u);
  assert.match(commit, /const nextProject = \{[\s\S]*shortForm/u);
  assert.match(commit, /applyProject\(nextProject/u);
  assert.match(commit, /const shouldOpenShortWorkspace = \([\s\S]*videoAssetTargetTimelineMs !== null \|\| openShortWorkspace/u);
  assert.match(commit, /if \(shouldOpenShortWorkspace\) \{[\s\S]*await enterShortFormWorkspace\(\)/u);
});

test("쇼츠 소스는 컷 경계의 0.1초 미만 조각을 조용히 버리지 않고 숫자 입력을 보존한다", async () => {
  const source = await readFile(
    new URL("../src/editor/main.ts", import.meta.url),
    "utf8"
  );
  const slices = sectionFrom(
    source,
    "function shortSourceSliceRequests(",
    "async function commitShortSource("
  );
  const commit = sectionFrom(
    source,
    "async function commitShortSource(",
    "function replaceShortWorkspaceFraming("
  );
  const composer = sectionFrom(
    source,
    "function renderShortSourceComposer()",
    "function setShortSourceAspect("
  );
  const defaultRange = sectionFrom(
    source,
    "function defaultShortSourceRange()",
    "function startShortSourceComposer("
  );

  assert.match(slices, /overlapDurationMs <= 0/u);
  assert.match(slices, /overlapDurationMs < MIN_TIMELINE_RANGE_MS/u);
  assert.match(slices, /컷 경계에서 0\.1초 미만 영상 조각/u);
  assert.match(commit, /try \{[\s\S]*shortSourceSliceRequests\(range, crop\)[\s\S]*catch/u);
  assert.match(defaultRange, /enabledClipAtTimeline\(playheadMs\)/u);
  for (const id of [
    "short_source_crop_x",
    "short_source_crop_y",
    "short_source_crop_width",
    "short_source_crop_height"
  ]) {
    assert.match(composer, new RegExp(`setInputValue\\(elements\\.${id},`, "u"));
  }
});

test("쇼츠 소스 선택 범위는 본편에서만 유지하고 쇼츠 워크스페이스에서는 구간 선택 UI를 숨긴다", async () => {
  const source = await readFile(
    new URL("../src/editor/main.ts", import.meta.url),
    "utf8"
  );
  const rangeUi = sectionFrom(
    source,
    "function renderTimelineRange()",
    "function setTimelineRangeBoundary("
  );
  const deletion = sectionFrom(
    source,
    "function deleteSelectedTimelineRange()",
    "function setTimedBlockGeometry("
  );

  assert.match(
    rangeUi,
    /workspaceMode === "short-form"[\s\S]*timelineRangePurpose = "delete"[\s\S]*rangeStartMs = null[\s\S]*rangeEndMs = null[\s\S]*rangeTools\.hidden = true[\s\S]*timeline_range_selection\.hidden = true[\s\S]*range_start_handle\.hidden = true[\s\S]*range_end_handle\.hidden = true[\s\S]*return;/u
  );
  assert.match(rangeUi, /const choosingShortSource = \([\s\S]*workspaceMode === "main"[\s\S]*shortSourceComposerActive[\s\S]*timelineRangePurpose === "short-source"/u);
  assert.match(
    rangeUi,
    /delete_range\.hidden = choosingShortSource/u
  );
  assert.match(rangeUi, /delete_range\.disabled = \([\s\S]*choosingShortSource/u);
  assert.match(rangeUi, /dataset\.rangePurpose = choosingShortSource[\s\S]*\? "short-source"[\s\S]*: "delete"/u);
  assert.doesNotMatch(rangeUi, /short-canvas-trim|shortCanvasTrimActive/u);
  assert.match(deletion, /workspaceMode === "short-form"[\s\S]*영상 블록의 양끝을 직접 자르거나 블록을 삭제/u);
  assert.match(deletion, /timelineRangePurpose === "short-source" \|\| shortSourceComposerActive/u);
  assert.match(deletion, /쇼츠 소스 작성 중에는 선택 구간이 삭제되지 않습니다/u);
  assert.doesNotMatch(deletion, /trimShortCanvas|applyShortCanvasTrim/u);
});

test("쇼츠 캔버스는 수동 구간 선택 없이 앞뒤 빈 구간 자동 제거만 제공한다", async () => {
  const [html, css, source] = await Promise.all([
    readFile(new URL("../web/editor.html", import.meta.url), "utf8"),
    readFile(new URL("../web/editor/editor.css", import.meta.url), "utf8"),
    readFile(new URL("../src/editor/main.ts", import.meta.url), "utf8")
  ]);
  const rangeUi = sectionFrom(
    source,
    "function renderTimelineRange()",
    "function setTimelineRangeBoundary("
  );
  const trim = sectionFrom(
    source,
    "function trimShortCanvasEmptyEdges(",
    "function deleteSelectedTimelineRange()"
  );
  const bindings = sectionFrom(source, "function bindActions()", "async function initialize()");

  assert.match(html, /id="trim-short-canvas-empty-edges"[^>]*hidden[^>]*>앞뒤 빈 구간 제거</u);
  assert.match(html, /id="range-start-handle"[^>]*role="slider"[^>]*aria-label="삭제 구간 시작 시각"/u);
  assert.match(html, /id="range-end-handle"[^>]*role="slider"[^>]*aria-label="삭제 구간 끝 시각"/u);
  assert.match(source, /type TimelineRangePurpose = "delete" \| "short-source"/u);
  assert.doesNotMatch(source, /"short-canvas-trim"|applyShortCanvasTrim|trimShortFormCanvasRange/u);
  assert.match(rangeUi, /workspaceMode === "short-form"[\s\S]*rangeTools\.hidden = true/u);
  assert.match(rangeUi, /rangeStartMs = null[\s\S]*rangeEndMs = null/u);
  assert.match(rangeUi, /timeline_range_selection\.hidden = true[\s\S]*range_start_handle\.hidden = true[\s\S]*range_end_handle\.hidden = true/u);
  assert.match(rangeUi, /trim_short_canvas_empty_edges\.hidden = false/u);
  assert.match(rangeUi, /shortFormCanvasContentRange\(project\.shortForm\)/u);
  assert.match(rangeUi, /contentRange\.startMs > 0 \|\| contentRange\.endMs < durationMs/u);
  assert.doesNotMatch(css, /timeline-range-selection\[data-range-purpose="short-canvas-trim"\]/u);
  assert.match(css, /short-canvas-empty-trim-button/u);

  assert.match(trim, /stopShortCanvasPlayback\(\)[\s\S]*playheadMs: project\.playheadMs/u);
  assert.match(trim, /trimShortFormCanvasToContent\(branchAtCurrentPlayhead\)/u);
  assert.doesNotMatch(trim, /trimShortFormCanvasRange|range:\s*selectedTimelineRange/u);
  assert.match(trim, /shortFormWorkspaceProjectWithBranch\(project, shortForm\)/u);
  assert.match(trim, /rangeStartMs = null[\s\S]*rangeEndMs = null[\s\S]*applyProject\(/u);
  assert.equal((trim.match(/applyProject\(/gu) || []).length, 1);
  assert.match(bindings, /trim_short_canvas_empty_edges\.addEventListener\("click"[\s\S]*trimShortCanvasEmptyEdges\(\)/u);
  assert.match(bindings, /range_start_handle, "start"[\s\S]*range_end_handle, "end"/u);
  assert.match(bindings, /bindTimelineRangeHandle\(handle, side, event\)/u);
  assert.match(bindings, /event\.shiftKey \? 1_000 : 100[\s\S]*nudgeTimelineRangeBoundary/u);
});

test("진입·복귀는 본편과 쇼츠의 상태·undo를 분리하고 저장 완료 뒤 전환한다", async () => {
  const source = await readFile(
    new URL("../src/editor/main.ts", import.meta.url),
    "utf8"
  );
  const enter = sectionFrom(
    source,
    "async function enterShortFormWorkspace()",
    "async function exitShortFormWorkspace({"
  );
  const exit = sectionFrom(
    source,
    "async function exitShortFormWorkspace({",
    "async function restoreShortWorkspaceAfterSourcePicker()"
  );

  assert.doesNotMatch(enter, /hasShortFormWorkspace/u);
  assert.match(enter, /await flushSave\(\)/u);
  assert.match(enter, /await waitForProjectSaves\(\)/u);
  assert.match(enter, /rootProject = cloneProject\(project\)/u);
  assert.match(enter, /mainWorkspaceUndoStack = undoStack/u);
  assert.match(enter, /mainWorkspaceRedoStack = redoStack/u);
  assert.match(enter, /entryUndoHistory = pendingShortWorkspaceUndoHistory/u);
  assert.match(enter, /workspaceHistory = shortWorkspaceHistory\.get\(currentShortWorkspaceId\(\)\)/u);
  assert.match(enter, /undoStack = entryUndoHistory\?\.map\(cloneProject\)[\s\S]*workspaceHistory\?\.undo\.map\(cloneProject\)[\s\S]*\|\| \[\]/u);
  assert.match(enter, /project = createShortFormWorkspaceProject\(rootProject\)/u);
  assert.doesNotMatch(enter, /clips\.length === 0[\s\S]*return false/u);
  assert.match(enter, /workspaceMode = "short-form"/u);
  assert.match(enter, /redoStack = entryUndoHistory[\s\S]*workspaceHistory\?\.redo\.map\(cloneProject\) \|\| \[\]/u);
  assert.match(enter, /updateShortWorkspaceUrl\(true\)/u);

  assert.match(exit, /await flushSave\(\)/u);
  assert.match(exit, /await waitForProjectSaves\(\)/u);
  assert.match(
    exit,
    /stopShortCanvasPlayback\(\);\s*elements\.preview_video\.pause\(\);\s*cancelScheduledShortWorkspacePreview\(\);\s*releaseShortPreviewAdaptiveScaler\(\);\s*releaseShortPreviewFallbackSurface\(\);\s*releaseShortPreviewLayerVideos\(\);/u,
    "쇼츠 종료는 대기 중인 영상 프레임·preview draw를 취소하고 GPU·Canvas surface를 모두 해제해야 합니다."
  );
  assert.match(exit, /project = restoredRoot/u);
  assert.match(exit, /workspaceMode = "main"/u);
  assert.match(exit, /restoredMainUndoStack = rebaseMainWorkspaceHistory\(/u);
  assert.match(exit, /restoredMainRedoStack = rebaseMainWorkspaceHistory\(/u);
  assert.match(exit, /undoStack = restoredMainUndoStack/u);
  assert.match(exit, /redoStack = restoredMainRedoStack/u);
  assert.match(exit, /updateShortWorkspaceUrl\(false\)/u);
  assert.doesNotMatch(source, /KIRINUKI_CAPTURE_SEED_UPDATED|flushPendingCaptureSeed/u);
});

test("추가하고 쇼츠 열기는 기존 쇼츠 undo 이력과 추가 직전 branch를 함께 넘긴다", async () => {
  const source = await readFile(
    new URL("../src/editor/main.ts", import.meta.url),
    "utf8"
  );
  const commit = sectionFrom(
    source,
    "async function commitShortSource(",
    "function replaceShortWorkspaceFraming("
  );

  assert.match(commit, /const preAddProject = cloneProject\(project\)/u);
  assert.match(
    commit,
    /const undoHistory = pickerReturnState[\s\S]*\? \[\.\.\.pickerReturnState\.undoStack, pickerReturnState\.workspaceProject\][\s\S]*: \[createShortFormWorkspaceProject\(preAddProject\)\]/u
  );
  assert.match(commit, /pendingShortWorkspaceUndoHistory = undoHistory\.slice\(-60\)/u);
  assert.match(commit, /applyProject\(nextProject, \{ record: false \}\)/u);
  assert.match(commit, /else \{\s*applyProject\(nextProject\)/u);
  assert.match(commit, /finally \{\s*pendingShortWorkspaceUndoHistory = null/u);
});

test("모든 쇼츠 변경은 rootProject의 shortForm으로 환원된 스냅샷만 영속화한다", async () => {
  const source = await readFile(
    new URL("../src/editor/main.ts", import.meta.url),
    "utf8"
  );
  const canonicalize = sectionFrom(
    source,
    "function canonicalizeShortWorkspaceProject(",
    "function applyProject("
  );
  const syncRoot = sectionFrom(
    source,
    "function syncRootProjectFromActiveWorkspace()",
    "function persistedProjectSnapshot()"
  );
  const persisted = sectionFrom(
    source,
    "function persistedProjectSnapshot()",
    "async function saveActiveWorkspaceImmediately("
  );
  const schedule = sectionFrom(source, "function scheduleSave()", "function flushSave()");

  assert.match(canonicalize, /workspaceMode !== "short-form"/u);
  assert.match(canonicalize, /shortFormBranchFromWorkspace\([\s\S]*parentWithLatestFraming,[\s\S]*next/u);
  assert.match(canonicalize, /rootProject = \{[\s\S]*\.\.\.alignedRootProject,[\s\S]*shortForm/u);
  assert.match(syncRoot, /shortFormBranchFromWorkspace\([\s\S]*rootProject,[\s\S]*project/u);
  assert.match(syncRoot, /rootProject = \{[\s\S]*shortForm,[\s\S]*updatedAt/u);
  assert.match(persisted, /cloneProject\(syncRootProjectFromActiveWorkspace\(\)\)/u);
  assert.match(schedule, /pendingSaveSnapshot = persistedProjectSnapshot\(\)/u);
  assert.doesNotMatch(schedule, /pendingSaveSnapshot = cloneProject\(project\)/u);
});

test("쇼츠의 전역 clock과 최신 branch를 root 본편 및 parked history에 함께 rebase한다", async () => {
  const source = await readFile(
    new URL("../src/editor/main.ts", import.meta.url),
    "utf8"
  );
  const canonicalize = sectionFrom(
    source,
    "function canonicalizeShortWorkspaceProject(",
    "function applyProject("
  );
  const rebaseHistory = sectionFrom(
    source,
    "function rebaseMainWorkspaceHistory(",
    "async function enterShortFormWorkspace()"
  );

  assert.match(
    canonicalize,
    /applyMediaAlignmentOffset\(rootProject, nextOffsetMs\)/u,
    "쇼츠에서 수동 정렬값이 바뀌면 root main clips도 같은 delta로 옮겨야 합니다."
  );
  assert.match(canonicalize, /\.\.\.alignedRootProject/u);
  assert.match(
    rebaseHistory,
    /applyMediaAlignmentOffset\(snapshot, targetOffsetMs\)/u
  );
  assert.match(
    rebaseHistory,
    /shortForm: cloneProject\(currentRootProject\.shortForm\)/u,
    "쇼츠에서 돌아온 뒤 본편 undo가 이전 shortForm branch를 되살리면 안 됩니다."
  );
  assert.match(
    rebaseHistory,
    /runtimeTransportBoundProjectSnapshot\([\s\S]*currentRootProject\.mediaAsset/u
  );
});

test("v7 검은 캔버스 미리보기와 내보내기는 영상 에셋의 같은 정확 좌표·전역 clock을 쓴다", async () => {
  const [html, css, source, mediaEngine] = await Promise.all([
    readFile(new URL("../web/editor.html", import.meta.url), "utf8"),
    readFile(new URL("../web/editor/editor.css", import.meta.url), "utf8"),
    readFile(new URL("../src/editor/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/editor/media-engine.ts", import.meta.url), "utf8")
  ]);
  const preview = sectionFrom(
    source,
    "function shortPreviewLayerGeometry(",
    "function drawMultiLayerShortWorkspacePreview("
  );
  const previewComposite = sectionFrom(
    source,
    "function drawMultiLayerShortWorkspacePreview(",
    "function drawShortWorkspacePreviewStatus("
  );
  const previewFrame = sectionFrom(
    source,
    "function drawShortWorkspacePreview()",
    "function renderShortSourceComposer("
  );
  const validation = sectionFrom(
    mediaEngine,
    "export function validateShortFormCanvasRenderLayout(",
    "export function shortFormCanvasCfrFrameRange("
  );
  const renderAttemptStart = mediaEngine.indexOf(
    "async function renderProjectVideoAttempt("
  );
  assert.notEqual(renderAttemptStart, -1);
  const renderAttempt = mediaEngine.slice(renderAttemptStart);
  const canvasPump = sectionFrom(
    renderAttempt,
    "if (shortFormCanvas) {",
    "if (!videoSink) {"
  );

  assert.match(html, /id="short-workspace-preview"[\s\S]*width="540"[\s\S]*height="960"/u);
  assert.match(css, /\.editor-shell\[data-workspace="short-form"\] \.stage \{[\s\S]*aspect-ratio:\s*9 \/ 16/u);
  assert.match(css, /\.editor-shell\[data-workspace="short-form"\] \.image-asset-overlays,[\s\S]*\.subtitle-overlays,[\s\S]*aspect-ratio:\s*9 \/ 16/u);
  assert.match(
    source,
    /import \{ AdaptiveVideoScaler \} from "\.\/adaptive-video-scaler\.js"/u
  );
  assert.match(preview, /normalizeShortFormSourceRect\(layer\.sourceRect\)/u);
  assert.match(preview, /normalizeShortFormDestinationRect\([\s\S]*layer\.destinationRect/u);
  assert.match(preview, /shortFormSourceCropFromNormalizedRect\([\s\S]*video\.videoWidth,[\s\S]*video\.videoHeight,[\s\S]*sourceRect/u);
  assert.match(preview, /shortFormDestinationRectForTarget\([\s\S]*outputWidth,[\s\S]*outputHeight,[\s\S]*destinationRect/u);
  assert.doesNotMatch(preview, /scene|resolveShortFormRenderScene|fit|cover/u);

  assert.match(previewComposite, /visibleLayers = layers\.filter\(\(layer\) => layer\.visible && layer\.opacity > 0\)/u);
  assert.match(previewComposite, /fallback\.context\.fillStyle = "#000"[\s\S]*fillRect\([\s\S]*width,[\s\S]*height/u);
  assert.match(previewComposite, /adaptiveScaler\.renderHtmlVideo\(video, \{[\s\S]*sourceRect:[\s\S]*destinationRect:[\s\S]*outputWidth: width,[\s\S]*outputHeight: height/u);
  assert.match(previewComposite, /fallback\.context\.globalAlpha = layer\.opacity/u);
  assert.match(previewComposite, /fallback\.context\.drawImage\([\s\S]*geometry\.source\.left[\s\S]*geometry\.destination\.left/u);
  assert.match(previewComposite, /context\.drawImage\([\s\S]*fallback\.surface,[\s\S]*width,[\s\S]*height/u);
  assert.match(previewFrame, /const previewTimelineMs = shortCanvasTimelineMsFromClock\(\)/u);
  assert.match(previewFrame, /shortFormVideoAssetsAtTimeline\([\s\S]*project\.shortForm,[\s\S]*previewTimelineMs/u);
  assert.doesNotMatch(previewFrame, /shortFormVideoLayersAtTimeline|project\.shortForm\.scenes/u);

  assert.match(
    source,
    /function shortFormQualityAssessment\([\s\S]*shortFormSourceCropFromNormalizedRect\([\s\S]*shortFormDestinationRectForTarget\(/u,
    "품질 검사도 preview/export와 같은 정수 픽셀 geometry를 사용해야 합니다."
  );
  assert.match(validation, /Array\.isArray\(layout\.videoAssets\)/u);
  assert.match(validation, /Array\.isArray\(layout\.sourceAudioAssets\)/u);
  assert.match(validation, /videoAssets: normalizedVideoAssets\.sort\([\s\S]*left\.zIndex - right\.zIndex/u);
  assert.match(canvasPump, /visibleAssets = shortFormCanvas\.videoAssets\.filter/u);
  assert.match(canvasPump, /shortFormVideoAssetSourceTimeMs\(asset, timelineMs\)/u);
  assert.match(canvasPump, /context\.fillStyle = RENDER_LETTERBOX_COLOR[\s\S]*context\.fillRect\(0, 0, width, height\)/u);
  assert.match(canvasPump, /left\.asset\.zIndex - right\.asset\.zIndex/u);
  assert.match(canvasPump, /shortFormVideoAssetDrawGeometry\([\s\S]*asset/u);
  assert.match(canvasPump, /drawShortFormVideoSample\([\s\S]*asset\.opacity/u);
  assert.match(canvasPump, /activeImageAssetCache\.prepareAt[\s\S]*activeCuesAt\(project/u);
  assert.doesNotMatch(canvasPump, /resolveShortFormRenderScene|shortFormScene|additionalLayerStreamGroups/u);
  assert.match(mediaEngine, /export function drawShortFormVideoSample\([\s\S]*geometry\.source\.left[\s\S]*geometry\.source\.height/u);
  assert.match(source, /video\.requestVideoFrameCallback\([\s\S]*scheduleShortWorkspacePreview\(\)/u);
  assert.doesNotMatch(
    sectionFrom(source, "function renderAll(options = {})", "function sourceMsToPreviewSeconds("),
    /drawShortWorkspacePreview\(\)/u
  );
  assert.match(mediaEngine, /export function drawShortFormVideoSample\([\s\S]*geometry\.destination\.left[\s\S]*geometry\.destination\.height/u);
});

test("모든 v7 영상 에셋은 같은 픽셀 inspector·8방향 overlay를 쓰고 scene UI는 숨긴다", async () => {
  const [html, css, source] = await Promise.all([
    readFile(new URL("../web/editor.html", import.meta.url), "utf8"),
    readFile(new URL("../web/editor/editor.css", import.meta.url), "utf8"),
    readFile(new URL("../src/editor/main.ts", import.meta.url), "utf8")
  ]);
  const inspector = sectionFrom(
    html,
    'id="short-framing-inspector-content"',
    "</aside>"
  );
  const legacy = sectionFrom(
    inspector,
    'id="short-workspace-legacy-framing"',
    "</details>"
  );
  const render = sectionFrom(
    source,
    "function renderShortFramingInspector()",
    "function renderPropertyInspector()"
  );
  const replace = sectionFrom(
    source,
    "function replaceShortWorkspaceFraming(",
    "function exactShortWorkspaceGeometry("
  );
  const overlay = sectionFrom(
    source,
    "function renderShortWorkspaceTransformOverlay()",
    "function destinationRectWithAspect("
  );
  const propertyInspector = sectionFrom(
    source,
    "function renderPropertyInspector()",
    "function renderCueList()"
  );
  const imageOverlays = sectionFrom(
    source,
    "async function renderImageAssetOverlays()",
    "function renderSubtitleOverlay()"
  );
  const subtitleOverlays = sectionFrom(
    source,
    "function renderSubtitleOverlay()",
    "function shortCanvasTimelineMsFromClock()"
  );
  const bindings = sectionFrom(source, "function bindActions()", "async function initialize()");

  for (const id of [
    "short-workspace-source",
    "short-workspace-duration",
    "short-workspace-transform-controls",
    "short-workspace-destination-x",
    "short-workspace-destination-y",
    "short-workspace-destination-width",
    "short-workspace-destination-height",
    "short-workspace-destination-lock-aspect",
    "short-workspace-destination-readout",
    "short-workspace-legacy-framing",
    "short-workspace-safe-area",
    "reset-short-workspace-framing",
    "copy-short-workspace-framing",
    "delete-short-video-layer"
  ]) {
    assert.match(inspector, new RegExp(`id="${id}"`, "u"));
  }
  assert.doesNotMatch(inspector, /id="delete-short-workspace-clip"/u);
  for (const legacyId of [
    "short-workspace-fit",
    "short-workspace-zoom",
    "short-workspace-crop-x",
    "short-workspace-crop-y",
    "short-workspace-scale",
    "short-workspace-position-x",
    "short-workspace-position-y",
    "short-workspace-position-presets"
  ]) {
    assert.match(legacy, new RegExp(`id="${legacyId}"`, "u"));
  }
  assert.deepEqual(
    attributeValues(html, "data-short-workspace-transform-handle"),
    ["nw", "n", "ne", "e", "se", "s", "sw", "w"]
  );
  assert.match(render, /const selectedLayer = activeShortWorkspaceVideoLayer\(\)/u);
  assert.match(render, /const sourceRect = normalizeShortFormSourceRect\(selectedLayer\?\.sourceRect\)/u);
  assert.match(render, /const destinationRect = normalizeShortFormDestinationRect\([\s\S]*selectedLayer\?\.destinationRect/u);
  assert.match(render, /const exactGeometry = sourceRect && destinationRect/u);
  assert.match(render, /short_workspace_transform_controls\.hidden = !exactGeometry/u);
  assert.match(render, /short_workspace_legacy_framing\.hidden = true/u);
  assert.match(render, /setDestinationInput\([\s\S]*short_workspace_destination_x[\s\S]*destinationRect\.x/u);
  assert.match(render, /setDestinationInput\([\s\S]*short_workspace_destination_y[\s\S]*destinationRect\.y/u);
  assert.match(render, /setDestinationInput\([\s\S]*short_workspace_destination_width[\s\S]*destinationRect\.width/u);
  assert.match(render, /setDestinationInput\([\s\S]*short_workspace_destination_height[\s\S]*destinationRect\.height/u);
  assert.match(render, /short_workspace_fit\.disabled = true/u);
  assert.doesNotMatch(render, /delete_short_workspace_clip/u);
  assert.match(render, /영상이 없는 시간도 정상 편집 상태입니다/u);
  assert.match(render, /빈 1080×1920 쇼츠 화면/u);
  assert.match(render, /쇼츠 \$\{formatTime\(selectedLayer\.timelineStartMs/u);
  assert.match(render, /원본 \$\{formatTime\(selectedLayer\.sourceStartMs/u);
  assert.doesNotMatch(render, /sameSourceScenes|selectedLayer\?\.kind|scene/u);

  assert.match(replace, /Partial<Pick<ShortFormVideoAsset, "sourceRect" \| "destinationRect">>/u);
  assert.match(replace, /targetIds = all[\s\S]*shortForm\.videoAssets\.map/u);
  assert.match(replace, /updateShortFormVideoAsset\(shortForm, assetId, assetUpdate\)/u);
  assert.match(replace, /applyFieldProject\(next, fieldKey\)/u);
  assert.match(replace, /applyProject\(next\)/u);
  assert.doesNotMatch(replace, /updateShortFormSceneFraming|\.scenes|\.kind/u);
  assert.match(
    overlay,
    /workspaceMode === "short-form"[\s\S]*propertyInspectorMode === "framing"[\s\S]*exactShortWorkspaceGeometry\(\)/u,
    "영상 transform overlay는 영상 속성 tab에서만 활성화해야 합니다."
  );
  assert.match(overlay, /short_workspace_transform_layer\.hidden = !geometry/u);
  assert.match(overlay, /rect\.x \/ SHORT_FORM_OUTPUT_WIDTH \* 100/u);
  assert.match(overlay, /rect\.y \/ SHORT_FORM_OUTPUT_HEIGHT \* 100/u);
  assert.match(overlay, /rect\.width \/ SHORT_FORM_OUTPUT_WIDTH \* 100/u);
  assert.match(overlay, /rect\.height \/ SHORT_FORM_OUTPUT_HEIGHT \* 100/u);
  assert.match(
    propertyInspector,
    /editor_shell\.dataset\.propertyMode = propertyInspectorMode/u,
    "현재 속성 mode를 CSS pointer 정책에 노출해야 합니다."
  );
  assert.match(
    imageOverlays,
    /overlay\.tabIndex = \([\s\S]*workspaceMode === "short-form" && propertyInspectorMode !== "asset"[\s\S]*\? -1 : 0/u,
    "사진 overlay는 사진 속성 tab이 아닐 때 tab 순서에서 빠져야 합니다."
  );
  assert.match(
    subtitleOverlays,
    /overlay\.tabIndex = \([\s\S]*workspaceMode === "short-form" && propertyInspectorMode !== "caption"[\s\S]*\? -1 : 0/u,
    "자막 overlay는 자막 속성 tab이 아닐 때 tab 순서에서 빠져야 합니다."
  );
  assert.match(
    css,
    /\.editor-shell\[data-workspace="short-form"\]:not\(\[data-property-mode="caption"\]\) \.subtitle-overlay,\s*\.editor-shell\[data-workspace="short-form"\]:not\(\[data-property-mode="asset"\]\) \.image-asset-overlay\s*\{\s*pointer-events:\s*none;/u,
    "비활성 속성의 overlay가 현재 편집 도구의 pointer 입력을 가로채면 안 됩니다."
  );
  assert.doesNotMatch(source, /function deleteSelectedShortWorkspaceClip\(/u);
  assert.match(bindings, /const destinationFields = \[[\s\S]*short_workspace_destination_x, "x"[\s\S]*short_workspace_destination_y, "y"[\s\S]*short_workspace_destination_width, "width"[\s\S]*short_workspace_destination_height, "height"/u);
  assert.match(bindings, /short_workspace_transform_layer\.addEventListener\([\s\S]*"pointerdown",[\s\S]*beginShortWorkspaceTransformGesture/u);
  assert.match(bindings, /short_workspace_transform_layer\.addEventListener\([\s\S]*"keydown",[\s\S]*nudgeShortWorkspaceTransformFromKeyboard/u);
  assert.doesNotMatch(bindings, /short_workspace_preview\.addEventListener\("pointerdown"/u);
  assert.match(bindings, /delete_short_video_layer\.addEventListener\([\s\S]*deleteSelectedShortVideoLayer/u);
  assert.doesNotMatch(bindings, /delete_short_workspace_clip/u);
  assert.match(bindings, /reset_short_workspace_framing\.addEventListener\([\s\S]*destinationRect: defaultShortDestinationRect/u);
  assert.match(bindings, /copy_short_workspace_framing\.addEventListener\([\s\S]*destinationRect: geometry\.destinationRect[\s\S]*\{ all: true \}/u);
});

test("원본 crop과 캔버스 transform은 drag 시작 사각형 기준 delta와 1·10px 키보드 이동을 쓴다", async () => {
  const source = await readFile(
    new URL("../src/editor/main.ts", import.meta.url),
    "utf8"
  );
  const sourceBegin = sectionFrom(
    source,
    "function beginShortSourceCropGesture(",
    "function updateShortSourceCropGesture("
  );
  const sourceUpdate = sectionFrom(
    source,
    "function updateShortSourceCropGesture(",
    "function finishShortSourceCropGesture("
  );
  const sourceKeyboard = sectionFrom(
    source,
    "function nudgeShortSourceCropFromKeyboard(",
    "function timelineWidth()"
  );
  const transformBegin = sectionFrom(
    source,
    "function beginShortWorkspaceTransformGesture(",
    "function updateShortWorkspaceTransformGesture("
  );
  const transformUpdate = sectionFrom(
    source,
    "function updateShortWorkspaceTransformGesture(",
    "function finishShortWorkspaceTransformGesture("
  );
  const transformKeyboard = sectionFrom(
    source,
    "function nudgeShortWorkspaceTransformFromKeyboard(",
    "function drawShortWorkspacePreview("
  );
  const bindings = sectionFrom(source, "function bindActions()", "async function initialize()");

  assert.match(sourceBegin, /startClientX: event\.clientX[\s\S]*startClientY: event\.clientY/u);
  assert.match(sourceBegin, /event\.preventDefault\(\);[\s\S]*target\.focus\(\{ preventScroll: true \}\)/u);
  assert.match(sourceBegin, /startRect: \{ \.\.\.shortSourceCropDraft \}/u);
  assert.match(sourceBegin, /surfaceWidth: bounds\.width[\s\S]*surfaceHeight: bounds\.height/u);
  assert.match(sourceUpdate, /event\.clientX - gesture\.startClientX[\s\S]*gesture\.surfaceWidth[\s\S]*gesture\.startRect\.referenceWidth/u);
  assert.match(sourceUpdate, /event\.clientY - gesture\.startClientY[\s\S]*gesture\.surfaceHeight[\s\S]*gesture\.startRect\.referenceHeight/u);
  assert.match(sourceUpdate, /shortSourceCropAfterPixelDelta\([\s\S]*gesture\.startRect,[\s\S]*gesture\.handle,[\s\S]*deltaX,[\s\S]*deltaY/u);
  assert.match(sourceKeyboard, /const step = event\.shiftKey \? 10 : 1/u);
  assert.match(sourceKeyboard, /delta\[0\]! \* step,[\s\S]*delta\[1\]! \* step/u);
  assert.match(
    sourceKeyboard,
    /const focusSelector =[\s\S]*renderShortSourceComposer\(\);[\s\S]*querySelector<HTMLElement>\(focusSelector\)[\s\S]*focus\(\{ preventScroll: true \}\)/u,
    "crop 재렌더 뒤 같은 move/handle control로 포커스를 돌려 연속 화살표 조작을 보장해야 합니다."
  );

  assert.match(transformBegin, /startClientX: event\.clientX[\s\S]*startClientY: event\.clientY/u);
  assert.match(transformBegin, /event\.preventDefault\(\);[\s\S]*target\.focus\(\{ preventScroll: true \}\)/u);
  assert.match(transformBegin, /startRect: \{ \.\.\.geometry\.destinationRect \}/u);
  assert.match(transformBegin, /layerWidth: bounds\.width[\s\S]*layerHeight: bounds\.height/u);
  assert.match(transformUpdate, /event\.clientX - gesture\.startClientX[\s\S]*gesture\.layerWidth \* SHORT_FORM_OUTPUT_WIDTH/u);
  assert.match(transformUpdate, /event\.clientY - gesture\.startClientY[\s\S]*gesture\.layerHeight \* SHORT_FORM_OUTPUT_HEIGHT/u);
  assert.match(transformUpdate, /shortWorkspaceDestinationAfterDelta\([\s\S]*gesture\.startRect,[\s\S]*gesture\.handle/u);
  assert.match(transformKeyboard, /const step = event\.shiftKey \? 10 : 1/u);
  assert.match(transformKeyboard, /delta\[0\]! \* step,[\s\S]*delta\[1\]! \* step/u);

  assert.match(bindings, /bindShortSourceTimeInput\(elements\.short_source_start_time, "start"\)/u);
  assert.match(bindings, /bindShortSourceTimeInput\(elements\.short_source_end_time, "end"\)/u);
  assert.match(bindings, /const shortSourceCropFields = \[[\s\S]*short_source_crop_x, "x"[\s\S]*short_source_crop_y, "y"[\s\S]*short_source_crop_width, "width"[\s\S]*short_source_crop_height, "height"/u);
  assert.match(bindings, /short_source_crop_surface\.addEventListener\([\s\S]*"pointerdown",[\s\S]*beginShortSourceCropGesture/u);
  assert.match(bindings, /short_source_crop_surface\.addEventListener\([\s\S]*"keydown",[\s\S]*nudgeShortSourceCropFromKeyboard/u);
});

test("쇼츠 타임라인은 영상 에셋 라인·라인 이동·같은 라인 자석을 제공하고 구형 독립 음성은 호환 경로로만 유지한다", async () => {
  const [html, css, source] = await Promise.all([
    readFile(new URL("../web/editor.html", import.meta.url), "utf8"),
    readFile(new URL("../web/editor/editor.css", import.meta.url), "utf8"),
    readFile(new URL("../src/editor/main.ts", import.meta.url), "utf8")
  ]);
  const sourceMove = sectionFrom(
    source,
    "function bindShortTimelineSourceMove(",
    "function bindShortTimelineSourceTrim("
  );
  const videoSnap = sectionFrom(
    source,
    "function findShortVideoTimelineSnap(",
    "function suppressNextTimedBlockClick("
  );
  const sourceTrim = sectionFrom(
    source,
    "function bindShortTimelineSourceTrim(",
    "function nudgeShortTimelineSourceBoundary("
  );
  const sourceProject = sectionFrom(
    source,
    "function shortTimelineSourceProject(",
    "function shortTimelineSourceAssetById("
  );
  const canonicalize = sectionFrom(
    source,
    "function canonicalizeShortWorkspaceProject(",
    "function applyProject("
  );
  const sourceLocks = sectionFrom(
    source,
    "function shortTimelineSourceEditsBlocked(",
    "function selectShortTimelineSourceAsset("
  );
  const timeline = sectionFrom(
    source,
    "function renderTimeline(",
    "function videoContentRect("
  );
  const workspaceChrome = sectionFrom(
    source,
    "function renderWorkspaceModeChrome()",
    "function renderTimelineRange("
  );
  const shortTimelineGridCss = sectionFrom(
    css,
    '.editor-shell[data-workspace="short-form"] .track-labels,',
    '.editor-shell[data-workspace="short-form"] .ruler-spacer,'
  );

  assert.doesNotMatch(source, /split_short_clip|merge_short_clips|selectedShortClipPair/u);

  assert.match(timeline, /const orderedShortVideoAssets = workspaceMode === "short-form"[\s\S]*shortWorkspaceVideoLayers\(\)/u);
  assert.match(timeline, /orderedShortVideoAssets\.forEach\(\(asset, assetIndex\)/u);
  assert.match(timeline, /block\.className = "short-video-asset-block"/u);
  assert.match(timeline, /video_lane_count\.textContent[\s\S]*project\.shortForm\.videoLaneCount/u);
  assert.match(timeline, /add_video_lane\.disabled[\s\S]*videoLaneCount >= SHORT_FORM_MAX_ACTIVE_VIDEO_ASSETS/u);
  assert.match(timeline, /block\.dataset\.lane = String\(asset\.lane\)/u);
  assert.match(timeline, /SHORT_VIDEO_BLOCK_TOP_PX \+ subrow \* SHORT_VIDEO_SUBROW_STRIDE_PX/u);
  assert.match(timeline, /Math\.round\(asset\.audioGain \* 100\)\}%/u);
  assert.match(timeline, /asset\.timelineStartMs[\s\S]*asset\.timelineEndMs - asset\.timelineStartMs/u);
  assert.match(timeline, /bindShortTimelineSourceMove\(body, asset, "video", event\)/u);
  assert.match(timeline, /bindShortTimelineSourceTrim\([\s\S]*asset,[\s\S]*"video",[\s\S]*"left"/u);
  // 과거 프로젝트의 진짜 독립 음성 record는 읽고 삭제할 수 있어야 하지만,
  // 신규 영상의 원본 음성과 경쟁하는 별도 기본 authoring UI는 아닙니다.
  assert.match(timeline, /project\.shortForm\.sourceAudioAssets\.forEach/u);
  assert.match(timeline, /block\.className = "source-audio-asset-block"/u);
  assert.match(timeline, /bindShortTimelineSourceMove\(body, asset, "source-audio", event\)/u);
  assert.match(timeline, /removeShortFormSourceAudioAsset\([\s\S]*project\.shortForm,[\s\S]*asset\.id/u);
  assert.match(timeline, /원본 음성만 삭제했습니다\. 영상·자막·사진은 그대로 유지됩니다/u);
  assert.match(timeline, /workspaceMode === "short-form"\s*\? \[\]\s*: project\.clips/u);

  assert.match(sourceMove, /const durationMs = originalTimelineEndMs - originalTimelineStartMs/u);
  assert.match(sourceMove, /const rawTimelineStartMs = originalTimelineStartMs \+ rawDeltaMs/u);
  assert.match(sourceMove, /timelineEndMs = timelineStartMs \+ durationMs/u);
  assert.match(sourceMove, /getBoundingClientRect\(\)\.top[\s\S]*SHORT_VIDEO_SUBROW_STRIDE_PX/u);
  assert.match(sourceMove, /bestShortVideoMoveSnap\([\s\S]*asset\.id,[\s\S]*lane,[\s\S]*moveEvent\.altKey/u);
  assert.match(
    sourceMove,
    /const originalCanvasDurationMs = project\.shortForm\.durationMs[\s\S]*bestShortVideoMoveSnap\([\s\S]*originalCanvasDurationMs/u,
    "드래그 중 자산이 늘린 캔버스 끝을 다음 pointermove의 새 자석점으로 재사용하면 안 됩니다."
  );
  assert.match(sourceMove, /kind === "video" \? \{ lane \} : \{\}/u);
  assert.doesNotMatch(sourceMove, /sourceStartMs:|sourceEndMs:/u);
  assert.match(sourceMove, /beginPointerHistory\(\);[\s\S]*rollbackProject = cloneProject\(project\)/u);
  assert.match(sourceMove, /changed = \([\s\S]*timelineStartMs !== originalTimelineStartMs[\s\S]*timelineEndMs !== originalTimelineEndMs[\s\S]*lane !== originalLane/u);
  assert.match(sourceMove, /--short-video-block-top[\s\S]*\.lane \* SHORT_VIDEO_SUBROW_STRIDE_PX/u);
  assert.doesNotMatch(sourceMove, /changed = changed \|\|/u);
  assert.match(sourceTrim, /asset\.sourceSelectionStartMs - originalSourceStartMs/u);
  assert.match(sourceTrim, /asset\.sourceSelectionEndMs - originalSourceEndMs/u);
  assert.match(sourceTrim, /timelineStartMs: originalTimelineStartMs \+ deltaMs,[\s\S]*sourceStartMs: originalSourceStartMs \+ deltaMs/u);
  assert.match(sourceTrim, /timelineEndMs: originalTimelineEndMs \+ deltaMs,[\s\S]*sourceEndMs: originalSourceEndMs \+ deltaMs/u);
  assert.match(sourceTrim, /findShortVideoTimelineSnap\([\s\S]*asset\.id,[\s\S]*\.lane,[\s\S]*altKey: moveEvent\.altKey/u);
  assert.match(
    sourceTrim,
    /const originalCanvasDurationMs = project\.shortForm\.durationMs[\s\S]*canvasDurationMs: originalCanvasDurationMs/u
  );
  assert.match(sourceTrim, /beginPointerHistory\(\);[\s\S]*rollbackProject = cloneProject\(project\)/u);
  assert.doesNotMatch(sourceTrim, /changed = changed \|\|/u);
  assert.match(sourceProject, /clips: \[shortFormCanvasClip\(shortForm\.durationMs\)\]/u);
  assert.match(canonicalize, /clips: \[shortFormCanvasClip\(shortForm\.durationMs\)\]/u);
  assert.match(sourceLocks, /activeJobController[\s\S]*projectMutationLockCount > 0[\s\S]*pointerEditActive/u);

  assert.match(videoSnap, /candidate\.id !== assetId && candidate\.lane === lane/u);
  assert.match(videoSnap, /timeMs: candidate\.timelineStartMs[\s\S]*timeMs: candidate\.timelineEndMs/u);
  assert.match(videoSnap, /timelineSnapEnabled[\s\S]*altKey[\s\S]*return null/u);
  assert.match(videoSnap, /findShortVideoTimelineSnap\(rawStartMs[\s\S]*findShortVideoTimelineSnap\(rawEndMs/u);
  assert.match(videoSnap, /canvasDurationMs = project\.shortForm\.durationMs/u);

  assert.match(
    html,
    /short-form-workspace-copy">영상 · 이미지 · 자막 · 음성 설정/u
  );
  assert.doesNotMatch(html, /short-form-workspace-copy">[^<]*음성 에셋/u);
  assert.match(
    html,
    /video-track-label[\s\S]*short-form-workspace-copy">영상 <b id="video-lane-count">1<\/b><\/span>[\s\S]*id="add-video-lane"[^>]*영상 라인 추가/u
  );
  assert.match(
    html,
    /audio-track-label[\s\S]*short-form-workspace-copy">음성 설정/u
  );
  assert.match(
    html,
    /id="source-audio-track-label"[^>]*aria-hidden="true"[^>]*hidden/u
  );
  assert.match(
    html,
    /id="source-audio-track"[^>]*aria-label="구형 쇼츠 원본 음성 호환 트랙"[^>]*aria-hidden="true"[^>]*hidden/u
  );
  assert.match(
    workspaceChrome,
    /elements\.source_audio_track_label\.hidden = true;[\s\S]*elements\.source_audio_track\.hidden = true;/u
  );
  const orderedTrackIds = [
    "video-track",
    "asset-track",
    "caption-tracks",
    "audio-track"
  ];
  for (let index = 1; index < orderedTrackIds.length; index += 1) {
    assert.ok(
      html.indexOf(`id="${orderedTrackIds[index - 1]}"`)
        < html.indexOf(`id="${orderedTrackIds[index]}"`),
      `타임라인 DOM 순서는 ${orderedTrackIds.join(" → ")} 이어야 합니다.`
    );
  }
  assert.match(css, /@media \(max-height: 731px\)[\s\S]*\.editor-shell\[data-workspace="short-form"\] \.workspace[\s\S]*minmax\(220px, 42%\) minmax\(0, 58%\)/u);
  assert.match(css, /\.editor-shell\[data-workspace="short-form"\] \.timeline-grid \{[\s\S]*overflow-y: auto[\s\S]*scrollbar-gutter: stable/u);
  assert.match(shortTimelineGridCss, /grid-template-rows:[\s\S]*var\(--ruler-height\)[\s\S]*var\(--video-track-height\)[\s\S]*var\(--asset-track-height\)[\s\S]*calc\(var\(--subtitle-track-height\) \* var\(--subtitle-lane-count\)\)[\s\S]*var\(--audio-track-height\)/u);
  assert.doesNotMatch(shortTimelineGridCss, /var\(--source-audio-track-height\)/u);
  assert.match(css, /\.editor-shell\[data-workspace="short-form"\] \.caption-track-label,[\s\S]*\.caption-tracks \{[\s\S]*grid-row: 4/u);
  assert.match(css, /\.editor-shell\[data-workspace="short-form"\] \.video-track-label \{[\s\S]*repeating-linear-gradient[\s\S]*46px 47px/u);
  assert.match(css, /\.short-video-asset-block \{[\s\S]*background: linear-gradient/u);
  assert.doesNotMatch(css, /\.short-video-asset-block \{[^}]*repeating-linear-gradient/u);

  assert.match(
    source,
    /add_video_lane\.addEventListener\("click"[\s\S]*addShortFormVideoLane\(project\.shortForm\)[\s\S]*videoLaneCount[\s\S]*영상 라인을 추가했습니다/u
  );
});

test("쇼츠 영상 에셋 미리보기는 같은 디코더의 원본 음성을 0~200%로 재생하고 구형 독립 음성을 호환한다", async () => {
  const source = await readFile(
    new URL("../src/editor/main.ts", import.meta.url),
    "utf8"
  );
  const videoAudioPreview = sectionFrom(
    source,
    "function applyPreviewAudioSettings(",
    "function stopPreviewAudioClock("
  );
  const sourceAudioPreview = sectionFrom(
    source,
    "function shortPreviewSourceAudioAssetAtTimeline(",
    "function startShortPreviewSourceAudioClock("
  );
  const webAudioGraph = sectionFrom(
    source,
    "function ensureShortPreviewAudioContext()",
    "function releaseShortPreviewLayerVideo("
  );

  assert.match(
    videoAudioPreview,
    /shortPreviewCombinedAvCacheReady\([\s\S]*cacheHasAudio: cache\.hasAudio === true/u
  );
  assert.match(
    videoAudioPreview,
    /shortPreviewVideoLayerAudioDecision\([\s\S]*decoderSynchronized[\s\S]*requestedVolume: volume/u
  );
  assert.match(
    videoAudioPreview,
    /Math\.min\([\s\S]*2,[\s\S]*previewVolume \* regionGain \* assetGain \* \(asset\?\.audioGain \?\? 1\)/u
  );
  assert.match(
    videoAudioPreview,
    /ensureShortPreviewLayerAudioGraph\(layerState\)[\s\S]*audioGainNode\.gain\.value = audioDecision\.webAudioGain[\s\S]*audioDecision\.mediaElementVolume[\s\S]*Math\.min\(1, audioDecision\.webAudioGain\)[\s\S]*layerState\.video\.muted = audioDecision\.muted/u
  );
  assert.match(webAudioGraph, /new AudioContextConstructor\([\s\S]*latencyHint: "interactive"/u);
  assert.match(webAudioGraph, /createMediaElementSource\(state\.video\)[\s\S]*createGain\(\)[\s\S]*source\.connect\(gain\)[\s\S]*gain\.connect\(context\.destination\)/u);
  assert.match(webAudioGraph, /context\?\.state === "suspended"[\s\S]*context\.resume\(\)/u);
  assert.match(
    source,
    /function requestShortPreviewLayerPlay\([\s\S]*applyPreviewAudioSettings\(shortCanvasTimelineMsFromClock\(\)\)/u
  );

  // 전용 두 번째 decoder는 새 영상의 기본 경로가 아니라, 과거에 저장된
  // 진짜 독립 sourceAudioAssets를 계속 열기 위한 호환 경로입니다.
  assert.match(
    source,
    /function shortPreviewIndependentSourceAudioAssets\([\s\S]*shortPreviewSourceAudioMatchesVideo/u
  );
  assert.match(
    source,
    /function ensureShortPreviewSourceAudio\([\s\S]*asset: ShortFormSourceAudioAsset[\s\S]*document\.createElement\("video"\)[\s\S]*video\.muted = true/u
  );
  assert.match(
    sourceAudioPreview,
    /timelineMs >= asset\.timelineStartMs[\s\S]*timelineMs < asset\.timelineEndMs/u
  );
  assert.match(
    sourceAudioPreview,
    /asset\.sourceStartMs \+ timelineMs - asset\.timelineStartMs/u
  );
  assert.match(
    source,
    /shortFormSourceAudioAssetGainAt\([\s\S]*previewVolume \* regionGain \* assetGain/u
  );
  assert.match(
    sourceAudioPreview,
    /SHORT_PREVIEW_SOURCE_AUDIO_AUDIBLE_DRIFT_SECONDS[\s\S]*SHORT_PREVIEW_PLAYBACK_START_GRACE_MS[\s\S]*requestShortCanvasPlaybackReprime\(timelineMs\)/u
  );
  assert.match(
    source,
    /function stopShortCanvasPlayback\([\s\S]*pauseShortPreviewSourceAudio\(\)/u
  );
  assert.match(
    source,
    /function loadPreviewMediaUrl\([\s\S]*releaseShortPreviewSourceAudio\(\)/u
  );
  assert.match(
    source,
    /function releaseShortPreviewAssetCache\([\s\S]*shortPreviewSourceAudioState\?\.mediaUrl === state\.objectUrl[\s\S]*releaseShortPreviewSourceAudio\(\)[\s\S]*URL\.revokeObjectURL/u
  );
  assert.match(
    source,
    /쇼츠 원본 음성 미리보기를 읽지 못했습니다\.[\s\S]*shortPreviewPacketCopyBlacklist\.add\(cache\.sourceFingerprint\)[\s\S]*shortPreviewCacheError = state\.error\.message[\s\S]*releaseShortPreviewAssetCache\(cache\.assetId\)[\s\S]*renderShortFramingInspector\(\)/u
  );
});

test("쇼츠 재생은 고정 시점에서 모든 독립 decoder를 priming한 뒤에만 master clock을 시작한다", async () => {
  const source = await readFile(
    new URL("../src/editor/main.ts", import.meta.url),
    "utf8"
  );
  const ensureLayer = sectionFrom(
    source,
    "function ensureShortPreviewLayerVideo(",
    "function releaseShortPreviewFallbackSurface("
  );
  const prime = sectionFrom(
    source,
    "async function primeShortCanvasPlayback(",
    "function requestShortCanvasPlaybackReprime("
  );
  const start = sectionFrom(
    source,
    "async function startShortCanvasPlayback()",
    "function previewTimelineMsFromVideoClock("
  );

  assert.match(
    ensureLayer,
    /shortCanvasPlaybackPriming[\s\S]*\? "priming"[\s\S]*shortPreviewPlaybackDecision/u
  );
  assert.match(
    ensureLayer,
    /seeking: state\.video\.seeking \|\| state\.seekingTargetSeconds !== null/u
  );
  assert.match(
    ensureLayer,
    /playbackPhase === "playing"[\s\S]*SHORT_PREVIEW_PLAYBACK_START_GRACE_MS[\s\S]*requestShortCanvasPlaybackReprime/u,
    "재생 중 큰 불연속은 개별 영상 seek가 아니라 모든 decoder의 원자적 재준비로 처리해야 합니다."
  );
  assert.match(prime, /const activeLayers = shortFormVideoAssetsAtTimeline/u);
  assert.match(prime, /activeLayers\.every\(shortPreviewLayerIsPrimed\)/u);
  assert.match(prime, /shortPreviewSourceAudioIsPrimed\(timelineMs\)/u);
  assert.match(prime, /SHORT_PREVIEW_PRIMING_TIMEOUT_MS/u);
  assert.doesNotMatch(prime, /shortCanvasTimelineMsFromClock\(\)/u);

  const awaitPrimeIndex = start.indexOf("await primeShortCanvasPlayback(");
  const activateIndex = start.indexOf("shortCanvasPlaybackActive = true;");
  const anchorIndex = start.indexOf("shortCanvasPlaybackAnchorPerformanceMs = performance.now();");
  assert.ok(awaitPrimeIndex >= 0);
  assert.ok(activateIndex > awaitPrimeIndex);
  assert.ok(anchorIndex > awaitPrimeIndex);
  assert.match(
    start,
    /shortCanvasPlaybackPreparedSignature = await primeShortCanvasPlayback\([\s\S]*shortCanvasPlaybackActive = true[\s\S]*requestShortPreviewLayerPlay/u
  );
  assert.match(
    start,
    /shortCanvasPlaybackSignatureAtTimeline\(project\.playheadMs\)[\s\S]*requestShortCanvasPlaybackReprime\(project\.playheadMs\)/u,
    "레이어 조합이 바뀌는 경계도 움직이는 clock으로 추격하지 말고 다시 고정 priming해야 합니다."
  );
  const durationStopIndex = start.indexOf(
    "project.playheadMs >= project.shortForm.durationMs"
  );
  const signatureBoundaryIndex = start.indexOf(
    "shortCanvasPlaybackSignatureAtTimeline(project.playheadMs)"
  );
  assert.ok(durationStopIndex >= 0 && durationStopIndex < signatureBoundaryIndex);
  assert.match(
    start,
    /project\.playheadMs >= project\.shortForm\.durationMs[\s\S]*stopShortCanvasPlayback\(\{ keepCurrentTime: false \}\)[\s\S]*shortCanvasPlaybackSignatureAtTimeline/u,
    "마지막 asset의 end-exclusive 경계는 0초 reprime이 아니라 먼저 정상 종료해야 합니다."
  );
});

test("reload 뒤 원본 transport가 없어도 정확히 일치하는 영상 cache로 화면·원본 음성을 미리본다", async () => {
  const source = await readFile(
    new URL("../src/editor/main.ts", import.meta.url),
    "utf8"
  );
  const fingerprint = sectionFrom(
    source,
    "function shortVideoCacheSourceFingerprint(",
    "function shortPreviewCacheVideoAssetForSourceAudio("
  );
  const sourceAudio = sectionFrom(
    source,
    "function ensureShortPreviewSourceAudio(",
    "function ensureShortPreviewLayerVideo("
  );
  const sourceAudioSync = sectionFrom(
    source,
    "function syncShortPreviewSourceAudioAtTimeline(",
    "function startShortPreviewSourceAudioClock("
  );
  const previewFrame = sectionFrom(
    source,
    "function drawShortWorkspacePreview()",
    "function renderShortSourceComposer("
  );
  const transport = sectionFrom(
    source,
    "function renderTransport()",
    "function renderAll("
  );
  const playback = sectionFrom(
    source,
    "async function togglePlayback()",
    "function adjacentClip("
  );
  const imageOverlays = sectionFrom(
    source,
    "async function renderImageAssetOverlays()",
    "function renderSubtitleOverlay()"
  );
  const subtitleOverlays = sectionFrom(
    source,
    "function renderSubtitleOverlay()",
    "function shortPreviewSourceAudioAssetAtTimeline("
  );

  assert.match(fingerprint, /const candidate = parentProject\.mediaAsset/u);
  assert.match(
    fingerprint,
    /mode: "manual-file",[\s\S]*name,[\s\S]*size,[\s\S]*type,[\s\S]*lastModified,[\s\S]*contentSampleSha256/u
  );
  assert.match(
    fingerprint,
    /: persistedManualFileIdentity \|\| \(mediaFile instanceof File/u,
    "reload 뒤 File 객체가 없어도 저장된 mediaAsset identity를 먼저 사용해야 cache fingerprint가 유지됩니다."
  );

  assert.match(
    sourceAudio,
    /const cache = shortPreviewCacheForSourceAudioAsset\(asset, rootProject\);[\s\S]*if \(!cache\) \{[\s\S]*return null;[\s\S]*const desiredMediaUrl = cache\.objectUrl/u,
    "구형 독립 음성 호환도 긴 전역 transport가 아니라 정확한 독립 cache만 사용해야 합니다."
  );
  assert.match(sourceAudio, /configureVideoMediaSource\(video, null\)/u);
  assert.doesNotMatch(sourceAudio, /\|\| mediaUrl|configureVideoMediaSource\(video, mediaFile/u);

  assert.match(
    sourceAudioSync,
    /const exactCache = shortPreviewCacheForSourceAudioAsset\(asset, rootProject\)/u
  );
  assert.match(
    sourceAudioSync,
    /const exactCache = shortPreviewCacheForSourceAudioAsset\(asset, rootProject\);[\s\S]*if \(!exactCache\) \{/u,
    "exact 음성 cache가 없으면 긴 원본 transport로 우회하지 않아야 합니다."
  );
  assert.doesNotMatch(sourceAudioSync, /!mediaFile|!mediaUrl/u);
  assert.match(sourceAudioSync, /const state = ensureShortPreviewSourceAudio\(asset\)/u);

  assert.match(previewFrame, /drawMultiLayerShortWorkspacePreview\(/u);
  assert.doesNotMatch(
    previewFrame,
    /activeLayers\.length > 0 && \(!mediaFile \|\| !mediaUrl\)/u,
    "영상 cache 합성은 reload 뒤 사라진 전역 File·URL 때문에 선제 차단되면 안 됩니다."
  );
  assert.match(
    source,
    /function shortPreviewSourceCachesReadyAtTimeline\([\s\S]*shortFormVideoAssetsAtTimeline[\s\S]*shortPreviewVideoAssetCacheMatches[\s\S]*shortPreviewIndependentSourceAudioAssets[\s\S]*shortPreviewCacheForSourceAudioAsset/u
  );
  assert.match(
    transport,
    /const sourceCachesReady = shortPreviewSourceCachesReadyAtTimeline\([\s\S]*rootProject,[\s\S]*project\.shortForm,[\s\S]*project\.playheadMs/u
  );
  assert.match(transport, /play_toggle\.disabled = needsMedia && !sourceCachesReady/u);
  assert.doesNotMatch(transport, /\(needsMedia && !mediaFile\) \|\| !mediaBindingValid/u);
  assert.match(
    playback,
    /needsMedia[\s\S]*!shortPreviewSourceCachesReadyAtTimeline\([\s\S]*rootProject,[\s\S]*project\.shortForm,[\s\S]*project\.playheadMs[\s\S]*현재 쇼츠 구성과 정확히 일치하는 미리보기 영상이 없습니다/u
  );
  assert.doesNotMatch(playback, /needsMedia && !mediaFile/u);

  assert.match(
    imageOverlays,
    /workspaceMode === "short-form" \|\| mediaFile[\s\S]*imageAssetsAtTimeline\(project, project\.playheadMs\)/u
  );
  assert.match(
    subtitleOverlays,
    /workspaceMode === "short-form" \|\| mediaFile[\s\S]*cuesAtTimeline\(project, project\.playheadMs\)/u
  );
});

test("본편→쇼츠 전환은 활성 구간 cache를 백그라운드에서 준비하고 편집을 막지 않는다", async () => {
  const source = await readFile(
    new URL("../src/editor/main.ts", import.meta.url),
    "utf8"
  );
  const renderCache = sectionFrom(
    source,
    "async function renderAndStoreShortPreviewAssetCache(",
    "async function prepareShortPreviewAssetCaches("
  );
  const prepare = sectionFrom(
    source,
    "async function prepareShortPreviewAssetCaches(",
    "function scheduleShortPreviewCacheRepair()"
  );
  const enter = sectionFrom(
    source,
    "async function enterShortFormWorkspace()",
    "async function exitShortFormWorkspace({"
  );
  const commit = sectionFrom(
    source,
    "async function commitShortSource(",
    "function replaceShortWorkspaceFraming("
  );
  const inspector = sectionFrom(
    source,
    "function renderShortFramingInspector()",
    "function renderPropertyInspector()"
  );
  const layerPreview = sectionFrom(
    source,
    "function ensureShortPreviewLayerVideo(",
    "function releaseShortPreviewFallbackSurface()"
  );
  const audioPreview = sectionFrom(
    source,
    "function syncShortPreviewSourceAudioAtTimeline(",
    "function startShortPreviewSourceAudioClock("
  );

  assert.ok(renderCache.includes(
    "nextShortPreviewCacheCoverage(asset, currentCoverage)"
  ));
  assert.ok(
    renderCache.indexOf("copySingleClipPacketsForPreview(")
      < renderCache.indexOf("renderProjectVideo("),
    "지원 코덱은 packet-copy를 먼저 쓰고 브라우저 변환은 fallback이어야 합니다."
  );
  assert.match(renderCache, /if \(signal\.aborted\)[\s\S]*브라우저 변환으로 전환/u);
  assert.match(renderCache, /mediaOffsetMs: copied\?\.mediaOffsetMs \?\? 0/u);
  assert.match(renderCache, /const sourceFingerprint = shortVideoCacheSourceFingerprint/u);
  assert.match(renderCache, /shortPreviewPacketCopyBlacklist\.has\(sourceFingerprint\)/u);
  assert.match(renderCache, /const hasAudio = copied[\s\S]*result\.audioCodec !== null/u);
  assert.match(renderCache, /hasAudio,[\s\S]*sourceFingerprint,/u);

  assert.doesNotMatch(prepare, /showJob\(|hideJob\(|lockProjectMutations\(|unlockProjectMutations\(/u);
  assert.doesNotMatch(prepare, /activeJobController = controller/u);
  assert.match(prepare, /shortPreviewCacheController = controller/u);
  assert.match(
    prepare,
    /const generation = \+\+shortPreviewCacheGeneration;[\s\S]*shortPreviewCacheController\?\.abort\(\);[\s\S]*const previousOperation = shortPreviewCacheOperation/u
  );
  assert.match(prepare, /const sourceMedia = mediaFile;[\s\S]*const parentProject = cloneProject\(inputParentProject\)/u);
  assert.match(prepare, /if \(previousOperation\) \{[\s\S]*await previousOperation\.catch[\s\S]*assertCurrentRequest\(\)/u);
  assert.match(prepare, /generation !== shortPreviewCacheGeneration[\s\S]*mediaFile !== sourceMedia/u);
  assert.match(prepare, /async function cancelAndWaitForShortPreviewCacheOperation/u);
  assert.match(prepare, /function invalidateShortPreviewCacheOperation/u);
  assert.doesNotMatch(
    prepare,
    /renderShortFramingInspector\(\);\s*scheduleShortPreviewCacheRepair\(\);/u,
    "성공한 cache 준비가 무조건 자기 자신을 다시 예약하면 안 됩니다."
  );
  const retry = sectionFrom(
    source,
    "async function retryShortPreviewAssetCaches()",
    "function upgradeLegacyShortFormGeometry("
  );
  assert.match(
    retry,
    /const generation = \+\+shortPreviewCacheGeneration[\s\S]*shortPreviewCacheOperation = operation[\s\S]*await operation/u,
    "재시도의 목록·삭제 작업도 source 교체와 cleanup이 기다리는 cache barrier에 등록돼야 합니다."
  );
  assert.match(retry, /mediaFile !== sourceMedia[\s\S]*deleteShortVideoCache\(projectId, assetId\)/u);
  assert.ok(
    retry.indexOf("shortPreviewCacheOperation = null")
      < retry.indexOf("await prepareShortPreviewAssetCaches(parentProject, assets)"),
    "재시도 maintenance barrier를 끝낸 직후 최신 cache prepare를 시작해야 합니다."
  );
  assert.ok(prepare.includes(
    "reusableRecord = [...completedRecords, ...storedCaches].find("
  ));
  assert.match(
    prepare,
    /reusableRecord[\s\S]*blob: reusableRecord\.blob[\s\S]*: await renderAndStoreShortPreviewAssetCache/u
  );
  assert.match(
    prepare,
    /pending\.push\(\{[\s\S]*asset,[\s\S]*requiresAudio: parentProject\.mediaAsset\?\.hasAudio === true/u,
    "모든 영상 에셋 pending은 원본에 음성이 있으면 처음부터 audio-capable cache를 요구해야 합니다."
  );
  assert.match(
    prepare,
    /!requiresAudio \|\| candidate\.hasAudio === true/u,
    "구형 무음 cache를 원본 음성용 reusable record로 선택하면 안 됩니다."
  );
  assert.match(
    prepare,
    /currentVideoAsset[\s\S]*shortPreviewVideoAssetCacheMatches\([\s\S]*record,[\s\S]*currentVideoAsset,[\s\S]*currentParent[\s\S]*installShortPreviewAssetCache\(record\)/u
  );

  assert.doesNotMatch(enter, /await prepareShortPreviewAssetCaches/u);
  assert.match(enter, /workspaceMode = "short-form"[\s\S]*renderAll\(\)[\s\S]*void prepareShortPreviewAssetCaches/u);
  assert.doesNotMatch(commit, /await prepareShortPreviewAssetCaches/u);
  assert.match(commit, /applyProject\(nextProject[\s\S]*void prepareShortPreviewAssetCaches/u);
  assert.doesNotMatch(inspector, /short_canvas_(?:toolbar|add_video)/u);

  assert.match(
    layerPreview,
    /layer\.sourceTimeMs[\s\S]*cache\.sourceStartMs[\s\S]*cache\.mediaOffsetMs/u
  );
  assert.match(
    audioPreview,
    /sourceMs[\s\S]*state\.cacheSourceStartMs[\s\S]*state\.cacheMediaOffsetMs/u
  );
});

test("쇼츠 공용 내보내기는 materialize된 v7 canvas·videoAssets·sourceAudioAssets만 전달한다", async () => {
  const source = await readFile(
    new URL("../src/editor/main.ts", import.meta.url),
    "utf8"
  );
  const exportVideo = sectionFrom(
    source,
    "async function exportVideo(",
    "async function exportVideoWithLock("
  );
  const bindings = sectionFrom(source, "function bindActions()", "async function initialize()");
  const sourceAssetMapping = sectionFrom(
    source,
    "function shortFormSourceAssetForMediaEngine",
    "function projectForMediaEngine"
  );

  assert.match(sourceAssetMapping, /materializeEditorClipWithinEditableBounds\([\s\S]*virtualClip,[\s\S]*materialization/u);
  assert.match(sourceAssetMapping, /sourceSelectionStartMs: mapped\.sourceStartMs/u);
  assert.match(sourceAssetMapping, /sourceSelectionEndMs: mapped\.sourceEndMs/u);
  assert.match(sourceAssetMapping, /sourceStartMs: mapped\.sourceStartMs/u);
  assert.match(sourceAssetMapping, /sourceEndMs: mapped\.sourceEndMs/u);

  assert.match(
    bindings,
    /export_video\.addEventListener\([\s\S]*workspaceMode === "short-form" \? "short-form" : "main"/u
  );
  assert.match(
    exportVideo,
    /selectedOutputProject = isShortForm[\s\S]*workspaceMode === "short-form"[\s\S]*\? project[\s\S]*: deriveShortFormRenderProject\(project\)/u
  );
  assert.match(
    exportVideo,
    /if \(!selectedOutputProject\.clips\.some\(\(clip\) => clip\.enabled !== false\)\)/u,
    "본편 컷이 비어도 독립 쇼츠 branch의 출력 컷을 기준으로 export 가능 여부를 판단해야 합니다."
  );
  assert.ok(
    exportVideo.indexOf("selectedOutputProject = isShortForm")
      < exportVideo.indexOf("!selectedOutputProject.clips.some"),
    "쇼츠 render project를 먼저 파생한 뒤 빈 출력 여부를 검사해야 합니다."
  );
  assert.doesNotMatch(
    exportVideo,
    /!project\.clips\.some\(\(clip\) => clip\.enabled !== false\)/u
  );
  assert.match(
    exportVideo,
    /workspaceMode === "short-form"[\s\S]*\? exportProject[\s\S]*: deriveShortFormRenderProject\(exportProject\)/u
  );
  assert.match(
    exportVideo,
    /renderProject = projectForMediaEngine\(outputProject\)[\s\S]*const renderLayout = isShortForm/u,
    "로컬 VOD source clock을 매핑한 프로젝트에서 v7 export payload를 만들어야 합니다."
  );
  assert.match(
    exportVideo,
    /kind: "short-form" as const,[\s\S]*durationMs: renderProject\.shortForm\.durationMs,[\s\S]*videoAssets: renderProject\.shortForm\.videoAssets,[\s\S]*sourceAudioAssets: renderProject\.shortForm\.sourceAudioAssets/u
  );
  assert.doesNotMatch(exportVideo, /scenes: renderProject\.shortForm\.scenes/u);
  assert.match(exportVideo, /getPreferredOutputProfile\([\s\S]*layout: renderLayout/u);
  assert.match(exportVideo, /renderProjectVideo\([\s\S]*layout: renderLayout/u);
  assert.match(
    exportVideo,
    /const fallbackOutputTitle = isShortForm[\s\S]*let baseName = sanitizeFileName\(outputTitle \|\| fallbackOutputTitle\)/u
  );
  assert.match(
    exportVideo,
    /await createSidecars\([\s\S]*baseName,[\s\S]*rootExportProject,[\s\S]*outputProject,[\s\S]*exportKind,[\s\S]*exportMediaFile[\s\S]*\)/u
  );
});

test("과거 일회성 쇼츠 선택 대화상자와 draft 상태는 배포 소스에 남지 않는다", async () => {
  const [html, source] = await Promise.all([
    readFile(new URL("../web/editor.html", import.meta.url), "utf8"),
    readFile(new URL("../src/editor/main.ts", import.meta.url), "utf8")
  ]);
  for (const legacy of [
    "short-form-dialog",
    "short-form-scene-list",
    "short-form-preview",
    "save-short-form",
    "export-short-form",
    "openShortFormDialog",
    "commitShortFormDraft",
    "focusBeforeShortFormDialog"
  ]) {
    assert.doesNotMatch(html, new RegExp(legacy, "u"));
    assert.doesNotMatch(source, new RegExp(legacy, "u"));
  }
});

test("낮은 뷰포트에서도 영구 쇼츠 캔버스와 검사기는 세로 스크롤로 접근 가능하다", async () => {
  const css = await readFile(
    new URL("../web/editor/editor.css", import.meta.url),
    "utf8"
  );
  assert.match(
    css,
    /\.editor-shell\[data-workspace="short-form"\] \.stage\s*\{[\s\S]*aspect-ratio:\s*9 \/ 16/u
  );
  assert.match(
    css,
    /\.inspector\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*min-height:\s*0/u
  );
  assert.doesNotMatch(css, /\.short-form-dialog\[open\]/u);
});
