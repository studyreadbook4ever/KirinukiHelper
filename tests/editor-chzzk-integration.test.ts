import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

import {
  CHZZK_VOD_MATERIALIZATION_SCHEMA,
  LEGACY_CHZZK_VOD_MATERIALIZATION_SCHEMA,
  materializeEditorClipWithinEditableBounds,
  materializedEditableBoundsForClip,
  materializationRequestRangeForClip,
  mediaMsToSourceMs,
  normalizeChzzkVodMaterialization,
  normalizeChzzkVodRightsConfirmation,
  sourceMsToMediaMs,
  type ChzzkVodMaterialization
} from "../src/lib/chzzk-vod-materialization.js";
import { sameCaptionMediaIdentity } from "../src/editor/caption-agent.js";
import {
  applyMediaAlignmentOffset,
  createEditorProjectFromCapture,
  mergeCaptureIntoEditorProject,
  type EditorProject
} from "../src/lib/editor-core.js";
import {
  appendShortFormClips,
  createDefaultShortFormBranch
} from "../src/lib/short-form.js";
import {
  SOURCE_PLATFORM_CHZZK,
  SOURCE_PLATFORM_SOOP,
  SOURCE_PLATFORM_YOUTUBE,
  canonicalSourceUrl,
  inferSourceIdentifiers
} from "../src/lib/source-platform.js";

const editorHtmlUrl = new URL("../web/editor.html", import.meta.url);
const editorMainUrl = new URL("../src/editor/main.ts", import.meta.url);
const mediaEngineUrl = new URL("../src/editor/media-engine.ts", import.meta.url);

const editorMainAstPromise = readFile(editorMainUrl, "utf8").then((source) => (
  ts.createSourceFile(
    editorMainUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
));
const mediaEngineAstPromise = readFile(mediaEngineUrl, "utf8").then((source) => (
  ts.createSourceFile(
    mediaEngineUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
));

type UnknownFunction = (...arguments_: unknown[]) => unknown;

interface MainMappingHelpers {
  projectMaterialization(candidateProject?: unknown): ChzzkVodMaterialization | null;
  clipForMediaEngine(
    clip: Record<string, unknown>,
    candidateProject?: unknown
  ): Record<string, unknown>;
  projectForMediaEngine(candidateProject?: unknown): {
    clips: Array<Record<string, unknown>>;
    shortForm?: {
      videoAssets: Array<Record<string, unknown>>;
      sourceAudioAssets: Array<Record<string, unknown>>;
    };
  };
  clipOutsideMedia(candidateProject?: unknown): Record<string, unknown> | null;
  sourceMsToPreviewSeconds(sourceMs: number): number;
  previewSecondsToSourceMs(previewSeconds: number): number;
  mergeCaptureIntoSourceClockProject(
    storedProject: EditorProject,
    captureState: Record<string, unknown>
  ): EditorProject;
  shouldAutoPrepareInitialVod(
    candidateProject: EditorProject,
    purpose: "editor-new" | "editor-resume" | "editor-recovery" | null,
    attempted: boolean
  ): boolean;
  normalizeMaterializedProjectSourceClock(
    storedProject: EditorProject
  ): EditorProject;
  chzzkVodRightsConfirmation(candidateProject?: unknown): unknown;
  createVodCoveragePlan(
    candidateProject: unknown,
    requestedRanges?: Array<{ id: string; startMs: number; endMs: number }>
  ): {
    clips: Array<{ id: string; startMs: number; endMs: number }>;
    editableRanges: Array<{ id: string; startMs: number; endMs: number }>;
    expandsCurrentMaterialization: boolean;
  };
  materializationCoversVodPlan(
    materialization: ChzzkVodMaterialization,
    plan: unknown
  ): boolean;
  materializationHasCompatibleVodBaseAnchors(
    materialization: ChzzkVodMaterialization,
    plan: unknown
  ): boolean;
  projectFitsMaterializedTransport(candidateProject: unknown): boolean;
  runtimeTransportBoundProjectSnapshot(
    snapshot: EditorProject,
    mediaAsset: EditorProject["mediaAsset"]
  ): EditorProject | null;
  sameMaterializedSourceVersion(
    previousAsset: unknown,
    nextMaterialization: ChzzkVodMaterialization | null
  ): boolean;
  archiveRecoveryMatchesCurrentMedia(
    recovery: Record<string, unknown>,
    sourceMedia: unknown
  ): Promise<boolean>;
}

function descendants(root: ts.Node): ts.Node[] {
  const nodes: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    nodes.push(node);
    node.forEachChild(visit);
  };
  visit(root);
  return nodes;
}

function namedFunction(
  sourceFile: ts.SourceFile,
  name: string
): ts.FunctionDeclaration {
  const declaration = sourceFile.statements.find((statement) => (
    ts.isFunctionDeclaration(statement)
    && statement.name?.text === name
  ));
  assert.ok(
    declaration && ts.isFunctionDeclaration(declaration),
    `main.ts에서 ${name} 함수를 찾을 수 없습니다.`
  );
  return declaration;
}

function directCalls(root: ts.Node, name: string): ts.CallExpression[] {
  return descendants(root).filter((node): node is ts.CallExpression => (
    ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === name
  ));
}

function propertyName(node: ts.ObjectLiteralElementLike): string | null {
  if (
    (ts.isPropertyAssignment(node)
      || ts.isShorthandPropertyAssignment(node)
      || ts.isMethodDeclaration(node)
      || ts.isGetAccessorDeclaration(node)
      || ts.isSetAccessorDeclaration(node))
    && node.name
    && (ts.isIdentifier(node.name)
      || ts.isStringLiteral(node.name)
      || ts.isNumericLiteral(node.name))
  ) {
    return node.name.text;
  }
  return null;
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string
): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find((property) => propertyName(property) === name);
}

function variableDeclaration(
  root: ts.Node,
  name: string
): ts.VariableDeclaration {
  const declaration = descendants(root).find((node): node is ts.VariableDeclaration => (
    ts.isVariableDeclaration(node)
    && ts.isIdentifier(node.name)
    && node.name.text === name
  ));
  assert.ok(declaration, `${name} 변수 선언을 찾을 수 없습니다.`);
  return declaration;
}

function openingTag(html: string, id: string): string {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(
    new RegExp(`<button\\b[^>]*\\bid="${escapedId}"[^>]*>`, "iu")
  );
  assert.ok(match, `#${id} 버튼을 찾을 수 없습니다.`);
  return match[0];
}

function loadMainMappingHelpers(
  sourceFile: ts.SourceFile,
  project: Record<string, unknown>,
  {
    rootProject = project,
    workspaceMode = "main"
  }: {
    rootProject?: Record<string, unknown>;
    workspaceMode?: "main" | "short-form";
  } = {}
): MainMappingHelpers {
  const names = [
    "chzzkVodContentId",
    "projectUsesChzzkMaterializedMedia",
    "projectMaterialization",
    "chzzkVodSourceUrl",
    "vodSourceClipId",
    "vodSourceAnchorForShortAsset",
    "shortFormSourceAssetVirtualClip",
    "shortFormSourceAssetForMediaEngine",
    "clipForMediaEngine",
    "projectForMediaEngine",
    "clipOutsideMedia",
    "materializedMediaBindingIsValid",
    "sourceMsToPreviewSeconds",
    "previewSecondsToSourceMs",
    "shouldAutoPrepareInitialVod",
    "normalizeMaterializedProjectSourceClock",
    "chzzkVodRightsConfirmation",
    "projectFitsMaterializedTransport",
    "projectFitsManualTransport",
    "sameMaterializedSourceVersion",
    "clearCaptionCheckpointsAcrossWorkspaces",
    "runtimeTransportMediaIdentityMatches",
    "runtimeTransportBoundProjectSnapshot",
    "vodWorkspaceClips",
    "enabledChzzkVodClips",
    "currentVodCoverageForClip",
    "createVodCoveragePlan",
    "materializationCoversVodPlan",
    "materializationHasCompatibleVodBaseAnchors",
    "archiveRecoveryMatchesCurrentMedia"
  ] as const;
  const typescriptSource = `${names
    .map((name) => namedFunction(sourceFile, name).getText(sourceFile))
    .join("\n\n")}

function mergeCaptureIntoSourceClockProject(
  currentProject: Record<string, unknown>,
  captureState: Record<string, unknown>
) {
  return mergeCaptureIntoEditorProject(
    normalizeMaterializedProjectSourceClock(currentProject),
    captureState
  );
}`;
  const javascriptSource = ts.transpileModule(typescriptSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None
    }
  }).outputText;
  const dependencies: Record<string, unknown> = {
    project,
    normalizeChzzkVodMaterialization,
    materializeEditorClipWithinEditableBounds,
    materializedEditableBoundsForClip,
    materializationRequestRangeForClip,
    sourceMsToMediaMs,
    mediaMsToSourceMs,
    normalizeChzzkVodRightsConfirmation,
    sameCaptionMediaIdentity,
    applyMediaAlignmentOffset,
    createEditorProjectFromCapture,
    mergeCaptureIntoEditorProject,
    SOURCE_PLATFORM_CHZZK,
    SOURCE_PLATFORM_SOOP,
    SOURCE_PLATFORM_YOUTUBE,
    canonicalSourceUrl,
    inferSourceIdentifiers,
    cloneProject: structuredClone,
    CHZZK_VOD_MATERIALIZATION_SCHEMA,
    LEGACY_CHZZK_VOD_MATERIALIZATION_SCHEMA,
    isMaterializedLoopbackMediaSource: (source: unknown) => Boolean(
      source
      && typeof source === "object"
      && (source as { kind?: unknown }).kind === "local-url"
    ),
    SHORT_FORM_MIN_CLIP_DURATION_MS: 100,
    rootProject,
    workspaceMode
  };
  const factory = Function(
    ...Object.keys(dependencies),
    `${javascriptSource}\nreturn { ${names.join(", ")}, mergeCaptureIntoSourceClockProject };`
  ) as (...values: unknown[]) => Record<string, UnknownFunction>;
  return factory(...Object.values(dependencies)) as unknown as MainMappingHelpers;
}

interface VodHotLoadQueueHarness {
  queueVodHotLoad(
    range: { id: string; startMs: number; endMs: number },
    trimIntent?: Record<string, unknown>
  ): Promise<boolean>;
}

function loadVodHotLoadQueueHarness(
  sourceFile: ts.SourceFile,
  prepare: (options: Record<string, unknown>) => Promise<boolean>,
  appliedTrimBatches: unknown[][]
): VodHotLoadQueueHarness {
  const names = [
    "mergePendingVodHotLoadRange",
    "mergeVodHotLoadBatch",
    "drainVodHotLoadQueue",
    "ensureVodHotLoadDrain",
    "queueVodHotLoad"
  ] as const;
  const declarations = names
    .map((name) => namedFunction(sourceFile, name).getText(sourceFile))
    .join("\n\n");
  const state = `
    let pendingVodHotLoadBatch = null;
    let inFlightVodHotLoadBatch = null;
    let activeVodHotLoadDrain = null;
    let latestVodHotLoadSequence = 0;
    let vodHotLoadQueueCancelRequested = false;
    const latestVodHotLoadTrimSequence = new Map();
  `;
  const javascriptSource = ts.transpileModule(`${state}\n${declarations}`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None
    }
  }).outputText;
  const dependencies = {
    prepareChzzkVodMedia: prepare,
    applyLoadedVodTrimIntents: (intents: unknown[]) => {
      appliedTrimBatches.push(intents);
      return intents.length > 0;
    },
    showToast: () => {},
    errorMessage: (error: unknown) => String(error)
  };
  const factory = Function(
    ...Object.keys(dependencies),
    `${javascriptSource}\nreturn { queueVodHotLoad };`
  ) as (...values: unknown[]) => VodHotLoadQueueHarness;
  return factory(...Object.values(dependencies));
}

