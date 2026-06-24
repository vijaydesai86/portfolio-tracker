import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateHoldingReturns } from "@/src/domain/holdingReturns";
import { extractPdfTextInBrowser } from "@/src/importers/browserPdfText";
import { applyCanonicalCasImport, buildCanonicalCasImport, parseCasText } from "@/src/importers/casText";
import { createEmptyBackup } from "@/src/schema/backup";

describe("private browser CAS import validation", () => {
  it.skipIf(!process.env.CAS_PDF_PATH || !process.env.CAS_PDF_PASSWORD)("parses the real CAS PDF through the browser extraction path", async () => {
    const data = fs.readFileSync(process.env.CAS_PDF_PATH!);
    const file = {
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    } as File;
    const text = await extractPdfTextInBrowser(file, process.env.CAS_PDF_PASSWORD);
    const parsed = parseCasText(text);
    const imported = buildCanonicalCasImport(parsed, { importId: "private_browser_cas", now: "2026-06-23T00:00:00.000Z" });
    const backup = applyCanonicalCasImport(createEmptyBackup("INR"), imported);
    const returns = calculateHoldingReturns(backup);

    expect(parsed.errors).toEqual([]);
    expect(parsed.schemes).toHaveLength(9);
    expect(imported.transactions.length).toBeGreaterThanOrEqual(414);
    expect([...returns.values()].filter((row) => typeof row.xirr === "number")).toHaveLength(backup.manualBalances.length);

    for (const scheme of parsed.schemes) {
      const balance = backup.manualBalances.find((item) => item.label === scheme.schemeName);
      expect(balance, scheme.schemeName).toBeDefined();
      if (!balance) continue;
      const row = returns.get(balance.id);
      expect(row, scheme.schemeName).toBeDefined();
      expect(row?.xirr, scheme.schemeName).toEqual(expect.any(Number));
      if (scheme.totalCostValue !== undefined) expect(row?.invested, scheme.schemeName).toBeCloseTo(scheme.totalCostValue, 2);
      if (scheme.closingUnitBalance !== undefined) expect(balance.quantity, scheme.schemeName).toBeCloseTo(scheme.closingUnitBalance, 3);
    }
  }, 30000);
});
