import assert from "node:assert/strict";
import test from "node:test";
import { createVideoCropController } from "../src/editor/video-crop-controller.js";

// A deliberately small event/element fixture: exercise the real controller's
// asynchronous open and click handlers, without a browser or user storage.
class CropElement extends EventTarget {
  hidden = true;
  disabled = false;
  open = false;
  width = 160;
  height = 90;
  videoWidth = 160;
  videoHeight = 90;
  readyState = 2;
  seeking = false;
  value = "";
  max = "";
  dataset: Record<string, string> = {};
  classList = { toggle: () => false };
  style = { visibility: "", opacity: "", setProperty: (_name: string, _value: string) => undefined };
  getContext() { return { drawImage: () => undefined }; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() { /* Focus itself is covered by the real browser journey. */ }
}

function fixture(prepareClip: () => Promise<void>) {
  const controls = new Map<string, CropElement>();
  const control = (id: string) => {
    let element = controls.get(id);
    if (!element) { element = new CropElement(); controls.set(id, element); }
    return element;
  };
  const globals: Record<string, unknown> = {
    document: { getElementById: control },
    HTMLButtonElement: CropElement, HTMLDialogElement: CropElement,
    HTMLDivElement: CropElement, HTMLCanvasElement: CropElement, HTMLInputElement: CropElement
  };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const clip = {
    id: "clip-a", selectionId: "selection-a", enabled: true,
    sourceStartMs: 100_000, sourceEndMs: 110_000,
    selectionStartMs: 100_000, selectionEndMs: 110_000, timelineStartMs: 0
  };
  const state = {
    sessionKey: "project-a:session-a:1", mainWorkspace: true, available: true,
    editable: true, sourceComposerActive: false, selectedClip: clip, previewClip: clip,
    video: new CropElement() as unknown as HTMLVideoElement
  };
  const applied: string[] = [];
  const inserted: string[] = [];
  const errors: unknown[] = [];
  const controller = createVideoCropController({
    state: () => state, prepareClip,
    apply: (id) => { applied.push(id); },
    insert: (id) => { inserted.push(id); },
    onError: (error) => { errors.push(error); }, letterboxColor: "#000000"
  });
  return {
    state, controller, applied, inserted, errors,
    dialog: control("main-video-crop-dialog"),
    click: (id: string) => control(id).dispatchEvent(new Event("click")),
    restore: () => {
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  };
}

const settleEvents = () => new Promise<void>((resolve) => setImmediate(resolve));
type EligibilityChange = "source-composer" | "disabled-clip";
function invalidate(value: ReturnType<typeof fixture>, change: EligibilityChange) {
  if (change === "source-composer") value.state.sourceComposerActive = true;
  else value.state.selectedClip.enabled = false;
}

test("crop preparation cannot open a stale modal after source composer activation or clip disabling", async () => {
  for (const change of ["source-composer", "disabled-clip"] as const) {
    let finishPreparation: () => void = () => undefined;
    const preparation = new Promise<void>((resolve) => { finishPreparation = resolve; });
    const value = fixture(() => preparation);
    try {
      value.click("open-main-video-crop");
      assert.equal(value.dialog.open, false);
      invalidate(value, change);
      finishPreparation();
      await settleEvents();
      assert.equal(value.dialog.open, false, change);
      assert.deepEqual(value.applied, []);
      assert.deepEqual(value.inserted, []);
      assert.deepEqual(value.errors, []);
      value.state.sourceComposerActive = false;
      value.state.selectedClip.enabled = true;
      value.click("open-main-video-crop");
      await settleEvents();
      assert.equal(value.dialog.open, true, "a fresh eligible open still works");
      value.click("cancel-main-video-crop");
    } finally {
      finishPreparation();
      await settleEvents();
      value.restore();
    }
  }
});

test("a stale open crop draft closes on render and cannot apply or insert before that render", async () => {
  for (const change of ["source-composer", "disabled-clip"] as const) {
    for (const action of ["render", "apply-main-video-crop", "insert-main-video-crop"] as const) {
      const value = fixture(async () => undefined);
      try {
        value.click("open-main-video-crop");
        await settleEvents();
        assert.equal(value.dialog.open, true);
        invalidate(value, change);
        if (action === "render") value.controller.render();
        else value.click(action);
        assert.deepEqual(value.applied, [], `${change}: ${action}`);
        assert.deepEqual(value.inserted, [], `${change}: ${action}`);
        value.controller.render();
        assert.equal(value.dialog.open, false);
        assert.deepEqual(value.errors, []);
      } finally {
        await settleEvents();
        value.restore();
      }
    }
  }
});
