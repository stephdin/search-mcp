// DuckDuckGo HTML search. `searchDdg` POSTs a query, parses the results page
// with deno-dom (WASM-backed parser, full HTML entity decoding), and returns
// title/URL/snippet results. Exports `parseResults` and `resolveUrl` for
// offline testing.

import { DOMParser, type Element } from "deno-dom";
import { fetchText } from "./http.ts";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const DDG_URL = "https://html.duckduckgo.com/html/";
const DDG_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  Origin: "https://html.duckduckgo.com",
  Referer: "https://html.duckduckgo.com/",
};

const TITLE_MAX_CHARS = 200;
const SNIPPET_MAX_CHARS = 500;
const URL_MAX_CHARS = 2048;

export interface SearchOptions {
  limit: number;
  region?: string;
}

/** Run a DuckDuckGo search and return parsed results. Fetches up to two
 * pages (page 1 = 10 results, page 2 = 15 more) to satisfy the limit.
 * Throws on network or HTTP errors (status >= 400). */
export async function searchDdg(
  query: string,
  opts: SearchOptions,
): Promise<SearchResult[]> {
  const { limit, region } = opts;

  const params = new URLSearchParams({ q: query });
  if (region) params.set("kl", region);

  // Page 1: 10 results.
  const r1 = await fetchText(DDG_URL, {
    method: "POST",
    headers: DDG_HEADERS,
    body: params.toString(),
  });
  if (r1.status >= 400) {
    throw new Error(`DuckDuckGo returned HTTP ${r1.status}`);
  }
  const page1 = parseResults(r1.body, limit);

  // If we already have enough, or page 1 returned fewer than 10 (last page),
  // don't bother with page 2.
  if (page1.length >= limit || page1.length < 10) return page1;

  // Page 2: 15 more results.
  params.set("s", "10");
  const r2 = await fetchText(DDG_URL, {
    method: "POST",
    headers: DDG_HEADERS,
    body: params.toString(),
  });
  if (r2.status >= 400) {
    // Page 2 failed — return what we have from page 1.
    return page1;
  }
  const page2 = parseResults(r2.body, limit - page1.length);

  return [...page1, ...page2];
}

// ---- HTML parsing ------------------------------------------------------------

/** Parse DuckDuckGo's HTML results page into a flat list, stopping at `limit`. */
export function parseResults(html: string, limit: number): SearchResult[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) return [];

  const out: SearchResult[] = [];
  for (const node of doc.querySelectorAll("a.result__a")) {
    if (out.length >= limit) break;

    const link = node;
    const title = cleanSpaces(link.textContent);
    const href = link.getAttribute("href") ?? "";
    const url = resolveUrl(href);
    if (!title || !url) continue;

    // The snippet lives in the surrounding .result block, not inside the
    // anchor element itself.
    const block = link.closest(".result") ?? link.parentElement;
    const snippetEl = block?.querySelector(".result__snippet");
    const snippet = cleanSpaces(snippetEl?.textContent ?? "");

    out.push({
      title: title.slice(0, TITLE_MAX_CHARS),
      url,
      snippet: snippet.slice(0, SNIPPET_MAX_CHARS),
    });
  }
  return out;
}

/** Resolve a DDG result link to the real target URL. Returns null for ads,
 * malformed hrefs, and links without a `uddg` redirect target.
 *
 * Organic results go through a redirect like:
 *   https://duckduckgo.com/l/?uddg=<encoded-target>&rut=...
 * Ads use the same domain at /y.js. We drop those. */
export function resolveUrl(raw: string): string | null {
  if (!raw) return null;

  try {
    const u =
      raw.startsWith("http://") || raw.startsWith("https://")
        ? new URL(raw)
        : new URL(raw, "https://duckduckgo.com/");

    // Drop ad-click trackers.
    if (
      (u.hostname === "duckduckgo.com" ||
        u.hostname.endsWith(".duckduckgo.com")) &&
      u.pathname === "/y.js"
    ) {
      return null;
    }

    const target = u.searchParams.get("uddg");
    if (target) {
      // It's a DDG redirect — only return the decoded target if it's http(s)
      // and within a reasonable length.
      if (/^https?:\/\//.test(target) && target.length <= URL_MAX_CHARS) {
        return target;
      }
      return null;
    }

    // Some results link directly. Pass those through.
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      return raw.length <= URL_MAX_CHARS ? raw : null;
    }

    return null;
  } catch {
    return null;
  }
}

function cleanSpaces(s: string): string {
  return s
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
