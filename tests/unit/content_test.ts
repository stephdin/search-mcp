// Unit tests for content-type dispatch and truncation.

import { renderText, truncate, isJson, isHtml, isText } from "../../lib/content.ts";
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";

Deno.test("renderText", async (t) => {
  await t.step("JSON: pretty-prints valid JSON", () => {
    const result = renderText("application/json", '{"a":1,"b":2}');
    assertEquals(result?.includes('"a": 1'), true);
    assertEquals(result?.includes('"b": 2'), true);
  });

  await t.step("JSON: returns raw text for invalid JSON", () => {
    assertEquals(renderText("application/json", "not json"), "not json");
  });

  await t.step("JSON: handles application/ld+json", () => {
    const result = renderText("application/ld+json", '{"ok":true}');
    assertEquals(result?.includes("ok"), true);
  });

  await t.step("HTML: extracts article title", () => {
    const html = "<html><head><title>Test</title></head><body><p>Hello world.</p></body></html>";
    const result = renderText("text/html", html);
    assertStringIncludes(result!, "Test");
    assertStringIncludes(result!, "Hello world");
  });

  await t.step("HTML: detects JS-rendered pages", () => {
    const html = "<html><head><title>App</title></head><body><script src='bundle.js'></script></body></html>";
    const result = renderText("text/html", html);
    assertStringIncludes(result!, "JavaScript-rendered");
  });

  await t.step("text/plain: passes through unchanged", () => {
    assertEquals(renderText("text/plain", "hello"), "hello");
  });

  await t.step("application/xml: passes through", () => {
    assertEquals(renderText("application/xml", "<root/>"), "<root/>");
  });

  await t.step("returns null for binary types", () => {
    assertEquals(renderText("application/octet-stream", "bytes"), null);
    assertEquals(renderText("image/png", "bytes"), null);
  });
});

Deno.test("truncate", async (t) => {
  const short = "hello";

  await t.step("passes through text below the limit", () => {
    const result = truncate(short, false);
    assertEquals(result.content, short);
    assertEquals(result.truncated, false);
  });

  await t.step("preserves an already-truncated flag", () => {
    const result = truncate(short, true);
    assertEquals(result.truncated, true);
  });

  await t.step("cuts text above the limit and sets the flag", () => {
    const long = "x".repeat(60_000);
    const result = truncate(long, false);
    assertEquals(result.content.length, 50_000);
    assertEquals(result.truncated, true);
  });
});

Deno.test("content-type classifiers", () => {
  assertEquals(isJson("application/json"), true);
  assertEquals(isJson("application/ld+json"), true);
  assertEquals(isJson("text/html"), false);

  assertEquals(isHtml("text/html"), true);
  assertEquals(isHtml("application/xhtml+xml"), true);
  assertEquals(isHtml("text/plain"), false);

  assertEquals(isText("text/plain"), true);
  assertEquals(isText("application/javascript"), true);
  assertEquals(isText("application/xml"), true);
  assertEquals(isText("image/svg+xml"), true);
  assertEquals(isText("application/octet-stream"), false);
});
