// Smoke test for the host validation guard (isBlocked).
// Table-driven, no network required. Run with: deno task test:unit

import { isBlocked } from "../../lib/http.ts";
import { assertEquals } from "jsr:@std/assert@^1";

Deno.test("isBlocked", async (t) => {
  // ---- Public hostnames pass ----
  const ok = [
    "http://example.com/",
    "https://github.com/steph/mini-mcp",
    "http://en.wikipedia.org/wiki/MCP",
    "https://sub.domain.example.co.uk/path?q=1",
  ];
  for (const url of ok) {
    await t.step(`allows ${url}`, () => {
      assertEquals(isBlocked(url), false);
    });
  }

  // ---- IPv4 addresses are blocked ----
  const ipv4 = [
    "http://127.0.0.1/",
    "http://127.0.0.1:3000/api",
    "http://0.0.0.0/",
    "http://10.0.0.1/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://169.254.1.1/",
    "http://100.64.0.1/",
    "http://224.0.0.1/",
    "http://8.8.8.8/",
    "http://1.1.1.1/",
  ];
  for (const url of ipv4) {
    await t.step(`blocks ${url}`, () => {
      assertEquals(isBlocked(url), true);
    });
  }

  // ---- IPv6 addresses are blocked ----
  const ipv6 = [
    "http://[::1]/",
    "http://[::1]:8080/path",
    "http://[::]/",
    "http://[fe80::1]/",
    "http://[fc00::1]/",
    "http://[fd00::1]/",
    "http://[2001:db8::1]/",
  ];
  for (const url of ipv6) {
    await t.step(`blocks ${url}`, () => {
      assertEquals(isBlocked(url), true);
    });
  }

  // ---- localhost is blocked ----
  await t.step("blocks http://localhost/", () => {
    assertEquals(isBlocked("http://localhost/"), true);
  });
  await t.step("blocks http://localhost:3000/api", () => {
    assertEquals(isBlocked("http://localhost:3000/api"), true);
  });

  // ---- Malformed and non-http URLs are blocked ----
  const malformed = [
    "not-a-url",
    "",
    "ftp://example.com/",
    "file:///etc/passwd",
    "ws://localhost/",
  ];
  for (const url of malformed) {
    await t.step(`blocks ${url}`, () => {
      assertEquals(isBlocked(url), true);
    });
  }
});
