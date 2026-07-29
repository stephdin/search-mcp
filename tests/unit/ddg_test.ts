// Unit tests for DDG HTML parsing and URL resolution.

import { parseResults, resolveUrl, type SearchResult } from "../../lib/ddg.ts";
import { assertEquals } from "jsr:@std/assert@^1";

// Minimal DDG results page: two organic results, one ad, one direct link, one
// result without a snippet.
const fixture = `
<div class="result">
  <a class="result__a"
     href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&rut=abc">
     Example Page
  </a>
  <div class="result__snippet">An example snippet.</div>
</div>
<div class="result">
  <a class="result__a"
     href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fdeno&rut=def">
     Deno on GitHub
  </a>
  <div class="result__snippet">A modern runtime for JavaScript.</div>
</div>
<div class="result">
  <a class="result__a"
     href="https://duckduckgo.com/y.js?u=123&v=456">
     Ad Link
  </a>
</div>
<div class="result">
  <a class="result__a"
     href="https://en.wikipedia.org/wiki/Deno_(software)">
     Direct Wikipedia Link
  </a>
  <div class="result__snippet">Wikipedia article about Deno.</div>
</div>
<div class="result">
  <a class="result__a"
     href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fno-snippet.example.com%2F&rut=ghi">
     No Snippet
  </a>
</div>
`;

Deno.test("parseResults", async (t) => {
  await t.step("extracts organic results with decoded URLs", () => {
    const results = parseResults(fixture, 10);
    assertEquals(results.length, 4); // ad dropped, others kept
    assertEquals(results[0].url, "https://example.com/page");
    assertEquals(results[0].title, "Example Page");
    assertEquals(results[0].snippet, "An example snippet.");
  });

  await t.step("drops ad-tracker links (/y.js)", () => {
    const results = parseResults(fixture, 10);
    const urls = results.map((r) => r.url);
    assertEquals(urls.includes("https://duckduckgo.com/y.js?u=123&v=456"), false);
  });

  await t.step("passes through direct http(s) links", () => {
    const results = parseResults(fixture, 10);
    const direct = results.find((r) =>
      r.url === "https://en.wikipedia.org/wiki/Deno_(software)"
    );
    assertEquals(direct?.title, "Direct Wikipedia Link");
  });

  await t.step("returns empty string for missing snippet", () => {
    const results = parseResults(fixture, 10);
    const noSnippet = results.find((r) => r.title === "No Snippet");
    assertEquals(noSnippet?.snippet, "");
  });

  await t.step("respects the limit parameter", () => {
    const results = parseResults(fixture, 2);
    assertEquals(results.length, 2);
  });
});

Deno.test("resolveUrl", async (t) => {
  await t.step("decodes uddg redirect target", () => {
    const href = "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F&rut=abc";
    assertEquals(resolveUrl(href), "https://example.com/");
  });

  await t.step("rejects /y.js ad trackers", () => {
    const href = "https://duckduckgo.com/y.js?u=123";
    assertEquals(resolveUrl(href), null);
  });

  await t.step("passes through direct https links", () => {
    assertEquals(resolveUrl("https://example.com/direct"), "https://example.com/direct");
  });

  await t.step("rejects empty or malformed hrefs", () => {
    assertEquals(resolveUrl(""), null);
    assertEquals(resolveUrl("not-a-url-at-all"), null);
  });

  await t.step("rejects uddg target that is not http(s)", () => {
    const href = "https://duckduckgo.com/l/?uddg=javascript:alert(1)";
    assertEquals(resolveUrl(href), null);
  });
});
