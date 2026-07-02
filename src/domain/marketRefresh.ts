import type { PortfolioBackup } from "@/src/schema/backup";

export type MarketRefreshMode = "current" | "history";

export type MarketRefreshRequest = {
  params: URLSearchParams;
  hasRefreshTargets: boolean;
  requestsHistory: boolean;
  targetCounts: {
    isins: number;
    usSymbols: number;
    indianSymbols: number;
    fxDates: number;
    historyDates: number;
  };
};

export function buildMarketRefreshRequest(portfolio: PortfolioBackup, mode: MarketRefreshMode = "current", today = new Date().toISOString().slice(0, 10)): MarketRefreshRequest {
  const isins = unique(portfolio.instruments.map((instrument) => instrument.isin).filter((isin): isin is string => Boolean(isin)));
  const symbols = unique(portfolio.instruments.filter((instrument) => instrument.type === "us_stock" && instrument.symbol).map((instrument) => instrument.symbol as string));
  const indianSymbols = unique(portfolio.instruments.filter((instrument) => instrument.type === "indian_stock" && instrument.symbol).map((instrument) => instrument.symbol as string));
  const fxDates = unique([
    ...portfolio.transactions.filter((tx) => tx.currency === "USD").map((tx) => tx.date),
    ...portfolio.manualBalances.filter((balance) => balance.currency === "USD").map((balance) => balance.asOfDate)
  ].filter(Boolean)).sort();
  const historyDates = unique([
    ...portfolio.transactions.map((tx) => tx.date),
    ...portfolio.manualBalances.map((balance) => balance.asOfDate)
  ].filter(Boolean)).sort();

  const params = new URLSearchParams();
  if (isins.length > 0) params.set("isins", isins.join(","));
  if (symbols.length > 0) params.set("symbols", symbols.join(","));
  if (indianSymbols.length > 0) params.set("indianSymbols", indianSymbols.join(","));
  if (fxDates.length > 0) params.set("latestFx", "1");

  if (mode === "history") {
    if (fxDates.length > 0) {
      params.set("fxStart", fxDates[0]);
      params.set("fxEnd", today);
    }
    if (historyDates.length > 0 && (isins.length > 0 || symbols.length > 0 || indianSymbols.length > 0)) {
      params.set("historyStart", historyDates[0]);
      params.set("historyEnd", today);
    }
  }

  return {
    params,
    hasRefreshTargets: isins.length > 0 || symbols.length > 0 || indianSymbols.length > 0 || fxDates.length > 0,
    requestsHistory: params.has("historyStart") || params.has("fxStart"),
    targetCounts: {
      isins: isins.length,
      usSymbols: symbols.length,
      indianSymbols: indianSymbols.length,
      fxDates: fxDates.length,
      historyDates: historyDates.length
    }
  };
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
