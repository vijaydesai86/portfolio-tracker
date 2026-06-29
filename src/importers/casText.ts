
import type {
  Account,
  ImportRun,
  Instrument,
  ManualBalance,
  PortfolioBackup,
  PriceSnapshot,
  SourceDocument,
  Transaction
} from "@/src/schema/backup";
import { slugId, stableHash } from "@/src/domain/hash";
import { applyImportedRecordSet } from "@/src/importers/importReplace";

export type CasTransactionType =
  | "purchase"
  | "sip"
  | "redemption"
  | "switch_in"
  | "switch_out"
  | "dividend"
  | "stamp_duty"
  | "fee"
  | "non_financial"
  | "other_cash"
  | "unknown";

export type CasTransactionRow = {
  date: string;
  description: string;
  type: CasTransactionType;
  amount?: number;
  units?: number;
  price?: number;
  unitBalance?: number;
  raw: string;
};

export type CasScheme = {
  folio: string;
  investorName?: string;
  registrar?: string;
  schemeCode?: string;
  schemeName: string;
  isin: string;
  category: "Equity" | "Debt" | "Gold" | "Others" | "Cash";
  openingUnitBalance?: number;
  closingUnitBalance?: number;
  navDate?: string;
  nav?: number;
  totalCostValue?: number;
  marketValueDate?: string;
  marketValue?: number;
  transactions: CasTransactionRow[];
};

export type CasParseResult = {
  statementType: "cas";
  statementStartDate?: string;
  statementEndDate?: string;
  schemes: CasScheme[];
  transactions: CasTransactionRow[];
  datedRows: number;
  parsedFinancialRows: number;
  parsedNonFinancialRows: number;
  warnings: string[];
  errors: string[];
};

export type CasCanonicalImport = {
  accounts: Account[];
  instruments: Instrument[];
  transactions: Transaction[];
  manualBalances: ManualBalance[];
  priceSnapshots: PriceSnapshot[];
  importRun: ImportRun;
  sourceDocument?: SourceDocument;
};

type MutableScheme = Omit<CasScheme, "schemeName" | "isin" | "category" | "transactions"> & {
  schemeName?: string;
  isin?: string;
  category?: CasScheme["category"];
  transactions: CasTransactionRow[];
  schemeLines: string[];
  sawNomineeOrOpening: boolean;
};

const dateLine = /^(\d{2}-[A-Za-z]{3}-\d{4})\s+(.+)$/;
const fullTransactionTail = /^(.*?)\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{3})\s+(-?[\d,]+\.\d{3,4})\s+(-?[\d,]+\.\d{3})\s*$/;
const amountOnlyTail = /^(.*?)\s+(-?[\d,]+\.\d{2})\s*$/;

