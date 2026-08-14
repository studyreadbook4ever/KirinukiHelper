import type { VideoSample } from "mediabunny";

/**
 * First-party WebGL2 video scaling shaders.
 *
 * This implementation was written for KirinukiHelper and does not contain
 * third-party shader source. It intentionally has no runtime dependency.
 */

export interface AdaptiveVideoRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AdaptiveVideoScaleRequest {
  sourceWidth: number;
  sourceHeight: number;
  sourceRect: AdaptiveVideoRect;
  destinationRect: AdaptiveVideoRect;
  outputWidth: number;
  outputHeight: number;
  /** User-facing strength in the inclusive 0..1 range. Defaults to 0.6. */
  sharpness?: number;
}

export type AdaptiveVideoPlacement = Omit<
  AdaptiveVideoScaleRequest,
  "sourceWidth" | "sourceHeight"
>;

export interface AdaptiveVideoScaleProfile {
  scaleX: number;
  scaleY: number;
  maximumScale: number;
  minimumScale: number;
  anisotropy: number;
  adaptationX: number;
  adaptationY: number;
  adaptation: number;
  sharpness: number;
}

export interface AdaptiveVideoScalePlan extends AdaptiveVideoScaleRequest {
  visibleDestinationRect: AdaptiveVideoRect | null;
  sourceUvRect: AdaptiveVideoRect;
  profile: AdaptiveVideoScaleProfile;
}

export type AdaptiveVideoScalerSurface = HTMLCanvasElement | OffscreenCanvas;
export type AdaptiveVideoTextureSource = TexImageSource;
export type AdaptiveMediabunnyVideoSample = Pick<
  VideoSample,
  "displayWidth" | "displayHeight" | "draw"
>;

export type AdaptiveVideoBackend = "webgl2-lanczos2";
export type AdaptiveVideoQualityTier = "high";

export interface AdaptiveVideoCapabilityStatus {
  backend: AdaptiveVideoBackend;
  qualityTier: AdaptiveVideoQualityTier;
  correctnessSelfTest: "passed";
  warmFrameTiming: "pending" | "passed";
}

const DEFAULT_SHARPNESS = 0.6;
const MAX_LOGICAL_DIMENSION = 1_000_000;
const MAX_GL_ERRORS_PER_CHECK = 8;

function finiteNumber(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return parsed;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = Math.round(finiteNumber(value, label));
  if (parsed < 1 || parsed > MAX_LOGICAL_DIMENSION) {
    throw new RangeError(
      `${label} must be an integer from 1 to ${MAX_LOGICAL_DIMENSION}.`
    );
  }
  return parsed;
}

