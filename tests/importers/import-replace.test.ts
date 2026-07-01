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

  it("preserves overlays across native provider replacement families", () => {
    const providers = [
      { id: "cas_pdf", latestOnly: false },
      { id: "indmoney_export", latestOnly: false },
      { id: "epfo_passbook", latestOnly: true },
      { id: "nps_statement", latestOnly: true }
    ] as const;

    for (const provider of providers) {
      const base = createEmptyBackup("INR");
      const oldImport = applyImportedRecordSet(base, {
        accounts: [account("acc_" + provider.id)],
        instruments: [instrument("inst_" + provider.id)],
        transactions: [{ ...tx("tx_" + provider.id, "old_" + provider.id, "same-tx-" + provider.id, 100), accountId: "acc_" + provider.id, instrumentId: "inst_" + provider.id, source: { type: "import", importId: "old_" + provider.id, provider: provider.id, sourceRecordHash: "same-tx-" + provider.id } }],
        manualBalances: [{ ...balance("bal_" + provider.id, "old_" + provider.id, "same-bal-" + provider.id, 100), accountId: "acc_" + provider.id, instrumentId: "inst_" + provider.id, source: { type: "import", importId: "old_" + provider.id, provider: provider.id, sourceRecordHash: "same-bal-" + provider.id } }],
        importRun: importRun("old_" + provider.id, provider.id),
        sourceDocument: { id: "doc_old_" + provider.id, importId: "old_" + provider.id, fileName: provider.id + ".fixture", addedAt: now }
      }, { now, latestManualBalances: provider.latestOnly });
      const edited: PortfolioBackup = {
        ...oldImport,
        transactions: oldImport.transactions.map((row) => ({ ...row, taxFmvPrice: 777, userModified: true })),
        manualBalances: oldImport.manualBalances.map((row) => ({ ...row, taperMode: "medium" as const, taperFactor: 0.05 })),
        goalMappings: [{ id: "map_" + provider.id, goalId: "goal_1", manualBalanceId: "bal_" + provider.id, percent: 50, createdAt: now, updatedAt: now }]
      };

      const replaced = applyImportedRecordSet(edited, {
        accounts: [account("acc_" + provider.id)],
        instruments: [instrument("inst_" + provider.id)],
        transactions: [{ ...tx("tx_new_" + provider.id, "new_" + provider.id, "same-tx-" + provider.id, 250), accountId: "acc_" + provider.id, instrumentId: "inst_" + provider.id, taxFmvPrice: 888, source: { type: "import", importId: "new_" + provider.id, provider: provider.id, sourceRecordHash: "same-tx-" + provider.id } }],
        manualBalances: [{ ...balance("bal_new_" + provider.id, "new_" + provider.id, "same-bal-" + provider.id, 300), accountId: "acc_" + provider.id, instrumentId: "inst_" + provider.id, source: { type: "import", importId: "new_" + provider.id, provider: provider.id, sourceRecordHash: "same-bal-" + provider.id } }],
        importRun: importRun("new_" + provider.id, provider.id),
        sourceDocument: { id: "doc_new_" + provider.id, importId: "new_" + provider.id, fileName: provider.id + ".fixture", addedAt: now }
      }, { now, replaceImportId: "old_" + provider.id, latestManualBalances: provider.latestOnly });

      expect(replaced.transactions).toHaveLength(1);
      expect(replaced.transactions[0]).toMatchObject({ taxFmvPrice: 777, userModified: true, source: { importId: "new_" + provider.id, provider: provider.id } });
      expect(replaced.manualBalances).toHaveLength(1);
      expect(replaced.manualBalances[0]).toMatchObject({ id: "bal_" + provider.id, value: 300, taperMode: "medium", taperFactor: 0.05, source: { importId: "new_" + provider.id, provider: provider.id } });
      expect(replaced.goalMappings).toEqual([{ id: "map_" + provider.id, goalId: "goal_1", manualBalanceId: "bal_" + provider.id, percent: 50, createdAt: now, updatedAt: now }]);
    }
  });
});
