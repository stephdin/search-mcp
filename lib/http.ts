// Shared HTTP plumbing: fetch with timeout, byte cap, manual redirect
// following (with per-hop host validation), and a hostname/IP guard that
// blocks raw addresses and localhost.

import { FETCH_MAX_BYTES, MAX_REDIRECTS } from "./config.ts";

export const DEFAULT_TIMEOUT_MS = 15_000;

export interface FetchResult {
  /** Final URL after redirects. */
  url: string;
  status: number;
  contentType: string;
  /**
   * Decoded text body, truncated at maxBytes if needed. Callers may apply a
   * further character limit before returning to the LLM.
   */
  body: string;
  truncated: boolean;
  bytesTotal: number;
}

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

/** Fetch a URL with a timeout and a hard byte ceiling. Returns decoded text.
 *
 * Redirects are followed manually so every hop is checked against `isBlocked`.
 * The timeout covers the entire trip: connect, headers, and body.
 */
export async function fetchText(
  url: string,
  opts: {
    timeoutMs?: number;
    maxBytes?: number;
    method?: string;
    headers?: Record<string, string>;
    body?: BodyInit;
  } = {},
): Promise<FetchResult> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = FETCH_MAX_BYTES,
    method = "GET",
    headers = {},
  } = opts;

  // One signal for all hops so the timeout is a total-trip budget.
  const signal = AbortSignal.timeout(timeoutMs);

  try {
    let current = url;
    let reqMethod = method;
    let reqBody: BodyInit | undefined = opts.body;

    for (let hop = 0; ; hop++) {
      if (isBlocked(current)) {
        throw new Error(
          `Refusing to fetch "${current}": only public http(s) hostnames ` +
            "are allowed (no raw IPs, localhost, or other URL schemes).",
        );
      }
      const resp = await fetch(current, {
        method: reqMethod,
        headers: { ...DEFAULT_HEADERS, ...headers },
        body: reqBody,
        signal,
        redirect: "manual",
      });

      const location = resp.headers.get("location");
      const isRedirect = [301, 302, 303, 307, 308].includes(resp.status);
      if (!isRedirect || !location || hop >= MAX_REDIRECTS) {
        const body = await readBody(resp, maxBytes);
        return {
          url: resp.url,
          status: resp.status,
          contentType:
            resp.headers.get("content-type") ?? "application/octet-stream",
          ...body,
        };
      }

      // Follow the redirect. Validate the next hop at the top of the loop.
      await resp.body?.cancel();
      current = new URL(location, current).href;
      // 301/302/303 drop the body and switch to GET. 307/308 keep them.
      if (resp.status !== 307 && resp.status !== 308) {
        reqMethod = "GET";
        reqBody = undefined;
      }
    }
  } catch (e) {
    if (
      e instanceof DOMException &&
      (e.name === "TimeoutError" || e.name === "AbortError")
    ) {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
}

// ---- Stream body with byte cap -----------------------------------------------

/** Read the response body into a string, stopping at maxBytes. Chunks are
 * copied into fresh buffers so the final concatenation has a plain ArrayBuffer
 * (avoids type quirks with the reader's native chunk type). */
async function readBody(
  resp: Response,
  maxBytes: number,
): Promise<{ body: string; bytesTotal: number; truncated: boolean }> {
  if (!resp.body) return { body: "", bytesTotal: 0, truncated: false };

  const chunks: Uint8Array[] = [];
  let bytesTotal = 0;
  let truncated = false;
  const reader = resp.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    if (bytesTotal + value.byteLength > maxBytes) {
      chunks.push(new Uint8Array(value.subarray(0, maxBytes - bytesTotal)));
      bytesTotal = maxBytes;
      truncated = true;
      break;
    }
    chunks.push(new Uint8Array(value));
    bytesTotal += value.byteLength;
  }

  if (truncated) await reader.cancel().catch(() => {});
  reader.releaseLock();

  // Flatten chunks into one buffer and decode.
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const all = new Uint8Array(chunks.reduce((s, c) => s + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body: decoder.decode(all), bytesTotal, truncated };
}

// ---- Host validation ---------------------------------------------------------
// Best-effort guard. It does not resolve DNS, so a hostname whose A record
// points to a private IP will pass (DNS rebinding). For a personal tool
// listening on localhost this is acceptable.

const BLOCKED_HOSTNAMES = new Set(["localhost"]);

/** True if the URL must be refused. Blocks malformed URLs, non-http(s) URLs,
 * raw IP addresses (v4 and v6), and the hostname `localhost`. */
export function isBlocked(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return true;
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") return true;

  // IPv6 hostnames come bracketed from the URL parser. Strip so we can check
  // for colons below.
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (isIP(host)) return true;

  return false;
}

function isIP(host: string): boolean {
  // IPv4: four dotted decimal octets.
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  // IPv6: contains colons (after bracket stripping).
  if (host.includes(":")) return true;
  return false;
}
