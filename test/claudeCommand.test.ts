import { describe, expect, it } from "vitest";
import { claudeInvocation, claudeNotFound } from "../src/claudeCommand.ts";

describe("running claude", () => {
  it("runs claude directly outside Windows", () => {
    expect(claudeInvocation(["-p", "", "a b"], "linux")).toEqual({ file: "claude", args: ["-p", "", "a b"], shell: false });
  });

  it("quotes every argument for cmd.exe on Windows, keeping empty ones", () => {
    expect(claudeInvocation(["-p", "", "a b"], "win32")).toEqual({ file: "claude", args: ['"-p"', '""', '"a b"'], shell: true });
  });

  it("refuses arguments cmd.exe would expand", () => {
    expect(() => claudeInvocation(["%PATH%"], "win32")).toThrow();
    expect(() => claudeInvocation(['say "hi"'], "win32")).toThrow();
  });

  it("recognises claude missing on each OS", () => {
    expect(claudeNotFound(Object.assign(new Error("x"), { code: "ENOENT" }))).toBe(true);
    expect(claudeNotFound(new Error("x"), "'claude' is not recognized as an internal or external command,")).toBe(true);
    expect(claudeNotFound(new Error("x"), "boom")).toBe(false);
  });
});
