import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ORIGIN_STORAGE_MIGRATION_MAX_JSON_BYTES,
  ORIGIN_STORAGE_MIGRATION_SCHEMA,
  ORIGIN_STORAGE_MIGRATION_TARGET_ORIGIN,
  OriginStorageMigrationError,
  buildOriginStorageMigration,
  parseOriginStorageMigration,
  parseOriginStorageMigrationJson,
  serializeOriginStorageMigration
} from "../src/lib/origin-storage-migration.js";

const SOURCE_ORIGIN =
  "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const TRANSFER_ID = "A".repeat(43);

test("origin importer와 project store는 같은 DB 버전과 checkpoint store를 생성한다", async () => {
  const [projectStoreSource, importerSource] = await Promise.all([
    readFile(
      new URL("../src/editor/project-store.ts", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL("../src/editor/origin-storage-migration.ts", import.meta.url),
      "utf8"
    )
  ]);
  const projectStoreVersion = /const DATABASE_VERSION = (\d+);/u.exec(
    projectStoreSource
  )?.[1];
  const importerVersion = /const DATABASE_VERSION = (\d+);/u.exec(
    importerSource
  )?.[1];
  assert.equal(projectStoreVersion, "5");
  assert.equal(importerVersion, projectStoreVersion);
  for (const source of [projectStoreSource, importerSource]) {
    assert.match(
      source,
      /const EDITING_SESSION_CHECKPOINTS = "editing-session-checkpoints";/u
    );
    assert.match(
      source,
      /createObjectStore\(EDITING_SESSION_CHECKPOINTS, \{\s*keyPath: "projectId"/u
    );
  }
});

function project(id = "project-1") {
  return {
    id,
    name: "테스트 프로젝트",
    source: {
      platform: "CHZZK",
      contentId: "14514980"
    },
    imageAssets: [{
      id: "image-1",
      source: { kind: "blob-key", value: "image-1" }
    }]
  };
}

function draft(projectId = "project-1") {
  return {
    schema: "chzzk-kirinuki-local-draft/v1",
    id: "draft-1",
    projectId,
    createdAt: "2026-08-12T01:02:03.000Z",
    createdAtMs: 1_755_000_000_000,
    reason: "manual",
    restoredFromDraftId: null,
    mediaHandleBinding: {
      kind: "file-system-file-handle",
      handle: {
        name: "must-stay-browser-local.mp4",
        getFile() {
          throw new Error("portable migration must not inspect this handle");
        }
      }
    },
    project: project(projectId)
  };
}

async function validEnvelope() {
  return buildOriginStorageMigration({
    sourceOrigin: SOURCE_ORIGIN,
    databaseName: "chzzk-kirinuki-studio",
    databaseVersion: 4,
    projects: [project()],
    localDrafts: [draft()],
    imageAssets: [{
      key: ["project-1", "image-1"],
      blob: new Blob([new Uint8Array([1, 2, 3, 4])], {
        type: "image/png"
      })
    }],
    transferId: TRANSFER_ID,
    createdAt: "2026-08-12T01:02:03.000Z"
  });
}

test("origin migration round-trips only portable stores and verifies image bytes", async () => {
  const envelope = await validEnvelope();
  assert.equal(envelope.schema, ORIGIN_STORAGE_MIGRATION_SCHEMA);
  assert.deepEqual(Object.keys(envelope.stores).sort(), [
    "imageAssets",
    "localDrafts",
    "projects"
  ]);
  assert.equal(envelope.target.origin, ORIGIN_STORAGE_MIGRATION_TARGET_ORIGIN);
  assert.equal("mediaHandles" in envelope.stores, false);
  assert.equal("shortVideoCaches" in envelope.stores, false);
  assert.equal(
    "mediaHandleBinding" in envelope.stores.localDrafts[0]!,
    false
  );

  const parsed = await parseOriginStorageMigrationJson(
    serializeOriginStorageMigration(envelope),
    { expectedSourceOrigin: SOURCE_ORIGIN }
  );
  assert.equal(parsed.envelope.transferId, TRANSFER_ID);
  assert.equal(parsed.projects.length, 1);
  assert.equal(parsed.localDrafts.length, 1);
  assert.equal(parsed.imageAssets.length, 1);
  assert.deepEqual(parsed.imageAssets[0]?.key, ["project-1", "image-1"]);
  assert.equal(parsed.imageAssets[0]?.blob.type, "image/png");
  assert.deepEqual(
    [...new Uint8Array(await parsed.imageAssets[0]!.blob.arrayBuffer())],
    [1, 2, 3, 4]
  );
});

test("origin migration rejects changed image content before import", async () => {
  const envelope = structuredClone(await validEnvelope());
  envelope.stores.imageAssets[0]!.dataBase64 = "CQgHBg==";
  await assert.rejects(
    () => parseOriginStorageMigration(envelope),
    (error: unknown) => (
      error instanceof OriginStorageMigrationError
      && /무결성/u.test(error.message)
    )
  );
});

test("origin migration rejects an extra cache or handle store", async () => {
  const envelope = structuredClone(await validEnvelope()) as unknown as {
    stores: Record<string, unknown>;
  };
  envelope.stores["shortVideoCaches"] = [];
  await assert.rejects(
    () => parseOriginStorageMigration(envelope),
    /지원하지 않는 필드.*shortVideoCaches/u
  );

  delete envelope.stores["shortVideoCaches"];
  envelope.stores["mediaHandles"] = [];
  await assert.rejects(
    () => parseOriginStorageMigration(envelope),
    /지원하지 않는 필드.*mediaHandles/u
  );
});

test("origin migration is bound to exact extension and localhost origins", async () => {
  const envelope = await validEnvelope();
  await assert.rejects(
    () => parseOriginStorageMigration(envelope, {
      expectedSourceOrigin:
        "chrome-extension://pppppppppppppppppppppppppppppppp"
    }),
    /현재 빌드와 다릅니다/u
  );
  await assert.rejects(
    () => parseOriginStorageMigration(envelope, {
      expectedTargetOrigin: "http://localhost:4320"
    }),
    /고정된 Kirinuki loopback origin/u
  );
});

test("origin migration rejects orphan drafts and image assets", async () => {
  await assert.rejects(
    () => buildOriginStorageMigration({
      sourceOrigin: SOURCE_ORIGIN,
      databaseName: "chzzk-kirinuki-studio",
      databaseVersion: 4,
      projects: [project()],
      localDrafts: [draft("other-project")],
      imageAssets: [],
      transferId: TRANSFER_ID,
      createdAt: "2026-08-12T01:02:03.000Z"
    }),
    /알 수 없는 프로젝트/u
  );
  await assert.rejects(
    () => buildOriginStorageMigration({
      sourceOrigin: SOURCE_ORIGIN,
      databaseName: "chzzk-kirinuki-studio",
      databaseVersion: 4,
      projects: [project()],
      localDrafts: [],
      imageAssets: [{
        key: ["other-project", "image-1"],
        blob: new Blob([new Uint8Array([1])], { type: "image/png" })
      }],
      transferId: TRANSFER_ID,
      createdAt: "2026-08-12T01:02:03.000Z"
    }),
    /알 수 없는 프로젝트/u
  );
});

test("origin migration rejects non-JSON project state and unsafe keys", async () => {
  await assert.rejects(
    () => buildOriginStorageMigration({
      sourceOrigin: SOURCE_ORIGIN,
      databaseName: "chzzk-kirinuki-studio",
      databaseVersion: 4,
      projects: [{ ...project(), accidentalHandle: new Blob(["file"]) }],
      localDrafts: [],
      imageAssets: [],
      transferId: TRANSFER_ID,
      createdAt: "2026-08-12T01:02:03.000Z"
    }),
    /Blob·파일 핸들·바이너리/u
  );

  const unsafe = JSON.parse(
    `{"id":"project-1","__proto__":{"polluted":true}}`
  ) as unknown;
  await assert.rejects(
    () => buildOriginStorageMigration({
      sourceOrigin: SOURCE_ORIGIN,
      databaseName: "chzzk-kirinuki-studio",
      databaseVersion: 4,
      projects: [unsafe],
      localDrafts: [],
      imageAssets: [],
      transferId: TRANSFER_ID,
      createdAt: "2026-08-12T01:02:03.000Z"
    }),
    /안전하지 않은 객체 필드/u
  );
});

test("origin migration enforces its explicit JSON body ceiling before parse", async () => {
  await assert.rejects(
    () => parseOriginStorageMigrationJson(
      " ".repeat(ORIGIN_STORAGE_MIGRATION_MAX_JSON_BYTES + 1)
    ),
    (error: unknown) => (
      error instanceof OriginStorageMigrationError
      && error.code === "ORIGIN_STORAGE_MIGRATION_TOO_LARGE"
    )
  );
});
