import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  WEB_JAVASCRIPT_PATHS
} from "./web-javascript-build.js";
import { WEB_PACKAGE_FILES } from "./web-package-files.js";
import {
  DEFAULT_STUDIO_PORT,
  STUDIO_LOOPBACK_HOST,
  resolveStudioStaticAsset,
  studioSecurityHeaders
} from "./local-studio-server-core.js";
import { KIRINUKI_LOCAL_STUDIO_ORIGIN } from "../src/lib/local-runtime-origin.js";

const root = fileURLToPath(new URL("..", import.meta.url));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}

const [
  indexHtml,
  editorHtml,
  studioCss,
  packageManifest,
  buildDesktopSource,
  browserSmokeSource
] = await Promise.all([
  read("web/index.html"),
  read("web/editor.html"),
  read("web/studio.css"),
  read("package.json").then((contents) => JSON.parse(contents) as {
    readonly name?: string;
    readonly version?: string;
    readonly scripts?: Readonly<Record<string, string>>;
  }),
  read("scripts/build-desktop.ts"),
  read("scripts/local-studio-browser-smoke.ts")
]);

assert(
  packageManifest.name === "kirinuki-app",
  "root package 이름이 localhost web studio를 가리키지 않습니다."
);
const packageScripts = packageManifest.scripts || {};
assert(
  packageScripts.build === "node --import tsx scripts/build-web.ts"
    && packageScripts.validate === "node --import tsx scripts/validate-local-studio.ts"
    && packageScripts.package === "node --import tsx scripts/release-package.ts"
    && packageScripts["dev:editor"] === "node --import tsx scripts/dev-web.ts"
    && buildDesktopSource.includes("streaming-electron-frame-action.ts")
    && !browserSmokeSource.includes("`--load-extension=")
    && !browserSmokeSource.includes("`--disable-extensions-except="),
  "web/desktop build와 ASAR 내부 player action 경계가 올바르지 않습니다."
);
for (const [name, command] of Object.entries(packageScripts)) {
  assert(
    !name.startsWith("legacy:extension:")
      && !/scripts\/(?:browser-smoke|dev-extension|build-extension-legacy|validate-extension|package-extension)\.ts|sidepanel/iu.test(command),
    `삭제된 외부 Extension 명령이 package scripts에 남았습니다: ${name}`
  );
}

