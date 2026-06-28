import { calculatePortfolioSummary } from "@/src/domain/analytics";
import { reconcileManualTransactionPositions } from "@/src/domain/manualTransactionPositions";
import { parseManualCsv, type ManualCsvResult } from "@/src/importers/manualCsv";
import type { ImportRun, PortfolioBackup, SourceDocument } from "@/src/schema/backup";

export type CommitOptions = {
  importId: string;
  fileName?: string;
  now?: string;
  label?: string;
};

export type CommitResult = {
  backup: PortfolioBackup;
  errors: ReturnType<typeof parseManualCsv>["errors"];
  addedBalances: number;
  addedTransactions: number;
  addedPrices: number;
  skippedDuplicates: number;
};


export type ManualImportPreview = {
  errors: CommitResult["errors"];
  incoming: { balances: number; transactions: number; prices: number };
  effective: { addedBalances: number; updatedBalances: number; addedTransactions: number; addedPrices: number; skippedDuplicates: number };
  before: { holdings: number; transactions: number; netWorth: number };
  after: { holdings: number; transactions: number; netWorth: number };
  deltas: { holdings: number; transactions: number; netWorth: number };
  rows: Array<{ label: string; action: "add" | "update" | "duplicate" | "error"; kind: "holding" | "transaction" | "price"; detail: string }>;
};

export function previewManualCsvImport(backup: PortfolioBackup, csv: string, options: CommitOptions): ManualImportPreview {
  const now = options.now ?? new Date().toISOString();
  const parsed = parseManualCsv(csv, { importId: options.importId, now });
  const committed = commitManualParsedImport(backup, parsed, { ...options, now, provider: "manual_csv", mimeType: "text/csv" });
  const beforeSummary = calculatePortfolioSummary(backup);
  const afterSummary = calculatePortfolioSummary(committed.backup);
  const rows = buildPreviewRows(backup, parsed);
  const updatedBalances = rows.filter((row) => row.kind === "holding" && row.action === "update").length;
  return {
    errors: committed.errors,
    incoming: { balances: parsed.manualBalances.length, transactions: parsed.transactions.length, prices: parsed.priceSnapshots.length },
    effective: { addedBalances: committed.addedBalances, updatedBalances, addedTransactions: committed.addedTransactions, addedPrices: committed.addedPrices, skippedDuplicates: committed.skippedDuplicates },
    before: { holdings: backup.manualBalances.length, transactions: backup.transactions.length, netWorth: beforeSummary.netWorth },
    after: { holdings: committed.backup.manualBalances.length, transactions: committed.backup.transactions.length, netWorth: afterSummary.netWorth },
    deltas: { holdings: committed.backup.manualBalances.length - backup.manualBalances.length, transactions: committed.backup.transactions.length - backup.transactions.length, netWorth: roundMoney(afterSummary.netWorth - beforeSummary.netWorth) },
    rows
  };
}

export function commitManualCsvImport(backup: PortfolioBackup, csv: string, options: CommitOptions): CommitResult {
  const now = options.now ?? new Date().toISOString();
  const parsed = parseManualCsv(csv, { importId: options.importId, now });
  return commitManualParsedImport(backup, parsed, { ...options, now, provider: "manual_csv", mimeType: "text/csv" });
}

