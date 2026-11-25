# Security

claude-router sits between Claude Code and the model APIs, so it sees your prompts and handles your keys. It is built to keep both on your machine.

## Security model

| Concern | How claude-router handles it |
|---|---|
| Network exposure | The server binds to `127.0.0.1` only. Nothing on your network can reach it. |
| Other websites / DNS rebinding | The dashboard API rejects any request whose `Host` or `Origin` is not loopback, and every write must be JSON, which forces a CORS preflight. |
| API keys | Stored in the repo's `.env` with file mode `600` (git-ignored). The dashboard can set a key but never reads one back. |
| Your Anthropic login | Passed through untouched to Anthropic. It is never sent to Google or anywhere else. |
| Prompts and replies | Not written to disk. The request log lives in memory. Capturing bodies is off by default, keeps at most 20, and clears on restart. |
| Telemetry | None. The only outbound calls are to the providers you route to (Anthropic, Google Vertex AI / AI Studio). |
| Claude Code's files | The Sessions page only reads them. It never changes Claude's settings, hooks or sessions, and never opens credential or `*.key` files. |

## Things to keep in mind

- Once `ANTHROPIC_BASE_URL` points at the router, all Claude Code traffic goes through it. Run the router from a checkout you trust and keep it up to date.
- Requests routed to Gemini are sent to Google under your Google key and Google's terms.
- Anyone with a shell on your Mac as your user can read `.env` and `~/.claude-router/`, the same as `~/.claude/`.

## Reporting a vulnerability

Please do not open a public issue for security problems. Report privately through GitHub's **Security → Report a vulnerability** on this repository. Include the steps to reproduce and the impact you see. You will get an answer as soon as possible, and a fix will be credited to you unless you prefer otherwise.

Only the latest `main` is supported.