async function waitUntil(
  predicate: () => boolean,
  message: string
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

function materializationFixture(): ChzzkVodMaterialization {
  return {
    schema: CHZZK_VOD_MATERIALIZATION_SCHEMA,
    materializationId: "14252987142529871425298714252987",
    planFingerprint: "1425298714252987142529871425298714252987142529871425298714252987",
    source: {
      platform: "CHZZK",
      contentType: "vod",
      contentId: "14252987",
      sourceVersionId: "c".repeat(64)
    },
    sourceDurationMs: 200_000,
    handleMs: 10_000,
    mediaDurationMs: 48_000,
    windows: [{
      id: "window-union",
      editableSourceStartMs: 90_000,
      editableSourceEndMs: 135_000,
      fetchedSourceStartMs: 88_000,
      fetchedSourceEndMs: 136_000,
      mediaStartMs: 0,
      mediaEndMs: 48_000,
      clipIds: ["clip-a", "clip-b"]
    }],
    clipRanges: [{
      clipId: "clip-a",
      sourceStartMs: 100_000,
      sourceEndMs: 110_000,
      editableSourceStartMs: 90_000,
      editableSourceEndMs: 120_000
    }, {
      clipId: "clip-b",
      sourceStartMs: 115_000,
      sourceEndMs: 125_000,
      editableSourceStartMs: 95_000,
      editableSourceEndMs: 135_000
    }],
    preparedAt: "2026-08-10T00:00:00.000Z",
    localOnly: true
  };
}

function projectFixture(): Record<string, unknown> {
  return {
    source: {
      platform: "CHZZK",
      contentType: "vod",
      contentId: "14252987",
      canonicalUrl: "https://chzzk.naver.com/video/14252987"
    },
    broadcastSession: { alignmentOffsetMs: 0 },
    mediaAsset: {
      mediaMode: "chzzk-vod-selection",
      durationMs: 48_000,
      mediaOriginMs: 0,
      materialization: materializationFixture(),
      rightsConfirmation: {
        scope: "owned-or-authorized-public-vod",
        contentId: "14252987",
        confirmedAt: "2026-08-10T00:00:00.000Z"
      }
    },
    clips: [{
      id: "clip-a",
      selectionStartMs: 100_000,
      selectionEndMs: 110_000,
      sourceStartMs: 95_000,
      sourceEndMs: 120_000,
      timelineStartMs: 0,
      enabled: true
    }, {
      id: "clip-b",
      selectionStartMs: 115_000,
      selectionEndMs: 125_000,
      sourceStartMs: 115_000,
      sourceEndMs: 125_000,
      timelineStartMs: 25_000,
      enabled: false
    }]
  };
}

test("CHZZK VOD 자동 준비 UI는 긴 원본 부분 읽기 대신 compact 편집 영상 의미를 연결한다", async () => {
  const [html, sourceFile] = await Promise.all([
    readFile(editorHtmlUrl, "utf8"),
    editorMainAstPromise
  ]);

  for (const id of ["prepare-chzzk-vod", "prepare-chzzk-vod-empty"]) {
    const button = openingTag(html, id);
    assert.match(button, /\btype="button"/u);
    assert.match(button, /\bhidden\b/u);
  }
  assert.match(html, /id="pick-media-empty"[^>]*>내 파일 직접 연결<\/button>/u);
  assert.match(
    html,
    /id="local-media-engine-cancel"[^>]*>내 파일로 계속하기<\/button>/u
  );
  assert.match(html, /id="local-media-engine-flow"/u);
  assert.match(html, /공식 도우미 받기/u);
  assert.match(html, /브라우저의 다운로드 완료 표시 뒤 파일을 실행합니다/u);
  assert.match(html, /Apple Silicon macOS 15 이상/u);

  const headerStrings = new Set(
    descendants(namedFunction(sourceFile, "renderHeader"))
      .filter((node): node is ts.StringLiteral => ts.isStringLiteral(node))
      .map((node) => node.text)
  );
  assert.ok(headerStrings.has("편집할 영상을 준비해 주세요"));
  assert.ok(headerStrings.has("선택한 구간을 기준으로 필요한 영상만 이 기기에 가져옵니다. 부족한 앞뒤 구간은 편집 중 더 준비할 수 있습니다"));
  assert.match(html, /data-hot-load="before"[^>]*>앞 30초</u);
  assert.match(html, /data-hot-load="after"[^>]*>뒤 30초</u);
  assert.doesNotMatch(
    html,
    /긴 영상도 디스크에서 필요한 부분만 읽습니다|선택 구간만 디스크에서 읽습니다/u
  );

  const bindings = descendants(namedFunction(sourceFile, "bindActions"))
    .filter((node): node is ts.CallExpression => (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "addEventListener"
      && ts.isPropertyAccessExpression(node.expression.expression)
      && ts.isIdentifier(node.expression.expression.expression)
      && node.expression.expression.expression.text === "elements"
    ));
  for (const elementName of ["prepare_chzzk_vod", "prepare_chzzk_vod_empty"]) {
    const binding = bindings.find((call) => (
      ts.isPropertyAccessExpression(call.expression)
      && ts.isPropertyAccessExpression(call.expression.expression)
      && call.expression.expression.name.text === elementName
    ));
    assert.ok(binding, `${elementName} click binding이 없습니다.`);
    assert.equal(
      directCalls(binding, "prepareChzzkVodMedia").length,
      1,
      `${elementName}는 CHZZK VOD 준비 함수를 정확히 한 번 호출해야 합니다.`
    );
  }
  const prepareBody = namedFunction(sourceFile, "prepareChzzkVodMedia")
    .getText(sourceFile);
  assert.match(
    prepareBody,
    /engineReady === "manual-file"[\s\S]*manualFileRequested = true/u
  );
  assert.match(
    prepareBody,
    /finally[\s\S]*unlockProjectMutations\(\)[\s\S]*manualFileRequested[\s\S]*chooseMediaFile\(\)/u,
    "installer dialog의 수동 파일 선택은 mutation lock 해제 뒤 실제 picker로 이어져야 합니다."
  );
});

test("CHZZK compact media는 수동 파일 핸들 부재로 안전 핫 리로드를 막지 않는다", async () => {
  const sourceFile = await editorMainAstPromise;
  const busyReason = namedFunction(sourceFile, "devReloadBusyReason");
  const localUrlGuard = directCalls(
    busyReason,
    "isMaterializedLoopbackMediaSource"
  );
  assert.equal(
    localUrlGuard.length,
    1,
    "compact local URL은 재연결 가능한 materialization이므로 수동 FileSystemFileHandle guard에서 제외해야 합니다."
  );
});

test("stale CHZZK 매핑은 compact 길이로 trim하지 않고 source 종류 불일치를 거부한다", async () => {
  const sourceFile = await editorMainAstPromise;
  const bindClipTrim = namedFunction(sourceFile, "bindClipTrim");
  assert.ok(
    directCalls(bindClipTrim, "projectUsesChzzkMaterializedMedia").length >= 2,
    "포인터 trim은 stale materialization을 먼저 막고 compact duration fallback을 피해야 합니다."
  );

  const renderTimeline = namedFunction(sourceFile, "renderTimeline");
  const disabledStaleHandles = descendants(renderTimeline).filter((node) => (
    ts.isPropertyAssignment(node)
    && ts.isIdentifier(node.name)
    && node.name.text === "disabled"
    && ts.isIdentifier(node.initializer)
    && node.initializer.text === "staleMaterializedMedia"
  ));
  assert.equal(
    disabledStaleHandles.length,
    2,
    "stale materialization에서는 컷의 양쪽 trim handle을 모두 비활성화해야 합니다."
  );

  const attach = namedFunction(sourceFile, "attachMediaSource");
  assert.equal(
    directCalls(attach, "assertEditorMediaSourceMode").length,
    1,
    "수동 File과 materialized loopback source의 binding mode를 attachment 경계에서 검증해야 합니다."
  );
});

test("자동 준비는 alignment 0 원본 시각 snapshot과 source-bound 권리 확인을 사용한다", async () => {
  const sourceFile = await editorMainAstPromise;
  const prepare = namedFunction(sourceFile, "prepareChzzkVodMedia");
  const sourceClock = variableDeclaration(prepare, "sourceClockProject");
  assert.equal(sourceClock.initializer, undefined);
  const sourceClockAssignment = descendants(prepare).find((node): node is ts.BinaryExpression => (
    ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && ts.isIdentifier(node.left)
    && node.left.text === "sourceClockProject"
    && ts.isCallExpression(node.right)
    && ts.isIdentifier(node.right.expression)
    && node.right.expression.text === "applyMediaAlignmentOffset"
  ));
  assert.ok(sourceClockAssignment && ts.isCallExpression(sourceClockAssignment.right));
  assert.equal(sourceClockAssignment.right.arguments.length, 2);
  assert.ok(ts.isIdentifier(sourceClockAssignment.right.arguments[0]!));
  assert.equal(sourceClockAssignment.right.arguments[0].text, "project");
  assert.ok(ts.isNumericLiteral(sourceClockAssignment.right.arguments[1]!));
  assert.equal(sourceClockAssignment.right.arguments[1].text, "0");

  const sourceClockRoot = variableDeclaration(prepare, "sourceClockRootProject");
  assert.equal(sourceClockRoot.initializer, undefined);
  assert.match(
    prepare.getText(sourceFile),
    /workspaceMode === "short-form"[\s\S]*applyMediaAlignmentOffset\(rootProject, 0\)[\s\S]*: sourceClockProject/u
  );

  const coverageCall = directCalls(prepare, "createVodCoveragePlan")[0];
  assert.ok(coverageCall && ts.isIdentifier(coverageCall.arguments[0]!));
  assert.equal(coverageCall.arguments[0].text, "sourceClockProject");

  const startCall = directCalls(prepare, "startChzzkVodMaterialization")[0];
  assert.ok(startCall && ts.isObjectLiteralExpression(startCall.arguments[0]!));
  const request = startCall.arguments[0];
  assert.ok(objectProperty(request, "clips"));
  const requestKeys = new Set(
    descendants(request)
      .filter((node): node is ts.ObjectLiteralElementLike => (
        ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)
      ))
      .map(propertyName)
      .filter(Boolean)
  );
  for (const key of ["consumerId", "editableRanges", "base", "resume"]) {
    assert.ok(requestKeys.has(key), `${key} 요청 분기가 없습니다.`);
  }
  const consumerId = objectProperty(request, "consumerId");
  assert.ok(consumerId && ts.isPropertyAssignment(consumerId));
  assert.match(
    consumerId.initializer.getText(sourceFile),
    /^sourceClockRootProject\.id$/u
  );
  const confirmed = objectProperty(request, "rightsConfirmed");
  assert.ok(confirmed && ts.isPropertyAssignment(confirmed));
  assert.equal(confirmed.initializer.kind, ts.SyntaxKind.TrueKeyword);

  const attachCall = directCalls(prepare, "attachMediaSource")[0];
  assert.ok(attachCall && ts.isObjectLiteralExpression(attachCall.arguments[1]!));
  const attachOptions = attachCall.arguments[1];
  const baseProject = objectProperty(attachOptions, "baseProject");
  assert.ok(baseProject && ts.isPropertyAssignment(baseProject));
  assert.ok(ts.isIdentifier(baseProject.initializer));
  assert.equal(baseProject.initializer.text, "sourceClockProject");
  const baseRootProject = objectProperty(attachOptions, "baseRootProject");
  assert.ok(baseRootProject && ts.isPropertyAssignment(baseRootProject));
  assert.equal(baseRootProject.initializer.getText(sourceFile), "sourceClockRootProject");

  const originalProject = projectFixture();
  const helpers = loadMainMappingHelpers(sourceFile, originalProject);
  assert.deepEqual(helpers.chzzkVodRightsConfirmation(originalProject), {
    scope: "owned-or-authorized-public-vod",
    contentId: "14252987",
    confirmedAt: "2026-08-10T00:00:00.000Z"
  });
  const otherSourceProject = {
    ...originalProject,
    source: {
      ...(originalProject.source as Record<string, unknown>),
      contentId: "99999999",
      canonicalUrl: "https://chzzk.naver.com/video/99999999"
    }
  };
  assert.equal(helpers.chzzkVodRightsConfirmation(otherSourceProject), null);

  const restore = namedFunction(sourceFile, "restoreMedia");
  assert.ok(directCalls(restore, "projectMaterialization").length >= 1);
  assert.ok(directCalls(restore, "chzzkVodRightsConfirmation").length >= 1);
});

