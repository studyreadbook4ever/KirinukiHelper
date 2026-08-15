import assert from "node:assert/strict";
import test from "node:test";

import {
  USAGE_POLICY_ATTESTATION_SCHEMA,
  USAGE_POLICY_CONFIRMATION_PHRASE,
  USAGE_POLICY_RUNTIME_PROTOCOL,
  UsagePolicyTargetMismatchError,
  compilePerUsePolicyMarkdown,
  createPerUseConfirmationAttestation,
  normalizeUsagePolicyAttestation,
  usagePolicyBasisLabel,
  usagePolicyTargetsEqual
} from "../src/lib/usage-policy.js";
import type {
  UsagePolicyAttestation,
  UsagePolicyBasis,
  UsagePolicyTarget
} from "../src/lib/usage-policy.js";

const NOW_ISO = "2026-08-10T12:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);

test("정책 게이트 런타임 handshake protocol은 한 공유 상수로 고정한다", () => {
  assert.equal(
    USAGE_POLICY_RUNTIME_PROTOCOL,
    "kirinuki-usage-policy-runtime/v4"
  );
});

const REFERENCES: Record<UsagePolicyBasis, string> = {
  "public-policy": "https://official.example/kirinuki-policy",
  "written-permission": "서면 허락 기록 2026-08-09",
  "official-editor": "공식 편집 업무지시 2026-08",
  "per-use-confirmation": "이번 사용 세부 근거 앱 외부 보관"
};

function validAttestation(
  basis: UsagePolicyBasis = "public-policy",
  overrides: Partial<UsagePolicyAttestation> = {}
): UsagePolicyAttestation {
  return {
    schema: USAGE_POLICY_ATTESTATION_SCHEMA,
    target: {
      projectId: "project-policy-1",
      sourceSessionId: "vod:14252987",
      purpose: "editor-new"
    },
    basis,
    rightsHolder: "테스트 스트리머 소속사",
    evidenceReference: REFERENCES[basis],
    evidenceDate: "2026-08-09",
    permittedScope: "이 VOD의 로컬 취득과 편집 및 비공개 검수본 생성을 허용함",
    acknowledgements: {
      vodCovered: true,
      localAcquisitionAndEditing: true,
      publicationIsSeparate: true,
      thirdPartyRights: true,
      platformTermsAndNoCircumvention: true,
      userResponsibility: true
    },
    confirmationText: USAGE_POLICY_CONFIRMATION_PHRASE,
    confirmedAt: NOW_ISO,
    ...overrides
  };
}

function normalize(value: unknown, expectedTarget?: UsagePolicyTarget) {
  return normalizeUsagePolicyAttestation(value, {
    ...(expectedTarget ? { expectedTarget } : {}),
    nowMs: NOW_MS
  });
}

test("상세 권한 근거 세 종류는 각각 정확한 참조 형식으로 허용한다", () => {
  const cases: Array<[UsagePolicyBasis, string]> = [
    ["public-policy", "최신 공개 키리누키 규정"],
    ["written-permission", "별도 서면 허락"],
    ["official-editor", "공식 편집자·소속사 권한"]
  ];

  for (const [basis, label] of cases) {
    const normalized = normalize(validAttestation(basis));
    assert.equal(normalized.basis, basis);
    assert.equal(normalized.evidenceReference, REFERENCES[basis]);
    assert.equal(usagePolicyBasisLabel(basis), label);
  }
  assert.throws(
    () => normalize({ ...validAttestation(), basis: "clip-enabled" }),
    /사용 권한 근거/
  );
});

test("간편 확인은 동의합니다 한 문구만 받아 정확한 이번 사용 대상에 묶는다", () => {
  const target: UsagePolicyTarget = {
    projectId: "project-policy-1",
    sourceSessionId: "vod:14252987",
    purpose: "editor-new"
  };
  const attestation = createPerUseConfirmationAttestation({
    target,
    confirmationText: USAGE_POLICY_CONFIRMATION_PHRASE,
    confirmedAt: NOW_ISO
  });

  assert.equal(attestation.basis, "per-use-confirmation");
  assert.equal(attestation.confirmationText, "동의합니다");
  assert.equal(attestation.confirmedAt, NOW_ISO);
  assert.deepEqual(attestation.target, target);
  assert.equal(usagePolicyBasisLabel(attestation.basis), "이번 1회 사용자 확인");
  assert.throws(
    () => createPerUseConfirmationAttestation({
      target,
      confirmationText: "동의 합니다",
      confirmedAt: NOW_ISO
    }),
    /동의합니다를 정확히/
  );
});

