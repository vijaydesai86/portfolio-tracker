import { describe, expect, it } from "vitest";
import { calculatePortfolioInsights, calculatePortfolioSummary } from "@/src/domain/analytics";
import { buildPortfolioTimeline } from "@/src/domain/performanceTimeline";
import { createPortfolioSnapshot, snapshotAnalytics } from "@/src/domain/snapshots";
import { calculatePortfolioTaxReport } from "@/src/domain/tax";
import { createEmptyBackup, type PortfolioBackup } from "@/src/schema/backup";

function invariantBackup(): PortfolioBackup {
  const backup = createEmptyBackup("INR");
  const now = "2026-06-22T00:00:00.000Z";
  backup.accounts.push(
    { id: "acct_ind", name: "INDMoney US", institution: "INDMoney", type: "us_stock", currency: "USD", createdAt: now, updatedAt: now },
    { id: "acct_fid", name: "Fidelity US", institution: "Fidelity", type: "us_stock", currency: "USD", createdAt: now, updatedAt: now },
    { id: "acct_mf", name: "PPFAS", institution: "PPFAS", type: "mutual_fund", currency: "INR", createdAt: now, updatedAt: now }
  );
  backup.instruments.push(
    { id: "inst_arm", name: "Arm Holdings PLC ADR", type: "us_stock", symbol: "ARM", currency: "USD", country: "US", category: "Equity", issuer: "ARM", createdAt: now, updatedAt: now },
    { id: "inst_fund", name: "PPFAS Flexi", type: "mutual_fund", currency: "INR", country: "IN", category: "Equity", issuer: "PPFAS", createdAt: now, updatedAt: now }
  );
  backup.transactions.push(
    { id: "ind_buy", accountId: "acct_ind", instrumentId: "inst_arm", date: "2026-01-01", type: "buy", quantity: 10, amount: 100, currency: "USD", fees: 0, taxes: 0, source: { type: "import", provider: "indmoney_export" }, userModified: false, createdAt: now, updatedAt: now },
    { id: "fid_buy", accountId: "acct_fid", instrumentId: "inst_arm", date: "2026-01-01", type: "buy", quantity: 5, amount: 50, currency: "USD", fees: 0, taxes: 0, source: { type: "import", provider: "manual_transactions" }, userModified: false, createdAt: now, updatedAt: now },
    { id: "fid_sell", accountId: "acct_fid", instrumentId: "inst_arm", date: "2026-05-15", type: "sell", quantity: 2, amount: 60, currency: "USD", fees: 0, taxes: 0, source: { type: "import", provider: "manual_transactions" }, userModified: false, createdAt: now, updatedAt: now },
    { id: "mf_buy", accountId: "acct_mf", instrumentId: "inst_fund", date: "2026-01-01", type: "buy", quantity: 100, amount: 10000, currency: "INR", fees: 0, taxes: 0, source: { type: "import", provider: "cas_pdf" }, userModified: false, createdAt: now, updatedAt: now }
  );
  backup.manualBalances.push(
    { id: "bal_ind", accountId: "acct_ind", instrumentId: "inst_arm", label: "ARM INDMoney", category: "Equity", currency: "USD", value: 200, quantity: 10, price: 20, asOfDate: "2026-06-22", source: { type: "import", provider: "indmoney_export" }, userModified: false, createdAt: now, updatedAt: now },
    { id: "bal_fid", accountId: "acct_fid", instrumentId: "inst_arm", label: "ARM Fidelity", category: "Equity", currency: "USD", value: 60, quantity: 3, price: 20, asOfDate: "2026-06-22", source: { type: "import", provider: "manual_positions" }, userModified: false, createdAt: now, updatedAt: now },
    { id: "bal_mf", accountId: "acct_mf", instrumentId: "inst_fund", label: "PPFAS Flexi", category: "Equity", currency: "INR", value: 12000, quantity: 100, price: 120, asOfDate: "2026-06-22", source: { type: "import", provider: "cas_pdf" }, userModified: false, createdAt: now, updatedAt: now }
  );
  backup.priceSnapshots.push(
    { id: "fx_buy", instrumentId: "USDINR", price: 80, currency: "INR", asOfDate: "2026-01-01", source: "test", createdAt: now },
    { id: "fx_sell", instrumentId: "USDINR", price: 82, currency: "INR", asOfDate: "2026-05-15", source: "test", createdAt: now },
    { id: "fx_latest", instrumentId: "USDINR", price: 80, currency: "INR", asOfDate: "2026-06-22", source: "test", createdAt: now },
    { id: "arm_price", instrumentId: "inst_arm", price: 20, currency: "USD", asOfDate: "2026-06-22", source: "test", createdAt: now },
    { id: "mf_price", instrumentId: "inst_fund", price: 120, currency: "INR", asOfDate: "2026-06-22", source: "test", createdAt: now }
  );
  return backup;
}

