import { describe, expect, it } from "vitest";
import { commitManualCsvImport } from "@/src/importers/importPipeline";
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
});
