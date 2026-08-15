import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import test from "node:test";

import {
  LOCAL_STUDIO_MIGRATION_CAPABILITY_ROUTE,
  LOCAL_STUDIO_MIGRATION_CAPABILITY_SCHEMA,
  LOCAL_STUDIO_MIGRATION_ROUTE_PREFIX,
  LocalStudioMigrationStage,
  LocalStudioMigrationStageError,
  handleLocalStudioMigrationRequest,
  legacyExtensionOriginForRepo,
  localStudioMigrationRoute
} from "../scripts/local-studio-migration-stage.js";
import {
  ORIGIN_STORAGE_MIGRATION_TARGET_ORIGIN,
  buildOriginStorageMigration,
  serializeOriginStorageMigration
} from "../src/lib/origin-storage-migration.js";

const NONCE = "N".repeat(43);
const SOURCE_ORIGIN =
  "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

async function migrationJson() {
  return serializeOriginStorageMigration(await buildOriginStorageMigration({
    sourceOrigin: SOURCE_ORIGIN,
    databaseName: "chzzk-kirinuki-studio",
    databaseVersion: 4,
    projects: [{ id: "project-1", name: "보존할 편집" }],
    localDrafts: [],
    imageAssets: [],
    transferId: "T".repeat(43),
    createdAt: "2026-08-12T01:02:03.000Z"
  }));
}

