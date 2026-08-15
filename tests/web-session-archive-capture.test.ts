import assert from "node:assert/strict";
import test from "node:test";

import {
  createEditorProjectFromCapture
} from "../src/lib/editor-core.js";
import type {
  CaptureState,
  EditorProject,
  SourceRecord
} from "../src/lib/editor-core.js";
import {
  buildSessionArchive,
  stringifySessionArchive
} from "../src/lib/session-archive.js";
import type {
  SessionArchiveMediaRecovery
} from "../src/lib/session-archive.js";
import {
  sessionArchiveCaptureFromJson
} from "../src/web/session-archive-capture.js";

const REMOTE_CASES = [
  {
    platform: "CHZZK",
    contentId: "14514980",
    canonicalUrl: "https://chzzk.naver.com/video/14514980"
  },
  {
    platform: "YOUTUBE",
    contentId: "M7lc1UVf-VE",
    canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE"
  },
  {
    platform: "SOOP",
    contentId: "169475287",
    canonicalUrl: "https://vod.sooplive.com/player/169475287"
  }
] as const;

function sourceRecord(
  value: (typeof REMOTE_CASES)[number]
): SourceRecord {
  return {
    platform: value.platform,
    contentType: "vod",
    contentId: value.contentId,
    canonicalUrl: value.canonicalUrl,
    url: value.canonicalUrl,
    broadcastTitle: `${value.platform} 복원 테스트`
  };
}

function captureProject(
  source: SourceRecord,
  segments: CaptureState["segments"] = [
    {
      id: "selection-a",
      startSeconds: 80.5,
      endSeconds: 95.001,
      description: "첫 구간"
    },
    {
      id: "selection-b",
      startSeconds: 3_600.007,
      endSeconds: 3_621.999,
      description: "둘째 구간"
    }
  ]
): EditorProject {
  return createEditorProjectFromCapture({
    source,
    projectName: `${String(source.platform)} 과거 세션`,
    segments
  }, { id: `archive-${String(source.platform).toLowerCase()}` });
}

function remoteRecovery(
  source: SourceRecord
): SessionArchiveMediaRecovery {
  return {
    schema: "kirinuki-media-recovery/v1",
    mode: "redownload-vod",
    source: {
      platform: source.platform as "CHZZK" | "YOUTUBE" | "SOOP",
      contentType: "vod",
      contentId: String(source.contentId),
      canonicalUrl: String(source.canonicalUrl)
    },
    localMedia: null,
    materialization: null,
    vodBytesIncluded: false
  };
}

async function archiveJson(
  project: EditorProject,
  recovery = remoteRecovery(project.source)
): Promise<string> {
  const archive = await buildSessionArchive({
    rootProject: project,
    exportKind: "main",
    exportSnapshot: { projectId: project.id },
    mediaRecovery: recovery,
    resolveImageAssetBlob: async () => null,
    createdAt: "2026-08-13T00:00:00.000Z"
  });
  return stringifySessionArchive(archive);
}

test("CHZZK·YouTube·SOOP 복원 JSON에서 canonical 링크와 정확한 밀리초 구간을 읽는다", async () => {
  for (const value of REMOTE_CASES) {
    const source = sourceRecord(value);
    const imported = await sessionArchiveCaptureFromJson(
      await archiveJson(captureProject(source))
    );
    assert.equal(imported.sourceUrl, value.canonicalUrl);
    assert.equal(imported.source.platform, value.platform);
    assert.equal(imported.projectName, `${value.platform} 과거 세션`);
    assert.deepEqual(imported.segments, [
      { startSeconds: 80.5, endSeconds: 95.001, note: "첫 구간" },
      { startSeconds: 3_600.007, endSeconds: 3_621.999, note: "둘째 구간" }
    ]);
  }
});

test("쇼츠 exportSnapshot 대신 rootProject의 활성 본편 컷만 순서대로 읽는다", async () => {
  const source = sourceRecord(REMOTE_CASES[0]);
  const project = captureProject(source, [
    { id: "keep", startSeconds: 1, endSeconds: 2, description: "유지" },
    { id: "disabled", startSeconds: 3, endSeconds: 4, description: "비활성" },
    { id: "canvas", startSeconds: 5, endSeconds: 6, description: "합성 clock" }
  ]);
  project.clips[1]!.enabled = false;
  project.clips[2]!.shortFormCanvasClock = true;
  const archive = await buildSessionArchive({
    rootProject: project,
    exportKind: "short-form",
    exportSnapshot: {
      clips: [{ sourceStartMs: 999_000, sourceEndMs: 1_000_000 }]
    },
    mediaRecovery: remoteRecovery(source),
    resolveImageAssetBlob: async () => null
  });
  const imported = await sessionArchiveCaptureFromJson(
    await stringifySessionArchive(archive)
  );
  assert.deepEqual(imported.segments, [
    { startSeconds: 1, endSeconds: 2, note: "유지" }
  ]);
});

test("root 원본과 remote recovery identity가 다르면 무결성 통과 뒤에도 거부한다", async () => {
  const youtube = sourceRecord(REMOTE_CASES[1]);
  const chzzk = sourceRecord(REMOTE_CASES[0]);
  await assert.rejects(
    sessionArchiveCaptureFromJson(
      await archiveJson(captureProject(youtube), remoteRecovery(chzzk))
    ),
    /원본 영상 링크와 미디어 복구 identity/u
  );
});

test("변조·미래 schema·활성 컷 없음은 현재 입력으로 승격하지 않는다", async () => {
  const source = sourceRecord(REMOTE_CASES[2]);
  const valid = await archiveJson(captureProject(source));
  const tampered = valid.replace("SOOP 과거 세션", "변조된 과거 세션");
  await assert.rejects(
    sessionArchiveCaptureFromJson(tampered),
    /SHA-256 무결성/u
  );

  const future = JSON.parse(valid) as Record<string, unknown>;
  future.schema = "kirinuki-session-archive/v2";
  await assert.rejects(
    sessionArchiveCaptureFromJson(JSON.stringify(future)),
    /지원하지 않는 세션 복원/u
  );

  const disabled = captureProject(source);
  disabled.clips.forEach((clip) => {
    clip.enabled = false;
  });
  await assert.rejects(
    sessionArchiveCaptureFromJson(await archiveJson(disabled)),
    /활성 본편 구간/u
  );
});
