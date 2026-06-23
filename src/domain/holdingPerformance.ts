export type HoldingPerformanceRow = {
  id: string;
  name: string;
  value: number;
  profit?: number;
  returnPercent?: number;
  meta: string;
};

export function topGainContributors(rows: HoldingPerformanceRow[], limit = 5): HoldingPerformanceRow[] {
  return rows
    .filter((row) => row.profit !== undefined)
    .slice()
    .sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0))
    .slice(0, limit);
}

export function lossWatchlist(rows: HoldingPerformanceRow[], limit = 5): HoldingPerformanceRow[] {
  return rows
    .filter((row) => row.profit !== undefined && row.profit < 0)
    .slice()
    .sort((a, b) => (a.profit ?? 0) - (b.profit ?? 0))
    .slice(0, limit);
}
