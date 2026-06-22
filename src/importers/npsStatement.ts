import { stableHash, slugId } from "@/src/domain/hash";
import type { Account, AssetCategory, ImportRun, Instrument, ManualBalance, PortfolioBackup, PriceSnapshot, SourceDocument, Transaction } from "@/src/schema/backup";

export type NpsSchemeHolding = {
  schemeName: string;
  value: number;
  units: number;
  nav: number;
  navDate: string;
  category: AssetCategory;
};

export type NpsTransactionRow = {
  schemeName: string;
  date: string;
  description: string;
  amount?: number;
  nav?: number;
  units?: number;
  type: Transaction["type"];
};

export type NpsContributionRow = {
  date: string;
  particulars: string;
  uploadedBy: string;
  employeeContribution: number;
  employerContribution: number;
  total: number;
};

export type NpsParseResult = {
  statementType: "nps_statement";
  accountTier: "Tier I" | "Tier II" | "Unknown";
  asOfDate: string;
  holdings: NpsSchemeHolding[];
  contributionRows: NpsContributionRow[];
  transactions: NpsTransactionRow[];
  warnings: string[];
  errors: string[];
};

export type NpsCanonicalImport = {
  accounts: Account[];
  instruments: Instrument[];
  transactions: Transaction[];
  manualBalances: ManualBalance[];
  priceSnapshots: PriceSnapshot[];
  importRun: ImportRun;
  sourceDocument?: SourceDocument;
};

export function parseNpsCsv(text: string): NpsParseResult {
  const rows = text.replace(/^\uFEFF/, "").split(/\r?\n/).map(parseCsvLine);
  const warnings: string[] = [];
  const errors: string[] = [];
  const firstLine = rows.find((row) => row.some(Boolean))?.join(" ") ?? "";
  const accountTier = /tier\s*ii/i.test(firstLine) ? "Tier II" : /tier\s*i/i.test(firstLine) ? "Tier I" : "Unknown";
  const asOfDate = parseAsOfDate(rows) ?? new Date().toISOString().slice(0, 10);
  const holdings = parseHoldings(rows, asOfDate);
  const contributionRows = parseContributionRows(rows);
  const transactions = parseTransactions(rows);

  if (holdings.length === 0) errors.push("No NPS scheme-wise holdings found.");
  if (transactions.length === 0) warnings.push("No NPS scheme transaction rows found.");

  return { statementType: "nps_statement", accountTier, asOfDate, holdings, contributionRows, transactions, warnings, errors };
}

export function buildCanonicalNpsImport(parsed: NpsParseResult, options: { importId: string; fileName?: string; sourceSha256?: string; now?: string }): NpsCanonicalImport {
  const now = options.now ?? new Date().toISOString();
  const accountId = slugId("acct", ["nps", parsed.accountTier]);
  const account: Account = { id: accountId, name: "NPS " + parsed.accountTier, institution: "NPS", type: "nps", currency: "INR", createdAt: now, updatedAt: now };

  const instruments = parsed.holdings.map((holding): Instrument => ({
    id: slugId("inst", ["nps", holding.schemeName]),
    name: holding.schemeName,
    type: "nps",
    currency: "INR",
    country: "IN",
    category: holding.category,
    issuer: issuerFromScheme(holding.schemeName),
    createdAt: now,
    updatedAt: now
  }));

  const manualBalances = parsed.holdings.map((holding): ManualBalance => {
    const instrument = instruments.find((item) => item.name === holding.schemeName)!;
    const sourceRecordHash = stableHash({ provider: "nps_statement", holding, asOfDate: parsed.asOfDate });
    return {
      id: slugId("bal", ["nps", holding.schemeName]),
      accountId,
      instrumentId: instrument.id,
      label: holding.schemeName,
      category: holding.category,
      currency: "INR",
      value: holding.value,
      quantity: holding.units,
      price: holding.nav,
      asOfDate: parsed.asOfDate,
      notes: "NPS scheme-wise statement holding.",
      source: { type: "import", importId: options.importId, provider: "nps_statement", sourceRecordHash },
      userModified: false,
      createdAt: now,
      updatedAt: now
    };
  });

  const transactions = parsed.transactions.flatMap((row): Transaction[] => {
    const instrument = instruments.find((item) => item.name === row.schemeName);
    if (!instrument || row.amount === undefined || row.amount === 0) return [];
    const sourceRecordHash = stableHash({ provider: "nps_statement", row });
    return [{
      id: slugId("txn", [sourceRecordHash]),
      accountId,
      instrumentId: instrument.id,
      date: row.date,
      type: row.type,
      quantity: row.units === undefined ? undefined : Math.abs(row.units),
      price: row.nav,
      amount: Math.abs(row.amount),
      currency: "INR",
      fees: row.type === "fee" ? Math.abs(row.amount) : 0,
      taxes: 0,
      source: { type: "import", importId: options.importId, provider: "nps_statement", sourceRecordHash },
      userModified: false,
      createdAt: now,
      updatedAt: now
    }];
  });

  const priceSnapshots = parsed.holdings.filter((holding) => holding.nav > 0).map((holding): PriceSnapshot => {
    const instrument = instruments.find((item) => item.name === holding.schemeName)!;
    return { id: slugId("price", [instrument.id, holding.navDate, String(holding.nav)]), instrumentId: instrument.id, price: holding.nav, currency: "INR", asOfDate: holding.navDate, source: "nps_statement", createdAt: now };
  });

  const importRun: ImportRun = {
    id: options.importId,
    provider: "nps_statement",
    fileName: options.fileName,
    status: parsed.errors.length > 0 ? "failed" : "staged",
    confidence: parsed.errors.length > 0 ? "low" : "medium",
    createdAt: now,
    notes: parsed.holdings.length + " NPS scheme holdings, " + transactions.length + " scheme transactions"
  };

  const sourceDocument: SourceDocument | undefined = options.fileName ? { id: slugId("src", [options.importId, options.fileName]), importId: options.importId, fileName: options.fileName, mimeType: "text/csv", sha256: options.sourceSha256, addedAt: now } : undefined;

  return { accounts: [account], instruments, transactions, manualBalances, priceSnapshots, importRun, sourceDocument };
}

