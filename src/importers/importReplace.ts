import type { Account, ImportRun, Instrument, ManualBalance, PortfolioBackup, PriceSnapshot, SourceDocument, Transaction } from "@/src/schema/backup";

export type ImportedRecordSet = {
  accounts: Account[];
  instruments: Instrument[];
  transactions: Transaction[];
  manualBalances: ManualBalance[];
  priceSnapshots?: PriceSnapshot[];
  importRun: ImportRun;
  sourceDocument?: SourceDocument;
};

export type ApplyImportedRecordOptions = {
  now: string;
  replaceImportId?: string;
  latestManualBalances?: boolean;
};

export function applyImportedRecordSet(base: PortfolioBackup, imported: ImportedRecordSet, options: ApplyImportedRecordOptions): PortfolioBackup {
  const next = cloneBackup(base);
  const incomingTransactionHashes = new Set(imported.transactions.map((tx) => tx.source.sourceRecordHash).filter((value): value is string => Boolean(value)));
  const incomingBalanceHashes = new Set(imported.manualBalances.map((balance) => balance.source.sourceRecordHash).filter((value): value is string => Boolean(value)));
  const replacedImportId = options.replaceImportId;

  if (replacedImportId) {
    const staleBalanceIds = new Set(
      next.manualBalances
        .filter((balance) => balance.source.importId === replacedImportId && !hashMatches(balance.source.sourceRecordHash, incomingBalanceHashes))
        .map((balance) => balance.id)
    );
    next.transactions = next.transactions.filter((tx) => tx.source.importId !== replacedImportId || hashMatches(tx.source.sourceRecordHash, incomingTransactionHashes));
    next.manualBalances = next.manualBalances.filter((balance) => balance.source.importId !== replacedImportId || hashMatches(balance.source.sourceRecordHash, incomingBalanceHashes));
    next.goalMappings = next.goalMappings.filter((mapping) => !mapping.manualBalanceId || !staleBalanceIds.has(mapping.manualBalanceId));
    next.imports = next.imports.filter((run) => run.id !== replacedImportId);
    next.sourceDocuments = next.sourceDocuments.filter((doc) => doc.importId !== replacedImportId);
  }

  next.accounts = mergeById(next.accounts, imported.accounts);
  next.instruments = mergeById(next.instruments, imported.instruments);
  next.transactions = mergeTransactions(next.transactions, imported.transactions, options.now, replacedImportId, imported.importRun.id);
  next.manualBalances = mergeManualBalances(next.manualBalances, imported.manualBalances, options.now, replacedImportId, imported.importRun.id, Boolean(options.latestManualBalances));
  next.priceSnapshots = mergePriceSnapshots(next.priceSnapshots, imported.priceSnapshots ?? []);
  next.imports = mergeById(next.imports, [{ ...imported.importRun, status: imported.importRun.status === "failed" ? "failed" : "committed", committedAt: imported.importRun.status === "failed" ? undefined : options.now }]);
  next.sourceDocuments = imported.sourceDocument ? mergeById(next.sourceDocuments, [imported.sourceDocument]) : next.sourceDocuments;
  next.exportedAt = options.now;
  return next;
}

export function replaceableImportRuns(backup: PortfolioBackup): ImportRun[] {
  return backup.imports.filter((run) => run.status === "committed").sort((a, b) => (b.committedAt ?? b.createdAt).localeCompare(a.committedAt ?? a.createdAt));
}

function mergeTransactions(existing: Transaction[], incoming: Transaction[], now: string, replaceImportId: string | undefined, newImportId: string): Transaction[] {
  const result = [...existing];
  for (const tx of incoming) {
    const incomingHash = tx.source.sourceRecordHash;
    const existingIndex = result.findIndex((item) => incomingHash && item.source.sourceRecordHash === incomingHash);
    if (existingIndex === -1) {
      result.push(tx);
      continue;
    }

    const current = result[existingIndex];
    if (replaceImportId && current.source.importId === replaceImportId) {
      result[existingIndex] = current.userModified
        ? { ...current, source: { ...current.source, importId: newImportId, provider: tx.source.provider }, updatedAt: now }
        : mergeImportedTransaction(current, tx, now);
    }
  }
  return result;
}

function mergeImportedTransaction(current: Transaction, incoming: Transaction, now: string): Transaction {
  return { ...incoming, id: current.id, createdAt: current.createdAt, updatedAt: now };
}

function mergeImportedBalance(current: ManualBalance, incoming: ManualBalance, now: string): ManualBalance {
  return {
    ...incoming,
    id: current.id,
    taperMode: current.taperMode,
    taperFactor: current.taperFactor,
    createdAt: current.createdAt,
    updatedAt: now
  };
}

function mergeManualBalances(existing: ManualBalance[], incoming: ManualBalance[], now: string, replaceImportId: string | undefined, newImportId: string, latestOnly: boolean): ManualBalance[] {
  const result = [...existing];
  for (const balance of incoming) {
    const incomingHash = balance.source.sourceRecordHash;
    const existingIndex = result.findIndex((item) => item.id === balance.id || (incomingHash && item.source.sourceRecordHash === incomingHash));
    if (existingIndex === -1) {
      result.push(balance);
      continue;
    }

    const current = result[existingIndex];
    if (current.userModified) {
      if (replaceImportId && current.source.importId === replaceImportId) {
        result[existingIndex] = { ...current, source: { ...current.source, importId: newImportId, provider: balance.source.provider }, updatedAt: now };
      }
      continue;
    }

    if (latestOnly && balance.asOfDate < current.asOfDate && current.source.importId !== replaceImportId) continue;
    result[existingIndex] = mergeImportedBalance(current, balance, now);
  }
  return result;
}

function mergePriceSnapshots(existing: PriceSnapshot[], incoming: PriceSnapshot[]): PriceSnapshot[] {
  const result = [...existing];
  for (const price of incoming) {
    const index = result.findIndex((item) => item.id === price.id || (item.instrumentId === price.instrumentId && item.asOfDate === price.asOfDate && item.source === price.source));
    if (index === -1) result.push(price);
    else result[index] = price;
  }
  return result;
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const map = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}

function hashMatches(hash: string | undefined, hashes: Set<string>): boolean {
  return Boolean(hash && hashes.has(hash));
}

function cloneBackup(backup: PortfolioBackup): PortfolioBackup {
  return JSON.parse(JSON.stringify(backup)) as PortfolioBackup;
}
