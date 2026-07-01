import readXlsxFile from "read-excel-file/browser";
import Papa from "papaparse";
import { slugId, stableHash } from "@/src/domain/hash";
import type { Account, Instrument, PriceSnapshot, Transaction } from "@/src/schema/backup";
import type { ImportError, ManualCsvResult } from "@/src/importers/manualCsv";

export type IndianBrokerProvider = "zerodha_tradebook" | "groww_stock_orders";

export type IndianBrokerParseOptions = {
  importId: string;
  now?: string;
};

type CsvRow = Record<string, string | undefined>;
type WorkbookCell = string | number | boolean | Date | null | undefined;
type WorkbookRow = WorkbookCell[];

type NormalizedTrade = {
  provider: IndianBrokerProvider;
  platform: "Zerodha" | "Groww";
  rowNumber: number;
  symbol: string;
  isin: string;
  name: string;
  date: string;
  type: "buy" | "sell";
  quantity: number;
  price: number;
  orderId: string;
  tradeId: string;
  executionTime: string;
  exchange: string;
};

export function parseZerodhaTradebookCsv(csv: string, options: IndianBrokerParseOptions): ManualCsvResult {
  const rows = parseDelimitedRows(csv);
  return normalizeTrades(rows.map((row, index) => normalizeZerodhaRow(row, index + 2)).filter(Boolean) as NormalizedTrade[], options, "zerodha_tradebook");
}

export function parseGrowwStockOrdersCsv(csv: string, options: IndianBrokerParseOptions): ManualCsvResult {
  const headerOffset = findGrowwHeaderOffset(csv);
  const body = headerOffset >= 0 ? csv.split(/\r?\n/).slice(headerOffset).join("\n") : csv;
  const rows = parseDelimitedRows(body);
  return normalizeTrades(rows.map((row, index) => normalizeGrowwRow(row, index + 1 + Math.max(0, headerOffset))).filter(Boolean) as NormalizedTrade[], options, "groww_stock_orders");
}

export async function parseGrowwStockOrdersWorkbook(file: File, options: IndianBrokerParseOptions): Promise<ManualCsvResult> {
  const workbook = await readXlsxFile(file);
  return parseGrowwStockOrderRows(normalizeWorkbookRows(workbook as unknown), options);
}

export function parseGrowwStockOrderRows(rows: WorkbookRow[], options: IndianBrokerParseOptions): ManualCsvResult {
  const headerOffset = findGrowwHeaderOffsetInRows(rows);
  if (headerOffset < 0) {
    return { accounts: [], instruments: [], transactions: [], manualBalances: [], priceSnapshots: [], errors: [{ row: 1, message: "Missing Groww stock order history header row." }] };
  }
  const headers = rows[headerOffset].map((cell) => normalizeHeader(String(cell ?? "")));
  const csvRows: CsvRow[] = rows.slice(headerOffset + 1)
    .filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, cellToString(row[index])])));
  return normalizeTrades(csvRows.map((row, index) => normalizeGrowwRow(row, headerOffset + index + 2)).filter(Boolean) as NormalizedTrade[], options, "groww_stock_orders");
}

function normalizeTrades(trades: NormalizedTrade[], options: IndianBrokerParseOptions, provider: IndianBrokerProvider): ManualCsvResult {
  const now = options.now ?? new Date().toISOString();
  const errors: ImportError[] = [];
  const accounts: Account[] = [];
  const instruments: Instrument[] = [];
  const transactions: Transaction[] = [];
  const manualBalances: ManualCsvResult["manualBalances"] = [];
  const priceSnapshots: PriceSnapshot[] = [];
  const accountId = ensureBrokerAccount(accounts, provider === "zerodha_tradebook" ? "Zerodha" : "Groww", now);

  for (const trade of trades) {
    if (!trade.symbol || !trade.date || !trade.type || !(trade.quantity > 0) || !(trade.price > 0)) {
      errors.push({ row: trade.rowNumber, message: "Missing or invalid symbol/date/type/quantity/price" });
      continue;
    }
    const instrumentId = ensureBrokerInstrument(instruments, trade, now);
    const amount = roundMoney(trade.quantity * trade.price);
    const sourceRecordHash = stableHash({
      provider,
      symbol: trade.symbol,
      isin: trade.isin,
      type: trade.type,
      date: trade.date,
      quantity: trade.quantity,
      price: trade.price,
      orderId: trade.orderId,
      tradeId: trade.tradeId,
      executionTime: trade.executionTime,
      exchange: trade.exchange
    });
    transactions.push({
      id: slugId("tx", [sourceRecordHash]),
      accountId,
      instrumentId,
      date: trade.date,
      type: trade.type,
      quantity: trade.quantity,
      price: trade.price,
      amount,
      currency: "INR",
      fees: 0,
      taxes: 0,
      source: { type: "import", importId: options.importId, provider, sourceRecordHash },
      userModified: false,
      createdAt: now,
      updatedAt: now
    });
    priceSnapshots.push({
      id: slugId("price", [instrumentId, trade.date, String(trade.price), provider]),
      instrumentId,
      price: trade.price,
      currency: "INR",
      asOfDate: trade.date,
      source: provider,
      createdAt: now
    });
  }

  if (transactions.length === 0 && errors.length === 0) {
    errors.push({ row: 1, message: provider === "zerodha_tradebook" ? "No Zerodha tradebook rows found" : "No executed Groww stock order rows found" });
  }

  return { accounts, instruments, transactions, manualBalances, priceSnapshots, errors };
}

