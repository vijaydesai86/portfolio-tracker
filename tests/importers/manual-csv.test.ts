import readXlsxFile from "read-excel-file/node";
import { describe, expect, it } from "vitest";
import { parseManualCsv, parseManualWorkbookSheets } from "@/src/importers/manualCsv";

describe("manual CSV importer", () => {
  it("normalizes manual balances for all supported categories", () => {
    const csv = `account_name,asset_name,asset_type,category,currency,current_value,as_of_date,notes\nCash Wallet,Cash Wallet,cash,Cash,INR,10000,2026-06-22,liquid\nEmployer ESPP,ESPP Contribution,espp,Equity,USD,2000,2026-06-22,manual contribution\nPPF,Public Provident Fund,ppf,Debt,INR,300000,2026-06-22,manual balance\nGold,Gold ETF,gold,Gold,INR,50000,2026-06-22,manual balance\nOther,Private Asset,other,Others,INR,12000,2026-06-22,manual balance`;

    const result = parseManualCsv(csv, { importId: "import_manual" });

    expect(result.errors).toEqual([]);
    expect(result.accounts).toHaveLength(5);
    expect(result.manualBalances.map((b) => b.category)).toEqual([
      "Cash",
      "Equity",
      "Debt",
      "Gold",
      "Others"
    ]);
  });

  it("rejects invalid categories and keeps rows out of staged data", () => {
    const csv = `account_name,asset_name,asset_type,category,currency,current_value,as_of_date\nBad,Bad Asset,other,RealEstate,INR,100,2026-06-22`;
    const result = parseManualCsv(csv, { importId: "import_bad" });

    expect(result.manualBalances).toHaveLength(0);
    expect(result.errors[0].message).toMatch(/category/i);
  });

  it("creates stable source hashes for duplicate detection", () => {
    const csv = `account_name,asset_name,asset_type,category,currency,current_value,as_of_date\nCash,Cash,cash,Cash,INR,100,2026-06-22`;
    const first = parseManualCsv(csv, { importId: "a" });
    const second = parseManualCsv(csv, { importId: "b" });

    expect(first.manualBalances[0].source.sourceRecordHash).toBe(second.manualBalances[0].source.sourceRecordHash);
  });

  it("parses generic manual workbook holdings transactions prices and FX", () => {
    const result = parseManualWorkbookSheets([
      { sheet: "Holdings", data: [
        ["holding_key", "account_name", "institution", "asset_name", "asset_type", "category", "currency", "current_value", "as_of_date", "quantity", "price", "symbol", "country", "issuer"],
        ["us-aapl", "Fidelity US", "Fidelity", "Apple Inc", "us_stock", "Equity", "USD", 1200, "2026-06-22", 10, 120, "AAPL", "US", "Apple"],
        ["ppf-main", "PPF", "SBI", "Public Provident Fund", "ppf", "Debt", "INR", 300000, "2026-06-22", "", "", "", "IN", "Government of India"]
      ] },
      { sheet: "Transactions", data: [
        ["transaction_id", "account_name", "institution", "asset_name", "asset_type", "category", "currency", "date", "transaction_type", "quantity", "price", "amount", "fees", "taxes", "symbol", "country", "issuer"],
        ["t1", "Fidelity US", "Fidelity", "Apple Inc", "us_stock", "Equity", "USD", "2026-01-01", "buy", 10, 100, 1000, 1, 0, "AAPL", "US", "Apple"],
        ["t2", "PPF", "SBI", "Public Provident Fund", "ppf", "Debt", "INR", "2026-04-01", "contribution", "", "", 50000, 0, 0, "", "IN", "Government of India"]
      ] },
      { sheet: "Prices", data: [
        ["asset_name", "asset_type", "category", "currency", "as_of_date", "price", "symbol", "country", "issuer"],
        ["Apple Inc", "us_stock", "Equity", "USD", "2026-05-31", 115, "AAPL", "US", "Apple"]
      ] },
      { sheet: "FX", data: [
        ["from_currency", "to_currency", "date", "rate"],
        ["USD", "INR", "2026-01-01", 83],
        ["USD", "INR", "2026-06-22", 85]
      ] }
    ], { importId: "manual_workbook", now: "2026-06-22T00:00:00.000Z" });

    expect(result.errors).toEqual([]);
    expect(result.accounts).toHaveLength(2);
    expect(result.instruments).toHaveLength(2);
    expect(result.manualBalances).toHaveLength(2);
    expect(result.transactions).toHaveLength(2);
    expect(result.priceSnapshots).toEqual(expect.arrayContaining([
      expect.objectContaining({ instrumentId: "USDINR", price: 83, asOfDate: "2026-01-01" }),
      expect.objectContaining({ instrumentId: "USDINR", price: 85, asOfDate: "2026-06-22" })
    ]));
    expect(result.manualBalances[0]).toMatchObject({ quantity: 10, price: 120, source: { provider: "manual_workbook" } });
  });

  it("parses the committed generic manual XLSX template", async () => {
    const sheets = await readXlsxFile("fixtures/importable/generic-manual-portfolio-template.xlsx");
    const result = parseManualWorkbookSheets(sheets, { importId: "fixture_template", now: "2026-06-23T00:00:00.000Z" });

    expect(sheets.map((sheet) => sheet.sheet)).toEqual(["Manifest", "Holdings", "Transactions", "Prices", "FX"]);
    expect(result.errors).toEqual([]);
    expect(result.manualBalances.length).toBeGreaterThanOrEqual(10);
    expect(result.transactions.length).toBeGreaterThanOrEqual(8);
    expect(result.manualBalances.map((balance) => balance.source.provider)).toContain("manual_workbook");
  });
});
