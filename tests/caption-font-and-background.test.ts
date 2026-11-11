import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import {
  appendAiSubtitleDrafts, applyCaptionFont, createEditorProjectFromCapture, createSubtitleCue,
  normalizeEditorProject, resolveSubtitleCueBackground, updateSubtitleCue,
  type EditorProject, type EditorSubtitleCue
} from "../src/lib/editor-core.js";
import { CAPTION_FONT_REGISTRY, captionFont } from "../src/lib/caption-style.js";
import {
  addShortFormWorkspace, createShortFormWorkspaceProject, saveActiveShortFormWorkspace,
  shortFormBranchFromWorkspace
} from "../src/lib/short-form.js";
import { editorKeyboardShortcutBinding } from "../src/lib/keyboard-shortcuts.js";
import { translateUiCopy } from "../src/lib/ui-localization.js";
import { EDITOR_STATIC_UI_COPY } from "../src/editor/ui-copy-static.js";
import { EDITOR_RUNTIME_UI_COPY, EDITOR_RUNTIME_UI_COPY_PATTERNS } from "../src/editor/ui-copy-runtime.js";
import { ADDITIONAL_CAPTION_FONTS } from "../scripts/additional-caption-fonts.js";
import { WEB_PACKAGE_FILES } from "../scripts/web-package-files.js";
import { createCaptionPropertiesSheet } from "../src/lib/caption-properties-sheet.js";

function fixture() {
  const project = createEditorProjectFromCapture({
    segments: [{ id: "a", startSeconds: 10, endSeconds: 16, description: "keep" }]
  });
  const cue = createSubtitleCue(project, {
    id: "human", clipId: project.clips[0]!.id, text: "한글 자막 Hello", lane: 1,
    startOffsetMs: 500, endOffsetMs: 4000, color: "#123456", fontScale: 0.075,
    x: 0.3, y: 0.6, backgroundEnabled: true, backgroundColor: "#ffffff"
  });
  return { ...project, subtitles: [cue] };
}

for (const font of Object.values(CAPTION_FONT_REGISTRY)) {
  test(`${font.family} persists independently of the style preset and preserves edits`, () => {
    const before = fixture();
    const changed = applyCaptionFont(before, font.id);
    const restored = normalizeEditorProject(JSON.parse(JSON.stringify(changed)));
    assert.ok(restored);
    assert.equal(restored.subtitleDefaults.fontId, font.id);
    assert.equal(restored.subtitleDefaults.fontFamily, font.family);
    assert.equal(restored.subtitleDefaults.fontWeight, font.weight);
    assert.equal(restored.subtitleDefaults.stylePresetId, before.subtitleDefaults.stylePresetId);
    assert.deepEqual(restored.subtitles, before.subtitles);
    assert.deepEqual(restored.clips, before.clips);
    assert.equal(restored.subtitleDefaults.fontScale, before.subtitleDefaults.fontScale);
    assert.equal(restored.subtitleDefaults.outlineColor, before.subtitleDefaults.outlineColor);
  });
}

test("unrecognized font IDs cannot load an arbitrary family or reset a known selection", () => {
  assert.equal(captionFont("untrusted", "paperlogy").id, "paperlogy");
  const project = applyCaptionFont(fixture(), "jua");
  assert.equal(applyCaptionFont(project, "url(https://example.invalid/font)").subtitleDefaults.fontId, "jua");
  const restored = normalizeEditorProject({ ...project, subtitleDefaults: {
    ...project.subtitleDefaults, fontFamily: "Untrusted", fontWeight: 900
  } });
  assert.equal(restored?.subtitleDefaults.fontFamily, "Jua");
  assert.equal(restored?.subtitleDefaults.fontWeight, 400);
});

test("white, black and off backgrounds round-trip without changing other cue properties", () => {
  const original = fixture();
  for (const color of ["#ffffff", "#000000"] as const) {
    for (const enabled of [true, false]) {
      const changed = updateSubtitleCue(original, "human", { backgroundEnabled: enabled, backgroundColor: color });
      const restored = normalizeEditorProject(JSON.parse(JSON.stringify(changed)));
      assert.ok(restored);
      const cue = restored.subtitles[0]!;
      assert.deepEqual(resolveSubtitleCueBackground(restored.subtitleDefaults, cue), {
        enabled, color: enabled ? color : "transparent", radiusEm: 0
      });
      assert.equal(cue.text, original.subtitles[0]!.text);
      assert.equal(cue.color, "#123456");
      assert.equal(cue.startOffsetMs, 500);
      assert.equal(cue.endOffsetMs, 4000);
      assert.equal(cue.x, 0.3);
      assert.equal(cue.fontScale, 0.075);
    }
  }
});

