import Papa from "papaparse";
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

type ManualCsvRow = Record<string, string | undefined>;
type NormalizedBalanceRow = Required<{
  balance_id: string;
  account_name: string;
  institution: string;
  asset_name: string;
  asset_type: string;
  category: string;
  currency: string;
  current_value: string;
  invested_amount: string;
  invested_currency: string;
  invested_as_of_date: string;
  as_of_date: string;
  quantity: string;
  price: string;
  symbol: string;
  isin: string;
  country: string;
  issuer: string;
  notes: string;
}>;

type NormalizedTransactionRow = Required<{
  transaction_id: string;
  account_name: string;
  institution: string;
  asset_name: string;
  asset_type: string;
  category: string;
  currency: string;
  date: string;
  transaction_type: string;
  quantity: string;
  price: string;
  amount: string;
  fx_rate: string;
  fees: string;
  taxes: string;
  symbol: string;
  isin: string;
  country: string;
  issuer: string;
  notes: string;
  tax_fmv_price: string;
}>;

type NormalizedLedgerRow = Required<{
  transaction_id: string;
  account_name: string;
  institution: string;
  asset_name: string;
  asset_type: string;
  category: string;
  currency: string;
  date: string;
  ledger_type: string;
  amount: string;
  symbol: string;
  isin: string;
  country: string;
  issuer: string;
  notes: string;
}>;

type PositionAccumulator = {
  accountId: string;
  instrumentId: string;
  label: string;
  category: AccountCategory;
  currency: string;
  quantity: number;
  lastPrice?: number;
  lastPriceDate?: string;
  latestDate: string;
  notes?: string;
};

type LedgerAccumulator = {
  accountId: string;
  instrumentId: string;
  label: string;
  category: AccountCategory;
  currency: string;
  value: number;
  investedAmount: number;
  investedAsOfDate?: string;
  latestDate: string;
  notes?: string;
};

type AccountCategory = ManualBalance["category"];

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

const dynamicPositionTypes = new Set<Account["type"]>(["mutual_fund", "indian_stock", "us_stock", "gold"]);

export function parseManualCsv(csv: string, options: ManualCsvParseOptions): ManualCsvResult {
  const parsed = Papa.parse<ManualCsvRow>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeHeader
  });

  const headers = (parsed.meta.fields ?? []).map(normalizeHeader);
  if (looksLikeBalanceLedgerTemplate(headers)) return parseBalanceLedgerCsvRows(parsed.data, options);
  if (looksLikeTransactionTemplate(headers)) return parseTransactionCsvRows(parsed.data, options);
  return parseBalanceCsvRows(parsed.data, options);
}

