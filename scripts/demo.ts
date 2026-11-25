/**
 * Demo mode: runs the real server on made-up data, for screenshots and trying the dashboard.
 *
 *   npm run demo        then open http://127.0.0.1:3460
 *
 * It builds a throwaway home folder (Claude Code sessions, transcripts, settings, usage) in the temp folder,
 * points the server at it, and answers every Anthropic and Gemini request with a canned reply,
 * so nothing leaves this machine and none of your own sessions, keys or settings are read.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A new, private folder each run (mkdtemp makes it atomically, readable only by you). It sits in /tmp rather than the
// longer macOS temp folder because paths show up on the pages and in screenshots. It is removed when the demo stops.
const ROOT = fs.mkdtempSync(path.join(process.platform === "win32" ? os.tmpdir() : "/tmp", "cct-demo-"));
const HOME = path.join(ROOT, "alex");
const WORK = path.join(HOME, "work");
const CLAUDE = path.join(HOME, ".claude");
const STATE = path.join(HOME, ".claude-router");
const PORT = Number(process.env.PORT ?? 3460);

const now = Date.now();
const MIN = 60_000;
const iso = (agoMin: number) => new Date(now - agoMin * MIN).toISOString();
const write = (file: string, data: string | object) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data, null, 2));
};
const slug = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, "-");

// ---- Sessions ------------------------------------------------------------------

type Step =
  | { you: string; at: number }
  | { claude: string; at: number; end?: boolean }
  | { tool: string; input: object; result?: string; at: number };

interface DemoSession {
  id: string;
  title: string;
  project: string; // folder under WORK, or an absolute path for "no project"
  branch: string;
  entrypoint: "cli" | "claude-vscode" | "claude-desktop";
  model: string;
  context: number; // tokens in the context window at the last reply
  steps: Step[];
  live?: { status: "busy" | "idle" | "waiting"; startedMin: number };
  /** Minutes since the transcript was last written, for ended sessions. */
  endedMin?: number;
  pr?: { number: number; repo: string };
  subagents?: { id: string; type: string; description: string; finished: boolean; context: number }[];
  /** Minutes ago each reply's tokens were spent, for the usage breakdown. */
  spend?: number[];
}

const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";
const FABLE = "claude-fable-5-2";
const HAIKU = "claude-haiku-5-5";

