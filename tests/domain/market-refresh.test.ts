import { describe, expect, it } from "vitest";
import { buildMarketRefreshRequest } from "@/src/domain/marketRefresh";
import { createEmptyBackup } from "@/src/schema/backup";

const now = "2026-06-22T00:00:00.000Z";

describe("market refresh request planning", () => {
  it("keeps normal refresh current-only even when transactions have historical dates", () => {
    const backup = createEmptyBackup("INR");
    backup.instruments.push(
      { id: "mf", name: "MF", type: "mutual_fund", isin: "INF123", currency: "INR", country: "India", category: "Equity", createdAt: now, updatedAt: now },
      { id: "us", name: "AAPL", type: "us_stock", symbol: "AAPL", currency: "USD", country: "US", category: "Equity", createdAt: now, updatedAt: now }
    );
    backup.transactions.push({ id: "tx_us", accountId: "acct", instrumentId: "us", date: "2024-01-15", type: "buy", quantity: 1, price: 100, amount: 100, currency: "USD", source: { type: "manual" }, fees: 0, taxes: 0, userModified: false, createdAt: now, updatedAt: now });

    const request = buildMarketRefreshRequest(backup, "current", "2026-07-02");

    expect(request.hasRefreshTargets).toBe(true);
    expect(request.requestsHistory).toBe(false);
    expect(request.params.get("isins")).toBe("INF123");
    expect(request.params.get("symbols")).toBe("AAPL");
    expect(request.params.get("latestFx")).toBe("1");
    expect(request.params.has("historyStart")).toBe(false);
    expect(request.params.has("historyEnd")).toBe(false);
    expect(request.params.has("fxStart")).toBe(false);
  });

  it("requests historical ranges only for explicit history repair", () => {
    const backup = createEmptyBackup("INR");
    backup.instruments.push({ id: "us", name: "AAPL", type: "us_stock", symbol: "AAPL", currency: "USD", country: "US", category: "Equity", createdAt: now, updatedAt: now });
    backup.transactions.push({ id: "tx_us", accountId: "acct", instrumentId: "us", date: "2024-01-15", type: "buy", quantity: 1, price: 100, amount: 100, currency: "USD", source: { type: "manual" }, fees: 0, taxes: 0, userModified: false, createdAt: now, updatedAt: now });

    const request = buildMarketRefreshRequest(backup, "history", "2026-07-02");

    expect(request.requestsHistory).toBe(true);
    expect(request.params.get("symbols")).toBe("AAPL");
    expect(request.params.get("latestFx")).toBe("1");
    expect(request.params.get("historyStart")).toBe("2024-01-15");
    expect(request.params.get("historyEnd")).toBe("2026-07-02");
    expect(request.params.get("fxStart")).toBe("2024-01-15");
    expect(request.params.get("fxEnd")).toBe("2026-07-02");
  });
});
