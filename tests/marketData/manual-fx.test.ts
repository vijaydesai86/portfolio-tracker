import { describe, expect, it } from "vitest";
import { buildUsdInrSnapshot, parseUsdInrFxCsv } from "@/src/marketData/manualFx";

describe("manual USD/INR FX input", () => {
  it("builds a validated USDINR price snapshot", () => {
    expect(buildUsdInrSnapshot(83.25, "2026-06-22")).toMatchObject({
      instrumentId: "USDINR",
      price: 83.25,
      currency: "INR",
      asOfDate: "2026-06-22",
      source: "manual_fx"
    });
  });

  it("parses date,rate CSV rows", () => {
    const parsed = parseUsdInrFxCsv("date,rate\n2026-01-01,82.5\n2026-01-02,83");
    expect(parsed.errors).toEqual([]);
    expect(parsed.snapshots.map((snapshot) => [snapshot.asOfDate, snapshot.price])).toEqual([
      ["2026-01-01", 82.5],
      ["2026-01-02", 83]
    ]);
  });
});
