import assert from "node:assert/strict";
import test from "node:test";

import {
  createAudioRegion, createEditorProjectFromCapture, createImageAsset,
  createSubtitleCue, type EditorProject
} from "../src/lib/editor-core.js";
import {
  activateShortFormWorkspace, activeShortFormWorkspace,
  createShortFormWorkspaceProject, normalizeShortFormWorkspaceCollection,
  saveActiveShortFormWorkspace, seedShortFormBranch, shortFormBranchFromWorkspace
} from "../src/lib/short-form.js";
import {
  recoveryChangedSections, recoveryContentFingerprint, recoveryContentSections
} from "../src/lib/recovery-review.js";

function authoredProject(): EditorProject {
  const project = createEditorProjectFromCapture({
    projectName: "Recovery review fixture",
    source: { platform: "CHZZK", contentType: "vod", contentId: "100", canonicalUrl: "https://chzzk.naver.com/video/100" },
    segments: [
      { id: "first", startSeconds: 10, endSeconds: 20, description: "First authored cut" },
      { id: "second", startSeconds: 30, endSeconds: 35, description: "Second authored cut" }
    ]
  }, { id: "recovery-review", createdAt: "2026-11-06T00:00:00.000Z" });
  project.subtitles = [createSubtitleCue(project, {
    id: "caption", text: "같은 개수여도 다른 자막", startOffsetMs: 125, endOffsetMs: 1_875,
    color: "#ffffff", fontScale: 1.2, backgroundEnabled: true
  })];
  project.imageAssets = [createImageAsset(project, {
    id: "overlay", blobKey: "recovery-review:overlay", mimeType: "image/png",
    x: 0.25, y: 0.6, scale: 0.5, opacity: 0.75, naturalWidth: 640, naturalHeight: 480
  })];
  project.audioRegions = [createAudioRegion(project, { id: "audio", gain: 0.7, fadeInMs: 150 })];
  project.mediaAsset = { name: "source.mp4", durationMs: 60_000, hasVideo: true, hasAudio: true, mediaOriginMs: 0 };
  project.shortForm = seedShortFormBranch(project, [{ clipId: project.clips[0]!.id }]);
  project.shortFormWorkspaces = normalizeShortFormWorkspaceCollection(null, project.shortForm, project.clips);
  const first = project.shortFormWorkspaces.workspaces[0]!;
  project.shortFormWorkspaces.workspaces.push({ ...structuredClone(first), id: "second-shorts", name: "Second Shorts" });
  project.shortFormWorkspaces = normalizeShortFormWorkspaceCollection(
    project.shortFormWorkspaces, project.shortForm, project.clips
  );
  return project;
}

function assertOnlySectionChanged(
  original: EditorProject,
  section: string,
  edit: (changed: EditorProject) => void
): void {
  const changed = structuredClone(original);
  edit(changed);
  assert.deepEqual(recoveryChangedSections(original, changed), [section]);
  assert.deepEqual(recoveryChangedSections(changed, original), [section]);
  assert.notEqual(recoveryContentFingerprint(original), recoveryContentFingerprint(changed));
}

test("same-count caption text, timing and style edits remain visible in recovery comparisons", () => {
  const original = authoredProject();
  for (const edit of [
    (project: EditorProject) => { project.subtitles[0]!.text = "직접 고친 자막"; },
    (project: EditorProject) => { project.subtitles[0]!.endOffsetMs += 100; },
    (project: EditorProject) => { project.subtitles[0]!.color = "#ff0000"; },
    (project: EditorProject) => { project.subtitles[0]!.fontScale = 1.5; },
    (project: EditorProject) => { project.subtitles[0]!.backgroundEnabled = false; },
    (project: EditorProject) => { project.subtitleDefaults.outlineWidth += 1; },
    (project: EditorProject) => { project.subtitleLaneCount += 1; }
  ]) {
    assertOnlySectionChanged(original, "자막", (changed) => {
      edit(changed);
      assert.equal(changed.subtitles.length, original.subtitles.length);
    });
  }
});

