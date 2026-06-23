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

  it("does not show portfolio current value for partial valuation dates", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push(
      { id: "acct1", name: "MF1", institution: "AMC", type: "mutual_fund", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "acct2", name: "MF2", institution: "AMC", type: "mutual_fund", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
    );
    backup.instruments.push(
      { id: "inst1", name: "Fund 1", type: "mutual_fund", currency: "INR", country: "IN", category: "Equity", issuer: "AMC", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "inst2", name: "Fund 2", type: "mutual_fund", currency: "INR", country: "IN", category: "Debt", issuer: "AMC", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
    );
    backup.transactions.push(
      { id: "buy1", accountId: "acct1", instrumentId: "inst1", date: "2026-01-01", type: "buy", quantity: 10, amount: 1000, currency: "INR", fees: 0, taxes: 0, source: { type: "import" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "buy2", accountId: "acct2", instrumentId: "inst2", date: "2026-01-01", type: "buy", quantity: 20, amount: 2000, currency: "INR", fees: 0, taxes: 0, source: { type: "import" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
    );
    backup.priceSnapshots.push({ id: "p1", instrumentId: "inst1", price: 120, currency: "INR", asOfDate: "2026-02-01", source: "test", createdAt: "2026-02-01T00:00:00.000Z" });

    const latest = buildPortfolioTimeline(backup).points.at(-1)!;

    expect(latest.current).toBeNull();
    expect(latest.profit).toBeNull();
    expect(latest.category).toMatchObject({ Equity: 1200 });
  });

  it("samples month-end plus latest date and carries real prices forward", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({ id: "acct", name: "MF", institution: "AMC", type: "mutual_fund", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.instruments.push({ id: "inst", name: "Fund", type: "mutual_fund", currency: "INR", country: "IN", category: "Equity", issuer: "AMC", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.transactions.push({ id: "buy", accountId: "acct", instrumentId: "inst", date: "2026-01-15", type: "buy", quantity: 10, amount: 1000, currency: "INR", fees: 0, taxes: 0, source: { type: "import" }, userModified: false, createdAt: "2026-01-15T00:00:00.000Z", updatedAt: "2026-01-15T00:00:00.000Z" });
    backup.priceSnapshots.push(
      { id: "p1", instrumentId: "inst", price: 100, currency: "INR", asOfDate: "2026-01-31", source: "test", createdAt: "2026-01-31T00:00:00.000Z" },
      { id: "p2", instrumentId: "inst", price: 150, currency: "INR", asOfDate: "2026-03-31", source: "test", createdAt: "2026-03-31T00:00:00.000Z" }
    );

    const timeline = buildPortfolioTimeline(backup);
    const dates = timeline.points.map((point) => point.date);
    const latest = timeline.points.at(-1)!;

    expect(dates.slice(0, 4)).toEqual(["2026-01-15", "2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(latest.date).toBe(new Date().toISOString().slice(0, 10));
    expect(latest.current).toBe(1500);
  });

  it("uses latest FX on the sampled valuation date for carried-forward USD prices", () => {
    const backup = createEmptyBackup("INR");
    const today = new Date().toISOString().slice(0, 10);
    backup.accounts.push({ id: "acct", name: "US Broker", institution: "Broker", type: "us_stock", currency: "USD", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.instruments.push({ id: "inst", name: "AAPL", type: "us_stock", symbol: "AAPL", currency: "USD", country: "US", category: "Equity", issuer: "Apple", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.transactions.push({ id: "buy", accountId: "acct", instrumentId: "inst", date: "2026-01-01", type: "buy", quantity: 10, amount: 100, currency: "USD", fees: 0, taxes: 0, source: { type: "import" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.priceSnapshots.push(
      { id: "fx_buy", instrumentId: "USDINR", price: 75, currency: "INR", asOfDate: "2026-01-01", source: "test", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "quote", instrumentId: "inst", price: 20, currency: "USD", asOfDate: "2026-01-31", source: "test", createdAt: "2026-01-31T00:00:00.000Z" },
      { id: "fx_old", instrumentId: "USDINR", price: 80, currency: "INR", asOfDate: "2026-01-31", source: "test", createdAt: "2026-01-31T00:00:00.000Z" },
      { id: "fx_today", instrumentId: "USDINR", price: 90, currency: "INR", asOfDate: today, source: "test", createdAt: today + "T00:00:00.000Z" }
    );

    const latest = buildPortfolioTimeline(backup).points.at(-1)!;

    expect(latest.date).toBe(today);
    expect(latest.current).toBe(18000);
  });

});