test("편집기 mapping clone은 각 clip 자신의 ±10초만 허용하고 원본 project를 보존한다", async () => {
  const sourceFile = await editorMainAstPromise;
  const originalProject = projectFixture();
  const helpers = loadMainMappingHelpers(sourceFile, originalProject);

  const mappedProject = helpers.projectForMediaEngine(originalProject);
  assert.notEqual(mappedProject, originalProject);
  assert.deepEqual(mappedProject.clips[0], {
    ...(originalProject.clips as Array<Record<string, unknown>>)[0],
    sourceStartMs: 7_000,
    sourceEndMs: 32_000
  });
  assert.deepEqual(
    mappedProject.clips[1],
    (originalProject.clips as Array<Record<string, unknown>>)[1],
    "출력 제외 clip은 compact clone 대상이 아닙니다."
  );
  assert.equal(
    (originalProject.clips as Array<Record<string, unknown>>)[0]?.sourceStartMs,
    95_000,
    "semantic 원본 시각 project를 직접 변경하면 안 됩니다."
  );
  assert.equal(helpers.clipOutsideMedia(originalProject), null);

  const staleClip = {
    ...(originalProject.clips as Array<Record<string, unknown>>)[0],
    sourceEndMs: 130_000
  };
  const staleProject = {
    ...originalProject,
    clips: [
      staleClip,
      (originalProject.clips as Array<Record<string, unknown>>)[1]
    ]
  };
  assert.equal(helpers.clipOutsideMedia(staleProject), staleClip);
  assert.throws(
    () => helpers.clipForMediaEngine(staleClip, staleProject),
    /준비된 VOD 편집 범위 밖/u,
    "합쳐진 window의 다른 clip handle을 빌려 compact 좌표로 만들면 안 됩니다."
  );
  assert.throws(
    () => helpers.projectForMediaEngine(staleProject),
    /준비된 VOD 편집 범위 밖/u
  );
});

test("새 materialized VOD 캡처는 저장된 +10초 정렬값을 다시 더하지 않는다", async () => {
  const sourceFile = await editorMainAstPromise;
  const captureState = {
    projectName: "원본 시각 회귀",
    source: {
      platform: "CHZZK",
      contentType: "vod",
      contentId: "14252987",
      canonicalUrl: "https://chzzk.naver.com/video/14252987"
    },
    segments: [{
      id: "timing-regression",
      startSeconds: 220,
      endSeconds: 330,
      description: "03:40~05:30"
    }]
  };
  const sourceClockProject = createEditorProjectFromCapture(captureState);
  const materialization: ChzzkVodMaterialization = {
    schema: CHZZK_VOD_MATERIALIZATION_SCHEMA,
    materializationId: "1".repeat(32),
    planFingerprint: "1".repeat(64),
    source: {
      platform: "CHZZK",
      contentType: "vod",
      contentId: "14252987",
      sourceVersionId: "2".repeat(64)
    },
    sourceDurationMs: 600_000,
    handleMs: 10_000,
    mediaDurationMs: 130_000,
    windows: [{
      id: "timing-window",
      editableSourceStartMs: 210_000,
      editableSourceEndMs: 340_000,
      fetchedSourceStartMs: 210_000,
      fetchedSourceEndMs: 340_000,
      mediaStartMs: 0,
      mediaEndMs: 130_000,
      clipIds: ["clip-timing-regression"]
    }],
    clipRanges: [{
      clipId: "clip-timing-regression",
      sourceStartMs: 220_000,
      sourceEndMs: 330_000,
      editableSourceStartMs: 210_000,
      editableSourceEndMs: 340_000
    }],
    preparedAt: "2026-08-14T00:00:00.000Z",
    localOnly: true
  };
  const staleAlignedProject = {
    ...applyMediaAlignmentOffset(sourceClockProject, 10_000),
    mediaAsset: {
      durationMs: 130_000,
      mediaOriginMs: 0,
      mediaEndTimestampMs: 130_000,
      hasVideo: true,
      hasAudio: true,
      mediaMode: "source-vod-selection",
      materialization
    }
  };
  const helpers = loadMainMappingHelpers(sourceFile, staleAlignedProject);
  const merged = helpers.mergeCaptureIntoSourceClockProject(
    staleAlignedProject,
    captureState
  );
  const [clip] = merged.clips;

  assert.equal(merged.broadcastSession.alignmentOffsetMs, 0);
  assert.equal(clip?.selectionStartMs, 220_000);
  assert.equal(clip?.selectionEndMs, 330_000);
  assert.equal(clip?.sourceStartMs, 220_000);
  assert.equal(clip?.sourceEndMs, 330_000);

  const mergedHelpers = loadMainMappingHelpers(sourceFile, merged);
  const transportProject = mergedHelpers.projectForMediaEngine(merged);
  assert.equal(transportProject.clips[0]?.sourceStartMs, 10_000);
  assert.equal(transportProject.clips[0]?.sourceEndMs, 120_000);
  assert.equal(mergedHelpers.sourceMsToPreviewSeconds(220_000), 10);
  assert.equal(mergedHelpers.previewSecondsToSourceMs(10), 220_000);
  assert.deepEqual(mergedHelpers.createVodCoveragePlan(merged), {
    clips: [{ id: "clip-timing-regression", startMs: 220_000, endMs: 330_000 }],
    editableRanges: [{
      id: "clip-timing-regression",
      startMs: 210_000,
      endMs: 340_000
    }],
    expandsCurrentMaterialization: false
  });

  const detachedVod = {
    ...staleAlignedProject,
    mediaAsset: null
  };
  const pendingMerged = helpers.mergeCaptureIntoSourceClockProject(
    detachedVod,
    captureState
  );
  assert.equal(pendingMerged.broadcastSession.alignmentOffsetMs, 10_000);
  assert.equal(pendingMerged.clips[0]?.selectionStartMs, 220_000);
  assert.equal(pendingMerged.clips[0]?.selectionEndMs, 330_000);
  assert.equal(pendingMerged.clips[0]?.sourceStartMs, 230_000);
  assert.equal(pendingMerged.clips[0]?.sourceEndMs, 340_000);

  assert.equal(
    helpers.shouldAutoPrepareInitialVod(pendingMerged, "editor-new", false),
    true
  );
  const initialAutoPrepared = applyMediaAlignmentOffset(pendingMerged, 0);
  assert.equal(initialAutoPrepared.broadcastSession.alignmentOffsetMs, 0);
  assert.equal(initialAutoPrepared.clips[0]?.sourceStartMs, 220_000);
  assert.equal(initialAutoPrepared.clips[0]?.sourceEndMs, 330_000);
  assert.equal(
    helpers.shouldAutoPrepareInitialVod(pendingMerged, "editor-resume", false),
    false
  );
  assert.equal(
    helpers.shouldAutoPrepareInitialVod(pendingMerged, "editor-recovery", false),
    false
  );
  assert.equal(
    helpers.shouldAutoPrepareInitialVod(pendingMerged, "editor-new", true),
    false
  );

  const manualProject = {
    ...staleAlignedProject,
    mediaAsset: {
      durationMs: 600_000,
      mediaOriginMs: 0,
      mediaEndTimestampMs: 600_000,
      hasVideo: true,
      hasAudio: true,
      mediaMode: "manual-file"
    }
  };
  const manualMerged = helpers.mergeCaptureIntoSourceClockProject(
    manualProject,
    captureState
  );
  assert.equal(manualMerged.broadcastSession.alignmentOffsetMs, 10_000);
  assert.equal(manualMerged.clips[0]?.sourceStartMs, 230_000);
  assert.equal(manualMerged.clips[0]?.sourceEndMs, 340_000);
});

