import assert from "node:assert/strict";
import test from "node:test";

import {
  ADAPTIVE_SHARPEN_FRAGMENT_SHADER,
  ADAPTIVE_UPSCALE_FRAGMENT_SHADER,
  ADAPTIVE_VIDEO_VERTEX_SHADER,
  AdaptiveVideoScaler,
  adaptiveVideoScaleProfile,
  buildAdaptiveVideoScalePlan
} from "../src/editor/adaptive-video-scaler.js";

test("exact odd-pixel crop과 canonical destination을 변경 없이 계획한다", () => {
  const plan = buildAdaptiveVideoScalePlan({
    sourceWidth: 1919,
    sourceHeight: 1079,
    sourceRect: { x: 137, y: 53, width: 701, height: 509 },
    destinationRect: { x: 137, y: 251, width: 401, height: 703 },
    outputWidth: 1080,
    outputHeight: 1920,
    sharpness: 0.75
  });

  assert.deepEqual(plan.sourceRect, {
    x: 137,
    y: 53,
    width: 701,
    height: 509
  });
  assert.deepEqual(plan.destinationRect, {
    x: 137,
    y: 251,
    width: 401,
    height: 703
  });
  assert.deepEqual(plan.visibleDestinationRect, plan.destinationRect);
  assert.deepEqual(plan.sourceUvRect, {
    x: 137 / 1919,
    y: 53 / 1079,
    width: 701 / 1919,
    height: 509 / 1079
  });
  assert.equal(plan.profile.scaleX, 401 / 701);
  assert.equal(plan.profile.scaleY, 703 / 509);
  assert(plan.profile.adaptation > 0);
  assert.equal(plan.profile.sharpness, 0);
});

test("source overflow는 decoded frame과 교차하고 destination은 off-canvas geometry를 보존한다", () => {
  const plan = buildAdaptiveVideoScalePlan({
    sourceWidth: 640,
    sourceHeight: 360,
    sourceRect: { x: -80, y: 300, width: 240, height: 120 },
    destinationRect: { x: -101, y: 1900, width: 301, height: 101 },
    outputWidth: 1080,
    outputHeight: 1920
  });

  assert.deepEqual(plan.sourceRect, {
    x: 0,
    y: 300,
    width: 160,
    height: 60
  });
  assert.deepEqual(plan.destinationRect, {
    x: -101,
    y: 1900,
    width: 301,
    height: 101
  });
  assert.deepEqual(plan.visibleDestinationRect, {
    x: 0,
    y: 1900,
    width: 200,
    height: 20
  });

  const invisible = buildAdaptiveVideoScalePlan({
    ...plan,
    sourceRect: plan.sourceRect,
    destinationRect: { x: 1200, y: 0, width: 100, height: 100 }
  });
  assert.equal(invisible.visibleDestinationRect, null);
});

