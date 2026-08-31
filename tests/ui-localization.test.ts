import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  mergeUiCopyCatalogs,
  resolveUiLanguage,
  translateUiCopy,
  uiLanguageFrom
} from "../src/lib/ui-localization.js";
import { EDITOR_STATIC_UI_COPY } from "../src/editor/ui-copy-static.js";
import {
  EDITOR_RUNTIME_UI_COPY,
  EDITOR_RUNTIME_UI_COPY_PATTERNS
} from "../src/editor/ui-copy-runtime.js";
import {
  CUT_UI_COPY_CATALOG,
  CUT_UI_COPY_PATTERNS
} from "../src/web/ui-copy.js";

test("UI 언어는 명시적 선택을 따르고 선택 전에는 기존 한국어 UI를 유지한다", () => {
  assert.equal(uiLanguageFrom("ko-KR"), "ko");
  assert.equal(uiLanguageFrom("en_US"), "en");
  assert.equal(uiLanguageFrom("ja-JP"), "ja");
  assert.equal(uiLanguageFrom("jp"), "ja");
  assert.equal(uiLanguageFrom("fr-FR"), null);

  assert.equal(resolveUiLanguage("ja"), "ja");
  assert.equal(resolveUiLanguage("en-US"), "en");
  assert.equal(resolveUiLanguage("invalid"), "ko");
  assert.equal(resolveUiLanguage(null), "ko");
});

test("UI 문구는 바깥 공백과 동적 값을 보존하고 사용자 문구는 건드리지 않는다", () => {
  const catalog = {
    "영상 내보내기": {
      en: "Export",
      ja: "書き出し"
    }
  } as const;
  const patterns = [{
    source: /^선택한 구간 (\d+)개$/u,
    en: "$1 selected clips",
    ja: "選択クリップ $1件"
  }] as const;

  assert.equal(
    translateUiCopy("  영상 내보내기\n", "en", catalog),
    "  Export\n"
  );
  assert.equal(
    translateUiCopy("선택한 구간 3개", "ja", catalog, patterns),
    "選択クリップ 3件"
  );
  assert.equal(
    translateUiCopy("사용자가 쓴 자막", "en", catalog, patterns),
    "사용자가 쓴 자막"
  );
  assert.equal(
    translateUiCopy("영상 내보내기", "ko", catalog),
    "영상 내보내기"
  );
});

test("여러 화면 카탈로그의 충돌을 fail-closed로 거부한다", () => {
  assert.deepEqual(
    mergeUiCopyCatalogs(
      { 저장: { en: "Save", ja: "保存" } },
      { 내보내기: { en: "Export", ja: "書き出し" } }
    ),
    {
      저장: { en: "Save", ja: "保存" },
      내보내기: { en: "Export", ja: "書き出し" }
    }
  );
  assert.throws(
    () => mergeUiCopyCatalogs(
      { 저장: { en: "Save", ja: "保存" } },
      { 저장: { en: "Store", ja: "格納" } }
    ),
    /Conflicting UI copy translation/u
  );
});

test("편집기 동적 오류와 상태는 내부 원인까지 한 언어로 표시한다", () => {
  const catalog = mergeUiCopyCatalogs(
    EDITOR_STATIC_UI_COPY,
    EDITOR_RUNTIME_UI_COPY
  );
  for (const language of ["en", "ja"] as const) {
    const reason = translateUiCopy(
      "쇼츠 작업은 최대 8개까지 만들 수 있습니다.",
      language,
      catalog,
      EDITOR_RUNTIME_UI_COPY_PATTERNS
    );
    const wrapped = translateUiCopy(
      `새 쇼츠 작업 생성 실패: ${reason}`,
      language,
      catalog,
      EDITOR_RUNTIME_UI_COPY_PATTERNS
    );
    assert.doesNotMatch(wrapped, /[가-힣]/u);
    assert.doesNotMatch(
      translateUiCopy(
        "1번 레인 자막: 빈 자막",
        language,
        catalog,
        EDITOR_RUNTIME_UI_COPY_PATTERNS
      ),
      /[가-힣]/u
    );
    assert.doesNotMatch(
      translateUiCopy(
        "1 · 사용자 선택",
        language,
        catalog,
        EDITOR_RUNTIME_UI_COPY_PATTERNS
      ),
      /[가-힣]/u
    );
  }
});

