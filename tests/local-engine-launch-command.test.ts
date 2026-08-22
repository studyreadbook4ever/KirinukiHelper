import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_MEDIA_ENGINE_CUT_URL,
  encodeBase64Url,
  extractLocalMediaEngineLaunchCommandFromArgv,
  parseLocalMediaEngineLaunchCommand
} from "../src/lib/local-media-engine-auth.js";

const STATE = encodeBase64Url(new Uint8Array(32).fill(1));
const CHALLENGE = encodeBase64Url(new Uint8Array(32).fill(2));
const PAIR_URL = `kirinuki-engine://pair?${new URLSearchParams({
  v: "1",
  state: STATE,
  challenge: CHALLENGE
})}`;

test("엔진 실행 링크는 exact pair와 query 없는 cut만 허용한다", () => {
  assert.deepEqual(parseLocalMediaEngineLaunchCommand(LOCAL_MEDIA_ENGINE_CUT_URL), {
    kind: "cut"
  });
  assert.deepEqual(parseLocalMediaEngineLaunchCommand(PAIR_URL), {
    kind: "pair",
    pairingRequest: { state: STATE, challenge: CHALLENGE }
  });
  for (const invalid of [
    "KIRINUKI-ENGINE://cut",
    "kirinuki-engine://cut/",
    "kirinuki-engine://cut?next=editor",
    "kirinuki-engine://cut#fragment",
    "kirinuki-engine://user@cut",
    "kirinuki-engine://cut:4319"
  ]) {
    assert.throws(
      () => parseLocalMediaEngineLaunchCommand(invalid),
      /연결 링크|필드/u,
      invalid
    );
  }
});

test("cold/warm argv는 pair와 cut을 합쳐 정확히 하나만 받는다", () => {
  assert.deepEqual(extractLocalMediaEngineLaunchCommandFromArgv([
    "Kirinuki.exe",
    LOCAL_MEDIA_ENGINE_CUT_URL
  ]), { kind: "cut" });
  assert.deepEqual(extractLocalMediaEngineLaunchCommandFromArgv([
    "/Applications/Kirinuki.app/Contents/MacOS/Kirinuki",
    PAIR_URL
  ]), {
    kind: "pair",
    pairingRequest: { state: STATE, challenge: CHALLENGE }
  });
  assert.equal(extractLocalMediaEngineLaunchCommandFromArgv([
    "Kirinuki",
    "--engine-background"
  ]), null);
  assert.throws(
    () => extractLocalMediaEngineLaunchCommandFromArgv([
      "Kirinuki",
      PAIR_URL,
      LOCAL_MEDIA_ENGINE_CUT_URL
    ]),
    /하나만/u
  );
});
