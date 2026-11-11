import assert from "node:assert/strict";
import test from "node:test";
import {
  createAudioRegion, createEditorProjectFromCapture, createImageAsset, createSubtitleCue,
  insertCroppedClipAfter, mergeCaptureIntoEditorProject, normalizeEditorProject,
  rippleDeleteTimelineRange, splitClipAtTimeline, updateClipTrim, updateClipVideoCrop
} from "../src/lib/editor-core.js";
import {
  CHZZK_VOD_MATERIALIZATION_SCHEMA, assertChzzkVodMaterialization,
  materializationRequestRangeForClip, materializeEditorClipWithinEditableBounds,
  materializedEditableBoundsForClip
} from "../src/lib/chzzk-vod-materialization.js";
import {
  appendShortFormClips, createShortFormWorkspaceProject, shortFormBranchFromWorkspace
} from "../src/lib/short-form.js";
import { FULL_VIDEO_CROP, mainVideoOutputDimensions, normalizeVideoCrop, videoCropDrawGeometry, videoCropSourceRect } from "../src/lib/video-crop.js";

const crop = { x: 0.25, y: 0.125, width: 0.5, height: 0.75 };
const capture = {
  projectName: "crop fixture",
  source: { platform: "CHZZK", contentType: "vod", contentId: "123456" },
  segments: [
    { id: "first", startSeconds: 100, endSeconds: 110, description: "original" },
    { id: "second", startSeconds: 115, endSeconds: 125, description: "later" }
  ]
};
function fixture() {
  const base = createEditorProjectFromCapture(capture);
  const clipId = base.clips[0]!.id;
  return {
    ...base,
    subtitles: [createSubtitleCue(base, { clipId, text: "human subtitle", startOffsetMs: 1_000, endOffsetMs: 3_000 })],
    imageAssets: [createImageAsset(base, {
      clipId, startOffsetMs: 1_000, endOffsetMs: 3_000,
      dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT3sAAAAASUVORK5CYII=",
      naturalWidth: 1, naturalHeight: 1, x: 0.2, y: 0.7, scale: 0.3
    })],
    audioRegions: [createAudioRegion(base, { clipId, startOffsetMs: 0, endOffsetMs: 5_000, gain: 0.5 })]
  };
}

test("crop normalization preserves valid authored edges and rejects malformed or empty rectangles", () => {
  assert.deepEqual(normalizeVideoCrop(crop), crop);
  assert.deepEqual(normalizeVideoCrop(normalizeVideoCrop(crop)), crop);
  assert.deepEqual(normalizeVideoCrop({ x: 0.8, y: 0.7, width: 0.9, height: 0.8 }), {
    x: 0.8, y: 0.7, width: 1 - 0.8, height: 1 - 0.7
  });
  for (const value of [undefined, null, [], {}, FULL_VIDEO_CROP,
    { ...crop, x: NaN }, { ...crop, width: 0 }, { ...crop, height: -1 },
    { ...crop, x: 1 }, { ...crop, width: "0.5" }]) {
    assert.equal(normalizeVideoCrop(value), null);
  }
});

test("preview/export share integer source pixels and contain geometry without moving output overlays", () => {
  assert.deepEqual(mainVideoOutputDimensions(641, 361), { width: 642, height: 362 });
  assert.deepEqual(mainVideoOutputDimensions(3841, 2161), { width: 1920, height: 1080 });
  assert.deepEqual(videoCropSourceRect(3840, 2160, crop), { left: 960, top: 270, width: 1920, height: 1620 });
  assert.deepEqual(videoCropSourceRect(1920, 1080, crop), { left: 480, top: 135, width: 960, height: 810 });
  const selectedRightHalf = { x: 0.5, y: 0, width: 0.5, height: 1 };
  assert.deepEqual(videoCropDrawGeometry(160, 90, 160, 90, selectedRightHalf), {
    source: { left: 80, top: 0, width: 80, height: 90 },
    destination: { left: 40, top: 0, width: 80, height: 90 }
  });
  assert.deepEqual(videoCropDrawGeometry(160, 90, 160, 90, null), {
    source: { left: 0, top: 0, width: 160, height: 90 },
    destination: { left: 0, top: 0, width: 160, height: 90 }
  });
  assert.deepEqual(videoCropSourceRect(160, 90, { x: 0.9999, y: 0.9999, width: 0.0001, height: 0.0001 }), {
    left: 159, top: 89, width: 1, height: 1
  });
});