function finiteRect(value: unknown, label: string): AdaptiveVideoRect {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a rectangle object.`);
  }
  const rect = value as Partial<Record<keyof AdaptiveVideoRect, unknown>>;
  const normalized = {
    x: finiteNumber(rect.x, `${label}.x`),
    y: finiteNumber(rect.y, `${label}.y`),
    width: finiteNumber(rect.width, `${label}.width`),
    height: finiteNumber(rect.height, `${label}.height`)
  };
  if (normalized.width <= 0 || normalized.height <= 0) {
    throw new RangeError(`${label} width and height must be positive.`);
  }
  return normalized;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothStep(edge0: number, edge1: number, value: number): number {
  const unit = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return unit * unit * (3 - 2 * unit);
}

function frameTimingBudgetMs(
  width: number,
  height: number,
  canvasFallbackMs: number | null
): number {
  const absoluteBudget = clamp(12 + width * height / 120_000, 28, 120);
  if (canvasFallbackMs === null) {
    return absoluteBudget;
  }
  const relativeBudget = Math.max(24, canvasFallbackMs * 2.5);
  return Math.min(absoluteBudget, relativeBudget);
}

function monotonicNow(): number {
  return typeof performance !== "undefined"
    ? performance.now()
    : Date.now();
}

export function adaptiveVideoScaleProfile(
  sourceWidthValue: unknown,
  sourceHeightValue: unknown,
  destinationWidthValue: unknown,
  destinationHeightValue: unknown,
  sharpnessValue: unknown = DEFAULT_SHARPNESS
): AdaptiveVideoScaleProfile {
  const sourceWidth = positiveInteger(sourceWidthValue, "sourceWidth");
  const sourceHeight = positiveInteger(sourceHeightValue, "sourceHeight");
  const destinationWidth = positiveInteger(
    destinationWidthValue,
    "destinationWidth"
  );
  const destinationHeight = positiveInteger(
    destinationHeightValue,
    "destinationHeight"
  );
  const requestedSharpness = clamp(
    finiteNumber(sharpnessValue, "sharpness"),
    0,
    1
  );
  const scaleX = destinationWidth / sourceWidth;
  const scaleY = destinationHeight / sourceHeight;
  const maximumScale = Math.max(scaleX, scaleY);
  const minimumScale = Math.min(scaleX, scaleY);
  const anisotropy = maximumScale / Math.max(1e-6, minimumScale);
  const adaptationX = smoothStep(1.001, 1.35, scaleX);
  const adaptationY = smoothStep(1.001, 1.35, scaleY);
  const detailWeight = smoothStep(1.8, 3.5, minimumScale);
  const anisotropyPenalty = 1 / Math.sqrt(Math.max(1, anisotropy));
  const extremeScalePenalty = 1 / Math.sqrt(Math.max(1, maximumScale / 2));
  return {
    scaleX,
    scaleY,
    maximumScale,
    minimumScale,
    anisotropy,
    adaptationX,
    adaptationY,
    adaptation: Math.max(adaptationX, adaptationY),
    sharpness: clamp(
      requestedSharpness
      * detailWeight
      * 0.22
      * (0.7 + 0.3 * anisotropyPenalty)
      * extremeScalePenalty,
      0,
      1
    )
  };
}

export function buildAdaptiveVideoScalePlan(
  request: AdaptiveVideoScaleRequest
): AdaptiveVideoScalePlan {
  if (!request || typeof request !== "object") {
    throw new TypeError("request must be an object.");
  }
  const sourceWidth = positiveInteger(request.sourceWidth, "sourceWidth");
  const sourceHeight = positiveInteger(request.sourceHeight, "sourceHeight");
  const outputWidth = positiveInteger(request.outputWidth, "outputWidth");
  const outputHeight = positiveInteger(request.outputHeight, "outputHeight");
  const rawSource = finiteRect(request.sourceRect, "sourceRect");
  const sourceLeft = clamp(rawSource.x, 0, sourceWidth);
  const sourceTop = clamp(rawSource.y, 0, sourceHeight);
  const sourceRight = clamp(
    rawSource.x + rawSource.width,
    0,
    sourceWidth
  );
  const sourceBottom = clamp(
    rawSource.y + rawSource.height,
    0,
    sourceHeight
  );
  if (sourceRight <= sourceLeft || sourceBottom <= sourceTop) {
    throw new RangeError("sourceRect does not overlap the decoded frame.");
  }
  const sourceRect = {
    x: sourceLeft,
    y: sourceTop,
    width: sourceRight - sourceLeft,
    height: sourceBottom - sourceTop
  };
  const rawDestination = finiteRect(request.destinationRect, "destinationRect");
  const destinationRect = {
    x: Math.round(rawDestination.x),
    y: Math.round(rawDestination.y),
    width: positiveInteger(rawDestination.width, "destinationRect.width"),
    height: positiveInteger(rawDestination.height, "destinationRect.height")
  };
  if (
    !Number.isSafeInteger(destinationRect.x)
    || !Number.isSafeInteger(destinationRect.y)
  ) {
    throw new RangeError("destinationRect position must use safe integers.");
  }
  const visibleLeft = Math.max(0, destinationRect.x);
  const visibleTop = Math.max(0, destinationRect.y);
  const visibleRight = Math.min(
    outputWidth,
    destinationRect.x + destinationRect.width
  );
  const visibleBottom = Math.min(
    outputHeight,
    destinationRect.y + destinationRect.height
  );
  const visibleDestinationRect = (
    visibleRight > visibleLeft && visibleBottom > visibleTop
  )
    ? {
      x: visibleLeft,
      y: visibleTop,
      width: visibleRight - visibleLeft,
      height: visibleBottom - visibleTop
    }
    : null;
  const sharpness = request.sharpness === undefined
    ? DEFAULT_SHARPNESS
    : finiteNumber(request.sharpness, "sharpness");
  return {
    sourceWidth,
    sourceHeight,
    sourceRect,
    destinationRect,
    outputWidth,
    outputHeight,
    sharpness: clamp(sharpness, 0, 1),
    visibleDestinationRect,
    sourceUvRect: {
      x: sourceRect.x / sourceWidth,
      y: sourceRect.y / sourceHeight,
      width: sourceRect.width / sourceWidth,
      height: sourceRect.height / sourceHeight
    },
    profile: adaptiveVideoScaleProfile(
      sourceRect.width,
      sourceRect.height,
      destinationRect.width,
      destinationRect.height,
      sharpness
    )
  };
}

export const ADAPTIVE_VIDEO_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_unit;
uniform vec4 u_destination;
uniform vec2 u_output_size;

out vec2 v_unit;
out vec2 v_canvas_uv;

void main() {
  vec2 pixel = u_destination.xy + a_unit * u_destination.zw;
  vec2 ndc = vec2(
    pixel.x / u_output_size.x * 2.0 - 1.0,
    1.0 - pixel.y / u_output_size.y * 2.0
  );
  gl_Position = vec4(ndc, 0.0, 1.0);
  v_unit = a_unit;
  v_canvas_uv = pixel / u_output_size;
}
`;

export const ADAPTIVE_UPSCALE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_source;
uniform vec2 u_source_size;
uniform vec4 u_source_uv;
uniform vec2 u_adaptation;

in vec2 v_unit;
out vec4 out_color;

const float LANCZOS_PI = 3.14159265358979323846;

float sincKernel(float value) {
  float magnitude = abs(value);
  if (magnitude < 0.00001) {
    return 1.0;
  }
  float angle = LANCZOS_PI * magnitude;
  return sin(angle) / angle;
}

float lanczosTwo(float value) {
  float magnitude = abs(value);
  if (magnitude >= 2.0) {
    return 0.0;
  }
  return sincKernel(magnitude) * sincKernel(0.5 * magnitude);
}

float linearKernel(float value) {
  return max(1.0 - abs(value), 0.0);
}

float adaptiveKernel(float value, float adaptation) {
  return mix(linearKernel(value), lanczosTwo(value), adaptation);
}

vec3 sampleSourcePixel(vec2 pixel_index) {
  vec2 first_center = u_source_uv.xy * u_source_size + vec2(0.5);
  vec2 last_center = (
    u_source_uv.xy + u_source_uv.zw
  ) * u_source_size - vec2(0.5);
  vec2 center = clamp(
    pixel_index + vec2(0.5),
    first_center,
    last_center
  );
  return texture(u_source, center / u_source_size).rgb;
}

void main() {
  vec2 source_pixel = (
    u_source_uv.xy + v_unit * u_source_uv.zw
  ) * u_source_size - vec2(0.5);
  vec2 base = floor(source_pixel);
  vec2 fraction = source_pixel - base;
  vec3 reconstructed = vec3(0.0);
  vec3 local_minimum = vec3(1.0);
  vec3 local_maximum = vec3(0.0);
  float total_weight = 0.0;

  // The 4x4 kernel is mathematically separable. Each axis independently
  // transitions from its 2-tap linear kernel to Lanczos-2 only when that axis
  // is enlarged, so mixed downscale/upscale geometry remains semantic.
  for (int y = -1; y <= 2; y += 1) {
    float weight_y = adaptiveKernel(
      float(y) - fraction.y,
      u_adaptation.y
    );
    for (int x = -1; x <= 2; x += 1) {
      float weight = adaptiveKernel(
        float(x) - fraction.x,
        u_adaptation.x
      ) * weight_y;
      vec3 sample_color = sampleSourcePixel(
        base + vec2(float(x), float(y))
      );
      reconstructed += sample_color * weight;
      local_minimum = min(local_minimum, sample_color);
      local_maximum = max(local_maximum, sample_color);
      total_weight += weight;
    }
  }
  reconstructed /= max(abs(total_weight), 0.00001);
  reconstructed = clamp(reconstructed, local_minimum, local_maximum);
  out_color = vec4(clamp(reconstructed, 0.0, 1.0), 1.0);
}
`;

export const ADAPTIVE_SHARPEN_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_reconstructed;
uniform vec2 u_output_size;
uniform vec4 u_destination_uv;
uniform float u_sharpness;

in vec2 v_canvas_uv;
out vec4 out_color;

float adaptiveLuma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

vec3 sampleReconstructed(vec2 top_left_uv) {
  vec2 half_texel = 0.5 / u_output_size;
  vec2 visible_minimum = max(u_destination_uv.xy, vec2(0.0));
  vec2 visible_maximum = min(
    u_destination_uv.xy + u_destination_uv.zw,
    vec2(1.0)
  );
  vec2 visible_center = 0.5 * (visible_minimum + visible_maximum);
  vec2 minimum_uv = min(visible_minimum + half_texel, visible_center);
  vec2 maximum_uv = max(visible_maximum - half_texel, visible_center);
  vec2 safe_uv = clamp(top_left_uv, minimum_uv, maximum_uv);
  return texture(u_reconstructed, vec2(safe_uv.x, 1.0 - safe_uv.y)).rgb;
}

void main() {
  vec2 texel = 1.0 / u_output_size;
  vec3 center = sampleReconstructed(v_canvas_uv);
  vec3 west = sampleReconstructed(v_canvas_uv - vec2(texel.x, 0.0));
  vec3 east = sampleReconstructed(v_canvas_uv + vec2(texel.x, 0.0));
  vec3 north = sampleReconstructed(v_canvas_uv - vec2(0.0, texel.y));
  vec3 south = sampleReconstructed(v_canvas_uv + vec2(0.0, texel.y));
  vec3 local_minimum = min(center, min(min(west, east), min(north, south)));
  vec3 local_maximum = max(center, max(max(west, east), max(north, south)));
  float contrast = adaptiveLuma(local_maximum) - adaptiveLuma(local_minimum);
  float noise_gate = smoothstep(0.006, 0.025, contrast);
  float edge_gate = smoothstep(0.02, 0.24, contrast);
  float gain = u_sharpness * noise_gate * mix(0.2, 0.65, edge_gate);
  vec3 cross_average = 0.25 * (west + east + north + south);
  vec3 detail = center - cross_average;
  vec3 sharpened = center + detail * gain;
  out_color = vec4(clamp(sharpened, local_minimum, local_maximum), 1.0);
}
`;

interface AdaptiveProgram {
  program: WebGLProgram;
  unitAttribute: number;
  destination: WebGLUniformLocation;
  outputSize: WebGLUniformLocation;
}

interface UpscaleProgram extends AdaptiveProgram {
  source: WebGLUniformLocation;
  sourceSize: WebGLUniformLocation;
  sourceUv: WebGLUniformLocation;
  adaptation: WebGLUniformLocation;
}

interface SharpenProgram extends AdaptiveProgram {
  reconstructed: WebGLUniformLocation;
  destinationUv: WebGLUniformLocation;
  sharpness: WebGLUniformLocation;
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("WebGL2 shader allocation failed.");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || "unknown shader error";
    gl.deleteShader(shader);
    throw new Error(`Adaptive video shader compilation failed: ${log}`);
  }
  return shader;
}