test("equal item counts do not hide cut order, trim, enabled state or authored notes", () => {
  const original = authoredProject();
  for (const edit of [
    (project: EditorProject) => { project.clips.reverse(); },
    (project: EditorProject) => { project.clips[0]!.sourceStartMs += 125; },
    (project: EditorProject) => { project.clips[0]!.selectionEndMs -= 250; },
    (project: EditorProject) => { project.clips[0]!.enabled = false; },
    (project: EditorProject) => { project.clips[0]!.note = "사용자가 확정한 메모"; }
  ]) assertOnlySectionChanged(original, "컷", edit);
});

test("same-count image and audio differences preserve exact references, placement and mix settings", () => {
  const original = authoredProject();
  for (const edit of [
    (project: EditorProject) => { project.imageAssets[0]!.source.value = "recovery-review:other-blob"; },
    (project: EditorProject) => { project.imageAssets[0]!.x = 0.7; },
    (project: EditorProject) => { project.imageAssets[0]!.opacity = 0.3; },
    (project: EditorProject) => { project.imageAssets[0]!.lane = 1; },
    (project: EditorProject) => { project.imageLaneCount = 4; }
  ]) assertOnlySectionChanged(original, "이미지", edit);
  for (const edit of [
    (project: EditorProject) => { project.audioRegions[0]!.muted = true; },
    (project: EditorProject) => { project.audioRegions[0]!.gain = 0.4; },
    (project: EditorProject) => { project.audioRegions[0]!.fadeOutMs = 200; }
  ]) assertOnlySectionChanged(original, "음성", edit);
});

test("recovery comparisons inspect inactive Shorts documents and same-count framing edits", () => {
  const original = authoredProject();
  assert.ok(original.shortForm.videoAssets.length > 0);
  for (const edit of [
    (project: EditorProject) => { project.shortForm.videoAssets[0]!.destinationRect.x += 12; },
    (project: EditorProject) => { project.shortForm.videoAssets[0]!.sourceRect.width -= 8; },
    (project: EditorProject) => { project.shortForm.videoAssets[0]!.audioGain = 0.3; },
    (project: EditorProject) => { project.shortFormWorkspaces.workspaces[1]!.name = "Renamed saved Shorts"; },
    (project: EditorProject) => { project.shortFormWorkspaces.workspaces[1]!.shortForm.videoAssets[0]!.visible = false; },
    (project: EditorProject) => { project.shortFormWorkspaces.workspaces[1]!.shortForm.imageLaneCount = 5; }
  ]) assertOnlySectionChanged(original, "쇼츠", edit);
});

test("project and media identity differences are reported independently from edit counts", () => {
  const original = authoredProject();
  for (const edit of [
    (project: EditorProject) => { project.name = "Different project name"; },
    (project: EditorProject) => { project.source.contentId = "101"; },
    (project: EditorProject) => { project.mediaAsset!.mediaOriginMs = 10_000; },
    (project: EditorProject) => { project.mediaAsset!.name = "different-source.mp4"; }
  ]) assertOnlySectionChanged(original, "작업 정보", edit);
});

test("selection, playhead and document timestamps do not masquerade as authored changes", () => {
  const original = authoredProject();
  const changed = structuredClone(original);
  changed.selectedClipId = changed.clips[1]!.id;
  changed.selectedCueId = changed.subtitles[0]!.id;
  changed.selectedImageAssetId = changed.imageAssets[0]!.id;
  changed.playheadMs = 4_000;
  changed.createdAt = "2026-11-06T01:00:00.000Z";
  changed.updatedAt = "2026-11-06T02:00:00.000Z";
  changed.clips[0]!.updatedAt = changed.updatedAt;
  changed.subtitles[0]!.createdAt = changed.createdAt;
  changed.imageAssets[0]!.updatedAt = changed.updatedAt;
  changed.audioRegions[0]!.updatedAt = changed.updatedAt;
  for (const branch of [changed.shortForm, ...changed.shortFormWorkspaces.workspaces.map((workspace) => workspace.shortForm)]) {
    branch.selectedVideoLayerId = branch.videoAssets[0]!.id;
    branch.selectedSourceAudioAssetId = "selection-only";
    branch.playheadMs = 2_000;
  }
  assert.deepEqual(recoveryChangedSections(original, changed), []);
  assert.equal(recoveryContentFingerprint(original), recoveryContentFingerprint(changed));
});