function parseBalanceCsvRows(rows: ManualCsvRow[], options: ManualCsvParseOptions): ManualCsvResult {
  const now = options.now ?? new Date().toISOString();
  const accounts: Account[] = [];
  const instruments: Instrument[] = [];
  const transactions: Transaction[] = [];
  const manualBalances: ManualBalance[] = [];
  const priceSnapshots: PriceSnapshot[] = [];
  const errors: ImportError[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const normalized = normalizeBalanceRow(row);
    const category = categorySchema.safeParse(normalized.category);
    const currency = currencySchema.safeParse(normalized.currency);
    const value = Number(normalized.current_value);
    const investedAmount = optionalNumber(normalized.invested_amount);
    const investedCurrency = normalized.invested_currency || normalized.currency;
    const investedAsOfDate = normalized.invested_as_of_date || normalized.as_of_date;

    if (!normalized.account_name || !normalized.asset_name) {
      errors.push({ row: rowNumber, message: "Missing account/institution or name" });
      return;
    }
    if (!supportedAccountTypes.has(normalized.asset_type as Account["type"])) {
      errors.push({ row: rowNumber, message: "Unsupported asset_type: " + normalized.asset_type });
      return;
    }
    if (!category.success) {
      errors.push({ row: rowNumber, message: "Invalid category: " + normalized.category });
      return;
    }
    if (!currency.success) {
      errors.push({ row: rowNumber, message: "Invalid currency: " + normalized.currency });
      return;
    }
    if (!Number.isFinite(value)) {
      errors.push({ row: rowNumber, message: "Invalid current_value: " + normalized.current_value });
      return;
    }
    if (!isIsoDate(normalized.as_of_date)) {
      errors.push({ row: rowNumber, message: "Invalid as_of_date: " + normalized.as_of_date });
      return;
    }
    if (investedAmount !== undefined && !currencySchema.safeParse(investedCurrency).success) {
      errors.push({ row: rowNumber, message: "Invalid invested_currency: " + investedCurrency });
      return;
    }
    if (investedAmount !== undefined && !isIsoDate(investedAsOfDate)) {
      errors.push({ row: rowNumber, message: "Invalid invested_as_of_date: " + investedAsOfDate });
      return;
    }

    const accountId = ensureAccount(accounts, normalized, now);
    const instrumentId = ensureInstrument(instruments, normalized, now);
    const logicalKey = normalized.balance_id || accountId + "|" + instrumentId;
    const sourceRecordHash = stableHash({ provider: "manual_balances", logicalKey });

    manualBalances.push({
      id: slugId("bal", ["manual_balances", logicalKey]),
      accountId,
      instrumentId,
      label: normalized.asset_name,
      category: category.data,
      currency: normalized.currency,
      value,
      investedAmount,
      investedCurrency: investedAmount === undefined ? undefined : investedCurrency,
      investedAsOfDate: investedAmount === undefined ? undefined : investedAsOfDate,
      quantity: optionalNumber(normalized.quantity),
      price: optionalNumber(normalized.price),
      asOfDate: normalized.as_of_date,
      notes: normalized.notes || undefined,
      source: {
        type: "import",
        importId: options.importId,
        provider: "manual_balances",
        sourceRecordHash
      },
      userModified: false,
      createdAt: now,
      updatedAt: now
    });

    const price = optionalNumber(normalized.price);
    if (price !== undefined && price > 0) {
      priceSnapshots.push({
        id: slugId("price", [instrumentId, normalized.as_of_date, String(price), "manual_balances"]),
        instrumentId,
        price,
        currency: normalized.currency,
        asOfDate: normalized.as_of_date,
        source: "manual_balances",
        createdAt: now
      });
    }
  });

  return { accounts, instruments, transactions, manualBalances, priceSnapshots, errors };
}

