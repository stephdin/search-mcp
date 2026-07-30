// HTML article extraction. Two-layer strategy:
//   1. Try Mozilla's Readability (Firefox Reader Mode). It strips navigation,
//      sidebars, and ads, returning clean title and text.
//   2. If Readability can't find an article (homepage, listing, 404, paywall)
//      fall back to a tag-stripping extractor so we always return something.

import { DOMParser, type Element, type HTMLDocument } from "deno-dom";
import { Readability } from "@mozilla/readability";
import { MAX_COLLECTED_LINKS } from "./config.ts";

const READABILITY_MIN_CHARS = 500; // below this, probably not a real article

export interface Extracted {
  title: string;
  text: string;
}

export function extractArticle(html: string): Extracted {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) return { title: "", text: "" };

  // Convert <br> to newlines before any processing so line breaks survive.
  convertBreaks(doc);

  // Collect links before Readability or noise stripping mutates the DOM.
  // Readability removes elements it considers non-content (including <a>
  // tags in nav/footer), so we must snapshot links first.
  const links = collectLinks(doc);

  try {
    const article = new Readability(doc, {
      charThreshold: READABILITY_MIN_CHARS,
    }).parse();
    if (article?.content && article.textContent?.trim()) {
      return {
        title: article.title ?? "",
        text: collapse(article.textContent) + links,
      };
    }
  } catch {
    // Readability threw (rare). Fall through to the strip strategy.
  }

  const fallback = fallbackExtract(doc);
  return { title: fallback.title, text: fallback.text + links };
}

// ---- Readability fallback ----------------------------------------------------

// Elements removed entirely before text extraction.
const NOISE_TAGS = [
  "script",
  "style",
  "noscript",
  "template",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "iframe",
  "svg",
];

// Block-level elements where we inject a trailing newline. Without this,
// adjacent headings and paragraphs smear together in textContent.
const BLOCK_TAGS = [
  "p",
  "div",
  "section",
  "article",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "dt",
  "dd",
  "blockquote",
  "tr",
  "option",
];

function fallbackExtract(doc: HTMLDocument): { title: string; text: string } {
  const title =
    doc.querySelector("title")?.textContent?.replace(/\s+/g, " ").trim() ?? "";

  // Strip noisy elements.
  for (const tag of NOISE_TAGS) {
    for (const el of doc.querySelectorAll(tag)) {
      el.parentNode?.removeChild(el);
    }
  }

  // Inject newlines at block boundaries.
  const body = doc.body ?? doc.documentElement;
  if (body) {
    for (const tag of BLOCK_TAGS) {
      for (const el of body.querySelectorAll(tag)) {
        el.appendChild(doc.createTextNode("\n"));
      }
    }
  }

  return {
    title,
    text: collapse(body?.textContent ?? ""),
  };
}

// ---- Helpers -----------------------------------------------------------------

/** Replace every <br> with a \n text node so line breaks survive extraction. */
function convertBreaks(doc: HTMLDocument): void {
  for (const br of doc.querySelectorAll("br")) {
    br.parentNode?.insertBefore(doc.createTextNode("\n"), br);
    br.parentNode?.removeChild(br);
  }
}

/** Collect <a href> links from the document, sorted by relevance, and return
 * a "Links on this page" section (empty string if none found). */
function collectLinks(doc: HTMLDocument): string {
  const seen = new Set<string>();
  const entries: { label: string; href: string; score: number }[] = [];

  for (const a of doc.querySelectorAll("a[href]")) {
    if (entries.length >= MAX_COLLECTED_LINKS) break;
    const href = (a.getAttribute("href") ?? "").trim();
    if (!href || href.startsWith("javascript:") || href.startsWith("#")) {
      continue;
    }
    if (seen.has(href)) continue;
    seen.add(href);

    const label = a.textContent?.replace(/\s+/g, " ").trim() ?? "";
    entries.push({ label, href, score: linkScore(a) });
  }

  if (entries.length === 0) return "";

  // Sort by score descending; JS stable sort preserves DOM order for ties.
  entries.sort((a, b) => b.score - a.score);

  const lines = entries.map((e) =>
    e.label ? `${e.label}: ${e.href}` : e.href,
  );
  return "\n\nLinks on this page:\n" + lines.map((l) => `- ${l}`).join("\n");
}

// Higher score = more likely to be a content link rather than boilerplate.
const CONTAINER_SCORE: [string, number][] = [
  ["main", 3],
  ["article", 3],
  ["section", 2],
  ["div", 2],
  ["p", 2],
  ["li", 2],
  ["nav", 1],
  ["header", 1],
  ["footer", 0],
  ["aside", 0],
];

function linkScore(a: Element): number {
  for (const [tag, score] of CONTAINER_SCORE) {
    if (a.closest(tag)) return score;
  }
  return 2; // default: somewhere in <body>, treat as content
}

// Collapse runs of spaces and tabs; normalize newlines to at most two in a row.
// Strip ASCII control characters that can manipulate renderers or models.
function collapse(s: string): string {
  return s
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