test("repeated real Shorts snapshots remain equal when only persistence revision and transport selection change", () => {
  const original = authoredProject();
  const workspace = createShortFormWorkspaceProject(original);
  const firstBranch = shortFormBranchFromWorkspace(original, workspace);
  const first = {
    ...original,
    shortForm: firstBranch,
    shortFormWorkspaces: saveActiveShortFormWorkspace(original.shortFormWorkspaces, original.shortForm, firstBranch, original.clips)
  };
  const nextWorkspace = { ...workspace, shortForm: firstBranch, playheadMs: 1_000 };
  const nextBranch = shortFormBranchFromWorkspace(first, nextWorkspace);
  const next = {
    ...first,
    shortForm: nextBranch,
    shortFormWorkspaces: saveActiveShortFormWorkspace(first.shortFormWorkspaces, first.shortForm, nextBranch, first.clips)
  };
  assert.ok(nextBranch.revision > firstBranch.revision, "fixture must exercise the real persisted snapshot path");
  assert.deepEqual(recoveryChangedSections(first, next), []);
  assert.equal(recoveryContentFingerprint(first), recoveryContentFingerprint(next));
});

test("comparison ignores object property order without reordering arrays or mutating authored fields", () => {
  const original = authoredProject();
  original.subtitles[0]!.customReview = { reviewerNote: "Keep exactly", timing: [125, 1_875] };
  const before = structuredClone(original);
  const reordered = structuredClone(original);
  reordered.subtitles[0] = Object.fromEntries(Object.entries(reordered.subtitles[0]!).reverse()) as typeof reordered.subtitles[number];
  function freezeTree(value: unknown): void {
    if (!value || typeof value !== "object") return;
    Object.freeze(value);
    for (const child of Object.values(value)) freezeTree(child);
  }
  freezeTree(original);
  freezeTree(reordered);
  const sections = recoveryContentSections(original);
  assert.deepEqual(recoveryChangedSections(original, reordered), []);
  assert.equal(recoveryContentFingerprint(original), recoveryContentFingerprint(reordered));
  assert.deepEqual(original, before);
  assert.deepEqual(sections["자막"], [before.subtitles, before.subtitleDefaults, before.subtitleLaneCount]);
  assertOnlySectionChanged(original, "자막", (changed) => {
    changed.subtitles[0]!.customReview = { reviewerNote: "Different authored review", timing: [125, 1_875] };
  });
});

test("unknown nested revision fields remain meaningful outside Shorts persistence metadata", () => {
  const original = authoredProject();
  original.subtitles[0]!.customReview = { revision: 1, note: "Authored extension" };
  original.shortForm.videoAssets[0]!.destinationRect = {
    ...original.shortForm.videoAssets[0]!.destinationRect,
    revision: 1
  } as typeof original.shortForm.videoAssets[number]["destinationRect"];
  assertOnlySectionChanged(original, "자막", (changed) => {
    changed.subtitles[0]!.customReview = { revision: 2, note: "Authored extension" };
  });
  assertOnlySectionChanged(original, "쇼츠", (changed) => {
    Object.assign(changed.shortForm.videoAssets[0]!.destinationRect, { revision: 2 });
  });
});

test("switching real active Shorts workspaces does not report an authored change", () => {
  const original = authoredProject();
  original.shortFormWorkspaces.workspaces[1]!.shortForm.videoAssets[0]!.destinationRect.x = 100;
  const before = structuredClone(original);
  assert.deepEqual(original.shortForm, original.shortFormWorkspaces.workspaces[0]!.shortForm);
  const collection = activateShortFormWorkspace(
    original.shortFormWorkspaces, original.shortForm, "second-shorts", original.clips
  );
  const switched = {
    ...original,
    shortForm: activeShortFormWorkspace(collection, original.shortForm, original.clips).shortForm,
    shortFormWorkspaces: collection
  };
  assert.notDeepEqual(switched.shortForm, original.shortForm, "the active carrier must actually change");
  assert.notEqual(switched.shortFormWorkspaces.activeWorkspaceId, original.shortFormWorkspaces.activeWorkspaceId);
  assert.deepEqual(switched.shortForm, collection.workspaces[1]!.shortForm);
  assert.deepEqual(collection.workspaces, original.shortFormWorkspaces.workspaces);
  assert.deepEqual(recoveryChangedSections(original, switched), []);
  assert.equal(recoveryContentFingerprint(original), recoveryContentFingerprint(switched));
  assert.deepEqual(original, before, "comparison and navigation must not rewrite the authored original");

  assertOnlySectionChanged(switched, "쇼츠", (changed) => {
    changed.shortForm.videoAssets[0]!.destinationRect.x += 25;
    changed.shortFormWorkspaces.workspaces[1]!.shortForm = structuredClone(changed.shortForm);
  });
  assertOnlySectionChanged(switched, "쇼츠", (changed) => {
    changed.shortFormWorkspaces.workspaces[0]!.shortForm.videoAssets[0]!.audioGain = 0.2;
  });
});

