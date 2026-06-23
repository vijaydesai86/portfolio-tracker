import { parseManualCsv, parseManualWorkbook, type ManualCsvResult } from "@/src/importers/manualCsv";
import type { ImportRun, PortfolioBackup, SourceDocument } from "@/src/schema/backup";

export type CommitOptions = {
  importId: string;
  fileName?: string;
  now?: string;
};

export type CommitResult = {
  backup: PortfolioBackup;
  errors: ReturnType<typeof parseManualCsv>["errors"];
  addedBalances: number;
  addedTransactions: number;
  addedPrices: number;
  skippedDuplicates: number;
};

export function commitManualCsvImport(backup: PortfolioBackup, csv: string, options: CommitOptions): CommitResult {
  const now = options.now ?? new Date().toISOString();
  const parsed = parseManualCsv(csv, { importId: options.importId, now });
  return commitManualParsedImport(backup, parsed, { ...options, now, provider: "manual_csv", mimeType: "text/csv" });
}

export async function commitManualWorkbookImport(backup: PortfolioBackup, file: File, options: CommitOptions): Promise<CommitResult> {
  const now = options.now ?? new Date().toISOString();
  const parsed = await parseManualWorkbook(file, { importId: options.importId, now });
  return commitManualParsedImport(backup, parsed, { ...options, now, fileName: options.fileName ?? file.name, provider: "manual_workbook", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
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

  return {
    backup: next,
    errors: parsed.errors,
    addedBalances,
    addedTransactions,
    addedPrices,
    skippedDuplicates
  };
}

function cloneBackup(backup: PortfolioBackup): PortfolioBackup {
  return JSON.parse(JSON.stringify(backup)) as PortfolioBackup;
}