export function parseCasText(text: string): CasParseResult {
  const lines = text.replace(/\f/g, "\n").split(/\r?\n/);
  const schemes: CasScheme[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  let statementStartDate: string | undefined;
  let statementEndDate: string | undefined;
  let current: MutableScheme | undefined;
  let datedRows = 0;
  let parsedFinancialRows = 0;
  let parsedNonFinancialRows = 0;

  function finalizeCurrent() {
    if (!current) return;
    const parsedIdentity = parseSchemeIdentity(current.schemeLines.join(" "));
    const schemeName = current.schemeName ?? parsedIdentity.schemeName;
    const isin = current.isin ?? parsedIdentity.isin;
    if (!schemeName || !isin) {
      errors.push(`Unable to parse scheme identity for folio ${current.folio}`);
      current = undefined;
      return;
    }
    schemes.push({
      folio: current.folio,
      investorName: current.investorName,
      registrar: current.registrar ?? parsedIdentity.registrar,
      schemeCode: parsedIdentity.schemeCode,
      schemeName,
      isin,
      category: current.category ?? inferCategory(schemeName),
      openingUnitBalance: current.openingUnitBalance,
      closingUnitBalance: current.closingUnitBalance,
      navDate: current.navDate,
      nav: current.nav,
      totalCostValue: current.totalCostValue,
      marketValueDate: current.marketValueDate,
      marketValue: current.marketValue,
      transactions: current.transactions
    });
    current = undefined;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    const statementPeriod = parseStatementPeriod(trimmed);
    if (statementPeriod) {
      statementStartDate ??= statementPeriod.start;
      statementEndDate ??= statementPeriod.end;
    }

    const folio = parseFolio(trimmed);
    if (folio) {
      finalizeCurrent();
      current = {
        folio,
        investorName: undefined,
        registrar: undefined,
        openingUnitBalance: undefined,
        closingUnitBalance: undefined,
        navDate: undefined,
        nav: undefined,
        totalCostValue: undefined,
        marketValueDate: undefined,
        marketValue: undefined,
        transactions: [],
        schemeLines: [],
        sawNomineeOrOpening: false
      };
      continue;
    }

    if (!current) continue;

    if (!current.investorName && !trimmed.includes(" - ISIN:") && !trimmed.startsWith("Nominee") && !trimmed.startsWith("Opening Unit Balance")) {
      current.investorName = trimmed;
      continue;
    }

    if (!current.sawNomineeOrOpening && !dateLine.test(trimmed)) {
      if (trimmed.startsWith("Nominee") || trimmed.includes("Opening Unit Balance:")) {
        current.sawNomineeOrOpening = true;
      } else if (!isPageOrHeaderLine(trimmed)) {
        current.schemeLines.push(trimmed);
        const identity = parseSchemeIdentity(current.schemeLines.join(" "));
        if (identity.schemeName) current.schemeName = identity.schemeName;
        if (identity.isin) current.isin = identity.isin;
        if (identity.registrar) current.registrar = identity.registrar;
        continue;
      }
    }

    const opening = trimmed.match(/Opening Unit Balance:\s*([\d,.-]+)/);
    if (opening) {
      current.openingUnitBalance = parseNumber(opening[1]);
      current.sawNomineeOrOpening = true;
      continue;
    }

    const closing = trimmed.includes("Closing Unit Balance:")
      ? parseClosingSummary(trimmed) ??
        parseClosingSummary(`${trimmed} ${lines[i - 1]?.trim() ?? ""}`) ??
        parseClosingSummary(`${trimmed} ${lines[i + 1]?.trim() ?? ""}`)
      : undefined;
    if (closing) {
      Object.assign(current, closing);
      continue;
    }

    const tx = parseCasTransactionLine(trimmed);
    if (tx) {
      datedRows++;
      current.transactions.push(tx);
      if (tx.type === "non_financial" || tx.type === "unknown") {
        parsedNonFinancialRows++;
      } else {
        parsedFinancialRows++;
      }
    }
  }

  finalizeCurrent();

  for (const scheme of schemes) {
    if (scheme.closingUnitBalance === undefined) warnings.push(`Missing closing balance for ${scheme.isin}`);
    if (scheme.marketValue === undefined) warnings.push(`Missing market value for ${scheme.isin}`);
  }

  return {
    statementType: "cas",
    statementStartDate,
    statementEndDate,
    schemes,
    transactions: schemes.flatMap((scheme) => scheme.transactions),
    datedRows,
    parsedFinancialRows,
    parsedNonFinancialRows,
    warnings,
    errors
  };
}

export function buildCanonicalCasImport(
  parsed: CasParseResult,
  options: { importId: string; fileName?: string; sourceSha256?: string; now?: string }
): CasCanonicalImport {
  const now = options.now ?? new Date().toISOString();
  const accounts: Account[] = [];
  const instruments: Instrument[] = [];
  const transactions: Transaction[] = [];
  const manualBalances: ManualBalance[] = [];
  const priceSnapshots: PriceSnapshot[] = [];

  for (const scheme of parsed.schemes) {
    const accountId = slugId("acct", ["cas", scheme.folio, scheme.registrar ?? "unknown"]);
    if (!accounts.some((account) => account.id === accountId)) {
      accounts.push({
        id: accountId,
        name: `CAS Folio ${scheme.folio}`,
        institution: scheme.registrar ?? "CAS",
        type: "mutual_fund",
        currency: "INR",
        createdAt: now,
        updatedAt: now
      });
    }

    const instrumentId = slugId("inst", [scheme.isin]);
    if (!instruments.some((instrument) => instrument.id === instrumentId)) {
      instruments.push({
        id: instrumentId,
        name: scheme.schemeName,
        type: "mutual_fund",
        isin: scheme.isin,
        currency: "INR",
        country: "IN",
        category: scheme.category,
        createdAt: now,
        updatedAt: now
      });
    }

    if (scheme.marketValue !== undefined && scheme.marketValueDate) {
      const sourceRecordHash = stableHash({ scheme: scheme.isin, marketValue: scheme.marketValue, date: scheme.marketValueDate });
      manualBalances.push({
        id: slugId("bal", [sourceRecordHash]),
        accountId,
        instrumentId,
        label: scheme.schemeName,
        category: scheme.category,
        currency: "INR",
        value: scheme.marketValue,
        investedAmount: scheme.totalCostValue,
        investedCurrency: scheme.totalCostValue === undefined ? undefined : "INR",
        investedAsOfDate: scheme.totalCostValue === undefined ? undefined : scheme.marketValueDate,
        quantity: scheme.closingUnitBalance,
        price: scheme.nav,
        asOfDate: scheme.marketValueDate,
        notes: `CAS closing units: ${scheme.closingUnitBalance ?? "unknown"}`,
        source: { type: "import", importId: options.importId, provider: "cas_pdf", sourceRecordHash },
        userModified: false,
        createdAt: now,
        updatedAt: now
      });
    }

    if (scheme.nav !== undefined && scheme.navDate) {
      priceSnapshots.push({
        id: slugId("price", [scheme.isin, scheme.navDate, String(scheme.nav)]),
        instrumentId,
        price: scheme.nav,
        currency: "INR",
        asOfDate: scheme.navDate,
        source: "cas_pdf",
        createdAt: now
      });
    }

    const openingCost = estimateOpeningCostBasis(scheme);
    if (openingCost !== undefined && openingCost.amount > 0) {
      const sourceRecordHash = stableHash({ scheme: scheme.isin, folio: scheme.folio, openingCost, statementStartDate: parsed.statementStartDate });
      transactions.push({
        id: slugId("txn", [sourceRecordHash]),
        accountId,
        instrumentId,
        date: parsed.statementStartDate ?? scheme.transactions[0]?.date ?? scheme.marketValueDate ?? now.slice(0, 10),
        type: "buy",
        quantity: openingCost.units,
        price: openingCost.units > 0 ? openingCost.amount / openingCost.units : undefined,
        amount: openingCost.amount,
        currency: "INR",
        fees: 0,
        taxes: 0,
        source: { type: "import", importId: options.importId, provider: "cas_pdf", sourceRecordHash },
        userModified: false,
        createdAt: now,
        updatedAt: now
      });
    }

    for (const row of scheme.transactions) {
      const canonicalType = toCanonicalTransactionType(row.type);
      if (!canonicalType || row.amount === undefined) continue;
      const sourceRecordHash = stableHash({ scheme: scheme.isin, folio: scheme.folio, row });
      transactions.push({
        id: slugId("txn", [sourceRecordHash]),
        accountId,
        instrumentId,
        date: row.date,
        type: canonicalType,
        quantity: row.units,
        price: row.price,
        amount: row.amount,
        currency: "INR",
        fees: row.type === "fee" ? row.amount : 0,
        taxes: row.type === "stamp_duty" ? row.amount : 0,
        source: { type: "import", importId: options.importId, provider: "cas_pdf", sourceRecordHash },
        userModified: false,
        createdAt: now,
        updatedAt: now
      });
    }
  }

  const importRun: ImportRun = {
    id: options.importId,
    provider: "cas_pdf",
    fileName: options.fileName,
    status: parsed.errors.length > 0 ? "failed" : "staged",
    confidence: parsed.errors.length > 0 ? "low" : "medium",
    createdAt: now,
    notes: `${parsed.schemes.length} schemes, ${transactions.length} canonical transactions, ${manualBalances.length} balances`
  };

  const sourceDocument: SourceDocument | undefined = options.fileName
    ? {
        id: slugId("src", [options.importId, options.fileName]),
        importId: options.importId,
        fileName: options.fileName,
        mimeType: "application/pdf",
        sha256: options.sourceSha256,
        addedAt: now
      }
    : undefined;

  return { accounts, instruments, transactions, manualBalances, priceSnapshots, importRun, sourceDocument };
}

export function applyCanonicalCasImport(base: PortfolioBackup, imported: CasCanonicalImport, options: { replaceImportId?: string } = {}): PortfolioBackup {
  return applyImportedRecordSet(base, imported, { now: new Date().toISOString(), replaceImportId: options.replaceImportId });
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const map = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}

function parseStatementPeriod(line: string): { start: string; end: string } | undefined {
  const match = line.match(/(\d{2}-[A-Za-z]{3}-\d{4})\s+To\s+(\d{2}-[A-Za-z]{3}-\d{4})/);
  if (!match) return undefined;
  return { start: parseCasDate(match[1]), end: parseCasDate(match[2]) };
}

function estimateOpeningCostBasis(scheme: CasScheme): { units: number; amount: number } | undefined {
  const openingUnits = scheme.openingUnitBalance ?? 0;
  const targetCost = scheme.totalCostValue;
  if (!targetCost || openingUnits <= 0) return undefined;

  const withoutOpening = simulateRemainingCost(scheme.transactions, { quantity: 0, cost: 0 });
  const unitOpening = simulateRemainingCost(scheme.transactions, { quantity: openingUnits, cost: 1 });
  const openingFactor = unitOpening - withoutOpening;
  if (openingFactor <= 0) return undefined;
  const amount = targetCost - withoutOpening;
  if (amount <= 0) return undefined;
  return { units: roundQuantity(openingUnits), amount: roundMoney(amount / openingFactor) };
}

function simulateRemainingCost(rows: CasTransactionRow[], openingLot: { quantity: number; cost: number }): number {
  const lots: Array<{ quantity: number; cost: number }> = [];
  if (openingLot.quantity > 0 && openingLot.cost > 0) lots.push({ ...openingLot });
  let unallocatedCost = 0;
  for (const row of rows) {
    if (row.amount === undefined) continue;
    if (["purchase", "sip", "switch_in"].includes(row.type)) {
      addLot(lots, row.units, row.amount, (value) => { unallocatedCost += value; });
    } else if (["stamp_duty", "fee"].includes(row.type)) {
      unallocatedCost += row.amount;
    } else if (["redemption", "switch_out"].includes(row.type)) {
      removeLot(lots, row.units, row.amount, (value) => { unallocatedCost = Math.max(0, unallocatedCost - value); });
    }
  }
  return lots.reduce((sum, lot) => sum + lot.cost, unallocatedCost);
}

function addLot(lots: Array<{ quantity: number; cost: number }>, quantity: number | undefined, cost: number, addUnallocated: (cost: number) => void) {
  const qty = Math.abs(quantity ?? 0);
  if (qty > 0) lots.push({ quantity: qty, cost });
  else addUnallocated(cost);
}

function removeLot(lots: Array<{ quantity: number; cost: number }>, quantity: number | undefined, fallbackAmount: number, removeUnallocated: (cost: number) => void) {
  let remainingQuantity = Math.abs(quantity ?? 0);
  if (remainingQuantity <= 0) {
    removeUnallocated(fallbackAmount);
    return;
  }
  while (remainingQuantity > 0.0000001 && lots.length > 0) {
    const lot = lots[0];
    const consumed = Math.min(lot.quantity, remainingQuantity);
    const consumedCost = lot.quantity === 0 ? 0 : lot.cost * (consumed / lot.quantity);
    lot.quantity = roundQuantity(lot.quantity - consumed);
    lot.cost = Math.max(0, lot.cost - consumedCost);
    remainingQuantity = roundQuantity(remainingQuantity - consumed);
    if (lot.quantity <= 0.0000001) lots.shift();
  }
}

function parseFolio(line: string): string | undefined {
  return line.match(/^Folio No:\s*(.+?)\s+PAN:/)?.[1]?.trim();
}

function parseSchemeIdentity(joined: string): { schemeCode?: string; schemeName?: string; isin?: string; registrar?: string } {
  const withoutRegistrar = joined.replace(/\s+Registrar\s*:\s*[A-Z]*\s*$/i, "").trim();
  const isin = withoutRegistrar.match(/ISIN:\s*([A-Z0-9]+)/)?.[1];
  const registrar = joined.match(/Registrar\s*:\s*([A-Z]+)/i)?.[1]?.toUpperCase();
  const beforeIsin = withoutRegistrar.split(/\s+-\s+ISIN:/)[0]?.trim();
  if (!beforeIsin) return { isin, registrar };
  const codeMatch = beforeIsin.match(/^([^\s-]+)-(.+)$/);
  return {
    schemeCode: codeMatch?.[1],
    schemeName: (codeMatch?.[2] ?? beforeIsin).trim(),
    isin,
    registrar
  };
}

function parseClosingSummary(line: string): Partial<MutableScheme> | undefined {
  const match = line.match(
    /Closing Unit Balance:\s*([\d,.-]+)\s+NAV on\s+(\d{2}-[A-Za-z]{3}-\d{4}):\s*INR\s*([\d,.]+)\s+Total Cost Value:\s*([\d,.]+)\s+Market Value on\s+(\d{2}-[A-Za-z]{3}-\d{4}):\s*INR\s*([\d,.]+)/
  );
  if (!match) return undefined;
  return {
    closingUnitBalance: parseNumber(match[1]),
    navDate: parseCasDate(match[2]),
    nav: parseNumber(match[3]),
    totalCostValue: parseNumber(match[4]),
    marketValueDate: parseCasDate(match[5]),
    marketValue: parseNumber(match[6])
  };
}

function parseCasTransactionLine(line: string): CasTransactionRow | undefined {
  const dateMatch = line.match(dateLine);
  if (!dateMatch) return undefined;
  const date = parseCasDate(dateMatch[1]);
  const rest = dateMatch[2].trim();

  const full = rest.match(fullTransactionTail);
  if (full) {
    const description = full[1].trim();
    return {
      date,
      description,
      type: classifyCasTransaction(description, true),
      amount: parseNumber(full[2]),
      units: parseNumber(full[3]),
      price: parseNumber(full[4]),
      unitBalance: parseNumber(full[5]),
      raw: line
    };
  }

  const amountOnly = rest.match(amountOnlyTail);
  if (amountOnly) {
    const description = amountOnly[1].trim();
    return {
      date,
      description,
      type: classifyCasTransaction(description, false),
      amount: parseNumber(amountOnly[2]),
      raw: line
    };
  }

  const stampDuty = rest.match(/^(\*\*\*\s*Stamp Duty\s*\*\*\*)\s+([\d,]+\.\d{2})\s*$/i);
  if (stampDuty) {
    return {
      date,
      description: stampDuty[1].trim(),
      type: "stamp_duty",
      amount: parseNumber(stampDuty[2]),
      raw: line
    };
  }

  return {
    date,
    description: rest,
    type: "non_financial",
    raw: line
  };
}

function classifyCasTransaction(description: string, hasUnits: boolean): CasTransactionType {
  const value = description.toLowerCase();
  const normalized = value.replace(/[^a-z0-9]+/g, " ").trim();
  if (value.includes("stamp duty")) return "stamp_duty";
  if (value.includes("dividend")) return "dividend";
  if (normalized.includes("switch in")) return "switch_in";
  if (normalized.includes("switch out")) return "switch_out";
  if (value.includes("redemption") || value.includes("redeem")) return "redemption";
  if (value.includes("systematic investment") || value.includes("sip purchase") || value.includes("purchase systematic")) return "sip";
  if (value.includes("purchase") && hasUnits) return "purchase";
  if (value.includes("fee") || value.includes("load")) return "fee";
  if (hasUnits) return "unknown";
  if (description.includes("***")) return "non_financial";
  return "other_cash";
}

function toCanonicalTransactionType(type: CasTransactionType): Transaction["type"] | undefined {
  if (type === "purchase") return "buy";
  if (type === "sip") return "sip";
  if (type === "redemption") return "redemption";
  if (type === "switch_in") return "switch_in";
  if (type === "switch_out") return "switch_out";
  if (type === "dividend") return "dividend";
  if (type === "stamp_duty") return "tax";
  if (type === "fee") return "fee";
  if (type === "other_cash") return "deposit";
  return undefined;
}

function inferCategory(schemeName: string): CasScheme["category"] {
  const value = schemeName.toLowerCase();
  if (value.includes("gold") || value.includes("silver")) return "Gold";
  if (
    value.includes("gilt") ||
    value.includes("ultra short") ||
    value.includes("low duration") ||
    value.includes("money market") ||
    value.includes("debt") ||
    value.includes("liquid") ||
    value.includes("bond") ||
    value.includes("overnight") ||
    value.includes("conservative hybrid")
  ) return "Debt";
  if (
    value.includes("nifty") ||
    value.includes("sensex") ||
    value.includes("index fund") ||
    value.includes("flexi cap") ||
    value.includes("large cap") ||
    value.includes("mid cap") ||
    value.includes("small cap") ||
    value.includes("equity") ||
    value.includes("elss") ||
    value.includes("dynamic asset allocation") ||
    value.includes("balanced advantage") ||
    value.includes("aggressive hybrid")
  ) return "Equity";
  if (value.includes("hybrid") || value.includes("balanced") || value.includes("asset allocation")) return "Others";
  return "Equity";
}

function parseCasDate(value: string): string {
  const match = value.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (!match) return value;
  const months: Record<string, string> = {
    Jan: "01",
    Feb: "02",
    Mar: "03",
    Apr: "04",
    May: "05",
    Jun: "06",
    Jul: "07",
    Aug: "08",
    Sep: "09",
    Oct: "10",
    Nov: "11",
    Dec: "12"
  };
  return `${match[3]}-${months[match[2]] ?? "01"}-${match[1]}`;
}

function parseNumber(value: string): number {
  return Number(value.replace(/,/g, ""));
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000000) / 1000000;
}

function isPageOrHeaderLine(line: string): boolean {
  return (
    line.startsWith("Consolidated Account Statement") ||
    line.startsWith("Date          Transaction") ||
    line.includes("CAMSCASWS-") ||
    /^Page \d+ of \d+/.test(line) ||
    /^\d{2}-[A-Za-z]{3}-\d{4} To /.test(line)
  );
}
