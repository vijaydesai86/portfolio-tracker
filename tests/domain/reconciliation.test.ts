import { describe, expect, it } from "vitest";
import { createEmptyBackup } from "@/src/schema/backup";
import { buildReconciliationReport } from "@/src/domain/reconciliation";

const now = "2026-06-27T00:00:00.000Z";

describe("portfolio reconciliation report", () => {
  it("summarizes imports, parser confidence, data quality, missing market data, and source totals", () => {
    const backup = createEmptyBackup("INR");
    backup.imports.push({ id: "imp_manual", provider: "manual_balances", fileName: "manual.csv", label: "Manual file", status: "committed", confidence: "high", createdAt: now, committedAt: now });
    backup.sourceDocuments.push({ id: "doc_manual", importId: "imp_manual", fileName: "manual.csv", addedAt: now });
    backup.accounts.push({ id: "acct_cash", name: "Cash", institution: "Manual", type: "cash", currency: "INR", createdAt: now, updatedAt: now });
    backup.accounts.push({ id: "acct_us", name: "US", institution: "Fidelity", type: "us_stock", currency: "USD", createdAt: now, updatedAt: now });
    backup.instruments.push({ id: "inst_us", name: "Example US Stock", type: "us_stock", symbol: "TST", currency: "USD", country: "US", category: "Equity", issuer: "Example", createdAt: now, updatedAt: now });
    backup.manualBalances.push({ id: "cash", accountId: "acct_cash", label: "Cash", category: "Cash", currency: "INR", value: 1000, asOfDate: "2026-06-27", source: { type: "import", importId: "imp_manual", provider: "manual_balances" }, userModified: false, createdAt: now, updatedAt: now });
    backup.manualBalances.push({ id: "us", accountId: "acct_us", instrumentId: "inst_us", label: "Example US Stock", category: "Equity", currency: "USD", value: 100, quantity: 2, price: 50, asOfDate: "2026-06-27", source: { type: "import", importId: "imp_manual", provider: "manual_positions" }, userModified: false, createdAt: now, updatedAt: now });
    backup.transactions.push({ id: "tx", accountId: "acct_us", instrumentId: "inst_us", date: "2026-06-01", type: "buy", quantity: 2, price: 40, amount: 80, currency: "USD", fees: 0, taxes: 0, source: { type: "import", importId: "imp_manual", provider: "manual_transactions" }, userModified: false, createdAt: now, updatedAt: now });

    const report = buildReconciliationReport(backup);

    expect(report.summary).toMatchObject({ imports: 1, documents: 1, holdings: 2, transactions: 1, marketDataGaps: 2 });
    expect(report.imports[0]).toMatchObject({ label: "Manual file", provider: "manual_balances", records: 3, confidence: "high" });
    expect(report.marketDataGaps.map((gap) => gap.kind)).toEqual(["fx", "fx"]);
    expect(report.marketDataHealth).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Example US Stock", kind: "fx", status: "missing", severity: "critical", detail: expect.stringContaining("USD/INR") }),
      expect.objectContaining({ label: "Example US Stock", kind: "price", status: "covered", source: "holding", asOfDate: "2026-06-27" })
    ]));
    expect(report.sourceTotals.some((row) => row.source === "manual_positions" && row.holdings === 1)).toBe(true);
    expect(report.dataQuality.blockers).toBeGreaterThan(0);
    expect(report.dataQuality.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ area: "Market data", status: "blocker", detail: expect.stringContaining("critical") }),
      expect.objectContaining({ area: "Cost basis", status: "warning" })
    ]));
  });
  it("marks FX and price health as covered, stale, or missing with source detail", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({ id: "acct_us", name: "US", institution: "Fidelity", type: "us_stock", currency: "USD", createdAt: now, updatedAt: now });
    backup.instruments.push({ id: "inst_us", name: "Covered US Stock", type: "us_stock", symbol: "COV", currency: "USD", country: "US", category: "Equity", issuer: "Covered", createdAt: now, updatedAt: now });
    backup.priceSnapshots.push({ id: "fx_usdinr", instrumentId: "USDINR", price: 90, currency: "INR", asOfDate: "2026-06-20", source: "test_fx", createdAt: now });
    backup.manualBalances.push({ id: "us", accountId: "acct_us", instrumentId: "inst_us", label: "Covered US Stock", category: "Equity", currency: "USD", value: 200, quantity: 2, price: 100, asOfDate: "2026-06-27", source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now });

    const report = buildReconciliationReport(backup);

    expect(report.marketDataHealth).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Covered US Stock", kind: "fx", status: "covered", source: "test_fx", asOfDate: "2026-06-20", severity: "info" }),
      expect.objectContaining({ label: "Covered US Stock", kind: "price", status: "covered", source: "holding", asOfDate: "2026-06-27", severity: "info" })
    ]));
    expect(report.dataQuality.blockers).toBe(0);
    expect(report.dataQuality.score).toBeGreaterThan(70);
    expect(report.dataQuality.rows.map((row) => row.area)).toEqual(expect.arrayContaining(["Market data", "Cost basis", "XIRR coverage", "Valuation freshness"]));
  });

  it("surfaces last market refresh diagnostics in the data-quality layer", () => {
    const backup = createEmptyBackup("INR");
    backup.settings.marketRefresh = {
      refreshedAt: "2026-06-30T10:30:00.000Z",
      navSnapshots: 9,
      stockSnapshots: 12,
      fxSnapshots: 3,
      updatedValuations: 2,
      warnings: ["MFapi scheme history failed for 9 scheme(s)."],
      blockingErrors: []
    };

    const report = buildReconciliationReport(backup);

    expect(report.refreshDiagnostics).toMatchObject({
      refreshedAt: "2026-06-30T10:30:00.000Z",
      navSnapshots: 9,
      stockSnapshots: 12,
      fxSnapshots: 3,
      updatedValuations: 2,
      warnings: ["MFapi scheme history failed for 9 scheme(s)."],
      blockingErrors: []
    });
    expect(report.dataQuality.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ area: "Last refresh", status: "ok", score: 85, detail: expect.stringContaining("non-blocking history warning") })
    ]));
  });

});
