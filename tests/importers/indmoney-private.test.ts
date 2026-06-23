import { describe, expect, it } from "vitest";
import readXlsxFile from "read-excel-file/node";
import { applyCanonicalIndMoneyImport, buildCanonicalIndMoneyImport, normalizeWorkbookRows, parseIndMoneyRows } from "@/src/importers/indmoneyXlsx";
import { calculateHoldingReturns } from "@/src/domain/holdingReturns";
import { createEmptyBackup } from "@/src/schema/backup";

const filePath = process.env.IND_XLSX_PATH;

describe.skipIf(!filePath)("private INDMoney XLSX fixture", () => {
  it("parses the private INDMoney transaction ledger", async () => {
    const workbook = await readXlsxFile(filePath!);
    const parsed = parseIndMoneyRows(normalizeWorkbookRows(workbook as unknown));

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.length).toBeGreaterThan(200);
    expect(parsed.canonicalRows.length).toBeGreaterThan(200);
    expect(parsed.positions.length).toBeGreaterThan(0);
    expect(parsed.positions.every((position) => position.quantity > 0 && position.latestPrice > 0)).toBe(true);
  });

  it("preserves cost basis for private INDMoney open holdings after zero-amount migration rows", async () => {
    const workbook = await readXlsxFile(filePath!);
    const parsed = parseIndMoneyRows(normalizeWorkbookRows(workbook as unknown));
    const imported = buildCanonicalIndMoneyImport(parsed, { importId: "private_ind", fileName: "private-indmoney.xlsx", now: "2026-06-23T00:00:00.000Z" });
    const backup = applyCanonicalIndMoneyImport(createEmptyBackup("USD"), imported);
    const returns = calculateHoldingReturns(backup);
    const openHoldingReturns = backup.manualBalances
      .map((balance) => ({ balance, row: returns.get(balance.id) }))
      .filter(({ balance, row }) => balance.value > 0 && row?.costBasisKnown);
    const zeroCostOpenHoldings = openHoldingReturns.filter(({ row }) => row!.invested === 0);
    const totalRemainingCostBasis = openHoldingReturns.reduce((sum, { row }) => sum + row!.invested, 0);

    expect(zeroCostOpenHoldings).toEqual([]);
    expect(totalRemainingCostBasis).toBeGreaterThan(60000);
    expect(totalRemainingCostBasis).toBeLessThan(80000);
  });
});
