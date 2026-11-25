import { describe, expect, it } from "vitest";
import { asString, focusScript, resumeScript, shellQuote } from "../../src/sessions/terminal.ts";

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
