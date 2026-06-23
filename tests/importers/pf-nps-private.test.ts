import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCanonicalEpfoImport, parseEpfoPassbookText } from "@/src/importers/epfoPassbook";
import { buildCanonicalNpsImport, parseNpsCsv } from "@/src/importers/npsStatement";

describe("private PF/NPS imports", () => {
  it.skipIf(!process.env.PF_TEXT_PATH)("parses the private PF text extracted from PDF", () => {
    const parsed = parseEpfoPassbookText(fs.readFileSync(process.env.PF_TEXT_PATH!, "utf8"));
    const imported = buildCanonicalEpfoImport(parsed, { importId: "private_pf", fileName: "private-pf.pdf", now: "2026-06-22T00:00:00.000Z" });

    expect(parsed.errors).toEqual([]);
    expect(parsed.balances).toHaveLength(3);
    expect(parsed.yearlyInterest.some((bucket) => bucket.value > 0)).toBe(true);
    expect(imported.transactions.some((tx) => tx.type === "interest_accrual")).toBe(true);
    for (const balance of parsed.balances) {
      const contribution = parsed.yearlyContributions.find((bucket) => bucket.key === balance.key)?.value ?? 0;
      const interest = parsed.yearlyInterest.find((bucket) => bucket.key === balance.key)?.value ?? 0;
      expect(balance.value).toBeGreaterThanOrEqual(contribution + interest);
    }
    expect(imported.manualBalances.reduce((sum, balance) => sum + balance.value, 0)).toBeGreaterThan(0);
  });

  it.skipIf(!process.env.NPS_CSV_PATH)("parses the private NPS CSV", () => {
    const parsed = parseNpsCsv(fs.readFileSync(process.env.NPS_CSV_PATH!, "utf8"));
    const imported = buildCanonicalNpsImport(parsed, { importId: "private_nps", fileName: "private-nps.csv", now: "2026-06-22T00:00:00.000Z" });

    expect(parsed.errors).toEqual([]);
    expect(parsed.holdings.length).toBeGreaterThan(0);
    expect(imported.manualBalances.reduce((sum, balance) => sum + balance.value, 0)).toBeGreaterThan(0);
  });
});
