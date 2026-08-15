import { createHash } from "node:crypto";
import type {
  IncomingMessage,
  ServerResponse
} from "node:http";
import path from "node:path";

import {
  ORIGIN_STORAGE_MIGRATION_MAX_JSON_BYTES,
  ORIGIN_STORAGE_MIGRATION_TARGET_ORIGIN,
  OriginStorageMigrationError,
  parseOriginStorageMigrationJson,
  serializeOriginStorageMigration
} from "../src/lib/origin-storage-migration.js";

export const LOCAL_STUDIO_MIGRATION_STAGE_SCHEMA =
  "kirinuki-local-studio-migration-stage/v1" as const;
export const LOCAL_STUDIO_MIGRATION_ROUTE_PREFIX =
  "/v1/studio/storage-migrations/" as const;
export const LOCAL_STUDIO_MIGRATION_CAPABILITY_ROUTE =
  "/v1/studio/storage-migrations/capability" as const;
export const LOCAL_STUDIO_MIGRATION_CAPABILITY_SCHEMA =
  "kirinuki-local-studio-migration-capability/v1" as const;

const INSTANCE_NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const EXTENSION_ORIGIN_PATTERN = /^chrome-extension:\/\/[a-p]{32}$/u;

type MigrationStageState = "empty" | "staged" | "consumed";

interface StagedMigration {
  transferId: string;
  json: string;
}

export interface LocalStudioMigrationStageOptions {
  instanceNonce: string;
  expectedExtensionOrigin: string;
}

export interface LocalStudioMigrationStageResult {
  schema: typeof LOCAL_STUDIO_MIGRATION_STAGE_SCHEMA;
  status: "staged";
  transferId: string;
  consumeFragment: string;
}

export interface LocalStudioMigrationCapability {
  schema: typeof LOCAL_STUDIO_MIGRATION_CAPABILITY_SCHEMA;
  migrationNonce: string;
  stagePath: string;
}

export class LocalStudioMigrationStageError extends Error {
  override readonly name = "LocalStudioMigrationStageError";
  readonly code: string;
  readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function fail(message: string, code: string, statusCode: number): never {
  throw new LocalStudioMigrationStageError(message, code, statusCode);
}

function requiredNonce(value: unknown): string {
  if (typeof value !== "string" || !INSTANCE_NONCE_PATTERN.test(value)) {
    throw new TypeError("localhost migration instance nonce가 올바르지 않습니다.");
  }
  return value;
}

function requiredExtensionOrigin(value: unknown): string {
  if (typeof value !== "string" || !EXTENSION_ORIGIN_PATTERN.test(value)) {
    throw new TypeError("legacy Extension origin이 올바르지 않습니다.");
  }
  return value;
}

export function legacyExtensionOriginForRepo(repoRoot: string): string {
  if (!path.isAbsolute(repoRoot) || /[\0\r\n]/u.test(repoRoot)) {
    throw new TypeError("레포지토리 경로는 절대 경로여야 합니다.");
  }
  const extensionRoot = path.join(path.normalize(repoRoot), "extension");
  const digest = createHash("sha256")
    .update(extensionRoot)
    .digest()
    .subarray(0, 16);
  const extensionId = [...digest].map((byte) => (
    String.fromCharCode(97 + (byte >> 4))
    + String.fromCharCode(97 + (byte & 0x0f))
  )).join("");
  return `chrome-extension://${extensionId}`;
}

export function localStudioMigrationRoute(
  rawTarget: unknown,
  instanceNonce: string
): "migration" | null {
  const nonce = requiredNonce(instanceNonce);
  return rawTarget === `${LOCAL_STUDIO_MIGRATION_ROUTE_PREFIX}${nonce}`
    ? "migration"
    : null;
}

export class LocalStudioMigrationStage {
  readonly instanceNonce: string;
  readonly expectedExtensionOrigin: string;
  #state: MigrationStageState = "empty";
  #staged: StagedMigration | null = null;

  constructor({
    instanceNonce,
    expectedExtensionOrigin
  }: LocalStudioMigrationStageOptions) {
    this.instanceNonce = requiredNonce(instanceNonce);
    this.expectedExtensionOrigin = requiredExtensionOrigin(
      expectedExtensionOrigin
    );
  }

  get state(): MigrationStageState {
    return this.#state;
  }

  async stage(
    json: string,
    sourceOrigin: string
  ): Promise<Readonly<LocalStudioMigrationStageResult>> {
    if (sourceOrigin !== this.expectedExtensionOrigin) {
      fail(
        "legacy Extension origin이 현재 로컬 빌드와 다릅니다.",
        "LOCAL_STUDIO_MIGRATION_ORIGIN_MISMATCH",
        403
      );
    }
    if (this.#state !== "empty") {
      fail(
        "이 localhost server nonce에는 이미 마이그레이션이 사용되었습니다.",
        "LOCAL_STUDIO_MIGRATION_ALREADY_USED",
        409
      );
    }
    const parsed = await parseOriginStorageMigrationJson(json, {
      expectedSourceOrigin: this.expectedExtensionOrigin,
      expectedTargetOrigin: ORIGIN_STORAGE_MIGRATION_TARGET_ORIGIN
    });
    const normalizedJson = serializeOriginStorageMigration(parsed.envelope);
    this.#staged = {
      transferId: parsed.envelope.transferId,
      json: normalizedJson
    };
    this.#state = "staged";
    return Object.freeze({
      schema: LOCAL_STUDIO_MIGRATION_STAGE_SCHEMA,
      status: "staged",
      transferId: parsed.envelope.transferId,
      consumeFragment: `#storage-migration=${this.instanceNonce}`
    });
  }