test("attestation·대상·책임 확인은 추가 필드와 비객체 입력을 엄격히 거절한다", () => {
  const base = validAttestation();
  for (const value of [null, [], "policy", new Date(NOW_ISO)]) {
    assert.throws(() => normalize(value), /권리·책임 확인 정보/);
  }
  assert.throws(
    () => normalize({ ...base, copiedMailBody: "민감 원문" }),
    /허용되지 않은 필드.*copiedMailBody/
  );
  assert.throws(
    () => normalize({
      ...base,
      target: { ...base.target, sourceUrl: "https://example.com" }
    }),
    /정책 확인 대상.*허용되지 않은 필드.*sourceUrl/
  );
  assert.throws(
    () => normalize({
      ...base,
      acknowledgements: {
        ...base.acknowledgements,
        legalApproval: true
      }
    }),
    /필수 책임 확인.*허용되지 않은 필드.*legalApproval/
  );
  assert.throws(
    () => normalize({ ...base, schema: "kirinuki-usage-policy-attestation/v2" }),
    /지원하지 않는/
  );
  const { rightsHolder: _omitted, ...withoutRightsHolder } = base;
  assert.throws(() => normalize(withoutRightsHolder), /권리자 또는 허가 주체/);
  assert.throws(
    () => normalize({ ...base, rightsHolder: { name: "권리자" } }),
    /권리자 또는 허가 주체/
  );
  assert.throws(
    () => normalize({ ...base, evidenceDate: { date: "2026-08-09" } }),
    /확인일 또는 허가일/
  );
  assert.throws(
    () => normalize({ ...base, confirmedAt: new Date(NOW_ISO) }),
    /확인 시각 형식/
  );
});

test("여섯 책임 항목은 모두 literal true여야 하고 동의 문구는 공백까지 정확해야 한다", () => {
  const base = validAttestation();
  for (const key of Object.keys(base.acknowledgements)) {
    assert.throws(
      () => normalize({
        ...base,
        acknowledgements: {
          ...base.acknowledgements,
          [key]: false
        }
      }),
      /필수 책임 확인 항목을 모두/
    );
  }
  const { thirdPartyRights: _omitted, ...missingAcknowledgement } =
    base.acknowledgements;
  assert.throws(
    () => normalize({ ...base, acknowledgements: missingAcknowledgement }),
    /필수 책임 확인 항목을 모두/
  );
  for (const confirmationText of [
    `${USAGE_POLICY_CONFIRMATION_PHRASE} `,
    "동의 합니다",
    ""
  ]) {
    assert.throws(
      () => normalize({ ...base, confirmationText }),
      /동의합니다를 정확히/
    );
  }
});

test("공개 규정은 자격증명 없는 HTTPS URL 형식만 확인한다", () => {
  const normalized = normalize(validAttestation("public-policy", {
    evidenceReference: "https://official.example/policy?vod=14252987"
  }));
  assert.equal(
    normalized.evidenceReference,
    "https://official.example/policy?vod=14252987"
  );

  for (const evidenceReference of [
    "http://official.example/policy",
    "https://user:password@official.example/policy",
    "official.example/policy",
    "file:///tmp/policy.html"
  ]) {
    assert.throws(
      () => normalize(validAttestation("public-policy", { evidenceReference })),
      /공식 HTTPS 정책 URL/
    );
  }
});