test("apply/reset edit only the selected clip's crop and leave source timing and every overlay untouched", () => {
  const base = fixture();
  const original = structuredClone(base);
  const id = base.clips[0]!.id;
  const next = updateClipVideoCrop(base, id, crop);
  assert.deepEqual(base, original);
  assert.deepEqual(next.clips[0], { ...base.clips[0], videoCrop: crop, updatedAt: next.clips[0]!.updatedAt });
  assert.equal(next.clips[1], base.clips[1]);
  assert.equal(next.subtitles, base.subtitles);
  assert.equal(next.imageAssets, base.imageAssets);
  assert.equal(next.audioRegions, base.audioRegions);
  assert.equal(next.shortForm, base.shortForm);
  assert.equal(next.playheadMs, base.playheadMs);
  assert.equal(updateClipVideoCrop(next, id, crop), next);
  assert.equal(updateClipVideoCrop(next, "missing", crop), next);
  const reset = updateClipVideoCrop(next, id, FULL_VIDEO_CROP);
  assert.equal(Object.hasOwn(reset.clips[0]!, "videoCrop"), false);
  assert.deepEqual(reset.clips[0], { ...base.clips[0], updatedAt: reset.clips[0]!.updatedAt });
});

test("legacy projects stay uncropped; save/reload, trim and split retain spatial edits", () => {
  const base = fixture();
  const id = base.clips[0]!.id;
  const legacy = normalizeEditorProject(JSON.parse(JSON.stringify(base)))!;
  assert.deepEqual(legacy.clips, base.clips);
  const cropped = updateClipVideoCrop(base, id, crop);
  const loaded = normalizeEditorProject(JSON.parse(JSON.stringify(cropped)))!;
  assert.deepEqual(loaded.clips, cropped.clips);
  const split = splitClipAtTimeline(loaded, 5_000);
  assert.deepEqual(split.clips.slice(0, 2).map((clip) => clip.videoCrop), [crop, crop]);
  assert.equal(split.clips[1]!.sourceClipId, id);
  assert.deepEqual(split.clips.slice(0, 2).map((clip) => [clip.sourceStartMs, clip.sourceEndMs]), [
    [100_000, 105_000], [105_000, 110_000]
  ]);
  const trimmed = updateClipTrim(split, id, { sourceStartMs: 100_500, sourceEndMs: 104_500 });
  assert.deepEqual(trimmed.clips[0]!.videoCrop, crop);
  const restored = normalizeEditorProject(JSON.parse(JSON.stringify(trimmed)))!;
  assert.deepEqual(restored.clips, trimmed.clips);
});

test("insert creates an independent cut immediately after its source and never duplicates authored overlays", () => {
  const base = fixture();
  const original = structuredClone(base);
  const first = base.clips[0]!;
  const inserted = insertCroppedClipAfter(base, first.id, crop);
  const copy = inserted.clips[1]!;
  assert.deepEqual(base, original);
  assert.deepEqual(inserted.clips[0], first);
  assert.notEqual(copy.id, first.id);
  assert.equal(copy.sourceClipId, first.id);
  assert.equal(copy.selectionId, first.selectionId);
  assert.deepEqual([copy.sourceStartMs, copy.sourceEndMs, copy.selectionStartMs, copy.selectionEndMs],
    [first.sourceStartMs, first.sourceEndMs, first.selectionStartMs, first.selectionEndMs]);
  assert.deepEqual(copy.videoCrop, crop);
  assert.deepEqual(inserted.clips.map((clip) => clip.timelineStartMs), [0, 10_000, 20_000]);
  assert.equal(inserted.selectedClipId, copy.id);
  assert.equal(inserted.playheadMs, 10_000);
  assert.equal(inserted.subtitles, base.subtitles);
  assert.equal(inserted.imageAssets, base.imageAssets);
  assert.equal(inserted.audioRegions, base.audioRegions);
  const again = insertCroppedClipAfter(inserted, copy.id, crop);
  assert.equal(again.clips[2]!.sourceClipId, first.id, "copies keep the root coverage identity, not a transient copy ID");
  assert.equal(new Set(again.clips.map((clip) => clip.id)).size, 4);
  const merged = mergeCaptureIntoEditorProject(again, capture);
  assert.deepEqual(merged.clips.map((clip) => ({ id: clip.id, crop: clip.videoCrop, lineage: clip.sourceClipId })),
    again.clips.map((clip) => ({ id: clip.id, crop: clip.videoCrop, lineage: clip.sourceClipId })));
  assert.deepEqual(normalizeEditorProject(JSON.parse(JSON.stringify(merged)))!.clips, merged.clips);
});