function parseTransactionCsvRows(rows: ManualCsvRow[], options: ManualCsvParseOptions): ManualCsvResult {
  const now = options.now ?? new Date().toISOString();
  const accounts: Account[] = [];
  const instruments: Instrument[] = [];
  const transactions: Transaction[] = [];
  const manualBalances: ManualBalance[] = [];
  const priceSnapshots: PriceSnapshot[] = [];
  const errors: ImportError[] = [];
  const positions = new Map<string, PositionAccumulator>();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const normalized = normalizeTransactionRow(row);
    const category = categorySchema.safeParse(normalized.category);
    const currency = currencySchema.safeParse(normalized.currency);
    const quantity = optionalNumber(normalized.quantity);
    const price = optionalNumber(normalized.price);
    const amount = deriveAmount(normalized.amount, quantity, price, normalized.transaction_type);

    if (!normalized.account_name || !normalized.asset_name) {
      errors.push({ row: rowNumber, message: "Missing platform/account or name" });
      return;
    }
    if (!supportedAccountTypes.has(normalized.asset_type as Account["type"])) {
      errors.push({ row: rowNumber, message: "Unsupported asset_type: " + normalized.asset_type });
      return;
    }
    if (!category.success) {
      errors.push({ row: rowNumber, message: "Invalid category: " + normalized.category });
      return;
    }
    if (!currency.success) {
      errors.push({ row: rowNumber, message: "Invalid currency: " + normalized.currency });
      return;
    }
    if (!isTransactionType(normalized.transaction_type)) {
      errors.push({ row: rowNumber, message: "Invalid type: " + normalized.transaction_type });
      return;
    }
    if (!isIsoDate(normalized.date)) {
      errors.push({ row: rowNumber, message: "Invalid date: " + normalized.date });
      return;
    }
    if (!Number.isFinite(amount)) {
      errors.push({ row: rowNumber, message: "Invalid amount. Enter amount, or quantity and price." });
      return;
    }

    const accountId = ensureAccount(accounts, normalized, now);
    const instrumentId = ensureInstrument(instruments, normalized, now);
    const sourceRecordHash = stableHash({
      provider: "manual_transactions",
      transaction_id: normalized.transaction_id || undefined,
      date: normalized.date,
      account_name: normalized.account_name,
      asset_type: normalized.asset_type,
      symbol: normalized.symbol,
      isin: normalized.isin,
      asset_name: normalized.asset_name,
      transaction_type: normalized.transaction_type,
      quantity,
      price,
      amount,
      fxRate: optionalNumber(normalized.fx_rate),
      fees: optionalNumber(normalized.fees) ?? 0,
      taxes: optionalNumber(normalized.taxes) ?? 0,
      currency: normalized.currency
    });

    transactions.push({
      id: slugId("tx", [sourceRecordHash]),
      accountId,
      instrumentId,
      date: normalized.date,
      type: normalized.transaction_type as Transaction["type"],
      quantity,
      price,
      amount,
      currency: normalized.currency,
      taxFmvPrice: optionalNumber(normalized.tax_fmv_price),
      fees: optionalNumber(normalized.fees) ?? 0,
      taxes: optionalNumber(normalized.taxes) ?? 0,
      source: { type: "import", importId: options.importId, provider: "manual_transactions", sourceRecordHash },
      userModified: false,
      createdAt: now,
      updatedAt: now
    });

    if (price !== undefined && price > 0) {
      priceSnapshots.push({
        id: slugId("price", [instrumentId, normalized.date, String(price), "manual_transactions"]),
        instrumentId,
        price,
        currency: normalized.currency,
        asOfDate: normalized.date,
        source: "manual_transactions",
        createdAt: now
      });
    }

    const fxRate = optionalNumber(normalized.fx_rate);
    if (normalized.currency === "USD" && fxRate !== undefined && fxRate > 0) {
      priceSnapshots.push({
        id: slugId("price", ["USDINR", normalized.date, String(fxRate), "manual_transactions_fx"]),
        instrumentId: "USDINR",
        price: fxRate,
        currency: "INR",
        asOfDate: normalized.date,
        source: "manual_transactions_fx",
        createdAt: now
      });
    }

    if (dynamicPositionTypes.has(normalized.asset_type as Account["type"]) && quantity !== undefined) {
      const delta = positionQuantityDelta(normalized.transaction_type as Transaction["type"], quantity);
      if (delta !== 0 || price !== undefined) {
        const key = accountId + "|" + instrumentId;
        const existing = positions.get(key) ?? {
          accountId,
          instrumentId,
          label: normalized.asset_name,
          category: category.data,
          currency: normalized.currency,
          quantity: 0,
          latestDate: normalized.date,
          notes: "Derived from manual transaction CSV. Market refresh replaces the latest transaction price when a real quote or NAV is available."
        };
        existing.quantity += delta;
        if (price !== undefined && price > 0) {
          existing.lastPrice = price;
          existing.lastPriceDate = normalized.date;
        }
        if (normalized.date > existing.latestDate) existing.latestDate = normalized.date;
        positions.set(key, existing);
      }
    }
  });

  for (const position of positions.values()) {
    if (position.quantity <= 0 || position.lastPrice === undefined) continue;
    const logicalKey = position.accountId + "|" + position.instrumentId;
    const sourceRecordHash = stableHash({ provider: "manual_positions", logicalKey });
    manualBalances.push({
      id: slugId("bal", ["manual_positions", logicalKey]),
      accountId: position.accountId,
      instrumentId: position.instrumentId,
      label: position.label,
      category: position.category,
      currency: position.currency,
      value: roundMoney(position.quantity * position.lastPrice),
      quantity: roundQuantity(position.quantity),
      price: position.lastPrice,
      asOfDate: position.lastPriceDate ?? position.latestDate,
      notes: position.notes,
      source: { type: "import", importId: options.importId, provider: "manual_positions", sourceRecordHash },
      userModified: false,
      createdAt: now,
      updatedAt: now
    });
  }

  return { accounts, instruments, transactions, manualBalances, priceSnapshots, errors };
}

