import { parseManualCsv } from "@/src/importers/manualCsv";
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
  skippedDuplicates: number;
};

export function commitManualCsvImport(backup: PortfolioBackup, csv: string, options: CommitOptions): CommitResult {
  const now = options.now ?? new Date().toISOString();
  const parsed = parseManualCsv(csv, { importId: options.importId, now });
  const next: PortfolioBackup = cloneBackup(backup);

  for (const account of parsed.accounts) {
    if (!next.accounts.some((existing) => existing.id === account.id)) {
      next.accounts.push(account);
    }
  }

  let addedBalances = 0;
  let skippedDuplicates = 0;

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
    provider: "manual_csv",
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
      mimeType: "text/csv",
      addedAt: now
    };
    next.sourceDocuments.push(sourceDocument);
  }

  next.exportedAt = now;

  return {
    backup: next,
    errors: parsed.errors,
    addedBalances,
    skippedDuplicates
  };
}

function cloneBackup(backup: PortfolioBackup): PortfolioBackup {
  return JSON.parse(JSON.stringify(backup)) as PortfolioBackup;
}
