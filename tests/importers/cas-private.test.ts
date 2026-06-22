import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCanonicalCasImport, parseCasText } from "@/src/importers/casText";

const privateTextPath = process.env.CAS_TEXT_PATH;
const runIfPrivateCas = privateTextPath && existsSync(privateTextPath) ? it : it.skip;

describe("private CAS fixture", () => {
  runIfPrivateCas("parses a local private CAS statement without structural loss", () => {
    const parsed = parseCasText(readFileSync(privateTextPath!, "utf8"));
    const imported = buildCanonicalCasImport(parsed, {
      importId: "private_cas_fixture",
      fileName: "private-cas.pdf",
      now: "2026-06-22T00:00:00.000Z"
    });

    expect(parsed.errors).toEqual([]);
    expect(parsed.schemes.length).toBeGreaterThan(0);
    expect(parsed.datedRows).toBeGreaterThan(0);
    expect(parsed.parsedFinancialRows + parsed.parsedNonFinancialRows).toBe(parsed.datedRows);
    expect(imported.accounts.length).toBeGreaterThan(0);
    expect(imported.instruments.length).toBeGreaterThan(0);
    expect(imported.manualBalances.length).toBeGreaterThan(0);
  });
});