function parseBalanceLedgerCsvRows(rows: ManualCsvRow[], options: ManualCsvParseOptions): ManualCsvResult {
  const now = options.now ?? new Date().toISOString();
  const accounts: Account[] = [];
  const instruments: Instrument[] = [];
  const transactions: Transaction[] = [];
  const manualBalances: ManualBalance[] = [];
  const priceSnapshots: PriceSnapshot[] = [];
  const errors: ImportError[] = [];
  const balances = new Map<string, LedgerAccumulator>();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const normalized = normalizeLedgerRow(row);
    const category = categorySchema.safeParse(normalized.category);
    const currency = currencySchema.safeParse(normalized.currency);
    const amount = optionalNumber(normalized.amount);

    if (!normalized.transaction_id) {
      errors.push({ row: rowNumber, message: "Missing ID" });
      return;
    }
    if (!normalized.asset_name) {
      errors.push({ row: rowNumber, message: "Missing asset name/type" });
      return;
    }
    if (!supportedAccountTypes.has(normalized.asset_type as Account["type"])) {
      errors.push({ row: rowNumber, message: "Unsupported asset_type: " + normalized.asset_type });
      return;
    }
    if (!category.success) {
      errors.push({ row: rowNumber, message: "Invalid category: " + normalized.category });
      return;
    }
    if (!currency.success) {
      errors.push({ row: rowNumber, message: "Invalid currency: " + normalized.currency });
      return;
    }
    if (!isLedgerType(normalized.ledger_type)) {
      errors.push({ row: rowNumber, message: "Invalid type: " + normalized.ledger_type });
      return;
    }
    if (!isIsoDate(normalized.date)) {
      errors.push({ row: rowNumber, message: "Invalid date: " + normalized.date });
      return;
    }
    if (amount === undefined || amount < 0) {
      errors.push({ row: rowNumber, message: "Invalid amount/name: " + normalized.amount });
      return;
    }

    const accountId = ensureAccount(accounts, normalized, now);
    const instrumentId = ensureInstrument(instruments, normalized, now);
    const key = accountId + "|" + instrumentId;
    const existing = balances.get(key) ?? {
      accountId,
      instrumentId,
      label: normalized.asset_name,
      category: category.data,
      currency: normalized.currency,
      value: 0,
      investedAmount: 0,
      latestDate: normalized.date,
      notes: "Derived from compact manual balance ledger. Invest rows add invested/current value; interest rows add current value only."
    };

    existing.value = roundMoney(existing.value + ledgerValueDelta(normalized.ledger_type, amount));
    existing.investedAmount = roundMoney(Math.max(0, existing.investedAmount + ledgerInvestedDelta(normalized.ledger_type, amount)));
    if (ledgerInvestedDelta(normalized.ledger_type, amount) > 0 && (!existing.investedAsOfDate || normalized.date < existing.investedAsOfDate)) existing.investedAsOfDate = normalized.date;
    if (normalized.date > existing.latestDate) existing.latestDate = normalized.date;
    balances.set(key, existing);

    if (amount === 0) return;
    const sourceRecordHash = stableHash({
      provider: "manual_balance_ledger",
      transaction_id: normalized.transaction_id,
      date: normalized.date,
      asset_type: normalized.asset_type,
      asset_name: normalized.asset_name,
      ledger_type: normalized.ledger_type,
      amount,
      currency: normalized.currency
    });

    transactions.push({
      id: slugId("tx", [sourceRecordHash]),
      accountId,
      instrumentId,
      date: normalized.date,
      type: ledgerTransactionType(normalized.asset_type, normalized.ledger_type),
      amount,
      currency: normalized.currency,
      fees: 0,
      taxes: 0,
      source: { type: "import", importId: options.importId, provider: "manual_balance_ledger", sourceRecordHash },
      userModified: false,
      createdAt: now,
      updatedAt: now
    });
  });

  for (const balance of balances.values()) {
    const logicalKey = balance.accountId + "|" + balance.instrumentId;
    const sourceRecordHash = stableHash({ provider: "manual_balance_ledger", logicalKey });
    manualBalances.push({
      id: slugId("bal", ["manual_balance_ledger", logicalKey]),
      accountId: balance.accountId,
      instrumentId: balance.instrumentId,
      label: balance.label,
      category: balance.category,
      currency: balance.currency,
      value: roundMoney(Math.max(0, balance.value)),
      investedAmount: roundMoney(Math.max(0, balance.investedAmount)),
      investedCurrency: balance.currency,
      investedAsOfDate: balance.investedAsOfDate ?? balance.latestDate,
      asOfDate: balance.latestDate,
      notes: balance.notes,
      source: { type: "import", importId: options.importId, provider: "manual_balance_ledger", sourceRecordHash },
      userModified: false,
      createdAt: now,
      updatedAt: now
    });
  }

  return { accounts, instruments, transactions, manualBalances, priceSnapshots, errors };
}

