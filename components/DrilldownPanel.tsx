import type { ReactNode } from "react";

export function DrilldownPanel({ title, summary, children, defaultOpen = false }: { title: string; summary?: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="drilldown-panel" open={defaultOpen}>
      <summary>
        <span>{title}</span>
        {summary && <small>{summary}</small>}
      </summary>
      <div className="drilldown-body">{children}</div>
    </details>
  );
}
