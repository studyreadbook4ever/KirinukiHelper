import assert from "node:assert/strict";
import test from "node:test";

import {
  cutPreparationRecoveryKind,
  safeCutPreparationErrorCode
} from "../src/web/cut-preparation-recovery.js";

test("VOD 준비 오류 코드는 단계별 복구 동작으로 매핑된다", () => {
  assert.equal(cutPreparationRecoveryKind("ENGINE_UNAVAILABLE"), "reconnect");
  assert.equal(cutPreparationRecoveryKind("ENGINE_UNPAIRED"), "reconnect");
  assert.equal(cutPreparationRecoveryKind("TOOL_NOT_INSTALLED"), "update");
  assert.equal(cutPreparationRecoveryKind("RUNTIME_VERSION_TOO_OLD"), "update");
  assert.equal(
    cutPreparationRecoveryKind("SOURCE_CLOCK_VERIFICATION_FAILED"),
    "source"
  );
  assert.equal(cutPreparationRecoveryKind("VOD_UNAVAILABLE"), "source");
  assert.equal(cutPreparationRecoveryKind("MATERIALIZATION_FAILED"), "retry");
});

test("진단 코드는 URL·경로·stack·임의 code를 노출하지 않는다", () => {
  assert.equal(safeCutPreparationErrorCode({
    code: "SOURCE_CLOCK_VERIFICATION_FAILED",
    message: "https://private.example/video",
    stack: "/users/private/project/file.ts"
  }), "SOURCE_CLOCK_VERIFICATION_FAILED");
  assert.equal(safeCutPreparationErrorCode({ code: "../../private" }), "UNEXPECTED_FAILURE");
  assert.equal(safeCutPreparationErrorCode(new Error("secret path")), "UNEXPECTED_FAILURE");
});
