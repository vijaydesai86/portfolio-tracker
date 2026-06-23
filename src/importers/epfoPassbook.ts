import { stableHash, slugId } from "@/src/domain/hash";
import type { Account, ImportRun, Instrument, ManualBalance, PortfolioBackup, SourceDocument, Transaction } from "@/src/schema/backup";

export type EpfoBalanceBucket = {
  key: "employee" | "employer" | "pension";
  label: string;
  value: number;
};

export type EpfoContributionBucket = EpfoBalanceBucket;
export type EpfoInterestBucket = EpfoBalanceBucket;

export type EpfoPassbookParseResult = {
  statementType: "epfo_passbook";
  asOfDate: string;
  balances: EpfoBalanceBucket[];
  yearlyContributions: EpfoContributionBucket[];
  yearlyInterest: EpfoInterestBucket[];
  warnings: string[];
  errors: string[];
};

export type EpfoCanonicalImport = {
  accounts: Account[];
  instruments: Instrument[];
  transactions: Transaction[];
  manualBalances: ManualBalance[];
  importRun: ImportRun;
  sourceDocument?: SourceDocument;
};

const bucketLabels: Record<EpfoBalanceBucket["key"], string> = {
  employee: "EPF Employee Share",
  employer: "EPF Employer Share",
  pension: "EPS Pension Share"
};

export function parseEpfoPassbookText(text: string): EpfoPassbookParseResult {
  const lines = text.replace(/\f/g, "\n").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const warnings: string[] = [];
  const errors: string[] = [];
  const closingIndexes = lines.map((line, index) => /Closing Balance as on/i.test(line) ? index : -1).filter((index) => index >= 0);
  if (closingIndexes.length === 0) return emptyResult(["No EPFO closing balance marker found."]);

  const closingIndex = selectPassbookClosingIndex(lines, closingIndexes);
  const asOfDate = parseSlashDate(lines[closingIndex]) ?? parseSlashDate(lines[closingIndex - 1] ?? "") ?? new Date().toISOString().slice(0, 10);
  const inlineBalances = amountTokensAfterDate(lines[closingIndex]).slice(-3);
  const balanceAmounts = inlineBalances.length >= 3 ? inlineBalances : previousAmountLines(lines, closingIndex, 3);
  if (balanceAmounts.length < 3) errors.push("Unable to parse employee/employer/pension closing balances.");

  const balances = toBuckets(balanceAmounts.slice(-3));
  const contributionIndex = lastIndexMatching(lines, /Total Contributions for the year/i, closingIndex);
  const inlineContributions = contributionIndex === -1 ? [] : amountTokensAfterBracket(lines[contributionIndex]).slice(-3);
  const contributionAmounts = contributionIndex === -1 ? [] : inlineContributions.length >= 3 ? inlineContributions : nextAmountLines(lines, contributionIndex, 3);
  if (contributionIndex === -1) warnings.push("No annual contribution total found in EPFO passbook.");
  const yearlyContributions = toBuckets(contributionAmounts.slice(0, 3));

  const withdrawalIndex = lastIndexMatching(lines, /Total Withdrawals for the year/i, closingIndex);
  const amountsAfterWithdrawals = withdrawalIndex === -1 ? [] : amountLinesBetween(lines, withdrawalIndex + 1, closingIndex);
  const interestAmounts = amountsAfterWithdrawals.length >= 9 ? amountsAfterWithdrawals.slice(-6, -3) : [];
  const yearlyInterest = toBuckets(interestAmounts);

  return { statementType: "epfo_passbook", asOfDate, balances, yearlyContributions, yearlyInterest, warnings, errors };
}

