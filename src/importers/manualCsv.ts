import Papa from "papaparse";
import readXlsxFile from "read-excel-file/browser";
import { categorySchema, currencySchema, type Account, type Instrument, type ManualBalance, type PriceSnapshot, type Transaction } from "@/src/schema/backup";
import { slugId, stableHash } from "@/src/domain/hash";

export type ManualCsvParseOptions = {
  importId: string;
  now?: string;
};

export type ImportError = {
  row: number;
  message: string;
};

export type ManualCsvResult = {
  accounts: Account[];
  instruments: Instrument[];
  transactions: Transaction[];
  manualBalances: ManualBalance[];
  priceSnapshots: PriceSnapshot[];
  errors: ImportError[];
};

type ManualCsvRow = {
  account_name?: string;
  institution?: string;
  asset_name?: string;
  asset_type?: string;
  category?: string;
  currency?: string;
  current_value?: string;
  as_of_date?: string;
  quantity?: string;
  price?: string;
  symbol?: string;
  isin?: string;
  country?: string;
  issuer?: string;
  holding_key?: string;
  notes?: string;
};

type ManualTransactionRow = {
  account_name?: string;
  institution?: string;
  asset_name?: string;
  asset_type?: string;
  category?: string;
  currency?: string;
  date?: string;
  transaction_type?: string;
  quantity?: string;
  price?: string;
  amount?: string;
  fees?: string;
  taxes?: string;
  symbol?: string;
  isin?: string;
  country?: string;
  issuer?: string;
  transaction_id?: string;
  notes?: string;
};

type ManualPriceRow = {
  asset_name?: string;
  asset_type?: string;
  category?: string;
  currency?: string;
  as_of_date?: string;
  price?: string;
  symbol?: string;
  isin?: string;
  country?: string;
  issuer?: string;
};

type ManualFxRow = {
  from_currency?: string;
  to_currency?: string;
  date?: string;
  rate?: string;
};

type WorkbookCell = string | number | boolean | Date | null | undefined;
type WorkbookRow = WorkbookCell[];
type WorkbookSheet = { sheet: string; data: WorkbookRow[] };

const supportedAccountTypes = new Set<Account["type"]>([
  "mutual_fund",
  "indian_stock",
  "us_stock",
  "fd",
  "ppf",
  "ssy",
  "nps",
  "epf",
  "cash",
  "espp",
  "gold",
  "other"
]);

export function parseManualCsv(csv: string, options: ManualCsvParseOptions): ManualCsvResult {
  const parsed = Papa.parse<ManualCsvRow>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase()
  });

  const now = options.now ?? new Date().toISOString();
  const accounts: Account[] = [];
  const instruments: Instrument[] = [];
  const transactions: Transaction[] = [];
  const manualBalances: ManualBalance[] = [];
  const priceSnapshots: PriceSnapshot[] = [];
  const errors: ImportError[] = [];

  parsed.data.forEach((row, index) => {
    const rowNumber = index + 2;
    const normalized = normalizeRow(row);
    const category = categorySchema.safeParse(normalized.category);
    const currency = currencySchema.safeParse(normalized.currency);
    const value = Number(normalized.current_value);

    if (!normalized.account_name || !normalized.asset_name) {
      errors.push({ row: rowNumber, message: "Missing account_name or asset_name" });
      return;
    }
    if (!supportedAccountTypes.has(normalized.asset_type as Account["type"])) {
      errors.push({ row: rowNumber, message: `Unsupported asset_type: ${normalized.asset_type}` });
      return;
    }
    if (!category.success) {
      errors.push({ row: rowNumber, message: `Invalid category: ${normalized.category}` });
      return;
    }
    if (!currency.success) {
      errors.push({ row: rowNumber, message: `Invalid currency: ${normalized.currency}` });
      return;
    }
    if (!Number.isFinite(value)) {
      errors.push({ row: rowNumber, message: `Invalid current_value: ${normalized.current_value}` });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized.as_of_date)) {
      errors.push({ row: rowNumber, message: `Invalid as_of_date: ${normalized.as_of_date}` });
      return;
    }

    const accountId = ensureAccount(accounts, normalized, now);
    const instrumentId = ensureInstrument(instruments, normalized, now);

    const sourceRecordHash = stableHash({
      account_name: normalized.account_name,
      asset_name: normalized.asset_name,
      asset_type: normalized.asset_type,
      category: normalized.category,
      currency: normalized.currency,
      current_value: value,
      as_of_date: normalized.as_of_date
    });

    manualBalances.push({
      id: slugId("bal", [sourceRecordHash]),
      accountId,
      instrumentId,
      label: normalized.asset_name,
      category: category.data,
      currency: normalized.currency,
      value,
      quantity: optionalNumber(normalized.quantity),
      price: optionalNumber(normalized.price),
      asOfDate: normalized.as_of_date,
      notes: normalized.notes || undefined,
      source: {
        type: "import",
        importId: options.importId,
        provider: "manual_csv",
        sourceRecordHash
      },
      userModified: false,
      createdAt: now,
      updatedAt: now
    });
  });

  return { accounts, instruments, transactions, manualBalances, priceSnapshots, errors };
}

