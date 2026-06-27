import type { AssetCategory } from "@/src/schema/backup";

export type AssetSubtypeInput = {
  category: AssetCategory;
  assetKind: string;
  accountType?: string;
  instrumentType?: string;
};

export function assetSubtypeLabel(holding: AssetSubtypeInput): string {
  const type = holding.instrumentType ?? holding.accountType;
  if (holding.category === "Equity") {
    if (type === "mutual_fund" || holding.assetKind === "Mutual Fund") return "MF";
    if (type === "nps" || holding.assetKind === "NPS") return "NPS";
    if (type === "espp" || holding.assetKind === "ESPP") return "ESPP";
    if (type === "indian_stock" || type === "us_stock" || holding.assetKind === "Direct Stock") return "Direct";
    return holding.assetKind || "Equity";
  }
  if (holding.category === "Debt") {
    if (type === "epf" || holding.assetKind === "PF") return "EPF";
    if (type === "ppf" || holding.assetKind === "PPF") return "PPF";
    if (type === "ssy" || holding.assetKind === "SSY") return "SSY";
    if (type === "nps" || holding.assetKind === "NPS") return "NPS";
    if (type === "fd" || holding.assetKind === "Fixed Deposit") return "FD";
    if (type === "mutual_fund" || holding.assetKind === "Mutual Fund") return "MF";
    return "Debt";
  }
  if (holding.category === "Cash") return type === "espp" ? "ESPP" : "Cash";
  if (holding.category === "Gold") return holding.assetKind === "Mutual Fund" ? "MF" : "Gold";
  return holding.assetKind || "Other";
}

export function assetSubtypeDisplayLabel(category: AssetCategory, subtype: string): string {
  if (category === "Equity" && subtype === "Direct") return "Direct stocks";
  if (category === "Equity" && subtype === "MF") return "Equity MF";
  if (category === "Debt" && subtype === "MF") return "Debt MF";
  if (category === "Cash" && subtype === "Cash") return "Cash balance";
  return subtype;
}