  consume(targetOrigin: string): string {
    if (targetOrigin !== ORIGIN_STORAGE_MIGRATION_TARGET_ORIGIN) {
      fail(
        "마이그레이션은 고정된 localhost origin에서만 가져올 수 있습니다.",
        "LOCAL_STUDIO_MIGRATION_TARGET_MISMATCH",
        403
      );
    }
    if (this.#state !== "staged" || !this.#staged) {
      fail(
        this.#state === "consumed"
          ? "이 마이그레이션은 이미 한 번 가져갔습니다."
          : "가져갈 마이그레이션이 없습니다.",
        this.#state === "consumed"
          ? "LOCAL_STUDIO_MIGRATION_CONSUMED"
          : "LOCAL_STUDIO_MIGRATION_NOT_STAGED",
        this.#state === "consumed" ? 410 : 404
      );
    }
    const json = this.#staged.json;
    this.#staged = null;
    this.#state = "consumed";
    return json;
  }
}

function rawHeaderValues(
  request: Pick<IncomingMessage, "rawHeaders">,
  headerName: string
): string[] {
  const expected = headerName.toLowerCase();
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === expected) {
      values.push(request.rawHeaders[index + 1] || "");
    }
  }
  return values;
}

function exactHeader(
  request: Pick<IncomingMessage, "rawHeaders">,
  headerName: string
): string | null {
  const values = rawHeaderValues(request, headerName);
  return values.length === 1 ? values[0]! : null;
}

function isExactLoopbackRequest(request: IncomingMessage): boolean {
  return request.socket.localAddress === "127.0.0.1"
    && request.socket.remoteAddress === "127.0.0.1";
}

function responseHeaders(): Readonly<Record<string, string>> {
  return Object.freeze({
    "Cache-Control": "no-store",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  });
}

function sendBytes(
  response: ServerResponse,
  statusCode: number,
  bytes: Uint8Array,
  contentType: string,
  extraHeaders: Readonly<Record<string, string>> = {}
): void {
  response.writeHead(statusCode, {
    ...responseHeaders(),
    "Content-Type": contentType,
    "Content-Length": String(bytes.byteLength),
    ...extraHeaders
  });
  response.end(bytes);
}

function sendText(
  response: ServerResponse,
  statusCode: number,
  text: string,
  extraHeaders: Readonly<Record<string, string>> = {}
): void {
  sendBytes(
    response,
    statusCode,
    Buffer.from(text, "utf8"),
    "text/plain; charset=utf-8",
    extraHeaders
  );
}

function corsHeaders(origin: string): Readonly<Record<string, string>> {
  return Object.freeze({
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin"
  });
}

async function readExactJsonBody(
  request: IncomingMessage,
  contentLength: number
): Promise<string> {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += bytes.byteLength;
    if (
      received > contentLength
      || received > ORIGIN_STORAGE_MIGRATION_MAX_JSON_BYTES
    ) {
      fail(
        "마이그레이션 요청 본문이 선언 크기를 넘었습니다.",
        "LOCAL_STUDIO_MIGRATION_BODY_TOO_LARGE",
        413
      );
    }
    chunks.push(bytes);
  }
  if (received !== contentLength) {
    fail(
      "마이그레이션 요청 본문 크기가 Content-Length와 다릅니다.",
      "LOCAL_STUDIO_MIGRATION_BODY_LENGTH_MISMATCH",
      400
    );
  }
  return Buffer.concat(chunks, received).toString("utf8");
}

function requiredContentLength(request: IncomingMessage): number {
  if (rawHeaderValues(request, "transfer-encoding").length > 0) {
    fail(
      "마이그레이션 요청은 chunked 전송을 받지 않습니다.",
      "LOCAL_STUDIO_MIGRATION_CHUNKED_BODY_REJECTED",
      400
    );
  }
  const raw = exactHeader(request, "content-length");
  if (!raw || !/^\d+$/u.test(raw)) {
    fail(
      "마이그레이션 요청에 정확한 Content-Length가 필요합니다.",
      "LOCAL_STUDIO_MIGRATION_CONTENT_LENGTH_REQUIRED",
      411
    );
  }
  const length = Number(raw);
  if (
    !Number.isSafeInteger(length)
    || length <= 0
    || length > ORIGIN_STORAGE_MIGRATION_MAX_JSON_BYTES
  ) {
    fail(
      "마이그레이션 요청 본문 크기가 허용 범위를 벗어났습니다.",
      "LOCAL_STUDIO_MIGRATION_BODY_TOO_LARGE",
      413
    );
  }
  return length;
}

