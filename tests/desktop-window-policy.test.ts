import assert from "node:assert/strict";
import test from "node:test";

import {
  KIRINUKI_LOCAL_STUDIO_ORIGIN
} from "../src/lib/local-runtime-origin.js";
import {
  allowedExternalNavigationUrl,
  desktopStudioUrl,
  isAllowedDesktopFileSystemPermission,
  isAllowedDesktopMainFrameUrl,
  isAllowedDesktopRestrictedFileSystemPrompt
} from "../src/desktop/window-policy.js";

test("desktop window starts only at the exact loopback studio and encodes a source", () => {
  assert.equal(desktopStudioUrl(), `${KIRINUKI_LOCAL_STUDIO_ORIGIN}/`);
  const sourceUrl = "https://www.youtube.com/watch?v=nixLJx1UhfY";
  const target = new URL(desktopStudioUrl({ sourceUrl }));
  assert.equal(target.origin, KIRINUKI_LOCAL_STUDIO_ORIGIN);
  assert.equal(target.pathname, "/");
  assert.equal(target.searchParams.get("source"), sourceUrl);
  assert.equal([...target.searchParams].length, 1);
});

test("desktop main-frame policy permits only exact app routes on the exact origin", () => {
  for (const allowed of [
    `${KIRINUKI_LOCAL_STUDIO_ORIGIN}/`,
    `${KIRINUKI_LOCAL_STUDIO_ORIGIN}/index.html`,
    `${KIRINUKI_LOCAL_STUDIO_ORIGIN}/licenses.html`,
    `${KIRINUKI_LOCAL_STUDIO_ORIGIN}/?source=https%3A%2F%2Fchzzk.naver.com%2Fvideo%2F1`,
    `${KIRINUKI_LOCAL_STUDIO_ORIGIN}/editor.html?project=project-1&workspace=short-form`
  ]) {
    assert.equal(isAllowedDesktopMainFrameUrl(allowed), true, allowed);
  }

  for (const blocked of [
    "http://localhost:4320/",
    "http://[::1]:4320/",
    "http://127.0.0.1:4319/",
    "https://127.0.0.1:4320/",
    "http://127.0.0.1:4320.evil.example/",
    "http://127.0.0.1:4320@evil.example/",
    `${KIRINUKI_LOCAL_STUDIO_ORIGIN}/admin`,
    `${KIRINUKI_LOCAL_STUDIO_ORIGIN}/editor.html/extra`,
    `${KIRINUKI_LOCAL_STUDIO_ORIGIN}/licenses.html?source=vod`,
    `${KIRINUKI_LOCAL_STUDIO_ORIGIN}/licenses.html#mediabunny`,
    `${KIRINUKI_LOCAL_STUDIO_ORIGIN}/editor.html#fragment`,
    "file:///etc/passwd",
    "javascript:alert(1)",
    "not-a-url"
  ]) {
    assert.equal(isAllowedDesktopMainFrameUrl(blocked), false, blocked);
  }
});

test("desktop external navigation is an exact HTTPS/mailto allowlist", () => {
  for (const allowed of [
    "https://github.com/eff0rt/KirinukiHelper",
    "https://kirinuki.eff0rtchung.kr/help",
    "https://chzzk.naver.com/video/14514980",
    "https://www.youtube.com/watch?v=nixLJx1UhfY",
    "https://www.youtube.com/watch?v=nixLJx1UhfY&t=30s",
    "https://www.youtube.com/watch?t=30s&v=nixLJx1UhfY",
    "https://vod.sooplive.com/player/123456",
    "https://vod.sooplive.com/player/123456?change_second=30",
    "mailto:lostfragment@naver.com"
  ]) {
    assert.equal(allowedExternalNavigationUrl(allowed), new URL(allowed).href, allowed);
  }

  for (const blocked of [
    "http://github.com/eff0rt/KirinukiHelper",
    "https://www.github.com/eff0rt/KirinukiHelper",
    "https://github.com.evil.example/",
    "https://kirinuki.eff0rtchung.kr.evil.example/",
    "https://user:secret@github.com/",
    "https://user:secret@www.youtube.com/watch?v=nixLJx1UhfY",
    "https://www.youtube.com:443/watch?v=nixLJx1UhfY",
    "https://www.youtube.com:8443/watch?v=nixLJx1UhfY",
    "https://www.youtube.com/watch?v=nixLJx1UhfY#fragment",
    "https://www.youtube.com/embed/nixLJx1UhfY",
    "https://www.youtube.com/watch?v=nixLJx1UhfY&t=030s",
    "https://www.youtube.com/watch?v=nixLJx1UhfY&t=-1s",
    "https://www.youtube.com/watch?v=nixLJx1UhfY&t=2592001s",
    "https://www.youtube.com/watch?v=nixLJx1UhfY&t=30s&x=1",
    "https://www.youtube.com/watch?v=nixLJx1UhfY&t=30s&t=31s",
    "https://youtu.be/nixLJx1UhfY",
    "https://vod.afreecatv.com/PLAYER/STATION/123456",
    "https://vod.sooplive.com/player/123456?change_second=030",
    "https://vod.sooplive.com/player/123456?change_second=-1",
    "https://vod.sooplive.com/player/123456?change_second=30&x=1",
    " https://www.youtube.com/watch?v=nixLJx1UhfY",
    "mailto:other@example.com",
    "mailto:lostfragment@naver.com?subject=tracking",
    "mailto:lostfragment@naver.com#fragment",
    "file:///tmp/video.mp4",
    "javascript:alert(1)",
    "kirinuki://open"
  ]) {
    assert.equal(allowedExternalNavigationUrl(blocked), null, blocked);
  }
});

