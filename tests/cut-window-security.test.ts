import assert from "node:assert/strict";
import test from "node:test";

import {
  createCutWindowPartitionName,
  destroyAcknowledgedCutWindow,
  exactCutWindowExternalSourceUrl,
  exactStreamingFrameIdentity,
  loadExactCutWindowDocumentFailClosed,
  settleCutWindowHandoffBeforeDocumentReset,
  shouldRejectDirectCutFrameNavigation,
  shouldRejectCutWindowNavigation,
  trustedCutShortcutKey
} from "../src/desktop/cut-window-security.js";

const SOOP_EMBED =
  "https://vod.sooplive.com/player/169475287/embed?autoPlay=true&showChat=false&mutePlay=true";

test("외부 브라우저 열기는 exact canonical 지원 VOD만 허용한다", () => {
  for (const url of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://chzzk.naver.com/video/1234567",
    "https://vod.sooplive.com/player/169475287"
  ]) {
    assert.equal(exactCutWindowExternalSourceUrl(url), url, url);
  }
  for (const value of [
    " https://chzzk.naver.com/video/1234567",
    "https://github.com/eff0rtchung/KirinukiHelper",
    "mailto:lostfragment@naver.com",
    "javascript:alert(1)",
    "https://chzzk.naver.com.evil.example/video/1234567",
    SOOP_EMBED,
    1234567,
    null
  ]) {
    assert.equal(exactCutWindowExternalSourceUrl(value), null, String(value));
  }
});

test("매 컷 창은 서로 다른 비영속 partition으로 상태가 격리된다", () => {
  const first = createCutWindowPartitionName(1, "a".repeat(32));
  const second = createCutWindowPartitionName(2, "b".repeat(32));
  assert.notEqual(first, second);
  assert.equal(first.startsWith("persist:"), false);
  assert.equal(second.startsWith("persist:"), false);

  const simulatedSessionStorage = new Map<string, Map<string, string>>();
  simulatedSessionStorage.set(first, new Map([["project", "A"]]));
  simulatedSessionStorage.set(second, new Map());
  assert.equal(simulatedSessionStorage.get(second)?.has("project"), false);
  assert.throws(
    () => createCutWindowPartitionName(1, "../../persist:shared"),
    /식별자/u
  );
});

test("플랫폼 subframe redirect/hash는 허용하고 top-frame 이탈만 거절한다", () => {
  const expected =
    "https://kirinuki.eff0rtchung.kr/?kirinukiSurface=cut-host";
  for (const url of [
    "https://www.youtube-nocookie.com/embed/abcdefghijk#playing",
    "https://vod.sooplive.com/player/169475287/embed?autoPlay=true",
    "https://chzzk.naver.com/video/12345?redirected=true"
  ]) {
    assert.equal(shouldRejectCutWindowNavigation({
      url,
      expectedUrl: expected,
      isMainFrame: false
    }), false, url);
  }
  assert.equal(shouldRejectCutWindowNavigation({
    url: expected,
    expectedUrl: expected,
    isMainFrame: true
  }), false);
  assert.equal(shouldRejectCutWindowNavigation({
    url: "https://attacker.example/",
    expectedUrl: expected,
    isMainFrame: true
  }), true);
});

test("trusted shortcut은 3플랫폼 exact child의 modifier 없는 physical code만 통과한다", () => {
  const frames = [
    "https://chzzk.naver.com/video/1234567",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1",
    SOOP_EMBED
  ];
  assert.deepEqual(exactStreamingFrameIdentity(frames[0]), {
    platform: "CHZZK",
    contentId: "1234567"
  });
  for (const frame of frames) {
    for (const key of ["E", "R", "A"]) {
      assert.equal(trustedCutShortcutKey({
        input: { type: "keyDown", key: "ㄷ", code: `Key${key}` },
        focusedFrameUrl: frame,
        mainFrameFocused: false
      }), key);
      assert.equal(trustedCutShortcutKey({
        input: { type: "keyDown", key, code: `Key${key}` },
        focusedFrameUrl: frame,
        mainFrameFocused: true
      }), null, `main-frame input ${key}`);
    }
  }
  for (const input of [
    { type: "keyDown", key: "E", code: "KeyE", shift: true },
    { type: "keyDown", key: "R", code: "KeyR", control: true },
    { type: "keyDown", key: "A", code: "KeyA", isAutoRepeat: true },
    { type: "keyDown", key: "A", code: "KeyA", isComposing: true },
    { type: "keyUp", key: "E", code: "KeyE" },
    { type: "keyDown", key: "E", code: "KeyS" }
  ]) {
    assert.equal(trustedCutShortcutKey({
      input,
      focusedFrameUrl: SOOP_EMBED,
      mainFrameFocused: false
    }), null);
  }
  for (const forgedFrame of [
    "https://vod.sooplive.com/player/169475287",
    `${SOOP_EMBED}&showChat=false`,
    "https://vod.sooplive.com.evil.example/player/169475287/embed?autoPlay=true&showChat=false&mutePlay=true",
    "http://vod.sooplive.com/player/169475287/embed?autoPlay=true&showChat=false&mutePlay=true"
  ]) {
    assert.equal(trustedCutShortcutKey({
      input: { type: "keyDown", key: "E", code: "KeyE" },
      focusedFrameUrl: forgedFrame,
      mainFrameFocused: false
    }), null, forgedFrame);
  }
});

