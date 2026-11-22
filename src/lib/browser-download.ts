export function sanitizeFileName(value: string): string {
  let cleaned = String(value || "kirinuki")
    .normalize("NFKC")
    .replace(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^[.\s-]+|[.\s-]+$/gu, "")
    .slice(0, 80)
    .replace(/[.\s]+$/gu, "");
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]|conin\$|conout\$)(?:[.\s]|$)/iu.test(cleaned)) {
    cleaned = `safe-${cleaned.slice(0, 75).replace(/[.\s]+$/gu, "")}`;
  }
  return cleaned || "kirinuki";
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const download = document.createElement("a");
  download.href = objectUrl;
  download.download = fileName;
  download.hidden = true;
  document.body.append(download);
  try {
    download.click();
  } finally {
    download.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  }
}
