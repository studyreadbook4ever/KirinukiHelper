import assert from "node:assert/strict";
import test from "node:test";

import {
  DESKTOP_ARCHITECTURES,
  DESKTOP_PLATFORMS,
  desktopBundleTarget,
  desktopToolExecutableNames,
  resolveDesktopApplicationRuntimePaths,
  resolveDesktopBundledTools,
  resolveDesktopPathWithinRoot,
  resolveDesktopRuntimePaths,
  validateDesktopAbsolutePath
} from "../src/desktop/runtime-spec.js";

test("desktop application keeps production temporary work below userData", () => {
  const production = resolveDesktopApplicationRuntimePaths({
    platform: "linux",
    arch: "x64",
    userDataRoot: "/home/user/.local/share/Kirinuki",
    resourcesRoot: "/opt/Kirinuki/resources"
  });
  assert.equal(
    production.tempRoot,
    "/home/user/.local/share/Kirinuki/runtime-temp"
  );
  assert.equal(
    production.jobsTempRoot,
    "/home/user/.local/share/Kirinuki/runtime-temp/jobs"
  );
  assert.equal(
    production.cacheRoot,
    "/home/user/.local/share/Kirinuki/cache"
  );
  assert.equal(
    production.logsRoot,
    "/home/user/.local/share/Kirinuki/logs"
  );

  const windows = resolveDesktopApplicationRuntimePaths({
    platform: "win32",
    arch: "x64",
    userDataRoot: "C:\\Users\\User\\AppData\\Local\\Kirinuki",
    resourcesRoot: "C:\\Program Files\\Kirinuki\\resources"
  });
  assert.equal(
    windows.tempRoot,
    "C:\\Users\\User\\AppData\\Local\\Kirinuki\\runtime-temp"
  );
  assert.equal(
    windows.jobsTempRoot,
    "C:\\Users\\User\\AppData\\Local\\Kirinuki\\runtime-temp\\jobs"
  );
});

test("desktop application preserves the native-smoke temporary override", () => {
  const smoke = resolveDesktopApplicationRuntimePaths({
    platform: "darwin",
    arch: "arm64",
    userDataRoot: "/private/tmp/kirinuki-smoke/user-data",
    resourcesRoot: "/Applications/Kirinuki.app/Contents/Resources",
    tempRootOverride: "/private/tmp/kirinuki-smoke/runtime-temp"
  });
  assert.equal(
    smoke.tempRoot,
    "/private/tmp/kirinuki-smoke/runtime-temp"
  );
  assert.equal(
    smoke.jobsTempRoot,
    "/private/tmp/kirinuki-smoke/runtime-temp/jobs"
  );
  assert.equal(smoke.cacheRoot, "/private/tmp/kirinuki-smoke/user-data/cache");
});

test("Linux runtime roots stay explicit and derive only managed children", () => {
  const paths = resolveDesktopRuntimePaths({
    platform: "linux",
    arch: "x64",
    roots: {
      appDataRoot: "/home/user/.local/share/Kirinuki",
      cacheRoot: "/home/user/.cache/Kirinuki",
      logsRoot: "/home/user/.local/state/Kirinuki/logs",
      tempRoot: "/tmp/Kirinuki-user",
      resourcesRoot: "/opt/Kirinuki/resources"
    }
  });
  assert.deepEqual(paths, {
    platform: "linux",
    arch: "x64",
    bundleTarget: "linux-x64",
    appDataRoot: "/home/user/.local/share/Kirinuki",
    cacheRoot: "/home/user/.cache/Kirinuki",
    logsRoot: "/home/user/.local/state/Kirinuki/logs",
    tempRoot: "/tmp/Kirinuki-user",
    resourcesRoot: "/opt/Kirinuki/resources",
    browserSessionRoot: "/home/user/.local/share/Kirinuki/browser-session",
    captionDataRoot: "/home/user/.local/share/Kirinuki/captions",
    vodCacheRoot: "/home/user/.cache/Kirinuki/vod-fragments",
    jobsTempRoot: "/tmp/Kirinuki-user/jobs"
  });
  assert.equal(Object.isFrozen(paths), true);
});