const sessions: DemoSession[] = [
  {
    id: "0d6c6b2e-3f1a-4c55-9a51-1f0c2b9e7a01",
    title: "Checkout page redesign",
    project: "storefront",
    branch: "feat/checkout-redesign",
    entrypoint: "cli",
    model: OPUS,
    context: 142_000,
    live: { status: "idle", startedMin: 95 },
    steps: [
      { you: "Redesign the checkout page so shipping and payment fit on one screen on desktop.", at: 52 },
      { tool: "Read", input: { file_path: `${WORK}/storefront/src/pages/Checkout.tsx` }, result: "export function Checkout() { … }", at: 51 },
      { tool: "Grep", input: { pattern: "PaymentForm" }, result: "src/pages/Checkout.tsx\nsrc/components/PaymentForm.tsx", at: 50 },
      { claude: "The current page stacks four cards. Two layouts would work, and they change how the order summary behaves on small screens.", at: 49 },
      {
        tool: "AskUserQuestion",
        input: {
          questions: [
            {
              question: "Which checkout layout should I build?",
              options: [{ label: "Two columns, summary on the right" }, { label: "Single column with a sticky summary" }],
            },
          ],
        },
        at: 48,
      },
    ],
    spend: [52, 51, 50, 49],
  },
  {
    id: "1e7d7c3f-4a2b-4d66-8b62-2a1d3c0f8b12",
    title: "Retry failed webhooks with backoff",
    project: "payments-api",
    branch: "fix/webhook-retries",
    entrypoint: "claude-vscode",
    model: SONNET,
    context: 88_000,
    live: { status: "idle", startedMin: 70 },
    steps: [
      { you: "Webhooks that fail are dropped. Retry them with exponential backoff, at most 6 attempts.", at: 31 },
      { tool: "Read", input: { file_path: `${WORK}/payments-api/src/webhooks/dispatch.ts` }, result: "…", at: 30 },
      {
        tool: "ExitPlanMode",
        input: {
          plan: "1. Store the attempt count and next retry time with each delivery\n2. Move delivery into a worker that picks due rows\n3. Back off 30s, 2m, 10m, 1h, 6h, 24h; then mark failed\n4. Tests for each step and for the final failure",
        },
        at: 27,
      },
    ],
    spend: [31, 30, 28],
  },
  {
    id: "2f8e8d40-5b3c-4e77-9c73-3b2e4d1a9c23",
    title: "Fix flaky cart tests",
    project: "storefront",
    branch: "fix/flaky-cart",
    entrypoint: "claude-desktop",
    model: FABLE,
    context: 618_000,
    live: { status: "busy", startedMin: 140 },
    steps: [
      { you: "The cart tests fail about one run in five on CI. Find out why and fix it.", at: 40 },
      { claude: "Running the suite 20 times to catch the failure, while two agents read the cart store and the test setup.", at: 38 },
      { tool: "Bash", input: { command: "for i in $(seq 20); do npm test -- cart || break; done", description: "Run the cart tests 20 times" }, at: 2 },
    ],
    subagents: [
      { id: "a1", type: "Explore", description: "Read the cart store and its timers", finished: true, context: 41_000 },
      { id: "a2", type: "Explore", description: "Check test setup for shared state", finished: false, context: 23_000 },
    ],
    spend: [40, 38, 30, 20, 10, 2],
  },
  {
    id: "3a9f9e51-6c4d-4f88-8d84-4c3f5e2b0d34",
    title: "Backfill March events",
    project: "data-pipeline",
    branch: "main",
    entrypoint: "cli",
    model: SONNET,
    context: 64_000,
    live: { status: "busy", startedMin: 25 },
    steps: [
      { you: "Backfill the March events table from the raw S3 exports, one day at a time.", at: 22 },
      { tool: "Read", input: { file_path: `${WORK}/data-pipeline/jobs/backfill.py` }, at: 1 },
    ],
    spend: [22, 15, 8, 1],
  },
  {
    id: "4b0a0f62-7d5e-4099-9e95-5d4a6f3c1e45",
    title: "Dark mode for the settings screen",
    project: "mobile-app",
    branch: "feat/settings-dark-mode",
    entrypoint: "claude-vscode",
    model: OPUS,
    context: 211_000,
    live: { status: "idle", startedMin: 180 },
    pr: { number: 214, repo: "acme/mobile-app" },
    steps: [
      { you: "Add dark mode to the settings screen, following the system setting.", at: 64 },
      { tool: "Edit", input: { file_path: `${WORK}/mobile-app/src/screens/Settings.tsx` }, result: "ok", at: 40 },
      { tool: "Bash", input: { command: "npm test", description: "Run the tests" }, result: "Tests: 128 passed", at: 22 },
      {
        claude:
          "Settings now follows the system appearance, with tokens for every color on the screen. Tests pass, and I opened **#214** with before and after screenshots.",
        at: 18,
        end: true,
      },
    ],
    spend: [64, 50, 40, 22, 18],
  },
  {
    id: "5c1b1073-8e6f-41aa-8fa6-6e5b7a4d2f56",
    title: "Upgrade to Node 24",
    project: "payments-api",
    branch: "chore/node-24",
    entrypoint: "cli",
    model: SONNET,
    context: 47_000,
    live: { status: "idle", startedMin: 60 },
    pr: { number: 88, repo: "acme/payments-api" },
    steps: [
      { you: "Upgrade the service to Node 24 and fix whatever breaks.", at: 45 },
      { tool: "Bash", input: { command: "npm test", description: "Run the tests" }, result: "Tests: 342 passed", at: 9 },
      { claude: "Upgraded to Node 24: two deprecated crypto calls replaced, CI image bumped. All 342 tests pass; PR **#88** is ready for review.", at: 7, end: true },
    ],
    spend: [45, 30, 9, 7],
  },
  {
    id: "6d2c2184-9f70-42bb-a0b7-7f6c8b5e3a67",
    title: "Draft the v3.2 release notes",
    project: "/notes",
    branch: "main",
    entrypoint: "claude-desktop",
    model: HAIKU,
    context: 12_000,
    live: { status: "idle", startedMin: 30 },
    steps: [
      { you: "Draft release notes for v3.2 from the merged PRs.", at: 14 },
      { claude: "Drafted the v3.2 notes: 4 features, 9 fixes, one breaking change to the webhook payload, called out first.", at: 12, end: true },
    ],
    spend: [14, 12],
  },
  // Ended in the last day.
  {
    id: "7e3d3295-a081-43cc-b1c8-806d9c6f4b78",
    title: "Speed up product search",
    project: "storefront",
    branch: "perf/search-index",
    entrypoint: "cli",
    model: OPUS,
    context: 133_000,
    endedMin: 95,
    pr: { number: 512, repo: "acme/storefront" },
    steps: [
      { you: "Product search takes 900 ms. Make it fast.", at: 160 },
      { claude: "Search now uses a trigram index: p95 went from 900 ms to 45 ms. PR **#512**.", at: 95, end: true },
    ],
  },
  {
    id: "8f4e43a6-b192-44dd-82d9-917e0d7a5c89",
    title: "Crash on launch with an empty cache",
    project: "mobile-app",
    branch: "fix/empty-cache-crash",
    entrypoint: "claude-vscode",
    model: SONNET,
    context: 58_000,
    endedMin: 210,
    steps: [
      { you: "The app crashes on first launch when the cache folder is missing.", at: 260 },
      { claude: "Fixed: the cache folder is created before the first read, with a test that starts from an empty disk.", at: 210, end: true },
    ],
  },
  {
    id: "9a5f54b7-c2a3-45ee-93ea-a28f1e8b6d90",
    title: "Terraform plan for the new queue",
    project: "infra",
    branch: "feat/orders-queue",
    entrypoint: "cli",
    model: SONNET,
    context: 39_000,
    endedMin: 400,
    steps: [
      { you: "Add an SQS queue for order events with a dead-letter queue.", at: 450 },
      { claude: "Added the orders queue and its dead-letter queue; the plan adds 4 resources and changes none.", at: 400, end: true },
    ],
  },
];

