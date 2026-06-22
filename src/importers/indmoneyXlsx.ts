import readXlsxFile from "read-excel-file/browser";
import { stableHash, slugId } from "@/src/domain/hash";
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

export type WorkbookCell = string | number | boolean | Date | null | undefined;
export type WorkbookRow = WorkbookCell[];

export type IndMoneyLedgerRow = {
  rowNumber: number;
  symbol: string;
  activityDate: string;
  transactionType: string;
  quantity: number;
  unitPrice: number;
  brokerTransactionId: string;
  brokerReferenceId: string;
  status: string;
  brokerTransactionType: string;
  commission: number;
  openBalance: number;
  closeBalance: number;
  netAmount: number;
  softDeleted: boolean;
};

export type IndMoneyPosition = {
  symbol: string;
  quantity: number;
  latestPrice: number;
  latestPriceDate: string;
  marketValue: number;
};

export type IndMoneyParseResult = {
  statementType: "indmoney_us_transactions";
  rows: IndMoneyLedgerRow[];
  canonicalRows: IndMoneyLedgerRow[];
  positions: IndMoneyPosition[];
  cashBalance?: { value: number; asOfDate: string };
  warnings: string[];
  errors: string[];
};

export type IndMoneyCanonicalImport = {
  accounts: Account[];
  instruments: Instrument[];
  transactions: Transaction[];
  manualBalances: ManualBalance[];
  priceSnapshots: PriceSnapshot[];
  importRun: ImportRun;
  sourceDocument?: SourceDocument;
};

const requiredHeaders = [
  "Symbol",
  "Activity Date",
  "Transaction Type",
  "Quantity",
  "Unit Price",
  "Broker Transaction ID",
  "Status",
  "Broker Transaction Type",
  "Commission",
  "Open Balance",
  "Close Balance",
  "Net Amount",
  "Soft Deleted"
];

const supportedTypes = new Set(["BUY", "SELL", "DIV", "DIVTAX", "JNLC", "CSD", "MEM", "STOCK_SPLIT"]);

export async function parseIndMoneyWorkbook(file: File): Promise<IndMoneyParseResult> {
  const workbook = await readXlsxFile(file);
  return parseIndMoneyRows(normalizeWorkbookRows(workbook as unknown));
}

export function normalizeWorkbookRows(input: unknown): WorkbookRow[] {
  if (Array.isArray(input) && input.length === 1 && isSheetData(input[0])) {
    return input[0].data as WorkbookRow[];
  }
  if (Array.isArray(input)) return input as WorkbookRow[];
  return [];
}

export function parseIndMoneyRows(rows: WorkbookRow[]): IndMoneyParseResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  if (rows.length === 0) {
    return emptyResult(["Workbook has no rows."]);
  }

  const headers = rows[0].map((header) => String(header ?? "").trim());
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const missing = requiredHeaders.filter((header) => !headerIndex.has(header));
  if (missing.length > 0) {
    return emptyResult(["Missing INDMoney column(s): " + missing.join(", ")]);
  }

  const parsedRows: IndMoneyLedgerRow[] = [];
  const canonicalRows: IndMoneyLedgerRow[] = [];
  const positionMap = new Map<string, IndMoneyPosition>();
  let cashBalance: IndMoneyParseResult["cashBalance"];

  rows.slice(1).forEach((row, rowOffset) => {
    if (row.every((cell) => cell === null || cell === undefined || String(cell).trim() === "")) return;
    const ledgerRow: IndMoneyLedgerRow = {
      rowNumber: rowOffset + 2,
      symbol: readString(row, headerIndex, "Symbol").toUpperCase(),
      activityDate: parseDate(readCell(row, headerIndex, "Activity Date")),
      transactionType: readString(row, headerIndex, "Transaction Type").toUpperCase(),
      quantity: readNumber(row, headerIndex, "Quantity"),
      unitPrice: readNumber(row, headerIndex, "Unit Price"),
      brokerTransactionId: readString(row, headerIndex, "Broker Transaction ID"),
      brokerReferenceId: readString(row, headerIndex, "Broker Reference ID"),
      status: readString(row, headerIndex, "Status").toUpperCase(),
      brokerTransactionType: readString(row, headerIndex, "Broker Transaction Type").toUpperCase(),
      commission: readNumber(row, headerIndex, "Commission"),
      openBalance: readNumber(row, headerIndex, "Open Balance"),
      closeBalance: readNumber(row, headerIndex, "Close Balance"),
      netAmount: readNumber(row, headerIndex, "Net Amount"),
      softDeleted: readBoolean(row, headerIndex, "Soft Deleted")
    };

    parsedRows.push(ledgerRow);
    if (ledgerRow.softDeleted) return;
    if (!ledgerRow.activityDate) {
      warnings.push("Row " + ledgerRow.rowNumber + ": missing activity date.");
      return;
    }
    if (!supportedTypes.has(ledgerRow.transactionType)) {
      warnings.push("Row " + ledgerRow.rowNumber + ": unsupported transaction type " + ledgerRow.transactionType + ".");
      return;
    }
    if (!["FILLED", "SUCCESS"].includes(ledgerRow.status)) return;

    if (ledgerRow.transactionType !== "MEM") canonicalRows.push(ledgerRow);

    if (["BUY", "SELL", "STOCK_SPLIT"].includes(ledgerRow.transactionType)) {
      if (!ledgerRow.symbol) {
        warnings.push("Row " + ledgerRow.rowNumber + ": " + ledgerRow.transactionType + " has no symbol.");
        return;
      }
      const existing = positionMap.get(ledgerRow.symbol) ?? {
        symbol: ledgerRow.symbol,
        quantity: 0,
        latestPrice: 0,
        latestPriceDate: ledgerRow.activityDate,
        marketValue: 0
      };
      if (ledgerRow.transactionType === "BUY") existing.quantity += ledgerRow.quantity;
      if (ledgerRow.transactionType === "SELL") existing.quantity -= ledgerRow.quantity;
      if (ledgerRow.transactionType === "STOCK_SPLIT") existing.quantity += ledgerRow.quantity;
      if (ledgerRow.unitPrice > 0) {
        existing.latestPrice = ledgerRow.unitPrice;
        existing.latestPriceDate = ledgerRow.activityDate;
      }
      existing.quantity = roundQuantity(existing.quantity);
      existing.marketValue = roundMoney(existing.quantity * existing.latestPrice);
      positionMap.set(ledgerRow.symbol, existing);
    }

    if (!ledgerRow.symbol && ["JNLC", "CSD"].includes(ledgerRow.transactionType)) {
      cashBalance = { value: roundMoney(ledgerRow.closeBalance), asOfDate: ledgerRow.activityDate };
    }
  });

  const positions = [...positionMap.values()]
    .filter((position) => Math.abs(position.quantity) > 0.0000001)
    .map((position) => ({ ...position, quantity: roundQuantity(position.quantity), marketValue: roundMoney(position.quantity * position.latestPrice) }))
    .sort((a, b) => b.marketValue - a.marketValue);

  return {
    statementType: "indmoney_us_transactions",
    rows: parsedRows,
    canonicalRows,
    positions,
    cashBalance,
    warnings,
    errors
  };
}