function looksLikeBalanceLedgerTemplate(headers: string[]): boolean {
  const headerSet = new Set(headers);
  const hasLedgerShape = headerSet.has("id") && headerSet.has("date") && headerSet.has("asset_type") && headerSet.has("type") && headerSet.has("currency") && headerSet.has("category");
  const hasAmountLikeColumn = headerSet.has("amount") || headerSet.has("value") || headerSet.has("name");
  const hasDynamicColumns = headerSet.has("quantity") || headerSet.has("price") || headerSet.has("symbol_or_isin") || headerSet.has("symbol") || headerSet.has("isin");
  return hasLedgerShape && hasAmountLikeColumn && !hasDynamicColumns;
}

function looksLikeTransactionTemplate(headers: string[]): boolean {
  const headerSet = new Set(headers);
  return headerSet.has("date") && headerSet.has("asset_type") && (headerSet.has("type") || headerSet.has("transaction_type")) && (headerSet.has("symbol_or_isin") || headerSet.has("symbol") || headerSet.has("isin") || headerSet.has("name") || headerSet.has("asset_name"));
}

function ensureAccount(accounts: Account[], row: Pick<NormalizedBalanceRow | NormalizedTransactionRow | NormalizedLedgerRow, "account_name" | "institution" | "asset_type" | "currency">, now: string): string {
  const accountId = slugId("acct", [row.account_name, row.asset_type, row.currency]);
  if (!accounts.some((account) => account.id === accountId)) {
    accounts.push({ id: accountId, name: row.account_name, institution: row.institution || "Manual", type: row.asset_type as Account["type"], currency: row.currency, createdAt: now, updatedAt: now });
  }
  return accountId;
}

function ensureInstrument(instruments: Instrument[], row: Pick<NormalizedBalanceRow | NormalizedTransactionRow | NormalizedLedgerRow, "asset_name" | "asset_type" | "category" | "currency" | "symbol" | "isin" | "country" | "issuer">, now: string): string {
  const key = row.isin || row.symbol || row.asset_name;
  const instrumentId = slugId("inst", [row.asset_type, row.currency, key]);
  if (!instruments.some((instrument) => instrument.id === instrumentId)) {
    instruments.push({ id: instrumentId, name: row.asset_name || row.symbol || row.isin, type: row.asset_type as Account["type"], symbol: row.symbol || undefined, isin: row.isin || undefined, currency: row.currency, country: row.country || inferCountry(row.asset_type, row.currency), category: categorySchema.safeParse(row.category).success ? row.category as Instrument["category"] : categoryForAssetType(row.asset_type), issuer: row.issuer || undefined, createdAt: now, updatedAt: now });
  }
  return instrumentId;
}