function sumRows(rows: Array<{ value: number }>): number {
  return round(rows.reduce((sum, row) => sum + row.value, 0));
}

function sumRecord(record: Record<string, number>): number {
  return round(Object.values(record).reduce((sum, value) => sum + value, 0));
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

describe("cross-page calculation invariants", () => {
  it("keeps current chart buckets, timeline latest, and snapshots reconciled to net worth", () => {
    const backup = invariantBackup();
    const summary = calculatePortfolioSummary(backup);
    const insights = calculatePortfolioInsights(backup);
    const latest = buildPortfolioTimeline(backup).points.at(-1)!;
    const snapshot = snapshotAnalytics(createPortfolioSnapshot(backup, { name: "Invariant", asOfDate: "2026-06-22", now: "2026-06-22T10:00:00.000Z" }))!;

    expect(summary.netWorth).toBe(32800);
    expect(sumRows(insights.totalsByCategory)).toBe(summary.netWorth);
    expect(sumRows(insights.totalsByIssuer)).toBe(summary.netWorth);
    expect(sumRows(insights.totalsByRegion)).toBe(summary.netWorth);
    expect(insights.totalsByIssuer).toEqual([
      { name: "INDMoney", value: 16000 },
      { name: "PPFAS", value: 12000 },
      { name: "Fidelity", value: 4800 }
    ]);
    expect(latest.current).toBe(summary.netWorth);
    expect(sumRecord(latest.category)).toBe(summary.netWorth);
    expect(sumRecord(latest.issuer)).toBe(summary.netWorth);
    expect(snapshot.summary.netWorth).toBe(summary.netWorth);
    expect(sumRecord(snapshot.timelinePoint.issuer)).toBe(summary.netWorth);
  });

  it("reconciles tax holding tables back to lot rows and bucket totals", () => {
    const report = calculatePortfolioTaxReport(invariantBackup(), { financialYear: "2026-27" });
    const bucketTax = round(Object.values(report.realized.byBucket).reduce((sum, row) => sum + row.tax, 0));
    const bucketGain = round(Object.values(report.realized.byBucket).reduce((sum, row) => sum + row.gain, 0));
    const holdingTax = round(report.realized.byAssetBucket.reduce((sum, row) => sum + row.allocatedTaxAfterSetoff, 0));
    const holdingGain = round(report.realized.byAssetBucket.reduce((sum, row) => sum + row.gain, 0));
    const lotGain = round(report.realized.rows.reduce((sum, row) => sum + row.gain, 0));
    const unrealizedGain = round(report.unrealized.byAssetBucket.reduce((sum, row) => sum + row.gain, 0));

    expect(report.realized.totalGain).toBe(lotGain);
    expect(holdingGain).toBe(lotGain);
    expect(bucketGain).toBe(lotGain);
    expect(holdingTax).toBe(bucketTax);
    expect(report.estimatedTax.capitalGainsTax).toBe(bucketTax);
    expect(report.unrealized.totalGain).toBe(unrealizedGain);
  });
});
