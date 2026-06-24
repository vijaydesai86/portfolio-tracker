import type { Account, ManualBalance, PortfolioBackup, Transaction } from "@/src/schema/backup";

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
  const deleted = backup.transactions.find((tx) => tx.id === transactionId);
  const relatedBalance = deleted ? findBalanceForTransaction(backup, deleted) : undefined;
  const relatedAccount = relatedBalance ? backup.accounts.find((account) => account.id === relatedBalance.accountId) : undefined;
  const transactionsWithoutDeleted = backup.transactions.filter((tx) => tx.id !== transactionId);
  const openingTransactionIds = deleted && relatedBalance && deleted.source.provider === "manual_entry"
    ? openingTransactionsToDelete(transactionsWithoutDeleted, relatedBalance)
    : new Set<string>();
  const nextTransactions = openingTransactionIds.size === 0 ? transactionsWithoutDeleted : transactionsWithoutDeleted.filter((tx) => !openingTransactionIds.has(tx.id));
  const reconciledBalance = deleted && relatedBalance && relatedAccount && deleted.source.provider === "manual_entry"
    ? reverseManualEntryBalance(relatedBalance, relatedAccount, deleted, now)
    : undefined;

  return pruneOrphans({
    ...backup,
    exportedAt: now,
    transactions: nextTransactions,
    manualBalances: reconciledBalance ? backup.manualBalances.map((balance) => balance.id === reconciledBalance.id ? reconciledBalance : balance) : backup.manualBalances
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

function findBalanceForTransaction(backup: PortfolioBackup, tx: Transaction): ManualBalance | undefined {
  return backup.manualBalances.find((balance) => balance.accountId === tx.accountId && (balance.instrumentId ? balance.instrumentId === tx.instrumentId : !tx.instrumentId));
}

function openingTransactionsToDelete(transactions: Transaction[], balance: ManualBalance): Set<string> {
  const related = transactions.filter((tx) => tx.accountId === balance.accountId && (balance.instrumentId ? tx.instrumentId === balance.instrumentId : !tx.instrumentId));
  const nonOpening = related.filter((tx) => tx.source.provider !== "manual_entry_opening");
  if (nonOpening.length > 0) return new Set();
  return new Set(related.filter((tx) => tx.source.provider === "manual_entry_opening").map((tx) => tx.id));
}

function reverseManualEntryBalance(balance: ManualBalance, account: Account, tx: Transaction, now: string): ManualBalance {
  const quantity = Math.abs(tx.quantity ?? 0);
  const amount = Math.abs(tx.amount);
  const nextQuantity = reverseQuantity(balance.quantity, tx.type, quantity);
  const nextPrice = balance.price;
  const nextValue = isMarketLike(account.type) && nextQuantity !== undefined && nextPrice !== undefined
    ? roundMoney(Math.max(0, nextQuantity) * nextPrice)
    : roundMoney(Math.max(0, balance.value + reverseValueDelta(tx.type, amount)));

  return {
    ...balance,
    quantity: nextQuantity,
    value: nextValue,
    asOfDate: balance.asOfDate,
    source: { ...balance.source, provider: "manual_entry" },
    userModified: true,
    updatedAt: now
  };
}

function reverseQuantity(current: number | undefined, type: Transaction["type"], quantity: number): number | undefined {
  if (quantity <= 0 || !quantityChangingTypes.has(type)) return current;
  const base = current ?? 0;
  if (cashInTypes.has(type)) return roundQuantity(Math.max(0, base - quantity));
  if (lotOutTypes.has(type)) return roundQuantity(base + quantity);
  return current;
}

function reverseValueDelta(type: Transaction["type"], amount: number): number {
  if (cashInTypes.has(type) || interestTypes.has(type)) return -amount;
  if (lotOutTypes.has(type)) return amount;
  return 0;
}


function isMarketLike(type: Account["type"]): boolean {
  return type === "mutual_fund" || type === "indian_stock" || type === "us_stock" || type === "nps" || type === "gold";
}

function isFxSnapshot(instrumentId: string): boolean {
  return /^[A-Z]{6}$/.test(instrumentId);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 100000000) / 100000000;
}

const cashInTypes = new Set<Transaction["type"]>(["buy", "sip", "deposit", "contribution", "switch_in"]);
const lotOutTypes = new Set<Transaction["type"]>(["sell", "redemption", "switch_out", "withdrawal", "maturity"]);
const interestTypes = new Set<Transaction["type"]>(["interest_accrual", "interest"]);
const quantityChangingTypes = new Set<Transaction["type"]>([...cashInTypes, ...lotOutTypes]);