assert(
  KIRINUKI_LOCAL_STUDIO_ORIGIN
    === `http://${STUDIO_LOOPBACK_HOST}:${DEFAULT_STUDIO_PORT}`,
  "localhost 서버·gateway·browser storage Origin이 하나로 고정되지 않았습니다."
);
const webAssetVersion = packageManifest.version;
assert(
  typeof webAssetVersion === "string"
    && /^\d+\.\d+\.\d+$/u.test(webAssetVersion)
    && indexHtml.includes(
      `<link rel="stylesheet" href="/studio.css?v=${webAssetVersion}">`
    )
    && indexHtml.includes(
      `<script type="module" src="/studio.js?v=${webAssetVersion}"></script>`
    )
    && editorHtml.includes(
      `<link rel="stylesheet" href="editor/editor.css?v=${webAssetVersion}">`
    )
    && editorHtml.includes(
      `<script type="module" src="editor/editor.js?v=${webAssetVersion}"></script>`
    ),
  "Popovic immutable cache를 갱신할 web asset version이 package version과 다릅니다."
);
assert(
  indexHtml.includes('id="source-url"')
    && indexHtml.includes('id="clip-list"')
    && indexHtml.includes('id="policy-section"')
    && indexHtml.includes('id="local-projects-list"')
    && indexHtml.includes('id="refresh-local-projects"')
    && indexHtml.includes('id="clear-all-local-projects"')
    && indexHtml.includes('data-project-action="continue"')
    && indexHtml.includes('data-project-action="recover"')
    && indexHtml.includes('data-project-action="delete"')
    && indexHtml.includes('id="stream-preview-frame"')
    && indexHtml.includes('id="public-launch-shell"')
    && indexHtml.includes('id="local-app-surface"')
    && /<a id="launch-kirinuki-cut" class="button primary" role="button">/u
      .test(indexHtml),
  "일반 브라우저 launcher·컷 앱 surface·저장 편집 흐름이 없습니다."
);
assert(
  indexHtml.includes(
    "처음 한 번만 이 PC의 영상 준비 도우미를 연결하면, 이후에는 선택한 구간만 이 PC에 준비합니다."
  )
    && indexHtml.includes("확인했습니다")
    && indexHtml.includes("100%")
    && indexHtml.includes('id="import-session-archive"')
    && indexHtml.includes('id="session-archive-input"')
    && indexHtml.includes("강조된 행에 E로 시작, R로 끝 시각을 기록합니다.")
    && indexHtml.includes('id="stream-cut-console"')
    && indexHtml.includes('id="capture-start"')
    && indexHtml.includes('id="capture-end"')
    && !indexHtml.includes('id="local-preview-video"')
    && !indexHtml.includes('id="prepare-local-preview"'),
  "컷 전용 surface의 player 조작부 또는 사용자 책임 고지가 없습니다."
);
assert(
  !indexHtml.includes('name="basis"')
    && !indexHtml.includes('id="evidence-fields"')
    && !indexHtml.includes('id="confirmation-text"')
    && (indexHtml.match(/data-ack/gu) || []).length === 6
    && indexHtml.includes("lostfragment@naver.com")
    && indexHtml.includes("이 프로젝트는 오픈소스입니다:")
    && /class="github-link"[^>]*href="https:\/\/github\.com\/studyreadbook4ever\/KirinukiHelper"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/u.test(indexHtml)
    && !indexHtml.includes("github-placeholder"),
  "localhost의 단순 매 사용 확인 또는 개인정보·오픈소스 안내가 올바르지 않습니다."
);
assert(
  indexHtml.includes(
    'sandbox="allow-scripts allow-same-origin"'
  )
    && indexHtml.includes(
      'allow="encrypted-media; picture-in-picture"'
    )
    && !indexHtml.includes("allow-presentation")
    && !indexHtml.includes("autoplay")
    && !indexHtml.includes("clipboard-write")
    && !indexHtml.includes("web-share")
    && !indexHtml.includes("gyroscope")
    && !indexHtml.includes("accelerometer"),
  "원본 스트리밍 iframe이 sandbox 또는 최소 browser permission 경계를 벗어났습니다."
);
assert(
  !indexHtml.includes("chrome://")
    && !indexHtml.includes("chrome-extension://")
    && !indexHtml.includes("sidepanel"),
  "localhost 시작 화면에 Extension 실행 경로가 남아 있습니다."
);
assert(
  editorHtml.includes('href="/"')
    && !editorHtml.includes("sidepanel.html")
    && !editorHtml.includes("사이드패널"),
  "웹 편집기의 정책 복귀 경로가 localhost 시작 화면을 가리키지 않습니다."
);
assert(
  editorHtml.includes("최대 4초 분할은 AudSeg가 처음 만드는 빈 칸에만 적용")
    && editorHtml.includes("Whisper 자동 자막과 만들어진 모든 자막의 시작·끝에는 전역 최대 표시 시간을 강제하지 않습니다"),
  "웹 편집기가 AudSeg 전용 4초 분할과 Whisper·전역 자막 정책을 구분하지 않습니다."
);
for (const forbiddenMarker of [
  "확장 프로그램 데이터를",
  "chrome://extensions",
  "서비스 워커",
  "확장 설정"
]) {
  assert(
    !editorHtml.includes(forbiddenMarker),
    `localhost editor HTML에 legacy Extension 안내가 남았습니다: ${forbiddenMarker}`
  );
}
assert(
  studioCss.length > 4_000
    && studioCss.includes("@media")
    && studioCss.includes(":focus"),
  "localhost 시작 화면 스타일 또는 반응형·키보드 포커스 표시가 불완전합니다."
);