test("형식상 유효하지만 접근할 수 없는 공식 URL도 네트워크 확인 없이 통과한다", () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    throw new Error("권리 양식 검증은 URL에 접속하면 안 됩니다.");
  }) as typeof fetch;
  try {
    const normalized = normalize(validAttestation("public-policy", {
      evidenceReference: "https://policy-does-not-exist.invalid/kirinuki"
    }));
    assert.equal(
      normalized.evidenceReference,
      "https://policy-does-not-exist.invalid/kirinuki"
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("서면·공식 편집자 참조에는 메일 주소·URL·URI·파일 원문을 넣을 수 없다", () => {
  for (const basis of ["written-permission", "official-editor"] as const) {
    for (const evidenceReference of [
      "artist@example.com",
      "https://example.com/private-proof",
      "mailto:artist@example.com",
      "file:///home/user/contract.pdf",
      "chrome://downloads/",
      "/home/user/contract.pdf",
      "C:\\Users\\name\\contract.pdf",
      "\\\\server\\share\\contract.pdf",
      "~/contract.pdf",
      "contract.pdf"
    ]) {
      assert.throws(
        () => normalize(validAttestation(basis, { evidenceReference })),
        /메일 주소·링크·파일 경로 대신 날짜와 비민감 참조명/
      );
    }
    assert.equal(
      normalize(validAttestation(basis)).evidenceReference,
      REFERENCES[basis]
    );
  }
});

test("프로젝트·원본 회차·목적 중 하나라도 달라지면 과거 확인을 재사용하지 않는다", () => {
  const base = validAttestation();
  assert.equal(usagePolicyTargetsEqual(base.target, { ...base.target }), true);

  const mismatches: UsagePolicyTarget[] = [
    { ...base.target, projectId: "project-policy-2" },
    { ...base.target, sourceSessionId: "vod:999" },
    { ...base.target, purpose: "editor-resume" }
  ];
  for (const expectedTarget of mismatches) {
    assert.equal(usagePolicyTargetsEqual(base.target, expectedTarget), false);
    assert.throws(
      () => normalize(base, expectedTarget),
      (error) => (
        error instanceof UsagePolicyTargetMismatchError
        && /원본이나 열기 대상이 바뀌었습니다/u.test(error.message)
      )
    );
  }
  assert.deepEqual(normalize(base, base.target).target, base.target);
});

test("날짜·확인 시각은 형식만 검증하며 과거·미래 시각 때문에 만료시키지 않는다", () => {
  for (const evidenceDate of ["2026-02-30", "2026/08/09"] ) {
    assert.throws(
      () => normalize(validAttestation("public-policy", { evidenceDate })),
      /확인일 또는 허가일/
    );
  }
  for (const confirmedAt of ["not-a-date", "0"]) {
    assert.throws(
      () => normalize(validAttestation("public-policy", { confirmedAt })),
      /확인 시각 형식/
    );
  }
  assert.equal(
    normalize(validAttestation("public-policy", {
      evidenceDate: "2099-12-31",
      confirmedAt: "2000-01-01T00:00:00Z"
    })).confirmedAt,
    "2000-01-01T00:00:00.000Z"
  );
  assert.equal(
    normalize(validAttestation("public-policy", {
      confirmedAt: "2099-12-31T23:59:59Z"
    })).confirmedAt,
    "2099-12-31T23:59:59.000Z"
  );
});

test("매 작업 정책 문서는 권리를 만들지 않으며 100% 책임·별도 게시·민감 증빙 금지를 명시한다", () => {
  const markdown = compilePerUsePolicyMarkdown({
    attestation: validAttestation("written-permission"),
    guidanceMarkdown: "# 일반 지침\n\n`PUBLICATION_BLOCKED`를 유지한다."
  });

  assert.match(markdown, /이번 작업의 사용자 권한 진술/);
  assert.match(markdown, /권리를 새로 만들거나 Kirinuki가 법률·정책 준수를 검증했다는 뜻이 아닙니다/);
  assert.match(markdown, /명시적으로 키리누키를 허용한 VOD/);
  assert.match(markdown, /책임은 전적으로\(100%\) 사용자/);
  assert.match(markdown, /게시·수익화/);
  assert.match(markdown, /법률상 배제할 수 없는 책임까지 면제/);
  assert.match(markdown, /메일 본문·주소·계약서·스크린샷·첨부파일/);
  assert.match(markdown, /적용 원본 회차: `vod:14252987`/);
  assert.match(markdown, /PUBLICATION_BLOCKED/);
  assert.doesNotMatch(markdown, new RegExp(USAGE_POLICY_CONFIRMATION_PHRASE, "u"));
});