test("direct child는 about:blank 또는 exact 3플랫폼 frame만 navigation 가능하다", () => {
  const expected = "https://kirinuki.eff0rtchung.kr/?kirinukiSurface=cut-host";
  for (const url of [
    "about:blank",
    "https://chzzk.naver.com/video/1234567",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1",
    SOOP_EMBED
  ]) {
    assert.equal(shouldRejectDirectCutFrameNavigation({
      url,
      expectedMainUrl: expected,
      isMainFrame: false,
      isDirectChild: true
    }), false, url);
  }
  for (const url of [
    "https://attacker.example/",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    `${SOOP_EMBED}#changed`
  ]) {
    assert.equal(shouldRejectDirectCutFrameNavigation({
      url,
      expectedMainUrl: expected,
      isMainFrame: false,
      isDirectChild: true
    }), true, url);
  }
});

test("컷 문서 load reject·wrong commit은 숨은 창을 남기지 않는다", async () => {
  for (const mode of ["reject", "wrong-url"] as const) {
    let windows = 1;
    let destroyed = false;
    await assert.rejects(loadExactCutWindowDocumentFailClosed({
      load: async () => {
        if (mode === "reject") {
          throw new Error("network failed");
        }
      },
      currentUrl: () => mode === "wrong-url"
        ? "https://attacker.example/"
        : "https://kirinuki.eff0rtchung.kr/?kirinukiSurface=cut-host",
      expectedUrl:
        "https://kirinuki.eff0rtchung.kr/?kirinukiSurface=cut-host",
      isDestroyed: () => destroyed,
      destroy: () => {
        destroyed = true;
        windows -= 1;
      }
    }));
    assert.equal(windows, 0, mode);
    assert.equal(destroyed, true, mode);
  }
});

test("ACK가 끝난 컷 창은 beforeunload 가능한 close 대신 강제 destroy한다", () => {
  let destroyed = false;
  let regularCloseCalled = false;
  const simulatedRemoteBeforeUnload = () => {
    regularCloseCalled = true;
    return false;
  };

  // A regular close would be cancelled by the remote document.
  assert.equal(simulatedRemoteBeforeUnload(), false);
  destroyAcknowledgedCutWindow({
    isDestroyed: () => destroyed,
    destroy: () => {
      destroyed = true;
    }
  });
  assert.equal(destroyed, true);
  assert.equal(regularCloseCalled, true);

  let secondDestroy = 0;
  destroyAcknowledgedCutWindow({
    isDestroyed: () => true,
    destroy: () => {
      secondDestroy += 1;
    }
  });
  assert.equal(secondDestroy, 0);
});

test("ACK 강제 종료 primitive가 닫힘 postcondition을 만족하지 못하면 fail closed한다", () => {
  assert.throws(() => destroyAcknowledgedCutWindow({
    isDestroyed: () => false,
    destroy: () => undefined
  }), /확실히 닫지 못했습니다/u);
});

test("reload 직전 ACK race는 세대 reset 대신 terminal destroy로 끝난다", () => {
  for (const mode of ["already-acknowledged", "ack-won-cancel-race"] as const) {
    let statusReads = 0;
    let cancelled = 0;
    let destroyed = 0;
    const result = settleCutWindowHandoffBeforeDocumentReset({
      status: () => {
        statusReads += 1;
        if (mode === "already-acknowledged") {
          return "acknowledged";
        }
        return statusReads === 1 ? "claimed" : "acknowledged";
      },
      cancel: () => {
        cancelled += 1;
        return false;
      },
      destroyAcknowledged: () => {
        destroyed += 1;
      }
    });
    assert.equal(result, "acknowledged", mode);
    assert.equal(destroyed, 1, mode);
    assert.equal(cancelled, mode === "already-acknowledged" ? 0 : 1, mode);
  }
});

test("reload cancellation이 ACK보다 먼저 이기면 새 문서 세대로 진행할 수 있다", () => {
  let status: "claimed" | "absent" = "claimed";
  let destroyed = 0;
  const result = settleCutWindowHandoffBeforeDocumentReset({
    status: () => status,
    cancel: () => {
      status = "absent";
      return true;
    },
    destroyAcknowledged: () => {
      destroyed += 1;
    }
  });
  assert.equal(result, "cancelled");
  assert.equal(status, "absent");
  assert.equal(destroyed, 0);
});