async function withMigrationServer<T>(
  stage: LocalStudioMigrationStage,
  operation: (port: number) => Promise<T>
): Promise<T> {
  const server = createServer((request, response) => {
    void handleLocalStudioMigrationRequest({ request, response, stage })
      .then((handled) => {
        if (!handled) {
          response.writeHead(404).end();
        }
      })
      .catch(() => {
        if (!response.headersSent) {
          response.writeHead(500).end();
        } else {
          response.destroy();
        }
      });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    return await operation(address.port);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function localRequest({
  port,
  method,
  headers = {},
  body = "",
  target = `${LOCAL_STUDIO_MIGRATION_ROUTE_PREFIX}${NONCE}`
}: {
  port: number;
  method: string;
  headers?: Readonly<Record<string, string>>;
  body?: string;
  target?: string;
}): Promise<{
  statusCode: number;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      path: target,
      method,
      headers
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({
        statusCode: response.statusCode || 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    request.once("error", reject);
    request.end(body);
  });
}

test("migration stage is exact-route, exact-origin, and single-use", async () => {
  const stage = new LocalStudioMigrationStage({
    instanceNonce: NONCE,
    expectedExtensionOrigin: SOURCE_ORIGIN
  });
  assert.equal(stage.state, "empty");
  assert.equal(
    localStudioMigrationRoute(
      `${LOCAL_STUDIO_MIGRATION_ROUTE_PREFIX}${NONCE}`,
      NONCE
    ),
    "migration"
  );
  assert.equal(
    localStudioMigrationRoute(
      `${LOCAL_STUDIO_MIGRATION_ROUTE_PREFIX}${NONCE}?again=1`,
      NONCE
    ),
    null
  );

  const staged = await stage.stage(await migrationJson(), SOURCE_ORIGIN);
  assert.equal(staged.status, "staged");
  assert.equal(staged.transferId, "T".repeat(43));
  assert.equal(staged.consumeFragment, `#storage-migration=${NONCE}`);
  assert.equal(stage.state, "staged");

  const duplicateJson = await migrationJson();
  await assert.rejects(
    () => stage.stage(duplicateJson, SOURCE_ORIGIN),
    (error: unknown) => (
      error instanceof LocalStudioMigrationStageError
      && error.code === "LOCAL_STUDIO_MIGRATION_ALREADY_USED"
      && error.statusCode === 409
    )
  );

  const consumed = stage.consume(ORIGIN_STORAGE_MIGRATION_TARGET_ORIGIN);
  assert.equal(JSON.parse(consumed).transferId, "T".repeat(43));
  assert.equal(stage.state, "consumed");
  assert.throws(
    () => stage.consume(ORIGIN_STORAGE_MIGRATION_TARGET_ORIGIN),
    (error: unknown) => (
      error instanceof LocalStudioMigrationStageError
      && error.code === "LOCAL_STUDIO_MIGRATION_CONSUMED"
      && error.statusCode === 410
    )
  );
});

test("migration stage refuses a different extension or localhost spelling", async () => {
  const stage = new LocalStudioMigrationStage({
    instanceNonce: NONCE,
    expectedExtensionOrigin: SOURCE_ORIGIN
  });
  const json = await migrationJson();
  await assert.rejects(
    () => stage.stage(
      json,
      "chrome-extension://pppppppppppppppppppppppppppppppp"
    ),
    (error: unknown) => (
      error instanceof LocalStudioMigrationStageError
      && error.code === "LOCAL_STUDIO_MIGRATION_ORIGIN_MISMATCH"
    )
  );

  await stage.stage(json, SOURCE_ORIGIN);
  assert.throws(
    () => stage.consume("http://localhost:4320"),
    (error: unknown) => (
      error instanceof LocalStudioMigrationStageError
      && error.code === "LOCAL_STUDIO_MIGRATION_TARGET_MISMATCH"
    )
  );
  assert.equal(stage.state, "staged");
});

test("legacy extension origin derivation is absolute-path-bound", () => {
  const first = legacyExtensionOriginForRepo("/tmp/kirinuki-one");
  const repeated = legacyExtensionOriginForRepo("/tmp/kirinuki-one/../kirinuki-one");
  const second = legacyExtensionOriginForRepo("/tmp/kirinuki-two");
  assert.match(first, /^chrome-extension:\/\/[a-p]{32}$/u);
  assert.equal(first, repeated);
  assert.notEqual(first, second);
  assert.throws(
    () => legacyExtensionOriginForRepo("relative/repo"),
    /절대 경로/u
  );
});

test("HTTP bridge performs exact CORS preflight then one POST and one GET", async () => {
  const stage = new LocalStudioMigrationStage({
    instanceNonce: NONCE,
    expectedExtensionOrigin: SOURCE_ORIGIN
  });
  const json = await migrationJson();
  await withMigrationServer(stage, async (port) => {
    const hiddenCapability = await localRequest({
      port,
      method: "GET",
      target: LOCAL_STUDIO_MIGRATION_CAPABILITY_ROUTE
    });
    assert.equal(hiddenCapability.statusCode, 403);

    const capability = await localRequest({
      port,
      method: "GET",
      target: LOCAL_STUDIO_MIGRATION_CAPABILITY_ROUTE,
      headers: { Origin: SOURCE_ORIGIN }
    });
    assert.equal(capability.statusCode, 200);
    assert.equal(
      capability.headers["access-control-allow-origin"],
      SOURCE_ORIGIN
    );
    assert.deepEqual(JSON.parse(capability.body), {
      schema: LOCAL_STUDIO_MIGRATION_CAPABILITY_SCHEMA,
      migrationNonce: NONCE,
      stagePath: `${LOCAL_STUDIO_MIGRATION_ROUTE_PREFIX}${NONCE}`
    });

    const preflight = await localRequest({
      port,
      method: "OPTIONS",
      headers: {
        Origin: SOURCE_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type"
      }
    });
    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.headers["access-control-allow-origin"], SOURCE_ORIGIN);
    assert.equal(stage.state, "empty");

    const rejected = await localRequest({
      port,
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(json))
      },
      body: json
    });
    assert.equal(rejected.statusCode, 403);
    assert.equal(stage.state, "empty");

    const invalidBody = "{}";
    const invalid = await localRequest({
      port,
      method: "POST",
      headers: {
        Origin: SOURCE_ORIGIN,
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(invalidBody))
      },
      body: invalidBody
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.headers["access-control-allow-origin"], SOURCE_ORIGIN);
    assert.equal(stage.state, "empty");

    const posted = await localRequest({
      port,
      method: "POST",
      headers: {
        Origin: SOURCE_ORIGIN,
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(json))
      },
      body: json
    });
    assert.equal(posted.statusCode, 201);
    assert.equal(posted.headers["access-control-allow-origin"], SOURCE_ORIGIN);
    assert.equal(JSON.parse(posted.body).status, "staged");

    const originless = await localRequest({
      port,
      method: "GET"
    });
    assert.equal(originless.statusCode, 403);
    assert.equal(stage.state, "staged");

    const consumed = await localRequest({
      port,
      method: "GET",
      headers: { Origin: ORIGIN_STORAGE_MIGRATION_TARGET_ORIGIN }
    });
    assert.equal(consumed.statusCode, 200);
    assert.equal(JSON.parse(consumed.body).transferId, "T".repeat(43));

    const gone = await localRequest({
      port,
      method: "GET",
      headers: { Origin: ORIGIN_STORAGE_MIGRATION_TARGET_ORIGIN }
    });
    assert.equal(gone.statusCode, 410);
  });
});