test("inserted/split VOD cuts keep exact authorized coverage and cannot borrow another cut's wider window", () => {
  const base = fixture();
  const first = base.clips[0]!;
  const second = base.clips[1]!;
  const manifest = assertChzzkVodMaterialization({
    schema: CHZZK_VOD_MATERIALIZATION_SCHEMA,
    materializationId: "a".repeat(32), planFingerprint: `${"a".repeat(32)}${"b".repeat(32)}`,
    source: { platform: "CHZZK", contentType: "vod", contentId: "123456", sourceVersionId: "c".repeat(64) },
    sourceDurationMs: 200_000, handleMs: 10_000, mediaDurationMs: 109_000,
    windows: [{ id: "window-1", editableSourceStartMs: 60_000, editableSourceEndMs: 165_000,
      fetchedSourceStartMs: 58_000, fetchedSourceEndMs: 167_000, mediaStartMs: 0, mediaEndMs: 109_000,
      clipIds: [first.id, second.id] }],
    clipRanges: [
      { clipId: first.id, sourceStartMs: 100_000, sourceEndMs: 110_000, editableSourceStartMs: 60_000, editableSourceEndMs: 120_000 },
      { clipId: second.id, sourceStartMs: 115_000, sourceEndMs: 125_000, editableSourceStartMs: 105_000, editableSourceEndMs: 165_000 }
    ],
    preparedAt: "2026-11-12T00:00:00.000Z", localOnly: true
  });
  const inserted = insertCroppedClipAfter(base, first.id, crop);
  const split = splitClipAtTimeline(inserted, 15_000);
  const deletedMiddle = rippleDeleteTimelineRange(updateClipVideoCrop(base, first.id, crop), {
    startMs: 2_000, endMs: 3_000
  });
  assert.equal(deletedMiddle.clips[1]!.sourceClipId, first.id);
  assert.deepEqual(deletedMiddle.clips.slice(0, 2).map((clip) => [clip.sourceStartMs, clip.sourceEndMs]), [
    [100_000, 102_000], [103_000, 110_000]
  ]);
  for (const clip of [...split.clips.slice(1, 3), deletedMiddle.clips[1]!]) {
    assert.equal(clip.sourceClipId, first.id);
    assert.deepEqual(materializationRequestRangeForClip(clip, manifest), {
      clipId: first.id, sourceStartMs: 100_000, sourceEndMs: 110_000
    });
    const mapped = materializeEditorClipWithinEditableBounds(clip, manifest);
    assert.ok(mapped);
    assert.equal(mapped.sourceStartMs, clip.sourceStartMs - 58_000);
    assert.equal(mapped.sourceEndMs, clip.sourceEndMs - 58_000);
    assert.deepEqual(mapped.videoCrop, crop);
    assert.equal(materializeEditorClipWithinEditableBounds({ ...clip, sourceEndMs: 150_000 }, manifest), null);
    assert.equal(materializedEditableBoundsForClip({ ...clip, sourceClipId: "unrelated" }, manifest), null);
    assert.equal(materializedEditableBoundsForClip({ ...clip, selectionEndMs: 111_000 }, manifest), null);
  }
});

test("shorts keep their own crop/workspace and append copies using the original media lineage", () => {
  const base = fixture();
  const first = base.clips[0]!;
  const inserted = insertCroppedClipAfter(base, first.id, crop);
  const copy = inserted.clips[1]!;
  const branch = appendShortFormClips(inserted, inserted.shortForm, [copy.id]);
  assert.equal(branch.videoAssets.length, 1);
  assert.equal(branch.sourceAudioAssets.length, 1);
  assert.equal(branch.videoAssets[0]!.sourceClipId, first.id);
  assert.equal(branch.sourceAudioAssets[0]!.sourceClipId, first.id);
  assert.deepEqual({ x: branch.videoAssets[0]!.sourceRect.x, y: branch.videoAssets[0]!.sourceRect.y,
    width: branch.videoAssets[0]!.sourceRect.width, height: branch.videoAssets[0]!.sourceRect.height }, FULL_VIDEO_CROP);
  const workspace = createShortFormWorkspaceProject({ ...inserted, shortForm: branch });
  assert.equal(workspace.clips.some((clip) => clip.videoCrop), false);
  const savedBranch = shortFormBranchFromWorkspace(inserted, workspace);
  assert.deepEqual(savedBranch.videoAssets, branch.videoAssets);
  assert.deepEqual(inserted.clips[1]!.videoCrop, crop);
  assert.equal(base.clips[0]!.videoCrop, undefined);
});
