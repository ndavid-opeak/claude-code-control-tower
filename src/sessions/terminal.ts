import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Session ids are UUID-like; anything else is never put into a command. */
const SESSION_ID = /^[A-Za-z0-9-]{1,100}$/;
const TTY = /^ttys\d+$/;

export type TerminalApp = 'Terminal' | 'iTerm2';

/** Quote for a POSIX shell, so a folder name can hold spaces or quotes. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** An AppleScript string literal. */
export function asString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** AppleScript that opens a new Terminal window in `cwd` running `claude --resume <id>`. */
export function resumeScript(cwd: string, sessionId: string): string {
  if (!SESSION_ID.test(sessionId)) throw new Error('Bad session id.');
  const command = `cd ${shellQuote(cwd)} && claude --resume ${sessionId}`;
  return `tell application "Terminal"\nactivate\ndo script ${asString(command)}\nend tell`;
}

/** AppleScript that brings the window or tab on `tty` to the front. It prints "found", or nothing if there is no such tab. */
export function focusScript(app: TerminalApp, tty: string): string {
  if (!TTY.test(tty)) throw new Error('Bad tty.');
  const device = asString(`/dev/${tty}`);
  if (app === 'Terminal') {
    return `tell application "Terminal"
repeat with w in windows
repeat with t in tabs of w
if tty of t is ${device} then
set selected of t to true
set index of w to 1
activate
return "found"
end if
end repeat
end repeat
end tell
return ""`;
  }
  return `tell application "iTerm2"
repeat with w in windows
repeat with t in tabs of w
repeat with s in sessions of t
if tty of s is ${device} then
tell w to select
tell t to select
tell s to select
activate
return "found"
end if
end repeat
end repeat
end repeat
end tell
return ""`;
}

/** macOS says -1743 when the router has not been allowed to control the terminal app. */
function explain(err: unknown): Error {
  const text = String((err as { stderr?: string }).stderr || (err as Error).message || err);
  if (text.includes('-1743') || /not authori[sz]ed/i.test(text)) {
    return new Error('macOS has not allowed claude-code-control-tower to control the terminal. Allow it in System Settings > Privacy & Security > Automation, then try again.');
  }
  return new Error(text.trim().split('\n')[0] || 'Could not open the terminal.');
}

async function osascript(script: string): Promise<string> {
  try {
    return (await run('osascript', ['-e', script], { timeout: 10_000 })).stdout.trim();
  } catch (err) {
    throw explain(err);
  }
}

/** `tell application` would launch the app, so only ask apps that are already running. */
async function isRunning(app: TerminalApp): Promise<boolean> {
  try {
    await run('pgrep', ['-x', app]);
    return true;
  } catch {
    return false;
  }
}

/** Brings the terminal window running process `pid` to the front. Returns the app, or null when no Terminal or iTerm2 tab has it. */
export async function showTerminal(pid: number): Promise<TerminalApp | null> {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  let tty = '';
  try {
    tty = (await run('ps', ['-o', 'tty=', '-p', String(pid)])).stdout.trim();
  } catch {
    return null;
  }
  if (!TTY.test(tty)) return null;
  for (const app of ['Terminal', 'iTerm2'] as const) {
    if (await isRunning(app) && (await osascript(focusScript(app, tty))) === 'found') return app;
  }
  return null;
}

/** Opens a new Terminal window that resumes an ended session in its own folder. */
export async function resumeInTerminal(cwd: string, sessionId: string): Promise<void> {
  await osascript(resumeScript(cwd, sessionId));
}
