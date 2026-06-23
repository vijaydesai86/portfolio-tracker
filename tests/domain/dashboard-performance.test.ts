import { describe, expect, it } from "vitest";
import { calculateDashboardPerformance } from "@/src/domain/dashboardPerformance";
import type { PortfolioInsights, PortfolioSummary } from "@/src/domain/analytics";
import type { HoldingReturn } from "@/src/domain/holdingReturns";

function summary(netWorth: number): PortfolioSummary {
  return {
    netWorth,
    allocation: {
      Equity: { value: netWorth, percent: 100 },
      Debt: { value: 0, percent: 0 },
      Gold: { value: 0, percent: 0 },
      Others: { value: 0, percent: 0 },
      Cash: { value: 0, percent: 0 }
    },
    missingFx: []
  };
}

function stats(externalCashInBase: number, externalCashOutBase: number): PortfolioInsights["transactionStats"] {
  return {
    count: 0,
    investedBase: externalCashInBase,
    incomeBase: externalCashOutBase,
    feesAndTaxesBase: 0,
    investedByCurrency: {},
    incomeByCurrency: {},
    feesAndTaxesByCurrency: {},
    externalCashInBase,
    externalCashOutBase,
    tradeBuyBase: 0,
    tradeSellBase: 0,
    externalCashInByCurrency: {},
    externalCashOutByCurrency: {},
    tradeBuyByCurrency: {},
    tradeSellByCurrency: {},
    missingFx: []
  };
}

function holding(currentValue: number, netInvested: number): HoldingReturn {
  return {
    currentValue,
    invested: netInvested,
    cashOut: 0,
    netInvested,
    costBasisKnown: true,
    hasCashFlows: true,
    profit: currentValue - netInvested,
    returnPercent: ((currentValue - netInvested) / netInvested) * 100,
    xirr: 10,
    allocationPercent: 100,
    missingFx: []
  };
}

describe("calculateDashboardPerformance", () => {
  it("uses holding remaining cost basis for headline invested and P/L, not external cash-flow net", () => {
    const performance = calculateDashboardPerformance(summary(25501094.74), stats(7960937.4, 1103655), [holding(25501094.74, 7018959.4)]);

    expect(performance.grossCashIn).toBe(7960937.4);
    expect(performance.cashOut).toBe(1103655);
    expect(performance.netInvested).toBe(7018959.4);
    expect(performance.totalProfit).toBeCloseTo(18482135.34, 2);
    expect(performance.netInvested).not.toBeCloseTo(6857282.4, 2);
  });
});
