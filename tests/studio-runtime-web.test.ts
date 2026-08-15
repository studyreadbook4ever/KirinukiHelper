import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  acquireStudioProjectWriter,
  createFreshEditorProjectId,
  leaveCompletedStudioEditor,
  runWithExclusiveStudioProjectAccess,
  runWithExclusiveStudioProjectCollectionAccess
} from "../src/editor/studio-runtime-web.js";

test("새 localhost 편집 ID는 VOD identity와 무관한 UUID다", () => {
  const first = createFreshEditorProjectId();
  const second = createFreshEditorProjectId();
  assert.match(
    first,
    /^project-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
  );
  assert.notEqual(first, second);
});

test("web runtime import는 Node 검증 프로세스에 BroadcastChannel을 남기지 않는다", () => {
  const runtimeUrl = new URL(
    "../src/editor/studio-runtime-web.ts",
    import.meta.url
  );
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(runtimeUrl.href)});`
    ],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      timeout: 5_000
    }
  );
  assert.equal(
    result.error,
    undefined,
    `web runtime import가 종료되지 않았습니다: ${String(result.error)}`
  );
  assert.equal(
    result.status,
    0,
    `web runtime import 실패:\n${result.stderr}`
  );
  assert.equal(result.signal, null);
});

test("완료된 localhost 편집기는 닫기 제한에 기대지 않고 시작 화면으로 교체 이동한다", async () => {
  const source = await readFile(
    new URL("../src/editor/studio-runtime-web.ts", import.meta.url),
    "utf8"
  );
  const start = source.indexOf("export function leaveCompletedStudioEditor()");
  const end = source.indexOf("export async function studioEditorReady", start);
  assert.ok(start >= 0 && end > start);
  const completedExit = source.slice(start, end);
  assert.match(
    completedExit,
    /location\.replace\(new URL\("\/", location\.origin\)\.href\)/u
  );
  assert.doesNotMatch(completedExit, /window\.close/u);

  const originalLocation = Object.getOwnPropertyDescriptor(
    globalThis,
    "location"
  );
  let replacedWith = "";
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: {
      origin: "http://127.0.0.1:4320",
      replace(url: string) {
        replacedWith = url;
      }
    }
  });
  try {
    leaveCompletedStudioEditor();
  } finally {
    if (originalLocation) {
      Object.defineProperty(globalThis, "location", originalLocation);
    } else {
      delete (globalThis as { location?: unknown }).location;
    }
  }
  assert.equal(replacedWith, "http://127.0.0.1:4320/");
});

test("localhost 세션 완료는 삭제된 프로젝트의 최근 편집 포인터도 함께 지운다", async () => {
  const source = await readFile(
    new URL("../src/editor/studio-runtime-web.ts", import.meta.url),
    "utf8"
  );
  const start = source.indexOf("export async function completeStudioEditorSession");
  const end = source.indexOf("export function leaveCompletedStudioEditor", start);
  assert.ok(start >= 0 && end > start);
  const completion = source.slice(start, end);
  assert.match(
    completion,
    /localStorage\.getItem\(WEB_STUDIO_LATEST_PROJECT_KEY\) === projectId[\s\S]*localStorage\.removeItem\(WEB_STUDIO_LATEST_PROJECT_KEY\)/u
  );
});

test("새 localhost 편집 세션은 최근 저장 프로젝트 포인터를 선점하지 않는다", async () => {
  const source = await readFile(
    new URL("../src/editor/studio-runtime-web.ts", import.meta.url),
    "utf8"
  );
  const start = source.indexOf("export async function beginWebEditorSession");
  const end = source.indexOf("function activeSessionSummary", start);
  assert.ok(start >= 0 && end > start);
  const begin = source.slice(start, end);
  assert.doesNotMatch(begin, /WEB_STUDIO_LATEST_PROJECT_KEY/u);
  assert.doesNotMatch(begin, /localStorage\.setItem/u);
  assert.match(begin, /runWithSharedStudioProjectCollectionAccess/u);
  assert.match(begin, /sessionStorage\.setItem\(storageKey/u);
  assert.match(begin, /localStorage\.removeItem\(storageKey\)/u);
});

test("사용자에게 보이는 작업 전환 오류는 localhost와 세션 세대를 노출하지 않는다", async () => {
  const source = await readFile(
    new URL("../src/editor/studio-runtime-web.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /error:\s*"[^"]*(?:localhost|세션 세대)/u);
  assert.match(source, /다른 편집 작업으로 전환되어/u);
});

test("편집·단건 정리는 collection shared 뒤 project lock을 잡고 전체 삭제만 exclusive로 막는다", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator"
  );
  const requests: Array<{
    name: string;
    mode: string;
    ifAvailable: boolean;
  }> = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      locks: {
        async request(
          name: string,
          options: { mode?: string; ifAvailable?: boolean },
          callback: (lock: { name: string } | null) => unknown
        ) {
          requests.push({
            name,
            mode: String(options.mode || "exclusive"),
            ifAvailable: options.ifAvailable === true
          });
          return callback({ name });
        }
      }
    }
  });
  try {
    const scoped = await runWithExclusiveStudioProjectAccess(
      "project-scoped",
      async () => "scoped"
    );
    assert.deepEqual(scoped, { acquired: true, value: "scoped" });
    const collection = await runWithExclusiveStudioProjectCollectionAccess(
      async () => "collection"
    );
    assert.deepEqual(collection, { acquired: true, value: "collection" });
    assert.equal(await acquireStudioProjectWriter("project-live"), true);
  } finally {
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    } else {
      delete (globalThis as { navigator?: unknown }).navigator;
    }
  }

  assert.deepEqual(requests, [
    {
      name: "kirinuki:local-web:project-collection",
      mode: "shared",
      ifAvailable: true
    },
    {
      name: "kirinuki:local-web:project-writer:project-scoped",
      mode: "exclusive",
      ifAvailable: true
    },
    {
      name: "kirinuki:local-web:project-collection",
      mode: "exclusive",
      ifAvailable: true
    },
    {
      name: "kirinuki:local-web:project-collection",
      mode: "shared",
      ifAvailable: true
    },
    {
      name: "kirinuki:local-web:project-writer:project-live",
      mode: "exclusive",
      ifAvailable: true
    }
  ]);
});
