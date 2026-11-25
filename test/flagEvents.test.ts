import { describe, expect, it } from "vitest";
import { flagEventsBetween, mergeEvents, type Seen, type Watched } from "../web/src/lib/sessions/flagEvents.ts";

const session = (id: string, state: string, extra: Partial<Watched["agent"]> = {}): Watched => ({
  agent: { sessionId: id, name: `name-${id}`, state, flag: {}, ...extra },
});
const seen = (entries: [string, string, boolean?][]) =>
  new Map<string, Seen>(entries.map(([id, state, flagged = true]) => [id, { state, flagged, name: `name-${id}` }]));

describe("flagEventsBetween", () => {
  it("reports a flagged session that starts waiting or finishes a turn, and nothing on the first snapshot", () => {
    const now = [session("a", "waiting"), session("b", "done"), session("c", "done")];
    expect(flagEventsBetween(null, now, new Set(), 5)).toEqual([]);
    const events = flagEventsBetween(seen([["a", "working"], ["b", "working"], ["c", "done"]]), now, new Set(), 5);
    expect(events.map((e) => [e.sessionId, e.kind])).toEqual([
      ["a", "waiting"],
      ["b", "done"],
    ]);
  });

  it("ignores sessions that are not flagged", () => {
    const now = [session("a", "waiting", { flag: undefined })];
    expect(flagEventsBetween(seen([["a", "working", false]]), now, new Set(), 5)).toEqual([]);
  });

  it("reports a flagged session that left the board as ended", () => {
    const events = flagEventsBetween(seen([["gone", "working"], ["other", "working", false]]), [], new Set(), 5);
    expect(events).toEqual([{ sessionId: "gone", name: "name-gone", kind: "ended", at: 5, note: undefined }]);
  });

  it("reports a context past danger once per session, even on the first snapshot", () => {
    const now = [session("a", "working", { contextLevel: "danger" })];
    expect(flagEventsBetween(null, now, new Set(), 5).map((e) => e.kind)).toEqual(["context"]);
    expect(flagEventsBetween(null, now, new Set(["a"]), 5)).toEqual([]);
  });
});

describe("mergeEvents", () => {
  it("keeps one card per session, the newest event winning, newest first", () => {
    const old = [{ sessionId: "a", name: "a", kind: "waiting" as const, at: 1 }, { sessionId: "b", name: "b", kind: "done" as const, at: 2 }];
    const merged = mergeEvents(old, [{ sessionId: "a", name: "a", kind: "done", at: 3 }]);
    expect(merged.map((e) => [e.sessionId, e.kind])).toEqual([
      ["a", "done"],
      ["b", "done"],
    ]);
  });
});
