import { describe, expect, it } from "vitest";
import { calculateHoldingReturns } from "@/src/domain/holdingReturns";
import { createEmptyBackup } from "@/src/schema/backup";

describe("calculateHoldingReturns", () => {
  it("calculates per-holding invested, profit, allocation, and XIRR", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({ id: "acct", name: "MF", institution: "AMC", type: "mutual_fund", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.instruments.push({ id: "inst", name: "Fund", type: "mutual_fund", currency: "INR", country: "IN", category: "Equity", issuer: "AMC", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.transactions.push({ id: "buy", accountId: "acct", instrumentId: "inst", date: "2026-01-01", type: "buy", quantity: 10, amount: 1000, currency: "INR", fees: 10, taxes: 5, source: { type: "import" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.manualBalances.push({ id: "bal", accountId: "acct", instrumentId: "inst", label: "Fund", category: "Equity", currency: "INR", value: 1200, quantity: 10, price: 120, asOfDate: "2027-01-01", source: { type: "import", provider: "test" }, userModified: false, createdAt: "2027-01-01T00:00:00.000Z", updatedAt: "2027-01-01T00:00:00.000Z" });

    const row = calculateHoldingReturns(backup).get("bal")!;

    expect(row.invested).toBe(1015);
    expect(row.netInvested).toBe(1015);
    expect(row.profit).toBe(185);
    expect(row.returnPercent).toBeCloseTo(18.23, 2);
    expect(row.allocationPercent).toBe(100);
    expect(row.xirr).toBeGreaterThan(17);
  });

  it("returns null XIRR when holding FX is missing", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({ id: "acct", name: "US", institution: "Broker", type: "us_stock", currency: "USD", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.instruments.push({ id: "inst", name: "AAPL", type: "us_stock", symbol: "AAPL", currency: "USD", country: "US", category: "Equity", issuer: "Apple", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.transactions.push({ id: "buy", accountId: "acct", instrumentId: "inst", date: "2026-01-01", type: "buy", quantity: 1, amount: 100, currency: "USD", fees: 0, taxes: 0, source: { type: "import" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.manualBalances.push({ id: "bal", accountId: "acct", instrumentId: "inst", label: "AAPL", category: "Equity", currency: "USD", value: 120, asOfDate: "2026-06-01", source: { type: "import", provider: "test" }, userModified: false, createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z" });

    const row = calculateHoldingReturns(backup).get("bal")!;

    expect(row.currentValue).toBeUndefined();
    expect(row.xirr).toBeNull();
    expect(row.missingFx).toEqual(["USD/INR", "USD/INR on/after 2026-01-01"]);
  });
});