export async function parseManualWorkbook(file: File, options: ManualCsvParseOptions): Promise<ManualCsvResult> {
  const sheets = await readXlsxFile(file) as unknown as WorkbookSheet[];
  return parseManualWorkbookSheets(sheets, options);
}

export function parseManualWorkbookSheets(sheets: WorkbookSheet[], options: ManualCsvParseOptions): ManualCsvResult {
  const now = options.now ?? new Date().toISOString();
  const accounts: Account[] = [];
  const instruments: Instrument[] = [];
  const transactions: Transaction[] = [];
  const manualBalances: ManualBalance[] = [];
  const priceSnapshots: PriceSnapshot[] = [];
  const errors: ImportError[] = [];
  const byName = new Map(sheets.map((sheet) => [sheet.sheet.trim().toLowerCase(), sheet.data]));

  const holdingRows = rowsFromSheet<ManualCsvRow>(byName.get("holdings") ?? []);
  const transactionRows = rowsFromSheet<ManualTransactionRow>(byName.get("transactions") ?? []);
  const priceRows = rowsFromSheet<ManualPriceRow>(byName.get("prices") ?? []);
  const fxRows = rowsFromSheet<ManualFxRow>(byName.get("fx") ?? []);

  if (holdingRows.length === 0 && transactionRows.length === 0 && priceRows.length === 0 && fxRows.length === 0) {
    return { accounts, instruments, transactions, manualBalances, priceSnapshots, errors: [{ row: 1, message: "Manual workbook must contain at least one of these sheets: Holdings, Transactions, Prices, FX" }] };
  }

  for (const { row, rowNumber } of holdingRows) {
    const normalized = normalizeRow(row);
    const category = categorySchema.safeParse(normalized.category);
    const currency = currencySchema.safeParse(normalized.currency);
    const value = Number(normalized.current_value);
    if (!normalized.account_name || !normalized.asset_name) { errors.push({ row: rowNumber, message: "Holdings: missing account_name or asset_name" }); continue; }
    if (!supportedAccountTypes.has(normalized.asset_type as Account["type"])) { errors.push({ row: rowNumber, message: "Holdings: unsupported asset_type: " + normalized.asset_type }); continue; }
    if (!category.success) { errors.push({ row: rowNumber, message: "Holdings: invalid category: " + normalized.category }); continue; }
    if (!currency.success) { errors.push({ row: rowNumber, message: "Holdings: invalid currency: " + normalized.currency }); continue; }
    if (!Number.isFinite(value)) { errors.push({ row: rowNumber, message: "Holdings: invalid current_value: " + normalized.current_value }); continue; }
    if (!isIsoDate(normalized.as_of_date)) { errors.push({ row: rowNumber, message: "Holdings: invalid as_of_date: " + normalized.as_of_date }); continue; }
    const accountId = ensureAccount(accounts, normalized, now);
    const instrumentId = ensureInstrument(instruments, normalized, now);
    const logicalHoldingKey = normalized.holding_key || accountId + "|" + instrumentId;
    const sourceRecordHash = stableHash({ provider: "manual_workbook", logicalHoldingKey });
    manualBalances.push({
      id: slugId("bal", ["manual_workbook", logicalHoldingKey]),
      accountId,
      instrumentId,
      label: normalized.asset_name,
      category: category.data,
      currency: normalized.currency,
      value,
      quantity: optionalNumber(normalized.quantity),
      price: optionalNumber(normalized.price),
      asOfDate: normalized.as_of_date,
      notes: normalized.notes || undefined,
      source: { type: "import", importId: options.importId, provider: "manual_workbook", sourceRecordHash },
      userModified: false,
      createdAt: now,
      updatedAt: now
    });
    if (optionalNumber(normalized.price) !== undefined) {
      priceSnapshots.push({ id: slugId("price", [instrumentId, normalized.as_of_date, normalized.price]), instrumentId, price: optionalNumber(normalized.price)!, currency: normalized.currency, asOfDate: normalized.as_of_date, source: "manual_workbook", createdAt: now });
    }
  }

  for (const { row, rowNumber } of transactionRows) {
    const normalized = normalizeTransactionRow(row);
    const category = categorySchema.safeParse(normalized.category);
    const currency = currencySchema.safeParse(normalized.currency);
    const amount = Number(normalized.amount);
    if (!normalized.account_name || !normalized.asset_name) { errors.push({ row: rowNumber, message: "Transactions: missing account_name or asset_name" }); continue; }
    if (!supportedAccountTypes.has(normalized.asset_type as Account["type"])) { errors.push({ row: rowNumber, message: "Transactions: unsupported asset_type: " + normalized.asset_type }); continue; }
    if (!category.success) { errors.push({ row: rowNumber, message: "Transactions: invalid category: " + normalized.category }); continue; }
    if (!currency.success) { errors.push({ row: rowNumber, message: "Transactions: invalid currency: " + normalized.currency }); continue; }
    if (!isTransactionType(normalized.transaction_type)) { errors.push({ row: rowNumber, message: "Transactions: invalid transaction_type: " + normalized.transaction_type }); continue; }
    if (!isIsoDate(normalized.date)) { errors.push({ row: rowNumber, message: "Transactions: invalid date: " + normalized.date }); continue; }
    if (!Number.isFinite(amount)) { errors.push({ row: rowNumber, message: "Transactions: invalid amount: " + normalized.amount }); continue; }
    const accountId = ensureAccount(accounts, normalized, now);
    const instrumentId = ensureInstrument(instruments, normalized, now);
    const sourceRecordHash = normalized.transaction_id ? stableHash({ provider: "manual_workbook", transaction_id: normalized.transaction_id }) : stableHash({ sheet: "Transactions", ...normalized, amount });
    transactions.push({
      id: slugId("tx", [sourceRecordHash]),
      accountId,
      instrumentId,
      date: normalized.date,
      type: normalized.transaction_type as Transaction["type"],
      quantity: optionalNumber(normalized.quantity),
      price: optionalNumber(normalized.price),
      amount,
      currency: normalized.currency,
      fees: optionalNumber(normalized.fees) ?? 0,
      taxes: optionalNumber(normalized.taxes) ?? 0,
      source: { type: "import", importId: options.importId, provider: "manual_workbook", sourceRecordHash },
      userModified: false,
      createdAt: now,
      updatedAt: now
    });
  }

  for (const { row, rowNumber } of priceRows) {
    const normalized = normalizePriceRow(row);
    const currency = currencySchema.safeParse(normalized.currency);
    const price = Number(normalized.price);
    if (!normalized.asset_name && !normalized.symbol && !normalized.isin) { errors.push({ row: rowNumber, message: "Prices: missing asset_name, symbol, or isin" }); continue; }
    if (!supportedAccountTypes.has(normalized.asset_type as Account["type"])) { errors.push({ row: rowNumber, message: "Prices: unsupported asset_type: " + normalized.asset_type }); continue; }
    if (!currency.success) { errors.push({ row: rowNumber, message: "Prices: invalid currency: " + normalized.currency }); continue; }
    if (!isIsoDate(normalized.as_of_date)) { errors.push({ row: rowNumber, message: "Prices: invalid as_of_date: " + normalized.as_of_date }); continue; }
    if (!Number.isFinite(price) || price <= 0) { errors.push({ row: rowNumber, message: "Prices: invalid price: " + normalized.price }); continue; }
    const instrumentId = ensureInstrument(instruments, normalized, now);
    priceSnapshots.push({ id: slugId("price", [instrumentId, normalized.as_of_date, String(price)]), instrumentId, price, currency: normalized.currency, asOfDate: normalized.as_of_date, source: "manual_workbook", createdAt: now });
  }

  for (const { row, rowNumber } of fxRows) {
    const from = (row.from_currency ?? "").trim().toUpperCase();
    const to = (row.to_currency ?? "INR").trim().toUpperCase();
    const date = parseDateCell(row.date);
    const rate = Number(cleanNumber(row.rate));
    if (!currencySchema.safeParse(from).success || !currencySchema.safeParse(to).success) { errors.push({ row: rowNumber, message: "FX: invalid currency pair" }); continue; }
    if (!isIsoDate(date)) { errors.push({ row: rowNumber, message: "FX: invalid date: " + date }); continue; }
    if (!Number.isFinite(rate) || rate <= 0) { errors.push({ row: rowNumber, message: "FX: invalid rate: " + row.rate }); continue; }
    priceSnapshots.push({ id: slugId("fx", [from + to, date, String(rate)]), instrumentId: from + to, price: rate, currency: to, asOfDate: date, source: "manual_workbook", createdAt: now });
  }

  return { accounts, instruments, transactions, manualBalances, priceSnapshots, errors };
}