function transcriptRows(s: DemoSession, cwd: string): string {
  const rows: object[] = [{ type: "ai-title", aiTitle: s.title, sessionId: s.id }];
  const base = { sessionId: s.id, cwd, entrypoint: s.entrypoint, gitBranch: s.branch, version: "2.4.0" };
  let n = 0;
  const reply = (at: number, content: object[], stop: string | null) => {
    n++;
    rows.push({
      ...base,
      type: "assistant",
      timestamp: iso(at),
      uuid: `${s.id}-a${n}`,
      message: {
        id: `msg_${s.id.slice(0, 8)}_${n}`,
        role: "assistant",
        model: s.model,
        content,
        stop_reason: stop,
        usage: { input_tokens: 1200 + n * 300, output_tokens: 800 + n * 150, cache_read_input_tokens: s.context - 1200 - n * 300, cache_creation_input_tokens: 9000 },
      },
    });
  };
  // Extra replies spread over the last hours, so the usage breakdown has something to show. They carry no text,
  // and come first so the session's real last message stays last.
  for (const at of s.spend ?? []) reply(at, [], null);
  for (const step of s.steps) {
    if ("you" in step) {
      rows.push({ ...base, type: "user", timestamp: iso(step.at), origin: { kind: "human" }, message: { role: "user", content: step.you } });
    } else if ("claude" in step) {
      reply(step.at, [{ type: "text", text: step.claude }], step.end ? "end_turn" : null);
    } else {
      const id = `toolu_${s.id.slice(0, 6)}_${n}`;
      reply(step.at, [{ type: "tool_use", id, name: step.tool, input: step.input }], "tool_use");
      if (step.result !== undefined) {
        rows.push({ ...base, type: "user", timestamp: iso(step.at - 0.2), message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: step.result }] } });
      }
    }
  }
  if (s.pr) {
    rows.push({ type: "pr-link", sessionId: s.id, prNumber: s.pr.number, prRepository: s.pr.repo, prUrl: `https://github.com/${s.pr.repo}/pull/${s.pr.number}`, timestamp: iso(1) });
  }
  // The question or plan still open must come last for the board to show it as waiting.
  const last = s.steps.at(-1);
  if (last && "tool" in last && (last.tool === "AskUserQuestion" || last.tool === "ExitPlanMode")) {
    const ask = rows.findLastIndex((r: any) => r.type === "assistant" && r.message.content[0]?.type === "tool_use");
    rows.push(...rows.splice(ask, 1));
  }
  // Same for a tool call still running.
  if (s.live?.status === "busy") {
    const running = rows.findLastIndex((r: any) => r.type === "assistant" && r.message.content[0]?.type === "tool_use");
    rows.push(...rows.splice(running, 1));
  }
  return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

