export type ImportProviderId =
  | "canonical_json"
  | "manual_csv"
  | "cas_pdf"
  | "fidelity_csv"
  | "indmoney_export"
  | "epfo_passbook"
  | "nps_statement"
  | "bank_small_savings";

export type ImportSupportStatus = "implemented" | "parser_implemented" | "detected_only" | "research";

export type NativeInputType = "json" | "csv" | "pdf" | "html" | "xlsx" | "unknown";

export type ProviderImportSpec = {
  id: ImportProviderId;
  label: string;
  status: ImportSupportStatus;
  nativeInputTypes: NativeInputType[];
  assetTypes: string[];
  categories: Array<"Equity" | "Debt" | "Gold" | "Others" | "Cash">;
  implementation: string;
};

export const providerImportSpecs: ProviderImportSpec[] = [
  {
    id: "canonical_json",
    label: "Canonical JSON backup",
    status: "implemented",
    nativeInputTypes: ["json"],
    assetTypes: ["all"],
    categories: ["Equity", "Debt", "Gold", "Others", "Cash"],
    implementation: "Restores the internal versioned backup schema."
  },
  {
    id: "manual_csv",
    label: "Manual canonical CSV",
    status: "implemented",
    nativeInputTypes: ["csv"],
    assetTypes: ["mutual_fund", "indian_stock", "us_stock", "fd", "ppf", "ssy", "nps", "epf", "cash", "espp", "gold", "other"],
    categories: ["Equity", "Debt", "Gold", "Others", "Cash"],
    implementation: "Manual fallback importer implemented in src/importers/manualCsv.ts."
  },
  {
    id: "cas_pdf",
    label: "CAMS / KFintech / NSDL / CDSL CAS PDF",
    status: "implemented",
    nativeInputTypes: ["pdf"],
    assetTypes: ["mutual_fund", "indian_stock"],
    categories: ["Equity", "Debt", "Gold", "Others"],
    implementation: "Browser CAS PDF upload, password extraction, staging, and canonical normalization are implemented and privately verified against a local private CAS PDF."
  },
  {
    id: "fidelity_csv",
    label: "Fidelity positions/history CSV",
    status: "detected_only",
    nativeInputTypes: ["csv"],
    assetTypes: ["us_stock", "cash"],
    categories: ["Equity", "Cash", "Others"],
    implementation: "Native CSV format detection exists for Fidelity positions and history exports."
  },
  {
    id: "indmoney_export",
    label: "INDMoney export",
    status: "implemented",
    nativeInputTypes: ["csv", "xlsx", "pdf", "unknown"],
    assetTypes: ["us_stock", "mutual_fund", "indian_stock"],
    categories: ["Equity", "Debt", "Gold", "Others", "Cash"],
    implementation: "INDMoney Transactions Ledger XLSX parser is implemented for US stock transactions, dividends, taxes, cash movements, stock splits, and open-position balances."
  },
  {
    id: "epfo_passbook",
    label: "EPFO / PF passbook",
    status: "implemented",
    nativeInputTypes: ["pdf", "html"],
    assetTypes: ["epf"],
    categories: ["Debt"],
    implementation: "Browser PF PDF parsing, staged review, and canonical EPF/EPS balance import are implemented and privately verified against a local PF PDF."
  },
  {
    id: "nps_statement",
    label: "NPS statement",
    status: "parser_implemented",
    nativeInputTypes: ["pdf", "xlsx", "csv"],
    assetTypes: ["nps"],
    categories: ["Debt", "Equity", "Others"],
    implementation: "Yearly NPS CSV statement parsing, staged review, scheme balances, NAV snapshots, and transaction import are implemented and privately verified. PDF/XLSX NPS files remain detected-only until real fixtures are available."
  },
  {
    id: "bank_small_savings",
    label: "PPF / SSY / FD bank or post-office statement",
    status: "detected_only",
    nativeInputTypes: ["pdf", "csv", "xlsx"],
    assetTypes: ["ppf", "ssy", "fd"],
    categories: ["Debt"],
    implementation: "Native statement detection exists; provider-specific parsers need verified bank/post-office fixtures."
  }
];

export function getProviderImportSpec(id: ImportProviderId): ProviderImportSpec {
  const spec = providerImportSpecs.find((provider) => provider.id === id);
  if (!spec) throw new Error(`Unknown import provider: ${id}`);
  return spec;
}