export function applyCanonicalNpsImport(base: PortfolioBackup, imported: NpsCanonicalImport): PortfolioBackup {
  const now = new Date().toISOString();
  return {
    ...base,
    exportedAt: now,
    accounts: mergeById(base.accounts, imported.accounts),
    instruments: mergeById(base.instruments, imported.instruments),
    transactions: mergeById(base.transactions, imported.transactions),
    manualBalances: mergeById(base.manualBalances, imported.manualBalances),
    priceSnapshots: mergeById(base.priceSnapshots, imported.priceSnapshots),
    imports: mergeById(base.imports, [{ ...imported.importRun, status: "committed", committedAt: now }]),
    sourceDocuments: imported.sourceDocument ? mergeById(base.sourceDocuments, [imported.sourceDocument]) : base.sourceDocuments
  };
}

function parseHoldings(rows: string[][], fallbackDate: string): NpsSchemeHolding[] {
  const headerIndex = rows.findIndex((row) => row[0] === "Particulars" && row.some((cell) => /Scheme wise Value/i.test(cell)));
  if (headerIndex === -1) return [];
  const navDate = rows[headerIndex].map((cell) => parseDateFromText(cell)).find(Boolean) ?? fallbackDate;
  const holdings: NpsSchemeHolding[] = [];
  for (let index = headerIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    const name = row[0]?.trim();
    if (!name) continue;
    if (/Contribution\/Redemption Details|Transaction Details/i.test(name)) break;
    const value = parseMoney(row[1]);
    const units = parseMoney(row[2]);
    const nav = parseMoney(row[3]);
    if (!/scheme/i.test(name) || value === undefined || units === undefined || nav === undefined) continue;
    holdings.push({ schemeName: name, value, units, nav, navDate, category: inferNpsCategory(name) });
  }
  return holdings;
}

function parseContributionRows(rows: string[][]): NpsContributionRow[] {
  const headerIndex = rows.findIndex((row) => row[0] === "Date" && row.some((cell) => /Employee Contribution/i.test(cell)));
  if (headerIndex === -1) return [];
  const result: NpsContributionRow[] = [];
  for (let index = headerIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    if (!row[0]) continue;
    if (/Transaction Details/i.test(row[0])) break;
    const date = parseNpsDate(row[0]);
    if (!date) continue;
    result.push({ date, particulars: row[1] ?? "", uploadedBy: row[2] ?? "", employeeContribution: parseMoney(row[3]) ?? 0, employerContribution: parseMoney(row[4]) ?? 0, total: parseMoney(row[5]) ?? 0 });
  }
  return result;
}

function parseTransactions(rows: string[][]): NpsTransactionRow[] {
  const transactions: NpsTransactionRow[] = [];
  let schemeName = "";
  let inSchemeTable = false;
  for (const row of rows) {
    if (row[0] && /scheme/i.test(row[0]) && row.length === 1) {
      schemeName = row[0];
      inSchemeTable = false;
      continue;
    }
    if (schemeName && row[0] === "Date" && row[1] === "Description") {
      inSchemeTable = true;
      continue;
    }
    if (!inSchemeTable) continue;
    const date = parseNpsDate(row[0]);
    if (!date) continue;
    const description = row[1] ?? "";
    if (/Opening balance|Closing Balance/i.test(description)) continue;
    const amount = parseMoney(row[2]);
    const nav = parseMoney(row[3]);
    const units = parseMoney(row[4]);
    transactions.push({ schemeName, date, description, amount, nav, units, type: inferNpsTransactionType(description, amount) });
  }
  return transactions;
}

function parseAsOfDate(rows: string[][]): string | undefined {
  for (const row of rows) {
    const joined = row.join(" ");
    const parsed = parseDateFromText(joined);
    if (parsed) return parsed;
  }
  return undefined;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index++;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseMoney(value: string | undefined): number | undefined {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const negative = /^\(.+\)$/.test(text);
  const cleaned = text.replace(/^Rs\s*/i, "").replace(/[(),]/g, "").trim();
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return undefined;
  return negative ? -parsed : parsed;
}

function parseDateFromText(value: string): string | undefined {
  const match = value.match(/(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{4})/);
  if (!match) return undefined;
  return match[3] + "-" + monthNumber(match[2]) + "-" + match[1].padStart(2, "0");
}

function parseNpsDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return parseDateFromText(value);
}

function monthNumber(value: string): string {
  const key = value.slice(0, 3).toLowerCase();
  const months: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  return months[key] ?? "01";
}

function inferNpsCategory(name: string): AssetCategory {
  const value = name.toLowerCase();
  if (/scheme\s*e\b/.test(value)) return "Equity";
  if (/scheme\s*[cg]\b/.test(value)) return "Debt";
  if (/scheme\s*a\b/.test(value)) return "Others";
  return "Others";
}

function inferNpsTransactionType(description: string, amount: number | undefined): Transaction["type"] {
  const value = description.toLowerCase();
  if (value.includes("billing") || value.includes("charge")) return "fee";
  if (value.includes("redemption") || value.includes("withdraw")) return "redemption";
  if ((amount ?? 0) < 0) return "fee";
  return "contribution";
}

function issuerFromScheme(name: string): string | undefined {
  return name.match(/^(.+?)\s+SCHEME\b/i)?.[1]?.trim();
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const map = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}
