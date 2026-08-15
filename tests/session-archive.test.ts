import assert from "node:assert/strict";
import test from "node:test";

import {
  MEDIA_RECOVERY_SCHEMA,
  SESSION_ARCHIVE_MAX_IMAGE_ASSETS,
  SESSION_ARCHIVE_MAX_IMAGE_ASSET_BYTES,
  SESSION_ARCHIVE_MAX_MATERIALIZATION_JSON_BYTES,
  SESSION_ARCHIVE_MAX_TOTAL_IMAGE_ASSET_BYTES,
  SESSION_ARCHIVE_SCHEMA,
  buildSessionArchive,
  normalizeSessionArchive,
  normalizeSessionArchiveMediaRecovery,
  parseSessionArchiveJson,
  restoreSessionArchiveImageBlobs,
  restoreSessionArchiveProject,
  stringifySessionArchive
} from "../src/lib/session-archive.js";
import type {
  SessionArchive,
  SessionArchiveMediaRecovery
} from "../src/lib/session-archive.js";
import type {
  EditorProject
} from "../src/lib/editor-core.js";

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d
]);

function imageAsset(blobKey = "asset/logo") {
  return {
    id: "logo",
    clipId: "clip-1",
    startOffsetMs: 0,
    endOffsetMs: 1_000,
    name: "logo.png",
    mimeType: "image/png",
    source: { kind: "blob-key", value: blobKey },
    sourceUrl: "",
    x: 0.5,
    y: 0.5,
    scale: 1,
    opacity: 1,
    naturalWidth: 32,
    naturalHeight: 32
  };
}

function projectFixture(): EditorProject {
  return {
    schema: "chzzk-kirinuki-editor/v3",
    id: "project-stable-id",
    name: "복원 테스트",
    source: {
      platform: "YOUTUBE",
      contentType: "vod",
      contentId: "abcdefghijk",
      canonicalUrl: "https://www.youtube.com/watch?v=abcdefghijk"
    },
    broadcastSession: {},
    mediaAsset: null,
    clips: [],
    suppressedSelections: [],
    imageAssets: [imageAsset()],
    subtitles: [],
    subtitleLaneCount: 2,
    recentSubtitleColors: [],
    audioRegions: [],
    shortForm: {
      imageAssets: [imageAsset()],
      nestedRecoveryExtension: {
        retained: "full-root-project-extension",
        usagePolicySession: { confirmationText: "must-not-leak" }
      }
    },
    subtitleDefaults: {},
    ai: {
      provider: "local",
      model: "tiny",
      status: "idle",
      progress: 0,
      warnings: [],
      speakerColors: {},
      captionCheckpoints: [],
      accessToken: "must-not-leak-token"
    },
    history: {
      undo: [{ name: "private-old-state" }],
      redo: [{ name: "private-new-state" }]
    },
    playheadMs: 321,
    usagePolicyAttestation: {
      rightsHolder: "must-not-leak-holder"
    },
    rightsConfirmation: {
      confirmedAt: "2026-08-12T00:00:00.000Z"
    }
  } as unknown as EditorProject;
}

function recoveryFixture(): SessionArchiveMediaRecovery & {
  materialization: Record<string, unknown>;
} {
  return {
    schema: MEDIA_RECOVERY_SCHEMA,
    mode: "redownload-vod",
    source: {
      platform: "YOUTUBE",
      contentType: "vod",
      contentId: "abcdefghijk",
      canonicalUrl: "https://www.youtube.com/watch?v=abcdefghijk"
    },
    localMedia: {
      name: "prepared.mp4",
      mimeType: "video/mp4",
      sizeBytes: 123_456,
      lastModifiedMs: 1_786_400_000_000,
      sha256: null
    },
    materialization: {
      schema: "materialization/v2",
      coverage: [{ startMs: 1_000, endMs: 11_000 }],
      artifact: { sizeBytes: 123_456 },
      rightsConfirmation: { private: "must-not-leak-rights" },
      accessToken: "must-not-leak-materialization-token",
      vodBytes: "must-not-leak-vod-body",
      bytes: [1, 2, 3, 4]
    },
    vodBytesIncluded: false
  };
}