test("일본어 편집 UI는 clip과 track 용어를 일관되게 사용한다", () => {
  const japaneseCopy = [
    ...Object.values(EDITOR_RUNTIME_UI_COPY).map((copy) => copy.ja),
    ...EDITOR_RUNTIME_UI_COPY_PATTERNS.map((pattern) => pattern.ja)
  ].join("\n");
  assert.doesNotMatch(japaneseCopy, /(?<!ショート)カット/u);
  assert.doesNotMatch(japaneseCopy, /レーン/u);
});

test("컷 화면과 편집기는 상표 바로 아래에 같은 KR EN JP 버튼을 둔다", async () => {
  const [cutHtml, editorHtml] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../web/editor.html", import.meta.url), "utf8")
  ]);

  for (const html of [cutHtml, editorHtml]) {
    assert.equal(
      (html.match(/data-kirinuki-ui-language-switcher/gu) || []).length,
      1
    );
    assert.equal(
      (html.match(/data-kirinuki-ui-language="ko"/gu) || []).length,
      1
    );
    assert.equal(
      (html.match(/data-kirinuki-ui-language="en"/gu) || []).length,
      1
    );
    assert.equal(
      (html.match(/data-kirinuki-ui-language="ja"/gu) || []).length,
      1
    );
    assert.match(html, />KR<\/button>/u);
    assert.match(html, />EN<\/button>/u);
    assert.match(html, />JP<\/button>/u);
  }

  assert.match(cutHtml, /class="brand-meta"[\s\S]*Kirinuki[\s\S]*data-kirinuki-ui-language-switcher/u);
  assert.doesNotMatch(
    editorHtml,
    /id="editor-brand-slot"[^>]*role="img"/u
  );
  assert.match(
    editorHtml,
    /class="editor-brand-mark" role="img"[\s\S]*data-kirinuki-ui-language-switcher/u
  );
});

test("편집기 HTML의 한국어 정적 UI 문구는 영어와 일본어가 모두 있다", async () => {
  const editorHtml = await readFile(
    new URL("../web/editor.html", import.meta.url),
    "utf8"
  );
  const candidates = new Set<string>();
  for (const match of editorHtml.matchAll(/>([^<>]*[가-힣][^<>]*)</gu)) {
    candidates.add(String(match[1]).trim().replace(/\s+/gu, " "));
  }
  for (const match of editorHtml.matchAll(
    /(?:aria-label|aria-description|aria-roledescription|aria-valuetext|alt|data-label|title|placeholder)="([^"]*[가-힣][^"]*)"/gu
  )) {
    candidates.add(String(match[1]).trim().replace(/\s+/gu, " "));
  }
  candidates.delete("");

  for (const source of candidates) {
    assert.notEqual(
      translateUiCopy(source, "en", EDITOR_STATIC_UI_COPY),
      source,
      `English editor copy is missing: ${source}`
    );
    assert.notEqual(
      translateUiCopy(source, "ja", EDITOR_STATIC_UI_COPY),
      source,
      `Japanese editor copy is missing: ${source}`
    );
  }
});

test("컷 화면 HTML의 한국어 정적 UI 문구는 영어와 일본어가 모두 있다", async () => {
  const cutHtml = await readFile(
    new URL("../web/index.html", import.meta.url),
    "utf8"
  );
  const candidates = new Set<string>();
  for (const match of cutHtml.matchAll(/>([^<>]*[가-힣][^<>]*)</gu)) {
    candidates.add(String(match[1]).trim().replace(/\s+/gu, " "));
  }
  for (const match of cutHtml.matchAll(
    /(?:aria-label|aria-description|aria-roledescription|aria-valuetext|alt|data-label|title|placeholder)="([^"]*[가-힣][^"]*)"/gu
  )) {
    candidates.add(String(match[1]).trim().replace(/\s+/gu, " "));
  }
  candidates.delete("");

  for (const source of candidates) {
    assert.notEqual(
      translateUiCopy(
        source,
        "en",
        CUT_UI_COPY_CATALOG,
        CUT_UI_COPY_PATTERNS
      ),
      source,
      `English cut-page copy is missing: ${source}`
    );
    assert.notEqual(
      translateUiCopy(
        source,
        "ja",
        CUT_UI_COPY_CATALOG,
        CUT_UI_COPY_PATTERNS
      ),
      source,
      `Japanese cut-page copy is missing: ${source}`
    );
  }
});