export function buildCanonicalEpfoImport(parsed: EpfoPassbookParseResult, options: { importId: string; fileName?: string; sourceSha256?: string; now?: string }): EpfoCanonicalImport {
  const now = options.now ?? new Date().toISOString();
  const accountId = "acct_epfo_pf";
  const account: Account = { id: accountId, name: "EPFO Provident Fund", institution: "EPFO", type: "epf", currency: "INR", createdAt: now, updatedAt: now };

  const instruments = parsed.balances.map((bucket): Instrument => ({
    id: slugId("inst", ["epfo", bucket.key]),
    name: bucket.label,
    type: "epf",
    currency: "INR",
    country: "IN",
    category: "Debt",
    issuer: "EPFO",
    createdAt: now,
    updatedAt: now
  }));

  const manualBalances = parsed.balances.map((bucket): ManualBalance => {
    const instrument = instruments.find((item) => item.name === bucket.label)!;
    const sourceRecordHash = stableHash({ provider: "epfo_passbook", balance: bucket, asOfDate: parsed.asOfDate });
    return {
      id: slugId("bal", ["epfo", bucket.key]),
      accountId,
      instrumentId: instrument.id,
      label: bucket.label,
      category: "Debt",
      currency: "INR",
      value: bucket.value,
      asOfDate: parsed.asOfDate,
      notes: "EPFO passbook closing balance.",
      source: { type: "import", importId: options.importId, provider: "epfo_passbook", sourceRecordHash },
      userModified: false,
      createdAt: now,
      updatedAt: now
    };
  });

  const contributionTransactions = parsed.yearlyContributions.filter((bucket) => bucket.value > 0).map((bucket): Transaction => {
    const instrument = instruments.find((item) => item.name === bucket.label)!;
    const sourceRecordHash = stableHash({ provider: "epfo_passbook", contribution: bucket, asOfDate: parsed.asOfDate });
    return {
      id: slugId("txn", [sourceRecordHash]),
      accountId,
      instrumentId: instrument.id,
      date: parsed.asOfDate,
      type: "contribution",
      amount: bucket.value,
      currency: "INR",
      fees: 0,
      taxes: 0,
      source: { type: "import", importId: options.importId, provider: "epfo_passbook", sourceRecordHash },
      userModified: false,
      createdAt: now,
      updatedAt: now
    };
  });

  const interestTransactions = parsed.yearlyInterest.filter((bucket) => bucket.value > 0).map((bucket): Transaction => {
    const instrument = instruments.find((item) => item.name === bucket.label)!;
    const sourceRecordHash = stableHash({ provider: "epfo_passbook", interestAccrual: bucket, asOfDate: parsed.asOfDate });
    return {
      id: slugId("txn", [sourceRecordHash]),
      accountId,
      instrumentId: instrument.id,
      date: parsed.asOfDate,
      type: "interest_accrual",
      amount: bucket.value,
      currency: "INR",
      fees: 0,
      taxes: 0,
      source: { type: "import", importId: options.importId, provider: "epfo_passbook", sourceRecordHash },
      userModified: false,
      createdAt: now,
      updatedAt: now
    };
  });

  const transactions = [...contributionTransactions, ...interestTransactions];

  const importRun: ImportRun = {
    id: options.importId,
    provider: "epfo_passbook",
    fileName: options.fileName,
    status: parsed.errors.length > 0 ? "failed" : "staged",
    confidence: parsed.errors.length > 0 ? "low" : "medium",
    createdAt: now,
    notes: parsed.balances.length + " PF balance buckets, " + contributionTransactions.length + " yearly contribution rows, " + interestTransactions.length + " interest accrual rows"
  };

  const sourceDocument: SourceDocument | undefined = options.fileName ? {
    id: slugId("src", [options.importId, options.fileName]),
    importId: options.importId,
    fileName: options.fileName,
    mimeType: "application/pdf",
    sha256: options.sourceSha256,
    addedAt: now
  } : undefined;

  return { accounts: [account], instruments, transactions, manualBalances, importRun, sourceDocument };
}

export function applyCanonicalEpfoImport(base: PortfolioBackup, imported: EpfoCanonicalImport): PortfolioBackup {
  const now = new Date().toISOString();
  return {
    ...base,
    exportedAt: now,
    accounts: mergeById(base.accounts, imported.accounts),
    instruments: mergeById(base.instruments, imported.instruments),
    transactions: mergeById(base.transactions, imported.transactions),
    manualBalances: mergeLatestManualBalances(base.manualBalances, imported.manualBalances),
    imports: mergeById(base.imports, [{ ...imported.importRun, status: "committed", committedAt: now }]),
    sourceDocuments: imported.sourceDocument ? mergeById(base.sourceDocuments, [imported.sourceDocument]) : base.sourceDocuments
  };
}