function parseDelimitedRows(csv: string): CsvRow[] {
  const parsed = Papa.parse<CsvRow>(csv, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normalizeHeader,
    delimiter: ""
  });
  return parsed.data.filter((row) => Object.values(row).some((value) => String(value ?? "").trim() !== ""));
}

function normalizeZerodhaRow(row: CsvRow, rowNumber: number): NormalizedTrade | null {
  const symbol = pick(row, "symbol").toUpperCase();
  const rawType = pick(row, "trade_type").toLowerCase();
  if (!symbol && !rawType) return null;
  const date = parseDate(pick(row, "trade_date"));
  const quantity = parseNumber(pick(row, "quantity"));
  const price = parseNumber(pick(row, "price"));
  return {
    provider: "zerodha_tradebook",
    platform: "Zerodha",
    rowNumber,
    symbol,
    isin: pick(row, "isin").toUpperCase(),
    name: symbol,
    date,
    type: rawType === "buy" ? "buy" : rawType === "sell" ? "sell" : ("" as "buy" | "sell"),
    quantity,
    price,
    orderId: pick(row, "order_id"),
    tradeId: pick(row, "trade_id"),
    executionTime: pick(row, "order_execution_time"),
    exchange: pick(row, "exchange").toUpperCase()
  };
}

function normalizeGrowwRow(row: CsvRow, rowNumber: number): NormalizedTrade | null {
  const symbol = pick(row, "symbol").toUpperCase();
  const status = pick(row, "order_status").toLowerCase();
  if (!symbol && !status) return null;
  if (status && status !== "executed") return null;
  const quantity = parseNumber(pick(row, "quantity"));
  const value = parseNumber(pick(row, "value"));
  const rawType = pick(row, "type").toLowerCase();
  const execution = pick(row, "execution_date_and_time");
  return {
    provider: "groww_stock_orders",
    platform: "Groww",
    rowNumber,
    symbol,
    isin: pick(row, "isin").toUpperCase(),
    name: pick(row, "stock_name") || symbol,
    date: parseDate(execution),
    type: rawType === "buy" ? "buy" : rawType === "sell" ? "sell" : ("" as "buy" | "sell"),
    quantity,
    price: quantity > 0 ? roundMoney(value / quantity) : Number.NaN,
    orderId: pick(row, "exchange_order_id"),
    tradeId: pick(row, "exchange_order_id"),
    executionTime: execution,
    exchange: pick(row, "exchange").toUpperCase()
  };
}

function ensureBrokerAccount(accounts: Account[], institution: "Zerodha" | "Groww", now: string): string {
  const id = slugId("acct", [institution, "indian_stock", "INR"]);
  if (!accounts.some((account) => account.id === id)) {
    accounts.push({ id, name: institution + " Equity", institution, type: "indian_stock", currency: "INR", createdAt: now, updatedAt: now });
  }
  return id;
}

function ensureBrokerInstrument(instruments: Instrument[], trade: NormalizedTrade, now: string): string {
  const key = trade.isin || trade.symbol || trade.name;
  const id = slugId("inst", ["indian_stock", "INR", key]);
  if (!instruments.some((instrument) => instrument.id === id)) {
    instruments.push({
      id,
      name: trade.name || trade.symbol || trade.isin,
      type: "indian_stock",
      symbol: trade.symbol || undefined,
      isin: trade.isin || undefined,
      currency: "INR",
      country: "India",
      category: "Equity",
      issuer: trade.platform,
      createdAt: now,
      updatedAt: now
    });
  }
  return id;
}

function findGrowwHeaderOffset(csv: string): number {
  return csv.split(/\r?\n/).findIndex((line) => {
    const normalized = line.toLowerCase();
    return normalized.includes("stock name") && normalized.includes("symbol") && normalized.includes("execution date");
  });
}

function findGrowwHeaderOffsetInRows(rows: WorkbookRow[]): number {
  return rows.findIndex((row) => {
    const normalized = row.map((cell) => String(cell ?? "").trim().toLowerCase()).join(" ");
    return normalized.includes("stock name") && normalized.includes("symbol") && normalized.includes("execution date");
  });
}

function normalizeWorkbookRows(input: unknown): WorkbookRow[] {
  if (Array.isArray(input) && input.length === 1 && isSheetData(input[0])) return input[0].data as WorkbookRow[];
  if (Array.isArray(input)) return input as WorkbookRow[];
  return [];
}

function isSheetData(value: unknown): value is { data: WorkbookRow[] } {
  return Boolean(value && typeof value === "object" && Array.isArray((value as { data?: unknown }).data));
}

function cellToString(value: WorkbookCell): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "").trim();
}

function pick(row: CsvRow, key: string): string {
  return String(row[normalizeHeader(key)] ?? "").trim();
}

function normalizeHeader(header: string): string {
  return String(header ?? "").trim().toLowerCase().replace(/[\s/$().-]+/g, "_").replace(/^_+|_+$/g, "");
}

function parseDate(value: string): string {
  const trimmed = value.trim();
  const datePart = trimmed.split(/[ T]/)[0];
  const dmy = datePart.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const iso = datePart.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  return "";
}

function parseNumber(value: string): number {
  const cleaned = value.replace(/,/g, "").trim();
  if (!cleaned) return Number.NaN;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
