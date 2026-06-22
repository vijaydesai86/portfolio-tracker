import Papa from "papaparse";
import { categorySchema, currencySchema, type Account, type ManualBalance } from "@/src/schema/backup";
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
  manualBalances: ManualBalance[];
  errors: ImportError[];
};

type ManualCsvRow = {
  account_name?: string;
  asset_name?: string;
  asset_type?: string;
  category?: string;
  currency?: string;
  current_value?: string;
  as_of_date?: string;
  notes?: string;
};

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
  const manualBalances: ManualBalance[] = [];
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

    const accountId = slugId("acct", [normalized.account_name, normalized.asset_type, normalized.currency]);
    if (!accounts.some((account) => account.id === accountId)) {
      accounts.push({
        id: accountId,
        name: normalized.account_name,
        institution: "Manual",
        type: normalized.asset_type as Account["type"],
        currency: normalized.currency,
        createdAt: now,
        updatedAt: now
      });
    }

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
      label: normalized.asset_name,
      category: category.data,
      currency: normalized.currency,
      value,
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

  return { accounts, manualBalances, errors };
}

function normalizeRow(row: ManualCsvRow): Required<ManualCsvRow> {
  return {
    account_name: (row.account_name ?? "").trim(),
    asset_name: (row.asset_name ?? "").trim(),
    asset_type: (row.asset_type ?? "other").trim().toLowerCase().replace(/[ -]/g, "_"),
    category: (row.category ?? "Others").trim(),
    currency: (row.currency ?? "INR").trim().toUpperCase(),
    current_value: (row.current_value ?? "").trim().replace(/,/g, ""),
    as_of_date: (row.as_of_date ?? "").trim(),
    notes: (row.notes ?? "").trim()
  };
}