test("legacy black overrides remain black and malformed colors do not escape the palette", () => {
  const original = fixture();
  const restored = normalizeEditorProject({ ...original, subtitles: [
    { ...original.subtitles[0], backgroundColor: "url(https://example.invalid)" }
  ] });
  assert.ok(restored);
  assert.equal(restored.subtitles[0]!.backgroundColor, undefined);
  assert.equal(resolveSubtitleCueBackground(restored.subtitleDefaults, restored.subtitles[0]).color, "#000000");
});

test("caption comparison reports the selected white background", () => {
  const project = fixture();
  const sheet = createCaptionPropertiesSheet({ clips: project.clips, cues: project.subtitles, defaults: project.subtitleDefaults });
  assert.equal(sheet.rows[0]?.backgroundColor, "#ffffff");
});

test("automatic captions inherit the chosen font without replacing authored backgrounds or marking cues human", () => {
  const project = applyCaptionFont(fixture(), "jua");
  const updated = appendAiSubtitleDrafts(project, [{
    id: "automatic", clipId: project.clips[0]!.id, text: "자동 자막",
    startOffsetMs: 0, endOffsetMs: 400, origin: "ai"
  }]);
  assert.equal(updated.subtitleDefaults.fontId, "jua");
  assert.strictEqual(updated.subtitles.find((cue) => cue.id === "human"), project.subtitles[0]);
  const automatic = updated.subtitles.find((cue) => cue.id === "automatic");
  assert.ok(automatic);
  assert.equal(automatic.humanEdited, false);
  assert.equal(automatic.backgroundColor, undefined);
  assert.equal(resolveSubtitleCueBackground(updated.subtitleDefaults, automatic).enabled, false);
  const restored = normalizeEditorProject(JSON.parse(JSON.stringify(updated)));
  assert.equal(restored?.subtitleDefaults.fontId, "jua");
  assert.equal(restored?.subtitles.find((cue) => cue.id === "human")?.backgroundColor, "#ffffff");
});

test("Shorts font and white background persist without modifying main or sibling workspace captions", () => {
  const main = fixture();
  const original = structuredClone(main);
  const workspace = createShortFormWorkspaceProject(main);
  const shortCue = createSubtitleCue(workspace, {
    id: "short-caption", clipId: workspace.clips[0]!.id,
    text: "쇼츠 자막", startOffsetMs: 100, endOffsetMs: 1_000
  });
  const changed = applyCaptionFont(updateSubtitleCue({
    ...workspace, subtitles: [shortCue]
  }, shortCue.id, { backgroundEnabled: true, backgroundColor: "#ffffff" }), "dohyeon");
  const branch = shortFormBranchFromWorkspace(main, changed);
  let collection = saveActiveShortFormWorkspace(main.shortFormWorkspaces, main.shortForm, branch, main.clips);
  collection = addShortFormWorkspace(collection, branch, { id: "sibling", name: "다른 쇼츠" }, main.clips);
  collection = { ...collection, workspaces: collection.workspaces.map((item) => item.id === "sibling"
    ? { ...item, shortForm: {
      ...item.shortForm,
      subtitleDefaults: applyCaptionFont(main, "paperlogy").subtitleDefaults,
      ai: structuredClone(main.ai),
      subtitles: [{ ...shortCue, id: "sibling-caption", backgroundEnabled: true, backgroundColor: "#000000" as const }]
    } }
    : item) };
  const sibling = structuredClone(collection.workspaces.find((item) => item.id === "sibling")!);
  const root = normalizeEditorProject({ ...main, shortForm: branch, shortFormWorkspaces: {
    ...collection, activeWorkspaceId: main.shortFormWorkspaces.activeWorkspaceId
  } });
  assert.ok(root);
  const restored = createShortFormWorkspaceProject(root);
  assert.equal(restored.subtitleDefaults.fontId, "dohyeon");
  assert.equal(restored.subtitles[0]?.backgroundColor, "#ffffff");
  assert.deepEqual(root.subtitles, original.subtitles);
  assert.deepEqual(root.subtitleDefaults, original.subtitleDefaults);
  assert.deepEqual(root.shortFormWorkspaces.workspaces.find((item) => item.id === "sibling"), sibling);
  assert.deepEqual(main, original);
});

