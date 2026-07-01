export function installCollapsibleSections(root: HTMLElement, view: string, subScope: string) {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(".card, .chart-card, .cardless-panel, .command-hero, .analytics-scope-panel, .asset-class-card, .asset-type-hero, .asset-type-card, .asset-type-card-charts > div, .snapshot-command-panel, .goal-selector-panel, .goal-focus-panel, .goal-card, .goal-combined-panel, .goal-create-panel, .entry-selector-panel, .entry-form-panel"));
  for (const card of candidates) {
    const ownToggle = card.querySelector(":scope > .collapse-toggle, :scope > .collapsible-header > .collapse-toggle, :scope > .section-head > .collapse-toggle, :scope > .goal-card-head > .collapse-toggle");
    if (card.dataset.collapseBound === "true" && ownToggle) continue;
    if (card.closest(".mini-insight, .signal-item, .metric-card")) continue;
    const header = card.querySelector<HTMLElement>(":scope > .section-head, :scope > .goal-card-head") ?? card.querySelector<HTMLElement>(":scope > h2, :scope > h3") ?? card.querySelector<HTMLElement>(":scope > div:first-child");
    const titleSource = card.querySelector<HTMLElement>(":scope > .section-head h2, :scope > h2, :scope > h3, :scope > .goal-card-head input, :scope > .panel-heading span, :scope > .asset-type-card-head span, :scope > .hero-ledger .eyebrow, :scope > .asset-type-hero .eyebrow, :scope > div:first-child h2, :scope > div:first-child .eyebrow, :scope > div:first-child span");
    const title = (titleSource instanceof HTMLInputElement ? titleSource.value : titleSource?.textContent ?? "Section").trim();
    if (!header || !title || title.length > 80) continue;
    card.dataset.collapseBound = "true";
    card.classList.add("collapsible-section");
    header.classList.add("collapsible-header");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "collapse-toggle";
    button.setAttribute("aria-label", "Collapse " + title);
    button.title = "Collapse or expand this section";
    const storageKey = "portfolio-collapse:" + view + ":" + subScope + ":" + title;
    const sync = () => {
      const collapsed = card.classList.contains("is-collapsed");
      button.dataset.state = collapsed ? "collapsed" : "expanded";
      button.setAttribute("aria-expanded", collapsed ? "false" : "true");
      button.setAttribute("aria-label", (collapsed ? "Expand " : "Collapse ") + title);
      button.title = (collapsed ? "Expand " : "Collapse ") + title;
    };
    if (localStorage.getItem(storageKey) === "collapsed") card.classList.add("is-collapsed");
    sync();
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      card.classList.toggle("is-collapsed");
      localStorage.setItem(storageKey, card.classList.contains("is-collapsed") ? "collapsed" : "expanded");
      sync();
    });
    if (header.classList.contains("section-head") || header.classList.contains("goal-card-head")) {
      header.appendChild(button);
    } else if (header.tagName === "DIV") {
      header.appendChild(button);
    } else {
      card.insertBefore(button, header.nextSibling);
    }
  }
}

export function installInteractiveTables(root: HTMLElement): () => void {
  const cleanups: Array<() => void> = [];
  const tables = Array.from(root.querySelectorAll<HTMLTableElement>(".table-wrap table"));
  for (const table of tables) {
    const wrap = table.closest<HTMLElement>(".table-wrap");
    if (!wrap || wrap.dataset.interactiveTable === "true") continue;
    const body = table.tBodies.item(0);
    const headerRow = table.tHead?.rows.item(0);
    if (!body || !headerRow || body.rows.length < 2) continue;
    wrap.dataset.interactiveTable = "true";
    wrap.classList.add("interactive-table-wrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("aria-label", "Scrollable sortable data table");
    const hint = document.createElement("div");
    hint.className = "table-interaction-hint";
    hint.textContent = "Select a column header to sort. Wide tables scroll inside this panel.";
    wrap.parentElement?.insertBefore(hint, wrap);
    cleanups.push(() => hint.remove());
    Array.from(headerRow.cells).forEach((cell, columnIndex) => {
      const text = cell.textContent?.trim() ?? "Column";
      if (!text || cell.querySelector("button, input, select")) return;
      cell.classList.add("sortable-column");
      cell.tabIndex = 0;
      cell.setAttribute("role", "button");
      cell.setAttribute("aria-sort", "none");
      cell.title = "Sort by " + text;
      const sort = () => {
        const nextDirection = cell.dataset.sortDirection === "asc" ? "desc" : "asc";
        for (const other of Array.from(headerRow.cells)) {
          other.classList.remove("sort-asc", "sort-desc");
          other.setAttribute("aria-sort", "none");
          delete (other as HTMLElement).dataset.sortDirection;
        }
        cell.dataset.sortDirection = nextDirection;
        cell.classList.add(nextDirection === "asc" ? "sort-asc" : "sort-desc");
        cell.setAttribute("aria-sort", nextDirection === "asc" ? "ascending" : "descending");
        const rows = Array.from(body.rows).map((row, originalIndex) => ({ row, originalIndex }));
        rows.sort((left, right) => compareTableCellText(left.row.cells.item(columnIndex)?.textContent ?? "", right.row.cells.item(columnIndex)?.textContent ?? "", left.originalIndex, right.originalIndex) * (nextDirection === "asc" ? 1 : -1));
        for (const item of rows) body.appendChild(item.row);
      };
      const onClick = () => sort();
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        sort();
      };
      cell.addEventListener("click", onClick);
      cell.addEventListener("keydown", onKeyDown);
      cleanups.push(() => {
        cell.removeEventListener("click", onClick);
        cell.removeEventListener("keydown", onKeyDown);
      });
    });
    cleanups.push(() => {
      wrap.classList.remove("interactive-table-wrap");
      delete wrap.dataset.interactiveTable;
      wrap.removeAttribute("tabindex");
      wrap.removeAttribute("aria-label");
    });
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}

function compareTableCellText(left: string, right: string, leftIndex: number, rightIndex: number): number {
  const leftNumber = tableSortNumber(left);
  const rightNumber = tableSortNumber(right);
  if (leftNumber !== undefined && rightNumber !== undefined && leftNumber !== rightNumber) return leftNumber - rightNumber;
  const compared = left.trim().localeCompare(right.trim(), undefined, { numeric: true, sensitivity: "base" });
  return compared === 0 ? leftIndex - rightIndex : compared;
}

function tableSortNumber(value: string): number | undefined {
  const normalized = value.replace(/,/g, "").trim();
  const match = normalized.match(/[-+]?\d*\.?\d+/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) return undefined;
  if (/cr/i.test(normalized)) return parsed * 10000000;
  if (/\bl\b|lakh/i.test(normalized)) return parsed * 100000;
  if (/%/.test(normalized)) return parsed;
  return parsed;
}
