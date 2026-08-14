export const USAGE_POLICY_ATTESTATION_SCHEMA =
  "kirinuki-usage-policy-attestation/v1";
export const USAGE_POLICY_RUNTIME_PROTOCOL =
  "kirinuki-usage-policy-runtime/v4";
export const USAGE_POLICY_CONFIRMATION_PHRASE =
  "동의합니다";

export type UsagePolicyBasis =
  | "public-policy"
  | "written-permission"
  | "official-editor"
  | "per-use-confirmation";

export type UsagePolicyPurpose =
  | "editor-new"
  | "editor-resume"
  | "editor-recovery";

export interface UsagePolicyTarget {
  projectId: string;
  sourceSessionId: string;
  purpose: UsagePolicyPurpose;
}

export interface UsagePolicyAcknowledgements {
  vodCovered: true;
  localAcquisitionAndEditing: true;
  publicationIsSeparate: true;
  thirdPartyRights: true;
  platformTermsAndNoCircumvention: true;
  userResponsibility: true;
}

export interface UsagePolicyAttestation {
  schema: typeof USAGE_POLICY_ATTESTATION_SCHEMA;
  target: UsagePolicyTarget;
  basis: UsagePolicyBasis;
  rightsHolder: string;
  evidenceReference: string;
  evidenceDate: string;
  permittedScope: string;
  acknowledgements: UsagePolicyAcknowledgements;
  confirmationText: typeof USAGE_POLICY_CONFIRMATION_PHRASE;
  confirmedAt: string;
}

interface ValidationOptions {
  expectedTarget?: UsagePolicyTarget;
  /** @deprecated Kept for callers compiled against v1; form validity is time-independent. */
  nowMs?: number;
}

export class UsagePolicyTargetMismatchError extends Error {
  constructor() {
    super(
      "권리·책임 확인 뒤 원본이나 열기 대상이 바뀌었습니다. 이번 사용 정보를 다시 입력해 주세요."
    );
    this.name = "UsagePolicyTargetMismatchError";
  }
}

type UnknownRecord = Record<string, unknown>;

const BASIS_VALUES = new Set<UsagePolicyBasis>([
  "public-policy",
  "written-permission",
  "official-editor",
  "per-use-confirmation"
]);

const PER_USE_CONFIRMATION_RIGHTS_HOLDER =
  "사용자가 앱 밖에서 직접 확인";
const PER_USE_CONFIRMATION_EVIDENCE_REFERENCE =
  "이번 사용 세부 근거 앱 외부 보관";
const PER_USE_CONFIRMATION_SCOPE =
  "이번 원본의 허용 범위를 사용자가 직접 확인했으며 세부 근거는 앱 밖에 보관";
const PURPOSE_VALUES = new Set<UsagePolicyPurpose>([
  "editor-new",
  "editor-resume",
  "editor-recovery"
]);
const ATTESTATION_KEYS = new Set([
  "schema",
  "target",
  "basis",
  "rightsHolder",
  "evidenceReference",
  "evidenceDate",
  "permittedScope",
  "acknowledgements",
  "confirmationText",
  "confirmedAt"
]);
const TARGET_KEYS = new Set([
  "projectId",
  "sourceSessionId",
  "purpose"
]);
const ACKNOWLEDGEMENT_KEYS = new Set([
  "vodCovered",
  "localAcquisitionAndEditing",
  "publicationIsSeparate",
  "thirdPartyRights",
  "platformTermsAndNoCircumvention",
  "userResponsibility"
]);

function isPlainRecord(value: unknown): value is UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(
  value: UnknownRecord,
  allowed: ReadonlySet<string>,
  label: string
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) {
    throw new TypeError(`${label}에 허용되지 않은 필드가 있습니다: ${unexpected}`);
  }
}