function rowsFromSheet<T extends Record<string, unknown>>(rows: WorkbookRow[]): Array<{ row: T; rowNumber: number }> {
  if (rows.length === 0) return [];
  const headers = rows[0].map((header) => normalizeHeader(String(header ?? "")));
  return rows.slice(1).map((cells, index) => ({
    rowNumber: index + 2,
    row: Object.fromEntries(headers.map((header, cellIndex) => [header, stringifyCell(cells[cellIndex])])) as T
  })).filter(({ row }) => Object.values(row).some((value) => String(value ?? "").trim() !== ""));
}

function ensureAccount(accounts: Account[], row: Required<Pick<ManualCsvRow, "account_name" | "institution" | "asset_type" | "currency">>, now: string): string {
  const accountId = slugId("acct", [row.account_name, row.asset_type, row.currency]);
  if (!accounts.some((account) => account.id === accountId)) {
    accounts.push({ id: accountId, name: row.account_name, institution: row.institution || "Manual", type: row.asset_type as Account["type"], currency: row.currency, createdAt: now, updatedAt: now });
  }
  return accountId;
}

function ensureInstrument(instruments: Instrument[], row: Required<Pick<ManualCsvRow, "asset_name" | "asset_type" | "category" | "currency" | "symbol" | "isin" | "country" | "issuer">>, now: string): string {
  const key = row.isin || row.symbol || row.asset_name;
  const instrumentId = slugId("inst", [row.asset_type, row.currency, key]);
  if (!instruments.some((instrument) => instrument.id === instrumentId)) {
    instruments.push({ id: instrumentId, name: row.asset_name || row.symbol || row.isin, type: row.asset_type as Account["type"], symbol: row.symbol || undefined, isin: row.isin || undefined, currency: row.currency, country: row.country || inferCountry(row.currency), category: categorySchema.safeParse(row.category).success ? row.category as Instrument["category"] : "Others", issuer: row.issuer || undefined, createdAt: now, updatedAt: now });
  }
  return instrumentId;
}

