import { describe, expect, it } from "vitest";
import { assetSubtypeDisplayLabel, assetSubtypeLabel } from "@/src/domain/assetSubtype";

describe("asset subtype labels", () => {
  it("keeps equity NPS out of direct stocks", () => {
    const subtype = assetSubtypeLabel({ category: "Equity", assetKind: "NPS", accountType: "nps", instrumentType: "nps" });
    expect(subtype).toBe("NPS");
    expect(assetSubtypeDisplayLabel("Equity", subtype)).toBe("NPS");
  });

  it("labels actual direct stocks as direct stocks", () => {
    const subtype = assetSubtypeLabel({ category: "Equity", assetKind: "Direct Stock", accountType: "us_stock", instrumentType: "us_stock" });
    expect(subtype).toBe("Direct");
    expect(assetSubtypeDisplayLabel("Equity", subtype)).toBe("Direct stocks");
  });

  it("keeps equity mutual funds and ESPP separate from direct stocks", () => {
    expect(assetSubtypeDisplayLabel("Equity", assetSubtypeLabel({ category: "Equity", assetKind: "Mutual Fund", accountType: "mutual_fund", instrumentType: "mutual_fund" }))).toBe("Equity MF");
    expect(assetSubtypeDisplayLabel("Equity", assetSubtypeLabel({ category: "Equity", assetKind: "ESPP", accountType: "espp", instrumentType: "espp" }))).toBe("ESPP");
  });
});