function normalizedSingleLine(
  value: unknown,
  label: string,
  minimumLength: number,
  maximumLength: number
): string {
  if (typeof value !== "string") {
    throw new TypeError(
      `${label}은 ${minimumLength}~${maximumLength}자의 한 줄로 입력해 주세요.`
    );
  }
  const normalized = value
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
  if (
    normalized.length < minimumLength
    || normalized.length > maximumLength
    || /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new TypeError(
      `${label}은 ${minimumLength}~${maximumLength}자의 한 줄로 입력해 주세요.`
    );
  }
  return normalized;
}

function normalizedTarget(value: unknown): UsagePolicyTarget {
  if (!isPlainRecord(value)) {
    throw new TypeError("정책 확인 대상이 올바르지 않습니다.");
  }
  assertExactKeys(value, TARGET_KEYS, "정책 확인 대상");
  const projectId = normalizedSingleLine(
    value.projectId,
    "프로젝트 ID",
    1,
    256
  );
  const sourceSessionId = normalizedSingleLine(
    value.sourceSessionId,
    "원본 회차 ID",
    1,
    1_024
  );
  if (!PURPOSE_VALUES.has(value.purpose as UsagePolicyPurpose)) {
    throw new TypeError("정책 확인 목적이 올바르지 않습니다.");
  }
  return {
    projectId,
    sourceSessionId,
    purpose: value.purpose as UsagePolicyPurpose
  };
}

function normalizedAcknowledgements(
  value: unknown
): UsagePolicyAcknowledgements {
  if (!isPlainRecord(value)) {
    throw new TypeError("필수 책임 확인 항목을 모두 선택해 주세요.");
  }
  assertExactKeys(value, ACKNOWLEDGEMENT_KEYS, "필수 책임 확인");
  for (const key of ACKNOWLEDGEMENT_KEYS) {
    if (value[key] !== true) {
      throw new TypeError("필수 책임 확인 항목을 모두 선택해 주세요.");
    }
  }
  return {
    vodCovered: true,
    localAcquisitionAndEditing: true,
    publicationIsSeparate: true,
    thirdPartyRights: true,
    platformTermsAndNoCircumvention: true,
    userResponsibility: true
  };
}

function normalizedEvidenceDate(value: unknown): string {
  const evidenceDate = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(evidenceDate)) {
    throw new TypeError("공식 규정 확인일 또는 허가일을 입력해 주세요.");
  }
  const parsed = Date.parse(`${evidenceDate}T00:00:00Z`);
  if (
    !Number.isFinite(parsed)
    || new Date(parsed).toISOString().slice(0, 10) !== evidenceDate
  ) {
    throw new TypeError("공식 규정 확인일 또는 허가일이 올바르지 않습니다.");
  }
  return evidenceDate;
}

function normalizedEvidenceReference(
  value: unknown,
  basis: UsagePolicyBasis
): string {
  const evidenceReference = normalizedSingleLine(
    value,
    basis === "public-policy" ? "공식 정책 URL" : "권한 증빙 참조명",
    6,
    basis === "public-policy" ? 2_048 : 240
  );
  if (basis === "public-policy") {
    // This is deliberately syntax-only: Kirinuki does not fetch the URL or
    // decide whether the referenced policy grants real-world permission.
    let url: URL;
    try {
      url = new URL(evidenceReference);
    } catch {
      throw new TypeError("직접 확인한 공식 HTTPS 정책 URL을 입력해 주세요.");
    }
    if (
      url.protocol !== "https:"
      || Boolean(url.username)
      || Boolean(url.password)
      || !url.hostname
    ) {
      throw new TypeError("직접 확인한 공식 HTTPS 정책 URL을 입력해 주세요.");
    }
    return url.href;
  }
  if (
    evidenceReference.includes("@")
    || evidenceReference.includes("/")
    || evidenceReference.includes("\\")
    || /(?:https?:|mailto:|file:|chrome:)/iu.test(evidenceReference)
    || /\.(?:docx?|eml|html?|jpe?g|msg|pdf|png|rtf|txt|webp)$/iu.test(
      evidenceReference
    )
  ) {
    throw new TypeError(
      "메일 주소·링크·파일 경로 대신 날짜와 비민감 참조명만 입력해 주세요."
    );
  }
  return evidenceReference;
}

