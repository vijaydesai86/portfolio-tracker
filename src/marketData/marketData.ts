import { slugId } from "@/src/domain/hash";
import type { PortfolioBackup, PriceSnapshot } from "@/src/schema/backup";

export type NavQuote = {
  isin: string;
  schemeCode: string;
  schemeName: string;
  amc?: string;
  nav: number;
  asOfDate: string;
};

export type StockQuote = {
  symbol: string;
  price: number;
  currency: string;
  asOfDate: string;
  source: string;
};

export type FxQuote = {
  pair: string;
  from: string;
  to: string;
  rate: number;
  asOfDate: string;
  source: string;
};

export type MarketDataPayload = {
  navs: NavQuote[];
  stocks: StockQuote[];
  fx?: FxQuote;
  fxs?: FxQuote[];
  errors: string[];
};

export function parseAmfiNavAll(text: string, requestedIsins = new Set<string>()): NavQuote[] {
  const results: NavQuote[] = [];
  let currentAmc = "";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!line.includes(";")) {
      if (/mutual fund/i.test(line)) currentAmc = line;
      continue;
    }

    const parts = line.split(";").map((part) => part.trim());
    if (parts.length < 6 || parts[0] === "Scheme Code") continue;
    const [schemeCode, isinPayout, isinGrowth, schemeName, navText, dateText] = parts;
    const nav = Number(navText);
    if (!Number.isFinite(nav) || nav <= 0) continue;
    for (const isin of [isinPayout, isinGrowth]) {
      if (!isin || isin === "-" || !/^[A-Z]{2}/.test(isin)) continue;
      if (requestedIsins.size > 0 && !requestedIsins.has(isin)) continue;
      results.push({ isin, schemeCode, schemeName, amc: currentAmc || undefined, nav, asOfDate: parseAmfiDate(dateText) });
    }
  }

  return results;
}

export function parseStooqCsv(text: string, currency = "USD", source = "stooq"): StockQuote[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((header) => header.toLowerCase());
  const symbolIndex = headers.indexOf("symbol");
  const dateIndex = headers.indexOf("date");
  const closeIndex = headers.indexOf("close");
  if (symbolIndex < 0 || dateIndex < 0 || closeIndex < 0) return [];

  return lines.slice(1).flatMap((line) => {
    const fields = splitCsvLine(line);
    const price = Number(fields[closeIndex]);
    if (!Number.isFinite(price) || price <= 0) return [];
    return [{ symbol: fields[symbolIndex].replace(/\.US$/i, "").toUpperCase(), price, currency, asOfDate: fields[dateIndex], source }];
  });
}

export function parseFxFromStooqCsv(text: string, from = "USD", to = "INR"): FxQuote | undefined {
  const quote = parseStooqCsv(text, to, "stooq")[0];
  if (!quote) return undefined;
  return { pair: from + to, from, to, rate: quote.price, asOfDate: quote.asOfDate, source: quote.source };
}

export function parseHistoricalFxFromStooqCsv(text: string, from = "USD", to = "INR"): FxQuote[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((header) => header.toLowerCase());
  const dateIndex = headers.indexOf("date");
  const closeIndex = headers.indexOf("close");
  if (dateIndex < 0 || closeIndex < 0) return [];

  return lines.slice(1).flatMap((line) => {
    const fields = splitCsvLine(line);
    const rate = Number(fields[closeIndex]);
    const asOfDate = fields[dateIndex];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate) || !Number.isFinite(rate) || rate <= 0) return [];
    return [{ pair: from + to, from, to, rate, asOfDate, source: "stooq_history" }];
  });
}

export function parseFrankfurterLatestFx(data: unknown, from = "USD", to = "INR"): FxQuote | undefined {
  const object = asRecord(data);
  const rates = asRecord(object?.rates);
  const rate = Number(rates?.[to]);
  const asOfDate = typeof object?.date === "string" ? object.date : "";
  if (!isValidRate(rate) || !isIsoDate(asOfDate)) return undefined;
  return { pair: from + to, from, to, rate, asOfDate, source: "frankfurter" };
}

export function parseFrankfurterHistoricalFx(data: unknown, from = "USD", to = "INR"): FxQuote[] {
  const object = asRecord(data);
  const ratesByDate = asRecord(object?.rates);
  if (!ratesByDate) return [];

  return Object.entries(ratesByDate)
    .flatMap(([asOfDate, rates]) => {
      const rate = Number(asRecord(rates)?.[to]);
      if (!isIsoDate(asOfDate) || !isValidRate(rate)) return [];
      return [{ pair: from + to, from, to, rate, asOfDate, source: "frankfurter_history" }];
    })
    .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
}

