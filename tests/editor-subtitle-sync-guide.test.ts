import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const skillScripts = new URL(
  "../skills/align-song-subtitles-60fps/scripts/",
  import.meta.url
);

function runPython(script: string, arguments_: string[], input = "") {
  return spawnSync(
    "python3",
    [fileURLToPath(new URL(script, skillScripts)), ...arguments_],
    { encoding: "utf8", input }
  );
}

function quantizeSecondsToTick(seconds: string): number {
  const result = runPython("quantize_60fps.py", ["--seconds", seconds]);
  assert.equal(result.status, 0, result.stderr);
  return Number(JSON.parse(result.stdout).tick);
}

function validateSubtitleEdit(document: unknown): string[] {
  const result = runPython(
    "validate_subtitle_edit.py",
    ["-"],
    JSON.stringify(document)
  );
  if (result.status === 0) return [];
  return result.stderr
    .split("\n")
    .map((line) => line.replace(/^- /u, "").trim())
    .filter(Boolean);
}

async function sources() {
  const paths = {
    skill: "skills/align-song-subtitles-60fps/SKILL.md",
    schema: "skills/align-song-subtitles-60fps/references/subtitle-edit.schema.json",
    webHtml: "web/editor.html",
    webCss: "web/editor/editor.css",
    editor: "src/editor/main.ts",
    webBuild: "scripts/web-javascript-build.ts"
  } as const;
  return Object.fromEntries(await Promise.all(Object.entries(paths).map(
    async ([key, path]) => [key, await readFile(new URL(path, root), "utf8")]
  ))) as Record<keyof typeof paths, string>;
}