export function buildCanonicalIndMoneyImport(
  parsed: IndMoneyParseResult,
  options: { importId: string; fileName?: string; sourceSha256?: string; now?: string }
): IndMoneyCanonicalImport {
  const now = options.now ?? new Date().toISOString();
  const stockAccountId = "acct_indmoney_us_stocks";
  const cashAccountId = "acct_indmoney_cash";
  const accounts: Account[] = [
    {
      id: stockAccountId,
      name: "INDMoney US Stocks",
      institution: "INDMoney",
      type: "us_stock",
      currency: "USD",
      createdAt: now,
      updatedAt: now
    }
  ];
  const instruments = new Map<string, Instrument>();
  const transactions: Transaction[] = [];
  const manualBalances: ManualBalance[] = [];
  const priceSnapshots: PriceSnapshot[] = [];

  function ensureStock(symbol: string): Instrument {
    const instrumentId = slugId("inst", ["us", symbol]);
    const existing = instruments.get(instrumentId);
    if (existing) return existing;
    const instrument: Instrument = {
      id: instrumentId,
      name: symbol,
      type: "us_stock",
      symbol,
      currency: "USD",
      country: "US",
      category: "Equity",
      createdAt: now,
      updatedAt: now
    };
    instruments.set(instrumentId, instrument);
    return instrument;
  }

  function ensureCash(): Instrument {
    const instrumentId = "inst_indmoney_cash_usd";
    const existing = instruments.get(instrumentId);
    if (existing) return existing;
    if (!accounts.some((account) => account.id === cashAccountId)) {
      accounts.push({
        id: cashAccountId,
        name: "INDMoney Cash",
        institution: "INDMoney",
        type: "cash",
        currency: "USD",
        createdAt: now,
        updatedAt: now
      });
    }
    const instrument: Instrument = {
      id: instrumentId,
      name: "INDMoney USD Cash",
      type: "cash",
      symbol: "USD",
      currency: "USD",
      country: "US",
      category: "Cash",
      createdAt: now,
      updatedAt: now
    };
    instruments.set(instrumentId, instrument);
    return instrument;
  }

  for (const row of parsed.canonicalRows) {
    const sourceRecordHash = stableHash({ provider: "indmoney_export", row });
    const stockInstrument = row.symbol ? ensureStock(row.symbol) : undefined;
    const cashInstrument = row.symbol ? undefined : ensureCash();
    const txType = toCanonicalType(row.transactionType, row.netAmount);
    if (!txType) continue;
    const instrument = stockInstrument ?? cashInstrument;
    if (!instrument) continue;

    transactions.push({
      id: slugId("txn", [sourceRecordHash]),
      accountId: row.symbol ? stockAccountId : cashAccountId,
      instrumentId: instrument.id,
      date: row.activityDate,
      type: txType,
      quantity: row.transactionType === "DIV" || row.transactionType === "DIVTAX" ? undefined : row.quantity,
      price: row.unitPrice > 0 ? row.unitPrice : undefined,
      amount: Math.abs(row.netAmount),
      currency: "USD",
      fees: row.commission,
      taxes: row.transactionType === "DIVTAX" ? Math.abs(row.netAmount) : 0,
      source: { type: "import", importId: options.importId, provider: "indmoney_export", sourceRecordHash },
      userModified: false,
      createdAt: now,
      updatedAt: now
    });
  }

  for (const position of parsed.positions) {
    const instrument = ensureStock(position.symbol);
    const sourceRecordHash = stableHash({ provider: "indmoney_export", symbol: position.symbol, quantity: position.quantity });
    manualBalances.push({
      id: slugId("bal", ["indmoney", position.symbol]),
      accountId: stockAccountId,
      instrumentId: instrument.id,
      label: position.symbol,
      category: "Equity",
      currency: "USD",
      value: position.marketValue,
      quantity: position.quantity,
      price: position.latestPrice,
      asOfDate: position.latestPriceDate,
      notes: "INDMoney XLSX position valued at latest transaction price until live quote refresh.",
      source: { type: "import", importId: options.importId, provider: "indmoney_export", sourceRecordHash },
      userModified: false,
      createdAt: now,
      updatedAt: now
    });
    if (position.latestPrice > 0) {
      priceSnapshots.push({
        id: slugId("price", [instrument.id, position.latestPriceDate, String(position.latestPrice)]),
        instrumentId: instrument.id,
        price: position.latestPrice,
        currency: "USD",
        asOfDate: position.latestPriceDate,
        source: "indmoney_export",
        createdAt: now
      });
    }
  }

  if (parsed.cashBalance && Math.abs(parsed.cashBalance.value) > 0.000001) {
    const cash = ensureCash();
    const sourceRecordHash = stableHash({ provider: "indmoney_export", cash: parsed.cashBalance });
    manualBalances.push({
      id: "bal_indmoney_cash_usd",
      accountId: cashAccountId,
      instrumentId: cash.id,
      label: "INDMoney USD Cash",
      category: "Cash",
      currency: "USD",
      value: parsed.cashBalance.value,
      asOfDate: parsed.cashBalance.asOfDate,
      notes: "Cash balance from INDMoney ledger close balance.",
      source: { type: "import", importId: options.importId, provider: "indmoney_export", sourceRecordHash },
      userModified: false,
      createdAt: now,
      updatedAt: now
    });
  }

  const importRun: ImportRun = {
    id: options.importId,
    provider: "indmoney_export",
    fileName: options.fileName,
    status: parsed.errors.length > 0 ? "failed" : "staged",
    confidence: parsed.errors.length > 0 ? "low" : "medium",
    createdAt: now,
    notes: parsed.canonicalRows.length + " rows, " + parsed.positions.length + " open positions, " + transactions.length + " canonical transactions"
  };

  const sourceDocument: SourceDocument | undefined = options.fileName
    ? {
        id: slugId("src", [options.importId, options.fileName]),
        importId: options.importId,
        fileName: options.fileName,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sha256: options.sourceSha256,
        addedAt: now
      }
    : undefined;

  return { accounts, instruments: [...instruments.values()], transactions, manualBalances, priceSnapshots, importRun, sourceDocument };
}

