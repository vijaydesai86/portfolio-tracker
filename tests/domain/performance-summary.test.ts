import { describe, expect, it } from "vitest";
import { calculatePortfolioInsights, calculatePortfolioSummary } from "@/src/domain/analytics";
import { calculateDashboardPerformance } from "@/src/domain/dashboardPerformance";
import { calculateHoldingReturns } from "@/src/domain/holdingReturns";
import { createEmptyBackup } from "@/src/schema/backup";

describe("portfolio performance summary", () => {
  it("derives headline invested and P/L from holding remaining cost basis", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({ id: "acct", name: "MF", institution: "AMC", type: "mutual_fund", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.instruments.push({ id: "inst", name: "Fund", type: "mutual_fund", currency: "INR", country: "IN", category: "Equity", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.transactions.push(
      { id: "buy", accountId: "acct", instrumentId: "inst", date: "2026-01-01", type: "buy", quantity: 10, amount: 1000, currency: "INR", fees: 0, taxes: 0, source: { type: "import" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "sell", accountId: "acct", instrumentId: "inst", date: "2026-06-01", type: "sell", quantity: 4, amount: 600, currency: "INR", fees: 0, taxes: 0, source: { type: "import" }, userModified: false, createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z" },
      { id: "tax", accountId: "acct", instrumentId: "inst", date: "2026-06-01", type: "tax", amount: 10, currency: "INR", fees: 0, taxes: 0, source: { type: "import" }, userModified: false, createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z" }
    );
    backup.manualBalances.push({ id: "bal", accountId: "acct", instrumentId: "inst", label: "Fund", category: "Equity", currency: "INR", value: 1200, quantity: 6, price: 200, asOfDate: "2026-06-22", source: { type: "import" }, userModified: false, createdAt: "2026-06-22T00:00:00.000Z", updatedAt: "2026-06-22T00:00:00.000Z" });

    const summary = calculatePortfolioSummary(backup);
    const insights = calculatePortfolioInsights(backup);
    const performance = calculateDashboardPerformance(summary, insights.transactionStats, calculateHoldingReturns(backup).values());

    expect(performance.grossCashIn).toBe(1000);
    expect(performance.cashOut).toBe(600);
    expect(performance.feesAndTax).toBe(10);
    expect(performance.netInvested).toBe(600);
    expect(performance.current).toBe(1200);
    expect(performance.totalProfit).toBe(600);
    expect(performance.absoluteReturnPercent).toBe(100);
  });
});