test("macOS runtime mapping uses POSIX paths and arm64 bundle target", () => {
  const paths = resolveDesktopRuntimePaths({
    platform: "darwin",
    arch: "arm64",
    roots: {
      appDataRoot: "/Users/user/Library/Application Support/Kirinuki",
      cacheRoot: "/Users/user/Library/Caches/Kirinuki",
      logsRoot: "/Users/user/Library/Logs/Kirinuki",
      tempRoot: "/private/var/folders/ab/Kirinuki",
      resourcesRoot: "/Applications/Kirinuki.app/Contents/Resources"
    }
  });
  assert.equal(paths.bundleTarget, "darwin-arm64");
  assert.equal(
    paths.browserSessionRoot,
    "/Users/user/Library/Application Support/Kirinuki/browser-session"
  );
  assert.equal(
    paths.vodCacheRoot,
    "/Users/user/Library/Caches/Kirinuki/vod-fragments"
  );
});

test("Windows mapping is evaluated with win32 semantics on every test host", () => {
  const paths = resolveDesktopRuntimePaths({
    platform: "win32",
    arch: "arm64",
    roots: {
      appDataRoot: "C:\\Users\\User\\AppData\\Roaming\\Kirinuki",
      cacheRoot: "C:\\Users\\User\\AppData\\Local\\Kirinuki\\Cache",
      logsRoot: "C:\\Users\\User\\AppData\\Local\\Kirinuki\\Logs",
      tempRoot: "C:\\Users\\User\\AppData\\Local\\Temp\\Kirinuki",
      resourcesRoot: "C:\\Program Files\\Kirinuki\\resources"
    }
  });
  assert.equal(paths.bundleTarget, "win32-arm64");
  assert.equal(
    paths.browserSessionRoot,
    "C:\\Users\\User\\AppData\\Roaming\\Kirinuki\\browser-session"
  );
  assert.equal(
    paths.jobsTempRoot,
    "C:\\Users\\User\\AppData\\Local\\Temp\\Kirinuki\\jobs"
  );
});

test("the supported platform and architecture matrix is explicit", () => {
  assert.deepEqual([...DESKTOP_PLATFORMS], ["linux", "darwin", "win32"]);
  assert.deepEqual([...DESKTOP_ARCHITECTURES], ["x64", "arm64"]);
  assert.deepEqual(
    DESKTOP_PLATFORMS.flatMap((platform) => (
      DESKTOP_ARCHITECTURES.map((arch) => desktopBundleTarget({ platform, arch }))
    )),
    [
      "linux-x64",
      "linux-arm64",
      "darwin-x64",
      "darwin-arm64",
      "win32-x64",
      "win32-arm64"
    ]
  );
  assert.throws(
    () => desktopBundleTarget({ platform: "freebsd", arch: "x64" }),
    /linux, darwin, win32/u
  );
  assert.throws(
    () => desktopBundleTarget({ platform: "darwin", arch: "ia32" }),
    /x64 또는 arm64/u
  );
});

test("bundled executable names are target-specific and yt-dlp is standalone", () => {
  const macTools = resolveDesktopBundledTools({
    platform: "darwin",
    arch: "arm64",
    resourcesRoot: "/Applications/Kirinuki.app/Contents/Resources"
  });
  assert.deepEqual(macTools.executableNames, {
    ffmpeg: "ffmpeg",
    ffprobe: "ffprobe",
    whisperServer: "whisper-server",
    ytDlp: "yt-dlp"
  });
  assert.equal(
    macTools.ytDlp.command,
    "/Applications/Kirinuki.app/Contents/Resources/desktop-tools/darwin-arm64/yt-dlp"
  );
  assert.deepEqual(macTools.ytDlp.argsPrefix, []);
  assert.equal(macTools.ytDlp.artifactKind, "standalone");
  assert.equal(Object.isFrozen(macTools), true);
  assert.equal(Object.isFrozen(macTools.ytDlp), true);

  const windowsTools = resolveDesktopBundledTools({
    platform: "win32",
    arch: "x64",
    resourcesRoot: "D:\\Apps\\Kirinuki\\resources"
  });
  assert.deepEqual(windowsTools.executableNames, {
    ffmpeg: "ffmpeg.exe",
    ffprobe: "ffprobe.exe",
    whisperServer: "whisper-server.exe",
    ytDlp: "yt-dlp.exe"
  });
  assert.equal(
    windowsTools.ffmpeg.command,
    "D:\\Apps\\Kirinuki\\resources\\desktop-tools\\win32-x64\\ffmpeg.exe"
  );
  assert.equal(
    windowsTools.ytDlp.command,
    "D:\\Apps\\Kirinuki\\resources\\desktop-tools\\win32-x64\\yt-dlp.exe"
  );
  assert.deepEqual(windowsTools.ytDlp.argsPrefix, []);
});

