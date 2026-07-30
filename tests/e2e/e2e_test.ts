// End-to-end smoke test: spawns the server, sends real MCP requests over
// HTTP, parses SSE responses, and verifies the full stack.
//
//   deno test --allow-net --allow-run --allow-env tests/e2e/e2e_test.ts
//
// The server is started on a fixed port and killed after the test. Live
// network tests (search and fetch_url) are skipped when DENO_TEST_OFFLINE=1.

const PORT = 19876;
const BASE = `http://127.0.0.1:${PORT}`;

// =============================================================================
// Helpers
// =============================================================================

/** Poll /health every 200 ms until the server responds or the timeout fires. */
async function waitForServer(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {
      // Server hasn't opened the socket yet — retry.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Server did not start within timeout");
}

/**
 * Send an MCP JSON-RPC request and return the parsed result.
 *
 * MCP Streamable HTTP wraps the response in an SSE event. This helper sends
 * the request, extracts the `data:` payload from the event stream, and parses
 * the inner JSON. Throws on HTTP errors or MCP-level errors.
 */
async function mcpCall(
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const r = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Math.random().toString(36).slice(2),
      method,
      params,
    }),
  });

  if (!r.ok) {
    throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  }

  // The response is SSE. Extract the first data payload.
  const text = await r.text();
  const match = text.match(/data:\s*(\{[\s\S]*\})/);
  if (!match) {
    throw new Error(`No SSE data found in: ${text.slice(0, 200)}`);
  }

  const payload = JSON.parse(match[1]);
  if (payload.error) {
    throw new Error(
      `MCP error ${payload.error.code}: ${payload.error.message}`,
    );
  }

  return payload.result;
}

// =============================================================================
// Server process
// =============================================================================

let server: Deno.ChildProcess;

Deno.test("e2e", async (t) => {
  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  const cmd = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-net",
      "--allow-env",
      "--unstable-no-legacy-abort",
      "main.ts",
    ],
    cwd: import.meta.dirname + "/../..",
    env: {
      MCP_PORT: String(PORT),
      MCP_HOST: "127.0.0.1",
    },
    stdout: "null",
    stderr: "inherit",
  });
  server = cmd.spawn();

  try {
    await waitForServer();

    // -------------------------------------------------------------------------
    // Health check
    // -------------------------------------------------------------------------

    await t.step("GET /health returns ok", async () => {
      const r = await fetch(`${BASE}/health`);
      const body = await r.json();

      if (body.status !== "ok") {
        throw new Error(`Unexpected status: ${JSON.stringify(body)}`);
      }
      if (body.name !== "search-mcp") {
        throw new Error(`Unexpected name: ${body.name}`);
      }

      console.log(`  server: ${body.name} v${body.version}`);
    });

    // -------------------------------------------------------------------------
    // MCP initialize handshake
    // -------------------------------------------------------------------------

    await t.step("initialize returns server info", async () => {
      const result = await mcpCall("initialize", {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "e2e-test", version: "1" },
      });

      const { serverInfo } = result as {
        serverInfo?: { name: string; version: string };
      };
      if (!serverInfo) {
        throw new Error("Missing serverInfo in initialize response");
      }
      if (serverInfo.name !== "search-mcp") {
        throw new Error(`Unexpected name: ${serverInfo.name}`);
      }
      if (typeof serverInfo.version !== "string") {
        throw new Error("Missing version string");
      }

      console.log(`  protocol: ${serverInfo.name} v${serverInfo.version}`);
    });

    // -------------------------------------------------------------------------
    // Tool listing
    // -------------------------------------------------------------------------

    await t.step("tools/list returns both tools", async () => {
      const result = await mcpCall("tools/list");
      const { tools } = result as { tools: Array<{ name: string }> };
      const names = tools.map((t) => t.name).sort();

      if (names.join(",") !== "fetch_url,search") {
        throw new Error(`Unexpected tools: ${names.join(", ")}`);
      }

      console.log(`  tools: ${names.join(", ")}`);
    });

    // -------------------------------------------------------------------------
    // Live network tests (skipped when DENO_TEST_OFFLINE=1)
    // -------------------------------------------------------------------------

    const offline = Deno.env.get("DENO_TEST_OFFLINE") === "1";
    if (!offline) {
      // ---- search ----

      await t.step("tools/call search returns results", async () => {
        const result = await mcpCall("tools/call", {
          name: "search",
          arguments: { query: "Deno runtime", maxResults: 3 },
        });

        const { content } = result as {
          content: Array<{ text: string }>;
        };

        if (!content || content.length === 0) {
          throw new Error("Empty content in search response");
        }

        const text = content[0].text;

        // Verify the response mentions the query topic.
        const lower = text.toLowerCase();
        if (!lower.includes("deno")) {
          throw new Error(
            `Search results do not mention Deno:\n${text.slice(0, 300)}`,
          );
        }

        // Must not be an error response.
        if ("isError" in (result as Record<string, unknown>)) {
          throw new Error("Got isError in search response");
        }

        // Dump the raw LLM output so a human can spot-check it.
        console.log("── search results ──────────────────────────────");
        console.log(text);
        console.log("────────────────────────────────────────────────");
      });

      // ---- fetch_url ----

      await t.step("tools/call fetch_url returns content", async () => {
        const result = await mcpCall("tools/call", {
          name: "fetch_url",
          arguments: { url: "http://example.com/" },
        });

        const { content } = result as {
          content: Array<{ text: string }>;
        };

        if (!content || content.length === 0) {
          throw new Error("Empty content in fetch_url response");
        }

        const text = content[0].text;

        // example.com has a predictable <title>.
        if (!text.includes("Example Domain")) {
          throw new Error(
            `Fetch did not return expected content:\n${text.slice(0, 300)}`,
          );
        }

        // Must not be an error response.
        if ("isError" in (result as Record<string, unknown>)) {
          throw new Error("Got isError in fetch_url response");
        }

        // Print the first few lines so a human can verify the output shape.
        const lines = text.split("\n");
        const preview = lines.slice(0, 8).join("\n");
        console.log("── fetch result (first 8 lines) ────────────────");
        console.log(preview);
        if (lines.length > 8) console.log("...");
        console.log("────────────────────────────────────────────────");
      });
    }
  } finally {
    // Always shut down the server, even if a step threw.
    try {
      server.kill();
    } catch {
      // Already dead — that's fine.
    }
    await server.status;
  }
});

// Kill the server when the test runner itself is interrupted.
Deno.addSignalListener("SIGINT", () => {
  try {
    server.kill();
  } catch {
    /* already dead */
  }
  Deno.exit(1);
});
