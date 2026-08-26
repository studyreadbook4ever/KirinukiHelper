export const SOURCE_LOCATION_SANITIZED_EVENT =
  "kirinuki:source-location-sanitized";

export interface ConsumedSourceLocation {
  readonly source: string | null;
  readonly shouldSanitize: boolean;
  readonly canonicalPath: "/";
}

/**
 * Consume the optional source deep link without retaining it in another
 * browser-owned store. Query input remains supported for existing links, while
 * fragment input avoids sending the source to the initial HTTP request.
 */
export function consumeSourceLocation(href: string): ConsumedSourceLocation {
  const url = new URL(href);
  const hashParameters = new URLSearchParams(
    url.hash.startsWith("#") ? url.hash.slice(1) : url.hash
  );
  const querySource = url.searchParams.get("source");
  const fragmentSource = hashParameters.get("source");
  return Object.freeze({
    source: querySource || fragmentSource || null,
    shouldSanitize: url.searchParams.has("source")
      || hashParameters.has("source"),
    canonicalPath: "/"
  });
}
