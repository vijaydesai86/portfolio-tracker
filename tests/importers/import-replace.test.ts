import { describe, expect, it } from "vitest";
import { applyImportedRecordSet } from "@/src/importers/importReplace";
import { createEmptyBackup, type Account, type ImportRun, type Instrument, type ManualBalance, type PortfolioBackup, type Transaction } from "@/src/schema/backup";

const now = "2026-07-01T00:00:00.000Z";

function account(id = "acc_cash"): Account {
  return { id, name: "Cash", institution: "Manual", type: "cash", currency: "INR", createdAt: now, updatedAt: now };
}

function instrument(id = "inst_cash"): Instrument {
  return { id, name: "Cash", type: "cash", currency: "INR", category: "Cash", issuer: "Manual", createdAt: now, updatedAt: now };
}

function importRun(id: string, provider = "manual_csv"): ImportRun {
  return { id, provider, fileName: id + ".csv", label: id, status: "staged", confidence: "high", createdAt: now };
}

function tx(id: string, importId: string, hash: string, amount: number): Transaction {
  return { id, accountId: "acc_cash", instrumentId: "inst_cash", date: "2026-06-01", type: "deposit", amount, currency: "INR", fees: 0, taxes: 0, source: { type: "import", importId, provider: "manual_csv", sourceRecordHash: hash }, userModified: false, createdAt: now, updatedAt: now };
}

function balance(id: string, importId: string, hash: string, value: number): ManualBalance {
  return { id, accountId: "acc_cash", instrumentId: "inst_cash", label: "Cash", category: "Cash", currency: "INR", value, asOfDate: "2026-06-01", source: { type: "import", importId, provider: "manual_csv", sourceRecordHash: hash }, userModified: false, createdAt: now, updatedAt: now };
}

function apply(base: PortfolioBackup, importId: string, records: { transactions?: Transaction[]; balances?: ManualBalance[] }) {
  return applyImportedRecordSet(base, {
    accounts: [account()],
    instruments: [instrument()],
    transactions: records.transactions ?? [],
    manualBalances: records.balances ?? [],
    importRun: importRun(importId),
    sourceDocument: { id: "doc_" + importId, importId, fileName: importId + ".csv", addedAt: now }
  }, { now, replaceImportId: importId === "new" ? "old" : undefined });
}

describe("provider-wide import replacement", () => {
  it("preserves user-edited matching records and removes stale old records", () => {
    const first = apply(createEmptyBackup("INR"), "old", {
      transactions: [tx("tx_keep", "old", "same-tx", 100), tx("tx_stale", "old", "stale-tx", 50)],
      balances: [balance("bal_keep", "old", "same-bal", 100), balance("bal_stale", "old", "stale-bal", 50)]
    });
    const edited: PortfolioBackup = {
      ...first,
      transactions: first.transactions.map((row) => row.id === "tx_keep" ? { ...row, taxFmvPrice: 123, userModified: true } : row),
      manualBalances: first.manualBalances.map((row) => row.id === "bal_keep" ? { ...row, taperMode: "medium", userModified: true } : row),
      goalMappings: [{ id: "map_stale", goalId: "goal_1", manualBalanceId: "bal_stale", percent: 100, createdAt: now, updatedAt: now }]
    };

    const replaced = apply(edited, "new", {
      transactions: [tx("tx_new", "new", "same-tx", 200)],
      balances: [balance("bal_new", "new", "same-bal", 200)]
    });

    expect(replaced.transactions).toHaveLength(1);
    expect(replaced.transactions[0]).toMatchObject({ id: "tx_keep", taxFmvPrice: 123, userModified: true, source: { importId: "new" } });
    expect(replaced.manualBalances).toHaveLength(1);
    expect(replaced.manualBalances[0]).toMatchObject({ id: "bal_keep", taperMode: "medium", userModified: true, source: { importId: "new" } });
    expect(replaced.goalMappings).toEqual([]);
    expect(replaced.imports.map((run) => run.id)).toEqual(["new"]);
    expect(replaced.sourceDocuments.map((doc) => doc.importId)).toEqual(["new"]);
  });

  it("updates imported facts while preserving non-source overlays on matching provider records", () => {
    const first = apply(createEmptyBackup("INR"), "old", {
      transactions: [tx("tx_keep", "old", "same-tx", 100)],
      balances: [{ ...balance("bal_keep", "old", "same-bal", 100), taperMode: "medium", taperFactor: 0.05 }]
    });
    const edited: PortfolioBackup = {
      ...first,
      goalMappings: [{ id: "map_keep", goalId: "goal_1", manualBalanceId: "bal_keep", percent: 75, createdAt: now, updatedAt: now }]
    };

    const replaced = apply(edited, "new", {
      transactions: [{ ...tx("tx_new", "new", "same-tx", 200), taxFmvPrice: 456 }],
      balances: [balance("bal_new", "new", "same-bal", 250)]
    });

    expect(replaced.transactions).toHaveLength(1);
    expect(replaced.transactions[0]).toMatchObject({ id: "tx_keep", amount: 200, taxFmvPrice: 456, userModified: false, source: { importId: "new" } });
    expect(replaced.manualBalances).toHaveLength(1);
    expect(replaced.manualBalances[0]).toMatchObject({ id: "bal_keep", value: 250, taperMode: "medium", taperFactor: 0.05, userModified: false, source: { importId: "new" } });
    expect(replaced.goalMappings).toEqual([{ id: "map_keep", goalId: "goal_1", manualBalanceId: "bal_keep", percent: 75, createdAt: now, updatedAt: now }]);
  });
});
