import { describe, expect, it } from "vitest";
import { asString, canFocusTerminal, focusScript, resumeLaunch, resumeScript, shellQuote } from "../../src/sessions/terminal.ts";

describe("terminal commands", () => {
  it("quotes folder names for the shell", () => {
    expect(shellQuote("/a b/c")).toBe("'/a b/c'");
    expect(shellQuote("/it's")).toBe(`'/it'\\''s'`);
  });

  it("escapes AppleScript strings", () => {
    expect(asString('say "hi" \\ now')).toBe('"say \\"hi\\" \\\\ now"');
  });

  it("builds a resume command in the session's folder", () => {
    const script = resumeScript("/Users/me/My Project", "95fb8841-bf01-4b16-8139-62a0c12870ab");
    expect(script).toContain(`do script "cd '/Users/me/My Project' && claude --resume 95fb8841-bf01-4b16-8139-62a0c12870ab"`);
  });

  it("never puts an odd session id into a command", () => {
    expect(() => resumeScript("/tmp", "x; rm -rf ~")).toThrow();
    expect(() => resumeScript("/tmp", "")).toThrow();
  });

  it("only accepts real tty names when looking for a window", () => {
    expect(focusScript("Terminal", "ttys012")).toContain('"/dev/ttys012"');
    expect(focusScript("iTerm2", "ttys003")).toContain("sessions of t");
    expect(() => focusScript("Terminal", '"; do shell script "x')).toThrow();
    expect(() => focusScript("Terminal", "??")).toThrow();
  });
});

describe("resuming outside macOS", () => {
  const id = "95fb8841-bf01-4b16-8139-62a0c12870ab";
  const only = (...names: string[]) => (c: string) => names.includes(c);

  it("only focuses running terminals on macOS", () => {
    expect(canFocusTerminal("darwin")).toBe(true);
    expect(canFocusTerminal("linux")).toBe(false);
    expect(canFocusTerminal("win32")).toBe(false);
  });

  it("uses Windows Terminal when it is installed, else Command Prompt", () => {
    expect(resumeLaunch("win32", "C:\\My Project", id, only("wt"))).toEqual({
      app: "Windows Terminal",
      file: "wt.exe",
      args: ["-d", "C:\\My Project", "cmd", "/k", "claude", "--resume", id],
    });
    expect(resumeLaunch("win32", "C:\\a;b", id, only("wt"))?.app).toBe("Command Prompt");
    expect(resumeLaunch("win32", "C:\\p", id, only())).toEqual({
      app: "Command Prompt",
      file: "cmd.exe",
      args: ["/c", "start", '""', "cmd", "/k", "claude", "--resume", id],
    });
  });

  it("picks a Linux terminal and passes the command the way it expects", () => {
    const shell = ["sh", "-c", `claude --resume ${id}; exec "\${SHELL:-sh}"`];
    expect(resumeLaunch("linux", "/p", id, only("xterm"), {})).toEqual({ app: "xterm", file: "xterm", args: ["-e", ...shell] });
    expect(resumeLaunch("linux", "/p", id, only("gnome-terminal", "xterm"), {})?.args).toEqual(["--", ...shell]);
    expect(resumeLaunch("linux", "/p", id, only("kitty"), {})?.args).toEqual(shell);
    expect(resumeLaunch("linux", "/p", id, only("xterm"), { TERMINAL: "/usr/bin/konsole" })).toEqual({ app: "konsole", file: "/usr/bin/konsole", args: ["-e", ...shell] });
    expect(resumeLaunch("linux", "/p", id, only(), {})).toBeNull();
  });

  it("never puts an odd session id into a command", () => {
    expect(() => resumeLaunch("win32", "C:\\p", "x & del *", only("wt"))).toThrow();
    expect(() => resumeLaunch("linux", "/p", "$(rm -rf ~)", only("xterm"), {})).toThrow();
  });
});