function linkProgram(
  gl: WebGL2RenderingContext,
  fragmentSource: string
): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, ADAPTIVE_VIDEO_VERTEX_SHADER);
  let fragment: WebGLShader | null = null;
  let program: WebGLProgram | null = null;
  try {
    fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    program = gl.createProgram();
    if (!program) {
      throw new Error("WebGL2 program allocation failed.");
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) || "unknown link error";
      throw new Error(`Adaptive video shader link failed: ${log}`);
    }
    return program;
  } catch (error) {
    if (program) {
      gl.deleteProgram(program);
    }
    throw error;
  } finally {
    gl.deleteShader(vertex);
    if (fragment) {
      gl.deleteShader(fragment);
    }
  }
}

function uniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (!location) {
    throw new Error(`Adaptive video shader uniform is missing: ${name}`);
  }
  return location;
}

function baseProgram(
  gl: WebGL2RenderingContext,
  program: WebGLProgram
): AdaptiveProgram {
  const unitAttribute = gl.getAttribLocation(program, "a_unit");
  if (unitAttribute < 0) {
    throw new Error("Adaptive video shader attribute is missing: a_unit");
  }
  return {
    program,
    unitAttribute,
    destination: uniform(gl, program, "u_destination"),
    outputSize: uniform(gl, program, "u_output_size")
  };
}

function createTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) {
    throw new Error("WebGL2 texture allocation failed.");
  }
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function createStagingSurface(
  width: number,
  height: number
): AdaptiveVideoScalerSurface {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error("A browser canvas is required to stage a Mediabunny VideoSample.");
}

/**
 * Two-pass first-party WebGL2 renderer shared by preview and export paths.
 * Render preview frames at the canonical export size and downsample only the
 * returned surface for a pixel-faithful preview of the final result.
 */
export class AdaptiveVideoScaler {
  readonly surface: AdaptiveVideoScalerSurface;
  readonly backend: AdaptiveVideoBackend = "webgl2-lanczos2";
  readonly qualityTier: AdaptiveVideoQualityTier = "high";

  private readonly gl: WebGL2RenderingContext;
  private readonly upscaleProgram: UpscaleProgram;
  private readonly sharpenProgram: SharpenProgram;
  private readonly vertexBuffer: WebGLBuffer;
  private readonly vertexArray: WebGLVertexArrayObject;
  private readonly sourceTexture: WebGLTexture;
  private readonly reconstructedTexture: WebGLTexture;
  private readonly framebuffer: WebGLFramebuffer;
  private readonly maximumTextureSize: number;

  private sourceTextureWidth = 0;
  private sourceTextureHeight = 0;
  private reconstructedWidth = 0;
  private reconstructedHeight = 0;
  private stagingSurface: AdaptiveVideoScalerSurface | null = null;
  private stagingContext:
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null = null;
  private warmFrameTimingPassed = false;
  private disposed = false;

  get capabilityStatus(): AdaptiveVideoCapabilityStatus {
    return {
      backend: this.backend,
      qualityTier: this.qualityTier,
      correctnessSelfTest: "passed",
      warmFrameTiming: this.warmFrameTimingPassed ? "passed" : "pending"
    };
  }

