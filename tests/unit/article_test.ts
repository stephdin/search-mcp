// Unit tests for article extraction (Readability + fallback).

import { extractArticle } from "../../lib/article.ts";
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";

// A long article page: Readability should find the article body.
const articleHtml = `
<html>
<head><title>Understanding Deno Permissions</title></head>
<body>
  <nav><a href="/">Home</a><a href="/docs">Docs</a></nav>
  <header><h1>Deno Blog</h1></header>
  <article>
    <h1>Understanding Deno Permissions</h1>
    <p>Deno is secure by default. When you run a program, it has no access to
       the file system, network, or environment unless you explicitly grant
       permissions with flags like --allow-read or --allow-net.</p>
    <p>This model, inspired by the principle of least privilege, means that a
       script cannot silently exfiltrate data or corrupt files. You opt in to
       each capability at the command line.</p>
    <p>For example, a simple HTTP server needs --allow-net, while a build tool
       might need --allow-read, --allow-write, and --allow-run. Deno also
       supports fine-grained permissions like --allow-read=/tmp for limiting
       access to specific directories.</p>
    <p>This is a significant departure from Node.js, where any script can
       access the file system and network by default. The trade-off is more
       explicit setup, but a much smaller attack surface.</p>
  </article>
  <footer>
    <a href="https://deno.com/imprint">Imprint</a>
    Copyright 2025 Deno Land Inc.
  </footer>
  <script>console.log("tracking");</script>
</body>
</html>`;

// A short non-article page: Readability should punt to the fallback.
const nonArticleHtml = `
<html>
<head><title>My Homepage</title></head>
<body>
  <nav><a href="/">Home</a></nav>
  <div>Welcome to my site. Here are some links.</div>
  <script>console.log("hello");</script>
  <style>body { color: red; }</style>
</body>
</html>`;

// A page with <br> tags inside paragraphs.
const brPageHtml = `
<html>
<head><title>Contact</title></head>
<body>
  <p>Our office:<br>123 Main Street<br>Springfield, USA</p>
  <a href="https://example.com/directions">Get directions</a>
</body>
</html>`;

Deno.test("extractArticle", async (t) => {
  await t.step("Readability path: extracts title and article text", () => {
    const result = extractArticle(articleHtml);
    assertEquals(result.title, "Understanding Deno Permissions");
    assertStringIncludes(result.text, "Deno is secure by default");
    // Script text should still be gone (not a link, just inline code).
    assertEquals(result.text.includes("tracking"), false);
  });

  await t.step("fallback path: strips noise tags, uses <title>", () => {
    const result = extractArticle(nonArticleHtml);
    assertEquals(result.title, "My Homepage");
    // Body text is kept.
    assertStringIncludes(result.text, "Welcome to my site");
    // Script and style content is stripped.
    assertEquals(result.text.includes("console.log"), false);
    assertEquals(result.text.includes("color: red"), false);
  });

  await t.step("collects links from the page", () => {
    const result = extractArticle(articleHtml);
    // The footer link should appear in the links section even though the
    // footer element itself was removed.
    assertStringIncludes(result.text, "Links on this page");
    assertStringIncludes(result.text, "https://deno.com/imprint");
  });

  await t.step("converts <br> tags to line breaks", () => {
    const result = extractArticle(brPageHtml);
    // The address should have line breaks where <br> was.
    assertStringIncludes(result.text, "123 Main Street");
    // Links are collected too.
    assertStringIncludes(result.text, "https://example.com/directions");
  });
});