test("desktop file-system permission allows only the managed main frame and native absolute paths", () => {
  const baseRequest = {
    managedWebContents: true,
    requestingOrigin: KIRINUKI_LOCAL_STUDIO_ORIGIN,
    requestingUrl:
      `${KIRINUKI_LOCAL_STUDIO_ORIGIN}/editor.html?project=project-1&workspace=short-form`,
    fileAccessType: "readable",
    filePath: "/home/user/영상/Kirinuki source.mp4"
  } as const;

  for (const allowed of [
    baseRequest,
    {
      ...baseRequest,
      requestingUrl: `${KIRINUKI_LOCAL_STUDIO_ORIGIN}/`,
      filePath: "/tmp/Kirinuki/export.mp4"
    },
    {
      ...baseRequest,
      requestingUrl: `${KIRINUKI_LOCAL_STUDIO_ORIGIN}/index.html?source=vod`,
      fileAccessType: "writable",
      filePath: "/home/user/Videos/완성본.mp4"
    }
  ]) {
    assert.equal(isAllowedDesktopFileSystemPermission(allowed), true);
  }
});

test("desktop file-system permission rejects unmanaged, iframe, alias, malformed path, and unknown access", () => {
  const baseRequest = {
    managedWebContents: true,
    requestingOrigin: KIRINUKI_LOCAL_STUDIO_ORIGIN,
    requestingUrl: `${KIRINUKI_LOCAL_STUDIO_ORIGIN}/editor.html`,
    fileAccessType: "readable",
    filePath: "/home/user/Videos/source.mp4"
  } as const;
  const blocked = [
    { ...baseRequest, managedWebContents: false },
    { ...baseRequest, requestingOrigin: "http://localhost:4320" },
    { ...baseRequest, requestingOrigin: "https://www.youtube-nocookie.com" },
    {
      ...baseRequest,
      requestingUrl: "https://www.youtube-nocookie.com/embed/nixLJx1UhfY"
    },
    {
      ...baseRequest,
      requestingUrl: `${KIRINUKI_LOCAL_STUDIO_ORIGIN}/iframe.html`
    },
    {
      ...baseRequest,
      requestingUrl: `${KIRINUKI_LOCAL_STUDIO_ORIGIN}/licenses.html`
    },
    { ...baseRequest, requestingUrl: "http://localhost:4320/editor.html" },
    { ...baseRequest, requestingUrl: "http://127.0.0.1:4319/editor.html" },
    { ...baseRequest, requestingUrl: `${KIRINUKI_LOCAL_STUDIO_ORIGIN}/editor.html#frame` },
    { ...baseRequest, filePath: null },
    { ...baseRequest, filePath: "" },
    { ...baseRequest, filePath: "relative/source.mp4" },
    { ...baseRequest, filePath: " /home/user/Videos/source.mp4" },
    { ...baseRequest, filePath: "/home/user/Videos/source.mp4 " },
    { ...baseRequest, filePath: "/home/user/Videos/source\n.mp4" },
    { ...baseRequest, filePath: "/home/user/Videos/source\u0000.mp4" },
    { ...baseRequest, fileAccessType: "read" },
    { ...baseRequest, fileAccessType: "write" },
    { ...baseRequest, fileAccessType: "readwrite" },
    { ...baseRequest, fileAccessType: "READABLE" },
    { ...baseRequest, fileAccessType: null }
  ];

  for (const request of blocked) {
    assert.equal(isAllowedDesktopFileSystemPermission(request), false);
  }
});

test("restricted file-system prompt is offered only for an exact local user selection", () => {
  assert.equal(isAllowedDesktopRestrictedFileSystemPrompt({
    origin: KIRINUKI_LOCAL_STUDIO_ORIGIN,
    filePath: "/home/user/Downloads",
    isDirectory: true
  }), true);
  assert.equal(isAllowedDesktopRestrictedFileSystemPrompt({
    origin: KIRINUKI_LOCAL_STUDIO_ORIGIN,
    filePath: "/home/user/Desktop/source.mp4",
    isDirectory: false
  }), true);
  for (const blocked of [
    { origin: "http://localhost:4320", filePath: "/home/user/Downloads", isDirectory: true },
    { origin: "https://www.youtube-nocookie.com", filePath: "/home/user/Downloads", isDirectory: true },
    { origin: KIRINUKI_LOCAL_STUDIO_ORIGIN, filePath: "relative", isDirectory: true },
    { origin: KIRINUKI_LOCAL_STUDIO_ORIGIN, filePath: "/home/user/Down\nloads", isDirectory: true },
    { origin: KIRINUKI_LOCAL_STUDIO_ORIGIN, filePath: "/home/user/Downloads", isDirectory: "yes" }
  ]) {
    assert.equal(isAllowedDesktopRestrictedFileSystemPrompt(blocked), false);
  }
});