export function usagePolicyTargetsEqual(
  left: UsagePolicyTarget,
  right: UsagePolicyTarget
): boolean {
  return (
    left.projectId === right.projectId
    && left.sourceSessionId === right.sourceSessionId
    && left.purpose === right.purpose
  );
}

export function normalizeUsagePolicyAttestation(
  value: unknown,
  {
    expectedTarget
  }: ValidationOptions = {}
): UsagePolicyAttestation {
  if (!isPlainRecord(value)) {
    throw new TypeError("이번 사용의 권리·책임 확인 정보를 입력해 주세요.");
  }
  assertExactKeys(value, ATTESTATION_KEYS, "권리·책임 확인 정보");
  if (value.schema !== USAGE_POLICY_ATTESTATION_SCHEMA) {
    throw new TypeError("지원하지 않는 권리·책임 확인 형식입니다.");
  }
  const target = normalizedTarget(value.target);
  if (expectedTarget && !usagePolicyTargetsEqual(target, expectedTarget)) {
    throw new UsagePolicyTargetMismatchError();
  }
  if (!BASIS_VALUES.has(value.basis as UsagePolicyBasis)) {
    throw new TypeError("사용 권한 근거를 하나 선택해 주세요.");
  }
  const basis = value.basis as UsagePolicyBasis;
  const rightsHolder = normalizedSingleLine(
    value.rightsHolder,
    "권리자 또는 허가 주체",
    2,
    160
  );
  const evidenceReference = normalizedEvidenceReference(
    value.evidenceReference,
    basis
  );
  const evidenceDate = normalizedEvidenceDate(value.evidenceDate);
  const permittedScope = normalizedSingleLine(
    value.permittedScope,
    "허용 범위와 제한",
    10,
    800
  );
  const acknowledgements = normalizedAcknowledgements(value.acknowledgements);
  if (value.confirmationText !== USAGE_POLICY_CONFIRMATION_PHRASE) {
    throw new TypeError("동의합니다를 정확히 입력해 주세요.");
  }
  const confirmedAt = typeof value.confirmedAt === "string"
    ? value.confirmedAt.trim()
    : "";
  const confirmedAtMs = Date.parse(confirmedAt);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      confirmedAt
    )
    || !Number.isFinite(confirmedAtMs)
  ) {
    throw new TypeError("이번 사용 확인 시각 형식이 올바르지 않습니다.");
  }
  const normalizedConfirmedAt = new Date(confirmedAtMs).toISOString();
  if (
    basis === "per-use-confirmation"
    && (
      rightsHolder !== PER_USE_CONFIRMATION_RIGHTS_HOLDER
      || evidenceReference !== PER_USE_CONFIRMATION_EVIDENCE_REFERENCE
      || evidenceDate !== normalizedConfirmedAt.slice(0, 10)
      || permittedScope !== PER_USE_CONFIRMATION_SCOPE
    )
  ) {
    throw new TypeError("이번 1회 간편 확인 정보가 올바르지 않습니다.");
  }
  return {
    schema: USAGE_POLICY_ATTESTATION_SCHEMA,
    target,
    basis,
    rightsHolder,
    evidenceReference,
    evidenceDate,
    permittedScope,
    acknowledgements,
    confirmationText: USAGE_POLICY_CONFIRMATION_PHRASE,
    confirmedAt: normalizedConfirmedAt
  };
}

