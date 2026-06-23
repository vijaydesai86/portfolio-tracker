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

  it("does not fabricate profit for balance-only holdings without invested amount", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({ id: "cash", name: "Cash", institution: "Manual", type: "cash", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.instruments.push({ id: "cash-inst", name: "Cash", type: "cash", currency: "INR", country: "IN", category: "Cash", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.manualBalances.push({ id: "bal", accountId: "cash", instrumentId: "cash-inst", label: "Cash", category: "Cash", currency: "INR", value: 50000, asOfDate: "2026-06-22", source: { type: "import", provider: "manual_balances" }, userModified: false, createdAt: "2026-06-22T00:00:00.000Z", updatedAt: "2026-06-22T00:00:00.000Z" });

    const row = calculateHoldingReturns(backup).get("bal")!;

    expect(row.costBasisKnown).toBe(false);
    expect(row.invested).toBe(0);
    expect(row.profit).toBeUndefined();
    expect(row.returnPercent).toBeUndefined();
    expect(row.xirr).toBeUndefined();
  });

  it("uses authoritative holding invested amount over partial transaction reconstruction", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({ id: "acct", name: "MF", institution: "AMC", type: "mutual_fund", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.instruments.push({ id: "inst", name: "Fund", type: "mutual_fund", currency: "INR", country: "IN", category: "Equity", issuer: "AMC", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.transactions.push({ id: "buy", accountId: "acct", instrumentId: "inst", date: "2026-01-01", type: "buy", quantity: 10, amount: 10000, currency: "INR", fees: 0, taxes: 0, source: { type: "import", provider: "cas_pdf" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.manualBalances.push({ id: "bal", accountId: "acct", instrumentId: "inst", label: "Fund", category: "Equity", currency: "INR", value: 132000, investedAmount: 110000, investedCurrency: "INR", investedAsOfDate: "2026-06-19", quantity: 110, price: 1200, asOfDate: "2026-06-19", source: { type: "import", provider: "cas_pdf" }, userModified: false, createdAt: "2026-06-19T00:00:00.000Z", updatedAt: "2026-06-19T00:00:00.000Z" });

    const row = calculateHoldingReturns(backup).get("bal")!;

    expect(row.invested).toBe(110000);
    expect(row.profit).toBe(22000);
    expect(row.returnPercent).toBe(20);
    expect(row.xirr).toBeUndefined();
  });

  it("uses optional invested amount for balance-only holdings without creating XIRR", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({ id: "ppf", name: "PPF", institution: "Post Office", type: "ppf", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.instruments.push({ id: "ppf-inst", name: "PPF", type: "ppf", currency: "INR", country: "IN", category: "Debt", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.manualBalances.push({ id: "bal", accountId: "ppf", instrumentId: "ppf-inst", label: "PPF", category: "Debt", currency: "INR", value: 50000, investedAmount: 45000, investedCurrency: "INR", investedAsOfDate: "2026-06-22", asOfDate: "2026-06-22", source: { type: "import", provider: "manual_balances" }, userModified: false, createdAt: "2026-06-22T00:00:00.000Z", updatedAt: "2026-06-22T00:00:00.000Z" });

    const row = calculateHoldingReturns(backup).get("bal")!;

    expect(row.costBasisKnown).toBe(true);
    expect(row.hasCashFlows).toBe(false);
    expect(row.netInvested).toBe(45000);
    expect(row.profit).toBe(5000);
    expect(row.returnPercent).toBeCloseTo(11.11, 2);
    expect(row.xirr).toBeUndefined();
  });


  it("keeps invested as remaining cost basis after a partial sale", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({ id: "acct", name: "Broker", institution: "Broker", type: "indian_stock", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.instruments.push({ id: "inst", name: "Stock", type: "indian_stock", symbol: "STOCK", currency: "INR", country: "IN", category: "Equity", issuer: "Company", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.transactions.push(
      { id: "buy", accountId: "acct", instrumentId: "inst", date: "2026-01-01", type: "buy", quantity: 10, amount: 1000, currency: "INR", fees: 0, taxes: 0, source: { type: "import" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "sell", accountId: "acct", instrumentId: "inst", date: "2026-06-01", type: "sell", quantity: 4, amount: 600, currency: "INR", fees: 0, taxes: 0, source: { type: "import" }, userModified: false, createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z" }
    );
    backup.manualBalances.push({ id: "bal", accountId: "acct", instrumentId: "inst", label: "Stock", category: "Equity", currency: "INR", value: 900, quantity: 6, price: 150, asOfDate: "2027-01-01", source: { type: "import", provider: "test" }, userModified: false, createdAt: "2027-01-01T00:00:00.000Z", updatedAt: "2027-01-01T00:00:00.000Z" });

    const row = calculateHoldingReturns(backup).get("bal")!;

    expect(row.invested).toBe(600);
    expect(row.netInvested).toBe(600);
    expect(row.cashOut).toBe(600);
    expect(row.profit).toBe(300);
    expect(row.returnPercent).toBe(50);
  });


  it("preserves cost basis across zero-amount broker migration rows", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({ id: "acct", name: "US Broker", institution: "INDMoney", type: "us_stock", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.instruments.push({ id: "inst", name: "Migrated Stock", type: "us_stock", symbol: "MIG", currency: "INR", country: "US", category: "Equity", issuer: "Company", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.transactions.push(
      { id: "buy1", accountId: "acct", instrumentId: "inst", date: "2025-01-01", type: "buy", quantity: 10, amount: 1000, currency: "INR", fees: 0, taxes: 0, source: { type: "import", provider: "indmoney_export" }, userModified: false, createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z" },
      { id: "migration_out", accountId: "acct", instrumentId: "inst", date: "2026-05-05", type: "sell", quantity: 10, amount: 0, currency: "INR", fees: 0, taxes: 0, source: { type: "import", provider: "indmoney_export" }, userModified: false, createdAt: "2026-05-05T00:00:00.000Z", updatedAt: "2026-05-05T00:00:00.000Z" },
      { id: "migration_in", accountId: "acct", instrumentId: "inst", date: "2026-05-06", type: "buy", quantity: 10, amount: 0, currency: "INR", fees: 0, taxes: 0, source: { type: "import", provider: "indmoney_export" }, userModified: false, createdAt: "2026-05-06T00:00:00.000Z", updatedAt: "2026-05-06T00:00:00.000Z" }
    );
    backup.manualBalances.push({ id: "bal", accountId: "acct", instrumentId: "inst", label: "Migrated Stock", category: "Equity", currency: "INR", value: 1500, quantity: 10, price: 150, asOfDate: "2026-06-23", source: { type: "import", provider: "indmoney_export" }, userModified: false, createdAt: "2026-06-23T00:00:00.000Z", updatedAt: "2026-06-23T00:00:00.000Z" });

    const row = calculateHoldingReturns(backup).get("bal")!;

    expect(row.invested).toBe(1000);
    expect(row.netInvested).toBe(1000);
    expect(row.profit).toBe(500);
    expect(row.xirr).toBeGreaterThan(0);
  });


  it("keeps same-instrument holdings isolated by account", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push(
      { id: "acct_ind", name: "INDMoney", institution: "INDMoney", type: "us_stock", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "acct_fid", name: "Fidelity", institution: "Fidelity", type: "us_stock", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
    );
    backup.instruments.push({ id: "inst", name: "ARM", type: "us_stock", symbol: "ARM", currency: "INR", country: "US", category: "Equity", issuer: "Arm", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.transactions.push(
      { id: "ind_buy", accountId: "acct_ind", instrumentId: "inst", date: "2026-01-01", type: "buy", quantity: 10, amount: 1000, currency: "INR", fees: 0, taxes: 0, source: { type: "import", provider: "indmoney_export" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "fid_buy", accountId: "acct_fid", instrumentId: "inst", date: "2026-01-01", type: "buy", quantity: 5, amount: 750, currency: "INR", fees: 0, taxes: 0, source: { type: "import", provider: "manual_transactions" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
    );
    backup.manualBalances.push(
      { id: "bal_ind", accountId: "acct_ind", instrumentId: "inst", label: "ARM INDMoney", category: "Equity", currency: "INR", value: 1200, quantity: 10, price: 120, asOfDate: "2027-01-01", source: { type: "import", provider: "indmoney_export" }, userModified: false, createdAt: "2027-01-01T00:00:00.000Z", updatedAt: "2027-01-01T00:00:00.000Z" },
      { id: "bal_fid", accountId: "acct_fid", instrumentId: "inst", label: "ARM Fidelity", category: "Equity", currency: "INR", value: 900, quantity: 5, price: 180, asOfDate: "2027-01-01", source: { type: "import", provider: "manual_positions" }, userModified: false, createdAt: "2027-01-01T00:00:00.000Z", updatedAt: "2027-01-01T00:00:00.000Z" }
    );

    const returns = calculateHoldingReturns(backup);

    expect(returns.get("bal_ind")!.invested).toBe(1000);
    expect(returns.get("bal_ind")!.profit).toBe(200);
    expect(returns.get("bal_fid")!.invested).toBe(750);
    expect(returns.get("bal_fid")!.profit).toBe(150);
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
