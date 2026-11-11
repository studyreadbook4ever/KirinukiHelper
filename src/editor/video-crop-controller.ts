import type { EditorClip } from "../lib/editor-core.js";
import {
  FULL_VIDEO_CROP, mainVideoOutputDimensions, normalizeVideoCrop, videoCropDrawGeometry, videoCropSourceRect
} from "../lib/video-crop.js";
import type { VideoCrop, VideoCropPixelRect } from "../lib/video-crop.js";

interface CropEditorState {
  sessionKey: string;
  mainWorkspace: boolean;
  available: boolean;
  editable: boolean;
  sourceComposerActive: boolean;
  selectedClip: EditorClip | undefined;
  previewClip: EditorClip | undefined;
  video: HTMLVideoElement;
}

interface CropEditorOptions {
  state(): CropEditorState;
  prepareClip(clipId: string): Promise<void>;
  apply(clipId: string, crop: VideoCrop | null): void;
  insert(clipId: string, crop: VideoCrop | null): void;
  onError(error: unknown): void;
  letterboxColor: string;
}

function required<T extends HTMLElement>(id: string, kind: { new(...args: never[]): T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof kind)) throw new Error(`Missing crop control: #${id}`);
  return element;
}

export function createVideoCropController(options: CropEditorOptions) {
  const openButton = required("open-main-video-crop", HTMLButtonElement);
  const dialog = required("main-video-crop-dialog", HTMLDialogElement);
  const surface = required("main-video-crop-surface", HTMLDivElement);
  const sourceCanvas = required("main-video-crop-source", HTMLCanvasElement);
  const box = required("main-video-crop-box", HTMLDivElement);
  const preview = required("main-video-crop-preview", HTMLCanvasElement);
  const applyButton = required("apply-main-video-crop", HTMLButtonElement);
  const fields = {
    left: required("main-video-crop-x", HTMLInputElement),
    top: required("main-video-crop-y", HTMLInputElement),
    width: required("main-video-crop-width", HTMLInputElement),
    height: required("main-video-crop-height", HTMLInputElement)
  };
  let clipId: string | null = null;
  let draftSessionKey: string | null = null;
  let opening = false;
  let draft: VideoCrop = { ...FULL_VIDEO_CROP };
  let sourceWidth = 1;
  let sourceHeight = 1;
  let hiddenVideo: HTMLVideoElement | null = null;
  let gesture: {
    pointerId: number; x: number; y: number; rect: VideoCropPixelRect; mode: string;
  } | null = null;

  function renderDraft() {
    const pixels = videoCropSourceRect(sourceWidth, sourceHeight, draft);
    for (const key of ["left", "top", "width", "height"] as const) {
      fields[key].value = String(pixels[key]);
      fields[key].max = String(key === "left" || key === "width" ? sourceWidth : sourceHeight);
    }
    box.style.left = `${pixels.left / sourceWidth * 100}%`;
    box.style.top = `${pixels.top / sourceHeight * 100}%`;
    box.style.width = `${pixels.width / sourceWidth * 100}%`;
    box.style.height = `${pixels.height / sourceHeight * 100}%`;
  }

  function setPixels(rect: VideoCropPixelRect) {
    const width = Math.max(1, Math.min(sourceWidth, Math.round(rect.width)));
    const height = Math.max(1, Math.min(sourceHeight, Math.round(rect.height)));
    const left = Math.max(0, Math.min(sourceWidth - width, Math.round(rect.left)));
    const top = Math.max(0, Math.min(sourceHeight - height, Math.round(rect.top)));
    draft = { x: left / sourceWidth, y: top / sourceHeight, width: width / sourceWidth, height: height / sourceHeight };
    renderDraft();
  }

  function close() {
    gesture = null;
    clipId = null;
    draftSessionKey = null;
    dialog.close();
    openButton.focus();
  }

  async function open() {
    const before = options.state();
    if (opening || !before.mainWorkspace || !before.available || !before.editable || before.sourceComposerActive
      || !before.selectedClip || before.selectedClip.enabled === false) return;
    opening = true;
    render();
    const selectedId = before.selectedClip.id;
    try {
      await options.prepareClip(selectedId);
      const state = options.state();
      const video = state.video;
      if (state.sessionKey !== before.sessionKey || !state.mainWorkspace || !state.editable
        || state.sourceComposerActive || state.selectedClip?.enabled === false) return;
      if (!state.available || state.selectedClip?.id !== selectedId
        || video.readyState < 2 || video.seeking || video.style.visibility === "hidden") {
        throw new Error("영상 화면을 준비한 뒤 다시 자르기를 열어 주세요.");
      }
      sourceWidth = video.videoWidth;
      sourceHeight = video.videoHeight;
      sourceCanvas.width = sourceWidth;
      sourceCanvas.height = sourceHeight;
      const context = sourceCanvas.getContext("2d");
      if (!context) throw new Error("영상 자르기 화면을 만들지 못했습니다.");
      context.drawImage(video, 0, 0);
      surface.style.setProperty("--crop-aspect", String(sourceWidth / sourceHeight));
      draft = normalizeVideoCrop(state.selectedClip.videoCrop) ?? { ...FULL_VIDEO_CROP };
      clipId = selectedId;
      draftSessionKey = state.sessionKey;
      renderDraft();
      dialog.showModal();
      box.focus();
    } finally {
      opening = false;
      render();
    }
  }

  /** Called on playback frames, seeks, project edits and workspace changes. */
  function render() {
    const state = options.state();
    openButton.hidden = !state.mainWorkspace;
    openButton.disabled = opening || !state.available || !state.editable || state.sourceComposerActive
      || !state.selectedClip || state.selectedClip.enabled === false;
    openButton.classList.toggle("active", Boolean(state.selectedClip?.videoCrop));
    openButton.dataset.cropActive = String(Boolean(state.selectedClip?.videoCrop));
    if (dialog.open && (state.sessionKey !== draftSessionKey || !state.mainWorkspace
      || !state.available || !state.editable || state.sourceComposerActive
      || state.selectedClip?.enabled === false || state.selectedClip?.id !== clipId)) close();
    const video = state.video;
    if (hiddenVideo && hiddenVideo !== video) hiddenVideo.style.opacity = "";
    const crop = normalizeVideoCrop(state.previewClip?.videoCrop);
    const enabled = state.mainWorkspace && !state.sourceComposerActive && crop
      && state.available && video.readyState >= 2 && video.style.visibility !== "hidden";
    preview.hidden = !enabled;
    video.style.opacity = enabled ? "0" : "";
    hiddenVideo = enabled ? video : null;
    if (!enabled) return;
    // Match the original video's display aspect. Caption/image placement keeps
    // using that unchanged frame, just as the final main-video render does.
    const { width, height } = mainVideoOutputDimensions(video.videoWidth, video.videoHeight);
    if (preview.width !== width || preview.height !== height) {
      preview.width = width;
      preview.height = height;
    }
    const context = preview.getContext("2d");
    if (!context) {
      preview.hidden = true;
      video.style.opacity = "";
      return;
    }
    const { source, destination } = videoCropDrawGeometry(video.videoWidth, video.videoHeight, width, height, crop);
    context.fillStyle = options.letterboxColor;
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(video, source.left, source.top, source.width, source.height,
      destination.left, destination.top, destination.width, destination.height);
    preview.dataset.clipId = state.previewClip?.id ?? "";
    preview.dataset.crop = JSON.stringify(crop);
  }

  function point(event: PointerEvent) {
    const bounds = surface.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(sourceWidth, (event.clientX - bounds.left) / bounds.width * sourceWidth)),
      y: Math.max(0, Math.min(sourceHeight, (event.clientY - bounds.top) / bounds.height * sourceHeight))
    };
  }

  openButton.addEventListener("click", () => { void open().catch(options.onError); });
  required("cancel-main-video-crop", HTMLButtonElement).addEventListener("click", close);
  required("main-video-crop-full", HTMLButtonElement).addEventListener("click", () => {
    draft = { ...FULL_VIDEO_CROP };
    renderDraft();
  });
  applyButton.addEventListener("click", () => {
    const state = options.state();
    if (!clipId || !state.mainWorkspace || !state.available || !state.editable
      || state.sourceComposerActive || state.selectedClip?.enabled === false
      || state.sessionKey !== draftSessionKey || state.selectedClip?.id !== clipId) return;
    const targetId = clipId;
    const crop = normalizeVideoCrop(draft);
    close();
    options.apply(targetId, crop);
    render();
  });
  required("insert-main-video-crop", HTMLButtonElement).addEventListener("click", () => {
    const state = options.state();
    if (!clipId || !state.mainWorkspace || !state.available || !state.editable
      || state.sourceComposerActive || state.selectedClip?.enabled === false
      || state.sessionKey !== draftSessionKey || state.selectedClip?.id !== clipId) return;
    const targetId = clipId;
    const crop = normalizeVideoCrop(draft);
    close();
    options.insert(targetId, crop);
    render();
  });
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  // Native-modal keys must never trigger timeline deletion, playback or undo.
  dialog.addEventListener("keydown", (event) => { event.stopPropagation(); });
  for (const key of ["left", "top", "width", "height"] as const) {
    fields[key].addEventListener("change", () => {
      const value = fields[key].valueAsNumber;
      if (!Number.isFinite(value)) { renderDraft(); return; }
      const rect = videoCropSourceRect(sourceWidth, sourceHeight, draft);
      rect[key] = value;
      // Changing an edge position keeps size; resizing keeps the near corner.
      if (key === "width") rect.width = Math.min(value, sourceWidth - rect.left);
      if (key === "height") rect.height = Math.min(value, sourceHeight - rect.top);
      setPixels(rect);
    });
  }
  surface.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || gesture) return;
    const target = event.target instanceof Element ? event.target : null;
    const position = point(event);
    const mode = target?.closest<HTMLElement>("[data-crop-handle]")?.dataset.cropHandle
      ?? (target?.closest("#main-video-crop-box") ? "move" : "new");
    gesture = { pointerId: event.pointerId, ...position, rect: videoCropSourceRect(sourceWidth, sourceHeight, draft), mode };
    surface.setPointerCapture(event.pointerId);
    event.preventDefault();
    box.focus();
  });
  surface.addEventListener("pointermove", (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const { x, y } = point(event);
    const { rect, mode } = gesture;
    const dx = x - gesture.x;
    const dy = y - gesture.y;
    if (mode === "new") {
      setPixels({ left: Math.min(x, gesture.x), top: Math.min(y, gesture.y), width: Math.abs(dx), height: Math.abs(dy) });
    } else if (mode === "move") {
      setPixels({ ...rect, left: rect.left + dx, top: rect.top + dy });
    } else {
      const left = mode.includes("w") ? Math.min(rect.left + rect.width - 1, Math.max(0, rect.left + dx)) : rect.left;
      const top = mode.includes("n") ? Math.min(rect.top + rect.height - 1, Math.max(0, rect.top + dy)) : rect.top;
      const right = mode.includes("e") ? Math.max(left + 1, Math.min(sourceWidth, rect.left + rect.width + dx)) : rect.left + rect.width;
      const bottom = mode.includes("s") ? Math.max(top + 1, Math.min(sourceHeight, rect.top + rect.height + dy)) : rect.top + rect.height;
      setPixels({ left, top, width: right - left, height: bottom - top });
    }
  });
  function finishGesture(event: PointerEvent, cancel = false) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (cancel) setPixels(gesture.rect);
    gesture = null;
    if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
  }
  surface.addEventListener("pointerup", (event) => finishGesture(event));
  surface.addEventListener("pointercancel", (event) => finishGesture(event, true));
  surface.addEventListener("lostpointercapture", (event) => finishGesture(event));
  box.addEventListener("keydown", (event) => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const rect = videoCropSourceRect(sourceWidth, sourceHeight, draft);
    const step = event.shiftKey ? 10 : 1;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    const handle = (event.target as HTMLElement).dataset.cropHandle;
    if (handle) {
      if (handle.includes("e")) rect.width = Math.min(sourceWidth - rect.left, rect.width + dx);
      if (handle.includes("s")) rect.height = Math.min(sourceHeight - rect.top, rect.height + dy);
      if (handle.includes("w")) {
        const left = Math.max(0, Math.min(rect.left + rect.width - 1, rect.left + dx));
        rect.width += rect.left - left; rect.left = left;
      }
      if (handle.includes("n")) {
        const top = Math.max(0, Math.min(rect.top + rect.height - 1, rect.top + dy));
        rect.height += rect.top - top; rect.top = top;
      }
    } else {
      rect.left += dx; rect.top += dy;
    }
    setPixels(rect);
  });
  return {
    render,
    isOpen: () => dialog.open,
    isPreviewVisible: () => !preview.hidden,
    previewDimensions: () => preview.hidden ? null : { width: preview.width, height: preview.height }
  };
}