for (const relativePath of WEB_JAVASCRIPT_PATHS) {
  const contents = await read(path.posix.join("web", relativePath));
  assert(
    contents.startsWith("// Generated from TypeScript sources. Do not edit directly."),
    `typed 생성물 표시가 없습니다: web/${relativePath}`
  );
  assert(
    !/\bchrome\s*\./u.test(contents),
    `localhost web 번들에 Extension API/origin이 섞였습니다: web/${relativePath}`
  );
  assert(
    !contents.includes("chrome-extension://")
      && !contents.includes("chrome-extension:\\/\\/"),
    `localhost runtime 번들에 legacy Extension origin이 섞였습니다: web/${relativePath}`
  );
}

const webEditorBundle = await read("web/editor/editor.js");
for (const forbiddenMarker of [
  "chrome://extensions",
  "KIRINUKI_PREPARE_EDITOR_NAVIGATION",
  "KIRINUKI_SOURCE_BINDING_STATUS",
  "KIRINUKI_CAPTURE_SEED_UPDATED",
  "SIDEPANEL_SHORTCUT_BINDINGS",
  "확장 설정",
  "서비스 워커"
]) {
  assert(
    !webEditorBundle.includes(forbiddenMarker),
    `localhost editor bundle에 legacy Extension marker가 남았습니다: ${forbiddenMarker}`
  );
}

for (const target of [
  "/",
  "/studio.css",
  "/studio.js",
  "/editor.html",
  "/editor/editor.css",
  "/editor/editor.js",
  "/editor/audseg-worker.js"
]) {
  const resolved = resolveStudioStaticAsset(target);
  assert(
    resolved?.relativePath.startsWith("web/"),
    `localhost 정적 allowlist에 필수 파일이 없습니다: ${target}`
  );
}

for (const target of [
  "/licenses.html",
  "/licenses.css",
  "/licenses/UNLICENSE.txt",
  "/THIRD_PARTY_NOTICES.md",
  "/licenses/MEDIABUNNY-MPL-2.0.txt",
  "/editor/fonts/Pretendard-ExtraBold.woff2"
]) {
  const resolved = resolveStudioStaticAsset(target);
  assert(
    resolved?.relativePath.startsWith("web/"),
    `localhost 법적 고지·폰트가 web 배포 루트 밖을 참조합니다: ${target}`
  );
}

assert(
  resolveStudioStaticAsset("/dev-reload.json")?.relativePath
    === "web/dev-reload.json"
    && !WEB_PACKAGE_FILES.includes("dev-reload.json"),
  "개발 marker가 exact web 경로와 release 제외 경계를 지키지 않습니다."
);

assert(
  WEB_PACKAGE_FILES.every((relativePath) => !relativePath.startsWith("extension/"))
    && !WEB_PACKAGE_FILES.includes("manifest.json")
    && !WEB_PACKAGE_FILES.includes("sidepanel.html")
    && !WEB_PACKAGE_FILES.includes("service-worker.js"),
  "앱 web assets allowlist에 Chrome Extension 진입점이 섞였습니다."
);

const securityHeaders = studioSecurityHeaders({ html: true });
const csp = securityHeaders["Content-Security-Policy"] || "";
assert(
  securityHeaders["Referrer-Policy"] === "strict-origin-when-cross-origin",
  "YouTube privacy-enhanced embed identity를 보존할 origin-only referrer policy가 없습니다."
);
assert(
  csp.includes("default-src 'self'")
    && csp.includes("frame-ancestors 'none'")
    && csp.includes("http://127.0.0.1:4319")
    && csp.includes("script-src 'self'")
    && !/script-src[^;]*https:/u.test(csp)
    && csp.includes("frame-src https://chzzk.naver.com")
    && csp.includes("https://www.youtube-nocookie.com")
    && csp.includes("https://vod.sooplive.com")
    && !/frame-src[^;]*https:\/\/www\.youtube\.com/u.test(csp)
    && !csp.includes("https://vod.sooplive.co.kr")
    && !csp.includes("https://vod.afreecatv.com")
    && !csp.includes("*"),
  "localhost HTML CSP가 self/exact gateway 경계를 고정하지 않습니다."
);

console.log(
  `Kirinuki 앱 검증 통과: ${WEB_JAVASCRIPT_PATHS.length}개 typed bundle, `
  + "source/구간/policy/resume UI, browser runtime, exact app-only CSP"
);
