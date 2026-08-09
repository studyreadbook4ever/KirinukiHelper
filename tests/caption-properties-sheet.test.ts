import assert from "node:assert/strict";
import test from "node:test";

import {
  createCaptionPropertiesSheet,
  type CaptionPropertiesSheetClipInput,
  type CaptionPropertiesSheetCueInput,
  type CaptionPropertiesSheetDefaultsInput
} from "../src/lib/caption-properties-sheet.js";

const DEFAULTS: CaptionPropertiesSheetDefaultsInput = {
  fontScale: 0.0675,
  backgroundColor: "#000000",
  backgroundRadiusEm: 0,
  outlineColor: "#111111",
  outlineWidth: 0.006
};

const CLIPS: CaptionPropertiesSheetClipInput[] = [
  { id: "clip-a", enabled: true, timelineStartMs: 0 },
  { id: "clip-b", enabled: false, timelineStartMs: 4_000 },
  { id: "clip-c", enabled: true, timelineStartMs: 4_000 }
];

interface SecretCue extends CaptionPropertiesSheetCueInput {
  text: string;
}

function cue({
  id,
  clipId = "clip-a",
  startOffsetMs = 0,
  endOffsetMs = startOffsetMs + 1_000,
  lane = 0,
  x = 0.5,
  y = 0.84,
  color = "#ffffff",
  fontScale,
  backgroundEnabled,
  text = ""
}: {
  id: string;
  clipId?: string;
  startOffsetMs?: number;
  endOffsetMs?: number;
  lane?: number;
  x?: number;
  y?: number;
  color?: string;
  fontScale?: number;
  backgroundEnabled?: boolean;
  text?: string;
}): SecretCue {
  return {
    id,
    clipId,
    startOffsetMs,
    endOffsetMs,
    lane,
    x,
    y,
    color,
    ...(fontScale === undefined ? {} : { fontScale }),
    ...(backgroundEnabled === undefined ? {} : { backgroundEnabled }),
    text
  };
}

test("orders every known-clip cue deterministically and retains disabled clips", () => {
  const sheet = createCaptionPropertiesSheet({
    clips: CLIPS,
    defaults: DEFAULTS,
    cues: [
      cue({ id: "c-late", clipId: "clip-c", startOffsetMs: 200 }),
      cue({ id: "a-z", startOffsetMs: 100, endOffsetMs: 900, lane: 1 }),
      cue({ id: "orphan", clipId: "missing", startOffsetMs: 0 }),
      cue({ id: "b-disabled", clipId: "clip-b", startOffsetMs: 50 }),
      cue({ id: "a-b", startOffsetMs: 100, endOffsetMs: 800, lane: 0 }),
      cue({ id: "a-a", startOffsetMs: 100, endOffsetMs: 800, lane: 0 }),
      cue({ id: "a-first", startOffsetMs: 20 })
    ]
  });

  assert.deepEqual(
    sheet.rows.map((row) => row.cueId),
    ["a-first", "a-a", "a-b", "a-z", "b-disabled", "c-late"]
  );
  assert.deepEqual(sheet.rows.map((row) => row.ordinal), [1, 2, 3, 4, 5, 6]);
  const disabled = sheet.rows.find((row) => row.cueId === "b-disabled");
  assert.ok(disabled);
  assert.equal(disabled.clipNumber, 2);
  assert.equal(disabled.outputEnabled, false);
  assert.equal(disabled.timelineStartMs, null);
  assert.equal(disabled.startOffsetMs, 50);
  assert.equal(disabled.endOffsetMs, 1_050);
  assert.equal(sheet.rows.find((row) => row.cueId === "c-late")?.timelineStartMs, 4_200);
  assert.equal(sheet.summary.captionCount, 6);
  assert.equal(sheet.summary.outputCaptionCount, 5);
  assert.equal(sheet.summary.excludedCaptionCount, 1);
  assert.equal(sheet.summary.unknownClipCaptionCount, 1);
});

