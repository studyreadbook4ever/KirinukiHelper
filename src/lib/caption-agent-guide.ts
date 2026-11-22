import { UI_LANGUAGE_CHANGE_EVENT, type UiCopyCatalog, type UiLocalizationController } from "./ui-localization.js";

const captionAgentInstruction = "자막을 만들거나 수정하기 전에 아래 Kirinuki AI 자막 가이드를 먼저 읽고, 그 절차에 따라 작업해 주세요.";

export const CAPTION_AGENT_GUIDE_COPY = {
  "AI 자막 가이드": { en: "AI caption guide", ja: "AI字幕ガイド" },
  "AI 지시문 복사": { en: "Copy AI instructions", ja: "AIへの指示をコピー" },
  "AI에 전달할 지시문": { en: "Instructions for your AI agent", ja: "AIに渡す指示文" },
  "지시문을 복사했습니다. 사용할 AI에 붙여넣으세요.": {
    en: "Instructions copied. Paste them into your AI agent.",
    ja: "指示文をコピーしました。使用するAIに貼り付けてください。"
  },
  "아래 지시문을 선택했습니다. 직접 복사해 AI에 붙여넣으세요.": {
    en: "The instructions below are selected. Copy and paste them into your AI agent.",
    ja: "下の指示文を選択しました。コピーして使用するAIに貼り付けてください。"
  },
  [captionAgentInstruction]: {
    en: "Before creating or editing captions, read the Kirinuki AI caption guide below and follow its instructions.",
    ja: "字幕の作成や編集を始める前に、下記のKirinuki AI字幕ガイドを読み、その手順に従って作業してください。"
  }
} as const satisfies UiCopyCatalog;

export function captionAgentBrief(
  origin: string,
  translate: UiLocalizationController["translate"]
): string {
  return `${translate(captionAgentInstruction)}\n${new URL("/agents.md", origin).href}`;
}

export function bindCaptionAgentGuide(ui: UiLocalizationController): void {
  const button = document.getElementById("copy-caption-agent-brief");
  const status = document.getElementById("caption-agent-copy-status");
  const fallback = document.getElementById("caption-agent-copy-fallback");
  if (!(button instanceof HTMLButtonElement) || !status || !(fallback instanceof HTMLTextAreaElement)) {
    throw new Error("AI caption guide controls are missing");
  }

  const currentBrief = () => captionAgentBrief(location.origin, ui.translate);
  window.addEventListener(UI_LANGUAGE_CHANGE_EVENT, () => {
    if (!fallback.hidden) fallback.value = currentBrief();
  });
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(currentBrief());
      fallback.hidden = true;
      status.textContent = "지시문을 복사했습니다. 사용할 AI에 붙여넣으세요.";
    } catch {
      status.textContent = "아래 지시문을 선택했습니다. 직접 복사해 AI에 붙여넣으세요.";
      fallback.value = currentBrief();
      fallback.hidden = false;
      fallback.focus();
      fallback.select();
    }
    ui.refresh(status);
  });
}
