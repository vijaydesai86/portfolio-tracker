import type { PortfolioBackup } from "@/src/schema/backup";

export function deleteImportRunFromBackup(backup: PortfolioBackup, importId: string, now = new Date().toISOString()): PortfolioBackup {
  const deletedBalanceIds = new Set(backup.manualBalances.filter((balance) => balance.source.importId === importId).map((balance) => balance.id));
  return pruneOrphans({
    ...backup,
    exportedAt: now,
    imports: backup.imports.filter((run) => run.id !== importId),
    sourceDocuments: backup.sourceDocuments.filter((doc) => doc.importId !== importId),
    transactions: backup.transactions.filter((tx) => tx.source.importId !== importId),
    manualBalances: backup.manualBalances.filter((balance) => balance.source.importId !== importId),
    goalMappings: backup.goalMappings.filter((mapping) => !mapping.manualBalanceId || !deletedBalanceIds.has(mapping.manualBalanceId))
  });
}

export function deleteTransactionFromBackup(backup: PortfolioBackup, transactionId: string, now = new Date().toISOString()): PortfolioBackup {
  return pruneOrphans({
    ...backup,
    exportedAt: now,
    transactions: backup.transactions.filter((tx) => tx.id !== transactionId)
  });
}

export function pruneOrphans(portfolio: PortfolioBackup): PortfolioBackup {
  const usedAccountIds = new Set<string>();
  const usedInstrumentIds = new Set<string>();

  for (const balance of portfolio.manualBalances) {
    usedAccountIds.add(balance.accountId);
    if (balance.instrumentId) usedInstrumentIds.add(balance.instrumentId);
  }
  for (const tx of portfolio.transactions) {
    usedAccountIds.add(tx.accountId);
    usedInstrumentIds.add(tx.instrumentId);
  }

  return {
    ...portfolio,
    accounts: portfolio.accounts.filter((account) => usedAccountIds.has(account.id)),
    instruments: portfolio.instruments.filter((instrument) => usedInstrumentIds.has(instrument.id)),
    priceSnapshots: portfolio.priceSnapshots.filter((snapshot) => isFxSnapshot(snapshot.instrumentId) || usedInstrumentIds.has(snapshot.instrumentId))
  };
}

function isFxSnapshot(instrumentId: string): boolean {
  return /^[A-Z]{6}$/.test(instrumentId);
}
