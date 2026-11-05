import assert from "node:assert/strict";
import test from "node:test";

import {
  addImageLane, createEditorProjectFromCapture, createImageAsset, createSubtitleCue,
  imageAssetsAtTimeline, normalizeEditorProject, removeImageLane, removeSubtitleLane,
  type EditorImageAsset, type EditorProject
} from "../src/lib/editor-core.js";
import { MAX_IMAGE_LANES, lastEmptyLane, normalizeImageLaneLayout } from "../src/lib/image-lanes.js";
import {
  activeShortFormWorkspace, addShortFormVideoAsset, addShortFormWorkspace,
  createShortFormWorkspaceProject, deriveShortFormRenderProject, normalizeShortFormBranch,
  removeShortFormVideoLane, saveActiveShortFormWorkspace, shortFormBranchFromWorkspace
} from "../src/lib/short-form.js";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT3sAAAAASUVORK5CYII=";
const project = () => createEditorProjectFromCapture({
  projectName: "image lanes", segments: [{ id: "a", startSeconds: 10, endSeconds: 20 }]
});
const image = (value: EditorProject, id: string, extra: Record<string, unknown> = {}) => createImageAsset(value, {
  id, clipId: value.clips[0]!.id, dataUrl: png, startOffsetMs: 0, endOffsetMs: 2_000,
  x: 0.27, y: 0.63, scale: 0.4, opacity: 0.75, naturalWidth: 1, naturalHeight: 1, ...extra
});
const withoutLane = <T extends { lane?: number }>(value: T) => {
  const { lane: _lane, ...content } = value;
  return content;
};
const legacyImage = (value: EditorImageAsset): EditorImageAsset => {
  const legacy = { ...value };
  delete legacy.lane;
  return legacy;
};

test("legacy images get stable free lanes without changing paint order, content or cut boundaries", () => {
  const base = project();
  const assets = [
    image(base, "later", { startOffsetMs: 2_000, endOffsetMs: 3_000 }),
    image(base, "bottom"), image(base, "top", { startOffsetMs: 500 })
  ].map(legacyImage);
  const normalized = normalizeEditorProject({ ...base, imageAssets: assets, imageLaneCount: undefined });
  assert.ok(normalized);
  assert.equal(normalized.imageLaneCount, 2);
  assert.deepEqual(normalized.imageAssets.map(({ id, lane }) => ({ id, lane })), [
    { id: "later", lane: 0 }, { id: "bottom", lane: 0 }, { id: "top", lane: 1 }
  ]);
  assert.deepEqual(normalized.imageAssets.map(withoutLane), assets);
  assert.deepEqual(normalized.clips, base.clips);
  assert.deepEqual(imageAssetsAtTimeline(normalized, 1_000).map(({ id }) => id), ["bottom", "top"]);
  assert.deepEqual(imageAssetsAtTimeline(normalized, 2_000).map(({ id }) => id), ["later"]);
  const roundTrip = normalizeEditorProject(JSON.parse(JSON.stringify(normalized)));
  assert.deepEqual(roundTrip?.imageAssets, normalized.imageAssets);
  assert.equal(roundTrip?.imageLaneCount, 2);
});

test("explicit rows and empty rows persist; crowded legacy projects retain every image beyond the add limit", () => {
  const base = project();
  const explicit = image(base, "authored", { lane: 5 });
  const normalized = normalizeEditorProject({ ...base, imageAssets: [explicit], imageLaneCount: 7 });
  assert.ok(normalized);
  assert.equal(normalized.imageLaneCount, 7);
  assert.deepEqual(normalized.imageAssets, [explicit]);
  assert.equal(normalizeEditorProject({ ...normalized, imageLaneCount: 1 })?.imageLaneCount, 6);
  const legacy = Array.from({ length: MAX_IMAGE_LANES + 3 }, (_, index) => legacyImage(image(base, `legacy-${index}`)));
  const migrated = normalizeImageLaneLayout(legacy, base.clips, undefined);
  assert.equal(migrated.imageLaneCount, legacy.length);
  assert.equal(new Set(migrated.imageAssets.map(({ lane }) => lane)).size, legacy.length);
  assert.deepEqual(migrated.imageAssets.map(withoutLane), legacy);
  assert.deepEqual(normalizeImageLaneLayout(migrated.imageAssets, base.clips, migrated.imageLaneCount), migrated);
});

test("new overlapping images choose a free row and sequential images reuse a row", () => {
  const base = project();
  const first = image(base, "first");
  const current = { ...base, imageAssets: [first] };
  assert.equal(first.lane, 0);
  assert.equal(image(current, "second").lane, 1);
  assert.equal(image(current, "next", { startOffsetMs: 2_000, endOffsetMs: 3_000 }).lane, 0);
  assert.equal(image(current, "explicit", { lane: 0 }).lane, 0);
});

