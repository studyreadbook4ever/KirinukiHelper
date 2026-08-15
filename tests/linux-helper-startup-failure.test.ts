import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  KIRINUKI_DESKTOP_LAUNCH_ENV,
  reportLinuxHelperStartupFailure
} from "../scripts/linux-helper.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const helperPath = path.join(repositoryRoot, "scripts", "linux-helper.ts");

function captureStream(): {
  readonly stream: Writable & { isTTY: boolean };
  readonly text: () => string;
} {
  const chunks: Buffer[] = [];
  const stream = Object.assign(new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    }
  }), { isTTY: false });
  return {
    stream,
    text: () => Buffer.concat(chunks).toString("utf8")
  };
}

async function executableScript(filePath: string, contents: string): Promise<void> {
  await writeFile(filePath, contents, { mode: 0o755 });
  await chmod(filePath, 0o755);
}

test("desktop 시작 실패는 URL·비밀 값을 지운 최신 1건 로그와 zenity 복구 안내를 남긴다", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kirinuki-startup-error-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dialogCapture = path.join(root, "zenity-args.txt");
  await executableScript(path.join(root, "zenity"), [
    "#!/bin/sh",
    "printf '%s\\n' \"$@\" > \"$KIRINUKI_TEST_DIALOG_CAPTURE\"",
    "test -z \"${KIRINUKI_TEST_SECRET_TOKEN+x}\" || printf 'secret leaked\\n' >> \"$KIRINUKI_TEST_DIALOG_CAPTURE\"",
    ""
  ].join("\n"));
  const stderr = captureStream();
  const home = path.join(root, "home");
  const stateRoot = path.join(root, "state", "kirinuki-studio");
  const report = await reportLinuxHelperStartupFailure(
    new Error(
      `원본 https://chzzk.naver.com/video/14514980?token=super-secret와 ${home}/private 처리 실패`
    ),
    {
      env: {
        HOME: home,
        PATH: root,
        DISPLAY: ":99",
        [KIRINUKI_DESKTOP_LAUNCH_ENV]: "1",
        KIRINUKI_TEST_DIALOG_CAPTURE: dialogCapture,
        KIRINUKI_TEST_SECRET_TOKEN: "must-not-reach-child"
      },
      platform: "linux",
      stateRoot,
      stderr: stderr.stream
    }
  );

  assert.equal(report.notification, "zenity");
  assert.equal(report.logPath, path.join(stateRoot, "last-startup-error.log"));
  const log = await readFile(report.logPath!, "utf8");
  assert.match(log, /가장 최근 실패 한 건만/u);
  assert.match(log, /\[영상 URL 생략\]/u);
  assert.match(log, /\$HOME\/private/u);
  assert.doesNotMatch(log, /14514980|super-secret/u);
  assert.equal((await stat(report.logPath!)).mode & 0o777, 0o600);
  assert.equal((await stat(stateRoot)).mode & 0o777, 0o700);
  const dialog = await readFile(dialogCapture, "utf8");
  assert.match(dialog, /^--error$/mu);
  assert.match(dialog, /kirinuki doctor/u);
  assert.match(dialog, /last-startup-error\.log/u);
  assert.doesNotMatch(dialog, /14514980|super-secret/u);
  assert.doesNotMatch(dialog, /secret leaked|must-not-reach-child/u);
  assert.match(stderr.text(), /Kirinuki 앱 실행 실패/u);
});

test("zenity가 실패하면 notify-send로 복구 안내하고 일반 CLI에는 알림을 띄우지 않는다", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kirinuki-startup-notify-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const notifyCapture = path.join(root, "notify-args.txt");
  await Promise.all([
    executableScript(path.join(root, "zenity"), "#!/bin/sh\nexit 3\n"),
    executableScript(path.join(root, "notify-send"), [
      "#!/bin/sh",
      "printf '%s\\n' \"$@\" > \"$KIRINUKI_TEST_NOTIFY_CAPTURE\"",
      ""
    ].join("\n"))
  ]);
  const env = {
    HOME: path.join(root, "home"),
    PATH: root,
    WAYLAND_DISPLAY: "wayland-test",
    [KIRINUKI_DESKTOP_LAUNCH_ENV]: "1",
    KIRINUKI_TEST_NOTIFY_CAPTURE: notifyCapture
  };
  const desktop = await reportLinuxHelperStartupFailure(
    new Error("브라우저 준비 실패"),
    {
      env,
      platform: "linux",
      stateRoot: path.join(root, "desktop-state"),
      stderr: captureStream().stream
    }
  );
  assert.equal(desktop.notification, "notify-send");
  assert.match(await readFile(notifyCapture, "utf8"), /Kirinuki를 열지 못했습니다/u);

  await rm(notifyCapture, { force: true });
  const cli = await reportLinuxHelperStartupFailure(
    new Error("CLI 실패"),
    {
      env: {
        ...env,
        [KIRINUKI_DESKTOP_LAUNCH_ENV]: "0"
      },
      platform: "linux",
      stateRoot: path.join(root, "cli-state"),
      stderr: captureStream().stream
    }
  );
  assert.equal(cli.notification, null);
  await assert.rejects(readFile(notifyCapture), { code: "ENOENT" });
});

test("Terminal=false desktop 진입점의 실제 fatal 경로가 알림과 0600 로그를 끝까지 기다린다", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kirinuki-startup-main-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dialogCapture = path.join(root, "dialog.txt");
  await executableScript(path.join(root, "zenity"), [
    "#!/bin/sh",
    "printf '%s\\n' \"$@\" > \"$KIRINUKI_TEST_DIALOG_CAPTURE\"",
    ""
  ].join("\n"));
  const env = {
    ...process.env,
    HOME: path.join(root, "home"),
    XDG_STATE_HOME: path.join(root, "state"),
    PATH: `${root}:${process.env.PATH || ""}`,
    DISPLAY: ":99",
    [KIRINUKI_DESKTOP_LAUNCH_ENV]: "1",
    KIRINUKI_TEST_DIALOG_CAPTURE: dialogCapture
  };
  const result = await new Promise<{
    code: number | null;
    stderr: string;
  }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", helperPath, "not-a-command"],
      {
        cwd: repositoryRoot,
        env,
        shell: false,
        stdio: ["ignore", "ignore", "pipe"]
      }
    );
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({
      code,
      stderr: Buffer.concat(stderr).toString("utf8")
    }));
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /알 수 없는 명령/u);
  const logPath = path.join(
    env.XDG_STATE_HOME,
    "kirinuki-studio",
    "last-startup-error.log"
  );
  assert.match(await readFile(logPath, "utf8"), /알 수 없는 명령/u);
  assert.equal((await stat(logPath)).mode & 0o777, 0o600);
  assert.match(await readFile(dialogCapture, "utf8"), /last-startup-error\.log/u);
});
