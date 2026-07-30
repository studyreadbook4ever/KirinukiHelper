// Generated from TypeScript sources. Do not edit directly.
const SCHEMA_VERSION = "chzzk-kirinuki-edit-brief/v2";
const CODEX_JOB_SCHEMA_VERSION = "chzzk-kirinuki-codex-job/v2";
const STORAGE_KEY = "chzzkKirinukiProjectV1";
const WORKSPACE_META_KEY = "chzzkKirinukiWorkspaceMetaV1";
function normalizeWorkspaceMeta(raw) {
  return {
    resetEpoch: typeof raw?.resetEpoch === "string" && raw.resetEpoch ? raw.resetEpoch : "initial",
    revision: typeof raw?.revision === "number" && Number.isSafeInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0,
    writerId: typeof raw?.writerId === "string" ? raw.writerId : ""
  };
}
const nowIso = () => (/* @__PURE__ */ new Date()).toISOString();
function createInitialState() {
  return {
    schemaVersion: 1,
    editorProjectId: "",
    projectName: "",
    source: {
      platform: "CHZZK",
      url: "",
      canonicalUrl: "",
      channelId: "",
      contentId: "",
      contentType: "unknown",
      streamerName: "",
      broadcastTitle: "",
      broadcastStartedAt: "",
      clipActive: null,
      timeMachineActive: null,
      category: "",
      observedAt: ""
    },
    globalInstruction: "",
    draft: {
      startText: "",
      endText: "",
      description: "",
      startCapture: null,
      endCapture: null,
      editingId: null
    },
    segments: [],
    updatedAt: nowIso()
  };
}
function normalizeState(raw) {
  const initial = createInitialState();
  if (!raw || typeof raw !== "object") {
    return initial;
  }
  const candidate = raw;
  return {
    ...initial,
    ...candidate,
    source: { ...initial.source, ...candidate.source ?? {} },
    draft: { ...initial.draft, ...candidate.draft ?? {} },
    segments: Array.isArray(candidate.segments) ? candidate.segments : []
  };
}
function parseTimestamp(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  const input = String(value ?? "").trim();
  if (!input) {
    return null;
  }
  if (/^\d+(?:\.\d+)?$/.test(input)) {
    const seconds2 = Number(input);
    return Number.isFinite(seconds2) ? seconds2 : null;
  }
  const parts = input.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) {
    return null;
  }
  const numbers = parts.map(Number);
  if (numbers.some((part) => !Number.isFinite(part) || part < 0)) {
    return null;
  }
  if (parts.length === 2) {
    const [minutes2, seconds2] = numbers;
    if (seconds2 === void 0 || minutes2 === void 0 || seconds2 >= 60) {
      return null;
    }
    return minutes2 * 60 + seconds2;
  }
  const [hours, minutes, seconds] = numbers;
  if (hours === void 0 || minutes === void 0 || seconds === void 0 || minutes >= 60 || seconds >= 60) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
}
function formatTimestamp(value, { precision = 0 } = {}) {
  const parsed = parseTimestamp(value);
  if (parsed === null) {
    return "--:--:--";
  }
  const factor = 10 ** precision;
  const rounded = Math.round(parsed * factor) / factor;
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor(rounded % 3600 / 60);
  const seconds = rounded - hours * 3600 - minutes * 60;
  const wholeSeconds = Math.floor(seconds);
  const fraction = precision > 0 ? `.${String(Math.round((seconds - wholeSeconds) * factor)).padStart(precision, "0")}` : "";
  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    `${String(wholeSeconds).padStart(2, "0")}${fraction}`
  ].join(":");
}
function validateSegmentInput({ startText, endText, description }) {
  const startSeconds = parseTimestamp(startText);
  const endSeconds = parseTimestamp(endText);
  const note = String(description ?? "").trim();
  if (startSeconds === null) {
    return { ok: false, message: "\uC2DC\uC791 \uC2DC\uAC01\uC744 HH:MM:SS \uB610\uB294 \uCD08 \uB2E8\uC704\uB85C \uC785\uB825\uD574 \uC8FC\uC138\uC694." };
  }
  if (endSeconds === null) {
    return { ok: false, message: "\uB05D \uC2DC\uAC01\uC744 HH:MM:SS \uB610\uB294 \uCD08 \uB2E8\uC704\uB85C \uC785\uB825\uD574 \uC8FC\uC138\uC694." };
  }
  if (endSeconds <= startSeconds) {
    return { ok: false, message: "\uB05D \uC2DC\uAC01\uC740 \uC2DC\uC791 \uC2DC\uAC01\uBCF4\uB2E4 \uB4A4\uC5EC\uC57C \uD569\uB2C8\uB2E4." };
  }
  return { ok: true, startSeconds, endSeconds, description: note };
}
function createSegment({
  id = crypto.randomUUID(),
  startText,
  endText,
  description,
  startCapture = null,
  endCapture = null,
  createdAt = nowIso()
}) {
  const validation = validateSegmentInput({ startText, endText, description });
  if (!validation.ok) {
    throw new Error(validation.message);
  }
  return {
    id,
    startSeconds: validation.startSeconds,
    endSeconds: validation.endSeconds,
    description: validation.description,
    startCapture,
    endCapture,
    createdAt,
    updatedAt: createdAt
  };
}
function safeInline(value, fallback = "\uBBF8\uD655\uC778") {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || fallback;
}
function markdownQuote(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "> (\uC785\uB825 \uC5C6\uC74C)";
  }
  return text.split(/\r?\n/).map((line) => `> ${line || " "}`).join("\n");
}
function sanitizeFileName(value, fallback = "chzzk-kirinuki-edit-brief") {
  const cleaned = String(value ?? "").normalize("NFKC").replace(/[\\/:*?"<>|\u0000-\u001F]/g, "-").replace(/\s+/g, " ").replace(/-+/g, "-").trim().replace(/^[.\s-]+|[.\s-]+$/g, "").slice(0, 80);
  return cleaned || fallback;
}
function normalizeCreatorIdentity(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/^@+/, "").replace(/\s+/g, " ").trim();
}
function resolveCreatorPolicies({
  streamerName = "",
  additionalNames = []
} = {}, policyIndex = {}) {
  const names = [streamerName, ...Array.isArray(additionalNames) ? additionalNames : []].map(normalizeCreatorIdentity).filter(Boolean);
  const uniqueNames = [...new Set(names)];
  const policies = Array.isArray(policyIndex?.policies) ? policyIndex.policies : [];
  return policies.flatMap((policy) => {
    const artists = Array.isArray(policy.artists) ? policy.artists : [];
    const aliases = [policy.group, ...Array.isArray(policy.aliases) ? policy.aliases : []].filter(Boolean);
    const artistMatch = artists.find((artist) => uniqueNames.includes(normalizeCreatorIdentity(artist)));
    const groupMatch = aliases.find((alias) => uniqueNames.includes(normalizeCreatorIdentity(alias)));
    const matchedValue = artistMatch || groupMatch;
    if (!matchedValue) {
      return [];
    }
    return [{
      id: policy.id,
      group: policy.group,
      artists,
      sourceUrl: policy.sourceUrl,
      status: policy.status || "UNKNOWN",
      checkedAt: policy.checkedAt ?? null,
      matchedBy: {
        type: artistMatch ? "artist" : "group",
        input: uniqueNames.find((name) => name === normalizeCreatorIdentity(matchedValue)) || null,
        value: matchedValue
      }
    }];
  });
}
function compileCreatorPolicyMarkdown({
  basePolicyMarkdown = "",
  resolvedPolicies = []
} = {}) {
  const base = String(basePolicyMarkdown ?? "").trim();
  const matches = Array.isArray(resolvedPolicies) ? resolvedPolicies : [];
  const resolutionSection = matches.length === 0 ? [
    "# \uD604\uC7AC \uC791\uC5C5 \uB300\uC0C1 \uC790\uB3D9 \uC815\uCC45 \uB9E4\uCE6D",
    "",
    "- \uACB0\uACFC: `NO_REGISTERED_POLICY_MATCH`",
    "- \uBC29\uC1A1\uC778 \uC774\uB984\uACFC \uB4F1\uB85D \uC778\uB371\uC2A4\uAC00 \uC815\uD655\uD788 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC558\uB2E4. \uAE30\uBCF8 \uADDC\uC815\uC744 \uC801\uC6A9\uD558\uACE0 \uACF5\uC2DD \uC815\uCC45\uC744 \uBCC4\uB3C4\uB85C \uD655\uC778\uD55C\uB2E4."
  ].join("\n") : [
    "# \uD604\uC7AC \uC791\uC5C5 \uB300\uC0C1 \uC790\uB3D9 \uC815\uCC45 \uB9E4\uCE6D",
    "",
    "> \uC774 \uC139\uC158\uC740 \uC815\uCC45 \uBCF8\uBB38\uC744 \uBCF5\uC81C\uD558\uC9C0 \uC54A\uACE0 \uBC29\uC1A1\uC778\uACFC \uACF5\uC2DD \uC815\uCC45 \uC6D0\uBB38\uC758 \uC704\uCE58\uB9CC \uC5F0\uACB0\uD55C\uB2E4. \uC791\uC5C5 \uC2DC\uC810\uC5D0 \uACF5\uC2DD URL\uC744 \uB2E4\uC2DC \uC5F4\uC5B4 \uCD5C\uC2E0 \uBCF8\uBB38\uC744 \uD655\uC778\uD574\uC57C \uD55C\uB2E4.",
    "",
    ...matches.flatMap((policy, index) => {
      return [
        `## \uB9E4\uCE6D ${index + 1}: ${safeInline(policy.matchedBy?.value)} \u2192 ${safeInline(policy.group)}`,
        "",
        `- Match type: \`EXACT_${safeInline(policy.matchedBy?.type).toUpperCase()}\``,
        `- Policy ID: \`${safeInline(policy.id)}\``,
        `- Official policy source: ${safeInline(policy.sourceUrl)}`,
        `- Last access status: \`${safeInline(policy.status)}\``,
        `- Last checked at: ${safeInline(policy.checkedAt)}`,
        "- Runtime rule: \uC791\uC5C5\uC744 \uC2DC\uC791\uD560 \uB54C \uACF5\uC2DD \uB9C1\uD06C\uB97C \uB2E4\uC2DC \uC5F4\uACE0 \uCD5C\uC2E0 \uC6D0\uBB38\uC744 \uAE30\uC900\uC73C\uB85C \uD575\uC2EC \uC870\uD56D\uC744 \uCD94\uCD9C\uD55C\uB2E4.",
        "- Redistribution: `LINK_ONLY` \u2014 \uC815\uCC45 \uBCF8\uBB38\uC774\uB098 \uACFC\uAC70 \uD655\uC778\uBCF8\uC740 Extension \uBC0F \uC791\uC5C5\uD3F4\uB354\uC5D0 \uBCF5\uC81C\uD558\uC9C0 \uC54A\uB294\uB2E4."
      ];
    })
  ].join("\n");
  return [resolutionSection, base].filter(Boolean).join("\n\n---\n\n");
}
const captureDetails = (capture) => {
  if (!capture || typeof capture !== "object") {
    return "\uC9C1\uC811 \uC785\uB825";
  }
  const items = [safeInline(capture.method, "\uC9C1\uC811 \uC785\uB825")];
  if (capture.observedAt) {
    items.push(`\uAD00\uCE21 ${capture.observedAt}`);
  }
  if (Number.isFinite(capture.liveEdgeOffsetSeconds)) {
    items.push(`\uB77C\uC774\uBE0C \uC5E3\uC9C0 \uB300\uBE44 \uC57D ${capture.liveEdgeOffsetSeconds.toFixed(1)}\uCD08 \uC9C0\uC5F0`);
  }
  return items.join(" \xB7 ");
};
const buildMachineMetadata = ({
  projectName,
  source,
  globalInstruction,
  segments,
  resolvedCreatorPolicies = [],
  generatedAt
}) => ({
  schema: SCHEMA_VERSION,
  generatedAt,
  projectName: projectName || null,
  source: {
    platform: source.platform || "CHZZK",
    url: source.url || null,
    canonicalUrl: source.canonicalUrl || null,
    channelId: source.channelId || null,
    contentId: source.contentId || null,
    contentType: source.contentType || "unknown",
    streamerName: source.streamerName || null,
    broadcastTitle: source.broadcastTitle || null,
    broadcastStartedAt: source.broadcastStartedAt || null,
    clipActive: typeof source.clipActive === "boolean" ? source.clipActive : null,
    timeMachineActive: typeof source.timeMachineActive === "boolean" ? source.timeMachineActive : null,
    category: source.category || null,
    observedAt: source.observedAt || null
  },
  globalInstruction: globalInstruction || null,
  policyGates: {
    revenueHumanReview: "PENDING",
    musicHumanReview: "PENDING",
    thirdPartyCrossCheck: "REQUIRED_IF_PRESENT",
    automaticPublication: "BLOCKED"
  },
  creatorPolicyResolution: resolvedCreatorPolicies.map((policy) => ({
    id: policy.id,
    group: policy.group,
    sourceUrl: policy.sourceUrl,
    status: policy.status,
    checkedAt: policy.checkedAt ?? null,
    redistribution: "LINK_ONLY",
    matchedBy: policy.matchedBy ?? null
  })),
  segments: segments.map((segment, index) => ({
    order: index + 1,
    id: segment.id,
    selectionStartSeconds: segment.startSeconds,
    selectionEndSeconds: segment.endSeconds,
    authority: "USER",
    userNote: segment.description,
    startCapture: segment.startCapture ?? null,
    endCapture: segment.endCapture ?? null
  }))
});
function generateEditPrompt({
  projectName = "",
  source = {},
  globalInstruction = "",
  segments = [],
  editingGuideMarkdown = "",
  creatorPolicyMarkdown = "",
  resolvedCreatorPolicies = [],
  generatedAt = nowIso()
}) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("\uD504\uB86C\uD504\uD2B8\uB97C \uB9CC\uB4E4\uB824\uBA74 \uAD6C\uAC04\uC744 \uD558\uB098 \uC774\uC0C1 \uC800\uC7A5\uD574\uC57C \uD569\uB2C8\uB2E4.");
  }
  const orderedSegments = [...segments];
  const metadata = buildMachineMetadata({
    projectName,
    source,
    globalInstruction,
    segments: orderedSegments,
    resolvedCreatorPolicies,
    generatedAt
  });
  const segmentSections = orderedSegments.map((segment, index) => {
    const duration = Math.max(0, segment.endSeconds - segment.startSeconds);
    return [
      `### \uAD6C\uAC04 ${index + 1}`,
      "",
      `- \uD655\uC815 \uC2DC\uC791 \uC2DC\uAC01: \`${formatTimestamp(segment.startSeconds, { precision: 3 })}\``,
      `- \uD655\uC815 \uC885\uB8CC \uC2DC\uAC01: \`${formatTimestamp(segment.endSeconds, { precision: 3 })}\``,
      `- \uC120\uD0DD \uBC94\uC704 \uAE38\uC774: \uC57D ${duration.toFixed(3)}\uCD08`,
      "- \uACBD\uACC4 \uAD8C\uD55C: `USER` \u2014 \uC790\uB3D9\uC73C\uB85C \uD655\uC7A5\xB7\uCD95\uC18C\xB7\uBCD1\uD569\uD558\uC9C0 \uC54A\uC74C",
      `- \uC2DC\uC791\uAC12 \uCD9C\uCC98: ${captureDetails(segment.startCapture)}`,
      `- \uB05D\uAC12 \uCD9C\uCC98: ${captureDetails(segment.endCapture)}`,
      "- \uC0AC\uC6A9\uC790 \uBA54\uBAA8:",
      "",
      markdownQuote(segment.description)
    ].join("\n");
  }).join("\n\n");
  const editingGuide = String(editingGuideMarkdown ?? "").trim() || "(\uB0B4\uC7A5 \uD3B8\uC9D1 \uC9C0\uCE68\uC744 \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC0AC\uC6A9\uC790\uC5D0\uAC8C \uD655\uC778\uD55C \uB4A4 \uC9C4\uD589\uD558\uC138\uC694.)";
  const creatorPolicy = String(creatorPolicyMarkdown ?? "").trim() || "(\uBC29\uC1A1\uC778\uBCC4 \uC815\uCC45\uC774 \uB4F1\uB85D\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4. \uACF5\uAC1C \uB610\uB294 \uAC8C\uC2DC \uC804\uC5D0 \uBC18\uB4DC\uC2DC \uAD8C\uB9AC\uC640 \uADDC\uC815\uC744 \uD655\uC778\uD558\uC138\uC694.)";
  const sourcePlatform = safeInline(source.platform, "CHZZK");
  const sourcePlatformUpper = sourcePlatform.toUpperCase();
  const sourceDescription = sourcePlatformUpper === "YOUTUBE" ? "YouTube VOD" : "\uCE58\uC9C0\uC9C1 \uBC29\uC1A1\xB7\uB2E4\uC2DC\uBCF4\uAE30";
  const platformSpecificMetadata = sourcePlatformUpper === "CHZZK" ? [
    `- \uBC29\uC1A1 \uC2DC\uC791 \uC2DC\uAC01(CHZZK): ${safeInline(source.broadcastStartedAt)}`,
    `- \uCE58\uC9C0\uC9C1 \uD074\uB9BD \uC124\uC815: ${typeof source.clipActive === "boolean" ? source.clipActive ? "\uD5C8\uC6A9" : "\uBBF8\uD5C8\uC6A9" : "\uBBF8\uD655\uC778"}`
  ].join("\n") : `- \uAC8C\uC2DC\xB7\uBC29\uC1A1 \uC2DC\uC791 \uC2DC\uAC01: ${safeInline(source.broadcastStartedAt)}`;
  return `# Codex \uC601\uC0C1 \uC804\uCC98\uB9AC \uC791\uC5C5 \uC694\uCCAD\uC11C

> \uC2A4\uD0A4\uB9C8: \`${SCHEMA_VERSION}\`
> \uC0DD\uC131 \uC2DC\uAC01: ${generatedAt}
> \uC774 \uBB38\uC11C\uB294 \uD0A4\uB9AC\uB204\uD0A4 \uC2A4\uD29C\uB514\uC624 Extension\uC774 \uB3D9\uC77C\uD55C \uADDC\uACA9\uC73C\uB85C \uC0DD\uC131\uD588\uC2B5\uB2C8\uB2E4.

## 1. \uC2E4\uD589 \uBAA9\uD45C

\uD568\uAED8 \uC81C\uACF5\uB41C ${sourceDescription} \uB85C\uCEEC \uC6D0\uBCF8 \uD30C\uC77C\uC744 \uC2E4\uC81C\uB85C \uBD84\uC11D\uD558\uACE0 \uD3B8\uC9D1\uD558\uC5EC, \uC544\uB798 \uC0AC\uC6A9\uC790\uAC00 \uD655\uC815\uD55C \uAD6C\uAC04\uB4E4\uC744 \uADF8\uB300\uB85C \uC5F0\uACB0\uD55C \uD55C\uAD6D\uC5B4 \uC790\uB9C9 \uD3EC\uD568 \uAC80\uC218\uC6A9 \uC601\uC0C1\uC744 \uC0DD\uC131\uD558\uC138\uC694. \uC124\uBA85\uB9CC \uB2F5\uD558\uC9C0 \uB9D0\uACE0, \uAC00\uB2A5\uD55C \uB85C\uCEEC \uBBF8\uB514\uC5B4 \uB3C4\uAD6C\uB97C \uC0AC\uC6A9\uD574 \uACB0\uACFC \uD30C\uC77C\uC744 \uB9CC\uB4DC\uC138\uC694.

\uAC01 \uC2DC\uC791\xB7\uC885\uB8CC \uD0C0\uC784\uC2A4\uD0EC\uD504\uB294 \uC0AC\uC6A9\uC790\uAC00 \uC120\uD0DD\uD55C **\uAD8C\uC704 \uC788\uB294 \uCD5C\uC885 \uCEF7 \uACBD\uACC4**\uC785\uB2C8\uB2E4. AI\uB098 \uD6C4\uC18D \uC5D0\uC774\uC804\uD2B8\uB294 \uC774\uB97C \uC790\uB3D9\uC73C\uB85C \uD655\uC7A5\xB7\uCD95\uC18C\xB7\uBCD1\uD569\xB7\uC7AC\uC815\uB82C\uD558\uC9C0 \uB9C8\uC138\uC694. \uC74C\uC131 \uC778\uC2DD\uC5D0 \uBB38\uB9E5\uC774 \uD544\uC694\uD558\uBA74 \uACBD\uACC4 \uBC16 \uB370\uC774\uD130\uB97C \uC784\uC2DC \uBD84\uC11D\uD560 \uC218 \uC788\uC9C0\uB9CC \uACB0\uACFC \uC601\uC0C1\uACFC \uC790\uB9C9 cue\uB294 \uBC18\uB4DC\uC2DC \uC120\uD0DD \uBC94\uC704 \uC548\uC73C\uB85C \uC81C\uD55C\uD558\uC138\uC694. \uACBD\uACC4\uAC00 \uC5B4\uC0C9\uD574 \uBCF4\uC5EC\uB3C4 \uC870\uC6A9\uD788 \uACE0\uCE58\uC9C0 \uB9D0\uACE0 \uAC80\uC218 \uBA54\uBAA8\uC5D0 \uC81C\uC548\uB9CC \uB0A8\uAE30\uC138\uC694.

**\uD3B8\uC9D1\uC744 \uC2DC\uC791\uD558\uAE30 \uC804\uC5D0 \uC815\uCC45 \uD504\uB9AC\uD50C\uB77C\uC774\uD2B8\uB97C \uBA3C\uC800 \uC218\uD589\uD558\uC138\uC694.** \uBC29\uC1A1\uC778\uBCC4 \uCD5C\uC2E0 \uACF5\uC2DD \uC815\uCC45\uC740 Extension \uAE30\uBCF8 \uADDC\uC815\uBCF4\uB2E4 \uC6B0\uC120\uD569\uB2C8\uB2E4. \uB2E4\uB9CC \uC218\uC775 \uAD00\uB828 \uC870\uD56D\uACFC \uC74C\uC6D0\uC740 \uC815\uCC45\uC774 \uD5C8\uC6A9\uD558\uB294 \uAC83\uCC98\uB7FC \uBCF4\uC5EC\uB3C4 \uC0AC\uB78C\uC774 \uBC18\uB4DC\uC2DC \uB2E4\uC2DC \uD655\uC778\uD574\uC57C \uD558\uBA70, \uC81C3\uC790\uAC00 \uB4F1\uC7A5\uD558\uBA74 \uADF8 \uC81C3\uC790\uC758 \uC815\uCC45\uC744 \uBAA8\uB450 \uAD50\uCC28\uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4. \uB9C1\uD06C \uBCF8\uBB38\uC744 \uC77D\uC9C0 \uBABB\uD55C \uACBD\uC6B0 \uC870\uD56D\uC744 \uCD94\uC815\uD558\uC9C0 \uB9D0\uACE0 **SOURCE_UNREADABLE**\uB85C \uAE30\uB85D\uD558\uC138\uC694.

## 2. \uD504\uB85C\uC81D\uD2B8\uC640 \uC6D0\uBCF8

- \uD504\uB85C\uC81D\uD2B8\uBA85: ${safeInline(projectName, "\uBBF8\uC9C0\uC815")}
- \uD50C\uB7AB\uD3FC: ${sourcePlatform}
- \uBC29\uC1A1\uC778/\uCC44\uB110\uBA85: ${safeInline(source.streamerName)}
- \uBC29\uC1A1 \uC81C\uBAA9: ${safeInline(source.broadcastTitle)}
${platformSpecificMetadata}
- \uCE74\uD14C\uACE0\uB9AC: ${safeInline(source.category)}
- \uCF58\uD150\uCE20 \uC720\uD615: ${safeInline(source.contentType)}
- \uCC44\uB110 ID: ${safeInline(source.channelId)}
- \uCF58\uD150\uCE20 ID: ${safeInline(source.contentId)}
- \uC6D0\uBCF8 URL: ${safeInline(source.canonicalUrl || source.url)}
- Extension \uAD00\uCE21 \uC2DC\uAC01: ${safeInline(source.observedAt)}

## 3. \uBC29\uC1A1 \uC804\uCCB4\uC5D0 \uC801\uC6A9\uD560 \uC0AC\uC6A9\uC790 \uC9C0\uC2DC

${markdownQuote(globalInstruction || "\uBCC4\uB3C4 \uC9C0\uC2DC \uC5C6\uC74C. \uC544\uB798 \uAD6C\uAC04\uBCC4 \uD3B8\uC9D1 \uC758\uB3C4\uC640 \uB0B4\uC7A5 \uC9C0\uCE68\uC744 \uC6B0\uC120 \uC801\uC6A9\uD560 \uAC83.")}

## 4. \uC0AC\uC6A9\uC790\uAC00 \uD655\uC815\uD55C \uCEF7 \uAD6C\uAC04

${segmentSections}

## 5. \uD3B8\uC9D1 \uC218\uD589 \uC21C\uC11C

1. \uC774 \uBB38\uC11C\uC640 \uBC29\uC1A1\uC778 \uC815\uCC45 \uC790\uB8CC\uC758 \uBAA8\uB4E0 \uB9C1\uD06C\xB7\uADFC\uAC70\uB97C \uC810\uAC80\uD558\uACE0 policy-check.md\uB97C \uBA3C\uC800 \uB9CC\uB4DC\uC138\uC694. \uC811\uADFC\uD560 \uC218 \uC5C6\uB294 \uB9C1\uD06C\uB294 \uAC80\uC99D\uB41C \uAC83\uC73C\uB85C \uCDE8\uAE09\uD558\uC9C0 \uB9C8\uC138\uC694.
2. \uC601\uC0C1\uC5D0 \uB4F1\uC7A5\uD558\uB294 \uBC29\uC1A1\uC778, \uAC8C\uC2A4\uD2B8, \uD569\uBC29 \uCC38\uC5EC\uC790, \uC74C\uC131 \uD1B5\uD654 \uCC38\uC5EC\uC790\uC640 \uC2DD\uBCC4 \uAC00\uB2A5\uD55C \uC81C3\uC790\uB97C \uBAA9\uB85D\uD654\uD558\uACE0 \uAC01\uC790\uC758 \uC815\uCC45\uC744 \uAD50\uCC28\uD655\uC778\uD558\uC138\uC694.
3. \uC218\uC775 \uAD00\uB828 \uC0C1\uD0DC\uC640 \uC74C\uC6D0 \uC0C1\uD0DC\uB294 \uBC18\uB4DC\uC2DC PENDING\uC73C\uB85C \uC2DC\uC791\uD558\uACE0, \uC0AC\uB78C\uC758 \uBA85\uC2DC\uC801 \uD655\uC778 \uC5C6\uC774\uB294 \uC2B9\uC778\uD558\uC9C0 \uB9C8\uC138\uC694.
4. \uC785\uB825 \uC601\uC0C1\uC758 \uC2E4\uC81C \uC7AC\uC0DD\uC2DC\uAC04, \uD504\uB808\uC784\uB808\uC774\uD2B8, \uC624\uB514\uC624 \uD2B8\uB799\uC744 \uD655\uC778\uD558\uC138\uC694.
5. \uAC01 \uC0AC\uC6A9\uC790 \uC120\uD0DD \uBC94\uC704\uC758 \uC74C\uC131\uC744 \uC804\uC0AC\uD558\uC138\uC694. \uC778\uC2DD\uC6A9 \uBB38\uB9E5\uC744 \uCD94\uAC00\uB85C \uC77D\uB354\uB77C\uB3C4 \uC120\uD0DD \uBC94\uC704 \uBC16\uC758 \uC74C\uC131\uACFC \uC601\uC0C1\uC740 \uACB0\uACFC\uC5D0 \uD3EC\uD568\uD558\uC9C0 \uB9C8\uC138\uC694.
6. \uC2DC\uC791\xB7\uC885\uB8CC \uC2DC\uAC01\uC744 \uC785\uB825\uAC12 \uADF8\uB300\uB85C \uBCF4\uC874\uD558\uC138\uC694. \uACBD\uACC4 \uBCC0\uACBD\uC774 \uB354 \uC88B\uC544 \uBCF4\uC5EC\uB3C4 \uC790\uB3D9 \uBC18\uC601\uD558\uC9C0 \uB9D0\uACE0 \`review-notes.md\`\uC5D0 \uC120\uD0DD\uC801 \uC81C\uC548\uC73C\uB85C\uB9CC \uB0A8\uAE30\uC138\uC694.
7. \uACB9\uCE58\uAC70\uB098 \uAC19\uC740 \uC0AC\uAC74\uC5D0 \uC18D\uD55C \uC120\uD0DD\uB3C4 \uC790\uB3D9 \uBCD1\uD569\uD558\uAC70\uB098 \uC0AD\uC81C\uD558\uC9C0 \uB9C8\uC138\uC694. \uAC01 \uC0AC\uC6A9\uC790 \uC120\uD0DD\uC744 \uC815\uD655\uD788 \uD55C \uBC88\uC529 \uC720\uC9C0\uD558\uC138\uC694.
8. \uBCC4\uB3C4 \uC9C0\uC2DC\uAC00 \uC5C6\uC73C\uBA74 \uC0AC\uC6A9\uC790\uAC00 \uC800\uC7A5\uD55C \uC21C\uC11C\uB300\uB85C \uC5F0\uACB0\uD558\uC138\uC694.
9. \uC6D0\uBB38\uC758 \uC758\uBBF8\uC640 \uB9D0\uD22C\uB97C \uBCF4\uC874\uD55C \uD55C\uAD6D\uC5B4 \uC790\uB9C9 \uCD08\uC548\uC744 \uB9CC\uB4E4\uACE0, \uC77D\uAE30 \uC88B\uC740 \uD638\uD761\uC73C\uB85C \uB098\uB204\uB418 \uBAA8\uB4E0 cue\uB97C \uD574\uB2F9 \uC120\uD0DD \uBC94\uC704 \uC548\uC73C\uB85C \uC81C\uD55C\uD558\uC138\uC694. \uB4E4\uB9AC\uC9C0 \uC54A\uB294 \uB0B4\uC6A9\uC744 \uCD94\uCE21\uD558\uC9C0 \uB9C8\uC138\uC694.
10. \uC815\uCC45\uC0C1 \uBE44\uACF5\uAC1C \uAC80\uC218\uBCF8 \uC81C\uC791\uC774 \uAC00\uB2A5\uD55C \uBC94\uC704\uC5D0\uC11C \uC601\uC0C1\uC744 \uB80C\uB354\uB9C1\uD558\uACE0 \uC544\uB798 \uD544\uC218 \uC0B0\uCD9C\uBB3C\uC744 \uD568\uAED8 \uB0A8\uAE30\uC138\uC694.

## 6. \uD544\uC218 \uC0B0\uCD9C\uBB3C

- **policy-check.md**: \uCD9C\uC5F0\uC790\xB7\uC81C3\uC790\xB7\uC74C\uC6D0\xB7\uC218\uC775\xB7\uD50C\uB7AB\uD3FC\uBCC4 \uC815\uCC45 \uADFC\uAC70\uC640 \uC0AC\uB78C \uAC80\uC218 \uAC8C\uC774\uD2B8
- \`edited-preview.mp4\`: \uC120\uD0DD \uAD6C\uAC04\uC744 \uC5F0\uACB0\uD558\uACE0 \uD55C\uAD6D\uC5B4 \uC790\uB9C9\uC744 \uC785\uD78C \uAC80\uC218\uC6A9 \uC601\uC0C1
- \`edit-plan.json\`: \uC0AC\uC6A9\uC790\uAC00 \uD655\uC815\uD55C \uC6D0\uBCF8 \uAE30\uC900 \uCEF7 \uC2DC\uC791/\uB05D, \uC21C\uC11C, \uAD8C\uD55C\uACFC \uCC98\uB9AC \uC0C1\uD0DC
- \`subtitles.ko.srt\`: \uCD5C\uC885 \uC601\uC0C1 \uAE30\uC900 \uD55C\uAD6D\uC5B4 \uC790\uB9C9
- \`review-notes.md\`: \uBD88\uD655\uC2E4\uD55C \uBC1C\uD654, \uC120\uD0DD\uC801 \uACBD\uACC4 \uAC1C\uC120 \uC81C\uC548, \uC0AC\uB78C\uC774 \uD655\uC778\uD560 \uD56D\uBAA9

\uC790\uB3D9\uC73C\uB85C \uC5C5\uB85C\uB4DC\uD558\uAC70\uB098 \uAC8C\uC2DC\uD558\uC9C0 \uB9C8\uC138\uC694. \uACB0\uACFC\uB294 \uBC18\uB4DC\uC2DC \uC0AC\uB78C\uC774 \uAC80\uC218\uD560 \uC218 \uC788\uB294 \uC0C1\uD0DC\uB85C \uB05D\uB0B4\uC138\uC694.

## 7. Extension \uB0B4\uC7A5 \uD3B8\uC9D1 \uC9C0\uCE68

${editingGuide}

## 8. \uBC29\uC1A1\uC778\xB7\uC544\uD2F0\uC2A4\uD2B8 \uC815\uCC45 \uC790\uB8CC\uC640 \uAE30\uBCF8 \uADDC\uC815

${creatorPolicy}

## 9. \uAE30\uACC4 \uD310\uB3C5\uC6A9 \uC6D0\uBCF8 \uBA54\uD0C0\uB370\uC774\uD130

\uC544\uB798 JSON\uC740 \uC0AC\uC6A9\uC790 \uC785\uB825\uACFC \uD655\uC815 \uCEF7\uC758 \uC6D0\uBCF8\uAC12\uC785\uB2C8\uB2E4. \uC790\uC5F0\uC5B4 \uC139\uC158\uACFC \uCDA9\uB3CC\uD560 \uACBD\uC6B0 \`authority: "USER"\`\uC778 \uC218\uCE58 \uAC12\uC744 \uBCF4\uC874\uD558\uACE0 \`review-notes.md\`\uC5D0 \uCDA9\uB3CC\uC744 \uAE30\uB85D\uD558\uC138\uC694.

\`\`\`json
${JSON.stringify(metadata, null, 2)}
\`\`\`

## 10. \uC644\uB8CC \uC870\uAC74

\uD544\uC218 \uC0B0\uCD9C\uBB3C \uB2E4\uC12F \uAC1C\uAC00 \uC2E4\uC81C\uB85C \uC0DD\uC131\uB418\uACE0, \uAC01 \uC0AC\uC6A9\uC790 \uD655\uC815 \uAD6C\uAC04\uC774 \uC6D0\uB798 \uACBD\uACC4\uC640 \uC21C\uC11C\uB300\uB85C \uC815\uD655\uD788 \uD55C \uBC88 \uD3EC\uD568\uB418\uC5C8\uC73C\uBA70, \uC790\uB9C9\uACFC \uC601\uC0C1 \uC2F1\uD06C\uB97C \uD655\uC778\uD55C \uB4A4 \uC791\uC5C5\uC744 \uC644\uB8CC\uB85C \uBCF4\uACE0\uD558\uC138\uC694. \uC218\uC775\xB7\uC74C\uC6D0 \uC0AC\uB78C \uAC80\uC218\uAC00 PENDING\uC774\uAC70\uB098 \uC81C3\uC790 \uC815\uCC45\uC774 \uBBF8\uD655\uC778\uC774\uB77C\uBA74 \uBE44\uACF5\uAC1C \uAC80\uC218\uBCF8\uAE4C\uC9C0\uB9CC \uC644\uB8CC\uD558\uACE0 \uACF5\uAC1C \uAC00\uB2A5\uD558\uB2E4\uACE0 \uD45C\uD604\uD558\uC9C0 \uB9C8\uC138\uC694.
`;
}
function buildCodexJobManifest({
  projectName = "",
  source = {},
  globalInstruction = "",
  segments = [],
  resolvedCreatorPolicies = [],
  generatedAt = nowIso()
} = {}) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("Codex \uC791\uC5C5 \uD3F4\uB354\uB97C \uB9CC\uB4E4\uB824\uBA74 \uAD6C\uAC04\uC744 \uD558\uB098 \uC774\uC0C1 \uC800\uC7A5\uD574\uC57C \uD569\uB2C8\uB2E4.");
  }
  const metadata = buildMachineMetadata({
    projectName,
    source,
    globalInstruction,
    segments,
    resolvedCreatorPolicies,
    generatedAt
  });
  return {
    schema: CODEX_JOB_SCHEMA_VERSION,
    generatedAt,
    status: "AWAITING_SOURCE_VIDEO",
    projectName: projectName || null,
    source: metadata.source,
    inputs: {
      agentInstructions: "AGENTS.md",
      startGuide: "START_HERE.md",
      editBrief: "edit-brief.md",
      creatorPolicy: "creator-policy.md",
      creatorPolicyIndex: "creator-policy-index.json",
      fullVideo: {
        location: "job-folder-root",
        required: true,
        expectedCount: 1,
        status: "USER_TO_ADD",
        supportedExtensions: [".mp4", ".mkv", ".mov", ".webm", ".m4v"]
      }
    },
    userIntent: {
      globalInstruction: globalInstruction || null,
      selections: metadata.segments
    },
    creatorPolicyResolution: metadata.creatorPolicyResolution,
    policyGates: metadata.policyGates,
    execution: {
      scope: "PRIVATE_REVIEW_PREPROCESSING_ONLY",
      preserveSourceVideo: true,
      uploadSourceVideo: "FORBIDDEN",
      automaticPublication: "FORBIDDEN",
      requiredOutputs: [
        "policy-check.md",
        "edited-preview.mp4",
        "edit-plan.json",
        "subtitles.ko.srt",
        "review-notes.md"
      ]
    }
  };
}
function generateCodexStartHere({
  projectName = "",
  source = {},
  generatedAt = nowIso()
} = {}) {
  const title = safeInline(projectName, "\uC774\uB984 \uC5C6\uB294 \uD0A4\uB9AC\uB204\uD0A4 \uC791\uC5C5");
  const streamer = safeInline(source.streamerName);
  const platform = safeInline(source.platform, "CHZZK").toUpperCase();
  const sourceExample = platform === "YOUTUBE" ? "\uBCF8\uC778\uC774 \uC18C\uC720\uD558\uAC70\uB098 \uC0AC\uC6A9 \uD5C8\uAC00\uB97C \uBC1B\uC740 YouTube \uC6D0\uBCF8" : "\uCE58\uC9C0\uC9C1 \uACF5\uC2DD \uB2E4\uC2DC\uBCF4\uAE30 \uB4F1 \uC801\uBC95\uD558\uAC8C \uC900\uBE44\uD55C \uC6D0\uBCF8";
  const command = "\uC774 \uD3F4\uB354\uC758 AGENTS.md, START_HERE.md, edit-brief.md, creator-policy.md, creator-policy-index.json\uACFC job-manifest.json\uC744 \uC77D\uACE0 \uC791\uC5C5\uC744 \uB05D\uAE4C\uC9C0 \uC2E4\uD589\uD574\uC918. \uACF5\uC2DD \uC815\uCC45 \uB9C1\uD06C\uC758 \uCD5C\uC2E0 \uC6D0\uBB38\uC744 \uBA3C\uC800 \uD655\uC778\uD574 \uC815\uCC45 \uD504\uB9AC\uD50C\uB77C\uC774\uD2B8\uB97C \uC218\uD589\uD558\uACE0, \uC218\uC775\xB7\uC74C\uC6D0\xB7\uC81C3\uC790 \uD655\uC778\uC774 \uD544\uC694\uD55C \uBD80\uBD84\uC740 policy-check.md\uC5D0 \uBCF4\uB958 \uC0C1\uD0DC\uB85C \uB0A8\uAE34 \uB4A4 \uBE44\uACF5\uAC1C \uAC80\uC218\uC6A9 \uC601\uC0C1\uAE4C\uC9C0\uB9CC \uB9CC\uB4E4\uC5B4\uC918. \uC6D0\uBCF8 \uC601\uC0C1\uC740 \uBCC0\uACBD\uD558\uC9C0 \uB9C8.";
  return `# Codex \uC791\uC5C5 \uC2DC\uC791 \uC548\uB0B4

> \uD504\uB85C\uC81D\uD2B8: ${title}
> \uBC29\uC1A1\uC778/\uCC44\uB110: ${streamer}
> \uC791\uC5C5 \uD3F4\uB354 \uC0DD\uC131 \uC2DC\uAC01: ${generatedAt}

\uC774 \uD3F4\uB354\uB294 \uCF54\uB529\uC744 \uBAB0\uB77C\uB3C4 Codex\uC5D0 \uADF8\uB300\uB85C \uC5F4\uC5B4 \uC791\uC5C5\uD560 \uC218 \uC788\uB294 \uD0A4\uB9AC\uB204\uD0A4 \uC804\uCC98\uB9AC \uD328\uD0A4\uC9C0\uC785\uB2C8\uB2E4. Extension\uC740 \uC601\uC0C1\uC744 \uD3EC\uD568\uD558\uC9C0 \uC54A\uC73C\uBA70 \uACF5\uAC1C\xB7\uC5C5\uB85C\uB4DC\xB7\uC218\uC775\uD654\uB3C4 \uC218\uD589\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.

## 1. \uD480\uC601\uC0C1 \uB123\uAE30

${sourceExample} \uD480\uC601\uC0C1 \uD30C\uC77C **\uD558\uB098\uB9CC** \uC774 \uD3F4\uB354\uC758 \uCD5C\uC0C1\uC704\uC5D0 \uB123\uC73C\uC138\uC694. \uC9C0\uC6D0 \uB300\uC0C1\uC740 MP4, MKV, MOV, WEBM, M4V\uC785\uB2C8\uB2E4. \uC6D0\uBCF8 \uC601\uC0C1\uC740 \uC774\uB984\uC744 \uBC14\uAFB8\uC9C0 \uC54A\uC544\uB3C4 \uB429\uB2C8\uB2E4.

## 2. Codex\uC5D0\uC11C \uD3F4\uB354 \uC5F4\uAE30

Codex \uC571\uC774\uB098 Codex\uAC00 \uC5F0\uACB0\uB41C \uAC1C\uBC1C \uD658\uACBD\uC5D0\uC11C \uC774 \uD3F4\uB354\uB97C \uD504\uB85C\uC81D\uD2B8\uB85C \uC5EC\uC138\uC694. **AGENTS.md**\uAC00 \uC791\uC5C5 \uADDC\uCE59\uC744, **edit-brief.md**\uAC00 \uAD6C\uAC04\uACFC \uC790\uC5F0\uC5B4 \uD3B8\uC9D1 \uC758\uB3C4\uB97C, **creator-policy-index.json**\uC774 \uBC29\uC1A1\uC778\uACFC \uACF5\uC2DD \uC815\uCC45 \uB9C1\uD06C\uC758 \uAD00\uACC4\uB97C \uC81C\uACF5\uD569\uB2C8\uB2E4. \uC815\uCC45 \uBCF8\uBB38\uC740 \uC7AC\uBC30\uD3EC\uD558\uC9C0 \uC54A\uC73C\uBBC0\uB85C \uC791\uC5C5 \uC2DC\uC810\uC5D0 \uACF5\uC2DD \uB9C1\uD06C\uB97C \uC9C1\uC811 \uD655\uC778\uD558\uC138\uC694.

## 3. \uC544\uB798 \uD55C \uBB38\uC7A5 \uC804\uC1A1\uD558\uAE30

    ${command}

## \uC0AC\uB78C\uC774 \uBC18\uB4DC\uC2DC \uD655\uC778\uD560 \uAC83

- \uC218\uC775\xB7\uC0C1\uC5C5 \uC774\uC6A9 \uC0C1\uD0DC\uB294 \uC0AC\uB78C\uC774 \uC2B9\uC778\uD558\uAE30 \uC804\uAE4C\uC9C0 **HUMAN_REVENUE_REVIEW: PENDING**\uC785\uB2C8\uB2E4.
- \uC74C\uC6D0\xB7\uAC00\uCC3D\xB7\uAC8C\uC784 \uC74C\uC545\uC740 \uC0AC\uB78C\uC774 \uC2B9\uC778\uD558\uAE30 \uC804\uAE4C\uC9C0 **HUMAN_MUSIC_REVIEW: PENDING**\uC785\uB2C8\uB2E4.
- \uC81C3\uC790\uAC00 \uB4F1\uC7A5\uD558\uBA74 \uADF8 \uC0AC\uB78C\uACFC \uC18C\uC18D \uADF8\uB8F9\uC758 \uC815\uCC45\uC774 \uBAA8\uB450 \uAD50\uCC28\uD655\uC778\uB418\uC5B4\uC57C \uD569\uB2C8\uB2E4.
- \uB124\uC774\uBC84 \uCE74\uD398 \uB9C1\uD06C\uC758 \uBCF8\uBB38\uC744 \uC77D\uC9C0 \uBABB\uD558\uBA74 \uD5C8\uC6A9\uC73C\uB85C \uCD94\uC815\uD558\uC9C0 \uC54A\uACE0 **SOURCE_UNREADABLE**\uB85C \uB0A8\uAE41\uB2C8\uB2E4.
- \uACB0\uACFC\uBB3C\uC740 \uBE44\uACF5\uAC1C \uAC80\uC218\uBCF8\uC785\uB2C8\uB2E4. \uAC8C\uC2DC\xB7\uC5C5\uB85C\uB4DC\xB7\uC218\uC775\uD654\uB294 \uBCC4\uB3C4 \uC0AC\uB78C \uAC80\uC218 \uB4A4\uC5D0\uB9CC \uC9C4\uD589\uD558\uC138\uC694.

## \uC644\uB8CC \uC2DC \uC0DD\uAE30\uB294 \uD30C\uC77C

- **policy-check.md**
- **edited-preview.mp4**
- **edit-plan.json**
- **subtitles.ko.srt**
- **review-notes.md**
`;
}
export {
  CODEX_JOB_SCHEMA_VERSION,
  SCHEMA_VERSION,
  STORAGE_KEY,
  WORKSPACE_META_KEY,
  buildCodexJobManifest,
  compileCreatorPolicyMarkdown,
  createInitialState,
  createSegment,
  formatTimestamp,
  generateCodexStartHere,
  generateEditPrompt,
  markdownQuote,
  normalizeCreatorIdentity,
  normalizeState,
  normalizeWorkspaceMeta,
  parseTimestamp,
  resolveCreatorPolicies,
  safeInline,
  sanitizeFileName,
  validateSegmentInput
};
