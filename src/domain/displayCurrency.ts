import type { PortfolioBackup } from "@/src/schema/backup";

export type DisplayCurrencySettings = {
  showUsdEquivalent: boolean;
};

export type UsdInrSnapshot = {
  rate: number;
  asOfDate: string;
  source: string;
};

const defaultDisplayCurrencySettings: DisplayCurrencySettings = {
  showUsdEquivalent: false
};

export function getDisplayCurrencySettings(backup: PortfolioBackup): DisplayCurrencySettings {
  const raw = backup.settings.displayCurrency;
  if (!raw || typeof raw !== "object") return defaultDisplayCurrencySettings;
  const settings = raw as Partial<DisplayCurrencySettings>;
  return {
    showUsdEquivalent: settings.showUsdEquivalent === true
  };
}

export function updateDisplayCurrencySettings(backup: PortfolioBackup, patch: Partial<DisplayCurrencySettings>): PortfolioBackup {
  const next = { ...getDisplayCurrencySettings(backup), ...patch };
  return {
    ...backup,
    settings: {
      ...backup.settings,
      displayCurrency: next
    },
    exportedAt: new Date().toISOString()
  };
}

export function latestUsdInrSnapshot(backup: PortfolioBackup): UsdInrSnapshot | undefined {
  if (backup.baseCurrency !== "INR") return undefined;
  const snapshots = backup.priceSnapshots
    .filter((snapshot) => snapshot.instrumentId === "USDINR" && snapshot.currency === "INR" && Number.isFinite(snapshot.price) && snapshot.price > 0)
    .sort((a, b) => b.asOfDate.localeCompare(a.asOfDate) || b.createdAt.localeCompare(a.createdAt));
  const latest = snapshots[0];
  if (!latest) return undefined;
  return { rate: latest.price, asOfDate: latest.asOfDate, source: latest.source };
}

export function usdEquivalent(valueInBase: number | undefined, backup: PortfolioBackup): { value: number; rate: number; asOfDate: string; source: string } | undefined {
  if (valueInBase === undefined || !Number.isFinite(valueInBase)) return undefined;
  if (!getDisplayCurrencySettings(backup).showUsdEquivalent) return undefined;
  const fx = latestUsdInrSnapshot(backup);
  if (!fx) return undefined;
  return { value: valueInBase / fx.rate, ...fx };
}

export function formatUsdEquivalent(valueInBase: number | undefined, backup: PortfolioBackup): string | undefined {
  const converted = usdEquivalent(valueInBase, backup);
  if (!converted) return undefined;
  return "~" + new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(converted.value);
}