function normalizeBalanceRow(row: ManualCsvRow): NormalizedBalanceRow {
  const assetType = normalizeAssetType(pick(row, "asset_type", "type_of_asset"));
  const currency = normalizeCurrency(pick(row, "currency"), assetType);
  const symbolFields = normalizeSymbolOrIsin(pick(row, "symbol_or_isin", "ticker", "symbol", "isin"));
  const institution = pick(row, "institution", "platform", "broker", "bank", "provider") || "Manual";
  const assetName = pick(row, "name", "asset_name", "holding_name", "instrument_name") || symbolFields.symbol || symbolFields.isin;
  return {
    balance_id: pick(row, "balance_id", "holding_key", "id"),
    account_name: pick(row, "account", "account_name") || institution,
    institution,
    asset_name: assetName,
    asset_type: assetType,
    category: normalizeCategory(pick(row, "category", "asset_category"), assetType),
    currency,
    current_value: cleanNumber(pick(row, "current_value", "value", "balance", "market_value")),
    invested_amount: cleanNumber(pick(row, "invested_amount", "invested", "cost_basis", "contribution_amount")),
    invested_currency: pick(row, "invested_currency") ? normalizeCurrency(pick(row, "invested_currency"), assetType) : "",
    invested_as_of_date: parseDateCell(pick(row, "invested_as_of_date", "invested_date", "contribution_date")) || parseDateCell(pick(row, "as_of_date", "date", "valuation_date")),
    as_of_date: parseDateCell(pick(row, "as_of_date", "date", "valuation_date")),
    quantity: cleanNumber(pick(row, "quantity", "units", "shares")),
    price: cleanNumber(pick(row, "price", "price_($)", "price_$", "price_usd", "nav", "unit_price")),
    symbol: symbolFields.symbol || pick(row, "symbol", "ticker").toUpperCase(),
    isin: symbolFields.isin || pick(row, "isin").toUpperCase(),
    country: pick(row, "country", "region").toUpperCase(),
    issuer: pick(row, "issuer", "amc", "fund_house"),
    notes: pick(row, "notes", "description")
  };
}

function normalizeTransactionRow(row: ManualCsvRow): NormalizedTransactionRow {
  const assetType = normalizeAssetType(pick(row, "asset_type", "type_of_asset"));
  const currency = normalizeCurrency(pick(row, "currency"), assetType);
  const symbolFields = normalizeSymbolOrIsin(pick(row, "symbol_or_isin", "ticker", "symbol", "isin"));
  const institution = pick(row, "platform", "broker", "institution", "provider", "bank") || "Manual";
  const assetName = pick(row, "name", "asset_name", "instrument_name") || symbolFields.symbol || symbolFields.isin;
  return {
    transaction_id: pick(row, "transaction_id", "tx_id", "id"),
    account_name: pick(row, "account", "account_name") || institution,
    institution,
    asset_name: assetName,
    asset_type: assetType,
    category: normalizeCategory(pick(row, "category", "asset_category"), assetType),
    currency,
    date: parseDateCell(pick(row, "date", "transaction_date")),
    transaction_type: normalizeTransactionType(pick(row, "type", "transaction_type", "action")),
    quantity: cleanNumber(pick(row, "quantity", "units", "shares")),
    price: cleanNumber(pick(row, "price", "price_($)", "price_$", "price_usd", "nav", "unit_price")),
    amount: cleanNumber(pick(row, "amount", "net_amount", "gross_amount")),
    fx_rate: cleanNumber(pick(row, "usd_inr", "usd/inr", "fx_rate", "fx", "conversion_rate")),
    fees: cleanNumber(pick(row, "fees", "fee", "charges", "commission")),
    taxes: cleanNumber(pick(row, "taxes", "tax", "withholding_tax")),
    symbol: symbolFields.symbol || pick(row, "symbol", "ticker").toUpperCase(),
    isin: symbolFields.isin || pick(row, "isin").toUpperCase(),
    country: pick(row, "country", "region").toUpperCase(),
    issuer: pick(row, "issuer", "amc", "fund_house"),
    notes: pick(row, "notes", "description"),
    tax_fmv_price: cleanNumber(pick(row, "fmv", "tax_fmv", "tax_fmv_price", "fair_market_value", "tax_price"))
  };
}