test("divergent legacy carriers and unknown branch fields cannot disappear during workspace comparison", () => {
  const original = authoredProject();
  assertOnlySectionChanged(original, "쇼츠", (changed) => {
    changed.shortForm.videoAssets[0]!.destinationRect.x += 25;
  });
  assertOnlySectionChanged(original, "쇼츠", (changed) => {
    changed.shortFormWorkspaces.workspaces[0]!.shortForm.videoAssets[0]!.audioGain = 0.2;
  });
  assertOnlySectionChanged(original, "쇼츠", (changed) => {
    Object.assign(changed.shortForm, { customAuthoringState: { revision: 3, text: "Legacy-only authored data" } });
  });
  const divergent = structuredClone(original);
  Object.assign(divergent.shortForm, { customAuthoringState: { revision: 3 } });
  assertOnlySectionChanged(divergent, "쇼츠", (changed) => {
    Object.assign(changed.shortForm, { customAuthoringState: { revision: 4 } });
  });
  assertOnlySectionChanged(original, "쇼츠", (changed) => {
    Object.assign(changed.shortFormWorkspaces, { customAuthoringState: { revision: 4 } });
  });
});

test("missing or ambiguous active workspace references retain the original recovery comparison", () => {
  const original = authoredProject();
  const missing = structuredClone(original);
  missing.shortFormWorkspaces.activeWorkspaceId = "missing-workspace";
  assertOnlySectionChanged(missing, "쇼츠", (changed) => {
    changed.shortFormWorkspaces.activeWorkspaceId = "another-missing-workspace";
  });
  const ambiguous = structuredClone(original);
  ambiguous.shortFormWorkspaces.workspaces[1]!.id = ambiguous.shortFormWorkspaces.activeWorkspaceId;
  assertOnlySectionChanged(ambiguous, "쇼츠", (changed) => {
    changed.shortForm.videoAssets[0]!.destinationRect.x += 15;
  });
  const unknownSchema = structuredClone(original);
  Object.assign(unknownSchema.shortFormWorkspaces, { schema: "unknown-workspace-schema" });
  assertOnlySectionChanged(unknownSchema, "쇼츠", (changed) => {
    changed.shortFormWorkspaces.activeWorkspaceId = "second-shorts";
  });
});

test("partial stored projects are compared without treating unknown workspace data as an editor document", () => {
  const partial: Readonly<Record<string, unknown>> = { id: "legacy", name: "Saved partial project" };
  assert.deepEqual(recoveryChangedSections(partial, { ...partial }), []);
  for (const shortFormWorkspaces of [
    null, [], "legacy extension", { workspaces: [null] },
    { schema: "kirinuki-short-form-workspaces/v1", activeWorkspaceId: "active", workspaces: [null] },
    { schema: "kirinuki-short-form-workspaces/v1", activeWorkspaceId: "active", workspaces: [{ id: "active", shortForm: "raw branch" }] }
  ]) {
    const original = { ...partial, shortFormWorkspaces };
    const changed = { ...original, shortForm: { customLegacyContent: "preserve me" } };
    assert.deepEqual(recoveryChangedSections(original, changed), ["쇼츠"]);
    assert.notEqual(recoveryContentFingerprint(original), recoveryContentFingerprint(changed));
  }
});

test("multiple changed sections are reported once each in a stable display order", () => {
  const original = authoredProject();
  const changed = structuredClone(original);
  changed.name = "Saved alternate";
  changed.subtitles[0]!.text = "Another sentence";
  changed.subtitles[0]!.fontScale = 2;
  changed.audioRegions[0]!.gain = 0;
  changed.shortFormWorkspaces.workspaces[1]!.name = "Alternate Shorts";
  assert.deepEqual(recoveryChangedSections(original, changed), ["작업 정보", "자막", "음성", "쇼츠"]);
});
