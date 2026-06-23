import { describe, expect, it } from "vitest";
import { buildPortfolioTimeline } from "@/src/domain/performanceTimeline";
import { createEmptyBackup } from "@/src/schema/backup";

describe("portfolio performance timeline", () => {
  it("builds invested versus priced current value with category and region drilldowns", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({ id: "acct", name: "MF", institution: "AMC", type: "mutual_fund", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.instruments.push({ id: "inst", name: "Fund", type: "mutual_fund", currency: "INR", country: "IN", category: "Equity", issuer: "AMC", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.transactions.push({ id: "buy", accountId: "acct", instrumentId: "inst", date: "2026-01-01", type: "buy", quantity: 10, price: 100, amount: 1000, currency: "INR", fees: 0, taxes: 0, source: { type: "import" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.priceSnapshots.push({ id: "p1", instrumentId: "inst", price: 110, currency: "INR", asOfDate: "2026-02-01", source: "test", createdAt: "2026-02-01T00:00:00.000Z" });

    const timeline = buildPortfolioTimeline(backup);
    const latest = timeline.points.at(-1)!;

    expect(latest).toMatchObject({ invested: 1000, current: 1100, profit: 100 });
    expect(latest.category).toMatchObject({ Equity: 1100 });
    expect(latest.region).toMatchObject({ India: 1100 });
    expect(timeline.coverage.pricedDates).toBeGreaterThan(0);
  });

  it("keeps PF interest accrual in current value but not invested cash flow", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({ id: "acct_epf", name: "EPFO", institution: "EPFO", type: "epf", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.instruments.push({ id: "inst_epf", name: "EPF Employee Share", type: "epf", currency: "INR", country: "IN", category: "Debt", issuer: "EPFO", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.transactions.push(
      { id: "contrib", accountId: "acct_epf", instrumentId: "inst_epf", date: "2026-03-31", type: "contribution", amount: 1000, currency: "INR", fees: 0, taxes: 0, source: { type: "import" }, userModified: false, createdAt: "2026-03-31T00:00:00.000Z", updatedAt: "2026-03-31T00:00:00.000Z" },
      { id: "interest", accountId: "acct_epf", instrumentId: "inst_epf", date: "2026-03-31", type: "interest_accrual", amount: 50, currency: "INR", fees: 0, taxes: 0, source: { type: "import" }, userModified: false, createdAt: "2026-03-31T00:00:00.000Z", updatedAt: "2026-03-31T00:00:00.000Z" }
    );

    const latest = buildPortfolioTimeline(backup).points.at(-1)!;

    expect(latest).toMatchObject({ invested: 1000, current: 1050, profit: 50 });
    expect(latest.category).toMatchObject({ Debt: 1050 });
  });
});