test("tool executable name lookup validates architecture even when names match", () => {
  assert.deepEqual(
    desktopToolExecutableNames({ platform: "linux", arch: "arm64" }),
    {
      ffmpeg: "ffmpeg",
      ffprobe: "ffprobe",
      whisperServer: "whisper-server",
      ytDlp: "yt-dlp"
    }
  );
  assert.throws(
    () => desktopToolExecutableNames({ platform: "win32", arch: "ppc64" }),
    /x64 또는 arm64/u
  );
});

test("absolute root validation rejects ambiguous, broad, and traversing paths", () => {
  for (const candidate of [
    "",
    "relative/path",
    " /home/user/Kirinuki",
    "/home/user/Kirinuki\n",
    "/home/user/../Kirinuki",
    "/"
  ]) {
    assert.throws(
      () => validateDesktopAbsolutePath(candidate, { platform: "linux" }),
      TypeError,
      candidate
    );
  }
  assert.equal(
    validateDesktopAbsolutePath("/Users/사용자/Kirinuki Files", {
      platform: "darwin"
    }),
    "/Users/사용자/Kirinuki Files"
  );
});

test("Windows root validation rejects drive-relative, device, ADS, and reserved paths", () => {
  for (const candidate of [
    "C:relative\\Kirinuki",
    "\\Users\\User\\Kirinuki",
    "\\\\?\\C:\\Users\\User\\Kirinuki",
    "C:\\Users\\User\\..\\Kirinuki",
    "C:\\Users\\CON\\Kirinuki",
    "C:\\Users\\User\\Kirinuki.",
    "C:\\Users\\User\\Kirinuki:cache",
    "C:\\"
  ]) {
    assert.throws(
      () => validateDesktopAbsolutePath(candidate, { platform: "win32" }),
      TypeError,
      candidate
    );
  }
  assert.equal(
    validateDesktopAbsolutePath(
      "\\\\fileserver\\profiles\\User\\Kirinuki",
      { platform: "win32" }
    ),
    "\\\\fileserver\\profiles\\User\\Kirinuki"
  );
});

test("managed child resolution cannot inject separators or traversal", () => {
  assert.equal(
    resolveDesktopPathWithinRoot({
      platform: "darwin",
      root: "/Users/user/Library/Caches/Kirinuki",
      segments: ["vod", "job-01"]
    }),
    "/Users/user/Library/Caches/Kirinuki/vod/job-01"
  );
  for (const segment of ["", ".", "..", "nested/path", "line\nbreak"]) {
    assert.throws(() => resolveDesktopPathWithinRoot({
      platform: "linux",
      root: "/tmp/Kirinuki",
      segments: [segment]
    }), TypeError);
  }
  for (const segment of ["nested\\path", "NUL", "output.", "stream:name"]) {
    assert.throws(() => resolveDesktopPathWithinRoot({
      platform: "win32",
      root: "C:\\Temp\\Kirinuki",
      segments: [segment]
    }), TypeError);
  }
});

test("runtime roots cannot alias each other, including Windows case aliases", () => {
  assert.throws(() => resolveDesktopRuntimePaths({
    platform: "win32",
    arch: "x64",
    roots: {
      appDataRoot: "C:\\Users\\User\\Kirinuki",
      cacheRoot: "c:\\users\\user\\KIRINUKI",
      logsRoot: "C:\\Users\\User\\Kirinuki-logs",
      tempRoot: "C:\\Temp\\Kirinuki",
      resourcesRoot: "C:\\Apps\\Kirinuki\\resources"
    }
  }), /서로 달라야/u);
});