test("1배와 일반 1.78배에서는 sharpen을 끄고 큰 확대만 낮게 보정한다", () => {
  const native = adaptiveVideoScaleProfile(640, 360, 640, 360, 1);
  assert.equal(native.adaptation, 0);
  assert.equal(native.sharpness, 0);

  const representative = adaptiveVideoScaleProfile(
    608,
    1080,
    1080,
    1920,
    1
  );
  assert(representative.adaptationX > 0.99);
  assert(representative.adaptationY > 0.99);
  assert(representative.adaptation > 0.99);
  assert.equal(representative.sharpness, 0);

  const doubled = adaptiveVideoScaleProfile(640, 360, 1280, 720, 0.8);
  assert.equal(doubled.scaleX, 2);
  assert.equal(doubled.scaleY, 2);
  assert.equal(doubled.anisotropy, 1);
  assert(doubled.adaptation > 0.95 && doubled.adaptation <= 1);
  assert(doubled.sharpness > 0 && doubled.sharpness < 0.02);

  const tripled = adaptiveVideoScaleProfile(640, 360, 1920, 1080, 1);
  assert(tripled.sharpness > doubled.sharpness);
  assert(tripled.sharpness < 0.18);

  const anisotropic = adaptiveVideoScaleProfile(320, 360, 1080, 1920, 1);
  assert(anisotropic.anisotropy > 1.5);
  assert(anisotropic.adaptation >= 0 && anisotropic.adaptation <= 1);
  assert(anisotropic.sharpness >= 0 && anisotropic.sharpness <= 1);

  const shrinkX = adaptiveVideoScaleProfile(640, 360, 320, 720, 1);
  assert.equal(shrinkX.scaleX, 0.5);
  assert.equal(shrinkX.scaleY, 2);
  assert.equal(shrinkX.adaptationX, 0);
  assert(shrinkX.adaptationY > 0.99);
  assert.equal(shrinkX.sharpness, 0);

  const nativeX = adaptiveVideoScaleProfile(640, 360, 640, 2160, 1);
  assert.equal(nativeX.adaptationX, 0);
  assert.equal(nativeX.adaptationY, 1);
  assert.equal(nativeX.sharpness, 0);

  const nativeY = adaptiveVideoScaleProfile(640, 360, 3840, 360, 1);
  assert.equal(nativeY.adaptationX, 1);
  assert.equal(nativeY.adaptationY, 0);
  assert.equal(nativeY.sharpness, 0);

  const extreme = adaptiveVideoScaleProfile(64, 64, 4096, 4096, 1);
  assert(extreme.sharpness < tripled.sharpness);
});

test("잘못되거나 원본과 만나지 않는 geometry는 GPU 호출 전에 거부한다", () => {
  assert.throws(() => buildAdaptiveVideoScalePlan({
    sourceWidth: 640,
    sourceHeight: 360,
    sourceRect: { x: 700, y: 0, width: 10, height: 10 },
    destinationRect: { x: 0, y: 0, width: 1080, height: 1920 },
    outputWidth: 1080,
    outputHeight: 1920
  }), /does not overlap/u);
  assert.throws(() => buildAdaptiveVideoScalePlan({
    sourceWidth: 640,
    sourceHeight: 360,
    sourceRect: { x: 0, y: 0, width: 640, height: 360 },
    destinationRect: { x: 0, y: 0, width: 0, height: 1920 },
    outputWidth: 1080,
    outputHeight: 1920
  }), /must be positive/u);
  assert.throws(() => adaptiveVideoScaleProfile(
    640,
    360,
    1080,
    1920,
    Number.NaN
  ), /sharpness must be a finite number/u);
});