function isValidPreflight(request: IncomingMessage): boolean {
  const requestedMethod = exactHeader(
    request,
    "access-control-request-method"
  );
  const requestedHeaders = exactHeader(
    request,
    "access-control-request-headers"
  );
  return requestedMethod === "POST"
    && requestedHeaders !== null
    && requestedHeaders.split(",").map((value) => value.trim().toLowerCase())
      .filter(Boolean).join(",") === "content-type";
}

/**
 * Optional HTTP bridge for local-studio-server-core. Call this only after its
 * exact Host check. `true` means the migration route was fully handled.
 */
export async function handleLocalStudioMigrationRequest({
  request,
  response,
  stage
}: {
  request: IncomingMessage;
  response: ServerResponse;
  stage: LocalStudioMigrationStage;
}): Promise<boolean> {
  const rawTarget = request.url || "";
  const capabilityRequest =
    rawTarget === LOCAL_STUDIO_MIGRATION_CAPABILITY_ROUTE;
  if (
    !capabilityRequest
    && localStudioMigrationRoute(rawTarget, stage.instanceNonce) === null
  ) {
    return false;
  }
  if (!isExactLoopbackRequest(request)) {
    sendText(response, 403, "Forbidden\n");
    return true;
  }

  const requestOrigin = exactHeader(request, "origin");
  if (capabilityRequest) {
    if (requestOrigin !== stage.expectedExtensionOrigin) {
      sendText(response, 403, "Forbidden\n");
      return true;
    }
    if (request.method !== "GET") {
      sendText(response, 405, "Method Not Allowed\n", { Allow: "GET" });
      return true;
    }
    const capability: LocalStudioMigrationCapability = {
      schema: LOCAL_STUDIO_MIGRATION_CAPABILITY_SCHEMA,
      migrationNonce: stage.instanceNonce,
      stagePath: `${LOCAL_STUDIO_MIGRATION_ROUTE_PREFIX}${stage.instanceNonce}`
    };
    const body = Buffer.from(`${JSON.stringify(capability)}\n`, "utf8");
    sendBytes(
      response,
      200,
      body,
      "application/json; charset=utf-8",
      corsHeaders(stage.expectedExtensionOrigin)
    );
    return true;
  }
  if (request.method === "OPTIONS") {
    if (
      requestOrigin !== stage.expectedExtensionOrigin
      || !isValidPreflight(request)
    ) {
      sendText(response, 403, "Forbidden\n");
      return true;
    }
    response.writeHead(204, {
      ...responseHeaders(),
      ...corsHeaders(stage.expectedExtensionOrigin),
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "0",
      "Content-Length": "0"
    });
    response.end();
    return true;
  }

  try {
    if (request.method === "POST") {
      if (
        requestOrigin !== stage.expectedExtensionOrigin
        || exactHeader(request, "content-type") !== "application/json"
      ) {
        fail(
          "Extension migration 요청 헤더가 올바르지 않습니다.",
          "LOCAL_STUDIO_MIGRATION_REQUEST_REJECTED",
          403
        );
      }
      const contentLength = requiredContentLength(request);
      const result = await stage.stage(
        await readExactJsonBody(request, contentLength),
        requestOrigin
      );
      const body = Buffer.from(`${JSON.stringify(result)}\n`, "utf8");
      sendBytes(
        response,
        201,
        body,
        "application/json; charset=utf-8",
        corsHeaders(stage.expectedExtensionOrigin)
      );
      return true;
    }
    if (request.method === "GET") {
      if (requestOrigin !== ORIGIN_STORAGE_MIGRATION_TARGET_ORIGIN) {
        fail(
          "localhost migration 가져오기 origin이 올바르지 않습니다.",
          "LOCAL_STUDIO_MIGRATION_TARGET_MISMATCH",
          403
        );
      }
      const json = stage.consume(ORIGIN_STORAGE_MIGRATION_TARGET_ORIGIN);
      sendBytes(
        response,
        200,
        Buffer.from(json, "utf8"),
        "application/json; charset=utf-8"
      );
      return true;
    }
    sendText(response, 405, "Method Not Allowed\n", {
      "Allow": "GET, POST, OPTIONS"
    });
    return true;
  } catch (error) {
    if (error instanceof LocalStudioMigrationStageError) {
      sendText(response, error.statusCode, `${error.message}\n`,
        requestOrigin === stage.expectedExtensionOrigin
          ? corsHeaders(stage.expectedExtensionOrigin)
          : {});
      return true;
    }
    if (error instanceof OriginStorageMigrationError) {
      sendText(
        response,
        400,
        "Invalid migration payload\n",
        requestOrigin === stage.expectedExtensionOrigin
          ? corsHeaders(stage.expectedExtensionOrigin)
          : {}
      );
      return true;
    }
    throw error;
  }
}
