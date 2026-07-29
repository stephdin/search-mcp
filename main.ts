// search-mcp: lightweight MCP server for personal assistants.
// Exposes `search` (DuckDuckGo) and `fetch_url` over MCP Streamable HTTP
// at http://127.0.0.1:8080/mcp by default.
//
//   deno task dev      # hot-reload dev server
//   deno task start    # production
//
// Env: MCP_HOST, MCP_PORT, MCP_LOG=1|true

import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import { createMcpHonoApp } from "@modelcontextprotocol/hono";

import { registerSearchTool } from "./tools/search.ts";
import { registerFetchUrlTool } from "./tools/fetch_url.ts";
import denoJson from "./deno.json" with { type: "json" };

const VERSION = denoJson.version;
const HOST = Deno.env.get("MCP_HOST") ?? "127.0.0.1";
const PORT = Number(Deno.env.get("MCP_PORT") ?? "8080");

// Validate the port early so a typo doesn't fail deep inside Deno.serve.
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`Invalid MCP_PORT: "${Deno.env.get("MCP_PORT")}"`);
  Deno.exit(1);
}

// Stateless transport with no session tracking. Perfect for a single client.
const server = new McpServer({ name: "search-mcp", version: VERSION });
registerSearchTool(server);
registerFetchUrlTool(server);

const transport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
});
await server.connect(transport);

// Hono app with DNS rebinding protection (validates Host and Origin headers).
const app = createMcpHonoApp({ host: HOST });
app.get("/health", (c) =>
  c.json({ status: "ok", name: "search-mcp", version: VERSION }),
);
app.all("/mcp", (c) => transport.handleRequest(c.req.raw));

function shutdown(signal: string) {
  console.log(`received ${signal}, exiting`);
  Deno.exit(0);
}
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  Deno.addSignalListener(sig, () => shutdown(sig));
}

Deno.serve(
  {
    hostname: HOST,
    port: PORT,
    onListen({ hostname, port }) {
      const ts = new Date().toISOString();
      console.log(
        `[${ts}] search-mcp v${VERSION} → http://${hostname}:${port}/mcp`,
      );
    },
  },
  app.fetch,
);
