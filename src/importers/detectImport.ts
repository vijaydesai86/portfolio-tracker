import { providerImportSpecs, type ImportProviderId, type ImportSupportStatus, type NativeInputType } from "@/src/importers/providerRegistry";

export type ImportDetectionInput = {
  fileName: string;
  mimeType?: string;
  textSample?: string;
};

export type ImportDetection = {
  providerId: ImportProviderId;
  label: string;
  status: ImportSupportStatus;
  nativeInputType: NativeInputType;
  confidence: "high" | "medium" | "low";
  reason: string;
};

const manualCsvHeaders = [
  "account_name",
  "asset_name",
  "asset_type",
  "category",
  "currency",
  "current_value",
  "as_of_date"
];

export function detectImportSource(input: ImportDetectionInput): ImportDetection {
  const fileName = input.fileName.toLowerCase();
  const text = (input.textSample ?? "").slice(0, 20000);
  const lower = text.toLowerCase();
  const extension = extensionOf(fileName);

  if (extension === "json" && lower.includes("schemaversion") && lower.includes("portfolio-tracker")) {
    return detection("canonical_json", "json", "high", "Matches canonical backup JSON markers.");
  }

  if (extension === "csv" && hasCsvHeaders(text, manualCsvHeaders)) {
    return detection("manual_csv", "csv", "high", "Matches implemented manual canonical CSV headers.");
  }

  if (extension === "xlsx" && (fileName.includes("manual") || fileName.includes("template") || fileName.includes("portfolio"))) {
    return detection("manual_csv", "xlsx", "medium", "Looks like a manual portfolio workbook. Parser will validate Holdings/Transactions/Prices/FX sheets.");
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

  return detection("manual_csv", extension || "unknown", "low", "Unknown format. Use manual workbook/canonical CSV fallback or add a verified provider fixture.");
}

function detection(providerId: ImportProviderId, nativeInputType: NativeInputType, confidence: ImportDetection["confidence"], reason: string): ImportDetection {
  const spec = providerImportSpecs.find((provider) => provider.id === providerId);
  if (!spec) throw new Error(`Unknown provider: ${providerId}`);
  return { providerId, label: spec.label, status: spec.status, nativeInputType, confidence, reason };
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
    const headers = line.split(",").map((header) => header.trim().toLowerCase());
    return requiredHeaders.every((header) => headers.includes(header));
  });
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
