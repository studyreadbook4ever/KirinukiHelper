import assert from "node:assert/strict";
import test from "node:test";

import {
  windowsPowerShellEnvironment,
  windowsPowerShellExecutable
} from "../scripts/windows-powershell-environment.js";

test("PowerShell 7 module path를 WinPS 전용 경로로 exact 치환한다", () => {
  const environment = windowsPowerShellEnvironment({
    PATH: "system-path",
    PSModulePath: "C:\\Program Files\\PowerShell\\7\\Modules",
    WinPSModulePath: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules"
  }, {
    KIRINUKI_WINDOWS_AUTHENTICODE_PATH: "D:\\artifact path\\setup.exe"
  });
  assert.equal(
    environment.PSModulePath,
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules"
  );
  assert.equal(environment.WinPSModulePath, environment.PSModulePath);
  assert.equal(environment.PATH, "system-path");
  assert.equal(
    environment.KIRINUKI_WINDOWS_AUTHENTICODE_PATH,
    "D:\\artifact path\\setup.exe"
  );
});

test("WinPSModulePath가 없으면 모든 casing의 오염된 PSModulePath를 제거한다", () => {
  const environment = windowsPowerShellEnvironment({
    pSmOdUlEpAtH: "incompatible",
    PATH: "system-path"
  });
  assert.equal(
    Object.keys(environment).some((key) => key.toUpperCase() === "PSMODULEPATH"),
    false
  );
  assert.equal(environment.PATH, "system-path");
});

test("서로 다른 WinPSModulePath casing 값은 fail closed한다", () => {
  assert.throws(() => windowsPowerShellEnvironment({
    WinPSModulePath: "first",
    WINPSMODULEPATH: "second"
  }), /conflicting WinPSModulePath/u);
});

test("Windows PowerShell은 SystemRoot 아래 OS-owned 절대 경로로 고정한다", () => {
  assert.equal(
    windowsPowerShellExecutable({ sYsTeMrOoT: "D:\\Windows" }),
    "D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
  );
  assert.throws(
    () => windowsPowerShellExecutable({ SystemRoot: "relative\\Windows" }),
    /not an absolute path/u
  );
  assert.throws(
    () => windowsPowerShellExecutable({}),
    /missing or conflicting/u
  );
});