test("resolves inherited size and background while preserving their sources", () => {
  const sheet = createCaptionPropertiesSheet({
    clips: CLIPS.slice(0, 1),
    defaults: DEFAULTS,
    cues: [
      cue({
        id: "inherited",
        x: 0.504,
        y: 0.8436,
        color: "#ABC"
      }),
      cue({
        id: "overridden",
        startOffsetMs: 1_000,
        fontScale: 0.05,
        backgroundEnabled: false,
        color: "#A1B2C3"
      })
    ]
  });
  const inherited = sheet.rows[0];
  const overridden = sheet.rows[1];
  assert.ok(inherited);
  assert.ok(overridden);

  assert.equal(inherited.xPercent, 50.4);
  assert.equal(inherited.yPercent, 84.4);
  assert.equal(inherited.fontScalePercent, 6.75);
  assert.equal(inherited.fontScaleSource, "project");
  assert.equal(inherited.color, "#aabbcc");
  assert.equal(inherited.backgroundEnabled, true);
  assert.equal(inherited.backgroundColor, "#000000");
  assert.equal(inherited.backgroundSource, "project");

  assert.equal(overridden.fontScalePercent, 5);
  assert.equal(overridden.fontScaleSource, "cue");
  assert.equal(overridden.color, "#a1b2c3");
  assert.equal(overridden.backgroundEnabled, false);
  assert.equal(overridden.backgroundColor, "transparent");
  assert.equal(overridden.backgroundSource, "cue");
  assert.deepEqual(sheet.summary.commonOutline, {
    enabled: true,
    color: "#111111",
    width: 0.006,
    widthPercent: 0.6
  });
});

test("groups displayed effective styles by frequency and marks unique-mode variations", () => {
  const sheet = createCaptionPropertiesSheet({
    clips: CLIPS.slice(0, 1),
    defaults: DEFAULTS,
    cues: [
      cue({ id: "primary-1" }),
      cue({
        id: "primary-2",
        startOffsetMs: 1_000,
        x: 0.5004,
        y: 0.8404,
        fontScale: 0.0675,
        backgroundEnabled: true
      }),
      cue({ id: "primary-3", startOffsetMs: 1_500 }),
      cue({ id: "secondary-1", startOffsetMs: 2_000, color: "#ff0000" }),
      cue({ id: "secondary-2", startOffsetMs: 3_000, color: "#ff0000" }),
      cue({
        id: "singleton",
        startOffsetMs: 4_000,
        x: 0.62,
        y: 0.2,
        fontScale: 0.05,
        color: "#00ff00",
        backgroundEnabled: false
      })
    ]
  });
  const primary = sheet.rows.find((row) => row.cueId === "primary-1");
  const inheritedEquivalent = sheet.rows.find((row) => row.cueId === "primary-2");
  const secondary = sheet.rows.find((row) => row.cueId === "secondary-1");
  const singleton = sheet.rows.find((row) => row.cueId === "singleton");
  assert.ok(primary);
  assert.ok(inheritedEquivalent);
  assert.ok(secondary);
  assert.ok(singleton);

  assert.equal(primary.styleGroupLabel, "A");
  assert.equal(primary.styleGroupCount, 3);
  assert.equal(inheritedEquivalent.styleGroupLabel, "A");
  assert.equal(inheritedEquivalent.fontScaleSource, "cue");
  assert.equal(inheritedEquivalent.backgroundSource, "cue");
  assert.equal(secondary.styleGroupLabel, "B");
  assert.equal(secondary.styleGroupCount, 2);
  assert.equal(singleton.styleGroupLabel, "C");
  assert.equal(singleton.styleGroupCount, 1);
  assert.equal(singleton.styleGroupSingleton, true);
  assert.deepEqual(singleton.variations, {
    position: true,
    fontScale: true,
    color: true,
    background: true,
    any: true
  });
  assert.equal(secondary.variations.color, true);
  assert.equal(secondary.variations.any, true);
  assert.equal(primary.variations.any, false);
  assert.equal(sheet.summary.styleGroupCount, 3);
  assert.equal(sheet.summary.singletonStyleGroupCount, 1);
  assert.equal(sheet.summary.variationCaptionCount, 3);
  assert.deepEqual(sheet.summary.variationCounts, {
    position: 1,
    fontScale: 1,
    color: 3,
    background: 1,
    any: 3
  });
});

