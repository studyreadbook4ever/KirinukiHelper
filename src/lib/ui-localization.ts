export const UI_LANGUAGE_STORAGE_KEY = "kirinuki:ui-language:v1";
export const UI_LANGUAGE_CHANGE_EVENT = "kirinuki:ui-language-change";

export type UiLanguage = "ko" | "en" | "ja";

export interface UiCopyTranslation {
  readonly en: string;
  readonly ja: string;
}

export type UiCopyCatalog = Readonly<Record<string, UiCopyTranslation>>;

export interface UiCopyPattern {
  readonly source: RegExp;
  readonly en: string;
  readonly ja: string;
}

export interface UiLocalizationController {
  readonly language: UiLanguage;
  readonly translate: (source: string) => string;
  readonly setLanguage: (language: UiLanguage) => void;
  readonly refresh: (root?: ParentNode) => void;
  readonly disconnect: () => void;
}

interface InstalledUiLocalizationOptions {
  readonly catalog: UiCopyCatalog;
  readonly patterns?: readonly UiCopyPattern[];
  readonly ignoredSelectors?: readonly string[];
  readonly document?: Document;
  readonly storage?: Pick<Storage, "getItem" | "setItem">;
}

interface RenderedCopyState {
  source: string;
  rendered: string;
}

const supportedLanguages = new Set<UiLanguage>(["ko", "en", "ja"]);
const translatedAttributes = [
  "aria-label",
  "aria-description",
  "aria-roledescription",
  "aria-valuetext",
  "alt",
  "data-label",
  "title",
  "placeholder"
] as const;
const ignoredCopySelector = [
  "script",
  "style",
  "noscript",
  "[contenteditable='true']",
  "[data-kirinuki-ui-copy-ignore]"
] as const;

const switcherLabels: Readonly<Record<UiLanguage, {
  readonly group: string;
  readonly ko: string;
  readonly en: string;
  readonly ja: string;
}>> = {
  ko: {
    group: "화면 언어",
    ko: "한국어로 보기",
    en: "영어로 보기",
    ja: "일본어로 보기"
  },
  en: {
    group: "Interface language",
    ko: "View in Korean",
    en: "View in English",
    ja: "View in Japanese"
  },
  ja: {
    group: "表示言語",
    ko: "韓国語で表示",
    en: "英語で表示",
    ja: "日本語で表示"
  }
};

let installedUiCopyTranslator = (source: string): string => source;

export function translateInstalledUiCopy(source: string): string {
  return installedUiCopyTranslator(source);
}

function normalizedCopySource(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function sourceWithOuterWhitespace(source: string, translated: string): string {
  const leading = source.match(/^\s*/u)?.[0] || "";
  const trailing = source.match(/\s*$/u)?.[0] || "";
  return `${leading}${translated}${trailing}`;
}

function normalizedCatalog(catalog: UiCopyCatalog): Map<string, UiCopyTranslation> {
  const result = new Map<string, UiCopyTranslation>();
  for (const [source, translation] of Object.entries(catalog)) {
    const normalized = normalizedCopySource(source);
    if (!normalized) {
      throw new TypeError("UI copy catalog keys must not be empty.");
    }
    const previous = result.get(normalized);
    if (
      previous
      && (previous.en !== translation.en || previous.ja !== translation.ja)
    ) {
      throw new TypeError(`Conflicting UI copy translation: ${normalized}`);
    }
    result.set(normalized, translation);
  }
  return result;
}

function assertPatterns(patterns: readonly UiCopyPattern[]): void {
  for (const pattern of patterns) {
    if (pattern.source.global || pattern.source.sticky) {
      throw new TypeError("UI copy patterns must not use global or sticky matching.");
    }
  }
}

export function uiLanguageFrom(value: unknown): UiLanguage | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "jp") {
    return "ja";
  }
  const base = normalized.split(/[-_]/u, 1)[0] as UiLanguage;
  return supportedLanguages.has(base) ? base : null;
}

export function resolveUiLanguage(
  storedLanguage: unknown
): UiLanguage {
  const stored = uiLanguageFrom(storedLanguage);
  if (stored) {
    return stored;
  }
  return "ko";
}

export function uiIntlLocale(language: UiLanguage): string {
  return {
    ko: "ko-KR",
    en: "en-US",
    ja: "ja-JP"
  }[language];
}

