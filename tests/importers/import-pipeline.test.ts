import { describe, expect, it } from "vitest";
import { commitManualCsvImport } from "@/src/importers/importPipeline";
import { parseManualWorkbookSheets } from "@/src/importers/manualCsv";
import { createEmptyBackup } from "@/src/schema/backup";

const csv = `account_name,asset_name,asset_type,category,currency,current_value,as_of_date\nCash,Cash,cash,Cash,INR,100,2026-06-22`;

describe("import pipeline", () => {
  it("does not duplicate manual CSV records on reimport", () => {
    const backup = createEmptyBackup("INR");
    const first = commitManualCsvImport(backup, csv, { importId: "one", fileName: "manual.csv" });
    const second = commitManualCsvImport(first.backup, csv, { importId: "two", fileName: "manual.csv" });

    expect(second.backup.accounts).toHaveLength(1);
    expect(second.backup.manualBalances).toHaveLength(1);
    expect(second.skippedDuplicates).toBe(1);
  });

  it("preserves user-modified balances during reimport", () => {
    const backup = createEmptyBackup("INR");
    const first = commitManualCsvImport(backup, csv, { importId: "one", fileName: "manual.csv" }).backup;
    first.manualBalances[0] = {
      ...first.manualBalances[0],
      value: 250,
      userModified: true
    };

    const second = commitManualCsvImport(first, csv, { importId: "two", fileName: "manual.csv" });
    expect(second.backup.manualBalances[0].value).toBe(250);
    expect(second.backup.manualBalances[0].userModified).toBe(true);
  });

  it("uses stable manual workbook holding keys so reupload updates the same holding", () => {
    const backup = createEmptyBackup("INR");
    const firstParsed = parseManualWorkbookSheets([{ sheet: "Holdings", data: [
      ["holding_key", "account_name", "asset_name", "asset_type", "category", "currency", "current_value", "as_of_date"],
      ["cash-main", "Cash", "Cash", "cash", "Cash", "INR", 100, "2026-06-22"]
    ] }], { importId: "first", now: "2026-06-22T00:00:00.000Z" });
    const secondParsed = parseManualWorkbookSheets([{ sheet: "Holdings", data: [
      ["holding_key", "account_name", "asset_name", "asset_type", "category", "currency", "current_value", "as_of_date"],
      ["cash-main", "Cash", "Cash", "cash", "Cash", "INR", 250, "2026-06-23"]
    ] }], { importId: "second", now: "2026-06-23T00:00:00.000Z" });

    expect(firstParsed.manualBalances[0].source.sourceRecordHash).toBe(secondParsed.manualBalances[0].source.sourceRecordHash);
  });
});