function commitManualParsedImport(backup: PortfolioBackup, parsed: ManualCsvResult, options: CommitOptions & { now: string; provider: string; mimeType: string }): CommitResult {
  const now = options.now;
  const next: PortfolioBackup = cloneBackup(backup);

  for (const account of parsed.accounts) {
    if (!next.accounts.some((existing) => existing.id === account.id)) next.accounts.push(account);
  }

  for (const instrument of parsed.instruments) {
    if (!next.instruments.some((existing) => existing.id === instrument.id)) next.instruments.push(instrument);
  }

  let addedBalances = 0;
  let addedTransactions = 0;
  let addedPrices = 0;
  let skippedDuplicates = 0;

  for (const tx of parsed.transactions) {
    const incomingHash = tx.source.sourceRecordHash;
    const exists = next.transactions.some((existing) => incomingHash && existing.source.sourceRecordHash === incomingHash);
    if (exists) { skippedDuplicates += 1; continue; }
    next.transactions.push(tx);
    addedTransactions += 1;
  }

  for (const price of parsed.priceSnapshots) {
    const exists = next.priceSnapshots.some((existing) => existing.id === price.id || (existing.instrumentId === price.instrumentId && existing.asOfDate === price.asOfDate && existing.source === price.source));
    if (exists) { skippedDuplicates += 1; continue; }
    next.priceSnapshots.push(price);
    addedPrices += 1;
  }

  for (const balance of parsed.manualBalances) {
    const incomingHash = balance.source.sourceRecordHash;
    const existingIndex = next.manualBalances.findIndex(
      (existing) => existing.source.sourceRecordHash && existing.source.sourceRecordHash === incomingHash
    );

    if (existingIndex === -1) {
      next.manualBalances.push(balance);
      addedBalances += 1;
      continue;
    }

    skippedDuplicates += 1;
    const existing = next.manualBalances[existingIndex];
    if (!existing.userModified) {
      next.manualBalances[existingIndex] = {
        ...balance,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now
      };
    }
  }

  const importRun: ImportRun = {
    id: options.importId,
    provider: options.provider,
    fileName: options.fileName,
    label: options.label,
    status: parsed.errors.length === 0 ? "committed" : "failed",
    confidence: "high",
    createdAt: now,
    committedAt: parsed.errors.length === 0 ? now : undefined,
    notes: parsed.errors.length === 0 ? undefined : `${parsed.errors.length} row(s) rejected`
  };
  next.imports.push(importRun);

  if (options.fileName) {
    const sourceDocument: SourceDocument = {
      id: `doc_${options.importId}`,
      importId: options.importId,
      fileName: options.fileName,
      mimeType: options.mimeType,
      addedAt: now
    };
    next.sourceDocuments.push(sourceDocument);
  }

  next.exportedAt = now;
  const reconciled = reconcileManualTransactionPositions(next, now);

  return {
    backup: reconciled,
    errors: parsed.errors,
    addedBalances,
    addedTransactions,
    addedPrices,
    skippedDuplicates
  };
}

function buildPreviewRows(backup: PortfolioBackup, parsed: ManualCsvResult): ManualImportPreview["rows"] {
  const rows: ManualImportPreview["rows"] = [];
  for (const balance of parsed.manualBalances) {
    const existing = backup.manualBalances.find((item) => item.source.sourceRecordHash && item.source.sourceRecordHash === balance.source.sourceRecordHash);
    rows.push({ label: balance.label, kind: "holding", action: existing ? (existing.userModified ? "duplicate" : "update") : "add", detail: existing ? (existing.userModified ? "Existing user-edited holding will be preserved." : "Existing holding will be refreshed from this row.") : "New holding will be added." });
  }
  for (const tx of parsed.transactions) {
    const existing = backup.transactions.find((item) => item.source.sourceRecordHash && item.source.sourceRecordHash === tx.source.sourceRecordHash);
    rows.push({ label: tx.instrumentId, kind: "transaction", action: existing ? "duplicate" : "add", detail: existing ? "Duplicate transaction will be skipped." : "New transaction will be added." });
  }
  for (const price of parsed.priceSnapshots) {
    const existing = backup.priceSnapshots.find((item) => item.id === price.id || (item.instrumentId === price.instrumentId && item.asOfDate === price.asOfDate && item.source === price.source));
    rows.push({ label: price.instrumentId, kind: "price", action: existing ? "duplicate" : "add", detail: existing ? "Duplicate price row will be skipped." : "New price snapshot will be added." });
  }
  for (const error of parsed.errors) rows.push({ label: "Row " + error.row, kind: "holding", action: "error", detail: error.message });
  return rows;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function cloneBackup(backup: PortfolioBackup): PortfolioBackup {
  return JSON.parse(JSON.stringify(backup)) as PortfolioBackup;
}
