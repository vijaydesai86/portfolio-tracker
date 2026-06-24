import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deleteImportRunFromBackup, deleteTransactionFromBackup } from "@/src/domain/deleteRecords";
import { applyManualEntry } from "@/src/domain/manualEntry";
import { calculateHoldingReturns } from "@/src/domain/holdingReturns";
import { commitManualCsvImport } from "@/src/importers/importPipeline";
import { createEmptyBackup } from "@/src/schema/backup";

describe("deleteRecords", () => {
  it("removes an import and prunes orphan records while keeping shared FX", () => {
    const backup = createEmptyBackup("INR");
    backup.imports.push({ id: "imp1", provider: "manual", status: "committed", confidence: "high", createdAt: "2026-01-01T00:00:00.000Z" });
    backup.sourceDocuments.push({ id: "src1", importId: "imp1", fileName: "manual.csv", addedAt: "2026-01-01T00:00:00.000Z" });
    backup.accounts.push({ id: "acct1", name: "Account", institution: "Broker", type: "us_stock", currency: "USD", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.instruments.push({ id: "inst1", name: "AAPL", type: "us_stock", symbol: "AAPL", currency: "USD", country: "US", category: "Equity", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.manualBalances.push({ id: "bal1", accountId: "acct1", instrumentId: "inst1", label: "AAPL", category: "Equity", currency: "USD", value: 100, asOfDate: "2026-01-01", source: { type: "import", importId: "imp1", provider: "manual" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.transactions.push({ id: "tx1", accountId: "acct1", instrumentId: "inst1", date: "2026-01-01", type: "buy", amount: 100, currency: "USD", fees: 0, taxes: 0, source: { type: "import", importId: "imp1", provider: "manual" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.priceSnapshots.push(
      { id: "px1", instrumentId: "inst1", price: 100, currency: "USD", asOfDate: "2026-01-01", source: "test", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "fx1", instrumentId: "USDINR", price: 85, currency: "INR", asOfDate: "2026-01-01", source: "test", createdAt: "2026-01-01T00:00:00.000Z" }
    );
    backup.goalMappings.push({ id: "gm1", goalId: "goal1", manualBalanceId: "bal1", percent: 100, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });

    const next = deleteImportRunFromBackup(backup, "imp1", "2026-02-01T00:00:00.000Z");

    expect(next.imports).toEqual([]);
    expect(next.sourceDocuments).toEqual([]);
    expect(next.transactions).toEqual([]);
    expect(next.manualBalances).toEqual([]);
    expect(next.accounts).toEqual([]);
    expect(next.instruments).toEqual([]);
    expect(next.priceSnapshots.map((snapshot) => snapshot.id)).toEqual(["fx1"]);
    expect(next.goalMappings).toEqual([]);
  });

  it("reverses balance value when deleting an Add Entry transaction", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({ id: "acct1", name: "Cash", institution: "Manual", type: "cash", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.instruments.push({ id: "inst1", name: "Cash", type: "cash", currency: "INR", country: "IN", category: "Cash", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.manualBalances.push({ id: "bal1", accountId: "acct1", instrumentId: "inst1", label: "Cash", category: "Cash", currency: "INR", value: 10000, investedAmount: 10000, investedCurrency: "INR", investedAsOfDate: "2026-01-01", asOfDate: "2026-01-01", source: { type: "import", provider: "manual_balances" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    const added = applyManualEntry(backup, { balanceId: "bal1", actionId: "deposit", date: "2026-06-24", amount: 250 }, "2026-06-24T00:00:00.000Z");

    const next = deleteTransactionFromBackup(added.backup, added.transaction!.id, "2026-06-25T00:00:00.000Z");
    const row = calculateHoldingReturns(next).get("bal1")!;

    expect(next.manualBalances[0].value).toBe(10000);
    expect(next.transactions).toEqual([]);
    expect(row.invested).toBe(10000);
    expect(row.profit).toBe(0);
  });

  it("reverses market quantity and value when deleting an Add Entry purchase", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({ id: "acct1", name: "Fund", institution: "AMC", type: "mutual_fund", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.instruments.push({ id: "inst1", name: "Fund", type: "mutual_fund", currency: "INR", country: "IN", category: "Equity", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.manualBalances.push({ id: "bal1", accountId: "acct1", instrumentId: "inst1", label: "Fund", category: "Equity", currency: "INR", value: 1000, quantity: 10, price: 100, asOfDate: "2026-01-01", source: { type: "import", provider: "cas_pdf" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.transactions.push({ id: "opening", accountId: "acct1", instrumentId: "inst1", date: "2026-01-01", type: "buy", quantity: 10, price: 100, amount: 1000, currency: "INR", fees: 0, taxes: 0, source: { type: "import", provider: "cas_pdf" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    const added = applyManualEntry(backup, { balanceId: "bal1", actionId: "buy", date: "2026-06-24", quantity: 2, price: 120 }, "2026-06-24T00:00:00.000Z");

    const next = deleteTransactionFromBackup(added.backup, added.transaction!.id, "2026-06-25T00:00:00.000Z");
    const row = calculateHoldingReturns(next).get("bal1")!;

    expect(next.manualBalances[0].quantity).toBe(10);
    expect(next.manualBalances[0].value).toBe(1200);
    expect(next.transactions.map((tx) => tx.id)).toEqual(["opening"]);
    expect(row.invested).toBe(1000);
    expect(row.profit).toBe(200);
  });

  it("reverses imported manual balance ledger rows when deleting a transaction", () => {
    const backup = createEmptyBackup("INR");
    const csv = readFileSync(resolve(__dirname, "../../fixtures/importable/manual-balance-ledger-sample.csv"), "utf8");
    const imported = commitManualCsvImport(backup, csv, { importId: "ledger", fileName: "manual-balance-ledger-sample.csv", now: "2026-06-24T00:00:00.000Z" }).backup;
    const ppf = imported.manualBalances.find((balance) => balance.label === "Public Provident Fund")!;
    const interest = imported.transactions.find((tx) => tx.accountId === ppf.accountId && tx.type === "interest_accrual" && tx.amount === 59587)!;

    const next = deleteTransactionFromBackup(imported, interest.id, "2026-06-25T00:00:00.000Z");
    const nextPpf = next.manualBalances.find((balance) => balance.id === ppf.id)!;
    const row = calculateHoldingReturns(next).get(ppf.id)!;

    expect(nextPpf.value).toBe(1001750);
    expect(row.invested).toBe(900000);
    expect(row.profit).toBe(101750);
    expect(next.transactions.some((tx) => tx.id === interest.id)).toBe(false);
  });

  it("deletes a single transaction without deleting a still-held instrument", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({ id: "acct1", name: "Account", institution: "Broker", type: "indian_stock", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.instruments.push({ id: "inst1", name: "Stock", type: "indian_stock", symbol: "STOCK", currency: "INR", country: "IN", category: "Equity", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.manualBalances.push({ id: "bal1", accountId: "acct1", instrumentId: "inst1", label: "Stock", category: "Equity", currency: "INR", value: 100, asOfDate: "2026-01-01", source: { type: "manual" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.transactions.push({ id: "tx1", accountId: "acct1", instrumentId: "inst1", date: "2026-01-01", type: "buy", amount: 100, currency: "INR", fees: 0, taxes: 0, source: { type: "manual" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });

    const next = deleteTransactionFromBackup(backup, "tx1", "2026-02-01T00:00:00.000Z");

    expect(next.transactions).toEqual([]);
    expect(next.accounts).toHaveLength(1);
    expect(next.instruments).toHaveLength(1);
    expect(next.manualBalances).toHaveLength(1);
  });
});