export function parseExchangeRateApiLatestFx(data: unknown, from = "USD", to = "INR"): FxQuote | undefined {
  const object = asRecord(data);
  const rates = asRecord(object?.rates);
  const rate = Number(rates?.[to]);
  const updatedAt = typeof object?.time_last_update_utc === "string" ? new Date(object.time_last_update_utc) : undefined;
  const asOfDate = updatedAt && Number.isFinite(updatedAt.getTime()) ? updatedAt.toISOString().slice(0, 10) : "";
  if (!isValidRate(rate) || !isIsoDate(asOfDate)) return undefined;
  return { pair: from + to, from, to, rate, asOfDate, source: "open_er_api" };
}

export function parseCurrencyApiLatestFx(data: unknown, from = "USD", to = "INR"): FxQuote | undefined {
  const object = asRecord(data);
  const rates = asRecord(object?.[from.toLowerCase()]);
  const rate = Number(rates?.[to.toLowerCase()]);
  const asOfDate = typeof object?.date === "string" ? object.date : "";
  if (!isValidRate(rate) || !isIsoDate(asOfDate)) return undefined;
  return { pair: from + to, from, to, rate, asOfDate, source: "currency_api" };
}

export function parseYahooChartQuote(data: unknown, requestedSymbol?: string): StockQuote | undefined {
  const object = asRecord(data);
  const chart = asRecord(object?.chart);
  const result = Array.isArray(chart?.result) ? chart.result[0] : undefined;
  const meta = asRecord(asRecord(result)?.meta);
  const symbol = typeof meta?.symbol === "string" ? meta.symbol : requestedSymbol;
  const price = Number(meta?.regularMarketPrice ?? meta?.previousClose);
  const currency = typeof meta?.currency === "string" ? meta.currency : "USD";
  const marketTime = Number(meta?.regularMarketTime);
  const asOfDate = Number.isFinite(marketTime) && marketTime > 0 ? new Date(marketTime * 1000).toISOString().slice(0, 10) : "";
  if (!symbol || !isValidRate(price) || !isIsoDate(asOfDate)) return undefined;
  return { symbol: symbol.replace(/\.US$/i, "").toUpperCase(), price, currency, asOfDate, source: "yahoo_chart" };
}

export function applyMarketDataPayload(backup: PortfolioBackup, payload: MarketDataPayload): PortfolioBackup {
  const now = new Date().toISOString();
  let next: PortfolioBackup = JSON.parse(JSON.stringify(backup)) as PortfolioBackup;
  const priceSnapshots: PriceSnapshot[] = [];

  for (const nav of payload.navs) {
    const instrument = next.instruments.find((item) => item.isin === nav.isin);
    if (!instrument) continue;
    instrument.issuer = nav.amc ?? instrument.issuer;
    instrument.updatedAt = now;
    priceSnapshots.push({
      id: slugId("price", [instrument.id, nav.asOfDate, String(nav.nav), "amfi"]),
      instrumentId: instrument.id,
      price: nav.nav,
      currency: "INR",
      asOfDate: nav.asOfDate,
      source: "amfi_navall",
      createdAt: now
    });
    next = updateBalances(next, instrument.id, nav.nav, nav.asOfDate, "INR");
  }

  for (const quote of payload.stocks) {
    const instrument = next.instruments.find((item) => item.symbol?.toUpperCase() === quote.symbol.toUpperCase() && item.type === "us_stock");
    if (!instrument) continue;
    priceSnapshots.push({
      id: slugId("price", [instrument.id, quote.asOfDate, String(quote.price), quote.source]),
      instrumentId: instrument.id,
      price: quote.price,
      currency: quote.currency,
      asOfDate: quote.asOfDate,
      source: quote.source,
      createdAt: now
    });
    next = updateBalances(next, instrument.id, quote.price, quote.asOfDate, quote.currency);
  }

  for (const fx of [...(payload.fxs ?? []), ...(payload.fx ? [payload.fx] : [])]) {
    priceSnapshots.push({
      id: slugId("price", [fx.pair, fx.asOfDate, String(fx.rate), fx.source]),
      instrumentId: fx.pair,
      price: fx.rate,
      currency: fx.to,
      asOfDate: fx.asOfDate,
      source: fx.source,
      createdAt: now
    });
  }

  return { ...next, exportedAt: now, priceSnapshots: mergeById(next.priceSnapshots, priceSnapshots) };
}

function updateBalances(backup: PortfolioBackup, instrumentId: string, price: number, asOfDate: string, currency: string): PortfolioBackup {
  return {
    ...backup,
    manualBalances: backup.manualBalances.map((balance) => {
      if (balance.instrumentId !== instrumentId || balance.quantity === undefined || balance.userModified) return balance;
      return {
        ...balance,
        value: roundMoney(balance.quantity * price),
        price,
        currency,
        asOfDate,
        updatedAt: new Date().toISOString()
      };
    })
  };
}

function parseAmfiDate(value: string): string {
  const match = value.match(/^(\d{2})-(\w{3})-(\d{4})$/);
  if (!match) return value;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(match[2]);
  if (month < 0) return value;
  return match[3] + "-" + String(month + 1).padStart(2, "0") + "-" + match[1];
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      fields.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  fields.push(current.trim());
  return fields;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function isValidRate(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const map = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
