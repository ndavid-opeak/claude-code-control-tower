import type { ReactNode } from "react";

/** /Users/me/Desktop/x → ~/Desktop/x */
export const shortPath = (p: string) => p.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");

/** The last folder of a path, for tight table cells (the full path goes in a tooltip). */
export const baseName = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

/** A finding title for a one-line row: plugin ids lose their marketplace, and the first letter is capitalized. */
export const shortTitle = (t: string) => {
  const s = t.replace(/\b([\w-]+)@[\w-]+/g, "$1");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
export const tokensShort = (n: number) => compact.format(n);

/** **bold** and `code`, the only inline markdown Claude's review uses. */
export function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i} className="font-medium text-foreground">{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="rounded bg-muted px-1 font-mono text-[0.9em]">{part.slice(1, -1)}</code>;
    return part;
  });
}

export interface ReviewItem {
  /** The item's bold lead, or its first sentence. */
  headline: string;
  /** The rest of the item, one entry per line. */
  lines: string[];
}

/** Splits the review into its numbered items; text before the first item becomes `note`. */
export function parseReview(advice: string): { note: string[]; items: ReviewItem[] } {
  const note: string[] = [];
  const items: ReviewItem[] = [];
  for (const raw of advice.split("\n")) {
    const line = raw.trimEnd();
    const start = /^(\d+)\.\s+(.*)$/.exec(line);
    if (start) {
      const body = start[2];
      const bold = /^\*\*(.+?)\*\*\s*(.*)$/.exec(body);
      const lead = bold ? bold[1] : body;
      const rest = bold?.[2] ? [bold[2]] : [];
      // Keep the row to the first sentence; the rest opens with the item.
      const cut = lead.search(/\.\s/);
      items.push(cut > 0 ? { headline: lead.slice(0, cut), lines: [lead.slice(cut + 2), ...rest] } : { headline: lead, lines: rest });
    } else if (items.length) {
      if (line.trim()) items[items.length - 1].lines.push(line.trim());
    } else if (line.trim()) {
      note.push(line.replace(/^>\s?/, "").trim());
    }
  }
  return { note, items };
}