function buildSessions(): void {
  for (const dir of ["storefront", "payments-api", "mobile-app", "data-pipeline", "infra"]) fs.mkdirSync(path.join(WORK, dir), { recursive: true });
  let fakePid = 0;
  for (const s of sessions) {
    const cwd = path.isAbsolute(s.project) ? path.join(HOME, s.project) : path.join(WORK, s.project);
    fs.mkdirSync(cwd, { recursive: true });
    const file = path.join(CLAUDE, "projects", slug(cwd), `${s.id}.jsonl`);
    write(file, transcriptRows(s, cwd));
    if (s.endedMin !== undefined) {
      const t = new Date(now - s.endedMin * MIN);
      fs.utimesSync(file, t, t);
    }
    for (const sub of s.subagents ?? []) {
      const dir = path.join(file.replace(/\.jsonl$/, ""), "subagents");
      write(path.join(dir, `agent-${sub.id}.meta.json`), { agentType: sub.type, description: sub.description, finished: sub.finished });
      write(
        path.join(dir, `agent-${sub.id}.jsonl`),
        JSON.stringify({
          type: "assistant",
          isSidechain: true,
          timestamp: iso(1),
          message: { id: `msg_sub_${sub.id}`, model: HAIKU, role: "assistant", content: [{ type: "text", text: "…" }], usage: { input_tokens: 900, output_tokens: 400, cache_read_input_tokens: sub.context - 900 } },
        }) + "\n",
      );
    }
    if (s.live) {
      // Every live session points at this process, so the board sees them as running.
      write(path.join(CLAUDE, "sessions", `${90000 + ++fakePid}.json`), {
        pid: process.pid,
        sessionId: s.id,
        cwd,
        startedAt: now - s.live.startedMin * MIN,
        entrypoint: s.entrypoint,
        status: s.live.status,
        statusUpdatedAt: now - 2 * MIN,
        ...(s.entrypoint === "claude-desktop" ? { hostSessionId: `local_${s.id}` } : {}),
      });
    }
  }
  write(path.join(STATE, "flags.json"), { [sessions[1].id]: { at: now - 20 * MIN, seen: now - 20 * MIN, note: "Check the retry limits with ops" } });
}

// ---- Claude Code setup, for the Analyzer -----------------------------------------

function buildSetup(): void {
  // A long global CLAUDE.md, a line repeated in a project's CLAUDE.md, wordy skills and one MCP server added twice.
  const shared = "- Keep functions short, name things clearly and test every change before you commit it.";
  const longRules = Array.from({ length: 150 }, (_, i) => `- Rule ${i + 1}: prefer small, reviewable pull requests that change one thing and explain why in the description.`).join("\n");
  write(path.join(CLAUDE, "CLAUDE.md"), `# How I work\n\n${shared}\n${longRules}\n`);
  write(path.join(WORK, "storefront", "CLAUDE.md"), `# Storefront\n\n${shared}\n- Use pnpm.\n${longRules.split("\n").slice(0, 60).join("\n").replaceAll("Rule", "Storefront rule")}\n`);
  write(path.join(CLAUDE, "settings.json"), {
    model: "opus",
    hooks: { PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: `node ${HOME}/.claude/hooks/format-on-save.js` }] }] },
    permissions: { allow: ["Bash(npm test:*)", "Bash(npm test:*)", "Read(**)"] },
  });
  write(path.join(CLAUDE, "settings.json.bak-20261020"), "{}");
  write(path.join(CLAUDE, "settings.json.bak-20261102"), "{}");
  for (const name of ["code-review", "review-code", "release-notes"]) {
    write(path.join(CLAUDE, "skills", name, "SKILL.md"), `---\nname: ${name === "review-code" ? "code-review" : name}\ndescription: ${"Reviews a change for bugs, style and missing tests, then writes a short report with the riskiest findings first. ".repeat(25)}\n---\n\nSteps…\n`);
  }
  write(path.join(HOME, ".claude.json"), {
    cachedUsageUtilization: {
      fetchedAtMs: now - 3 * MIN,
      utilization: {
        five_hour: { utilization: 38, resets_at: new Date(now + 131 * MIN).toISOString() },
        seven_day: { utilization: 61, resets_at: new Date(now + 3.2 * 24 * 60 * MIN).toISOString() },
      },
    },
    mcpServers: {
      GitHub: { type: "http", url: "https://api.githubcopilot.com/mcp/" },
      "github-local": { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
      postgres: { command: "npx", args: ["-y", "@modelcontextprotocol/server-postgres"] },
    },
    projects: { [path.join(WORK, "storefront")]: { mcpServers: { GitHub: { type: "http", url: "https://api.githubcopilot.com/mcp/" } } } },
  });
}

