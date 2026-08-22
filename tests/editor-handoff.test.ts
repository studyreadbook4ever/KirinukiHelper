import assert from "node:assert/strict";
import test from "node:test";

import {
  EDITOR_HANDOFF_ACKNOWLEDGEMENT_SCHEMA,
  EDITOR_HANDOFF_CONSUME_REQUEST_SCHEMA,
  EDITOR_HANDOFF_SCHEMA,
  EDITOR_HANDOFF_SUBMISSION_SCHEMA,
  createEditorHandoffBroker,
  editorHandoffAcknowledgementFailureDisposition,
  editorHandoffCapabilityProjectId,
  normalizeEditorHandoffEnvelope
} from "../src/lib/editor-handoff.js";

const NONCE_A = "A".repeat(43);
const NONCE_B = "B".repeat(43);
const CLAIM_A = "C".repeat(43);
const CLAIM_B = "D".repeat(43);

function submission() {
  return {
    schema: EDITOR_HANDOFF_SUBMISSION_SCHEMA,
    confirmedAt: "2026-08-22T00:00:00.000Z",
    acknowledgements: {
      vodCovered: true,
      localAcquisitionAndEditing: true,
      publicationIsSeparate: true,
      thirdPartyRights: true,
      platformTermsAndNoCircumvention: true,
      userResponsibility: true
    },
    captureSeed: {
      source: {
        platform: "YOUTUBE",
        channelId: "",
        contentId: "dQw4w9WgXcQ",
        contentType: "vod",
        canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        broadcastTitle: "0520 히오스"
      },
      projectName: "0520 히오스",
      segments: [{
        id: "12345678-1234-1234-1234-123456789abc",
        startSeconds: 80.5,
        endSeconds: 85.5,
        description: "첫 구간",
        createdAt: "2026-08-22T00:00:00.000Z",
        updatedAt: "2026-08-22T00:00:00.000Z"
      }]
    }
  };
}

function envelope(generation = 1) {
  return {
    ...submission(),
    schema: EDITOR_HANDOFF_SCHEMA,
    handoffGeneration: generation
  };
}

test("editor handoff는 exact capture/source/range만 정규화한다", () => {
  const normalized = normalizeEditorHandoffEnvelope(envelope());
  assert.equal(normalized.captureSeed.projectName, "0520 히오스");
  assert.equal(normalized.captureSeed.segments?.[0]?.startSeconds, 80.5);
  assert.throws(
    () => normalizeEditorHandoffEnvelope({ ...envelope(), extra: true }),
    /필드/u
  );
  const reversed = structuredClone(envelope());
  reversed.captureSeed.segments[0]!.endSeconds = 79;
  assert.throws(() => normalizeEditorHandoffEnvelope(reversed), /범위/u);
});

