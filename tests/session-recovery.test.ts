import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRecoverySessionSummaries,
  buildSavedEditorUrl,
  editorTabMatchesProject,
  recoverySourceRecord,
  recoverySourceUrl,
  tabMatchesRecoverySource
} from "../src/lib/session-recovery.js";

test("최근 편집은 projectId별 현재본과 임시저장 메타데이터만 안전하게 요약한다", () => {
  const sessions = buildRecoverySessionSummaries([
    {
      id: "project-old",
      name: "  오래된   프로젝트  ",
      updatedAt: "2026-07-28T01:00:00.000Z",
      clips: [{}, {}],
      subtitles: [{}],
      imageAssets: [],
      audioRegions: [{}],
      legacyCaptionCredential: "must-not-leak",
      ai: { providerApiKey: "also-must-not-leak" },
      usagePolicyAttestation: {
        evidenceReference: "private-policy-reference-must-not-leak"
      }
    },
    {
      id: "project-new",
      name: "새 프로젝트",
      updatedAt: "2026-07-29T02:00:00.000Z",
      source: {
        platform: "CHZZK",
        contentType: "vod",
        contentId: "14252987",
        canonicalUrl: "https://chzzk.naver.com/video/14252987?from=recovery"
      },
      clips: [{}],
      subtitles: [{}, {}, {}],
      imageAssets: [{}, {}],
      audioRegions: [],
      usagePolicyAttestation: {
        rightsHolder: "sensitive-holder-must-not-leak",
        evidenceReference: "https://example.com/private-policy-must-not-leak"
      }
    }
  ], [
    {
      id: "draft-new",
      projectId: "project-new",
      reason: "auto",
      createdAtMs: Date.parse("2026-07-29T03:00:00.000Z"),
      project: {
        id: "project-new",
        name: "새 프로젝트",
        usagePolicyAttestation: {
          evidenceReference: "draft-policy-reference-must-not-leak"
        }
      }
    },
    {
      id: "draft-old",
      projectId: "project-new",
      reason: "manual",
      createdAt: "2026-07-29T02:30:00.000Z",
      project: { id: "project-new", name: "새 프로젝트" }
    },
    {
      id: "wrong-project",
      projectId: "project-old",
      reason: "manual",
      createdAt: "2026-07-30T00:00:00.000Z",
      project: { id: "different-project" }
    }
  ]);

  assert.deepEqual(
    sessions.map((session) => session.projectId),
    ["project-new", "project-old"]
  );
  assert.deepEqual(sessions[0], {
    projectId: "project-new",
    title: "새 프로젝트",
    updatedAt: "2026-07-29T03:00:00.000Z",
    updatedAtMs: Date.parse("2026-07-29T03:00:00.000Z"),
    counts: {
      clips: 1,
      subtitles: 3,
      assets: 2,
      audio: 0
    },
    draftCount: 2,
    latestDraftReason: "auto",
    latestDraftAt: "2026-07-29T03:00:00.000Z",
    sourceSessionId: "vod:14252987"
  });
  const oldSession = sessions.at(1);
  assert.ok(oldSession);
  assert.equal(oldSession.title, "오래된 프로젝트");
  assert.deepEqual(oldSession.counts, {
    clips: 2,
    subtitles: 1,
    assets: 0,
    audio: 1
  });
  assert.equal(oldSession.draftCount, 0);
  assert.equal(oldSession.sourceSessionId, "saved-project:project-old");
  const serializedSessions = JSON.stringify(sessions);
  assert.equal(
    serializedSessions.includes("must-not-leak"),
    false
  );
  assert.equal(serializedSessions.includes("usagePolicyAttestation"), false);
  assert.equal(serializedSessions.includes("evidenceReference"), false);
  assert.equal(serializedSessions.includes("chzzk.naver.com"), false);
  assert.equal(serializedSessions.includes("sourceUrl"), false);
  assert.deepEqual(
    buildRecoverySessionSummaries(
      [{ id: "a", updatedAt: "2026-01-01" }, { id: "b", updatedAt: "2026-01-02" }],
      [],
      { limit: 1 }
    ).map((session) => session.projectId),
    ["b"]
  );
});

