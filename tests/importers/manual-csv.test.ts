import { describe, expect, it } from "vitest";
import { parseManualCsv } from "@/src/importers/manualCsv";

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
});
