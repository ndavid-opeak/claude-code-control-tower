const UPSTREAM = "https://api.anthropic.com";
const FORWARD_HEADERS = ["authorization", "x-api-key", "anthropic-version", "anthropic-beta", "content-type", "accept"];

/** Forward a request to Anthropic unchanged, including Claude Code's own credentials. */
export async function forwardToAnthropic(req: Request, body: string): Promise<Response> {
  const url = new URL(req.url);
  const headers = new Headers();
  for (const name of FORWARD_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Fallback for when the caller sends no credentials of its own.
  if (!headers.has("authorization") && !headers.has("x-api-key") && process.env.ANTHROPIC_API_KEY) {
    headers.set("x-api-key", process.env.ANTHROPIC_API_KEY);
  }
  const upstream = await fetch(UPSTREAM + url.pathname + url.search, { method: req.method, headers, body });
  const out = new Headers();
  for (const name of ["content-type", "request-id", "anthropic-ratelimit-requests-remaining", "retry-after"]) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export async function anthropicHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(UPSTREAM + "/v1/models", { signal: AbortSignal.timeout(5000) });
    // 401 without credentials still proves the API is reachable.
    return { ok: res.status < 500, detail: `reachable (HTTP ${res.status})` };
  } catch (err) {
    return { ok: false, detail: `unreachable: ${(err as Error).message}` };
  }
}