test("반자동 60 Hz 스킬은 사람의 완성 컷에 자막 완성편집만 삽입한다", async () => {
  const { skill, schema } = await sources();
  const frontmatter = /^---\n([\s\S]*?)\n---/u.exec(skill)?.[1] ?? "";
  const keys = [...frontmatter.matchAll(/^([a-z_]+):/gmu)].map((match) => match[1]);
  assert.deepEqual(keys, ["name", "description"]);
  assert.match(frontmatter, /^name: align-song-subtitles-60fps$/mu);
  assert.doesNotMatch(skill, /TODO|\[TODO/u);
  assert.match(skill, /already chosen every cut, edit point, crop, visual composition/u);
  assert.match(skill, /apply it as one coherent transaction for human review afterward/u);
  assert.match(skill, /edit_complete_with_inference/u);
  assert.match(skill, /reviewPriority: "high"/u);
  assert.match(skill, /Never apply a universal four-second cue limit/u);
  assert.match(skill, /Do not acquire media/u);
  assert.match(skill, /Optimize the complete subtitle sequence before insertion/u);
  assert.match(skill, /applyToEditorAllowed: true/u);
  assert.match(skill, /humanReviewState: "pending"/u);
  assert.match(skill, /Never export, publish/u);
  assert.match(skill, /Use an AI Agent only for small, explicit subtasks/u);
  assert.doesNotMatch(skill, /Hermes|Luna/u);
  assert.match(skill, /cue:<sourceLineId>:<occurrence>/u);
  assert.match(skill, /runnerUpMarginMilli: 1000/u);
  assert.match(skill, /stable uppercase `SNAKE_CASE`/u);
  assert.doesNotMatch(skill, /projectZeroInEvidenceUs|ten seconds of preroll/u);
  assert.match(schema, /"edit_complete_with_inference"/u);
  assert.match(schema, /"adjacent_geometry"/u);
  assert.match(schema, /"human_locked"/u);
  assert.match(schema, /"requiresHumanReview": \{ "const": true \}/u);
  assert.match(schema, /"applyToEditorAllowed": \{ "const": true \}/u);
  assert.match(schema, /"autoExportAllowed": \{ "const": false \}/u);
});

test("완성 자막 편집 validator는 삽입을 허용하되 사후 검수와 추정을 숨기지 못하게 한다", () => {
  assert.equal(quantizeSecondsToTick("12.345"), 741);
  assert.equal(quantizeSecondsToTick("0.008333333333333333"), 0);
  assert.equal(quantizeSecondsToTick("0.008333333333333334"), 1);

  const edit = {
    schemaVersion: "kirinuki/picture-locked-song-subtitle-edit-v1",
    status: "edit_complete_with_inference",
    mode: "subtitle_only_on_picture_lock",
    requiresHumanReview: true,
    humanReviewState: "pending",
    applyToEditorAllowed: true,
    autoExportAllowed: false,
    baseProject: {
      projectId: "project-1",
      revision: "revision-7",
      pictureLockSha256: "a".repeat(64),
      timelineAudioSha256: "b".repeat(64),
      lyricsCatalogSha256: "c".repeat(64),
      evidenceBundleSha256: "e".repeat(64),
      frameSetSha256: "f".repeat(64),
      durationTicks: 1800,
      tickRate: 60,
      endSemantics: "exclusive",
      allowNewCues: true,
      replaceableCueIds: [],
      humanLockedCueIds: [],
      layoutPolicy: {
        allowedStyleTokens: ["ja-sky-ko-yellow"],
        minFontScaleMilli: 700,
        safeArea: {
          minXMilli: 100,
          maxXMilli: 900,
          minYMilli: 100,
          maxYMilli: 900
        },
        maxAdjacentPositionDeltaMilli: 180,
        maxAdjacentFontScaleDeltaMilli: 200
      }
    },
    evidenceCatalog: [
      { id: "asr:line-1", family: "asr", dependencyGroup: "speech-model", audioSha256: "b".repeat(64), tick: 0, minTick: 0, maxTick: 1, confidenceMilli: 930 },
      { id: "vad:onset-1", family: "vad", dependencyGroup: "waveform-vad", audioSha256: "b".repeat(64), tick: 0, minTick: 0, maxTick: 1, confidenceMilli: 920 },
      { id: "anchor:next", family: "neighbor_anchor", dependencyGroup: "neighbor-cue", audioSha256: "b".repeat(64), tick: 120, minTick: 117, maxTick: 123, confidenceMilli: 520 }
    ],
    subtitleEdit: {
      pictureLockSha256: "a".repeat(64),
      lanesRequired: 1,
      untouchedDomains: ["clips", "clipOrder", "clipTiming", "canvas", "videoAssets", "imageAssets", "audioRegions", "cropTransforms", "projectDuration"],
      operations: [{
        op: "add",
        cueId: "cue-1",
        existingCueId: null,
        sourceLineId: "line-1",
        occurrence: 1,
        sourceTextSha256: "d".repeat(64),
        startTick: 0,
        endTickExclusive: 120,
        captions: { jaLines: ["好きだから"], koLines: ["좋아하니까"] },
        layout: {
          lane: 0,
          xMilli: 500,
          yMilli: 820,
          align: "center",
          styleToken: "ja-sky-ko-yellow",
          japanesePlacement: "above_korean",
          fontScaleMilli: 1000,
          basis: "frame_checked",
          checkedFrameTicks: [0, 60, 119]
        },
        timingBasis: "inferred",
        reviewPriority: "high",
        matchScoreMilli: 820,
        runnerUpMarginMilli: 210,
        startBoundary: {
          tick: 0,
          minTick: 0,
          maxTick: 1,
          basis: "measured",
          confidenceMilli: 930,
          signalRefs: ["asr:line-1", "vad:onset-1"],
          inferenceMethod: null
        },
        endBoundary: {
          tick: 120,
          minTick: 117,
          maxTick: 123,
          basis: "inferred",
          confidenceMilli: 520,
          signalRefs: ["anchor:next"],
          inferenceMethod: "anchored_constraint"
        },
        reasonCodes: ["FINAL_PHONEME_MASKED_BY_MUSIC"]
      }]
    },
    reviewQueue: [{
      cueId: "cue-1",
      priority: "high",
      reasonCodes: ["FINAL_PHONEME_MASKED_BY_MUSIC"]
    }],
    issues: [{
      code: "FINAL_PHONEME_MASKED_BY_MUSIC",
      severity: "review",
      cueIds: ["cue-1"],
      message: "끝 경계는 다음 신뢰 앵커로 제한해 확정함"
    }]
  };

  assert.deepEqual(validateSubtitleEdit(edit), []);
  assert.match(
    validateSubtitleEdit({ ...edit, status: "edit_complete" }).join("\n"),
    /edit_complete cannot contain inferred timing/u
  );
  const hiddenInference = structuredClone(edit);
  const [hiddenInferenceOperation] = hiddenInference.subtitleEdit.operations;
  assert.ok(hiddenInferenceOperation);
  hiddenInferenceOperation.reviewPriority = "normal";
  assert.match(
    validateSubtitleEdit(hiddenInference).join("\n"),
    /inferred timing or layout requires high reviewPriority/u
  );
  assert.match(
    validateSubtitleEdit({ ...edit, humanReviewState: "complete" }).join("\n"),
    /humanReviewState must remain pending/u
  );
  assert.match(
    validateSubtitleEdit({ ...edit, applyToEditorAllowed: false }).join("\n"),
    /applyToEditorAllowed must be true/u
  );
  assert.match(
    validateSubtitleEdit({ ...edit, unexpectedRootField: true }).join("\n"),
    /root contains unsupported field/u
  );
  const unrelatedEvidence = structuredClone(edit);
  const [unrelatedEvidenceItem] = unrelatedEvidence.evidenceCatalog;
  assert.ok(unrelatedEvidenceItem);
  unrelatedEvidenceItem.tick = 1500;
  unrelatedEvidenceItem.minTick = 1499;
  unrelatedEvidenceItem.maxTick = 1501;
  assert.match(
    validateSubtitleEdit(unrelatedEvidence).join("\n"),
    /evidence does not intersect this boundary/u
  );
  const unsafeLayout = structuredClone(edit);
  const [unsafeLayoutOperation] = unsafeLayout.subtitleEdit.operations;
  assert.ok(unsafeLayoutOperation);
  unsafeLayoutOperation.layout.yMilli = 950;
  assert.match(
    validateSubtitleEdit(unsafeLayout).join("\n"),
    /position is outside the locked safe area/u
  );
});

test("본편과 쇼츠는 같은 빈 160×600 광고 rail을 쓰고 기존 컷 기능은 popover에 남긴다", async () => {
  const { webHtml, webCss } = await sources();
  for (const html of [webHtml]) {
    assert.match(html, /<aside class="clip-sidebar panel">/u);
    assert.match(html, /<div id="desktop-ad-slot" class="desktop-ad-slot" aria-hidden="true"><\/div>/u);
    assert.match(html, /id="clip-manager-popover"[\s\S]*popover="auto"[\s\S]*id="source-offset"[\s\S]*id="clip-list"[\s\S]*id="focus-source"/u);
    assert.match(html, /popovertarget="clip-manager-popover"[\s\S]*>컷·원본 관리<\/button>/u);
    assert.doesNotMatch(
      html.match(/<div id="desktop-ad-slot"[\s\S]*?<\/div>/u)?.[0] ?? "",
      /<(?:script|iframe|img|a)\b|https?:\/\//u
    );
  }
  for (const css of [webCss]) {
    assert.match(css, /\.desktop-ad-slot \{[\s\S]*?width: 160px;[\s\S]*?height: 600px;/u);
    assert.match(css, /data-workspace="short-form"\] \.workspace \{[\s\S]*?grid-template-columns: 160px minmax\(0, 1fr\) 360px;/u);
    assert.match(css, /"clips canvas inspector"\s*"clips timeline timeline"/u);
    assert.doesNotMatch(css, /data-workspace="short-form"\] \.clip-sidebar \{\s*display: none;/u);
    assert.doesNotMatch(css, /\.clip-sidebar \{\s*display: none;/u);
    assert.match(css, /\.editor-shell \{[\s\S]*?min-height: 706px;/u);
  }
});

test("쇼츠 팁 dialog는 상단 사용법 뒤에 canonical SKILL.md를 안전하게 표시한다", async () => {
  const { webHtml, editor, webBuild } = await sources();
  for (const html of [webHtml]) {
    assert.match(html, /id="open-subtitle-sync-guide"[\s\S]*class="subtitle-sync-guide-button short-form-workspace-copy"[\s\S]*aria-haspopup="dialog"/u);
    assert.match(html, />에이전트로 자막 넣기<\/button>/u);
    assert.match(html, /노래 가사를 넣을 때, 가사 타이밍을 자동으로 맞춰주는 프롬프트입니다/u);
    assert.match(html, /아래 SKILL\.md를 AI Agent에 넣고/u);
    assert.doesNotMatch(html, /팁 보기|Hermes Agent 또는 자막 작업 에이전트/u);
    const usageIndex = html.indexOf('id="subtitle-sync-usage-title"');
    const skillIndex = html.indexOf('id="subtitle-sync-skill-content"');
    assert.ok(usageIndex >= 0 && usageIndex < skillIndex);
    assert.match(html, /추정 확정·검수 우선순위 높음/u);
    assert.match(html, /완성편집으로 한 번에 넣으면/u);
    assert.match(html, /현재 영상·자막을 외부 모델로 보내거나 사용 기록을 저장하지 않으며/u);
  }
  assert.match(editor, /subtitle_sync_skill_content\.textContent\s*=\s*SUBTITLE_SYNC_SKILL_MARKDOWN/u);
  assert.match(editor, /navigator\.clipboard\.writeText\(SUBTITLE_SYNC_SKILL_MARKDOWN\)/u);
  assert.match(editor, /elements\.subtitle_sync_guide_dialog\.open[\s\S]*closeSubtitleSyncGuide\(\)[\s\S]*return;/u);
  assert.doesNotMatch(
    editor.slice(editor.indexOf("function openSubtitleSyncGuide"), editor.indexOf("function shortWorkspaceVideoLayers")),
    /fetch\(|localStorage|sessionStorage|innerHTML/u
  );
  for (const build of [webBuild]) {
    assert.match(build, /skills\/align-song-subtitles-60fps\/SKILL\.md/u);
    assert.match(build, /__KIRINUKI_SUBTITLE_SYNC_SKILL_MARKDOWN__/u);
  }
});
