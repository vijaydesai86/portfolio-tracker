import { describe, expect, it } from "vitest";
import readXlsxFile from "read-excel-file/node";
import { normalizeWorkbookRows, parseIndMoneyRows } from "@/src/importers/indmoneyXlsx";

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
});
