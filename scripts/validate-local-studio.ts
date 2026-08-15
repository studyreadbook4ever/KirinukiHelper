import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  WEB_JAVASCRIPT_PATHS
} from "./web-javascript-build.js";
import {
  SOOP_STREAMING_COMPANION_JAVASCRIPT_PATH,
  STUDIO_STREAMING_RELAY_JAVASCRIPT_PATH,
  STREAMING_COMPANION_JAVASCRIPT_PATH,
  STREAMING_COMPANION_MANIFEST_PATH,
  buildStreamingCompanion
} from "./build-streaming-companion.js";
import { WEB_PACKAGE_FILES } from "./web-package-files.js";
import {
  DEFAULT_STUDIO_PORT,
  STUDIO_LOOPBACK_HOST,
  resolveStudioStaticAsset,
  studioSecurityHeaders
} from "./local-studio-server-core.js";
import { KIRINUKI_LOCAL_STUDIO_ORIGIN } from "../src/lib/local-runtime-origin.js";
import { STREAMING_BRIDGE_PROTOCOL } from "../src/web/streaming-bridge-protocol.js";
import {
  STREAMING_COMPANION_PROTOCOL_OPTION,
  browserLaunchArgs
} from "./linux-helper.js";

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
  agentsDocument,
  buildWebSource
] = await Promise.all([
  read("web/index.html"),
  read("web/editor.html"),
  read("web/studio.css"),
  read("package.json").then((contents) => JSON.parse(contents) as {
    readonly name?: string;
    readonly version?: string;
    readonly scripts?: Readonly<Record<string, string>>;
  }),
  read("AGENTS.md"),
  read("scripts/build-web.ts")
]);

const companionBuild = await buildStreamingCompanion({
  rootDirectory: root,
  write: false,
  logLevel: "silent"
});
for (const relativePath of [
  STREAMING_COMPANION_JAVASCRIPT_PATH,
  SOOP_STREAMING_COMPANION_JAVASCRIPT_PATH,
  STREAMING_COMPANION_MANIFEST_PATH
]) {
  const expected = companionBuild.outputs.get(relativePath);
  const actual = await readFile(
    path.join(root, "streaming-companion", relativePath)
  );
  assert(
    expected && Buffer.compare(actual, Buffer.from(expected)) === 0,
    `최소 스트리밍 companion 생성물이 현재 build-time 설정과 다릅니다: ${relativePath}`
  );
}
const companionManifest = JSON.parse(await read(
  `streaming-companion/${STREAMING_COMPANION_MANIFEST_PATH}`
)) as {
  readonly manifest_version?: number;
  readonly version?: string;
  readonly background?: unknown;
  readonly action?: unknown;
  readonly side_panel?: unknown;
  readonly permissions?: readonly string[];
  readonly host_permissions?: readonly string[];
  readonly content_scripts?: ReadonlyArray<{
    readonly matches?: readonly string[];
    readonly include_globs?: readonly string[];
    readonly js?: readonly string[];
    readonly all_frames?: boolean;
    readonly run_at?: string;
    readonly world?: string;
  }>;
};
const [studioRelayContentScript, companionContentScript, soopCompanionContentScript] =
  companionManifest.content_scripts || [];
assert(
  companionManifest.manifest_version === 3
    && companionManifest.version === packageManifest.version
    && companionManifest.background === undefined
    && companionManifest.action === undefined
    && companionManifest.side_panel === undefined
    && JSON.stringify(companionManifest.permissions) === JSON.stringify(["storage"])
    && companionManifest.host_permissions === undefined
    && companionManifest.content_scripts?.length === 3
    && studioRelayContentScript?.all_frames === false
    && studioRelayContentScript.run_at === "document_start"
    && studioRelayContentScript.world === undefined
    && JSON.stringify(studioRelayContentScript.js)
      === JSON.stringify([STUDIO_STREAMING_RELAY_JAVASCRIPT_PATH])
    && JSON.stringify(studioRelayContentScript.matches) === JSON.stringify([
      "http://127.0.0.1/*"
    ])
    && JSON.stringify(studioRelayContentScript.include_globs) === JSON.stringify([
      "http://127.0.0.1:4320/*"
    ])
    && companionContentScript?.all_frames === true
    && companionContentScript.run_at === "document_start"
    && JSON.stringify(companionContentScript.js)
      === JSON.stringify([STREAMING_COMPANION_JAVASCRIPT_PATH])
    && JSON.stringify(companionContentScript.matches) === JSON.stringify([
      "https://chzzk.naver.com/*",
      "https://www.youtube-nocookie.com/*"
    ])
    && companionContentScript.world === undefined
    && soopCompanionContentScript?.all_frames === true
    && soopCompanionContentScript.run_at === "document_start"
    && soopCompanionContentScript.world === "MAIN"
    && JSON.stringify(soopCompanionContentScript.js)
      === JSON.stringify([SOOP_STREAMING_COMPANION_JAVASCRIPT_PATH])
    && JSON.stringify(soopCompanionContentScript.matches) === JSON.stringify([
      "https://vod.sooplive.com/*"
    ]),
  "최소 스트리밍 companion manifest가 storage 전용 권한, exact top-frame Studio relay, SOOP MAIN-world 브리지와 두 generic frame origin만 허용해야 합니다."
);
const studioRelayJavaScript = await read(
  `streaming-companion/${STUDIO_STREAMING_RELAY_JAVASCRIPT_PATH}`
);
const companionJavaScript = await read(
  `streaming-companion/${STREAMING_COMPANION_JAVASCRIPT_PATH}`
);
const soopCompanionJavaScript = await read(
  `streaming-companion/${SOOP_STREAMING_COMPANION_JAVASCRIPT_PATH}`
);
assert(
  studioRelayJavaScript.includes(KIRINUKI_LOCAL_STUDIO_ORIGIN)
    && studioRelayJavaScript.includes("KIRINUKI_STREAMING_BRIDGE_STUDIO_DELIVERY"),
  "top-frame Studio relay 생성물이 exact 앱 Origin과 인증 전달 프로토콜을 포함해야 합니다."
);

