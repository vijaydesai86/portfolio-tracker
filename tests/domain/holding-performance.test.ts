import { describe, expect, it } from "vitest";
import { lossWatchlist, topGainContributors, type HoldingPerformanceRow } from "@/src/domain/holdingPerformance";

const rows: HoldingPerformanceRow[] = [
  { id: "actual-loss", name: "HDFC Flexi Cap", value: 802232.52, profit: -12726.73, returnPercent: -1.6, meta: "Mutual Fund - India - cas_pdf" },
  { id: "tiny-gain", name: "EPF Employee Share", value: 26339, profit: 16, returnPercent: 0.1, meta: "PF - India - epfo_passbook" },
  { id: "small-gain", name: "GOOGL", value: 496615.54, profit: 1350.35, returnPercent: 0.3, meta: "Direct Stock - US - indmoney_export" },
  { id: "large-gain", name: "AMD", value: 1619078.18, profit: 1505137.79, returnPercent: 1321, meta: "Direct Stock - US - indmoney_export" },
  { id: "no-cost", name: "EPS Pension Share", value: 0, meta: "PF - India - epfo_passbook" }
];

describe("holding performance rankings", () => {
  it("shows only actual negative P/L rows in the loss watchlist", () => {
    expect(lossWatchlist(rows)).toEqual([rows[0]]);
  });

  it("keeps positive contributors sorted by absolute profit", () => {
    expect(topGainContributors(rows, 3).map((row) => row.id)).toEqual(["large-gain", "small-gain", "tiny-gain"]);
  });
});