export function applyCanonicalIndMoneyImport(base: PortfolioBackup, imported: IndMoneyCanonicalImport): PortfolioBackup {
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

function toCanonicalType(type: string, netAmount: number): Transaction["type"] | undefined {
  if (type === "BUY") return "buy";
  if (type === "SELL") return "sell";
  if (type === "DIV") return "dividend";
  if (type === "DIVTAX") return "tax";
  if (type === "STOCK_SPLIT") return "split";
  if (type === "JNLC" || type === "CSD") return netAmount >= 0 ? "deposit" : "withdrawal";
  return undefined;
}

function emptyResult(errors: string[]): IndMoneyParseResult {
  return { statementType: "indmoney_us_transactions", rows: [], canonicalRows: [], positions: [], warnings: [], errors };
}

function isSheetData(value: unknown): value is { data: unknown[] } {
  return typeof value === "object" && value !== null && Array.isArray((value as { data?: unknown }).data);
}

function readCell(row: WorkbookRow, headerIndex: Map<string, number>, header: string): WorkbookCell {
  return row[headerIndex.get(header) ?? -1];
}

function readString(row: WorkbookRow, headerIndex: Map<string, number>, header: string): string {
  const value = readCell(row, headerIndex, header);
  return String(value ?? "").trim();
}

function readNumber(row: WorkbookRow, headerIndex: Map<string, number>, header: string): number {
  const value = readCell(row, headerIndex, header);
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function readBoolean(row: WorkbookRow, headerIndex: Map<string, number>, header: string): boolean {
  const value = readCell(row, headerIndex, header);
  if (typeof value === "boolean") return value;
  return String(value ?? "").trim().toUpperCase() === "TRUE";
}

function parseDate(value: WorkbookCell): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value ?? "").trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + "-" + iso[2] + "-" + iso[3];
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) return slash[3] + "-" + slash[2].padStart(2, "0") + "-" + slash[1].padStart(2, "0");
  return "";
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const map = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000;
}