function normalizeRow(row: ManualCsvRow): Required<ManualCsvRow> {
  return {
    account_name: (row.account_name ?? "").trim(),
    institution: (row.institution ?? "Manual").trim(),
    asset_name: (row.asset_name ?? "").trim(),
    asset_type: normalizeAssetType(row.asset_type),
    category: (row.category ?? "Others").trim(),
    currency: (row.currency ?? "INR").trim().toUpperCase(),
    current_value: cleanNumber(row.current_value),
    as_of_date: parseDateCell(row.as_of_date),
    quantity: cleanNumber(row.quantity),
    price: cleanNumber(row.price),
    symbol: (row.symbol ?? "").trim().toUpperCase(),
    isin: (row.isin ?? "").trim().toUpperCase(),
    country: (row.country ?? "").trim().toUpperCase(),
    issuer: (row.issuer ?? "").trim(),
    holding_key: (row.holding_key ?? "").trim(),
    notes: (row.notes ?? "").trim()
  };
}

function normalizeTransactionRow(row: ManualTransactionRow): Required<ManualTransactionRow> {
  return {
    account_name: (row.account_name ?? "").trim(),
    institution: (row.institution ?? "Manual").trim(),
    asset_name: (row.asset_name ?? "").trim(),
    asset_type: normalizeAssetType(row.asset_type),
    category: (row.category ?? "Others").trim(),
    currency: (row.currency ?? "INR").trim().toUpperCase(),
    date: parseDateCell(row.date),
    transaction_type: normalizeTransactionType(row.transaction_type),
    quantity: cleanNumber(row.quantity),
    price: cleanNumber(row.price),
    amount: cleanNumber(row.amount),
    fees: cleanNumber(row.fees),
    taxes: cleanNumber(row.taxes),
    symbol: (row.symbol ?? "").trim().toUpperCase(),
    isin: (row.isin ?? "").trim().toUpperCase(),
    country: (row.country ?? "").trim().toUpperCase(),
    issuer: (row.issuer ?? "").trim(),
    transaction_id: (row.transaction_id ?? "").trim(),
    notes: (row.notes ?? "").trim()
  };
}