const companionRoot = path.join(root, "streaming-companion");
const launchArgs = browserLaunchArgs({
  profileRoot: path.join(root, ".validator-browser-profile"),
  streamingCompanionRoot: companionRoot
});
assert(
  launchArgs.includes(`--disable-extensions-except=${companionRoot}`)
    && launchArgs.includes(`--load-extension=${companionRoot}`)
    && launchArgs.includes(
      `${STREAMING_COMPANION_PROTOCOL_OPTION}=${STREAMING_BRIDGE_PROTOCOL}`
    )
    && launchArgs.filter((argument) => (
      argument.startsWith("--disable-extensions-except=")
      || argument.startsWith("--load-extension=")
    )).length === 2
    && !launchArgs.some((argument) => (
      argument.includes(`${path.sep}extension`)
      && !argument.includes(`${path.sep}streaming-companion`)
    )),
  "전용 Chromium은 exact 최소 companion 두 argv만 사용해야 합니다."
);
assert(
  agentsDocument.includes("streaming-companion/")
    && agentsDocument.includes("--load-extension")
    && agentsDocument.includes("--disable-extensions-except"),
  "운영 문서가 최소 companion의 exact load 경계를 설명하지 않습니다."
);
for (const javascript of [companionJavaScript, soopCompanionJavaScript]) {
  assert(
    javascript.startsWith(
      "// Generated from TypeScript sources. Do not edit directly."
    )
      && companionBuild.allowedStudioOrigins.every((origin) => (
        javascript.includes(origin)
      ))
      && javascript.includes(STREAMING_BRIDGE_PROTOCOL)
      && !javascript.includes("chrome.runtime")
      && !javascript.includes("sidePanel")
      && !javascript.includes("service-worker"),
    "최소 스트리밍 companion 번들이 exact Studio origin과 DOM-only 경계를 지키지 않습니다."
  );
}
assert(
  soopCompanionJavaScript.includes("vodCore"),
  "SOOP MAIN-world companion이 공식 vodCore 전역 시계를 검증하지 않습니다."
);

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
    && packageScripts["streaming:companion:build"]
      === "node --import tsx scripts/build-streaming-companion.ts"
    && buildWebSource.includes("buildStreamingCompanion({ rootDirectory: root })"),
  "기본 build/validate/package 명령이 localhost web 경로로 고정되지 않았습니다."
);
for (const [name, command] of Object.entries(packageScripts)) {
  assert(
    !name.startsWith("legacy:extension:")
      && !/scripts\/(?:browser-smoke|dev-extension|build-extension-legacy|validate-extension|package-extension)\.ts|sidepanel/iu.test(command),
    `삭제된 전체 Extension 명령이 package scripts에 남았습니다: ${name}`
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
    && indexHtml.includes('id="stream-preview-frame"'),
  "localhost 시작 화면에 source·구간·per-use 정책·최근 편집 흐름이 없습니다."
);
assert(
  indexHtml.includes(
    "이 화면에서는 영상을 내려받지 않습니다. 선택한 구간은 편집기를 열 때 이 PC에 준비합니다."
  )
    && indexHtml.includes("확인했습니다")
    && indexHtml.includes("100%")
    && indexHtml.includes('id="import-session-archive"')
    && indexHtml.includes('id="session-archive-input"')
    && indexHtml.includes('id="stream-cut-console"')
    && !indexHtml.includes('id="local-preview-video"')
    && !indexHtml.includes('id="prepare-local-preview"'),
  "localhost 시작 화면의 streaming-only 컷 경계 또는 사용자 책임 고지가 없습니다."
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
  if (relativePath !== "studio.js") {
    assert(
      !contents.includes("chrome-extension://")
        && !contents.includes("chrome-extension:\\/\\/"),
      `localhost runtime 번들에 legacy Extension origin이 섞였습니다: web/${relativePath}`
    );
  } else {
    const legacyOriginMarkers = contents.match(/chrome-extension:(?:\/\/|\\\/\\\/)/gu) || [];
    assert(
      legacyOriginMarkers.length === 1
        && contents.includes("origin-storage-migration")
        && contents.includes("ORIGIN_STORAGE_MIGRATION_SCHEMA"),
      "studio.js의 legacy Extension origin은 one-shot storage migration 경계 하나에만 있어야 합니다."
    );
  }
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