test("최근 편집 원본은 지원 플랫폼의 canonical 공개 URL만 복원한다", () => {
  assert.deepEqual(
    recoverySourceRecord({
      platform: "YOUTUBE",
      contentType: "vod",
      contentId: "abcdefghijk",
      canonicalUrl: "https://youtu.be/abcdefghijk?t=31#chapter",
      channelId: "@creator",
      broadcastStartedAt: "2026-08-10T00:00:00.000Z"
    }),
    {
      platform: "YOUTUBE",
      channelId: "@creator",
      broadcastStartedAt: "2026-08-10T00:00:00.000Z",
      contentId: "abcdefghijk",
      contentType: "vod",
      canonicalUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      broadcastTitle: "",
      streamerName: ""
    }
  );
  assert.equal(
    recoverySourceUrl({
      platform: "SOOP",
      contentType: "vod",
      contentId: "192805325"
    }),
    "https://vod.sooplive.com/player/192805325"
  );
  assert.equal(
    recoverySourceUrl({
      platform: "CHZZK",
      contentType: "live",
      channelId: "088973112d8acc831ec20274f7ffbb99",
      broadcastStartedAt: "2026-08-10 12:00:00"
    }),
    "https://chzzk.naver.com/live/088973112d8acc831ec20274f7ffbb99"
  );
  assert.equal(
    recoverySourceUrl({
      platform: "CHZZK",
      contentType: "live",
      channelId: "088973112d8acc831ec20274f7ffbb99"
    }),
    null,
    "방송 시작 시각 없는 채널 live URL은 훗날 다른 방송과 구별할 수 없습니다."
  );
  assert.deepEqual(
    recoverySourceRecord({
      platform: "YOUTUBE",
      contentType: "live",
      contentId: "abcdefghijk",
      canonicalUrl: "https://www.youtube.com/live/abcdefghijk"
    }),
    {
      platform: "YOUTUBE",
      channelId: "",
      broadcastStartedAt: "",
      contentId: "abcdefghijk",
      contentType: "vod",
      canonicalUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      broadcastTitle: "",
      streamerName: ""
    }
  );
  assert.equal(
    recoverySourceUrl({
      platform: "CHZZK",
      contentType: "live",
      channelId: "088973112d8acc831ec20274f7ffbb99",
      broadcastStartedAt: "2026-08-10 12:00:00",
      contentId: "stale-vod-id",
      canonicalUrl: "https://chzzk.naver.com/live/088973112d8acc831ec20274f7ffbb99"
    }),
    "https://chzzk.naver.com/live/088973112d8acc831ec20274f7ffbb99"
  );
});

test("최근 편집 요약은 레거시 원본 URL의 query나 과도한 identity를 노출하지 않는다", () => {
  const [summary] = buildRecoverySessionSummaries([
    {
      id: "legacy-youtube",
      source: {
        canonicalUrl: "https://www.youtube.com/watch?v=abcdefghijk&secret=LEAK&token=PRIVATE"
      }
    }
  ], []);
  assert.ok(summary);
  assert.equal(summary.sourceSessionId, "youtube:vod:abcdefghijk");
  assert.ok(summary.sourceSessionId.length <= 512);
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes("LEAK"), false);
  assert.equal(serialized.includes("PRIVATE"), false);
  assert.equal(serialized.includes("youtube.com"), false);

  const [oversized] = buildRecoverySessionSummaries([
    {
      id: "oversized-source",
      source: {
        canonicalUrl: `https://www.youtube.com/watch?v=abcdefghijk&secret=${"x".repeat(2_100)}`
      }
    }
  ], []);
  assert.ok(oversized);
  assert.equal(oversized.sourceSessionId, "saved-project:oversized-source");
});