export function mergeUiCopyCatalogs(
  ...catalogs: readonly UiCopyCatalog[]
): UiCopyCatalog {
  const merged: Record<string, UiCopyTranslation> = {};
  for (const catalog of catalogs) {
    for (const [source, translation] of Object.entries(catalog)) {
      const previous = merged[source];
      if (
        previous
        && (previous.en !== translation.en || previous.ja !== translation.ja)
      ) {
        throw new TypeError(`Conflicting UI copy translation: ${source}`);
      }
      merged[source] = translation;
    }
  }
  return merged;
}

export function translateUiCopy(
  source: string,
  language: UiLanguage,
  catalog: UiCopyCatalog,
  patterns: readonly UiCopyPattern[] = []
): string {
  if (language === "ko") {
    return source;
  }
  const normalized = normalizedCopySource(source);
  if (!normalized) {
    return source;
  }
  const direct = catalog[normalized];
  if (direct) {
    return sourceWithOuterWhitespace(source, direct[language]);
  }
  for (const pattern of patterns) {
    if (pattern.source.test(normalized)) {
      return sourceWithOuterWhitespace(
        source,
        normalized.replace(pattern.source, pattern[language])
      );
    }
  }
  return source;
}

function safeStoredLanguage(storage: Pick<Storage, "getItem"> | undefined): unknown {
  if (!storage) {
    return null;
  }
  try {
    return storage.getItem(UI_LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function installUiLocalization(
  options: InstalledUiLocalizationOptions
): UiLocalizationController {
  const activeDocument = options.document || document;
  const activeWindow = activeDocument.defaultView || window;
  const ignoredSelector = [
    ...ignoredCopySelector,
    ...(options.ignoredSelectors || [])
  ].join(",");
  const patterns = options.patterns || [];
  assertPatterns(patterns);
  const catalogMap = normalizedCatalog(options.catalog);
  const catalog = Object.fromEntries(catalogMap) as UiCopyCatalog;
  const storage = options.storage || (() => {
    try {
      return activeWindow.localStorage;
    } catch {
      return undefined;
    }
  })();
  let language = resolveUiLanguage(safeStoredLanguage(storage));
  const textStates = new WeakMap<Text, RenderedCopyState>();
  const attributeStates = new WeakMap<Element, Map<string, RenderedCopyState>>();

  function canTranslateText(element: Element | null): boolean {
    return !element?.closest(ignoredSelector);
  }

  function canTranslateAttribute(element: Element): boolean {
    return !element.closest("script, style, noscript");
  }

  function translated(source: string): string {
    return translateUiCopy(source, language, catalog, patterns);
  }

  installedUiCopyTranslator = translated;

  function knownCopy(source: string): boolean {
    const normalized = normalizedCopySource(source);
    if (!normalized) {
      return false;
    }
    if (catalogMap.has(normalized)) {
      return true;
    }
    return patterns.some((pattern) => pattern.source.test(normalized));
  }

  function translateTextNode(node: Text): void {
    if (!canTranslateText(node.parentElement)) {
      textStates.delete(node);
      return;
    }
    let state = textStates.get(node);
    if (state && node.data !== state.rendered) {
      if (knownCopy(node.data)) {
        state = { source: node.data, rendered: node.data };
        textStates.set(node, state);
      } else {
        textStates.delete(node);
        return;
      }
    }
    if (!state) {
      if (!knownCopy(node.data)) {
        return;
      }
      state = { source: node.data, rendered: node.data };
      textStates.set(node, state);
    }
    const rendered = translated(state.source);
    state.rendered = rendered;
    if (node.data !== rendered) {
      node.data = rendered;
    }
  }

  function translateAttribute(element: Element, attribute: string): void {
    if (!canTranslateAttribute(element)) {
      attributeStates.delete(element);
      return;
    }
    const value = element.getAttribute(attribute);
    if (value === null) {
      return;
    }
    let states = attributeStates.get(element);
    let state = states?.get(attribute);
    if (state && value !== state.rendered) {
      if (knownCopy(value)) {
        state = { source: value, rendered: value };
        states?.set(attribute, state);
      } else {
        states?.delete(attribute);
        return;
      }
    }
    if (!state) {
      if (!knownCopy(value)) {
        return;
      }
      state = { source: value, rendered: value };
      states ||= new Map<string, RenderedCopyState>();
      states.set(attribute, state);
      attributeStates.set(element, states);
    }
    const rendered = translated(state.source);
    state.rendered = rendered;
    if (value !== rendered) {
      element.setAttribute(attribute, rendered);
    }
  }

  function translateElement(element: Element): void {
    for (const attribute of translatedAttributes) {
      translateAttribute(element, attribute);
    }
    if (element instanceof activeWindow.HTMLTemplateElement) {
      scan(element.content);
    }
  }

  function scan(root: ParentNode = activeDocument.documentElement): void {
    if (root instanceof activeWindow.Text) {
      translateTextNode(root);
      return;
    }
    if (root instanceof activeWindow.Element) {
      translateElement(root);
    }
    const walker = activeDocument.createTreeWalker(
      root,
      activeWindow.NodeFilter.SHOW_ELEMENT | activeWindow.NodeFilter.SHOW_TEXT
    );
    let current = walker.nextNode();
    while (current) {
      if (current instanceof activeWindow.Text) {
        translateTextNode(current);
      } else if (current instanceof activeWindow.Element) {
        translateElement(current);
      }
      current = walker.nextNode();
    }
  }

  function renderSwitcher(): void {
    const labels = switcherLabels[language];
    activeDocument.querySelectorAll<HTMLElement>(
      "[data-kirinuki-ui-language-switcher]"
    ).forEach((switcher) => {
      switcher.setAttribute("aria-label", labels.group);
    });
    activeDocument.querySelectorAll<HTMLButtonElement>(
      "button[data-kirinuki-ui-language]"
    ).forEach((button) => {
      const buttonLanguage = uiLanguageFrom(button.dataset.kirinukiUiLanguage);
      if (!buttonLanguage) {
        return;
      }
      const pressed = buttonLanguage === language;
      // The accessible name is written in the active UI language. Keep its
      // pronunciation in that language rather than the language being chosen.
      button.lang = language;
      button.setAttribute("aria-pressed", String(pressed));
      button.setAttribute("aria-label", labels[buttonLanguage]);
      button.classList.toggle("active", pressed);
    });
  }

  function applyLanguage(nextLanguage: UiLanguage, announce: boolean): void {
    language = nextLanguage;
    activeDocument.documentElement.lang = language;
    activeDocument.documentElement.dir = "ltr";
    activeDocument.documentElement.dataset.kirinukiUiLanguage = language;
    scan(activeDocument.documentElement);
    renderSwitcher();
    if (announce) {
      activeWindow.dispatchEvent(new Event(UI_LANGUAGE_CHANGE_EVENT));
    }
  }

  function setLanguage(nextLanguage: UiLanguage): void {
    if (!supportedLanguages.has(nextLanguage)) {
      return;
    }
    try {
      storage?.setItem(UI_LANGUAGE_STORAGE_KEY, nextLanguage);
    } catch {
      // A blocked storage policy must not make the language control unusable.
    }
    applyLanguage(nextLanguage, nextLanguage !== language);
  }

  function handleClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof activeWindow.Element)) {
      return;
    }
    const button = target.closest<HTMLButtonElement>(
      "button[data-kirinuki-ui-language]"
    );
    const nextLanguage = uiLanguageFrom(button?.dataset.kirinukiUiLanguage);
    if (button && nextLanguage) {
      setLanguage(nextLanguage);
    }
  }

  function handleStorage(event: StorageEvent): void {
    if (event.key !== UI_LANGUAGE_STORAGE_KEY) {
      return;
    }
    const nextLanguage = uiLanguageFrom(event.newValue)
      || resolveUiLanguage(null);
    applyLanguage(nextLanguage, nextLanguage !== language);
  }

  const observer = new activeWindow.MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") {
        translateTextNode(record.target as Text);
        continue;
      }
      if (record.type === "attributes") {
        if (
          record.target instanceof activeWindow.Element
          && record.attributeName
        ) {
          translateAttribute(record.target, record.attributeName);
        }
        continue;
      }
      for (const node of record.addedNodes) {
        if (node instanceof activeWindow.Text) {
          translateTextNode(node);
        } else if (node instanceof activeWindow.Element) {
          scan(node);
        }
      }
    }
  });

  applyLanguage(language, false);
  activeDocument.addEventListener("click", handleClick);
  activeWindow.addEventListener("storage", handleStorage);
  observer.observe(activeDocument.documentElement, {
    attributes: true,
    attributeFilter: [...translatedAttributes],
    characterData: true,
    childList: true,
    subtree: true
  });

  return {
    get language() {
      return language;
    },
    translate: translated,
    setLanguage,
    refresh: scan,
    disconnect() {
      observer.disconnect();
      activeDocument.removeEventListener("click", handleClick);
      activeWindow.removeEventListener("storage", handleStorage);
      if (installedUiCopyTranslator === translated) {
        installedUiCopyTranslator = (source: string): string => source;
      }
    }
  };
}