test("materialized VOD의 stale 정렬 복구는 receipt로 증명된 USER 경계만 source clock으로 되돌린다", async () => {
  const sourceFile = await editorMainAstPromise;
  const captureState = {
    projectName: "정렬 메타데이터 복구",
    source: {
      platform: "CHZZK",
      contentType: "vod",
      contentId: "14252987",
      canonicalUrl: "https://chzzk.naver.com/video/14252987"
    },
    segments: [{
      id: "metadata-only",
      startSeconds: 210,
      endSeconds: 290,
      description: "원본 좌표는 이미 정상"
    }]
  };
  const sourceClockProject = createEditorProjectFromCapture(captureState);
  const clip = sourceClockProject.clips[0]!;
  const materializedAsset = {
    durationMs: 100_000,
    mediaOriginMs: 0,
    mediaEndTimestampMs: 100_000,
    hasVideo: true,
    hasAudio: true,
    mediaMode: "source-vod-selection",
    materialization: {
      schema: CHZZK_VOD_MATERIALIZATION_SCHEMA,
      materializationId: "3".repeat(32),
      planFingerprint: "3".repeat(64),
      source: {
        platform: "CHZZK",
        contentType: "vod",
        contentId: "14252987",
        sourceVersionId: "4".repeat(64)
      },
      sourceDurationMs: 600_000,
      handleMs: 10_000,
      mediaDurationMs: 100_000,
      windows: [{
        id: "metadata-only-window",
        editableSourceStartMs: 200_000,
        editableSourceEndMs: 300_000,
        fetchedSourceStartMs: 200_000,
        fetchedSourceEndMs: 300_000,
        mediaStartMs: 0,
        mediaEndMs: 100_000,
        clipIds: [clip.id]
      }],
      clipRanges: [{
        clipId: clip.id,
        sourceStartMs: 210_000,
        sourceEndMs: 290_000,
        editableSourceStartMs: 200_000,
        editableSourceEndMs: 300_000
      }],
      preparedAt: "2026-08-14T00:00:00.000Z",
      localOnly: true
    }
  };
  const authoredProject: EditorProject = {
    ...sourceClockProject,
    broadcastSession: {
      ...sourceClockProject.broadcastSession,
      alignmentOffsetMs: 10_000,
      alignmentConfirmed: true
    },
    mediaAsset: materializedAsset,
    subtitles: [{
      id: "cue-metadata-only",
      clipId: clip.id,
      startOffsetMs: 1_000,
      endOffsetMs: 2_000,
      text: "보존",
      lane: 0,
      color: "#ffffff",
      x: 0.5,
      y: 0.84,
      origin: "human",
      humanEdited: true,
      confidence: null
    }],
    imageAssets: [{
      id: "image-metadata-only",
      clipId: clip.id,
      startOffsetMs: 2_000,
      endOffsetMs: 3_000,
      name: "보존 이미지",
      mimeType: "image/png",
      source: {
        kind: "data-url",
        value: "data:image/png;base64,iVBORw0KGgo="
      },
      sourceUrl: "",
      x: 0.5,
      y: 0.5,
      scale: 1,
      opacity: 1,
      naturalWidth: 1,
      naturalHeight: 1
    }],
    audioRegions: [{
      id: "audio-metadata-only",
      clipId: clip.id,
      startOffsetMs: 3_000,
      endOffsetMs: 4_000,
      gain: 0.75,
      muted: false,
      fadeInMs: 100,
      fadeOutMs: 100
    }]
  };
  authoredProject.shortForm = appendShortFormClips(
    authoredProject,
    authoredProject.shortForm,
    [clip.id]
  );
  const authoredShortVideo = structuredClone(
    authoredProject.shortForm.videoAssets[0]
  );
  const authoredShortAudio = structuredClone(
    authoredProject.shortForm.sourceAudioAssets[0]
  );
  const helpers = loadMainMappingHelpers(sourceFile, authoredProject);
  const merged = helpers.mergeCaptureIntoSourceClockProject(
    authoredProject,
    captureState
  );

  assert.equal(merged.broadcastSession.alignmentOffsetMs, 0);
  assert.equal(merged.clips[0]?.sourceStartMs, 210_000);
  assert.equal(merged.clips[0]?.sourceEndMs, 290_000);
  assert.deepEqual(merged.subtitles.map((cue) => ({
    startOffsetMs: cue.startOffsetMs,
    endOffsetMs: cue.endOffsetMs,
    text: cue.text
  })), [{ startOffsetMs: 1_000, endOffsetMs: 2_000, text: "보존" }]);
  assert.deepEqual(merged.imageAssets.map((asset) => ({
    startOffsetMs: asset.startOffsetMs,
    endOffsetMs: asset.endOffsetMs,
    name: asset.name
  })), [{ startOffsetMs: 2_000, endOffsetMs: 3_000, name: "보존 이미지" }]);
  assert.deepEqual(merged.audioRegions.map((region) => ({
    startOffsetMs: region.startOffsetMs,
    endOffsetMs: region.endOffsetMs,
    gain: region.gain
  })), [{ startOffsetMs: 3_000, endOffsetMs: 4_000, gain: 0.75 }]);
  assert.deepEqual(merged.shortForm.videoAssets[0], authoredShortVideo);
  assert.deepEqual(merged.shortForm.sourceAudioAssets[0], authoredShortAudio);

  const shiftedWithAuthoredTimedItems: EditorProject = {
    ...authoredProject,
    clips: authoredProject.clips.map((candidate) => ({
      ...candidate,
      sourceStartMs: candidate.selectionStartMs + 10_000,
      sourceEndMs: candidate.selectionEndMs + 10_000
    })),
    mediaAsset: materializedAsset
  };
  const shiftedWithAuthoredMerged = helpers.mergeCaptureIntoSourceClockProject(
    shiftedWithAuthoredTimedItems,
    captureState
  );
  assert.equal(
    shiftedWithAuthoredMerged.clips[0]!.sourceStartMs,
    210_000,
    "결속 항목 유무와 무관하게 receipt가 증명한 legacy +10초 경계를 복구해야 합니다."
  );
  assert.deepEqual(
    shiftedWithAuthoredMerged.subtitles.map((cue) => ({
      startOffsetMs: cue.startOffsetMs,
      endOffsetMs: cue.endOffsetMs
    })),
    [{ startOffsetMs: 1_000, endOffsetMs: 2_000 }],
    "clip 내부에서 사람이 작성한 상대 시각은 source-clock migration 뒤에도 유지해야 합니다."
  );
  assert.deepEqual(
    shiftedWithAuthoredMerged.shortForm.videoAssets[0],
    shiftedWithAuthoredTimedItems.shortForm.videoAssets[0]
  );
  assert.deepEqual(
    shiftedWithAuthoredMerged.shortForm.sourceAudioAssets[0],
    shiftedWithAuthoredTimedItems.shortForm.sourceAudioAssets[0]
  );

  const shiftedWithShortOnly: EditorProject = {
    ...shiftedWithAuthoredTimedItems,
    subtitles: [],
    imageAssets: [],
    audioRegions: []
  };
  const shiftedWithShortOnlyMerged = helpers.mergeCaptureIntoSourceClockProject(
    shiftedWithShortOnly,
    captureState
  );
  assert.equal(shiftedWithShortOnlyMerged.clips[0]!.sourceStartMs, 210_000);
  assert.deepEqual(
    shiftedWithShortOnlyMerged.shortForm.videoAssets[0],
    shiftedWithShortOnly.shortForm.videoAssets[0]
  );

  const fullyShiftedProject: EditorProject = {
    ...applyMediaAlignmentOffset({
      ...authoredProject,
      broadcastSession: {
        ...authoredProject.broadcastSession,
        alignmentOffsetMs: 0,
        alignmentConfirmed: true
      }
    }, 10_000),
    mediaAsset: materializedAsset
  };
  const fullyShiftedNormalized = helpers.normalizeMaterializedProjectSourceClock(
    fullyShiftedProject
  );
  assert.equal(fullyShiftedNormalized.clips[0]?.sourceStartMs, 210_000);
  assert.deepEqual(
    fullyShiftedNormalized.shortForm.videoAssets[0],
    authoredShortVideo,
    "legacy alignment이 쇼츠 선택 anchor에도 들어간 경우에만 같은 delta를 되돌려야 합니다."
  );
  assert.deepEqual(
    fullyShiftedNormalized.shortForm.sourceAudioAssets[0],
    authoredShortAudio
  );

  const orphanShortProject: EditorProject = {
    ...fullyShiftedProject,
    clips: [],
    subtitles: [],
    imageAssets: [],
    audioRegions: [],
    selectedClipId: null
  };
  const orphanShortNormalized = helpers.normalizeMaterializedProjectSourceClock(
    orphanShortProject
  );
  assert.equal(orphanShortNormalized.broadcastSession.alignmentOffsetMs, 0);
  assert.deepEqual(
    orphanShortNormalized.shortForm.videoAssets[0],
    authoredShortVideo,
    "본편 clip을 지운 뒤에도 v2 receipt가 증명하는 쇼츠 lineage는 source clock으로 복구해야 합니다."
  );
  assert.deepEqual(
    orphanShortNormalized.shortForm.sourceAudioAssets[0],
    authoredShortAudio
  );

  const shiftedWithCheckpointOnly: EditorProject = {
    ...shiftedWithShortOnly,
    shortForm: createDefaultShortFormBranch(),
    ai: {
      ...shiftedWithShortOnly.ai,
      captionCheckpoints: [{
        clipId: clip.id,
        sourceStartMs: 220_000,
        sourceEndMs: 300_000,
        model: "audseg-local",
        qualityProfile: "timing-regression",
        harnessFingerprint: "timing-regression",
        editorialContextFingerprint: "timing-regression",
        pipelineFingerprint: "timing-regression"
      }]
    }
  };
  const shiftedWithCheckpointOnlyMerged = helpers.mergeCaptureIntoSourceClockProject(
    shiftedWithCheckpointOnly,
    captureState
  );
  assert.equal(
    shiftedWithCheckpointOnlyMerged.clips[0]!.sourceStartMs,
    210_000
  );
  assert.deepEqual(
    shiftedWithCheckpointOnlyMerged.ai.captionCheckpoints,
    [],
    "복구 전 source 범위에 결속된 AI 재개 체크포인트는 재사용하면 안 됩니다."
  );

  const splitProject: EditorProject = {
    ...authoredProject,
    clips: [{
      ...clip,
      id: "clip-split-left",
      sourceStartMs: 220_000,
      sourceEndMs: 250_000
    }, {
      ...clip,
      id: "clip-split-right",
      sourceStartMs: 260_000,
      sourceEndMs: 300_000,
      timelineStartMs: 30_000
    }],
    subtitles: [],
    imageAssets: [],
    audioRegions: [],
    shortForm: createDefaultShortFormBranch()
  };
  const splitMerged = helpers.mergeCaptureIntoSourceClockProject(
    splitProject,
    captureState
  );
  assert.deepEqual(splitMerged.clips.map((candidate) => ({
    id: candidate.id,
    sourceStartMs: candidate.sourceStartMs,
    sourceEndMs: candidate.sourceEndMs
  })), [{
    id: "clip-split-left",
    sourceStartMs: 220_000,
    sourceEndMs: 250_000
  }, {
    id: "clip-split-right",
    sourceStartMs: 260_000,
    sourceEndMs: 300_000
  }]);

  const mixedCapture = {
    ...captureState,
    segments: [
      ...captureState.segments,
      {
        id: "mixed-shifted",
        startSeconds: 320,
        endSeconds: 360,
        description: "명백한 shifted 경계"
      }
    ]
  };
  const mixedSourceClock = createEditorProjectFromCapture(mixedCapture);
  const mixedAligned = applyMediaAlignmentOffset(mixedSourceClock, 10_000);
  const mixedProject: EditorProject = {
    ...mixedAligned,
    mediaAsset: materializedAsset,
    clips: mixedAligned.clips.map((candidate, index) => index === 0
      ? {
        ...candidate,
        sourceStartMs: candidate.selectionStartMs,
        sourceEndMs: candidate.selectionEndMs
      }
      : candidate)
  };
  const mixedMerged = helpers.mergeCaptureIntoSourceClockProject(
    mixedProject,
    mixedCapture
  );
  assert.deepEqual(mixedMerged.clips.map((candidate) => ({
    sourceStartMs: candidate.sourceStartMs,
    sourceEndMs: candidate.sourceEndMs
  })), [{
    sourceStartMs: 210_000,
    sourceEndMs: 290_000
  }, {
    sourceStartMs: 330_000,
    sourceEndMs: 370_000
  }], "v2 receipt에 없는 clip은 +10초 형태만 보고 자동 수정하면 안 됩니다.");

  const changedBoundaryCapture = {
    ...captureState,
    segments: [{
      ...captureState.segments[0],
      startSeconds: 205,
      endSeconds: 285
    }]
  };
  const changedBoundaryMerged = helpers.mergeCaptureIntoSourceClockProject(
    {
      ...applyMediaAlignmentOffset(sourceClockProject, 10_000),
      mediaAsset: materializedAsset
    },
    changedBoundaryCapture
  );
  assert.equal(changedBoundaryMerged.clips[0]?.selectionStartMs, 205_000);
  assert.equal(changedBoundaryMerged.clips[0]?.selectionEndMs, 285_000);
  assert.equal(changedBoundaryMerged.clips[0]?.sourceStartMs, 205_000);
  assert.equal(changedBoundaryMerged.clips[0]?.sourceEndMs, 285_000);

  const nearStartCapture = {
    ...captureState,
    segments: [{
      id: "near-source-start",
      startSeconds: 5,
      endSeconds: 15,
      description: "원본 시작 인접"
    }]
  };
  const nearStartSourceClock = createEditorProjectFromCapture(nearStartCapture);
  const nearStartMetadataOnly: EditorProject = {
    ...nearStartSourceClock,
    broadcastSession: {
      ...nearStartSourceClock.broadcastSession,
      alignmentOffsetMs: 10_000,
      alignmentConfirmed: true
    },
    mediaAsset: materializedAsset
  };
  const nearStartMerged = helpers.mergeCaptureIntoSourceClockProject(
    nearStartMetadataOnly,
    nearStartCapture
  );
  assert.equal(nearStartMerged.clips[0]?.sourceStartMs, 5_000);
  assert.equal(nearStartMerged.clips[0]?.sourceEndMs, 15_000);
});

test("웹 편집기는 삭제된 Extension의 실시간 capture seed 메시지를 받지 않는다", async () => {
  const sourceFile = await editorMainAstPromise;
  const source = sourceFile.getFullText();
  assert.doesNotMatch(source, /applyCaptureSeedUpdate|KIRINUKI_CAPTURE_SEED_UPDATED/u);
});

