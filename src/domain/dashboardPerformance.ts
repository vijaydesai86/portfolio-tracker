import type { PortfolioInsights, PortfolioSummary } from "@/src/domain/analytics";
import type { HoldingReturn } from "@/src/domain/holdingReturns";

export type DashboardPerformance = {
  grossCashIn: number;
  current: number;
  cashOut: number;
  feesAndTax: number;
  netInvested: number;
  currentWithCostBasis: number;
  currentProfit: number;
  totalProfit: number;
  profitKnown: boolean;
  absoluteReturnPercent: number | null;
};

export function calculateDashboardPerformance(
  summary: PortfolioSummary,
  transactionStats: PortfolioInsights["transactionStats"],
  holdingReturns: Iterable<HoldingReturn>
): DashboardPerformance {
  const grossCashIn = transactionStats.externalCashInBase;
  const current = summary.netWorth;
  const cashOut = transactionStats.externalCashOutBase;
  const feesAndTax = transactionStats.feesAndTaxesBase;
  const knownReturns = [...holdingReturns].filter((row) => row.costBasisKnown && row.currentValue !== undefined);
  const netInvested = knownReturns.reduce((sum, row) => sum + row.netInvested, 0);
  const currentWithCostBasis = knownReturns.reduce((sum, row) => sum + (row.currentValue ?? 0), 0);
  const currentProfit = knownReturns.reduce((sum, row) => sum + (row.profit ?? 0), 0);
  const totalProfit = currentProfit;
  const profitKnown = knownReturns.length > 0;

  return {
    grossCashIn,
    current,
    cashOut,
    feesAndTax,
    netInvested,
    currentWithCostBasis,
    currentProfit,
    totalProfit,
    profitKnown,
    absoluteReturnPercent: !profitKnown || netInvested === 0 ? null : (totalProfit / netInvested) * 100
  };
}
