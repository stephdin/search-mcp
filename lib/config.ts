// Central constants shared across modules. Module-specific values that are
// only used in one place (DDG URL, DDG headers, etc.) stay in their own files.

/** Default fetch timeout (ms). Covers the entire trip: connect + headers + body. */
export const FETCH_TIMEOUT_MS = 30_000;

/** Default search timeout (ms). Shorter since DDG is usually fast. */
export const SEARCH_TIMEOUT_MS = 15_000;

/** Hard byte ceiling per fetch. Larger downloads are truncated. */
export const FETCH_MAX_BYTES = 2_000_000;

/** Max redirects followed before giving up. */
export const MAX_REDIRECTS = 5;

/** Max characters returned to the LLM per fetch. */
export const OUTPUT_CHAR_LIMIT = 50_000;

/** Max links collected from a page and appended to the output. */
export const MAX_COLLECTED_LINKS = 20;

/** Max search results the tool will ever return. */
export const MAX_RESULTS = 25;

/** Default search result count when the caller doesn't specify. */
export const DEFAULT_MAX_RESULTS = 10;