test("materialized VOD 이어 편집은 receipt로 증명된 stale +10초 좌표와 metadata를 원자 복구한다", async () => {
  const sourceFile = await editorMainAstPromise;
  const sourceClockProject = createEditorProjectFromCapture({
    projectName: "이어 편집 정렬",
    source: {
      platform: "CHZZK",
      contentType: "vod",
      contentId: "14252987",
      canonicalUrl: "https://chzzk.naver.com/video/14252987"
    },
    segments: [{
      id: "resume-alignment",
      startSeconds: 5,
      endSeconds: 15,
      description: "원본 시작 인접"
    }]
  });
  const materializedProject: EditorProject = {
    ...applyMediaAlignmentOffset(sourceClockProject, 10_000),
    mediaAsset: {
      durationMs: 25_000,
      mediaOriginMs: 0,
      mediaEndTimestampMs: 25_000,
      hasVideo: true,
      hasAudio: true,
      mediaMode: "source-vod-selection",
      materialization: {
        schema: CHZZK_VOD_MATERIALIZATION_SCHEMA,
        materializationId: "8".repeat(32),
        planFingerprint: "8".repeat(64),
        source: {
          platform: "CHZZK",
          contentType: "vod",
          contentId: "14252987",
          sourceVersionId: "9".repeat(64)
        },
        sourceDurationMs: 600_000,
        handleMs: 10_000,
        mediaDurationMs: 25_000,
        windows: [{
          id: "resume-alignment-window",
          editableSourceStartMs: 0,
          editableSourceEndMs: 25_000,
          fetchedSourceStartMs: 0,
          fetchedSourceEndMs: 25_000,
          mediaStartMs: 0,
          mediaEndMs: 25_000,
          clipIds: [sourceClockProject.clips[0]!.id]
        }],
        clipRanges: [{
          clipId: sourceClockProject.clips[0]!.id,
          sourceStartMs: 5_000,
          sourceEndMs: 15_000,
          editableSourceStartMs: 0,
          editableSourceEndMs: 25_000
        }],
        preparedAt: "2026-08-14T00:00:00.000Z",
        localOnly: true
      }
    }
  };
  const helpers = loadMainMappingHelpers(sourceFile, materializedProject);
  const resumed = helpers.normalizeMaterializedProjectSourceClock(
    materializedProject
  );
  assert.equal(resumed.broadcastSession.alignmentOffsetMs, 0);
  assert.equal(resumed.clips[0]?.selectionStartMs, 5_000);
  assert.equal(resumed.clips[0]?.selectionEndMs, 15_000);
  assert.equal(resumed.clips[0]?.sourceStartMs, 5_000);
  assert.equal(resumed.clips[0]?.sourceEndMs, 15_000);
  assert.deepEqual(resumed.shortForm, materializedProject.shortForm);
  const mergedAfterResume = helpers.mergeCaptureIntoSourceClockProject(
    resumed,
    {
      projectName: "이어 편집 정렬",
      source: sourceClockProject.source,
      segments: [{
        id: "resume-alignment",
        startSeconds: 5,
        endSeconds: 15,
        description: "원본 시작 인접"
      }]
    }
  );
  assert.equal(mergedAfterResume.clips[0]?.sourceStartMs, 5_000);
  assert.equal(mergedAfterResume.clips[0]?.sourceEndMs, 15_000);

  const nonFiniteMetadata = structuredClone(materializedProject);
  nonFiniteMetadata.broadcastSession.alignmentOffsetMs = Number.NaN;
  nonFiniteMetadata.broadcastSession.alignmentConfirmed = false;
  const nonFiniteNormalized = helpers.normalizeMaterializedProjectSourceClock(
    nonFiniteMetadata
  );
  assert.equal(nonFiniteNormalized.broadcastSession.alignmentOffsetMs, 0);
  assert.equal(nonFiniteNormalized.broadcastSession.alignmentConfirmed, true);
  assert.deepEqual(
    nonFiniteNormalized.clips,
    nonFiniteMetadata.clips,
    "증명할 수 없는 비정상 offset metadata를 정리하면서 USER 좌표를 추측해 이동하면 안 됩니다."
  );

  const manualProject: EditorProject = {
    ...materializedProject,
    mediaAsset: {
      ...materializedProject.mediaAsset!,
      mediaMode: "manual-file"
    }
  };
  assert.equal(
    helpers.normalizeMaterializedProjectSourceClock(manualProject),
    manualProject
  );

  const initialize = namedFunction(sourceFile, "initialize");
  assert.equal(
    directCalls(initialize, "normalizeMaterializedProjectSourceClock").length,
    1
  );
  const initializeBody = initialize.getText(sourceFile);
  assert.ok(
    initializeBody.indexOf("verifyExpectedDevReloadProject(storedProject)")
      < initializeBody.indexOf(
        "normalizeMaterializedProjectSourceClock(storedProject)"
      ),
    "핫 리로드 CURRENT fingerprint는 새 빌드 migration 전에 검증해야 합니다."
  );
});

test("최초 VOD 준비 응답은 source duration 경계로 clamp한 정확한 ±10초 coverage를 검증한다", async () => {
  const sourceFile = await editorMainAstPromise;
  const initialProject = projectFixture();
  initialProject.mediaAsset = null;
  const initialClips = initialProject.clips as Array<Record<string, unknown>>;
  initialClips[1]!.enabled = true;
  const helpers = loadMainMappingHelpers(sourceFile, initialProject);
  const initialPlan = helpers.createVodCoveragePlan(initialProject);
  const initialMaterialization = materializationFixture();
  initialMaterialization.clipRanges = initialMaterialization.clipRanges!.map(
    (range) => range.clipId === "clip-b"
      ? { ...range, editableSourceStartMs: 105_000 }
      : range
  );

  assert.deepEqual(initialPlan.editableRanges, []);
  assert.equal(
    helpers.materializationCoversVodPlan(
      initialMaterialization,
      initialPlan
    ),
    true,
    "최초 요청에서 editableRanges를 생략했다는 이유로 정확한 v2 응답을 거부하면 안 됩니다."
  );

  const edgeProject = {
    ...initialProject,
    clips: [{
      ...initialClips[0],
      id: "clip-start-edge",
      selectionStartMs: 2_000,
      selectionEndMs: 4_000,
      sourceStartMs: 2_000,
      sourceEndMs: 4_000,
      enabled: true
    }, {
      ...initialClips[1],
      id: "clip-end-edge",
      selectionStartMs: 195_000,
      selectionEndMs: 200_000,
      sourceStartMs: 195_000,
      sourceEndMs: 200_000,
      enabled: true
    }]
  };
  const edgePlan = loadMainMappingHelpers(
    sourceFile,
    edgeProject
  ).createVodCoveragePlan(edgeProject);
  const edgeMaterialization = materializationFixture();
  edgeMaterialization.clipRanges = [{
    clipId: "clip-start-edge",
    sourceStartMs: 2_000,
    sourceEndMs: 4_000,
    editableSourceStartMs: 0,
    editableSourceEndMs: 14_000
  }, {
    clipId: "clip-end-edge",
    sourceStartMs: 195_000,
    sourceEndMs: 200_000,
    editableSourceStartMs: 185_000,
    editableSourceEndMs: 200_000
  }];
  assert.equal(
    helpers.materializationCoversVodPlan(edgeMaterialization, edgePlan),
    true
  );

  const overCovered = structuredClone(edgeMaterialization);
  overCovered.clipRanges![0]!.editableSourceEndMs = 14_001;
  assert.equal(
    helpers.materializationCoversVodPlan(overCovered, edgePlan),
    false,
    "최초 응답도 source 경계 clamp보다 넓은 coverage를 수용하면 안 됩니다."
  );
});