export function createPerUseConfirmationAttestation({
  target,
  confirmationText,
  confirmedAt = new Date().toISOString()
}: {
  target: UsagePolicyTarget;
  confirmationText: unknown;
  confirmedAt?: string;
}): UsagePolicyAttestation {
  return normalizeUsagePolicyAttestation({
    schema: USAGE_POLICY_ATTESTATION_SCHEMA,
    target,
    basis: "per-use-confirmation",
    rightsHolder: PER_USE_CONFIRMATION_RIGHTS_HOLDER,
    evidenceReference: PER_USE_CONFIRMATION_EVIDENCE_REFERENCE,
    evidenceDate: confirmedAt.slice(0, 10),
    permittedScope: PER_USE_CONFIRMATION_SCOPE,
    acknowledgements: {
      vodCovered: true,
      localAcquisitionAndEditing: true,
      publicationIsSeparate: true,
      thirdPartyRights: true,
      platformTermsAndNoCircumvention: true,
      userResponsibility: true
    },
    confirmationText,
    confirmedAt
  }, {
    expectedTarget: target,
    nowMs: Date.parse(confirmedAt)
  });
}

export function usagePolicyBasisLabel(basis: UsagePolicyBasis): string {
  if (basis === "public-policy") {
    return "최신 공개 키리누키 규정";
  }
  if (basis === "written-permission") {
    return "별도 서면 허락";
  }
  if (basis === "official-editor") {
    return "공식 편집자·소속사 권한";
  }
  return "이번 1회 사용자 확인";
}

function markdownInline(value: string): string {
  return value.replace(/[`\r\n]+/gu, " ").trim();
}

export function compilePerUsePolicyMarkdown({
  attestation,
  guidanceMarkdown = ""
}: {
  attestation: UsagePolicyAttestation;
  guidanceMarkdown?: unknown;
}): string {
  const normalized = normalizeUsagePolicyAttestation(attestation, {
    expectedTarget: attestation.target,
    nowMs: Date.parse(attestation.confirmedAt)
  });
  const referenceLabel = normalized.basis === "public-policy"
    ? "사용자가 이번 작업에서 직접 확인한 공식 URL"
    : "사용자가 앱 밖에 보관하는 비민감 증빙 참조명";
  const evidenceLines = normalized.basis === "per-use-confirmation"
    ? [
      "- 권한 근거: `이번 1회 사용자 확인` (세부 근거는 앱이 수집하지 않음)"
    ]
    : [
      `- 권한 근거: \`${usagePolicyBasisLabel(normalized.basis)}\``,
      `- 권리자·허가 주체: ${markdownInline(normalized.rightsHolder)}`,
      `- ${referenceLabel}: ${markdownInline(normalized.evidenceReference)}`,
      `- 공식 규정 확인일 또는 허가일: ${normalized.evidenceDate}`,
      `- 사용자가 확인한 허용 범위·제한: ${markdownInline(normalized.permittedScope)}`
    ];
  const perUse = [
    "# 이번 작업의 사용자 권한 진술",
    "",
    "> 이 기록은 사용자가 입력한 사실을 정리할 뿐 권리를 새로 만들거나 Kirinuki가 법률·정책 준수를 검증했다는 뜻이 아닙니다.",
    "",
    ...evidenceLines,
    `- 이번 확인 시각: ${normalized.confirmedAt}`,
    `- 적용 원본 회차: \`${markdownInline(normalized.target.sourceSessionId)}\``,
    "",
    "## 강제 책임 고지",
    "",
    "- 이 소프트웨어는 스트리머·소속사가 명시적으로 키리누키를 허용한 VOD, 별도 서면 허락을 받은 VOD, 또는 공식 편집 권한이 있는 작업에만 사용한다.",
    "- 권리 보유·허가 범위 확인, 로컬 취득·편집·게시·수익화, 제3자 권리와 입력 내용의 진실성에 대한 책임은 전적으로(100%) 사용자에게 있다.",
    "- 이 확인은 실제 권리나 게시 허가를 만들어내지 않으며, 법률상 배제할 수 없는 책임까지 면제한다는 뜻이 아니다.",
    "- 메일 본문·주소·계약서·스크린샷·첨부파일은 Kirinuki에 입력하거나 복제하지 않는다."
  ].join("\n");
  const guidance = String(guidanceMarkdown ?? "").trim();
  return [perUse, guidance].filter(Boolean).join("\n\n---\n\n");
}
