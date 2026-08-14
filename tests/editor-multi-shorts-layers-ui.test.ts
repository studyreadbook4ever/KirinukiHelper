import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

async function source(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}

test("web은 명시적 쇼츠 작업 선택·이름·생성·복제·안전 삭제 UI를 제공한다", async () => {
  const web = await source("web/editor.html");
  for (const html of [web]) {
    assert.match(
      html,
      /id="short-workspace-projects"[\s\S]*id="short-workspace-select"[\s\S]*id="short-workspace-name"[\s\S]*id="create-short-workspace"[\s\S]*id="duplicate-short-workspace"[\s\S]*id="delete-short-workspace"/u
    );
    assert.match(html, /각 작업의 자막·영상·실행 취소·내보내기는 서로 섞이지 않습니다/u);
  }
});

test("본편 재생 순서와 쇼츠 화면 겹침 순서를 각 행의 4방향 버튼으로 노출한다", async () => {
  const [web, main] = await Promise.all([
    source("web/editor.html"),
    source("src/editor/main.ts")
  ]);
  for (const html of [web]) {
    assert.match(html, /본편 컷 재생 순서/u);
    assert.match(html, /data-action="first"[\s\S]*data-action="up"[\s\S]*data-action="down"[\s\S]*data-action="last"/u);
    assert.match(html, /위쪽 영상일수록[^<]*(?:앞에|화면 앞에) 보/u);
  }
  assert.doesNotMatch(web, /move-short-video-layer-front|move-short-video-layer-forward|move-short-video-layer-backward|move-short-video-layer-back/u);
  assert.match(main, /dataset\.shortLayerOrder = action/u);
  assert.match(main, /"front" \| "forward" \| "backward" \| "back"/u);
  assert.match(main, /reorderClip\(project, clip\.id, targetIndex\)/u);
  assert.match(main, /`\$\{index \+ 1\}번 컷 \$\{clipTitle\}, \$\{actionLabel\}`/u);
  assert.match(main, /control\.setAttribute\("aria-label", label\)[\s\S]*control\.title = label/u);
});

test("workspace 전환은 active mirror 저장, 독립 history, cache 취소 후 ID를 URL에 고정한다", async () => {
  const main = await source("src/editor/main.ts");
  assert.match(main, /saveActiveShortFormWorkspace\([\s\S]*shortFormWorkspaces/u);
  assert.match(main, /shortWorkspaceHistory\.set\(currentShortWorkspaceId\(\)/u);
  assert.match(main, /cancelAndWaitForShortPreviewCacheOperation\(\)/u);
  assert.match(main, /url\.searchParams\.set\("short", collection\.activeWorkspaceId\)/u);
  assert.match(main, /마지막 쇼츠 작업은 삭제할 수 없습니다/u);
  assert.match(main, /window\.confirm\([\s\S]*복구할 수 없습니다/u);
});