function normalizePriceRow(row: ManualPriceRow): Required<ManualPriceRow> {
  return {
    asset_name: (row.asset_name ?? row.symbol ?? row.isin ?? "").trim(),
    asset_type: normalizeAssetType(row.asset_type),
    category: (row.category ?? "Others").trim(),
    currency: (row.currency ?? "INR").trim().toUpperCase(),
    as_of_date: parseDateCell(row.as_of_date),
    price: cleanNumber(row.price),
    symbol: (row.symbol ?? "").trim().toUpperCase(),
    isin: (row.isin ?? "").trim().toUpperCase(),
    country: (row.country ?? "").trim().toUpperCase(),
    issuer: (row.issuer ?? "").trim()
  };
}

function normalizeAssetType(value?: string): string {
  return (value ?? "other").trim().toLowerCase().replace(/[ -]/g, "_");
}

function normalizeTransactionType(value?: string): string {
  return (value ?? "").trim().toLowerCase().replace(/[ -]/g, "_");
}

function isTransactionType(value: string): value is Transaction["type"] {
  return ["buy", "sell", "sip", "redemption", "switch_in", "switch_out", "dividend", "interest", "interest_accrual", "deposit", "withdrawal", "fee", "tax", "maturity", "contribution", "split"].includes(value);
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[ -]/g, "_");
}

function stringifyCell(value: WorkbookCell): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value === null || value === undefined ? "" : String(value).trim();
}

function parseDateCell(value?: string): string {
  const raw = (value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? raw : new Date(parsed).toISOString().slice(0, 10);
}

function cleanNumber(value?: string): string {
  return (value ?? "").trim().replace(/,/g, "");
}

function optionalNumber(value: string): number | undefined {
  if (value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function inferCountry(currency: string): string | undefined {
  if (currency === "INR") return "IN";
  if (currency === "USD") return "US";
  return undefined;
}