function normalizeLedgerRow(row: ManualCsvRow): NormalizedLedgerRow {
  const assetType = normalizeAssetType(pick(row, "asset_type", "type_of_asset"));
  const currency = normalizeCurrency(pick(row, "currency"), assetType);
  const nameCell = pick(row, "name");
  const amount = cleanNumber(pick(row, "amount", "value", "current_value") || (looksNumeric(nameCell) ? nameCell : ""));
  const assetName = pick(row, "asset_name", "holding_name", "instrument_name") || (!looksNumeric(nameCell) ? nameCell : "") || ledgerAssetName(assetType, currency);
  return {
    transaction_id: pick(row, "id", "transaction_id", "tx_id"),
    account_name: pick(row, "account", "account_name", "institution") || assetName,
    institution: pick(row, "institution", "platform", "provider", "bank") || "Manual Ledger",
    asset_name: assetName,
    asset_type: assetType,
    category: normalizeCategory(pick(row, "category", "asset_category"), assetType),
    currency,
    date: parseLedgerDateCell(pick(row, "date", "transaction_date")),
    ledger_type: normalizeLedgerType(pick(row, "type", "transaction_type", "action")),
    amount,
    symbol: "",
    isin: "",
    country: pick(row, "country", "region").toUpperCase(),
    issuer: pick(row, "issuer"),
    notes: pick(row, "notes", "description")
  };
}

function pick(row: ManualCsvRow, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[normalizeHeader(key)];
    if (value !== undefined && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function normalizeSymbolOrIsin(value: string): { symbol: string; isin: string } {
  const cleaned = value.trim().toUpperCase();
  if (!cleaned) return { symbol: "", isin: "" };
  if (/^[A-Z]{2}[A-Z0-9]{10}$/.test(cleaned)) return { symbol: "", isin: cleaned };
  return { symbol: cleaned, isin: "" };
}

function normalizeAssetType(value?: string): string {
  const normalized = (value ?? "other").trim().toLowerCase().replace(/[ /-]/g, "_");
  const aliases: Record<string, Account["type"]> = {
    mf: "mutual_fund",
    mutualfund: "mutual_fund",
    mutual_funds: "mutual_fund",
    india_stock: "indian_stock",
    indian_equity: "indian_stock",
    us_equity: "us_stock",
    usa_stock: "us_stock",
    fidelity: "us_stock",
    pf: "epf",
    epfo: "epf",
    epf_pf: "epf",
    fixed_deposit: "fd",
    deposits: "fd",
    espp_contribution: "espp",
    gold_etf: "gold"
  };
  return aliases[normalized] ?? normalized;
}

function normalizeCurrency(value: string, assetType: string): string {
  const normalized = value.trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(normalized)) return normalized;
  if (assetType === "us_stock" || assetType === "espp") return "USD";
  return "INR";
}

function normalizeCategory(value: string, assetType: string): string {
  const normalized = value.trim();
  if (!normalized) return categoryForAssetType(assetType);
  const title = normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
  if (categorySchema.safeParse(title).success) return title;
  return normalized;
}

function categoryForAssetType(assetType: string): AccountCategory {
  if (assetType === "cash") return "Cash";
  if (["fd", "ppf", "ssy", "epf"].includes(assetType)) return "Debt";
  if (["mutual_fund", "indian_stock", "us_stock", "espp"].includes(assetType)) return "Equity";
  if (assetType === "gold") return "Gold";
  return "Others";
}

function normalizeLedgerType(value?: string): string {
  const normalized = (value ?? "").trim().toLowerCase().replace(/[ /-]/g, "_");
  const aliases: Record<string, "invest" | "interest" | "withdrawal" | "maturity"> = {
    investment: "invest",
    contribution: "invest",
    deposit: "invest",
    cash_in: "invest",
    interest_accrual: "interest",
    accrued_interest: "interest",
    withdraw: "withdrawal",
    cash_out: "withdrawal",
    closure: "maturity"
  };
  return aliases[normalized] ?? normalized;
}

function isLedgerType(value: string): value is "invest" | "interest" | "withdrawal" | "maturity" {
  return ["invest", "interest", "withdrawal", "maturity"].includes(value);
}

function ledgerTransactionType(assetType: string, ledgerType: "invest" | "interest" | "withdrawal" | "maturity"): Transaction["type"] {
  if (ledgerType === "interest") return "interest_accrual";
  if (ledgerType === "withdrawal") return "withdrawal";
  if (ledgerType === "maturity") return "maturity";
  return assetType === "cash" ? "deposit" : "contribution";
}

function ledgerValueDelta(type: "invest" | "interest" | "withdrawal" | "maturity", amount: number): number {
  if (type === "withdrawal" || type === "maturity") return -Math.abs(amount);
  return Math.abs(amount);
}

function ledgerInvestedDelta(type: "invest" | "interest" | "withdrawal" | "maturity", amount: number): number {
  if (type === "invest") return Math.abs(amount);
  if (type === "withdrawal" || type === "maturity") return -Math.abs(amount);
  return 0;
}

function ledgerAssetName(assetType: string, currency: string): string {
  const labels: Record<string, string> = {
    ppf: "Public Provident Fund",
    ssy: "Sukanya Samriddhi Account",
    espp: "ESPP Contribution",
    cash: currency === "USD" ? "Cash Balance USD" : "Cash Balance",
    epf: "EPF Balance",
    fd: "Fixed Deposit",
    nps: "NPS Manual Balance",
    gold: "Manual Gold Holding"
  };
  return labels[assetType] ?? assetType.toUpperCase();
}

function looksNumeric(value: string): boolean {
  const cleaned = cleanNumber(value);
  return cleaned !== "" && Number.isFinite(Number(cleaned));
}

function normalizeTransactionType(value?: string): string {
  const normalized = (value ?? "").trim().toLowerCase().replace(/[ /-]/g, "_");
  const aliases: Record<string, Transaction["type"]> = {
    purchase: "buy",
    bought: "buy",
    invest: "buy",
    investment: "buy",
    sale: "sell",
    sold: "sell",
    redeem: "redemption",
    contribution: "contribution",
    contributed: "contribution",
    cash_in: "deposit",
    cash_out: "withdrawal"
  };
  return aliases[normalized] ?? normalized;
}

function isTransactionType(value: string): value is Transaction["type"] {
  return ["buy", "sell", "sip", "redemption", "switch_in", "switch_out", "dividend", "interest", "interest_accrual", "deposit", "withdrawal", "fee", "tax", "maturity", "contribution", "split"].includes(value);
}

function deriveAmount(rawAmount: string, quantity: number | undefined, price: number | undefined, transactionType: string): number {
  if (rawAmount !== "") return Number(rawAmount);
  if (quantity !== undefined && price !== undefined) return roundMoney(Math.abs(quantity * price));
  if (["split"].includes(transactionType)) return 0;
  return Number.NaN;
}

function positionQuantityDelta(type: Transaction["type"], quantity: number): number {
  const absolute = Math.abs(quantity);
  if (["buy", "sip", "switch_in", "contribution"].includes(type)) return absolute;
  if (["sell", "redemption", "switch_out", "withdrawal", "maturity"].includes(type)) return -absolute;
  if (type === "split") return quantity;
  return 0;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[ /-]/g, "_");
}

