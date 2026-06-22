import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseManualCsv } from "@/src/importers/manualCsv";

const root = resolve(__dirname, "../..");
const fixtureDir = resolve(root, "fixtures/importable");

describe("importable canonical template pack", () => {
  it("parses every committed CSV template without errors", () => {
    const files = readdirSync(fixtureDir).filter((name) => name.endsWith(".csv"));

    expect(files.sort()).toEqual([
      "all-assets-template.csv",
      "cash-espp-template.csv",
      "debt-small-savings-template.csv",
      "equity-mf-india-us-template.csv",
      "gold-others-template.csv"
    ]);

    for (const file of files) {
      const csv = readFileSync(resolve(fixtureDir, file), "utf8");
      const result = parseManualCsv(csv, { importId: `template_${file}` });

      expect(result.errors, file).toEqual([]);
      expect(result.manualBalances.length, file).toBeGreaterThan(0);
    }
  });

  it("covers every requested manual asset type across the template pack", () => {
    const assetTypes = new Set<string>();

    for (const file of readdirSync(fixtureDir).filter((name) => name.endsWith(".csv"))) {
      const csv = readFileSync(resolve(fixtureDir, file), "utf8");
      const result = parseManualCsv(csv, { importId: `template_${file}` });

      expect(result.errors, file).toEqual([]);
      for (const account of result.accounts) {
        assetTypes.add(account.type);
      }
    }
    expect(assetTypes).toEqual(
      new Set([
        "cash",
        "espp",
        "fd",
        "gold",
        "indian_stock",
        "mutual_fund",
        "nps",
        "other",
        "epf",
        "ppf",
        "ssy",
        "us_stock"
      ])
    );
  });
});
