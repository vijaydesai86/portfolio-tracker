import { describe, expect, it } from "vitest";
import { commitManualCsvImport } from "@/src/importers/importPipeline";
import { createEmptyBackup } from "@/src/schema/backup";

const balanceCsv = `balance_id,as_of_date,institution,asset_type,name,current_value,currency,category
cash-main,2026-06-22,Manual,cash,Cash,100,INR,Cash`;
const transactionCsv = `transaction_id,date,platform,asset_type,symbol_or_isin,name,type,quantity,price,amount,fees,taxes,currency,category
aapl-buy-1,2026-01-15,Fidelity,us_stock,AAPL,Apple Inc,buy,10,100,,0,0,USD,Equity`;

describe("import pipeline", () => {
  it("does not duplicate manual balance records on reimport", () => {
    const backup = createEmptyBackup("INR");
    const first = commitManualCsvImport(backup, balanceCsv, { importId: "one", fileName: "manual.csv" });
    const second = commitManualCsvImport(first.backup, balanceCsv, { importId: "two", fileName: "manual.csv" });

    expect(second.backup.accounts).toHaveLength(1);
    expect(second.backup.manualBalances).toHaveLength(1);
    expect(second.skippedDuplicates).toBe(1);
  });

  it("preserves user-modified balances during reimport", () => {
    const backup = createEmptyBackup("INR");
    const first = commitManualCsvImport(backup, balanceCsv, { importId: "one", fileName: "manual.csv" }).backup;
    first.manualBalances[0] = {
      ...first.manualBalances[0],
      value: 250,
      userModified: true
    };

    const second = commitManualCsvImport(first, balanceCsv, { importId: "two", fileName: "manual.csv" });
    expect(second.backup.manualBalances[0].value).toBe(250);
    expect(second.backup.manualBalances[0].userModified).toBe(true);
  });

  it("does not duplicate manual transaction records or derived positions on reimport", () => {
    const backup = createEmptyBackup("INR");
    const first = commitManualCsvImport(backup, transactionCsv, { importId: "one", fileName: "tx.csv" });
    const second = commitManualCsvImport(first.backup, transactionCsv, { importId: "two", fileName: "tx.csv" });

    expect(second.backup.transactions).toHaveLength(1);
    expect(second.backup.manualBalances).toHaveLength(1);
    expect(second.skippedDuplicates).toBeGreaterThanOrEqual(2);
  });

  it("updates non-edited balance values when the same balance id is reuploaded", () => {
    const backup = createEmptyBackup("INR");
    const first = commitManualCsvImport(backup, balanceCsv, { importId: "one", fileName: "manual.csv" }).backup;
    const updatedCsv = `balance_id,as_of_date,institution,asset_type,name,current_value,currency,category
cash-main,2026-06-23,Manual,cash,Cash,250,INR,Cash`;

    const second = commitManualCsvImport(first, updatedCsv, { importId: "two", fileName: "manual.csv" });
    expect(second.backup.manualBalances).toHaveLength(1);
    expect(second.backup.manualBalances[0].value).toBe(250);
    expect(second.backup.manualBalances[0].asOfDate).toBe("2026-06-23");
  });
});