function parseLedgerDateCell(value?: string): string {
  const raw = (value ?? "").trim();
  const monthNames: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const named = raw.match(/^(\d{1,2})[-\s]([A-Za-z]{3,4})[-\s](\d{2}|\d{4})$/);
  if (named) {
    const day = Number(named[1]);
    const month = monthNames[named[2].toLowerCase()];
    const yearNumber = Number(named[3]);
    const year = named[3].length === 2 ? 2000 + yearNumber : yearNumber;
    if (month && isValidDateParts(year, month, day)) return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  }

  const numeric = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const year = Number(numeric[3]);
    if (isValidDateParts(year, month, day)) return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  }

  return parseDateCell(raw);
}

function parseDateCell(value?: string): string {
  const raw = (value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const year = Number(slash[3]);
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    if (isValidDateParts(year, month, day)) return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  }

  const dash = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dash) {
    const day = Number(dash[1]);
    const month = Number(dash[2]);
    const year = Number(dash[3]);
    if (isValidDateParts(year, month, day)) return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  }

  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return raw;
  const date = new Date(parsed);
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function cleanNumber(value?: string): string {
  return (value ?? "").trim().replace(/,/g, "");
}

function optionalNumber(value: string): number | undefined {
  if (value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function inferCountry(assetType: string, currency: string): string | undefined {
  if (assetType === "indian_stock" || currency === "INR") return "IN";
  if (assetType === "us_stock" || currency === "USD") return "US";
  return undefined;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000000) / 1000000;
}
