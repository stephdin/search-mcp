# search-mcp

A tiny MCP (Model Context Protocol) server for personal LLM assistants. Exposes
two tools over [Streamable HTTP](https://modelcontextprotocol.io):

- **`search`**: DuckDuckGo HTML search, no API key required. Returns title,
  URL, and snippet for up to `maxResults` results.
- **`fetch_url`**: fetches a single URL and returns its main text content. HTML
  pages go through Mozilla's Readability (Firefox Reader Mode) for clean article
  extraction. If Readability can't find an article (homepages, listings, 404s),
  a tag-stripping fallback returns the body text. JSON is pretty-printed, other
  text types pass through, and binary types return metadata only. Useful for
  following links from `search`.

Built with Deno,
[Hono](https://hono.dev),
the [MCP TypeScript SDK v2](https://github.com/modelcontextprotocol/typescript-sdk),
and [Mozilla Readability](https://github.com/mozilla/readability).

## Run

```sh
deno task dev     # http://127.0.0.1:8080/mcp, watch mode
deno task start   # production
```

## Configure (env vars)

| var        | default     | purpose                                                     |
| ---------- | ----------- | ----------------------------------------------------------- |
| `MCP_HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` to expose on the LAN.           |
| `MCP_PORT` | `8080`      | Listen port.                                                |
| `MCP_LOG`  | unset       | Set to `1` or `true` to log requests and timings to stderr. |

DNS rebinding protection is on by default via `@modelcontextprotocol/hono`
(validates both `Host` and `Origin` headers when binding to `127.0.0.1`).

## Point an MCP client at it

Any client that speaks MCP Streamable HTTP can connect. The endpoint is
`http://127.0.0.1:8080/mcp`. For a typical MCP client that accepts a server
URL, point it at:

```jsonc
{
  "url": "http://127.0.0.1:8080/mcp",
}
```

## Quick test

```sh
# Initialize (stateless transport, no session)
curl -s -X POST http://127.0.0.1:8080/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2026-07-28","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'

# List tools
curl -s -X POST http://127.0.0.1:8080/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

Responses come back as SSE `message` events.

## Project layout

```
main.ts              entrypoint: server, transport, HTTP wiring
lib/http.ts          fetch with timeout, byte ceiling, host/redirect validation
lib/ddg.ts           DuckDuckGo search (POST + parse)
lib/article.ts       HTML to clean text via Readability + fallback
lib/content.ts       content-type dispatch and truncation
lib/tool.ts          tool-error helper + untrusted-content framing
lib/log.ts           request logger (enabled with MCP_LOG=1 or MCP_LOG=true)
tools/search.ts      DuckDuckGo search tool
tools/fetch_url.ts   URL fetch + content extraction tool
tests/unit/          offline unit tests
tests/e2e/           end-to-end server test
```

Add a new tool by dropping a file under `tools/` and registering it from
`main.ts`.

## Notes & limits

- `search` POSTs to DuckDuckGo's `html/` endpoint. This isn't meant for
  high-volume use.
- `fetch_url` only allows hostnames (no raw IP addresses). Redirects are
  followed manually (max 5) and every hop is validated. Downloads are capped
  at 2 MiB and output is trimmed to 50k characters to stay friendly to model
  context windows. Tweak the constants in `tools/fetch_url.ts` if needed.
- The host guard does not resolve DNS. A hostname that points to a private IP
  will pass. For a personal tool listening on localhost this is fine.
- HTML extraction uses `@mozilla/readability` (Firefox Reader Mode) for
  articles and a deno-dom tag-strip fallback for content Readability doesn't
  see as an article. `<br>` tags are converted to line breaks, and all `<a
href>` links on the page are collected and appended as a "Links on this
  page" section so the model can follow them. See `lib/article.ts`.

## Security: prompt injection

These tools feed arbitrary web pages into a language model. Pages can contain
text crafted to hijack the model (indirect prompt injection). Output is framed
with `<untrusted-web-content>` markers, URL lengths are capped, and control
characters are stripped — but these are mitigations, not a fix. Injection is an
open research problem.

- Never let a model take a consequential action (run code, send messages,
  spend money, modify files) based solely on retrieved web text. Treat
  web-grounded answers as informational.
- If you render the model's output as HTML or markdown, escape it. Snippets
  from `search` can contain markup.
