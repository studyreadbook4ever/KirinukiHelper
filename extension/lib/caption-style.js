// Generated from TypeScript sources. Do not edit directly.
const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};
const DEFAULT_CAPTION_STYLE_PRESET_ID = "kr-vtuber-clean-v1";
const BLACK_BOX_CAPTION_STYLE_PRESET_ID = "kr-vtuber-black-box-v1";
const PAPERLOGY_CAPTION_STYLE_PRESET_ID = "kr-vtuber-paperlogy-v1";
const LEGACY_CAPTION_STYLE_PRESET_ID = "pretendard-legacy-v1";
const CAPTION_FONT_REGISTRY = deepFreeze({
  paperlogy: {
    id: "paperlogy",
    family: "Paperlogy",
    displayName: "Paperlogy ExtraBold",
    weight: 800,
    version: "1.001",
    file: "fonts/Paperlogy-8ExtraBold.woff2",
    license: "SIL Open Font License 1.1",
    licenseFile: "../licenses/PAPERLOGY-OFL-1.1.txt",
    upstream: "https://github.com/Freesentation/paperlogy/tree/8ef35f53b318c7ca914c52b1b382b9a8bad07a61"
  },
  pretendard: {
    id: "pretendard",
    family: "Pretendard",
    displayName: "Pretendard ExtraBold (legacy)",
    weight: 800,
    version: "1.3.9",
    file: "fonts/Pretendard-ExtraBold.woff2",
    license: "SIL Open Font License 1.1",
    licenseFile: "../licenses/PRETENDARD-OFL-1.1.txt",
    upstream: "https://github.com/orioncactus/pretendard/tree/v1.3.9"
  }
});
const CAPTION_STYLE_PRESETS = deepFreeze({
  [DEFAULT_CAPTION_STYLE_PRESET_ID]: {
    id: DEFAULT_CAPTION_STYLE_PRESET_ID,
    displayName: "\uD55C\uAD6D \uBC84\uD29C\uBC84 \uD0A4\uB9AC\uB204\uD0A4 \xB7 \uD074\uB9B0",
    fontId: "pretendard",
    typography: {
      fontFamily: "Pretendard",
      fontWeight: 800,
      fontScale: 0.0675,
      lineHeight: 1.24,
      maxLines: 1
    },
    placement: {
      x: 0.5,
      y: 0.84,
      maxWidth: 0.86,
      align: "center"
    },
    paint: {
      color: "#ffffff",
      backgroundColor: "transparent",
      backgroundRadiusEm: 0.14,
      outlineColor: "#111111",
      outlineWidth: 6e-3,
      shadowColor: "rgba(0, 0, 0, 0.45)",
      shadowOffsetXEm: 0,
      shadowOffsetYEm: 0.08,
      shadowBlurEm: 0.08
    },
    measurement: {
      sampleCount: 190,
      observedBodyCaptionLines: 1,
      selectedFontScale: 0.0675,
      basis: "user-final-local-reference-frames"
    }
  },
  [BLACK_BOX_CAPTION_STYLE_PRESET_ID]: {
    id: BLACK_BOX_CAPTION_STYLE_PRESET_ID,
    displayName: "\uD55C\uAD6D \uBC84\uD29C\uBC84 \uD0A4\uB9AC\uB204\uD0A4 \xB7 \uAC80\uC740 \uC9C1\uC0AC\uAC01\uD615",
    fontId: "pretendard",
    typography: {
      fontFamily: "Pretendard",
      fontWeight: 800,
      fontScale: 0.0675,
      lineHeight: 1.24,
      maxLines: 1
    },
    placement: {
      x: 0.5,
      y: 0.84,
      maxWidth: 0.86,
      align: "center"
    },
    paint: {
      color: "#ffffff",
      backgroundColor: "#000000",
      backgroundRadiusEm: 0,
      outlineColor: "#111111",
      outlineWidth: 6e-3,
      shadowColor: "rgba(0, 0, 0, 0.45)",
      shadowOffsetXEm: 0,
      shadowOffsetYEm: 0.08,
      shadowBlurEm: 0.08
    },
    measurement: {
      selectedFontScale: 0.0675,
      basis: "clean-preset-with-opaque-rectangular-background"
    }
  },
  /*
   * Paperlogy remains an explicitly selectable OFL alternative. Its 6.1%
   * baseline sits within the exploratory 5.8–6.3% range and is intentionally
   * not substituted for the typography measured in the user's own finals.
   */
  [PAPERLOGY_CAPTION_STYLE_PRESET_ID]: {
    id: PAPERLOGY_CAPTION_STYLE_PRESET_ID,
    displayName: "\uD55C\uAD6D \uBC84\uD29C\uBC84 \uD0A4\uB9AC\uB204\uD0A4 \xB7 Paperlogy",
    fontId: "paperlogy",
    typography: {
      fontFamily: "Paperlogy",
      fontWeight: 800,
      fontScale: 0.061,
      lineHeight: 1.18,
      maxLines: 1
    },
    placement: {
      x: 0.5,
      y: 0.84,
      maxWidth: 0.86,
      align: "center"
    },
    paint: {
      color: "#ffffff",
      backgroundColor: "transparent",
      backgroundRadiusEm: 0.14,
      outlineColor: "#14171c",
      outlineWidth: 55e-4,
      shadowColor: "rgba(0, 0, 0, 0.3)",
      shadowOffsetXEm: 0,
      shadowOffsetYEm: 0.07,
      shadowBlurEm: 0.08
    },
    measurement: {
      selectedFontScale: 0.061,
      supportedFontScaleRange: [0.058, 0.063],
      basis: "exploratory-fan-kirinuki-reference-frames"
    }
  },
  [LEGACY_CAPTION_STYLE_PRESET_ID]: {
    id: LEGACY_CAPTION_STYLE_PRESET_ID,
    displayName: "Pretendard \xB7 \uAE30\uC874 \uD504\uB85C\uC81D\uD2B8",
    fontId: "pretendard",
    typography: {
      fontFamily: "Pretendard",
      fontWeight: 800,
      fontScale: 0.0675,
      lineHeight: 1.24,
      maxLines: 2
    },
    placement: {
      x: 0.5,
      y: 0.84,
      maxWidth: 0.86,
      align: "center"
    },
    paint: {
      color: "#ffffff",
      backgroundColor: "transparent",
      backgroundRadiusEm: 0.14,
      outlineColor: "#111111",
      outlineWidth: 6e-3,
      shadowColor: "rgba(0, 0, 0, 0.45)",
      shadowOffsetXEm: 0,
      shadowOffsetYEm: 0.08,
      shadowBlurEm: 0.08
    }
  }
});
const SPEAKER_COLORS = Object.freeze([
  "#00e6a3",
  "#98dbc8",
  "#f06088",
  "#ffd166",
  "#b18cfa",
  "#e4a478",
  "#38f45c"
]);
const WHITE_SPEAKER_IDS = /* @__PURE__ */ new Set([
  "",
  "0",
  "host",
  "main",
  "primary",
  "speaker",
  "speaker-0",
  "speaker_0",
  "streamer",
  "\uD654\uC7900",
  "\uD654\uC790-0",
  "\uD654\uC790_0",
  "unknown"
]);
function normalizedSpeakerId(speakerId) {
  return String(speakerId || "").trim().toLowerCase();
}
function isMainSpeakerId(speakerId) {
  return WHITE_SPEAKER_IDS.has(normalizedSpeakerId(speakerId));
}
function normalizeCaptionStylePresetId(presetId) {
  const normalized = String(presetId || "").trim();
  return Object.hasOwn(CAPTION_STYLE_PRESETS, normalized) ? normalized : DEFAULT_CAPTION_STYLE_PRESET_ID;
}
function captionStylePreset(presetId = DEFAULT_CAPTION_STYLE_PRESET_ID) {
  return CAPTION_STYLE_PRESETS[normalizeCaptionStylePresetId(presetId)];
}
function captionStyleDefaults(presetId = DEFAULT_CAPTION_STYLE_PRESET_ID) {
  const preset = captionStylePreset(presetId);
  return {
    stylePresetId: preset.id,
    fontId: preset.fontId,
    ...preset.typography,
    ...preset.placement,
    ...preset.paint
  };
}
function captionSpeakerColor(speakerId) {
  const normalized = normalizedSpeakerId(speakerId);
  if (isMainSpeakerId(normalized)) {
    return "#ffffff";
  }
  const numberedSpeaker = normalized.match(/^(?:speaker|화자)[\s_-]?(\d+)$/u);
  if (numberedSpeaker) {
    const ordinal = Math.max(1, Number.parseInt(numberedSpeaker[1] ?? "1", 10));
    return SPEAKER_COLORS[(ordinal - 1) % SPEAKER_COLORS.length];
  }
  let hash = 2166136261;
  for (const character of normalized) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return SPEAKER_COLORS[(hash >>> 0) % SPEAKER_COLORS.length];
}
function captionSpeakerColorAssignments(speakerIds, existingAssignments = {}) {
  const assignments = {};
  const usedColors = /* @__PURE__ */ new Set();
  const existingEntries = existingAssignments instanceof Map ? [...existingAssignments.entries()] : Object.entries(existingAssignments || {});
  for (const [speakerId, color] of existingEntries) {
    const normalized = normalizedSpeakerId(speakerId);
    const normalizedColor = String(color || "").trim().toLowerCase();
    if (!normalized || !/^#[0-9a-f]{6}$/u.test(normalizedColor)) {
      continue;
    }
    const assignedColor = isMainSpeakerId(normalized) ? "#ffffff" : normalizedColor;
    assignments[normalized] = assignedColor;
    if (assignedColor !== "#ffffff") {
      usedColors.add(assignedColor);
    }
  }
  for (const speakerId of Array.isArray(speakerIds) ? speakerIds : []) {
    const normalized = normalizedSpeakerId(speakerId);
    if (!normalized || Object.hasOwn(assignments, normalized)) {
      continue;
    }
    if (isMainSpeakerId(normalized)) {
      assignments[normalized] = "#ffffff";
      continue;
    }
    const availableColor = SPEAKER_COLORS.find(
      (color) => !usedColors.has(color)
    );
    const assignedColor = availableColor || captionSpeakerColor(normalized);
    assignments[normalized] = assignedColor;
    usedColors.add(assignedColor);
  }
  return assignments;
}
export {
  BLACK_BOX_CAPTION_STYLE_PRESET_ID,
  CAPTION_FONT_REGISTRY,
  CAPTION_STYLE_PRESETS,
  DEFAULT_CAPTION_STYLE_PRESET_ID,
  LEGACY_CAPTION_STYLE_PRESET_ID,
  PAPERLOGY_CAPTION_STYLE_PRESET_ID,
  captionSpeakerColor,
  captionSpeakerColorAssignments,
  captionStyleDefaults,
  captionStylePreset,
  normalizeCaptionStylePresetId
};
