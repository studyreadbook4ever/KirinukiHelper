import { SHORT_FORM_WORKSPACES_SCHEMA } from "./short-form.js";

type RecoveryProject = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function contentValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(contentValue);
  if (!value || typeof value !== "object") return value;
  const schema = (value as { schema?: unknown }).schema;
  const shortFormBranch = typeof schema === "string" && schema.startsWith("kirinuki-short-form/v");
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["createdAt", "updatedAt", "playheadMs"].includes(key)
      && !(shortFormBranch && key === "revision")
      && !key.startsWith("selected"))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, contentValue(child)]));
}

function shortFormContent(project: RecoveryProject): unknown {
  const collection = project.shortFormWorkspaces;
  const original = [project.shortForm, collection];
  if (!isRecord(collection) || collection.schema !== SHORT_FORM_WORKSPACES_SCHEMA
    || !Array.isArray(collection.workspaces)
    || typeof collection.activeWorkspaceId !== "string"
    || !collection.activeWorkspaceId) {
    return original;
  }
  const ids: string[] = [];
  for (const workspace of collection.workspaces) {
    if (!isRecord(workspace) || typeof workspace.id !== "string" || !workspace.id) return original;
    ids.push(workspace.id);
  }
  if (new Set(ids).size !== ids.length) return original;
  const active = collection.workspaces.find((workspace: unknown) => (
    isRecord(workspace) && workspace.id === collection.activeWorkspaceId
  ));
  if (!isRecord(active) || !isRecord(active.shortForm) || !isRecord(project.shortForm)
    || JSON.stringify(contentValue(project.shortForm)) !== JSON.stringify(contentValue(active.shortForm))) {
    return original;
  }
  // A valid document mirrors the active branch into the legacy carrier.
  // Omit that carrier only after proving all its authored fields are present
  // in the collection. A divergent legacy carrier remains fully compared.
  const { activeWorkspaceId: _activeWorkspaceId, ...authoredCollection } = collection;
  return [null, authoredCollection];
}

export function recoveryContentSections(project: RecoveryProject): Record<string, unknown> {
  return {
    "작업 정보": [project.name, project.source, project.mediaAsset],
    "컷": [project.clips, project.suppressedSelections],
    "자막": [project.subtitles, project.subtitleDefaults, project.subtitleLaneCount],
    "이미지": [project.imageAssets, project.imageLaneCount],
    "음성": project.audioRegions,
    "쇼츠": shortFormContent(project)
  };
}

export function recoveryContentFingerprint(project: RecoveryProject): string {
  return JSON.stringify(contentValue(recoveryContentSections(project)));
}

/** Compare local editing content, including same-count text/style changes. */
export function recoveryChangedSections(
  current: RecoveryProject,
  saved: RecoveryProject
): string[] {
  const currentSections = recoveryContentSections(current);
  return Object.entries(recoveryContentSections(saved))
    .filter(([key, value]) => JSON.stringify(contentValue(value))
      !== JSON.stringify(contentValue(currentSections[key])))
    .map(([key]) => key);
}