// ---- Router: config, and canned provider replies ----------------------------------------

function buildRouter(): void {
  write(path.join(STATE, "config.json"), {
    mode: "route",
    providers: [
      { id: "anthropic", type: "anthropic", name: "Anthropic", enabled: true },
      {
        id: "vertex",
        type: "gemini",
        name: "Gemini (Vertex AI)",
        api: "vertex",
        project: "demo-project",
        location: "global",
        keyEnv: ["DEMO_GEMINI_KEY"],
        enabled: true,
        models: ["gemini-4-argon", "gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.1-pro-preview"],
      },
    ],
    routes: {
      opus: ["vertex/gemini-4-argon", "vertex/gemini-3.1-pro-preview", "anthropic"],
      sonnet: ["vertex/gemini-3.8-flash", "anthropic"],
      haiku: ["vertex/gemini-3.5-flash-lite", "anthropic"],
    },
    fallback: { cooldownSec: 60, timeoutMs: 600000 },
    capture: false,
    port: PORT,
    // No live usage checks: they would run the real claude command.
    sessions: { projectsRoot: WORK, pollMs: 2000, usageCheckMin: 0, contextLimits: {} },
  });
  write(path.join(ROOT, "demo.env"), "DEMO_GEMINI_KEY=demo-key-not-real\n");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let geminiCalls = 0;

/** Answers Anthropic and Gemini calls locally. The 4th Gemini call fails, to show a fallback in the log. */
function mockProviders(): void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const host = new URL(url).hostname;
    if (host === "googleapis.com" || host.endsWith(".googleapis.com")) {
      await sleep(300 + Math.random() * 900);
      // A 404 is specific to the request, so the router moves to the next target without cooling the key down.
      if (++geminiCalls === 4) return Response.json({ error: { code: 404, message: "Publisher model was not found (demo)", status: "NOT_FOUND" } }, { status: 404 });
      const body = {
        candidates: [{ content: { role: "model", parts: [{ text: "Done. The change is in place and the tests pass." }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 18000 + Math.round(Math.random() * 60000), candidatesTokenCount: 300 + Math.round(Math.random() * 1500) },
      };
      if (url.includes("alt=sse")) return new Response(`data: ${JSON.stringify(body)}\n\n`, { headers: { "content-type": "text/event-stream" } });
      return Response.json(body);
    }
    if (host === "api.anthropic.com") {
      await sleep(400 + Math.random() * 800);
      if (url.includes("/v1/models")) return Response.json({ data: [] });
      const req = JSON.parse(String(init?.body ?? "{}"));
      return Response.json({
        id: `msg_demo_${Date.now()}`,
        type: "message",
        role: "assistant",
        model: req.model,
        content: [{ type: "text", text: "Done." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 24000, output_tokens: 900 },
      });
    }
    return realFetch(input, init);
  };
}

/** Sends a few requests through the router, as Claude Code sessions would. */
async function trafficThroughRouter(): Promise<void> {
  const calls: [string, number][] = [
    [OPUS, 0],
    [SONNET, 2],
    [HAIKU, 1],
    [OPUS, 0], // the 4th Gemini call fails and falls back
    [SONNET, 3],
    [OPUS, 4],
    [HAIKU, 2],
    [SONNET, 0],
  ];
  for (const [model, i] of calls) {
    await fetch(`http://127.0.0.1:${PORT}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": "demo" },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        stream: false,
        messages: [{ role: "user", content: "Continue." }],
        metadata: { user_id: JSON.stringify({ session_id: sessions[i].id }) },
      }),
    }).catch(() => {});
  }
}

// ---- Start ---------------------------------------------------------------------

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    process.exit(0);
  });
}
buildSessions();
buildSetup();
buildRouter();

process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.CLAUDE_ROUTER_HOME = STATE;
process.env.CLAUDE_ROUTER_ENV_FILE = path.join(ROOT, "demo.env");
process.env.PORT = String(PORT);
delete process.env.ANTHROPIC_BASE_URL;
mockProviders();

await import("../src/server.ts");
await sleep(1000);
await trafficThroughRouter();
console.log(`Demo data in ${ROOT}. Every provider reply is canned; nothing leaves this machine.`);
