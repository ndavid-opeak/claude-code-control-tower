import type { Category, Finding, Severity } from "@server/analyzer/types.ts";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button, Card, Select } from "@/components/ui";
import { cn } from "@/lib/utils";
import { shortPath, shortTitle } from "@/pages/analyzer/format";
import { CATEGORY_LABELS } from "@/pages/analyzer/Scores";

const DOT: Record<Severity, string> = { high: "bg-destructive", medium: "bg-warning", low: "bg-muted-foreground/40" };
/** Rows shown before "Show all". */
const FIRST = 8;

/** Findings arrive worst first from the server; each row is one line until opened. */
export function Findings({ findings, category, onClearCategory }: { findings: Finding[]; category: Category | null; onClearCategory: () => void }) {
  const [project, setProject] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const projects = [...new Set(findings.map((f) => f.project).filter((p): p is string => !!p))].sort();
  const shown = findings.filter((f) => (!project || f.project === project) && (!category || f.category === category));
  const visible = all ? shown : shown.slice(0, FIRST);

  return (
    <section className="grid gap-3" aria-labelledby="findings-title">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="findings-title" className="text-[15px] font-semibold tracking-tight">
          {category ? CATEGORY_LABELS[category] : "What to fix"}
        </h2>
        <span className="text-[13px] text-muted-foreground tabular-nums">{shown.length}</span>
        {category && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground" onClick={onClearCategory}>
            Show all categories
          </Button>
        )}
        {projects.length > 1 && (
          <Select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project" className="ml-auto h-8 max-w-56 text-[13px]">
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {shortPath(p)}
              </option>
            ))}
          </Select>
        )}
      </div>

      <Card className="divide-y overflow-hidden">
        {shown.length === 0 && <p className="px-5 py-4 text-sm text-muted-foreground">Nothing to fix here.</p>}
        {visible.map((f) => {
          const isOpen = open === f.id;
          return (
            <div key={f.id}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : f.id)}
                className="flex w-full items-center gap-3 px-5 py-3 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/60"
              >
                <span className={cn("size-2 shrink-0 rounded-full", DOT[f.severity])} title={`${f.severity} severity`} />
                <span className="min-w-0 flex-1 truncate text-sm" title={f.title}>
                  {shortTitle(f.title)}
                </span>
                {!category && <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{CATEGORY_LABELS[f.category]}</span>}
                <span className="w-7 shrink-0 text-right text-xs text-muted-foreground tabular-nums">−{f.points}</span>
                <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", isOpen && "rotate-90")} />
              </button>
              {isOpen && (
                <div className="grid max-w-3xl gap-3 px-5 pb-4 pl-10 text-[13px] leading-relaxed">
                  <p className="text-muted-foreground">{f.detail}</p>
                  <p>
                    <span className="font-medium">Fix </span>
                    {f.fix}
                  </p>
                  {(f.file || f.project) && (
                    <p className="font-mono text-xs break-all text-muted-foreground" title={f.file ?? f.project}>
                      {shortPath(f.file ?? f.project ?? "")}
                      {f.line !== undefined && `:${f.line}`}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {shown.length > FIRST && (
          <button type="button" onClick={() => setAll(!all)} className="w-full px-5 py-2.5 text-left text-[13px] text-muted-foreground outline-none hover:bg-muted/50 hover:text-foreground focus-visible:bg-muted/60">
            {all ? "Show fewer" : `Show ${shown.length - FIRST} more`}
          </button>
        )}
      </Card>
    </section>
  );
}
