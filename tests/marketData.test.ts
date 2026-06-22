import { describe, expect, it } from "vitest";
import { applyMarketDataPayload, parseAmfiNavAll, parseCurrencyApiLatestFx, parseExchangeRateApiLatestFx, parseFrankfurterHistoricalFx, parseFrankfurterLatestFx, parseFxFromStooqCsv, parseHistoricalFxFromStooqCsv, parseStooqCsv, parseYahooChartQuote } from "@/src/marketData/marketData";
import { createEmptyBackup } from "@/src/schema/backup";

describe("market data parsers", () => {
  it("parses AMFI NAVAll records with AMC context", () => {
    const navs = parseAmfiNavAll("HDFC Mutual Fund\nScheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date\n123;INF179K01ABC;-;HDFC Flexi Cap Fund - Growth;123.4567;20-Jun-2026", new Set(["INF179K01ABC"]));
    expect(navs).toEqual([{ isin: "INF179K01ABC", schemeCode: "123", schemeName: "HDFC Flexi Cap Fund - Growth", amc: "HDFC Mutual Fund", nav: 123.4567, asOfDate: "2026-06-20" }]);
  });

  it("parses Stooq stock and FX CSV", () => {
    expect(parseStooqCsv("Symbol,Date,Time,Open,High,Low,Close,Volume\nAAPL.US,2026-06-19,22:00:00,100,110,99,108.5,123")[0]).toMatchObject({ symbol: "AAPL", price: 108.5, currency: "USD", asOfDate: "2026-06-19" });
    expect(parseFxFromStooqCsv("Symbol,Date,Time,Open,High,Low,Close,Volume\nUSDINR,2026-06-19,22:00:00,83,84,82,83.5,0")).toMatchObject({ pair: "USDINR", rate: 83.5, asOfDate: "2026-06-19" });
  });

  it("updates linked balances with live prices and adds FX snapshots", () => {
    const backup = createEmptyBackup("INR");
    backup.instruments.push({ id: "inst_aapl", name: "AAPL", type: "us_stock", symbol: "AAPL", currency: "USD", country: "US", category: "Equity", createdAt: "2026-06-22T00:00:00.000Z", updatedAt: "2026-06-22T00:00:00.000Z" });
    backup.manualBalances.push({ id: "bal_aapl", accountId: "acct", instrumentId: "inst_aapl", label: "AAPL", category: "Equity", currency: "USD", value: 100, quantity: 2, price: 50, asOfDate: "2026-01-01", source: { type: "import", provider: "indmoney_export" }, userModified: false, createdAt: "2026-06-22T00:00:00.000Z", updatedAt: "2026-06-22T00:00:00.000Z" });

    const updated = applyMarketDataPayload(backup, { stocks: [{ symbol: "AAPL", price: 125, currency: "USD", asOfDate: "2026-06-20", source: "test" }], navs: [], fx: { pair: "USDINR", from: "USD", to: "INR", rate: 83, asOfDate: "2026-06-20", source: "test" }, errors: [] });

    expect(updated.manualBalances[0]).toMatchObject({ value: 250, price: 125, asOfDate: "2026-06-20" });
    expect(updated.priceSnapshots.some((snapshot) => snapshot.instrumentId === "USDINR" && snapshot.price === 83)).toBe(true);
  });
});

it("parses historical USD/INR daily rates and applies all FX snapshots", () => {
  const rates = parseHistoricalFxFromStooqCsv("Date,Open,High,Low,Close,Volume\n2026-01-02,82,83,81,82.5,0\n2026-01-03,83,84,82,83.25,0");
  expect(rates).toEqual([
    { pair: "USDINR", from: "USD", to: "INR", rate: 82.5, asOfDate: "2026-01-02", source: "stooq_history" },
    { pair: "USDINR", from: "USD", to: "INR", rate: 83.25, asOfDate: "2026-01-03", source: "stooq_history" }
  ]);

  const backup = createEmptyBackup("INR");
  const updated = applyMarketDataPayload(backup, { navs: [], stocks: [], fxs: rates, errors: [] });
  expect(updated.priceSnapshots.filter((snapshot) => snapshot.instrumentId === "USDINR")).toHaveLength(2);
});


it("parses no-key USD/INR provider responses", () => {
  expect(parseFrankfurterLatestFx({ amount: 1, base: "USD", date: "2026-06-19", rates: { INR: 94.33 } })).toEqual({
    pair: "USDINR",
    from: "USD",
    to: "INR",
    rate: 94.33,
    asOfDate: "2026-06-19",
    source: "frankfurter"
  });

  expect(parseFrankfurterHistoricalFx({ rates: { "2026-06-18": { INR: 94.34 }, "2026-06-19": { INR: 94.33 } } })).toEqual([
    { pair: "USDINR", from: "USD", to: "INR", rate: 94.34, asOfDate: "2026-06-18", source: "frankfurter_history" },
    { pair: "USDINR", from: "USD", to: "INR", rate: 94.33, asOfDate: "2026-06-19", source: "frankfurter_history" }
  ]);

  expect(parseExchangeRateApiLatestFx({ time_last_update_utc: "Sun, 21 Jun 2026 00:02:31 +0000", rates: { INR: 94.411255 } })).toMatchObject({
    pair: "USDINR",
    rate: 94.411255,
    asOfDate: "2026-06-21",
    source: "open_er_api"
  });

  expect(parseCurrencyApiLatestFx({ date: "2026-06-21", usd: { inr: 94.45321749 } })).toMatchObject({
    pair: "USDINR",
    rate: 94.45321749,
    asOfDate: "2026-06-21",
    source: "currency_api"
  });
});

it("parses Yahoo chart quote responses", () => {
  const quote = parseYahooChartQuote({
    chart: {
      result: [
        {
          meta: {
            symbol: "AAPL",
            regularMarketPrice: 212.4,
            currency: "USD",
            regularMarketTime: 1781899200
          }
        }
      ]
    }
  });

  expect(quote).toMatchObject({
    symbol: "AAPL",
    price: 212.4,
    currency: "USD",
    asOfDate: "2026-06-19",
    source: "yahoo_chart"
  });
});
