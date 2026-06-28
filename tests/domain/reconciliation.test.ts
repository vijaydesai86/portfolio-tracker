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
    expect(report.sourceTotals.some((row) => row.source === "manual_positions" && row.holdings === 1)).toBe(true);
  });
});
