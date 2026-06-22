import { describe, expect, it } from "vitest";
import { calculatePortfolioInsights, calculatePortfolioSummary } from "@/src/domain/analytics";
import { createEmptyBackup } from "@/src/schema/backup";

function calculatePerformance(summary: ReturnType<typeof calculatePortfolioSummary>, insights: ReturnType<typeof calculatePortfolioInsights>) {
  const invested = insights.transactionStats.investedBase;
  const current = summary.netWorth;
  const returnedCash = insights.transactionStats.incomeBase;
  const feesAndTax = insights.transactionStats.feesAndTaxesBase;
  const profit = current + returnedCash - invested - feesAndTax;
  return { invested, current, returnedCash, feesAndTax, profit, returnPercent: invested === 0 ? null : (profit / invested) * 100 };
}

describe("portfolio performance summary", () => {
  it("derives invested current value profit and absolute return from canonical records", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({ id: "acct", name: "MF", institution: "AMC", type: "mutual_fund", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.instruments.push({ id: "inst", name: "Fund", type: "mutual_fund", currency: "INR", country: "IN", category: "Equity", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.transactions.push(
      { id: "buy", accountId: "acct", instrumentId: "inst", date: "2026-01-01", type: "buy", amount: 1000, currency: "INR", fees: 0, taxes: 0, source: { type: "import" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "div", accountId: "acct", instrumentId: "inst", date: "2026-06-01", type: "dividend", amount: 100, currency: "INR", fees: 0, taxes: 0, source: { type: "import" }, userModified: false, createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z" },
      { id: "tax", accountId: "acct", instrumentId: "inst", date: "2026-06-01", type: "tax", amount: 10, currency: "INR", fees: 0, taxes: 0, source: { type: "import" }, userModified: false, createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z" }
    );
    backup.manualBalances.push({ id: "bal", accountId: "acct", instrumentId: "inst", label: "Fund", category: "Equity", currency: "INR", value: 1200, asOfDate: "2026-06-22", source: { type: "import" }, userModified: false, createdAt: "2026-06-22T00:00:00.000Z", updatedAt: "2026-06-22T00:00:00.000Z" });

    const performance = calculatePerformance(calculatePortfolioSummary(backup), calculatePortfolioInsights(backup));

    expect(performance).toMatchObject({ invested: 1000, current: 1200, returnedCash: 100, feesAndTax: 10, profit: 290 });
    expect(performance.returnPercent).toBeCloseTo(29, 6);
  });
});
