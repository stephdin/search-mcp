// Minimal logger. Set MCP_LOG=1 to enable. Writes to stderr so it stays out
// of the server's stdout (which might be piped).

const enabled =
  Deno.env.get("MCP_LOG") === "1" || Deno.env.get("MCP_LOG") === "true";

export function log(msg: string): void {
  if (!enabled) return;
  const ts = new Date().toISOString();
  console.error(`[${ts}] ${msg}`);
}
