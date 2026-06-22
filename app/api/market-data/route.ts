import { NextRequest, NextResponse } from "next/server";
import {
  parseAmfiNavAll,
  parseCurrencyApiLatestFx,
  parseExchangeRateApiLatestFx,
  parseFrankfurterHistoricalFx,
  parseFrankfurterLatestFx,
  parseFxFromStooqCsv,
  parseHistoricalFxFromStooqCsv,
  parseStooqCsv,
  parseYahooChartQuote,
  type FxQuote,
  type MarketDataPayload,
  type NavQuote,
  type StockQuote
} from "@/src/marketData/marketData";

export const dynamic = "force-dynamic";

const REQUEST_TIMEOUT_MS = 8000;

type Provider<T> = {
  name: string;
  run: () => Promise<T | undefined>;
};

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const isins = searchParams.get("isins")?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  const symbols = searchParams.get("symbols")?.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean) ?? [];
  const fxStart = normalizeDate(searchParams.get("fxStart"));
  const fxEnd = normalizeDate(searchParams.get("fxEnd")) ?? todayIso();
  const errors: string[] = [];
  const payload: MarketDataPayload = { navs: [], stocks: [], fxs: [], errors };

  await Promise.all([
    isins.length > 0 ? loadNavs([...new Set(isins)], payload, errors) : Promise.resolve(),
    symbols.length > 0 ? loadStockQuotes([...new Set(symbols)], payload, errors) : Promise.resolve(),
    symbols.length > 0 || fxStart ? loadLatestUsdInr(payload, errors) : Promise.resolve(),
    fxStart ? loadHistoricalUsdInr(fxStart, fxEnd, payload, errors) : Promise.resolve()
  ]);

  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}

async function loadNavs(isins: string[], payload: MarketDataPayload, errors: string[]) {
  const requested = new Set(isins);
  const providers: Array<Provider<NavQuote[]>> = [
    {
      name: "AMFI NAVAll portal",
      run: async () => parseAmfiNavAll(await fetchText("https://portal.amfiindia.com/spages/NAVAll.txt"), requested)
    },
    {
      name: "AMFI NAVAll www",
      run: async () => parseAmfiNavAll(await fetchText("https://www.amfiindia.com/spages/NAVAll.txt"), requested)
    }
  ];

  const result = await firstUsable(providers, (quotes) => quotes.length > 0);
  if (result.value) {
    payload.navs = result.value;
    return;
  }

  if (result.emptyProvider) {
    errors.push("AMFI NAV fetch returned 0 matching NAV(s) for the requested ISIN(s): " + isins.join(", "));
  } else {
    errors.push("AMFI NAV fetch failed: " + result.errors.join("; "));
  }
}