async function archiveFixture(): Promise<{
  archive: SessionArchive;
  resolveCalls: string[];
}> {
  const resolveCalls: string[] = [];
  const archive = await buildSessionArchive({
    rootProject: projectFixture(),
    exportKind: "short-form",
    exportSnapshot: {
      project: {
        imageAssets: [imageAsset()],
        history: { undo: ["must-not-leak"], redo: [] },
        apiKey: "must-not-leak-api-key"
      },
      output: { width: 1080, height: 1920 }
    },
    mediaRecovery: recoveryFixture(),
    resolveImageAssetBlob: async (blobKey) => {
      resolveCalls.push(blobKey);
      return new Blob([PNG_BYTES], { type: "image/png" });
    },
    createdAt: "2026-08-12T00:00:00.000Z"
  });
  return { archive, resolveCalls };
}

test("세션 아카이브는 전체 루트·출력 스냅샷과 dedupe한 이미지 Blob을 무결성 정보와 함께 만든다", async () => {
  const { archive, resolveCalls } = await archiveFixture();

  assert.equal(archive.schema, SESSION_ARCHIVE_SCHEMA);
  assert.equal(archive.exportKind, "short-form");
  assert.equal(archive.rootProject.id, "project-stable-id");
  assert.equal(
    (archive.rootProject.shortForm as unknown as Record<string, unknown>)
      .nestedRecoveryExtension instanceof Object,
    true,
    "알 수 없는 정상 프로젝트 확장 필드도 전체 루트의 일부로 보존합니다."
  );
  assert.deepEqual(resolveCalls, ["asset/logo"]);
  assert.equal(archive.imageAssets.length, 1);
  assert.equal(archive.imageAssets[0]?.blobKey, "asset/logo");
  assert.equal(archive.imageAssets[0]?.mimeType, "image/png");
  assert.equal(archive.imageAssets[0]?.sizeBytes, PNG_BYTES.byteLength);
  assert.match(archive.imageAssets[0]?.sha256 || "", /^[a-f0-9]{64}$/u);
  assert.match(archive.integrity.sha256, /^[a-f0-9]{64}$/u);

  const serialized = JSON.stringify(archive);
  for (const forbidden of [
    "usagePolicy",
    "rightsConfirmation",
    "must-not-leak",
    "accessToken",
    "apiKey",
    '"vodBytes":',
    "private-old-state",
    "private-new-state",
    '"undo"',
    '"redo"'
  ]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden}가 남았습니다.`);
  }
  assert.deepEqual(archive.mediaRecovery.materialization, {
    schema: "materialization/v2",
    coverage: [{ startMs: 1_000, endMs: 11_000 }],
    artifact: { sizeBytes: 123_456 }
  });
  assert.equal(archive.mediaRecovery.vodBytesIncluded, false);
});

test("JSON round-trip과 복원은 프로젝트 ID를 보존하고 이미지 Blob을 다시 만든다", async () => {
  const { archive } = await archiveFixture();
  const json = await stringifySessionArchive(archive);
  const parsed = await parseSessionArchiveJson(json);
  const restoredProject = await restoreSessionArchiveProject(parsed);
  const restoredBlobs = await restoreSessionArchiveImageBlobs(parsed);

  assert.equal(restoredProject.id, "project-stable-id");
  assert.equal(restoredProject.history, undefined);
  assert.equal("rightsConfirmation" in restoredProject, false);
  assert.equal("usagePolicyAttestation" in restoredProject, false);
  const restoredBlob = restoredBlobs.get("asset/logo");
  assert.ok(restoredBlob);
  assert.equal(restoredBlob.type, "image/png");
  assert.deepEqual(
    new Uint8Array(await restoredBlob.arrayBuffer()),
    PNG_BYTES
  );
});

test("전체 payload는 일반 필드와 per-use 필드 어느 쪽이 바뀌어도 복원을 거부한다", async () => {
  const { archive } = await archiveFixture();
  const tampered = structuredClone(archive) as SessionArchive;
  tampered.rootProject.name = "공격자가 바꾼 이름";
  await assert.rejects(
    normalizeSessionArchive(tampered),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === "SESSION_ARCHIVE_INTEGRITY_FAILED"
    )
  );

  const injected = structuredClone(archive) as SessionArchive;
  Object.assign(injected.rootProject, {
    usagePolicyAttestation: { evidenceReference: "injected" },
    history: { undo: ["injected"], redo: [] },
    refreshToken: "injected"
  });
  await assert.rejects(
    normalizeSessionArchive(injected),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === "SESSION_ARCHIVE_INTEGRITY_FAILED"
    )
  );
});

test("이미지 Base64·크기·SHA-256·MIME 위변조를 각각 거부한다", async () => {
  const { archive } = await archiveFixture();

  const badBase64 = structuredClone(archive) as SessionArchive;
  (badBase64.imageAssets[0] as { dataBase64: string }).dataBase64 = "not base64!";
  await assert.rejects(normalizeSessionArchive(badBase64), /Base64/u);

  const badSize = structuredClone(archive) as SessionArchive;
  (badSize.imageAssets[0] as { sizeBytes: number }).sizeBytes += 1;
  await assert.rejects(normalizeSessionArchive(badSize), /바이트 수/u);

  const badHash = structuredClone(archive) as SessionArchive;
  (badHash.imageAssets[0] as { sha256: string }).sha256 = "0".repeat(64);
  await assert.rejects(
    normalizeSessionArchive(badHash),
    /SHA-256 무결성/u
  );

  const badMime = structuredClone(archive) as SessionArchive;
  (badMime.imageAssets[0] as { mimeType: string }).mimeType = "image/jpeg";
  await assert.rejects(normalizeSessionArchive(badMime), /Blob 참조/u);
});

test("Blob resolver 실패·실제 이미지 MIME 불일치·개별 크기 상한을 fail-closed 처리한다", async () => {
  const base = {
    rootProject: projectFixture(),
    exportKind: "main" as const,
    exportSnapshot: { imageAssets: [] },
    mediaRecovery: recoveryFixture()
  };
  await assert.rejects(
    buildSessionArchive({
      ...base,
      resolveImageAssetBlob: async () => null
    }),
    /Blob을 읽지 못했습니다/u
  );
  await assert.rejects(
    buildSessionArchive({
      ...base,
      resolveImageAssetBlob: async () => new Blob(
        [new Uint8Array([0xff, 0xd8, 0xff, 0x00])],
        { type: "image/jpeg" }
      )
    }),
    /MIME 유형이 프로젝트와 다릅니다/u
  );
  const { archive } = await archiveFixture();
  const oversized = structuredClone(archive) as SessionArchive;
  (oversized.imageAssets[0] as { sizeBytes: number }).sizeBytes =
    SESSION_ARCHIVE_MAX_IMAGE_ASSET_BYTES + 1;
  await assert.rejects(normalizeSessionArchive(oversized), /개별 허용 크기/u);
});

test("미디어 복구 설명은 VOD 본문 없이 재다운로드·파일 재연결에 필요한 메타데이터만 허용한다", () => {
  assert.deepEqual(
    normalizeSessionArchiveMediaRecovery({
      schema: MEDIA_RECOVERY_SCHEMA,
      mode: "reconnect-local-file",
      source: {
        platform: "LOCAL",
        contentType: "file",
        contentId: "",
        canonicalUrl: ""
      },
      localMedia: {
        name: "original.mp4",
        mimeType: "",
        sizeBytes: 99,
        lastModifiedMs: 123,
        sha256: null
      },
      materialization: null,
      vodBytesIncluded: false
    }),
    {
      schema: MEDIA_RECOVERY_SCHEMA,
      mode: "reconnect-local-file",
      source: {
        platform: "LOCAL",
        contentType: "file",
        contentId: "",
        canonicalUrl: ""
      },
      localMedia: {
        name: "original.mp4",
        mimeType: "",
        sizeBytes: 99,
        lastModifiedMs: 123,
        sha256: null
      },
      materialization: null,
      vodBytesIncluded: false
    }
  );
  const sampleSha256 = "ab".repeat(32);
  const sampledRecovery = normalizeSessionArchiveMediaRecovery({
    schema: MEDIA_RECOVERY_SCHEMA,
    mode: "reconnect-local-file",
    source: {
      platform: "LOCAL",
      contentType: "file",
      contentId: "",
      canonicalUrl: ""
    },
    localMedia: {
      name: "original.mp4",
      mimeType: "video/mp4",
      sizeBytes: 99,
      lastModifiedMs: 123,
      sha256: null,
      sampleSha256
    },
    materialization: null,
    vodBytesIncluded: false
  });
  assert.equal(sampledRecovery.localMedia?.sampleSha256, sampleSha256);
  assert.throws(
    () => normalizeSessionArchiveMediaRecovery({
      ...sampledRecovery,
      localMedia: {
        ...sampledRecovery.localMedia,
        sampleSha256: "not-a-sha256"
      }
    }),
    /SHA-256/u
  );
  assert.throws(
    () => normalizeSessionArchiveMediaRecovery({
      schema: MEDIA_RECOVERY_SCHEMA,
      mode: "redownload-vod",
      source: recoveryFixture().source,
      localMedia: null,
      materialization: null,
      vodBytesIncluded: true
    }),
    /VOD 본문/u
  );
  assert.throws(
    () => normalizeSessionArchiveMediaRecovery({
      schema: MEDIA_RECOVERY_SCHEMA,
      mode: "reconnect-local-file",
      source: null,
      localMedia: null,
      materialization: null,
      vodBytesIncluded: false
    }),
    /서로 맞지 않습니다/u
  );
});

test("미래 schema·알 수 없는 top-level 필드·이미지 개수 상한을 거부한다", async () => {
  const { archive } = await archiveFixture();
  await assert.rejects(
    normalizeSessionArchive({ ...archive, schema: "kirinuki-session-archive/v2" }),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === "UNSUPPORTED_SESSION_ARCHIVE_SCHEMA"
    )
  );
  await assert.rejects(
    normalizeSessionArchive({ ...archive, futureField: true }),
    /지원하지 않는 필드/u
  );
  await assert.rejects(
    normalizeSessionArchive({
      ...archive,
      imageAssets: Array.from(
        { length: SESSION_ARCHIVE_MAX_IMAGE_ASSETS + 1 },
        () => archive.imageAssets[0]
      )
    }),
    /최대/u
  );
});

test("이미지 전체 바이트와 materialization 설명의 총량 상한을 선검증한다", async () => {
  const { archive } = await archiveFixture();
  const oversizedTotal = structuredClone(archive) as SessionArchive;
  const keys = ["asset/one", "asset/two", "asset/three"];
  oversizedTotal.rootProject.imageAssets = keys.map((key) => imageAsset(key));
  oversizedTotal.rootProject.shortForm.imageAssets = [];
  oversizedTotal.imageAssets = keys.map((key) => ({
    ...(archive.imageAssets[0] as NonNullable<SessionArchive["imageAssets"][number]>),
    blobKey: key,
    sizeBytes: SESSION_ARCHIVE_MAX_IMAGE_ASSET_BYTES
  }));
  assert.equal(
    SESSION_ARCHIVE_MAX_IMAGE_ASSET_BYTES * keys.length
      > SESSION_ARCHIVE_MAX_TOTAL_IMAGE_ASSET_BYTES,
    true
  );
  await assert.rejects(
    normalizeSessionArchive(oversizedTotal),
    /전체 크기/u
  );

  const recovery = recoveryFixture();
  recovery.materialization = {
    descriptor: "x".repeat(SESSION_ARCHIVE_MAX_MATERIALIZATION_JSON_BYTES + 1)
  };
  assert.throws(
    () => normalizeSessionArchiveMediaRecovery(recovery),
    /허용 크기/u
  );
});