test("최근 편집 원본은 저장 식별자와 다른 URL·비지원 이동을 신뢰하지 않는다", () => {
  assert.equal(
    recoverySourceUrl({ canonicalUrl: "https://example.com/private" }),
    null
  );
  assert.equal(
    recoverySourceUrl({
      platform: "YOUTUBE",
      contentType: "vod",
      contentId: "abcdefghijk",
      canonicalUrl: "https://www.youtube.com/watch?v=lmnopqrstuv"
    }),
    "https://www.youtube.com/watch?v=abcdefghijk"
  );
  assert.equal(
    recoverySourceUrl({
      platform: "SOOP",
      contentType: "vod",
      contentId: "not-a-number",
      canonicalUrl: "javascript:alert(1)"
    }),
    null
  );
  assert.equal(
    recoverySourceUrl({
      platform: "CHZZK",
      contentType: "vod",
      contentId: "x".repeat(129)
    }),
    null
  );
  assert.equal(
    recoverySourceUrl({
      canonicalUrl: `https://chzzk.naver.com/video/${"x".repeat(2_100)}`
    }),
    null
  );
  const youtubeSource = {
    platform: "YOUTUBE",
    contentType: "vod",
    contentId: "abcdefghijk",
    canonicalUrl: "https://www.youtube.com/watch?v=abcdefghijk"
  };
  assert.equal(
    tabMatchesRecoverySource(
      "https://m.youtube.com/shorts/abcdefghijk?feature=share",
      youtubeSource
    ),
    true
  );
  assert.equal(
    tabMatchesRecoverySource(
      "https://www.youtube.com/watch?v=lmnopqrstuv",
      youtubeSource
    ),
    false
  );
});

test("저장 세션 URL은 원본 탭과 무관한 resume 모드와 선택적 복구 UI만 지정한다", () => {
  const editorRoot = "chrome-extension://abcdefghijklmnop/editor.html";
  const continueUrl = new URL(buildSavedEditorUrl(
    editorRoot,
    "project-한글"
  ));
  assert.equal(continueUrl.searchParams.get("project"), "project-한글");
  assert.equal(continueUrl.searchParams.get("session"), "resume");
  assert.equal(continueUrl.searchParams.has("recovery"), false);

  const recoveryUrl = new URL(buildSavedEditorUrl(
    editorRoot,
    "project-한글",
    { recoveryDrafts: true }
  ));
  assert.equal(recoveryUrl.searchParams.get("project"), "project-한글");
  assert.equal(recoveryUrl.searchParams.get("session"), "resume");
  assert.equal(recoveryUrl.searchParams.get("recovery"), "drafts");
  assert.throws(
    () => buildSavedEditorUrl(editorRoot, ""),
    /프로젝트 ID/
  );
});

test("같은 projectId의 정확한 extension editor 경로만 중복 탭으로 판정한다", () => {
  const editorRoot = "chrome-extension://abcdefghijklmnop/editor.html";
  assert.equal(
    editorTabMatchesProject(
      `${editorRoot}?project=project-1&session=resume`,
      editorRoot,
      "project-1"
    ),
    true
  );
  assert.equal(
    editorTabMatchesProject(
      `${editorRoot}?project=project-2`,
      editorRoot,
      "project-1"
    ),
    false
  );
  assert.equal(
    editorTabMatchesProject(
      "chrome-extension://abcdefghijklmnop/editor.html-old?project=project-1",
      editorRoot,
      "project-1"
    ),
    false
  );
  assert.equal(
    editorTabMatchesProject(
      "https://example.com/editor.html?project=project-1",
      editorRoot,
      "project-1"
    ),
    false
  );
  assert.equal(editorTabMatchesProject("not a url", editorRoot, "project-1"), false);
});