test("image row removal only compacts empty rows and preserves all authored image fields", () => {
  const base = project();
  const authored = {
    ...base, imageLaneCount: 4,
    clips: base.clips.map((clip) => ({ ...clip, enabled: false })),
    imageAssets: [image(base, "low", { lane: 0 }), image(base, "high", { lane: 3 })]
  };
  assert.equal(lastEmptyLane(4, authored.imageAssets, 1), 2);
  assert.equal(removeImageLane(authored, 3), authored, "disabled clips still occupy their rows");
  assert.equal(removeImageLane(authored, -1), authored);
  const removed = removeImageLane(authored, 1);
  assert.equal(removed.imageLaneCount, 3);
  assert.deepEqual(removed.imageAssets.map(({ lane }) => lane), [0, 2]);
  assert.deepEqual(removed.imageAssets.map(withoutLane), authored.imageAssets.map(withoutLane));
  assert.deepEqual(removed.clips, authored.clips);
  assert.equal(removeImageLane(base, 0), base);
  let added = base;
  for (let index = 0; index < 12; index += 1) added = addImageLane(added);
  assert.equal(added.imageLaneCount, MAX_IMAGE_LANES);
  assert.equal(addImageLane(added), added);
});

test("caption row removal preserves human text, timing and placement, including disabled clips", () => {
  const base = { ...project(), subtitleLaneCount: 4 };
  const cue = { ...createSubtitleCue(base, {
    id: "human", clipId: base.clips[0]!.id, lane: 3, text: "사람이 작성한 자막",
    x: 0.3, y: 0.6, startOffsetMs: 125, endOffsetMs: 1_875
  }), humanEdited: true };
  assert.equal(cue.humanEdited, true);
  const authored = { ...base, subtitles: [cue], clips: base.clips.map((clip) => ({ ...clip, enabled: false })) };
  assert.equal(removeSubtitleLane(authored, 3), authored);
  const removed = removeSubtitleLane(authored, 1);
  assert.equal(removed.subtitleLaneCount, 3);
  assert.equal(removed.subtitles[0]!.lane, 2);
  assert.deepEqual(removed.subtitles.map(withoutLane), authored.subtitles.map(withoutLane));
  assert.deepEqual(removed.clips, authored.clips);
  const minimum = { ...base, subtitleLaneCount: 2, subtitles: [] };
  assert.equal(removeSubtitleLane(minimum, 1), minimum);
});

test("shorts save, normalization and export retain image lanes independently from the parent and sibling workspace", () => {
  const base = project();
  base.imageLaneCount = 6;
  base.imageAssets = [image(base, "parent", { lane: 5 })];
  const before = structuredClone(base);
  const workspace = createShortFormWorkspaceProject(base);
  assert.equal(workspace.imageLaneCount, 1);
  assert.deepEqual(workspace.imageAssets, []);
  workspace.imageLaneCount = 4;
  workspace.imageAssets = [image(workspace, "short-bottom", { lane: 2 }), image(workspace, "short-top", { lane: 0 })];
  const branch = shortFormBranchFromWorkspace(base, workspace);
  assert.equal(branch.imageLaneCount, 4);
  assert.deepEqual(branch.imageAssets, workspace.imageAssets);
  const saved = saveActiveShortFormWorkspace(base.shortFormWorkspaces, base.shortForm, branch, base.clips);
  const sibling = addShortFormWorkspace(saved, branch, { id: "sibling", name: "sibling" }, base.clips);
  assert.equal(activeShortFormWorkspace(sibling, branch).shortForm.imageLaneCount, 1);
  assert.deepEqual(activeShortFormWorkspace(sibling, branch).shortForm.imageAssets, []);
  assert.deepEqual(sibling.workspaces[0]!.shortForm.imageAssets, workspace.imageAssets);
  const persisted = normalizeEditorProject({ ...base, shortForm: branch, shortFormWorkspaces: saved });
  assert.ok(persisted);
  const render = deriveShortFormRenderProject(persisted);
  assert.equal(render.imageLaneCount, 4);
  assert.deepEqual(render.imageAssets, workspace.imageAssets);
  assert.deepEqual(imageAssetsAtTimeline(render, 1_000).map(({ id }) => id), ["short-bottom", "short-top"]);
  assert.deepEqual(persisted.imageAssets, base.imageAssets);
  assert.equal(persisted.imageLaneCount, 6);
  assert.deepEqual(base, before);
});

test("short video row removal changes only an empty row and never changes z-order, geometry or timing", () => {
  const base = project();
  const branch = addShortFormVideoAsset(base.shortForm, {
    id: "video", lane: 2, zIndex: 7, sourceClipId: base.clips[0]!.id,
    sourceSelectionStartMs: 10_000, sourceSelectionEndMs: 20_000,
    sourceStartMs: 10_250, sourceEndMs: 12_250, timelineStartMs: 500, timelineEndMs: 2_500,
    sourceRect: { x: 0.1, y: 0.2, width: 0.5, height: 0.6, referenceWidth: 1920, referenceHeight: 1080 },
    destinationRect: { x: 13, y: 17, width: 800, height: 1500 }
  });
  const authored = normalizeShortFormBranch({ ...branch, videoLaneCount: 4 });
  assert.deepEqual(removeShortFormVideoLane(authored, 2), authored);
  const removed = removeShortFormVideoLane(authored, 1);
  assert.equal(removed.videoLaneCount, 3);
  assert.equal(removed.videoAssets[0]!.lane, 1);
  assert.deepEqual(removed.videoAssets.map(withoutLane), authored.videoAssets.map(withoutLane));
  assert.deepEqual(removeShortFormVideoLane(base.shortForm, 0), base.shortForm);
});
