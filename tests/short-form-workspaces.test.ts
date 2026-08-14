import assert from "node:assert/strict";
import test from "node:test";

import {
  createEditorProjectFromCapture,
  normalizeEditorProject
} from "../src/lib/editor-core.js";
import {
  LEGACY_SHORT_FORM_WORKSPACE_ID,
  SHORT_FORM_WORKSPACES_SCHEMA,
  UnsupportedShortFormWorkspaceSchemaError,
  activateShortFormWorkspace,
  activeShortFormWorkspace,
  addShortFormVideoAsset,
  addShortFormWorkspace,
  deleteShortFormWorkspace,
  normalizeShortFormWorkspaceCollection,
  renameShortFormWorkspace,
  saveActiveShortFormWorkspace
} from "../src/lib/short-form.js";

const capture = {
  projectName: "여러 쇼츠",
  segments: [{
    id: "source-a",
    startSeconds: 10,
    endSeconds: 15,
    description: "A"
  }]
};

function branchWithVideo(project = createEditorProjectFromCapture(capture)) {
  return addShortFormVideoAsset(project.shortForm, {
    id: "video-a",
    sourceClipId: project.clips[0]!.id,
    sourceSelectionStartMs: 10_000,
    sourceSelectionEndMs: 15_000,
    sourceStartMs: 10_000,
    sourceEndMs: 12_000,
    timelineStartMs: 0,
    timelineEndMs: 2_000,
    sourceRect: {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      referenceWidth: 1920,
      referenceHeight: 1080
    },
    destinationRect: { x: 0, y: 0, width: 1080, height: 1920 }
  });
}

test("구형 단일 shortForm은 쇼츠 1 하나로 무손실 migration된다", () => {
  const project = createEditorProjectFromCapture(capture);
  const shortForm = branchWithVideo(project);
  const migrated = normalizeEditorProject({
    ...project,
    shortForm,
    shortFormWorkspaces: undefined
  });
  assert.ok(migrated);
  assert.equal(migrated.shortFormWorkspaces.schema, SHORT_FORM_WORKSPACES_SCHEMA);
  assert.equal(
    migrated.shortFormWorkspaces.activeWorkspaceId,
    LEGACY_SHORT_FORM_WORKSPACE_ID
  );
  assert.equal(migrated.shortFormWorkspaces.workspaces.length, 1);
  assert.equal(migrated.shortFormWorkspaces.workspaces[0]!.name, "쇼츠 1");
  assert.deepEqual(
    migrated.shortFormWorkspaces.workspaces[0]!.shortForm.videoAssets,
    migrated.shortForm.videoAssets
  );
});

test("활성 mirror 저장·전환은 형제 쇼츠를 바꾸지 않는다", () => {
  const project = createEditorProjectFromCapture(capture);
  const authored = branchWithVideo(project);
  let collection = saveActiveShortFormWorkspace(
    project.shortFormWorkspaces,
    project.shortForm,
    authored,
    project.clips
  );
  collection = addShortFormWorkspace(
    collection,
    authored,
    { id: "shorts-b", name: "B" },
    project.clips
  );
  assert.equal(activeShortFormWorkspace(collection, authored).id, "shorts-b");
  assert.equal(activeShortFormWorkspace(collection, authored).shortForm.videoAssets.length, 0);

  collection = activateShortFormWorkspace(
    collection,
    authored,
    LEGACY_SHORT_FORM_WORKSPACE_ID,
    project.clips
  );
  assert.equal(activeShortFormWorkspace(collection, authored).shortForm.videoAssets[0]!.id, "video-a");
  assert.equal(collection.workspaces.find(({ id }) => id === "shorts-b")!
    .shortForm.videoAssets.length, 0);
});

test("복제는 내용은 보존하되 모든 편집 엔티티 namespace를 분리한다", () => {
  const project = createEditorProjectFromCapture(capture);
  const authored = branchWithVideo(project);
  const base = saveActiveShortFormWorkspace(
    project.shortFormWorkspaces,
    project.shortForm,
    authored,
    project.clips
  );
  const duplicated = addShortFormWorkspace(
    base,
    authored,
    { id: "shorts-copy", duplicateActive: true },
    project.clips
  );
  const source = duplicated.workspaces[0]!.shortForm;
  const copy = duplicated.workspaces[1]!.shortForm;
  assert.equal(copy.videoAssets.length, source.videoAssets.length);
  assert.notEqual(copy.videoAssets[0]!.id, source.videoAssets[0]!.id);
  assert.match(copy.videoAssets[0]!.id, /^shorts-copy-video-/u);
  assert.deepEqual(copy.videoAssets[0]!.sourceRect, source.videoAssets[0]!.sourceRect);
});

test("작업명은 정규화되고 마지막 쇼츠 삭제는 fail-closed다", () => {
  const project = createEditorProjectFromCapture(capture);
  const base = normalizeShortFormWorkspaceCollection(
    project.shortFormWorkspaces,
    project.shortForm,
    project.clips
  );
  const renamed = renameShortFormWorkspace(
    base,
    project.shortForm,
    base.activeWorkspaceId,
    "  대표 쇼츠  ",
    project.clips
  );
  assert.equal(renamed.workspaces[0]!.name, "대표 쇼츠");
  assert.throws(
    () => deleteShortFormWorkspace(
      renamed,
      project.shortForm,
      renamed.activeWorkspaceId,
      project.clips
    ),
    /마지막 쇼츠 작업/u
  );
});

test("미래 workspace schema는 거절하고 서로 다른 작업의 cache ID 충돌은 복구한다", () => {
  const project = createEditorProjectFromCapture(capture);
  const authored = branchWithVideo(project);
  assert.throws(
    () => normalizeShortFormWorkspaceCollection(
      { schema: "kirinuki-short-form-workspaces/v99" },
      authored,
      project.clips
    ),
    UnsupportedShortFormWorkspaceSchemaError
  );
  const normalized = normalizeShortFormWorkspaceCollection({
    schema: SHORT_FORM_WORKSPACES_SCHEMA,
    activeWorkspaceId: "b",
    workspaces: [
      { id: "a", name: "A", shortForm: authored },
      { id: "b", name: "B", shortForm: authored }
    ]
  }, authored, project.clips);
  assert.notEqual(
    normalized.workspaces[0]!.shortForm.videoAssets[0]!.id,
    normalized.workspaces[1]!.shortForm.videoAssets[0]!.id
  );
});

test("collection이 있으면 더 최신 revision의 legacy mirror만 활성 작업에 병합한다", () => {
  const project = createEditorProjectFromCapture(capture);
  const newerMirror = branchWithVideo(project);
  const normalized = normalizeEditorProject({ ...project, shortForm: newerMirror });
  assert.ok(normalized);
  assert.equal(normalized.shortForm.videoAssets.length, 1);
  assert.equal(
    normalized.shortFormWorkspaces.workspaces[0]!.shortForm.videoAssets.length,
    1
  );
});
