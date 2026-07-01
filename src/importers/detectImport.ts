import { providerImportSpecs, type ImportProviderId, type ImportSupportStatus, type NativeInputType } from "@/src/importers/providerRegistry";

export type ImportDetectionInput = {
  fileName: string;
  mimeType?: string;
  textSample?: string;
};

export type ImportDetection = {
  providerId: ImportProviderId | "unsupported";
  label: string;
  status: ImportSupportStatus | "unsupported";
  nativeInputType: NativeInputType;
  confidence: "high" | "medium" | "low";
  reason: string;
};

const manualBalanceHeaders = [
  "asset_type",
  "current_value",
  "as_of_date"
];

const manualTransactionHeaders = [
  "date",
  "asset_type",
  "type"
];

export function detectImportSource(input: ImportDetectionInput): ImportDetection {
  const fileName = input.fileName.toLowerCase();
  const text = (input.textSample ?? "").slice(0, 20000);
  const lower = text.toLowerCase();
  const extension = extensionOf(fileName);

  if (extension === "json" && lower.includes("schemaversion") && lower.includes("portfolio-tracker")) {
    return detection("canonical_json", "json", "high", "Matches canonical backup JSON markers.");
  }

  if (extension === "csv" && isZerodhaTradebookCsv(text)) {
    return detection("zerodha_tradebook", "csv", "high", "Matches Zerodha equity tradebook CSV headers.");
  }

  if (extension === "csv" && isGrowwStockOrdersCsv(text)) {
    return detection("groww_stock_orders", "csv", "high", "Matches Groww executed stock order history headers.");
  }

  if (extension === "csv" && hasCsvHeaders(text, manualTransactionHeaders) && hasAnyCsvHeader(text, ["symbol_or_isin", "symbol", "isin", "name", "asset_name"])) {
    return detection("manual_csv", "csv", "high", "Matches manual transaction CSV headers.");
  }

  if (extension === "csv" && hasCsvHeaders(text, manualBalanceHeaders) && hasAnyCsvHeader(text, ["name", "asset_name", "balance_id"])) {
    return detection("manual_csv", "csv", "high", "Matches manual balance CSV headers.");
  }

  if (extension === "csv" && isFidelityCsv(text, fileName)) {
    return detection("fidelity_csv", "csv", "high", "Matches Fidelity positions or history CSV headers.");
  }

  if (extension === "pdf" && (fileName.includes("cas") || lower.includes("consolidated account statement") || lower.includes("cams") || lower.includes("kfintech") || lower.includes("nsdl") || lower.includes("cdsl"))) {
    return detection("cas_pdf", "pdf", lower.includes("consolidated account statement") ? "medium" : "low", "Looks like an Indian CAS PDF.");
  }

  if ((extension === "pdf" || extension === "html") && (lower.includes("epfo") || lower.includes("employee provident fund") || lower.includes("member passbook") || fileName.includes("passbook") || /^epf[_-]/.test(fileName) || /^pf[_-]/.test(fileName))) {
    return detection("epfo_passbook", extension, "medium", "Looks like an EPFO/PF passbook document.");
  }

  if (["pdf", "csv", "xlsx"].includes(extension) && (lower.includes("national pension system") || lower.includes("pran") || fileName.includes("nps"))) {
    return detection("nps_statement", extension as NativeInputType, "medium", "Looks like an NPS statement/export.");
  }

  if (["pdf", "csv", "xlsx"].includes(extension) && (lower.includes("indmoney") || fileName.includes("indmoney") || fileName.includes("ind_money") || fileName.includes("ind_txn") || fileName.includes("ind-txn"))) {
    return detection("indmoney_export", extension as NativeInputType, "medium", "Looks like an INDMoney export.");
  }

  if (["pdf", "csv", "xlsx"].includes(extension) && (lower.includes("fixed deposit") || lower.includes("public provident fund") || lower.includes("sukanya") || fileName.includes("ppf") || fileName.includes("ssy") || fileName.includes("fd"))) {
    return detection("bank_small_savings", extension as NativeInputType, "low", "Looks like a PPF/SSY/FD statement.");
  }

  return unsupportedDetection(extension || "unknown", "Unknown format. Use a supported native import or manual CSV template, or add a verified provider fixture.");
}

function detection(providerId: ImportProviderId, nativeInputType: NativeInputType, confidence: ImportDetection["confidence"], reason: string): ImportDetection {
  const spec = providerImportSpecs.find((provider) => provider.id === providerId);
  if (!spec) throw new Error(`Unknown provider: ${providerId}`);
  return { providerId, label: spec.label, status: spec.status, nativeInputType, confidence, reason };
}

function unsupportedDetection(nativeInputType: NativeInputType, reason: string): ImportDetection {
  return { providerId: "unsupported", label: "Unsupported file", status: "unsupported", nativeInputType, confidence: "low", reason };
}

function extensionOf(fileName: string): NativeInputType {
  const match = fileName.match(/\.([a-z0-9]+)$/);
  if (!match) return "unknown";
  if (["json", "csv", "pdf", "html", "xlsx"].includes(match[1])) return match[1] as NativeInputType;
  return "unknown";
}

function hasCsvHeaders(text: string, requiredHeaders: string[]): boolean {
  const firstLines = text.split(/\r?\n/).slice(0, 5);
  return firstLines.some((line) => {
    const headers = line.split(",").map((header) => header.trim().toLowerCase().replace(/[ /-]/g, "_"));
    return requiredHeaders.every((header) => headers.includes(header));
  });
}

function isZerodhaTradebookCsv(text: string): boolean {
  return text.split(/\r?\n/).slice(0, 5).some((line) => {
    const headers = normalizedDelimitedHeaders(line);
    return ["symbol", "isin", "trade_date", "trade_type", "quantity", "price", "trade_id", "order_id"].every((header) => headers.includes(header));
  });
}

function isGrowwStockOrdersCsv(text: string): boolean {
  return text.split(/\r?\n/).slice(0, 12).some((line) => {
    const headers = normalizedDelimitedHeaders(line);
    return ["stock_name", "symbol", "isin", "type", "quantity", "value", "execution_date_and_time", "order_status"].every((header) => headers.includes(header));
  });
}

function normalizedDelimitedHeaders(line: string): string[] {
  const delimiter = line.includes("\t") ? "\t" : ",";
  return line.split(delimiter).map((header) => header.trim().toLowerCase().replace(/[ /$().-]/g, "_").replace(/^_+|_+$/g, ""));
}

function isFidelityCsv(text: string, fileName: string): boolean {
  if (fileName.startsWith("portfolio_positions") || fileName.startsWith("accounts_history") || fileName.startsWith("history_for_account")) {
    return true;
  }

  return text.split(/\r?\n/).slice(0, 10).some((line) => {
    const fields = line.split(",").map((field) => field.trim());
    return (
      fields[0] === "Account Number" ||
      (fields[0] === "Run Date" && fields[1] === "Account" && fields[2] === "Account Number") ||
      (fields[0] === "Run Date" && fields[1] === "Action")
    );
  });
}

function hasAnyCsvHeader(text: string, candidateHeaders: string[]): boolean {
  const firstLines = text.split(/\r?\n/).slice(0, 5);
  return firstLines.some((line) => {
    const headers = line.split(",").map((header) => header.trim().toLowerCase().replace(/[ /-]/g, "_"));
    return candidateHeaders.some((header) => headers.includes(header));
  });
}
