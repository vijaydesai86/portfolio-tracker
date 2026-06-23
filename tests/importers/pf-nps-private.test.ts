import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { applyCanonicalEpfoImport, buildCanonicalEpfoImport, parseEpfoPassbookText } from "@/src/importers/epfoPassbook";
import { applyCanonicalNpsImport, buildCanonicalNpsImport, parseNpsCsv } from "@/src/importers/npsStatement";
import { createEmptyBackup } from "@/src/schema/backup";

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

  it.skipIf(!process.env.PF_TEXT_PATHS)("parses and merges multiple private PF yearly texts", () => {
    const paths = splitPaths(process.env.PF_TEXT_PATHS);
    let backup = createEmptyBackup("INR");
    const parsedDates: string[] = [];

    paths.forEach((path, index) => {
      const parsed = parseEpfoPassbookText(fs.readFileSync(path, "utf8"));
      const imported = buildCanonicalEpfoImport(parsed, { importId: "private_pf_" + index, fileName: "private-pf-yearly.pdf", now: "2026-06-22T00:00:00.000Z" });
      expect(parsed.errors).toEqual([]);
      expect(parsed.balances).toHaveLength(3);
      expect(parsed.yearlyContributions).toHaveLength(3);
      expect(parsed.yearlyInterest).toHaveLength(3);
      parsedDates.push(parsed.asOfDate);
      backup = applyCanonicalEpfoImport(backup, imported);
    });

    const latestDate = parsedDates.sort().at(-1);
    expect(backup.manualBalances).toHaveLength(3);
    expect(backup.manualBalances.every((balance) => balance.asOfDate === latestDate && balance.category === "Debt")).toBe(true);
    expect(backup.imports).toHaveLength(paths.length);
    expect(backup.transactions.length).toBeGreaterThan(paths.length);
  });

  it.skipIf(!process.env.NPS_CSV_PATHS)("parses and merges multiple private NPS yearly CSVs", () => {
    const paths = splitPaths(process.env.NPS_CSV_PATHS);
    let backup = createEmptyBackup("INR");
    const parsedDates: string[] = [];

    paths.forEach((path, index) => {
      const parsed = parseNpsCsv(fs.readFileSync(path, "utf8"));
      const imported = buildCanonicalNpsImport(parsed, { importId: "private_nps_" + index, fileName: "private-nps-yearly.csv", now: "2026-06-22T00:00:00.000Z" });
      expect(parsed.errors).toEqual([]);
      expect(parsed.holdings.length).toBeGreaterThan(0);
      expect(parsed.transactions.length).toBeGreaterThan(0);
      parsedDates.push(...parsed.holdings.map((holding) => holding.navDate));
      backup = applyCanonicalNpsImport(backup, imported);
    });

    const latestDate = parsedDates.sort().at(-1);
    expect(backup.manualBalances.length).toBeGreaterThan(0);
    expect(backup.manualBalances.every((balance) => balance.asOfDate === latestDate)).toBe(true);
    expect(new Set(backup.manualBalances.map((balance) => balance.category))).toEqual(new Set(["Equity", "Debt"]));
    expect(backup.imports).toHaveLength(paths.length);
    expect(backup.transactions.length).toBeGreaterThan(paths.length);
  });
});

function splitPaths(value: string | undefined): string[] {
  return String(value ?? "")
    .split(process.platform === "win32" ? ";" : ":")
    .map((item) => item.trim())
    .filter(Boolean);
}