function toBuckets(values: number[]): EpfoBalanceBucket[] {
  const keys: EpfoBalanceBucket["key"][] = ["employee", "employer", "pension"];
  return values.map((value, index) => ({ key: keys[index], label: bucketLabels[keys[index]], value })).filter((bucket) => bucket.key !== undefined && Number.isFinite(bucket.value));
}

function selectPassbookClosingIndex(lines: string[], closingIndexes: number[]): number {
  const nonTaxable = closingIndexes.find((closingIndex) => {
    const start = Math.max(0, lastIndexMatching(lines, /EPF Passbook|Member Passbook/i, closingIndex));
    const segment = lines.slice(start, closingIndex + 1).join(" ");
    return !/Taxable Data/i.test(segment);
  });
  return nonTaxable ?? closingIndexes[0];
}

function previousAmountLines(lines: string[], beforeIndex: number, count: number): number[] {
  const values: number[] = [];
  for (let index = beforeIndex - 1; index >= 0 && values.length < count; index--) {
    const value = parseAmountLine(lines[index]);
    if (value !== undefined) values.unshift(value);
  }
  return values;
}

function nextAmountLines(lines: string[], afterIndex: number, count: number): number[] {
  const values: number[] = [];
  for (let index = afterIndex + 1; index < lines.length && values.length < count; index++) {
    if (/Total |Closing Balance|Int\. Updated/i.test(lines[index])) break;
    const value = parseAmountLine(lines[index]);
    if (value !== undefined) values.push(value);
  }
  return values;
}

function amountLinesBetween(lines: string[], startIndex: number, endIndex: number): number[] {
  const values: number[] = [];
  for (let index = startIndex; index < endIndex; index++) {
    const value = parseAmountLine(lines[index]);
    if (value !== undefined) values.push(value);
  }
  return values;
}

function parseAmountLine(line: string): number | undefined {
  if (!/^[\d,]+(?:\.\d+)?$/.test(line)) return undefined;
  return parseAmountToken(line);
}

function groupedAmountTokens(line: string): number[] {
  return [...line.matchAll(/\b\d{1,3}(?:,\d{2,3})+(?:\.\d+)?\b/g)]
    .map((match) => parseAmountToken(match[0]))
    .filter((value): value is number => value !== undefined);
}

function amountTokensAfterDate(line: string): number[] {
  const withoutDate = line.replace(/^.*?\d{2}\/\d{2}\/\d{4}/, "");
  return amountTokens(withoutDate);
}

function amountTokensAfterBracket(line: string): number[] {
  const bracketIndex = line.lastIndexOf("]");
  return amountTokens(bracketIndex === -1 ? line : line.slice(bracketIndex + 1));
}

function amountTokens(line: string): number[] {
  return [...line.matchAll(/\b\d{1,3}(?:,\d{2,3})*(?:\.\d+)?\b|\b\d+(?:\.\d+)?\b/g)]
    .map((match) => parseAmountToken(match[0]))
    .filter((value): value is number => value !== undefined);
}

function parseAmountToken(token: string): number | undefined {
  const parsed = Number(token.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseSlashDate(line: string): string | undefined {
  const match = line.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return undefined;
  return match[3] + "-" + match[2] + "-" + match[1];
}

function lastIndexMatching(lines: string[], regex: RegExp, beforeIndex: number): number {
  for (let index = beforeIndex - 1; index >= 0; index--) {
    if (regex.test(lines[index])) return index;
  }
  return -1;
}

function emptyResult(errors: string[]): EpfoPassbookParseResult {
  return { statementType: "epfo_passbook", asOfDate: "", balances: [], yearlyContributions: [], yearlyInterest: [], warnings: [], errors };
}

function mergeLatestManualBalances(existing: ManualBalance[], incoming: ManualBalance[]): ManualBalance[] {
  const map = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) {
    const current = map.get(item.id);
    if (!current) {
      map.set(item.id, item);
      continue;
    }
    if (current.userModified) continue;
    if (item.asOfDate >= current.asOfDate) map.set(item.id, item);
  }
  return [...map.values()];
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const map = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}