test("actual black button and X mapping turn inherited translucent backgrounds off and keep color choices separate", async () => {
  const source = await readFile(new URL("../src/editor/main.ts", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf("  const toggleCueBackground ="), source.indexOf("  elements.toggle_caption_background.addEventListener"));
  const base = fixture();
  const inherited = { ...base.subtitles[0]! };
  delete inherited.backgroundEnabled;
  delete inherited.backgroundColor;
  const state: {
    project: EditorProject;
    selectedCue(): EditorSubtitleCue;
    resolveSubtitleCueBackground: typeof resolveSubtitleCueBackground;
    updateSelectedCue(patch: Partial<EditorSubtitleCue>): void;
    showToast(): void;
    toggle(color: "#000000" | "#ffffff"): void;
  } = {
    project: { ...base, subtitles: [inherited], subtitleDefaults: {
      ...base.subtitleDefaults, backgroundColor: "rgba(0, 0, 0, 0.72)"
    } },
    selectedCue: () => state.project.subtitles[0]!,
    resolveSubtitleCueBackground,
    updateSelectedCue(patch) { state.project = updateSubtitleCue(state.project, "human", patch); },
    showToast() {},
    toggle() { throw new Error("Background handler was not loaded"); }
  };
  runInNewContext(transformSync(`${handler}\nglobalThis.toggle = toggleCueBackground;`, {
    loader: "ts", target: "es2022"
  }).code, state);
  state.toggle("#000000");
  assert.equal(resolveSubtitleCueBackground(state.project.subtitleDefaults, state.selectedCue()).enabled, false);
  state.toggle("#000000");
  assert.equal(resolveSubtitleCueBackground(state.project.subtitleDefaults, state.selectedCue()).color, "#000000");
  state.toggle("#ffffff");
  assert.equal(resolveSubtitleCueBackground(state.project.subtitleDefaults, state.selectedCue()).color, "#ffffff");
  state.toggle("#ffffff");
  assert.equal(resolveSubtitleCueBackground(state.project.subtitleDefaults, state.selectedCue()).enabled, false);
  state.toggle("#ffffff");
  state.toggle("#000000");
  assert.equal(resolveSubtitleCueBackground(state.project.subtitleDefaults, state.selectedCue()).color, "#000000");
  assert.equal(editorKeyboardShortcutBinding("X")?.targetId, "toggle-caption-background");
  assert.equal(state.selectedCue().color, inherited.color);
  assert.equal(state.selectedCue().text, inherited.text);
});

test("caption comparison describes both colors as backgrounds in every supported language", () => {
  for (const language of ["en", "ja"] as const) {
    for (const text of [
      "배경", "자막 문구는 표시하지 않고 위치·크기·색상·배경 설정을 시간순으로 비교합니다.",
      "자막 문구를 제외한 설정만 한눈에 비교합니다. 위치·크기·색상·배경이 주변 자막과 다른지 검수해 보세요.",
      "위치·크기·글자색·배경의 공통 설정과 개별 설정을 비교합니다.",
      "배경이 가장 많이 쓰인 값과 다릅니다. 오류로 확정된 것은 아닙니다.",
      "프로젝트 공통 외곽선 없음 · 행별 배경 설정만 비교",
      "프로젝트 공통 외곽선 #111111 · 0.6% · 행별 배경과는 별도"
    ]) {
      const translated = translateUiCopy(text, language, {
        ...EDITOR_STATIC_UI_COPY, ...EDITOR_RUNTIME_UI_COPY
      }, EDITOR_RUNTIME_UI_COPY_PATTERNS);
      assert.doesNotMatch(translated, /[가-힣]|black.box|黒いボックス/iu, `${language}: ${text}`);
    }
  }
});

for (const font of ADDITIONAL_CAPTION_FONTS) {
  test(`${font.family} ships its exact upstream bytes and full OFL notice`, async () => {
    for (const [source, distributed, expected] of [
      [font.sourceFontPath, font.webFontPath, font.fontSha256],
      [font.sourceLicensePath, font.webLicensePath, font.licenseSha256]
    ] as const) {
      const original = await readFile(new URL(`../${source}`, import.meta.url));
      const bundled = await readFile(new URL(`../web/${distributed}`, import.meta.url));
      assert.equal(createHash("sha256").update(original).digest("hex"), expected);
      assert.deepEqual(bundled, original);
      assert.ok(WEB_PACKAGE_FILES.includes(distributed));
    }
  });
}
