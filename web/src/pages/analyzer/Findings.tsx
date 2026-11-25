import type { Category, Finding, Severity } from "@server/analyzer/types.ts";
import { useState } from "react";
import { Badge, Card, Select } from "@/components/ui";
import { CATEGORY_LABELS } from "@/pages/analyzer/Scores";

const SEVERITY_VARIANT: Record<Severity, "destructive" | "warning" | "muted"> = { high: "destructive", medium: "warning", low: "muted" };

/** Findings arrive worst first from the server; filtering keeps that order. */
export function Findings({ findings }: { findings: Finding[] }) {
  const [project, setProject] = useState("");
  const [category, setCategory] = useState<Category | "">("");
  const projects = [...new Set(findings.map((f) => f.project).filter((p): p is string => !!p))].sort();
  const shown = findings.filter((f) => (!project || f.project === project) && (!category || f.category === category));

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project" className="max-w-64">
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <Select value={category} onChange={(e) => setCategory(e.target.value as Category | "")} aria-label="Category">
          <option value="">All categories</option>
          {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </Select>
        <span className="text-[13px] text-muted-foreground">
          {shown.length} of {findings.length} findings
        </span>
      </div>

      <Card className="divide-y">
        {shown.length === 0 && <p className="px-5 py-4 text-sm text-muted-foreground">Nothing to fix here.</p>}
        {shown.map((f) => (
          <div key={f.id} className="grid gap-1.5 px-5 py-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={SEVERITY_VARIANT[f.severity]}>{f.severity}</Badge>
              <span className="text-sm font-medium">{f.title}</span>
              <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground tabular-nums">−{f.points} {CATEGORY_LABELS[f.category]}</span>
            </div>
            <p className="text-[13px] text-muted-foreground">
              {f.estimated && <span title="Estimated (characters ÷ 4)">~ </span>}
              {f.detail}
            </p>
            {(f.file || f.project) && (
              <p className="font-mono text-xs break-all text-muted-foreground">
                {f.project && !f.file && f.project}
                {f.file}
                {f.line !== undefined && `:${f.line}`}
              </p>
            )}
            <p className="text-[13px]">
              <span className="font-medium">Fix: </span>
              {f.fix}
            </p>
          </div>
        ))}
      </Card>
    </div>
  );
}