test("자체 WebGL2 shader는 separable Lanczos-2와 bounded sharpen 계약을 포함한다", () => {
  assert.match(ADAPTIVE_VIDEO_VERTEX_SHADER, /^#version 300 es/u);
  assert.match(ADAPTIVE_VIDEO_VERTEX_SHADER, /u_destination/u);
  assert.match(ADAPTIVE_UPSCALE_FRAGMENT_SHADER, /sincKernel/u);
  assert.match(ADAPTIVE_UPSCALE_FRAGMENT_SHADER, /lanczosTwo/u);
  assert.match(ADAPTIVE_UPSCALE_FRAGMENT_SHADER, /uniform vec2 u_adaptation/u);
  assert.match(ADAPTIVE_UPSCALE_FRAGMENT_SHADER, /adaptiveKernel/u);
  assert.match(ADAPTIVE_UPSCALE_FRAGMENT_SHADER, /for \(int y = -1/u);
  assert.match(ADAPTIVE_UPSCALE_FRAGMENT_SHADER, /for \(int x = -1/u);
  assert.match(ADAPTIVE_UPSCALE_FRAGMENT_SHADER, /u_adaptation/u);
  assert.match(ADAPTIVE_UPSCALE_FRAGMENT_SHADER, /local_minimum/u);
  assert.match(ADAPTIVE_SHARPEN_FRAGMENT_SHADER, /noise_gate/u);
  assert.match(ADAPTIVE_SHARPEN_FRAGMENT_SHADER, /cross_average/u);
  assert.match(ADAPTIVE_SHARPEN_FRAGMENT_SHADER, /visible_minimum/u);
  assert.match(ADAPTIVE_SHARPEN_FRAGMENT_SHADER, /clamp\(sharpened/u);
  assert.doesNotMatch(
    ADAPTIVE_UPSCALE_FRAGMENT_SHADER + ADAPTIVE_SHARPEN_FRAGMENT_SHADER,
    /(?:FSR|EASU|RCAS|third[- ]party)/iu
  );
});

test("느린 warm frame은 GPU 식별값 없이 Canvas2D fallback을 요구한다", () => {
  const scaler = Object.create(AdaptiveVideoScaler.prototype) as
    AdaptiveVideoScaler;
  Object.assign(scaler, {
    assertNoGlError: () => undefined,
    assertUsable: () => undefined,
    clearFramebuffer: () => undefined,
    completeOutputCompositionProbe: () => undefined,
    drainStaleGlErrors: () => undefined,
    drawSharpenPass: () => undefined,
    drawUpscalePass: () => undefined,
    ensureOutput: () => undefined,
    gl: {
      FRAMEBUFFER: 0x8d40,
      bindFramebuffer: () => undefined,
      finish: () => {
        const deadline = performance.now() + 32;
        while (performance.now() < deadline) {
          // Deliberately emulate a slow synchronous warm frame.
        }
      },
      flush: () => undefined
    },
    measureCanvasFallbackTime: () => 1,
    surface: { height: 8, width: 8 },
    uploadSource: () => undefined,
    warmFrameTimingPassed: false
  });

  assert.throws(() => scaler.renderTextureSource({} as TexImageSource, {
    sourceWidth: 8,
    sourceHeight: 8,
    sourceRect: { x: 0, y: 0, width: 8, height: 8 },
    destinationRect: { x: 0, y: 0, width: 8, height: 8 },
    outputWidth: 8,
    outputHeight: 8
  }), /warm-frame time budget/u);
});

test("stale flag는 비우되 allocation의 OUT_OF_MEMORY는 즉시 예외로 승격한다", () => {
  const errors = [0x0502, 0, 0x0505, 0];
  const fakeGl = {
    BLEND: 0x0be2,
    COLOR_BUFFER_BIT: 0x4000,
    CONTEXT_LOST_WEBGL: 0x9242,
    DEPTH_TEST: 0x0b71,
    FRAMEBUFFER: 0x8d40,
    INVALID_ENUM: 0x0500,
    INVALID_FRAMEBUFFER_OPERATION: 0x0506,
    INVALID_OPERATION: 0x0502,
    INVALID_VALUE: 0x0501,
    NO_ERROR: 0,
    OUT_OF_MEMORY: 0x0505,
    SCISSOR_TEST: 0x0c11,
    bindFramebuffer: () => undefined,
    clear: () => undefined,
    clearColor: () => undefined,
    disable: () => undefined,
    getError: () => errors.shift() ?? 0,
    isContextLost: () => false,
    viewport: () => undefined
  };
  const scaler = Object.create(AdaptiveVideoScaler.prototype) as
    AdaptiveVideoScaler;
  Object.assign(scaler, {
    disposed: false,
    framebuffer: {},
    gl: fakeGl,
    maximumTextureSize: 8192,
    reconstructedHeight: 8,
    reconstructedWidth: 8,
    surface: { height: 8, width: 8 },
    warmFrameTimingPassed: true
  });

  assert.throws(() => scaler.renderTextureSource({} as TexImageSource, {
    sourceWidth: 8,
    sourceHeight: 8,
    sourceRect: { x: 0, y: 0, width: 8, height: 8 },
    destinationRect: { x: 0, y: 0, width: 8, height: 8 },
    outputWidth: 8,
    outputHeight: 8
  }), /output allocation and clear failed: OUT_OF_MEMORY/u);
});