async function loadStockQuotes(symbols: string[], payload: MarketDataPayload, errors: string[]) {
  const providers: Array<Provider<StockQuote[]>> = [
    { name: "Stooq US quotes", run: () => fetchStooqStockQuotes(symbols) },
    { name: "Yahoo Finance chart", run: () => fetchYahooStockQuotes(symbols) }
  ];
  const results = await Promise.allSettled(
    providers.map(async (provider) => {
      try {
        return { provider: provider.name, value: await provider.run() };
      } catch (error) {
        throw new Error(provider.name + ": " + errorMessage(error));
      }
    })
  );
  const quotesBySymbol = new Map<string, StockQuote>();
  const providerErrors: string[] = [];

  for (const result of results) {
    if (result.status === "rejected") {
      providerErrors.push(errorMessage(result.reason));
      continue;
    }
    for (const quote of result.value.value ?? []) {
      if (!quotesBySymbol.has(quote.symbol)) quotesBySymbol.set(quote.symbol, quote);
    }
  }

  payload.stocks = [...quotesBySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  const missing = symbols.filter((symbol) => !quotesBySymbol.has(symbol));
  if (payload.stocks.length === 0) {
    errors.push("US quote fetch failed: " + (providerErrors.length > 0 ? providerErrors.join("; ") : "no provider returned usable real quotes"));
  } else if (missing.length > 0) {
    errors.push("US quote missing for: " + missing.join(", "));
  }
}

async function loadLatestUsdInr(payload: MarketDataPayload, errors: string[]) {
  const result = await firstUsable<FxQuote>([
    {
      name: "Frankfurter latest USD/INR",
      run: async () => parseFrankfurterLatestFx(await fetchJson("https://api.frankfurter.dev/v1/latest?from=USD&to=INR"))
    },
    {
      name: "Open ER API latest USD/INR",
      run: async () => parseExchangeRateApiLatestFx(await fetchJson("https://open.er-api.com/v6/latest/USD"))
    },
    {
      name: "currency-api latest USD/INR",
      run: async () => parseCurrencyApiLatestFx(await fetchJson("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json"))
    },
    {
      name: "Stooq latest USD/INR",
      run: async () => parseFxFromStooqCsv(await fetchText("https://stooq.com/q/l/?s=usdinr&f=sd2t2ohlcv&h&e=csv"), "USD", "INR")
    }
  ]);

  if (result.value) {
    payload.fx = result.value;
  } else {
    errors.push("Latest USD/INR fetch failed: " + result.errors.join("; "));
  }
}

async function loadHistoricalUsdInr(fxStart: string, fxEnd: string, payload: MarketDataPayload, errors: string[]) {
  const result = await firstUsable<FxQuote[]>([
    {
      name: "Frankfurter historical USD/INR",
      run: async () => nonEmpty(parseFrankfurterHistoricalFx(await fetchJson("https://api.frankfurter.dev/v1/" + fxStart + ".." + fxEnd + "?from=USD&to=INR")))
    },
    {
      name: "Stooq historical USD/INR",
      run: async () => nonEmpty(parseHistoricalFxFromStooqCsv(await fetchText("https://stooq.com/q/d/l/?s=usdinr&i=d&d1=" + compactDate(fxStart) + "&d2=" + compactDate(fxEnd)), "USD", "INR"))
    }
  ]);

  if (result.value) {
    payload.fxs = result.value;
  } else {
    errors.push("Historical USD/INR fetch failed: " + result.errors.join("; "));
  }
}

async function fetchStooqStockQuotes(symbols: string[]): Promise<StockQuote[]> {
  const stooqSymbols = symbols.map((symbol) => symbol.toLowerCase() + ".us").join(",");
  const text = await fetchText("https://stooq.com/q/l/?s=" + encodeURIComponent(stooqSymbols) + "&f=sd2t2ohlcv&h&e=csv");
  const quotes = parseStooqCsv(text, "USD", "stooq");
  if (quotes.length === 0) throw new Error("Stooq US quotes: response did not contain usable quotes");
  return quotes;
}

async function fetchYahooStockQuotes(symbols: string[]): Promise<StockQuote[]> {
  const results = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const data = await fetchJson("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol));
      const quote = parseYahooChartQuote(data, symbol);
      if (!quote) throw new Error(symbol + ": response did not contain a usable quote");
      return quote;
    })
  );
  const quotes = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  if (quotes.length > 0) return quotes;
  throw new Error(results.map((result) => (result.status === "rejected" ? errorMessage(result.reason) : "no quote")).join("; "));
}

async function firstUsable<T>(providers: Array<Provider<T>>, isUsable: (value: T) => boolean = Boolean): Promise<{ value?: T; errors: string[]; emptyProvider?: string }> {
  const errors: string[] = [];
  let emptyProvider: string | undefined;
  for (const provider of providers) {
    try {
      const value = await provider.run();
      if (value !== undefined && isUsable(value)) return { value, errors };
      emptyProvider ??= provider.name;
      errors.push(provider.name + ": response did not contain usable data");
    } catch (error) {
      errors.push(provider.name + ": " + errorMessage(error));
    }
  }
  return { errors, emptyProvider };
}

function nonEmpty<T>(items: T[]): T[] | undefined {
  return items.length > 0 ? items : undefined;
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json,text/csv,text/plain,*/*",
        "User-Agent": "PortfolioTracker/1.0 (+local development)"
      }
    });
    if (!response.ok) throw new Error(String(response.status) + " " + response.statusText);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url: string): Promise<unknown> {
  return JSON.parse(await fetchText(url));
}

function normalizeDate(value: string | null): string | undefined {
  if (!value) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function compactDate(value: string): string {
  return value.replaceAll("-", "");
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "timed out after " + REQUEST_TIMEOUT_MS + "ms";
    return error.message;
  }
  return "unknown error";
}