test("fresh editor-new만 지원 VOD 최초 ±10초 준비를 한 번 자동 시작한다", async () => {
  const sourceFile = await editorMainAstPromise;
  const restore = namedFunction(sourceFile, "restoreMedia");
  const body = restore.getText(sourceFile);
  const predicate = namedFunction(sourceFile, "shouldAutoPrepareInitialVod")
    .getText(sourceFile);
  const initialize = namedFunction(sourceFile, "initialize").getText(sourceFile);

  assert.match(predicate, /!attempted/u);
  assert.match(predicate, /purpose === "editor-new"/u);
  assert.match(predicate, /!candidateProject\.mediaAsset/u);
  assert.match(predicate, /chzzkVodSourceUrl\(candidateProject\)/u);
  assert.match(
    body,
    /shouldAutoPrepareInitialVod\(project\)[\s\S]*initialVodAutoPrepareAttempted = true;[\s\S]*await prepareChzzkVodMedia\(\)/u
  );
  assert.match(
    initialize,
    /entry\.kind === "fresh-capture"[\s\S]*shouldAutoPrepareInitialVod\(project\)[\s\S]*project = applyMediaAlignmentOffset\(project, 0\)/u
  );
  assert.match(
    initialize,
    /resolveStudioEditorEntry\(\{[\s\S]*checkpointBaselineHasProject: checkpoint\.baseline\.project !== null[\s\S]*"new-project-collision":[\s\S]*새 편집 ID가 이 기기의 저장 프로젝트와 충돌했습니다/u,
    "editor-new ID 충돌은 기존 CURRENT와 병합하지 않고 거부해야 합니다."
  );
  assert.doesNotMatch(
    initialize,
    /mergeCaptureIntoSourceClockProject\(/u,
    "editor-new 초기화가 저장 프로젝트와 캡처 seed를 합치면 안 됩니다."
  );
  assert.ok(
    initialize.indexOf("project = applyMediaAlignmentOffset(project, 0)")
      < initialize.indexOf("rootProject = cloneProject(project)"),
    "최초 VOD 원본 시계는 첫 저장·렌더보다 먼저 복구해야 합니다."
  );
  assert.doesNotMatch(
    body,
    /prepareChzzkVodMedia\(\)[\s\S]*최초 VOD 편집 영상을 자동으로 준비하지 못했습니다/u,
    "자동 진입부가 prepareChzzkVodMedia의 상세 오류 toast를 일반 문구로 덮으면 안 됩니다."
  );
  assert.ok(
    body.indexOf("projectUsesChzzkMaterializedMedia()")
      < body.indexOf("shouldAutoPrepareInitialVod(project)"),
    "저장된 materialization 복구는 fresh 자동 준비보다 먼저 분기해야 합니다."
  );
});

test("fresh VOD 자동 준비는 실제 호출을 한 번만 하고 상세 실패 toast를 덮지 않는다", async () => {
  const sourceFile = await editorMainAstPromise;
  const restoreSource = namedFunction(sourceFile, "restoreMedia")
    .getText(sourceFile);
  const predicateSource = namedFunction(sourceFile, "shouldAutoPrepareInitialVod")
    .getText(sourceFile);
  const javascriptSource = ts.transpileModule(
    `let initialVodAutoPrepareAttempted = false;\n${predicateSource}\n${restoreSource}`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None
      }
    }
  ).outputText;
  const toasts: string[] = [];
  let prepareCalls = 0;
  let storedHandleReads = 0;
  const dependencies: Record<string, unknown> = {
    project: { id: "fresh-vod", mediaAsset: null },
    usagePolicySession: { purpose: "editor-new" },
    projectUsesChzzkMaterializedMedia: () => false,
    projectMaterialization: () => null,
    chzzkVodRightsConfirmation: () => null,
    chzzkVodSourceUrl: () => "https://www.youtube.com/watch?v=abcdefghijk",
    prepareChzzkVodMedia: async () => {
      prepareCalls += 1;
      toasts.push("내부 미디어 엔진 연결 실패 · 편집 영상 준비 버튼으로 재시도");
      return false;
    },
    showToast: (message: string) => toasts.push(message),
    getFileFromStoredHandle: async () => {
      storedHandleReads += 1;
      return null;
    },
    attachMediaFile: async () => true,
    mediaHandle: null
  };
  const factory = Function(
    ...Object.keys(dependencies),
    `${javascriptSource}\nreturn restoreMedia;`
  ) as (...values: unknown[]) => () => Promise<void>;
  const restoreMedia = factory(...Object.values(dependencies));

  await restoreMedia();
  await restoreMedia();

  assert.equal(prepareCalls, 1, "같은 editor runtime에서 최초 요청을 중복 시작하면 안 됩니다.");
  assert.equal(storedHandleReads, 0, "mediaAsset이 없는 VOD 세션은 고아 파일 핸들을 읽어 붙이면 안 됩니다.");
  assert.deepEqual(toasts, [
    "내부 미디어 엔진 연결 실패 · 편집 영상 준비 버튼으로 재시도"
  ]);

  const resumeRestore = factory(...Object.values({
    ...dependencies,
    project: { id: "resume-vod", mediaAsset: null },
    usagePolicySession: { purpose: "editor-resume" }
  }));
  await resumeRestore();
  const manualRestore = factory(...Object.values({
    ...dependencies,
    project: {
      id: "manual-media",
      mediaAsset: { fileHandleStored: false }
    },
    usagePolicySession: { purpose: "editor-new" }
  }));
  await manualRestore();

  assert.equal(
    prepareCalls,
    1,
    "저장본 resume와 수동 media project에는 최초 VOD 요청을 적용하면 안 됩니다."
  );
});

test("저장된 VOD의 수동 재연결 가능한 복구 실패는 오류 toast를 중복 표시하지 않는다", async () => {
  const sourceFile = await editorMainAstPromise;
  const restoreSource = namedFunction(sourceFile, "restoreMedia")
    .getText(sourceFile);
  const prepareSource = namedFunction(sourceFile, "prepareChzzkVodMedia")
    .getText(sourceFile);
  assert.match(prepareSource, /if \(!restore\) \{[\s\S]*showToast\(/u);
  assert.doesNotMatch(prepareSource, /!restore\s*\|\|\s*!cancelled/u);

  const javascriptSource = ts.transpileModule(restoreSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None
    }
  }).outputText;
  const toasts: string[] = [];
  const restoreCalls: unknown[] = [];
  const dependencies: Record<string, unknown> = {
    project: { id: "saved-vod", mediaAsset: { kind: "materialized" } },
    projectUsesChzzkMaterializedMedia: () => true,
    projectMaterialization: () => ({ schema: "materialization" }),
    chzzkVodRightsConfirmation: () => ({ contentId: "vod" }),
    prepareChzzkVodMedia: async (options: unknown) => {
      restoreCalls.push(options);
      return false;
    },
    showToast: (message: string) => toasts.push(message)
  };
  const factory = Function(
    ...Object.keys(dependencies),
    `${javascriptSource}\nreturn restoreMedia;`
  ) as (...values: unknown[]) => () => Promise<void>;
  const restoreMedia = factory(...Object.values(dependencies));

  await restoreMedia();

  assert.deepEqual(restoreCalls, [{ restore: true }]);
  assert.deepEqual(
    toasts,
    [],
    "백그라운드 복구 실패는 프로젝트 손상처럼 보이지 않고 명시적 재준비 버튼에 맡겨야 합니다."
  );
});

test("VOD 준비는 사용자가 바꿀 수 있는 자막 endpoint와 분리된 관리형 4319 endpoint를 쓴다", async () => {
  const sourceFile = await editorMainAstPromise;
  const prepare = namedFunction(sourceFile, "prepareChzzkVodMedia");
  const body = prepare.getText(sourceFile);
  const endpoint = variableDeclaration(prepare, "endpoint");

  assert.ok(endpoint.initializer && ts.isIdentifier(endpoint.initializer));
  assert.equal(endpoint.initializer.text, "KIRINUKI_MEDIA_ENGINE_ENDPOINT");
  assert.doesNotMatch(
    body,
    /const endpoint = captionAgentSettings\.endpoint/u
  );
  assert.match(body, /token: vodMediaEngineToken/u);
  assert.match(body, /vodMediaEngineToken = token/u);
  assert.doesNotMatch(
    body,
    /elements\.caption_agent_token/u,
    "VOD 요청이 자막 엔진 token을 읽거나 덮어쓰면 안 됩니다."
  );
});

test("핫로드 coverage는 기존 범위를 줄이지 않고 본편·쇼츠 lineage와 요청 범위를 합친다", async () => {
  const sourceFile = await editorMainAstPromise;
  const mainProject = projectFixture();
  const mainClips = mainProject.clips as Array<Record<string, unknown>>;
  const shortClip = {
    ...mainClips[0],
    id: "short-clip-a",
    sourceStartMs: 80_000,
    sourceEndMs: 112_000,
    shortFormSourceClipId: "clip-a",
    shortFormSelectionStartMs: 100_000,
    shortFormSelectionEndMs: 110_000,
    enabled: true
  };
  mainProject.shortForm = { clips: [shortClip] };
  const helpers = loadMainMappingHelpers(sourceFile, mainProject);
  const plan = helpers.createVodCoveragePlan(mainProject, [{
    id: "clip-a",
    startMs: 70_000,
    endMs: 145_000
  }]);

  assert.deepEqual(plan.clips, [{
    id: "clip-a",
    startMs: 100_000,
    endMs: 110_000
  }, {
    id: "clip-b",
    startMs: 115_000,
    endMs: 125_000
  }]);
  assert.deepEqual(plan.editableRanges, [{
    id: "clip-a",
    startMs: 70_000,
    endMs: 145_000
  }, {
    id: "clip-b",
    startMs: 95_000,
    endMs: 135_000
  }]);
  assert.equal(plan.expandsCurrentMaterialization, true);
  assert.equal(
    helpers.materializationCoversVodPlan(materializationFixture(), plan),
    false,
    "기존 artifact가 확장 요청을 덮는 것처럼 판정하면 안 됩니다."
  );

  const expanded = materializationFixture();
  expanded.clipRanges = expanded.clipRanges!.map((range) => (
    range.clipId === "clip-a"
      ? {
        ...range,
        editableSourceStartMs: 70_000,
        editableSourceEndMs: 145_000
      }
      : range
  ));
  assert.equal(helpers.materializationCoversVodPlan(expanded, plan), true);

  const overCovered = structuredClone(expanded);
  overCovered.clipRanges![0]!.editableSourceStartMs = 69_000;
  assert.equal(
    helpers.materializationCoversVodPlan(overCovered, plan),
    false,
    "v2 응답은 요청보다 넓은 논리 coverage도 exact receipt로 수용하면 안 됩니다."
  );

  const extraClipRange = structuredClone(expanded);
  extraClipRange.clipRanges!.push({
    clipId: "unexpected-clip",
    sourceStartMs: 150_000,
    sourceEndMs: 155_000,
    editableSourceStartMs: 140_000,
    editableSourceEndMs: 165_000
  });
  assert.equal(
    helpers.materializationCoversVodPlan(extraClipRange, plan),
    false,
    "요청에 없던 clipRange가 추가된 v2 응답을 editor에서 거부해야 합니다."
  );
});

test("쇼츠 영상 삭제 뒤 남은 원본 음성의 넓은 trim 범위는 본편 anchor와 충돌하지 않는다", async () => {
  const sourceFile = await editorMainAstPromise;
  const root: Record<string, unknown> = {
    ...projectFixture(),
    id: "short-delete-anchor-project"
  };
  const remainingAudio = {
    id: "short-source-audio-after-video-delete",
    sourceAssetId: "project-primary",
    sourceClipId: "clip-a",
    sourceSelectionStartMs: 95_000,
    sourceSelectionEndMs: 120_000,
    sourceStartMs: 95_000,
    sourceEndMs: 119_000,
    timelineStartMs: 0,
    timelineEndMs: 24_000,
    gain: 1,
    muted: false,
    fadeInMs: 0,
    fadeOutMs: 0
  };
  const staleDeletedVideo = {
    id: "short-video-deleted-from-current-workspace",
    sourceAssetId: "project-primary",
    sourceClipId: "clip-a",
    sourceSelectionStartMs: 70_000,
    sourceSelectionEndMs: 140_000,
    sourceStartMs: 70_000,
    sourceEndMs: 140_000,
    timelineStartMs: 0,
    timelineEndMs: 70_000
  };
  root.shortForm = {
    videoAssets: [staleDeletedVideo],
    sourceAudioAssets: [remainingAudio]
  };
  const shortProject = {
    ...root,
    clips: [{
      id: "short-form-canvas",
      selectionStartMs: 0,
      selectionEndMs: 24_000,
      sourceStartMs: 0,
      sourceEndMs: 24_000,
      timelineStartMs: 0,
      enabled: true,
      shortFormCanvasClock: true
    }],
    shortForm: {
      videoAssets: [],
      sourceAudioAssets: [remainingAudio]
    }
  };
  const helpers = loadMainMappingHelpers(sourceFile, shortProject, {
    rootProject: root,
    workspaceMode: "short-form"
  });

  const plan = helpers.createVodCoveragePlan(shortProject);
  assert.deepEqual(
    plan.clips.find((clip) => clip.id === "clip-a"),
    { id: "clip-a", startMs: 100_000, endMs: 110_000 },
    "쇼츠 trim envelope가 본편의 immutable capture anchor를 바꾸면 안 됩니다."
  );
  assert.deepEqual(
    plan.editableRanges.find((range) => range.id === "clip-a"),
    { id: "clip-a", startMs: 90_000, endMs: 120_000 },
    "삭제 전 root의 stale 영상 범위를 다시 coverage에 포함하면 안 됩니다."
  );
  assert.equal(
    helpers.projectFitsMaterializedTransport(shortProject),
    true,
    "남은 원본 음성은 같은 본편 anchor의 기존 로컬 영상에 계속 매핑돼야 합니다."
  );
  assert.equal(
    helpers.clipOutsideMedia(shortProject),
    null,
    "영상 삭제만으로 남은 원본 음성을 로컬 범위 밖으로 판정하면 안 됩니다."
  );
  const mapped = helpers.projectForMediaEngine(shortProject);
  assert.deepEqual(
    mapped.shortForm?.sourceAudioAssets[0],
    {
      ...remainingAudio,
      sourceSelectionStartMs: 7_000,
      sourceSelectionEndMs: 31_000,
      sourceStartMs: 7_000,
      sourceEndMs: 31_000
    },
    "내보내기도 canonical 본편 anchor로 검증한 뒤 compact 좌표만 받아야 합니다."
  );

  const orphanRoot = {
    ...root,
    clips: [],
    mediaAsset: null
  };
  const orphanShortProject = {
    ...shortProject,
    mediaAsset: null
  };
  const orphanPlan = loadMainMappingHelpers(sourceFile, orphanShortProject, {
    rootProject: orphanRoot,
    workspaceMode: "short-form"
  }).createVodCoveragePlan(orphanShortProject);
  assert.deepEqual(
    orphanPlan.clips.find((clip) => clip.id === "clip-a"),
    { id: "clip-a", startMs: 95_000, endMs: 120_000 },
    "본편 clip과 receipt가 모두 없는 orphan도 삭제 전 root 영상이 아니라 현재 음성 envelope만 써야 합니다."
  );
});

test("쇼츠에서 핫로드해도 root 본편의 새 clip을 요청에서 빼지 않는다", async () => {
  const sourceFile = await editorMainAstPromise;
  const root = projectFixture();
  const clipC = {
    ...(root.clips as Array<Record<string, unknown>>)[0],
    id: "clip-c",
    selectionId: "selection-c",
    selectionStartMs: 150_000,
    selectionEndMs: 160_000,
    sourceStartMs: 145_000,
    sourceEndMs: 165_000,
    enabled: true
  };
  (root.clips as Array<Record<string, unknown>>).push(clipC);
  const shortProject = {
    ...root,
    clips: [{
      ...(root.clips as Array<Record<string, unknown>>)[0],
      id: "short-clip-a",
      shortFormSourceClipId: "clip-a",
      shortFormSelectionStartMs: 100_000,
      shortFormSelectionEndMs: 110_000,
      enabled: true
    }]
  };
  const helpers = loadMainMappingHelpers(sourceFile, shortProject, {
    rootProject: root,
    workspaceMode: "short-form"
  });
  const plan = helpers.createVodCoveragePlan(shortProject);
  const clipIds = plan.clips.map((clip) => clip.id);
  assert.ok(clipIds.includes("clip-a"));
  assert.ok(clipIds.includes("clip-b"));
  assert.ok(clipIds.includes("clip-c"));
  assert.deepEqual(
    plan.editableRanges.find((range) => range.id === "clip-c"),
    { id: "clip-c", startMs: 140_000, endMs: 170_000 }
  );
  assert.equal(
    helpers.materializationHasCompatibleVodBaseAnchors(
      materializationFixture(),
      plan
    ),
    true,
    "기존 v2 clip 집합은 새 clip이 추가된 plan의 안전한 부분집합이어야 합니다."
  );
});

test("v2 source anchor가 현재 lineage 선택과 다르면 확장 base로 신뢰하지 않는다", async () => {
  const sourceFile = await editorMainAstPromise;
  const changed = projectFixture();
  const [clipA] = changed.clips as Array<Record<string, unknown>>;
  clipA!.selectionStartMs = 99_000;
  const helpers = loadMainMappingHelpers(sourceFile, changed);
  const plan = helpers.createVodCoveragePlan(changed);
  assert.equal(plan.expandsCurrentMaterialization, true);
  assert.equal(
    helpers.materializationCoversVodPlan(materializationFixture(), plan),
    false
  );
  assert.equal(
    helpers.materializationHasCompatibleVodBaseAnchors(
      materializationFixture(),
      plan
    ),
    false,
    "같은 ID라도 anchor가 바뀐 materialization을 base로 보내면 안 됩니다."
  );
});

test("핫로드 queue는 in-flight 중 반대 방향 요청을 단조 합치고 종료 경계 요청도 놓치지 않는다", async () => {
  const sourceFile = await editorMainAstPromise;
  const calls: Array<Record<string, unknown>> = [];
  const releases: Array<(loaded: boolean) => void> = [];
  const appliedTrimBatches: unknown[][] = [];
  const harness = loadVodHotLoadQueueHarness(
    sourceFile,
    async (options) => {
      calls.push(options);
      return new Promise<boolean>((resolve) => releases.push(resolve));
    },
    appliedTrimBatches
  );
  const first = harness.queueVodHotLoad({
    id: "clip-a",
    startMs: 60_000,
    endMs: 120_000
  }, {
    workspaceClipId: "clip-a",
    sourceClipId: "clip-a",
    side: "left",
    targetSourceMs: 70_000
  });
  await waitUntil(() => calls.length === 1, "첫 hot-load가 시작되지 않았습니다.");

  const second = harness.queueVodHotLoad({
    id: "clip-a",
    startMs: 90_000,
    endMs: 160_000
  }, {
    workspaceClipId: "clip-a",
    sourceClipId: "clip-a",
    side: "right",
    targetSourceMs: 150_000
  });
  releases.shift()!(false);
  await waitUntil(() => calls.length === 2, "superseded hot-load가 재계획되지 않았습니다.");
  assert.deepEqual(calls[1]!.requestedRanges, [{
    id: "clip-a",
    startMs: 60_000,
    endMs: 160_000
  }]);

  let third: Promise<boolean> | null = null;
  const thirdFromCompletionBoundary = first.then(() => {
    third = harness.queueVodHotLoad({
      id: "clip-b",
      startMs: 40_000,
      endMs: 80_000
    });
    return third;
  });
  releases.shift()!(true);
  assert.equal(await second, true);
  await waitUntil(
    () => calls.length === 3,
    "drain 종료와 finally 사이에 들어온 hot-load 요청을 놓쳤습니다."
  );
  assert.deepEqual(calls[2]!.requestedRanges, [{
    id: "clip-b",
    startMs: 40_000,
    endMs: 80_000
  }]);
  releases.shift()!(true);
  assert.equal(await thirdFromCompletionBoundary, true);
  assert.ok(third);
  assert.equal(await third!, true);
  assert.deepEqual(
    (appliedTrimBatches[0] as Array<Record<string, unknown>>)
      .map((intent) => intent.side)
      .sort(),
    ["left", "right"],
    "서로 다른 trim 의도도 superseded batch에서 함께 이어져야 합니다."
  );
});

test("trim overshoot는 gesture 종료 때 한 번만 확장하고 실패 전 중간 trim을 rollback한다", async () => {
  const sourceFile = await editorMainAstPromise;
  const bindClipTrim = namedFunction(sourceFile, "bindClipTrim");
  assert.equal(
    directCalls(bindClipTrim, "requestVodHotLoadForClip").length,
    1,
    "한 pointer gesture가 중복 hot-load를 시작하면 안 됩니다."
  );
  assert.ok(
    directCalls(bindClipTrim, "rollbackPointerHistory").length >= 1,
    "다운로드 전에는 clamp된 중간 trim을 원래 snapshot으로 되돌려야 합니다."
  );
  const rawTarget = variableDeclaration(bindClipTrim, "rawTargetSourceMs");
  assert.ok(rawTarget.initializer, "clamp 전 raw trim 의도를 보존해야 합니다.");
  const finish = variableDeclaration(bindClipTrim, "finish");
  assert.ok(
    directCalls(finish, "requestVodHotLoadForClip").length === 1,
    "hot-load는 pointermove가 아니라 gesture finish에서 시작해야 합니다."
  );
  const rollback = namedFunction(sourceFile, "rollbackPointerHistory");
  assert.ok(directCalls(rollback, "renderAll").length === 1);
  assert.ok(
    descendants(rollback).some((node) => (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === "undoStack"
      && node.expression.name.text === "pop"
    )),
    "취소된 overshoot gesture의 임시 undo 항목도 제거해야 합니다."
  );

  const renderTimeline = namedFunction(sourceFile, "renderTimeline");
  assert.ok(
    directCalls(renderTimeline, "requestVodHotLoadForClip").length >= 1,
    "키보드 trim도 로컬 경계에서 같은 확장 경로를 사용해야 합니다."
  );
});

test("새 media는 검증·브라우저 attach·저장까지 성공한 뒤 transport를 교체한다", async () => {
  const sourceFile = await editorMainAstPromise;
  const attach = namedFunction(sourceFile, "attachMediaSource");
  const body = attach.getText(sourceFile);
  const inspectIndex = body.indexOf("await inspectMediaFile(source)");
  const switchIndex = body.indexOf("switchedPreview = true");
  const previewIndex = body.indexOf("await loadPreviewMediaUrl(source, nextMediaUrl)");
  const saveIndex = body.indexOf("await saveActiveWorkspaceImmediately(");
  const commitIndex = body.indexOf("mediaFile = source");
  assert.ok(inspectIndex >= 0 && inspectIndex < previewIndex);
  assert.ok(
    switchIndex >= 0 && switchIndex < previewIndex,
    "metadata/error가 나도 이미 바뀐 video.src를 이전 transport로 복구해야 합니다."
  );
  assert.ok(previewIndex < saveIndex && saveIndex < commitIndex);
  assert.match(body, /project = previousProjectSnapshot;/u);
  assert.match(body, /rootProject = previousRootProjectSnapshot;/u);
  const rollbackLoadIndex = body.indexOf(
    "await loadPreviewMediaUrl(previousMediaSource!, previousMediaUrl)"
  );
  const rollbackSeekIndex = body.indexOf(
    "await seekTimeline(previousPlayheadMs, { play: previousWasPlaying })",
    rollbackLoadIndex
  );
  assert.ok(
    rollbackLoadIndex > saveIndex && rollbackLoadIndex < rollbackSeekIndex,
    "실패 rollback은 이전 URL metadata를 기다린 뒤 playhead/play 상태를 복원해야 합니다."
  );
  assert.doesNotMatch(body, /void seekTimeline\(previousPlayheadMs\)/u);
  assert.match(body, /sameMaterializedSourceVersion\(/u);
  assert.match(body, /rebindRuntimeTransportHistory\(project\.mediaAsset\)/u);
  assert.equal(
    directCalls(attach, "clearCaptionCheckpointsAcrossWorkspaces").length,
    2,
    "원본 identity가 바뀌면 active와 root의 main/short checkpoint를 모두 비워야 합니다."
  );
});

test("caption checkpoint identity는 v2 sourceVersion만 권위로 삼고 legacy 승격은 불일치 처리한다", async () => {
  const sourceFile = await editorMainAstPromise;
  const current = materializationFixture();
  const helpers = loadMainMappingHelpers(sourceFile, projectFixture());
  assert.equal(helpers.sameMaterializedSourceVersion({
    materialization: current
  }, current), true);
  assert.equal(helpers.sameMaterializedSourceVersion({
    materialization: current
  }, {
    ...current,
    source: { ...current.source, sourceVersionId: "d".repeat(64) }
  }), false);

  const { clipRanges: _clipRanges, ...legacyFields } = current;
  const legacy: ChzzkVodMaterialization = {
    ...legacyFields,
    schema: LEGACY_CHZZK_VOD_MATERIALIZATION_SCHEMA
  };
  assert.equal(helpers.sameMaterializedSourceVersion({
    materialization: legacy
  }, current), false);

  const prepare = namedFunction(sourceFile, "prepareChzzkVodMedia");
  const body = prepare.getText(sourceFile);
  assert.match(body, /reusableExpansionBase/u);
  assert.match(
    body,
    /extendingMaterialization[\s\S]*reusableExpansionBase[\s\S]*base:/u,
    "정확한 v2 anchor 부분집합만 hot-load base로 보내야 합니다."
  );
  const plan = helpers.createVodCoveragePlan(projectFixture(), [{
    id: "clip-a",
    startMs: 60_000,
    endMs: 130_000
  }]);
  assert.equal(
    helpers.materializationHasCompatibleVodBaseAnchors(current, plan),
    true
  );
  assert.equal(
    helpers.materializationHasCompatibleVodBaseAnchors(legacy, plan),
    false,
    "anchor를 증명할 수 없는 legacy receipt는 editor에서 cold v2로 승격해야 합니다."
  );
  assert.match(body, /shouldSendExactEditableRanges[\s\S]*editableRanges: coveragePlan\.editableRanges/u);
  assert.match(body, /materialization\.source\.platform !== expectedPlatform/u);
  assert.match(body, /materialization\.source\.contentType !== "vod"/u);
  assert.match(body, /materializationCoversVodPlan\(materialization, coveragePlan\)/u);

  const clearAcross = namedFunction(
    sourceFile,
    "clearCaptionCheckpointsAcrossWorkspaces"
  ).getText(sourceFile);
  assert.match(clearAcross, /candidateProject\.ai/u);
  assert.match(clearAcross, /candidateProject\.shortForm/u);
  assert.equal(
    (clearAcross.match(/captionCheckpoints: \[\]/gu) || []).length,
    2
  );

  const checkpointProject = projectFixture() as unknown as EditorProject;
  checkpointProject.ai = {
    ...(checkpointProject.ai || {}),
    captionCheckpoints: [{ clipId: "clip-a" }]
  } as EditorProject["ai"];
  checkpointProject.shortForm = createDefaultShortFormBranch();
  checkpointProject.shortForm.ai = {
    ...(checkpointProject.ai || {}),
    captionCheckpoints: [{ clipId: "short-a" }]
  } as EditorProject["ai"];
  const changedVersionAsset = structuredClone(checkpointProject.mediaAsset)!;
  const changedVersionMaterialization = structuredClone(current);
  changedVersionMaterialization.source.sourceVersionId = "d".repeat(64);
  changedVersionAsset.materialization = changedVersionMaterialization;
  const reboundChangedVersion = helpers.runtimeTransportBoundProjectSnapshot(
    checkpointProject,
    changedVersionAsset
  );
  assert.ok(reboundChangedVersion);
  assert.deepEqual(reboundChangedVersion.ai.captionCheckpoints, []);
  assert.deepEqual(reboundChangedVersion.shortForm.ai?.captionCheckpoints, []);

  const reboundSameVersion = helpers.runtimeTransportBoundProjectSnapshot(
    checkpointProject,
    structuredClone(checkpointProject.mediaAsset)
  );
  assert.ok(reboundSameVersion);
  assert.equal(reboundSameVersion.ai.captionCheckpoints.length, 1);
  assert.equal(reboundSameVersion.shortForm.ai?.captionCheckpoints.length, 1);

  const manualSnapshot = structuredClone(checkpointProject);
  manualSnapshot.mediaAsset = null;
  manualSnapshot.broadcastSession.alignmentOffsetMs = 10_000;
  manualSnapshot.clips[0]!.sourceStartMs = 105_000;
  manualSnapshot.clips[0]!.sourceEndMs = 125_000;
  manualSnapshot.clips[0]!.selectionStartMs = 100_000;
  manualSnapshot.clips[0]!.selectionEndMs = 110_000;
  manualSnapshot.ai.captionCheckpoints = [];
  manualSnapshot.shortForm.ai = null;
  const reboundManualSnapshot = helpers.runtimeTransportBoundProjectSnapshot(
    manualSnapshot,
    structuredClone(checkpointProject.mediaAsset)
  );
  assert.ok(reboundManualSnapshot);
  assert.equal(reboundManualSnapshot.broadcastSession.alignmentOffsetMs, 0);
  assert.equal(reboundManualSnapshot.clips[0]?.sourceStartMs, 95_000);
  assert.equal(reboundManualSnapshot.clips[0]?.sourceEndMs, 115_000);
});

test("세션 아카이브 VOD transport는 정확히 같은 v2 sourceVersion만 재사용한다", async () => {
  const sourceFile = await editorMainAstPromise;
  const current = materializationFixture();
  const helpers = loadMainMappingHelpers(sourceFile, projectFixture());
  const sourceMedia = { kind: "local-url" };
  const recovery = (materialization: unknown): Record<string, unknown> => ({
    mode: "redownload-vod",
    source: {
      platform: current.source.platform,
      contentType: "vod",
      contentId: current.source.contentId
    },
    materialization
  });

  assert.equal(
    await helpers.archiveRecoveryMatchesCurrentMedia(
      recovery(structuredClone(current)),
      sourceMedia
    ),
    true
  );

  const sameVersionDifferentPlan = structuredClone(current);
  sameVersionDifferentPlan.planFingerprint = "e".repeat(64);
  sameVersionDifferentPlan.materializationId = "e".repeat(32);
  assert.equal(
    await helpers.archiveRecoveryMatchesCurrentMedia(
      recovery(sameVersionDifferentPlan),
      sourceMedia
    ),
    true,
    "같은 원본 버전의 다른 compact plan은 이후 coverage 검증을 위해 transport 후보가 될 수 있어야 합니다."
  );

  const differentVersion = structuredClone(current);
  differentVersion.source.sourceVersionId = "d".repeat(64);
  assert.equal(
    await helpers.archiveRecoveryMatchesCurrentMedia(
      recovery(differentVersion),
      sourceMedia
    ),
    false,
    "같은 VOD ID라도 원본 버전이 다르면 현재 transport를 재사용하면 안 됩니다."
  );

  const { clipRanges: _clipRanges, ...legacyFields } = current;
  const legacy: ChzzkVodMaterialization = {
    ...legacyFields,
    schema: LEGACY_CHZZK_VOD_MATERIALIZATION_SCHEMA
  };
  assert.equal(
    await helpers.archiveRecoveryMatchesCurrentMedia(
      recovery(legacy),
      sourceMedia
    ),
    false,
    "sourceVersion identity를 권위 있게 증명하지 못하는 legacy receipt는 재사용하면 안 됩니다."
  );
  assert.equal(
    await helpers.archiveRecoveryMatchesCurrentMedia(
      recovery(null),
      sourceMedia
    ),
    false,
    "materialization receipt가 없는 복원본은 현재 transport와 결합하면 안 됩니다."
  );
});

test("임시저장 복원은 정확히 같은 materialized transport만 재사용하고 저장본의 transport 권한을 보존한다", async () => {
  const sourceFile = await editorMainAstPromise;
  const restore = namedFunction(sourceFile, "restoreSelectedLocalDraft");
  assert.equal(
    directCalls(restore, "currentRuntimeTransportBinding").length,
    1
  );
  assert.equal(
    directCalls(restore, "runtimeTransportBoundProjectSnapshot").length,
    1
  );
  assert.match(restore.getText(sourceFile), /mainWorkspaceUndoStack = \[\]/u);
  assert.match(restore.getText(sourceFile), /mainWorkspaceRedoStack = \[\]/u);
  const bindSnapshot = namedFunction(
    sourceFile,
    "runtimeTransportBoundProjectSnapshot"
  );
  assert.equal(
    directCalls(bindSnapshot, "normalizeMaterializedProjectSourceClock").length,
    1
  );
  assert.equal(
    directCalls(bindSnapshot, "applyMediaAlignmentOffset").length,
    1,
    "manual/detached snapshot을 materialized transport로 graft할 때는 작성 trim 전체를 source clock으로 변환해야 합니다."
  );
  assert.equal(directCalls(bindSnapshot, "projectFitsMaterializedTransport").length, 1);
  assert.equal(directCalls(bindSnapshot, "projectFitsManualTransport").length, 1);
  const restoreCall = directCalls(restore, "restoreLocalDraft")[0];
  assert.ok(restoreCall && ts.isIdentifier(restoreCall.arguments[1]!));
  assert.equal(
    restoreCall.arguments[0]!.getText(sourceFile),
    "currentPersistedProject",
    "쇼츠에서 복원하더라도 pre-restore draft에는 root-shaped 현재본을 저장해야 합니다."
  );
  assert.equal(
    restoreCall.arguments[1]!.getText(sourceFile),
    "exactDraft",
    "IndexedDB 복원에는 다른 runtime transport를 덧씌우지 않은 선택 저장본을 넘겨야 합니다."
  );
  assert.match(
    restore.getText(sourceFile),
    /undoStack = sameTransport\s*\? \[restoreIntoShortWorkspace[\s\S]*currentWorkspaceProject[\s\S]*currentPersistedProject\]\s*: \[\]/u,
    "복원 뒤 undo snapshot은 transport가 같을 때만 실제 workspace shape로 남고, 다른 영상이면 비워야 합니다."
  );

  const candidate = projectFixture();
  candidate.shortForm = {
    videoAssets: [{
      id: "short-a",
      sourceClipId: "clip-a",
      sourceSelectionStartMs: 100_000,
      sourceSelectionEndMs: 110_000,
      sourceStartMs: 92_000,
      sourceEndMs: 119_000,
      timelineStartMs: 0,
      timelineEndMs: 27_000
    }],
    sourceAudioAssets: []
  };
  const helpers = loadMainMappingHelpers(sourceFile, candidate);
  assert.equal(helpers.projectFitsMaterializedTransport(candidate), true);
  (candidate.shortForm as { videoAssets: Array<Record<string, unknown>> }).videoAssets[0]!
    .sourceStartMs = 80_000;
  assert.equal(
    helpers.projectFitsMaterializedTransport(candidate),
    false,
    "과거 쇼츠 trim이 최신 단조 coverage 밖이면 같은 mediaUrl로 복원하면 안 됩니다."
  );
});

test("미리보기 source↔compact clock은 stale materialization과 source gap에서 fail-closed한다", async () => {
  const sourceFile = await editorMainAstPromise;
  const validProject = projectFixture();
  const valid = loadMainMappingHelpers(sourceFile, validProject);
  assert.equal(valid.sourceMsToPreviewSeconds(100_000), 12);
  assert.equal(valid.previewSecondsToSourceMs(12), 100_000);
  assert.ok(Number.isNaN(valid.sourceMsToPreviewSeconds(80_000)));

  const staleProject = {
    ...validProject,
    clips: [{
      ...(validProject.clips as Array<Record<string, unknown>>)[0],
      sourceEndMs: 130_000
    }]
  };
  const stale = loadMainMappingHelpers(sourceFile, staleProject);
  assert.ok(Number.isNaN(stale.sourceMsToPreviewSeconds(100_000)));
  assert.ok(Number.isNaN(stale.previewSecondsToSourceMs(12)));

  const wrongSourceProject = {
    ...validProject,
    source: {
      ...(validProject.source as Record<string, unknown>),
      contentId: "99999999",
      canonicalUrl: "https://chzzk.naver.com/video/99999999"
    }
  };
  const wrongSource = loadMainMappingHelpers(sourceFile, wrongSourceProject);
  assert.equal(wrongSource.projectMaterialization(wrongSourceProject), null);
  assert.throws(
    () => wrongSource.projectForMediaEngine(wrongSourceProject),
    /로컬 편집 영상 매핑이 유효하지 않습니다/u,
    "source-bound materialization이 무효면 compact MP4에 원본 시각 project를 넘기면 안 됩니다."
  );
  assert.ok(Number.isNaN(wrongSource.sourceMsToPreviewSeconds(100_000)));
  assert.ok(Number.isNaN(wrongSource.previewSecondsToSourceMs(12)));
});

test("PCM·render는 compact clone을 소비하고 local access URL은 project 저장 경계 밖에 둔다", async () => {
  const [sourceFile, mediaEngineSourceFile] = await Promise.all([
    editorMainAstPromise,
    mediaEngineAstPromise
  ]);
  const captionGeneration = namedFunction(sourceFile, "generateCaptions");
  const extractCall = directCalls(captionGeneration, "extractClipPcm16k")[0];
  assert.ok(extractCall);
  assert.ok(extractCall.arguments[1] && ts.isCallExpression(extractCall.arguments[1]));
  assert.ok(ts.isIdentifier(extractCall.arguments[1].expression));
  assert.equal(extractCall.arguments[1].expression.text, "clipForMediaEngine");

  const exportFunction = namedFunction(sourceFile, "exportVideo");
  const projectCloneCall = directCalls(exportFunction, "projectForMediaEngine")[0];
  assert.ok(projectCloneCall && ts.isIdentifier(projectCloneCall.arguments[0]!));
  assert.equal(projectCloneCall.arguments[0].text, "outputProject");
  for (const callName of ["getPreferredOutputProfile", "renderProjectVideo"]) {
    const call = directCalls(exportFunction, callName)[0];
    assert.ok(call && ts.isIdentifier(call.arguments[1]!));
    assert.equal(
      call.arguments[1].text,
      "renderProject",
      `${callName}은 semantic 원본 project가 아니라 compact mapping clone을 사용해야 합니다.`
    );
  }

  const inspectFunction = namedFunction(mediaEngineSourceFile, "inspectMediaFile");
  const returnedMetadata = descendants(inspectFunction)
    .filter((node): node is ts.ReturnStatement => ts.isReturnStatement(node))
    .map((statement) => statement.expression)
    .find((expression): expression is ts.ObjectLiteralExpression => (
      expression !== undefined && ts.isObjectLiteralExpression(expression)
    ));
  assert.ok(returnedMetadata, "inspectMediaFile의 저장용 metadata 반환값이 없습니다.");
  const metadataKeys = new Set(returnedMetadata.properties.map(propertyName).filter(Boolean));
  assert.ok(metadataKeys.has("name"));
  assert.ok(metadataKeys.has("durationMs"));
  for (const forbidden of ["url", "access", "token", "artifactPath", "kind"]) {
    assert.equal(
      metadataKeys.has(forbidden),
      false,
      `runtime 전용 ${forbidden} 값이 media metadata에 섞이면 안 됩니다.`
    );
  }

  const attachFunction = namedFunction(sourceFile, "attachMediaSource");
  const nextProject = variableDeclaration(attachFunction, "nextProject");
  const nextProjectInitializer = nextProject.initializer
    && ts.isAsExpression(nextProject.initializer)
    ? nextProject.initializer.expression
    : nextProject.initializer;
  assert.ok(nextProjectInitializer && ts.isObjectLiteralExpression(nextProjectInitializer));
  const mediaAsset = objectProperty(nextProjectInitializer, "mediaAsset");
  assert.ok(mediaAsset && ts.isPropertyAssignment(mediaAsset));
  assert.ok(ts.isObjectLiteralExpression(mediaAsset.initializer));
  const persistedKeys = new Set(
    descendants(mediaAsset.initializer)
      .filter((node): node is ts.ObjectLiteralElementLike => (
        ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)
      ))
      .map(propertyName)
      .filter(Boolean)
  );
  for (const required of [
    "fileHandleStored",
    "mediaMode",
    "materialization",
    "rightsConfirmation"
  ]) {
    assert.ok(persistedKeys.has(required), `${required} semantic field가 저장되지 않습니다.`);
  }
  for (const forbidden of ["url", "access", "token", "artifactPath", "source"]) {
    assert.equal(
      persistedKeys.has(forbidden),
      false,
      `${forbidden} runtime/secret field를 project에 저장하면 안 됩니다.`
    );
  }
  const saveCalls = directCalls(
    attachFunction,
    "saveActiveWorkspaceImmediately"
  );
  assert.equal(saveCalls.length, 1);
  assert.equal(saveCalls[0]?.arguments.length, 2);
  assert.ok(ts.isIdentifier(saveCalls[0]!.arguments[0]!));
  assert.equal(saveCalls[0]!.arguments[0]!.getText(sourceFile), "nextProject");
  assert.equal(
    saveCalls[0]!.arguments[1]!.getText(sourceFile),
    "identitySafeRootProject"
  );
  assert.ok(
    directCalls(attachFunction, "waitForProjectSaves").length >= 1,
    "기존 저장이 끝난 뒤 새 transport snapshot을 저장해야 합니다."
  );
  assert.ok(
    directCalls(attachFunction, "rebindRuntimeTransportHistory").length === 1,
    "undo/redo snapshot에는 현재 manual/materialized transport를 graft해야 합니다."
  );
});
