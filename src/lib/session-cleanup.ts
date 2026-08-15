import {
  CHZZK_VOD_MATERIALIZATION_SCHEMA,
  normalizeChzzkVodMaterialization
} from "./chzzk-vod-materialization.js";

interface CleanupMarkerIdentity {
  mediaUrl: string;
  platform: string;
  contentId: string;
  sourceVersionId: string;
  materializationId: string;
  planFingerprint: string;
}

interface MaterializedMediaAssetBinding {
  mediaMode?: unknown;
  materialization?: unknown;
  sessionCleanupMediaUrl?: unknown;
}

export function isSafeSessionCleanupMediaUrl(
  mediaUrl: unknown,
  companionEndpoint: string
): boolean {
  try {
    const expected = new URL(companionEndpoint);
    const media = new URL(String(mediaUrl || ""));
    const pathMatch = /^\/v1\/vod\/media\/[a-zA-Z0-9_-]{16,128}$/u.test(
      media.pathname
    );
    const accessValues = media.searchParams.getAll("access");
    return (
      mediaUrl === media.toString()
      && media.protocol === "http:"
      && (media.hostname === "127.0.0.1" || media.hostname === "localhost")
      && (expected.hostname === "127.0.0.1"
        || expected.hostname === "localhost")
      && media.port === expected.port
      && pathMatch
      && !media.username
      && !media.password
      && !media.hash
      && [...media.searchParams.keys()].every((key) => key === "access")
      && accessValues.length === 1
      && Boolean(accessValues[0])
      && accessValues[0]!.length <= 4_096
      && !/[\s\u0000-\u001f\u007f]/u.test(accessValues[0]!)
    );
  } catch {
    return false;
  }
}

/**
 * Checks the complete transient binding written immediately before an exact
 * local VOD purge. The access-bearing URL is retained only while the cleanup
 * marker exists and must match byte-for-byte; normal project persistence and
 * session archives never need this transient field.
 */
export function sessionCleanupMarkerMatchesMaterializedBinding(
  marker: CleanupMarkerIdentity,
  mediaAssetValue: unknown,
  companionEndpoint: string
): boolean {
  const mediaAsset = (
    mediaAssetValue
    && typeof mediaAssetValue === "object"
    && !Array.isArray(mediaAssetValue)
  )
    ? mediaAssetValue as MaterializedMediaAssetBinding
    : null;
  const materialization = normalizeChzzkVodMaterialization(
    mediaAsset?.materialization
  );
  if (
    !materialization
    || materialization.schema !== CHZZK_VOD_MATERIALIZATION_SCHEMA
    || (mediaAsset?.mediaMode !== "source-vod-selection"
      && mediaAsset?.mediaMode !== "chzzk-vod-selection")
    || mediaAsset.sessionCleanupMediaUrl !== marker.mediaUrl
    || marker.platform !== materialization.source.platform
    || marker.contentId !== materialization.source.contentId
    || marker.sourceVersionId !== materialization.source.sourceVersionId
    || marker.materializationId !== materialization.materializationId
    || marker.planFingerprint !== materialization.planFingerprint
  ) {
    return false;
  }

  return isSafeSessionCleanupMediaUrl(marker.mediaUrl, companionEndpoint);
}