test("ties have no modal winner and therefore create no false variation flags", () => {
  const sheet = createCaptionPropertiesSheet({
    clips: CLIPS.slice(0, 1),
    defaults: {
      ...DEFAULTS,
      backgroundColor: "transparent"
    },
    cues: [
      cue({ id: "first-a", x: 0.4, color: "#ffffff" }),
      cue({ id: "second-a", startOffsetMs: 1_000, x: 0.4, color: "#ffffff" }),
      cue({ id: "first-b", startOffsetMs: 2_000, x: 0.6, color: "#ff0000" }),
      cue({ id: "second-b", startOffsetMs: 3_000, x: 0.6, color: "#ff0000" })
    ]
  });

  assert.deepEqual(sheet.rows.map((row) => row.styleGroupLabel), ["A", "A", "B", "B"]);
  assert.equal(sheet.rows.every((row) => !row.variations.position), true);
  assert.equal(sheet.rows.every((row) => !row.variations.color), true);
  assert.equal(sheet.rows.every((row) => !row.variations.any), true);
  assert.equal(sheet.summary.variationCaptionCount, 0);
});

test("excluded captions never become the baseline for output-caption review", () => {
  const sheet = createCaptionPropertiesSheet({
    clips: CLIPS.slice(0, 2),
    defaults: {
      ...DEFAULTS,
      backgroundColor: "transparent"
    },
    cues: [
      cue({ id: "output", color: "#ffffff" }),
      cue({ id: "excluded-1", clipId: "clip-b", color: "#ff0000" }),
      cue({ id: "excluded-2", clipId: "clip-b", startOffsetMs: 1_000, color: "#ff0000" }),
      cue({ id: "excluded-3", clipId: "clip-b", startOffsetMs: 2_000, color: "#ff0000" })
    ]
  });
  const output = sheet.rows.find((row) => row.cueId === "output");
  const excluded = sheet.rows.filter((row) => !row.outputEnabled);
  assert.ok(output);

  assert.equal(output.styleGroupLabel, "A");
  assert.equal(output.variations.any, false);
  assert.equal(excluded.every((row) => row.styleGroupLabel === "B"), true);
  assert.equal(excluded.every((row) => row.variations.any === false), true);
  assert.equal(sheet.summary.variationCaptionCount, 0);
});

test("visually disabled backgrounds share one canonical transparent style", () => {
  const sheet = createCaptionPropertiesSheet({
    clips: CLIPS.slice(0, 1),
    defaults: {
      ...DEFAULTS,
      backgroundColor: "rgba(0, 0, 0, 0)"
    },
    cues: [
      cue({ id: "inherited-off" }),
      cue({
        id: "explicit-off",
        startOffsetMs: 1_000,
        backgroundEnabled: false
      })
    ]
  });

  assert.deepEqual(
    sheet.rows.map((row) => row.backgroundColor),
    ["transparent", "transparent"]
  );
  assert.deepEqual(sheet.rows.map((row) => row.styleGroupLabel), ["A", "A"]);
  assert.equal(sheet.rows.every((row) => !row.variations.background), true);
  assert.equal(sheet.summary.styleGroupCount, 1);
});

test("returns a complete empty summary without inventing style groups", () => {
  const sheet = createCaptionPropertiesSheet({
    clips: [],
    cues: [],
    defaults: {
      ...DEFAULTS,
      outlineColor: "#ABC",
      outlineWidth: 0
    }
  });

  assert.deepEqual(sheet.rows, []);
  assert.equal(sheet.summary.captionCount, 0);
  assert.equal(sheet.summary.outputCaptionCount, 0);
  assert.equal(sheet.summary.excludedCaptionCount, 0);
  assert.equal(sheet.summary.unknownClipCaptionCount, 0);
  assert.equal(sheet.summary.styleGroupCount, 0);
  assert.equal(sheet.summary.singletonStyleGroupCount, 0);
  assert.equal(sheet.summary.variationCaptionCount, 0);
  assert.deepEqual(sheet.summary.variationCounts, {
    position: 0,
    fontScale: 0,
    color: 0,
    background: 0,
    any: 0
  });
  assert.deepEqual(sheet.summary.commonOutline, {
    enabled: false,
    color: "#aabbcc",
    width: 0,
    widthPercent: 0
  });
});

test("never serializes caption text even when richer structural inputs contain it", () => {
  const secret = "TOP-SECRET-CAPTION-CONTENT-260810";
  const sheet = createCaptionPropertiesSheet({
    clips: CLIPS.slice(0, 1),
    defaults: DEFAULTS,
    cues: [cue({ id: "secret-cue", text: secret })]
  });
  const row = sheet.rows[0];
  assert.ok(row);

  assert.equal("text" in row, false);
  assert.equal(JSON.stringify(sheet).includes(secret), false);
  assert.equal(JSON.stringify(sheet).includes("text"), false);
});
