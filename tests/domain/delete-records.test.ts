import { describe, expect, it } from "vitest";
import { deleteImportRunFromBackup, deleteTransactionFromBackup } from "@/src/domain/deleteRecords";
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
