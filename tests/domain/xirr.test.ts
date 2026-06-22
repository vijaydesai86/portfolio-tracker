import { describe, expect, it } from "vitest";
import { calculateXirr } from "@/src/domain/xirr";

describe("calculateXirr", () => {
  it("calculates annualized internal rate of return", () => {
    expect(calculateXirr([
      { date: "2025-01-01", amount: -1000 },
      { date: "2026-01-01", amount: 1100 }
    ])).toBeCloseTo(9.99, 1);
  });

  it("returns null when cash flows do not have both signs", () => {
    expect(calculateXirr([{ date: "2026-01-01", amount: 100 }])).toBeNull();
  });
});
