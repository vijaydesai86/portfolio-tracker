import { describe, expect, it } from "vitest";
import { applyManualEntry, manualEntryActionsForAccount } from "@/src/domain/manualEntry";
import { calculateHoldingReturns } from "@/src/domain/holdingReturns";
import { createEmptyBackup, type PortfolioBackup } from "@/src/schema/backup";

const now = "2026-06-24T00:00:00.000Z";

describe("manual asset entries", () => {
  it("adds a mutual fund purchase as canonical transaction and updates units/value/cost basis", () => {
    const backup = basePortfolio("mutual_fund", "Fund", "INR");
    backup.transactions.push({ id: "opening", accountId: "acct", instrumentId: "inst", date: "2026-01-01", type: "buy", quantity: 10, price: 100, amount: 1000, currency: "INR", fees: 0, taxes: 0, source: { type: "import", provider: "cas_pdf" }, userModified: false, createdAt: now, updatedAt: now });
    backup.manualBalances.push({ id: "bal", accountId: "acct", instrumentId: "inst", label: "Fund", category: "Equity", currency: "INR", value: 1000, quantity: 10, price: 100, asOfDate: "2026-01-01", source: { type: "import", provider: "cas_pdf" }, userModified: false, createdAt: now, updatedAt: now });

    const result = applyManualEntry(backup, { balanceId: "bal", actionId: "buy", date: "2026-06-24", quantity: 2, price: 120, fees: 1, taxes: 2, notes: "extra purchase" }, now);
    const row = calculateHoldingReturns(result.backup).get("bal")!;

    expect(result.transaction).toMatchObject({ type: "buy", quantity: 2, price: 120, amount: 240, fees: 1, taxes: 2, source: { type: "manual", provider: "manual_entry" } });
    expect(result.balance.quantity).toBe(12);
    expect(result.balance.value).toBe(1440);
    expect(row.invested).toBe(1243);
    expect(row.profit).toBe(197);
  });

  it("adds PF contribution and interest without treating interest as invested capital", () => {
    const backup = basePortfolio("epf", "EPF Employee Share", "INR");
    backup.manualBalances.push({ id: "bal", accountId: "acct", instrumentId: "inst", label: "EPF Employee Share", category: "Debt", currency: "INR", value: 1000, asOfDate: "2026-03-31", source: { type: "import", provider: "epfo_passbook" }, userModified: false, createdAt: now, updatedAt: now });

    const afterContribution = applyManualEntry(backup, { balanceId: "bal", actionId: "contribution", date: "2026-04-30", amount: 500 }, now).backup;
    const afterInterest = applyManualEntry(afterContribution, { balanceId: "bal", actionId: "interest_accrual", date: "2026-05-31", amount: 50 }, now).backup;
    const row = calculateHoldingReturns(afterInterest).get("bal")!;

    expect(afterInterest.transactions.map((tx) => tx.type)).toEqual(["contribution", "interest_accrual"]);
    expect(afterInterest.manualBalances[0].value).toBe(1550);
    expect(row.invested).toBe(500);
    expect(row.profit).toBe(1050);
  });

  it("records balance snapshots for balance-only assets without creating fake transactions", () => {
    const backup = basePortfolio("ppf", "Public Provident Fund", "INR");
    backup.manualBalances.push({ id: "bal", accountId: "acct", instrumentId: "inst", label: "Public Provident Fund", category: "Debt", currency: "INR", value: 50000, investedAmount: 45000, investedCurrency: "INR", investedAsOfDate: "2026-03-31", asOfDate: "2026-03-31", source: { type: "import", provider: "manual_balances" }, userModified: false, createdAt: now, updatedAt: now });

    const result = applyManualEntry(backup, { balanceId: "bal", actionId: "snapshot", date: "2026-06-24", currentValue: 56000, investedAmount: 50000 }, now);
    const row = calculateHoldingReturns(result.backup).get("bal")!;

    expect(result.transaction).toBeUndefined();
    expect(result.balance.value).toBe(56000);
    expect(result.balance.investedAmount).toBe(50000);
    expect(row.invested).toBe(50000);
    expect(row.xirr).toBeUndefined();
  });

  it("seeds opening cost basis when adding the first transaction to a balance-only holding", () => {
    const backup = basePortfolio("ppf", "Public Provident Fund", "INR");
    backup.manualBalances.push({ id: "bal", accountId: "acct", instrumentId: "inst", label: "Public Provident Fund", category: "Debt", currency: "INR", value: 50000, investedAmount: 45000, investedCurrency: "INR", investedAsOfDate: "2026-03-31", asOfDate: "2026-03-31", source: { type: "import", provider: "manual_balances" }, userModified: false, createdAt: now, updatedAt: now });

    const result = applyManualEntry(backup, { balanceId: "bal", actionId: "deposit", date: "2026-06-24", amount: 5000 }, now);
    const row = calculateHoldingReturns(result.backup).get("bal")!;

    expect(result.backup.transactions.map((tx) => tx.source.provider)).toEqual(["manual_entry_opening", "manual_entry"]);
    expect(result.backup.transactions.map((tx) => tx.amount)).toEqual([45000, 5000]);
    expect(result.balance.value).toBe(55000);
    expect(row.invested).toBe(50000);
    expect(row.profit).toBe(5000);
    expect(row.xirr).toBeTypeOf("number");
  });

  it("reduces balance-only cost basis when a withdrawal is added", () => {
    const backup = basePortfolio("cash", "Cash Wallet", "INR");
    backup.manualBalances.push({ id: "bal", accountId: "acct", instrumentId: "inst", label: "Cash Wallet", category: "Cash", currency: "INR", value: 1000, investedAmount: 1000, investedCurrency: "INR", investedAsOfDate: "2026-03-31", asOfDate: "2026-03-31", source: { type: "import", provider: "manual_balances" }, userModified: false, createdAt: now, updatedAt: now });

    const result = applyManualEntry(backup, { balanceId: "bal", actionId: "withdrawal", date: "2026-06-24", amount: 200 }, now);
    const row = calculateHoldingReturns(result.backup).get("bal")!;

    expect(result.balance.value).toBe(800);
    expect(row.invested).toBe(800);
    expect(row.profit).toBe(0);
  });

  it("rejects transaction entries without amount or computable quantity times price", () => {
    const backup = basePortfolio("cash", "Cash Wallet", "INR");
    backup.manualBalances.push({ id: "bal", accountId: "acct", instrumentId: "inst", label: "Cash Wallet", category: "Cash", currency: "INR", value: 1000, asOfDate: "2026-03-31", source: { type: "import", provider: "manual_balances" }, userModified: false, createdAt: now, updatedAt: now });

    expect(() => applyManualEntry(backup, { balanceId: "bal", actionId: "deposit", date: "2026-06-24" }, now)).toThrow("Amount is required");
  });

  it("exposes type-specific actions", () => {
    expect(manualEntryActionsForAccount("mutual_fund").map((action) => action.id)).toContain("redemption");
    expect(manualEntryActionsForAccount("us_stock").map((action) => action.id)).toContain("sell");
    expect(manualEntryActionsForAccount("epf").map((action) => action.id)).toContain("interest_accrual");
    expect(manualEntryActionsForAccount("nps").map((action) => action.id)).toContain("switch_out");
  });
});

function basePortfolio(type: Parameters<typeof manualEntryActionsForAccount>[0], name: string, currency: string): PortfolioBackup {
  const backup = createEmptyBackup("INR");
  backup.accounts.push({ id: "acct", name, institution: "Manual", type, currency, createdAt: now, updatedAt: now });
  backup.instruments.push({ id: "inst", name, type, currency, country: currency === "USD" ? "US" : "IN", category: type === "cash" ? "Cash" : type === "gold" ? "Gold" : type === "epf" || type === "ppf" ? "Debt" : "Equity", createdAt: now, updatedAt: now });
  return backup;
}