  constructor(surface: AdaptiveVideoScalerSurface) {
    this.surface = surface;
    const gl = surface.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      desynchronized: false,
      failIfMajorPerformanceCaveat: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      stencil: false
    }) as WebGL2RenderingContext | null;
    if (!gl) {
      throw new Error("WebGL2 is unavailable; use the Canvas2D renderer fallback.");
    }
    this.gl = gl;
    this.drainStaleGlErrors();
    this.maximumTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));

    let upscaleLinked: WebGLProgram | null = null;
    let sharpenLinked: WebGLProgram | null = null;
    let vertexBuffer: WebGLBuffer | null = null;
    let vertexArray: WebGLVertexArrayObject | null = null;
    let framebuffer: WebGLFramebuffer | null = null;
    let sourceTexture: WebGLTexture | null = null;
    let reconstructedTexture: WebGLTexture | null = null;
    try {
      upscaleLinked = linkProgram(gl, ADAPTIVE_UPSCALE_FRAGMENT_SHADER);
      const upscaleProgram: UpscaleProgram = {
        ...baseProgram(gl, upscaleLinked),
        source: uniform(gl, upscaleLinked, "u_source"),
        sourceSize: uniform(gl, upscaleLinked, "u_source_size"),
        sourceUv: uniform(gl, upscaleLinked, "u_source_uv"),
        adaptation: uniform(gl, upscaleLinked, "u_adaptation")
      };
      sharpenLinked = linkProgram(gl, ADAPTIVE_SHARPEN_FRAGMENT_SHADER);
      const sharpenProgram: SharpenProgram = {
        ...baseProgram(gl, sharpenLinked),
        reconstructed: uniform(gl, sharpenLinked, "u_reconstructed"),
        destinationUv: uniform(gl, sharpenLinked, "u_destination_uv"),
        sharpness: uniform(gl, sharpenLinked, "u_sharpness")
      };

      vertexBuffer = gl.createBuffer();
      vertexArray = gl.createVertexArray();
      framebuffer = gl.createFramebuffer();
      if (!vertexBuffer || !vertexArray || !framebuffer) {
        throw new Error("WebGL2 adaptive renderer resource allocation failed.");
      }
      sourceTexture = createTexture(gl);
      reconstructedTexture = createTexture(gl);

      gl.bindVertexArray(vertexArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([
          0, 0,
          1, 0,
          0, 1,
          0, 1,
          1, 0,
          1, 1
        ]),
        gl.STATIC_DRAW
      );
      gl.enableVertexAttribArray(upscaleProgram.unitAttribute);
      gl.vertexAttribPointer(
        upscaleProgram.unitAttribute,
        2,
        gl.FLOAT,
        false,
        0,
        0
      );
      if (sharpenProgram.unitAttribute !== upscaleProgram.unitAttribute) {
        gl.enableVertexAttribArray(sharpenProgram.unitAttribute);
        gl.vertexAttribPointer(
          sharpenProgram.unitAttribute,
          2,
          gl.FLOAT,
          false,
          0,
          0
        );
      }
      gl.bindVertexArray(null);

      this.upscaleProgram = upscaleProgram;
      this.sharpenProgram = sharpenProgram;
      this.vertexBuffer = vertexBuffer;
      this.vertexArray = vertexArray;
      this.framebuffer = framebuffer;
      this.sourceTexture = sourceTexture;
      this.reconstructedTexture = reconstructedTexture;
      this.assertNoGlError("constructor resource allocation");
      this.runCorrectnessSelfTest();
    } catch (error) {
      gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (sourceTexture) {
        gl.deleteTexture(sourceTexture);
      }
      if (reconstructedTexture) {
        gl.deleteTexture(reconstructedTexture);
      }
      if (framebuffer) {
        gl.deleteFramebuffer(framebuffer);
      }
      if (vertexBuffer) {
        gl.deleteBuffer(vertexBuffer);
      }
      if (vertexArray) {
        gl.deleteVertexArray(vertexArray);
      }
      if (upscaleLinked) {
        gl.deleteProgram(upscaleLinked);
      }
      if (sharpenLinked) {
        gl.deleteProgram(sharpenLinked);
      }
      throw error;
    }
  }

  renderHtmlVideo(
    video: HTMLVideoElement,
    placement: AdaptiveVideoPlacement
  ): AdaptiveVideoScalePlan {
    if (!(video instanceof HTMLVideoElement)) {
      throw new TypeError("video must be an HTMLVideoElement.");
    }
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      throw new Error("The HTML video does not have a decoded frame yet.");
    }
    return this.renderTextureSource(video, {
      ...placement,
      sourceWidth: video.videoWidth,
      sourceHeight: video.videoHeight
    });
  }

  renderVideoSample(
    sample: AdaptiveMediabunnyVideoSample,
    placement: AdaptiveVideoPlacement
  ): AdaptiveVideoScalePlan {
    const width = positiveInteger(sample?.displayWidth, "sample.displayWidth");
    const height = positiveInteger(sample?.displayHeight, "sample.displayHeight");
    this.ensureStagingSurface(width, height);
    const context = this.stagingContext;
    if (!context || !this.stagingSurface) {
      throw new Error("The VideoSample staging canvas is unavailable.");
    }
    context.clearRect(0, 0, width, height);
    sample.draw(context, 0, 0, width, height);
    return this.renderTextureSource(this.stagingSurface, {
      ...placement,
      sourceWidth: width,
      sourceHeight: height
    });
  }

  renderTextureSource(
    source: AdaptiveVideoTextureSource,
    request: AdaptiveVideoScaleRequest
  ): AdaptiveVideoScalePlan {
    this.assertUsable();
    this.drainStaleGlErrors();
    const plan = buildAdaptiveVideoScalePlan(request);
    const canvasFallbackMs = (
      !this.warmFrameTimingPassed && plan.visibleDestinationRect
    )
      ? this.measureCanvasFallbackTime(source, plan)
      : null;
    const timingStartedAt = (
      !this.warmFrameTimingPassed && plan.visibleDestinationRect
    )
      ? monotonicNow()
      : null;
    this.ensureOutput(plan.outputWidth, plan.outputHeight);
    this.clearFramebuffer(null, plan.outputWidth, plan.outputHeight);
    this.clearFramebuffer(
      this.framebuffer,
      plan.outputWidth,
      plan.outputHeight
    );
    this.assertNoGlError("output allocation and clear");
    if (!plan.visibleDestinationRect) {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      return plan;
    }
    this.uploadSource(source, plan.sourceWidth, plan.sourceHeight);
    this.assertNoGlError("source upload");
    this.drawUpscalePass(plan);
    this.assertNoGlError("Lanczos-2 reconstruction draw");
    this.drawSharpenPass(plan);
    this.assertNoGlError("bounded sharpen draw");
    this.gl.flush();
    this.assertNoGlError("command flush");
    if (timingStartedAt !== null) {
      this.gl.finish();
      this.assertNoGlError("warm-frame timing calibration");
      this.completeOutputCompositionProbe(plan.outputWidth, plan.outputHeight);
      const elapsed = monotonicNow() - timingStartedAt;
      if (elapsed > frameTimingBudgetMs(
        plan.outputWidth,
        plan.outputHeight,
        canvasFallbackMs
      )) {
        throw new Error(
          "AdaptiveVideoScaler exceeded its warm-frame time budget; "
          + "use the Canvas2D fallback for this session."
        );
      }
      this.warmFrameTimingPassed = true;
    }
    return plan;
  }

  destroy(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const gl = this.gl;
    gl.deleteTexture(this.sourceTexture);
    gl.deleteTexture(this.reconstructedTexture);
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteBuffer(this.vertexBuffer);
    gl.deleteVertexArray(this.vertexArray);
    gl.deleteProgram(this.upscaleProgram.program);
    gl.deleteProgram(this.sharpenProgram.program);
    this.stagingSurface = null;
    this.stagingContext = null;
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error("AdaptiveVideoScaler has been destroyed.");
    }
    if (this.gl.isContextLost()) {
      throw new Error("AdaptiveVideoScaler WebGL2 context is lost.");
    }
  }

  private drainStaleGlErrors(): void {
    const gl = this.gl;
    for (let index = 0; index < MAX_GL_ERRORS_PER_CHECK; index += 1) {
      const error = gl.getError();
      if (error === gl.NO_ERROR) {
        return;
      }
      if (error === gl.CONTEXT_LOST_WEBGL || gl.isContextLost()) {
        throw new Error("AdaptiveVideoScaler WebGL2 context is lost.");
      }
    }
    if (gl.getError() !== gl.NO_ERROR) {
      throw new Error(
        "AdaptiveVideoScaler could not drain the stale WebGL2 error queue."
      );
    }
  }

  private assertNoGlError(stage: string): void {
    const gl = this.gl;
    if (gl.isContextLost()) {
      throw new Error(`AdaptiveVideoScaler context was lost during ${stage}.`);
    }
    const errors: string[] = [];
    for (let index = 0; index < MAX_GL_ERRORS_PER_CHECK; index += 1) {
      const error = gl.getError();
      if (error === gl.NO_ERROR) {
        break;
      }
      if (error === gl.CONTEXT_LOST_WEBGL || gl.isContextLost()) {
        throw new Error(`AdaptiveVideoScaler context was lost during ${stage}.`);
      }
      const label = error === gl.INVALID_ENUM
        ? "INVALID_ENUM"
        : error === gl.INVALID_VALUE
          ? "INVALID_VALUE"
          : error === gl.INVALID_OPERATION
            ? "INVALID_OPERATION"
            : error === gl.INVALID_FRAMEBUFFER_OPERATION
              ? "INVALID_FRAMEBUFFER_OPERATION"
              : error === gl.OUT_OF_MEMORY
                ? "OUT_OF_MEMORY"
                : `0x${error.toString(16)}`;
      if (!errors.includes(label)) {
        errors.push(label);
      }
    }
    if (errors.length > 0) {
      throw new Error(
        `AdaptiveVideoScaler WebGL2 ${stage} failed: ${errors.join(", ")}.`
      );
    }
  }

  private runCorrectnessSelfTest(): void {
    const source = createStagingSurface(2, 2);
    const context = source.getContext("2d", { alpha: false }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!context) {
      throw new Error(
        "AdaptiveVideoScaler cannot run its Canvas2D correctness self-test."
      );
    }
    const image = context.createImageData(2, 2);
    image.data.set([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 0, 255
    ]);
    context.putImageData(image, 0, 0);
    const plan = buildAdaptiveVideoScalePlan({
      sourceWidth: 2,
      sourceHeight: 2,
      sourceRect: { x: 0, y: 0, width: 2, height: 2 },
      destinationRect: { x: 0, y: 0, width: 5, height: 7 },
      outputWidth: 5,
      outputHeight: 7,
      sharpness: 0
    });
    if (plan.profile.adaptationX !== 1 || plan.profile.adaptationY !== 1) {
      throw new Error("AdaptiveVideoScaler self-test did not select Lanczos-2.");
    }
    this.ensureOutput(5, 7);
    this.clearFramebuffer(null, 5, 7);
    this.clearFramebuffer(this.framebuffer, 5, 7);
    this.uploadSource(source, 2, 2);
    this.drawUpscalePass(plan);
    this.drawSharpenPass(plan);
    this.gl.finish();
    this.assertNoGlError("correctness self-test");

    const pixels = new Uint8Array(5 * 7 * 4);
    this.gl.readPixels(
      0,
      0,
      5,
      7,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      pixels
    );
    this.assertNoGlError("correctness self-test readback");
    const corner = (x: number, y: number) => {
      const offset = (y * 5 + x) * 4;
      return pixels.subarray(offset, offset + 4);
    };
    const closeColor = (actual: Uint8Array, expected: readonly number[]) => (
      actual.every((value, index) => (
        Math.abs(value - (expected[index] ?? 0)) <= 8
      ))
    );
    const opaque = pixels.every((value, index) => (
      index % 4 !== 3 || value === 255
    ));
    const accurate = opaque
      && closeColor(corner(0, 0), [0, 0, 255, 255])
      && closeColor(corner(4, 0), [255, 255, 0, 255])
      && closeColor(corner(0, 6), [255, 0, 0, 255])
      && closeColor(corner(4, 6), [0, 255, 0, 255]);
    if (!accurate) {
      throw new Error(
        "AdaptiveVideoScaler WebGL2 correctness self-test failed; "
        + "use the Canvas2D fallback."
      );
    }
  }

  private measureCanvasFallbackTime(
    source: AdaptiveVideoTextureSource,
    plan: AdaptiveVideoScalePlan
  ): number | null {
    const visible = plan.visibleDestinationRect;
    if (!visible) {
      return null;
    }
    try {
      const surface = createStagingSurface(plan.outputWidth, plan.outputHeight);
      const context = surface.getContext("2d", {
        alpha: true,
        willReadFrequently: true
      }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!context) {
        return null;
      }
      const startedAt = monotonicNow();
      context.clearRect(0, 0, plan.outputWidth, plan.outputHeight);
      context.drawImage(
        source as CanvasImageSource,
        plan.sourceRect.x,
        plan.sourceRect.y,
        plan.sourceRect.width,
        plan.sourceRect.height,
        plan.destinationRect.x,
        plan.destinationRect.y,
        plan.destinationRect.width,
        plan.destinationRect.height
      );
      if (
        typeof OffscreenCanvas !== "undefined"
        && surface instanceof OffscreenCanvas
      ) {
        const frame = surface.transferToImageBitmap();
        frame.close();
      } else {
        const probeX = clamp(
          Math.floor(visible.x + visible.width / 2),
          0,
          plan.outputWidth - 1
        );
        const probeY = clamp(
          Math.floor(visible.y + visible.height / 2),
          0,
          plan.outputHeight - 1
        );
        context.getImageData(probeX, probeY, 1, 1);
      }
      return monotonicNow() - startedAt;
    } catch {
      // Cross-origin media can prohibit readback. The absolute budget remains
      // a non-fingerprinting fallback when a relative Canvas probe is unsafe.
      return null;
    }
  }

  private completeOutputCompositionProbe(width: number, height: number): void {
    try {
      const surface = createStagingSurface(width, height);
      const context = surface.getContext("2d", {
        alpha: true,
        willReadFrequently: true
      }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!context) {
        return;
      }
      context.drawImage(this.surface, 0, 0);
      if (
        typeof OffscreenCanvas !== "undefined"
        && surface instanceof OffscreenCanvas
      ) {
        const frame = surface.transferToImageBitmap();
        frame.close();
      } else {
        context.getImageData(0, 0, 1, 1);
      }
    } catch {
      // This probe is advisory; render correctness and GL errors remain
      // fail-closed even if the browser disallows an auxiliary readback.
    }
  }

  private ensureStagingSurface(width: number, height: number): void {
    if (!this.stagingSurface) {
      this.stagingSurface = createStagingSurface(width, height);
      this.stagingContext = this.stagingSurface.getContext(
        "2d",
        { alpha: false }
      ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!this.stagingContext) {
        throw new Error("A Canvas2D context is required for VideoSample staging.");
      }
    }
    if (
      this.stagingSurface.width !== width
      || this.stagingSurface.height !== height
    ) {
      this.stagingSurface.width = width;
      this.stagingSurface.height = height;
    }
  }

  private ensureOutput(width: number, height: number): void {
    if (width > this.maximumTextureSize || height > this.maximumTextureSize) {
      throw new RangeError(
        `Adaptive output ${width}x${height} exceeds WebGL2 MAX_TEXTURE_SIZE `
        + `${this.maximumTextureSize}.`
      );
    }
    if (this.surface.width !== width || this.surface.height !== height) {
      this.surface.width = width;
      this.surface.height = height;
    }
    if (
      this.reconstructedWidth === width
      && this.reconstructedHeight === height
    ) {
      return;
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.reconstructedTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.reconstructedTexture,
      0
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Adaptive video reconstruction framebuffer is incomplete.");
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.reconstructedWidth = width;
    this.reconstructedHeight = height;
  }

  private clearFramebuffer(
    framebuffer: WebGLFramebuffer | null,
    width: number,
    height: number
  ): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private uploadSource(
    source: AdaptiveVideoTextureSource,
    width: number,
    height: number
  ): void {
    if (width > this.maximumTextureSize || height > this.maximumTextureSize) {
      throw new RangeError(
        `Adaptive source ${width}x${height} exceeds WebGL2 MAX_TEXTURE_SIZE `
        + `${this.maximumTextureSize}.`
      );
    }
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    // Keep DOM-source rows in their native top-left order. ImageBitmap and
    // VideoFrame are allowed to ignore UNPACK_FLIP_Y_WEBGL, so relying on that
    // flag would make the public TexImageSource API source-type-dependent.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    if (
      this.sourceTextureWidth === width
      && this.sourceTextureHeight === height
    ) {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source
      );
    } else {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source
      );
      this.sourceTextureWidth = width;
      this.sourceTextureHeight = height;
    }
  }

  private bindGeometry(program: AdaptiveProgram, plan: AdaptiveVideoScalePlan): void {
    const gl = this.gl;
    gl.useProgram(program.program);
    gl.bindVertexArray(this.vertexArray);
    gl.uniform4f(
      program.destination,
      plan.destinationRect.x,
      plan.destinationRect.y,
      plan.destinationRect.width,
      plan.destinationRect.height
    );
    gl.uniform2f(program.outputSize, plan.outputWidth, plan.outputHeight);
  }

  private drawUpscalePass(plan: AdaptiveVideoScalePlan): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, plan.outputWidth, plan.outputHeight);
    this.bindGeometry(this.upscaleProgram, plan);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.uniform1i(this.upscaleProgram.source, 0);
    gl.uniform2f(
      this.upscaleProgram.sourceSize,
      plan.sourceWidth,
      plan.sourceHeight
    );
    gl.uniform4f(
      this.upscaleProgram.sourceUv,
      plan.sourceUvRect.x,
      plan.sourceUvRect.y,
      plan.sourceUvRect.width,
      plan.sourceUvRect.height
    );
    gl.uniform2f(
      this.upscaleProgram.adaptation,
      plan.profile.adaptationX,
      plan.profile.adaptationY
    );
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private drawSharpenPass(plan: AdaptiveVideoScalePlan): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, plan.outputWidth, plan.outputHeight);
    this.bindGeometry(this.sharpenProgram, plan);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.reconstructedTexture);
    gl.uniform1i(this.sharpenProgram.reconstructed, 0);
    gl.uniform4f(
      this.sharpenProgram.destinationUv,
      plan.destinationRect.x / plan.outputWidth,
      plan.destinationRect.y / plan.outputHeight,
      plan.destinationRect.width / plan.outputWidth,
      plan.destinationRect.height / plan.outputHeight
    );
    gl.uniform1f(this.sharpenProgram.sharpness, plan.profile.sharpness);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }
}
