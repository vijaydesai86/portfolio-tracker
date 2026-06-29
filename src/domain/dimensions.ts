import type { Account, Instrument } from "@/src/schema/backup";

export function cleanDimension(value?: string): string | undefined {
  const cleaned = value?.trim();
  if (!cleaned || cleaned === "0" || cleaned === "-" || /^n\/?a$/i.test(cleaned)) return undefined;
  return cleaned;
}

export function assetKindDimension(instrument?: Instrument, account?: Account): string {
  const type = instrument?.type ?? account?.type;
  if (type === "mutual_fund") return "Mutual Fund";
  if (type === "indian_stock" || type === "us_stock") return "Direct Stock";
  if (type === "cash") return "Cash";
  if (type === "fd") return "Fixed Deposit";
  if (type === "ppf") return "PPF";
  if (type === "ssy") return "SSY";
  if (type === "nps") return "NPS";
  if (type === "epf") return "PF";
  if (type === "gold") return "Gold";
  if (type === "espp") return "ESPP";
  return "Other";
}

export function regionDimension(instrument?: Instrument, account?: Account, currency?: string): string {
  if (instrument?.country === "US" || account?.currency === "USD" || currency === "USD") return "US";
  if (instrument?.country === "IN" || account?.currency === "INR" || currency === "INR") return "India";
  return "Other";
}

export function issuerOrPlatformDimension(instrument?: Instrument, account?: Account, provider?: string): string {
  const type = instrument?.type ?? account?.type;
  const institution = cleanDimension(account?.institution);
  const source = cleanDimension(provider);
  const issuer = cleanDimension(instrument?.issuer);

  if (type === "us_stock" || type === "indian_stock") {
    return institution ?? source ?? issuer ?? "Unassigned";
  }

  if (type === "mutual_fund") {
    return issuer ?? institution ?? source ?? "Unassigned";
  }

  return issuer ?? institution ?? source ?? "Manual";
}
