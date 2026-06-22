import { describe, expect, it } from "vitest";
import { createEmptyBackup } from "@/src/schema/backup";
import { applyCanonicalIndMoneyImport, buildCanonicalIndMoneyImport, parseIndMoneyRows, type WorkbookRow } from "@/src/importers/indmoneyXlsx";

const header: WorkbookRow = [
  "Symbol",
  "UserId",
  "BrokerId",
  "Activity Date",
  "Transaction Type",
  "Quantity",
  "Unsettled Quantity",
  "Unit Price",
  "Broker Transaction ID",
  "Broker Reference ID",
  "Status",
  "Broker Transaction Type",
  "Commission",
  "Open Balance",
  "Close Balance",
  "Net Amount",
  "Soft Deleted"
];

function row(values: Partial<Record<string, string | number | boolean | null>>): WorkbookRow {
  return header.map((key) => values[String(key)] ?? null);
}

describe("INDMoney XLSX importer", () => {
  it("parses ledger rows into positions and cash balance", () => {
    const parsed = parseIndMoneyRows([
      header,
      row({ Symbol: null, "Activity Date": "2026-01-01 05:30:00", "Transaction Type": "JNLC", Quantity: 0, "Unit Price": 0, "Broker Transaction ID": "cash1", Status: "SUCCESS", "Broker Transaction Type": "JNLC", Commission: 0, "Open Balance": 0, "Close Balance": 1000, "Net Amount": 1000, "Soft Deleted": false }),
      row({ Symbol: "AAPL", "Activity Date": "2026-01-02 15:00:00", "Transaction Type": "BUY", Quantity: 10, "Unit Price": 100, "Broker Transaction ID": "buy1", Status: "FILLED", "Broker Transaction Type": "FILL", Commission: 1, "Open Balance": 1000, "Close Balance": 0, "Net Amount": 1000, "Soft Deleted": false }),
      row({ Symbol: "AAPL", "Activity Date": "2026-01-03 15:00:00", "Transaction Type": "SELL", Quantity: 4, "Unit Price": 120, "Broker Transaction ID": "sell1", Status: "FILLED", "Broker Transaction Type": "FILL", Commission: 1, "Open Balance": 0, "Close Balance": 480, "Net Amount": 480, "Soft Deleted": false }),
      row({ Symbol: "AAPL", "Activity Date": "2026-01-04 05:30:00", "Transaction Type": "DIV", Quantity: 0, "Unit Price": 0, "Broker Transaction ID": "div1", Status: "SUCCESS", "Broker Transaction Type": "DIV", Commission: 0, "Open Balance": 480, "Close Balance": 485, "Net Amount": 5, "Soft Deleted": false }),
      row({ Symbol: "AAPL", "Activity Date": "2026-01-05 05:30:00", "Transaction Type": "STOCK_SPLIT", Quantity: 6, "Unit Price": 60, "Broker Transaction ID": "split1", Status: "SUCCESS", "Broker Transaction Type": "SPLIT", Commission: 0, "Open Balance": 485, "Close Balance": 485, "Net Amount": 0, "Soft Deleted": false })
    ]);

    expect(parsed.errors).toEqual([]);
    expect(parsed.canonicalRows).toHaveLength(5);
    expect(parsed.positions).toEqual([{ symbol: "AAPL", quantity: 12, latestPrice: 60, latestPriceDate: "2026-01-05", marketValue: 720 }]);
    expect(parsed.cashBalance).toEqual({ value: 1000, asOfDate: "2026-01-01" });
  });

  it("builds and commits canonical INDMoney records", () => {
    const parsed = parseIndMoneyRows([
      header,
      row({ Symbol: "MSFT", "Activity Date": "2026-02-01 15:00:00", "Transaction Type": "BUY", Quantity: 2, "Unit Price": 400, "Broker Transaction ID": "buy-msft", Status: "FILLED", "Broker Transaction Type": "FILL", Commission: 0, "Open Balance": 800, "Close Balance": 0, "Net Amount": 800, "Soft Deleted": false })
    ]);

    const imported = buildCanonicalIndMoneyImport(parsed, { importId: "ind_test", fileName: "indmoney-template.xlsx", now: "2026-06-22T00:00:00.000Z" });
    const backup = applyCanonicalIndMoneyImport(createEmptyBackup("INR"), imported);

    expect(imported.transactions[0]).toMatchObject({ type: "buy", currency: "USD", quantity: 2, amount: 800 });
    expect(imported.manualBalances[0]).toMatchObject({ label: "MSFT", category: "Equity", currency: "USD", value: 800, quantity: 2, price: 400 });
    expect(backup.imports[0]).toMatchObject({ provider: "indmoney_export", status: "committed" });
  });
});
