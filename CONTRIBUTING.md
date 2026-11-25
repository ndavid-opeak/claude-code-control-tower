# Contributing

Thanks for your interest in claude-code-control-tower. Issues and pull requests are welcome.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Security problems go through private reporting, not issues. See [SECURITY.md](SECURITY.md).

## Development

```bash
npm install
npm run dev        # API with reload on :3456 + dashboard with hot reload
npm test           # vitest
npm run typecheck  # server and dashboard
```

## Pull requests

- Keep each PR to one change, with tests for new behavior.
- `npm test` and `npm run typecheck` must pass.
- Never commit keys, `.env`, request bodies or real session transcripts. Use made-up data in tests.
- Keep the security model intact: loopback-only, no telemetry, no writes to Claude Code's own files.

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
