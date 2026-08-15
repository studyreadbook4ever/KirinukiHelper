import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createAudioRegion,
  createEditorProjectFromCapture,
  deleteAudioRegion,
  normalizeEditorProject,
  updateAudioRegion
} from "../src/lib/editor-core.js";

const captureState = {
  projectName: "음성 설정 회귀",
  source: {
    platform: "CHZZK",
    contentType: "vod",
    contentId: "audio-ui-regression",
    canonicalUrl: "https://chzzk.naver.com/video/audio-ui-regression"
  },
  segments: [{
    id: "audio-source",
    startSeconds: 10,
    endSeconds: 20,
    description: "음성 설정 대상"
  }]
};

function functionSection(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `${start} 시작점을 찾지 못했습니다.`);
  assert.notEqual(endIndex, -1, `${end} 끝점을 찾지 못했습니다.`);
  return source.slice(startIndex, endIndex);
}

test("음성 inspector는 구간·gain·mute·fade·reset·delete 조작을 모두 노출한다", async () => {
  const html = await readFile(
    new URL("../web/editor.html", import.meta.url),
    "utf8"
  );

  for (const id of [
    "audio-start",
    "audio-end",
    "audio-volume",
    "audio-mute",
    "audio-fade-in",
    "audio-fade-out",
    "reset-audio-region",
    "delete-audio-region",
    "add-audio-region",
    "audio-track"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`, "u"));
  }
});

test("음성 trim gesture는 최초 snapshot에서 매 frame을 계산하고 취소하면 rollback한다", async () => {
  const source = await readFile(
    new URL("../src/editor/main.ts", import.meta.url),
    "utf8"
  );
  const trim = functionSection(
    source,
    "function bindAudioTrim(",
    "function renderTimeline("
  );

  assert.match(trim, /propertyInspectorMode = "audio"/u);
  assert.match(trim, /const originalProject = \{/u);
  assert.match(trim, /selectedAudioRegionId: region\.id/u);
  assert.match(trim, /Math\.abs\(deltaX\) < TIMED_BLOCK_DRAG_ACTIVATION_PX/u);
  assert.match(trim, /updateAudioRegion\(originalProject, region\.id/u);
  assert.doesNotMatch(trim, /updateAudioRegion\(project, region\.id/u);
  assert.match(
    trim,
    /finishEvent\?\.type === "pointercancel"[\s\S]*finishEvent\?\.type === "lostpointercapture"[\s\S]*rollbackPointerHistory\(originalProject, redoBeforeGesture\)/u
  );
});

test("음성 timeline 버튼 선택은 재렌더 뒤 같은 버튼으로 키보드 focus를 복원한다", async () => {
  const source = await readFile(
    new URL("../src/editor/main.ts", import.meta.url),
    "utf8"
  );
  const selection = functionSection(
    source,
    "function selectAudioRegion(",
    "function selectImageAsset("
  );

  assert.match(
    source,
    /body\.addEventListener\("click", \(\) => selectAudioRegion\(region\.id, \{\s*seek: true,\s*focusTimeline: true\s*\}\)\);/u
  );
  assert.match(selection, /focusTimeline = false/u);
  assert.match(
    selection,
    /\.audio-block\[data-id=.*CSS\.escape\(region\.id\).*\.audio-block-body/u
  );
  assert.match(selection, /\.focus\(\{ preventScroll: true \}\)/u);
});

test("사람의 gain·mute·fade 설정은 trim 왕복과 저장 재열기 뒤에도 보존된다", () => {
  let project = createEditorProjectFromCapture(captureState);
  const clip = project.clips[0];
  assert.ok(clip);
  const region = createAudioRegion(project, {
    id: "audio-human-sequence",
    clipId: clip.id,
    startOffsetMs: 500,
    endOffsetMs: 4_500
  });
  project = {
    ...project,
    audioRegions: [region],
    selectedAudioRegionId: region.id
  };
  project = updateAudioRegion(project, region.id, {
    gain: 0.35,
    muted: true,
    fadeInMs: 1_200,
    fadeOutMs: 1_600
  });

  // A real pointer can briefly cross a shorter duration and then return. Using
  // the already-normalized intermediate state permanently destroys the fade;
  // the UI handler therefore derives every move from the original snapshot.
  const brieflyShortened = updateAudioRegion(project, region.id, {
    endOffsetMs: 1_500
  });
  assert.equal(brieflyShortened.audioRegions[0]?.fadeOutMs, 1_000);
  const cumulativeExpansion = updateAudioRegion(brieflyShortened, region.id, {
    endOffsetMs: 4_500
  });
  assert.equal(cumulativeExpansion.audioRegions[0]?.fadeOutMs, 1_000);

  const finalFromGestureSnapshot = updateAudioRegion(project, region.id, {
    startOffsetMs: 750,
    endOffsetMs: 4_250
  });
  const reopened = normalizeEditorProject(
    JSON.parse(JSON.stringify(finalFromGestureSnapshot))
  );
  assert.ok(reopened);
  assert.deepEqual(
    reopened.audioRegions.map((candidate) => ({
      id: candidate.id,
      startOffsetMs: candidate.startOffsetMs,
      endOffsetMs: candidate.endOffsetMs,
      gain: candidate.gain,
      muted: candidate.muted,
      fadeInMs: candidate.fadeInMs,
      fadeOutMs: candidate.fadeOutMs
    })),
    [{
      id: region.id,
      startOffsetMs: 750,
      endOffsetMs: 4_250,
      gain: 0.35,
      muted: true,
      fadeInMs: 1_200,
      fadeOutMs: 1_600
    }]
  );
  assert.equal(reopened.selectedAudioRegionId, region.id);

  const deleted = deleteAudioRegion(reopened, region.id);
  assert.deepEqual(deleted.audioRegions, []);
  assert.equal(deleted.selectedAudioRegionId, null);
});
