// Content-type dispatch for fetch_url. Decides how to render different
// response types: HTML goes through article extraction, JSON is
// pretty-printed, plain text passes through, and binary is refused.
// Also handles character truncation via `truncate`.

import { extractArticle } from "./article.ts";
import { OUTPUT_CHAR_LIMIT } from "./config.ts";

/** Turn a response body into text ready for the LLM, or null for binary. */
export function renderText(contentType: string, body: string): string | null {
  if (isJson(contentType)) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body; // not valid JSON, return as-is
    }
  }

  if (isHtml(contentType)) {
    const { title, text } = extractArticle(body);
    let result = title ? `${title}\n\n${text}` : text;

    // Detect JS-rendered pages: lots of script tags, very little text.
    if (text.length < 300 && /<script[\s>]/i.test(body)) {
      result +=
        "\n\n[Note: this page appears to be JavaScript-rendered. " +
        "The raw HTML contains little readable text. " +
        "Try a page that delivers content in its initial HTML.]";
    }

    return result;
  }

  if (isText(contentType)) return body;

  return null; // binary or unknown
}

/** Truncate text to OUTPUT_CHAR_LIMIT, propagating the upstream truncated flag. */
export function truncate(
  text: string,
  alreadyTruncated: boolean,
): { content: string; truncated: boolean } {
  if (text.length <= OUTPUT_CHAR_LIMIT) {
    return { content: text, truncated: alreadyTruncated };
  }
  return {
    content: text.slice(0, OUTPUT_CHAR_LIMIT),
    truncated: true,
  };
}

export function isJson(ct: string): boolean {
  return ct === "application/json" || ct.endsWith("+json");
}

export function isHtml(ct: string): boolean {
  return ct === "text/html" || ct === "application/xhtml+xml";
}

export function isText(ct: string): boolean {
  return (
    ct.startsWith("text/") ||
    ct.includes("javascript") ||
    ct.includes("xml") ||
    ct.endsWith("+xml")
  );
}