test("editor handoff broker는 capability scope와 nonce에 묶여 정확히 한 번만 준다", () => {
  let timestamp = Date.parse("2026-08-22T00:00:01.000Z");
  const nonces = [NONCE_A, NONCE_B];
  const broker = createEditorHandoffBroker({
    createNonce: () => nonces.shift()!,
    now: () => timestamp
  });
  const published = broker.publish(submission());
  assert.deepEqual(published, {
    handoffNonce: NONCE_A,
    handoffGeneration: 1
  });
  const request = {
    schema: EDITOR_HANDOFF_CONSUME_REQUEST_SCHEMA,
    handoffNonce: NONCE_A,
    claimId: CLAIM_A
  };
  assert.equal(broker.claim(request, "wrong-project"), null);
  // A wrong scope is a failed claim but cannot disclose or consume the entry.
  assert.equal(broker.size(), 1);
  assert.equal(
    broker.claim(
      request,
      editorHandoffCapabilityProjectId(NONCE_A)
    )?.handoffGeneration,
    1
  );
  assert.equal(
    broker.claim(request, editorHandoffCapabilityProjectId(NONCE_A))
      ?.handoffGeneration,
    1
  );
  assert.equal(broker.status(NONCE_A), "claimed");
  assert.equal(broker.claim({ ...request, claimId: CLAIM_B },
    editorHandoffCapabilityProjectId(NONCE_A)), null);
  assert.equal(broker.acknowledge({
    schema: EDITOR_HANDOFF_ACKNOWLEDGEMENT_SCHEMA,
    handoffNonce: NONCE_A,
    claimId: CLAIM_A
  }, editorHandoffCapabilityProjectId(NONCE_A)), true);
  assert.equal(broker.status(NONCE_A), "acknowledged");
  assert.equal(broker.acknowledge({
    schema: EDITOR_HANDOFF_ACKNOWLEDGEMENT_SCHEMA,
    handoffNonce: NONCE_A,
    claimId: CLAIM_A
  }, editorHandoffCapabilityProjectId(NONCE_A)), true);
  assert.equal(broker.acknowledge({
    schema: EDITOR_HANDOFF_ACKNOWLEDGEMENT_SCHEMA,
    handoffNonce: NONCE_A,
    claimId: CLAIM_B
  }, editorHandoffCapabilityProjectId(NONCE_A)), false);
  assert.equal(broker.cancel(NONCE_A, published.handoffGeneration), false);
  assert.equal(broker.status(NONCE_A), "acknowledged");
  assert.equal(
    broker.claim(request, editorHandoffCapabilityProjectId(NONCE_A)),
    null
  );
  assert.equal(broker.size(), 0);
  timestamp += 1_000;
});

test("editor handoff broker는 만료·용량을 bounded 처리한다", () => {
  let timestamp = Date.parse("2026-08-22T00:00:01.000Z");
  const nonces = [NONCE_A, NONCE_B];
  const broker = createEditorHandoffBroker({
    createNonce: () => nonces.shift()!,
    now: () => timestamp,
    ttlMs: 1_000,
    maximumPending: 1
  });
  broker.publish(submission());
  assert.throws(() => broker.publish(submission()), /너무 많/u);
  timestamp += 1_001;
  assert.equal(broker.size(), 0);
  assert.equal(
    broker.claim({
      schema: EDITOR_HANDOFF_CONSUME_REQUEST_SCHEMA,
      handoffNonce: NONCE_A,
      claimId: CLAIM_A
    }, editorHandoffCapabilityProjectId(NONCE_A)),
    null
  );
});

test("editor handoff 취소는 nonce와 generation이 모두 맞는 대기 건만 폐기한다", () => {
  const nonces = [NONCE_A, NONCE_B];
  const broker = createEditorHandoffBroker({
    createNonce: () => nonces.shift()!,
    now: () => Date.parse("2026-08-22T00:00:01.000Z")
  });
  const first = broker.publish(submission());
  assert.equal(broker.cancel(first.handoffNonce, first.handoffGeneration + 1), false);
  assert.equal(broker.status(first.handoffNonce), "pending");
  assert.equal(broker.cancel(first.handoffNonce, first.handoffGeneration), true);
  assert.equal(broker.status(first.handoffNonce), "absent");
  assert.equal(broker.cancel(first.handoffNonce, first.handoffGeneration), false);

  const second = broker.publish(submission());
  assert.equal(second.handoffGeneration, first.handoffGeneration + 1);
  assert.equal(broker.cancel(second.handoffNonce, first.handoffGeneration), false);
  assert.equal(broker.status(second.handoffNonce), "pending");
});

test("ACK 응답 유실 ambiguity는 데이터 보존을 우선하고 definite 4xx만 rollback한다", () => {
  for (const status of [null, undefined, 0, 200, 500, 503]) {
    assert.equal(
      editorHandoffAcknowledgementFailureDisposition(status),
      "preserve",
      String(status)
    );
  }
  for (const status of [400, 401, 403, 404, 408, 409, 429, 499]) {
    assert.equal(
      editorHandoffAcknowledgementFailureDisposition(status),
      "rollback",
      String(status)
    );
  }
});
