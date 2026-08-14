import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const editorCss = await readFile(
  new URL("../web/editor/editor.css", import.meta.url),
  "utf8"
);

function ruleBody(match: RegExpMatchArray | null, label: string): string {
  assert.ok(match, `${label} CSS 규칙이 필요합니다.`);
  const body = match[1];
  assert.ok(body, `${label} CSS 규칙 본문이 비어 있습니다.`);
  return body;
}

test("짧은 자막·에셋 블록도 양쪽 손잡이 사이에 몸체 drag 영역을 남긴다", () => {
  const adaptiveHandleRule = editorCss.match(
    /\.asset-block \.trim-handle,\s*\.cue-block \.trim-handle\s*\{([^}]*)\}/u
  );
  const adaptiveHandleBody = ruleBody(
    adaptiveHandleRule,
    "자막·에셋 전용 손잡이"
  );
  const percentage = Number(
    adaptiveHandleBody.match(/width:\s*min\(\s*14px,\s*(\d+)%\s*\)/u)?.[1]
  );
  assert.ok(
    Number.isFinite(percentage) && percentage > 0 && percentage < 50,
    "양쪽 손잡이가 짧은 블록 몸체 전체를 덮지 않아야 합니다."
  );
  assert.match(
    editorCss,
    /\.asset-block \.trim-handle\.left,\s*\.cue-block \.trim-handle\.left\s*\{[^}]*left:\s*0;/u
  );
  assert.match(
    editorCss,
    /\.asset-block \.trim-handle\.right,\s*\.cue-block \.trim-handle\.right\s*\{[^}]*right:\s*0;/u
  );
});

test("재생 playhead의 포인터 hitbox는 ruler에만 있고 세로선은 클릭을 가로채지 않는다", () => {
  const playheadRule = editorCss.match(/\.playhead\s*\{([^}]*)\}/u);
  const playheadBody = ruleBody(playheadRule, "playhead 본체");
  assert.match(
    playheadBody,
    /height:\s*var\(--ruler-height\)\s*;/u,
    "움직이는 playhead 버튼의 hitbox는 ruler 높이에만 머물러야 합니다."
  );
  assert.doesNotMatch(
    playheadBody,
    /height:\s*calc\(\s*100%/u,
    "playhead 버튼이 자막·에셋·음성 트랙 전체를 덮으면 안 됩니다."
  );

  const verticalLineRule = editorCss.match(/\.playhead span\s*\{([^}]*)\}/u);
  const verticalLineBody = ruleBody(verticalLineRule, "playhead 세로선");
  assert.match(
    verticalLineBody,
    /pointer-events:\s*none\s*;/u,
    "시각적 playhead 세로선은 아래 타임라인 항목의 포인터 입력을 가로채면 안 됩니다."
  );
});
