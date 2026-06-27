import { describe, expect, it } from "vitest";
import { buildGoal, calculateGoalProgress, calculateMappedGoalXirr, createGoalMapping, summarizeGoalProgress } from "@/src/domain/goalAnalytics";
import { calculatePortfolioInsights } from "@/src/domain/analytics";
import { createEmptyBackup } from "@/src/schema/backup";

describe("goal analytics", () => {
  it("calculates expense-inflated corpus target from a multiplier", () => {
    const goal = buildGoal({ name: "Retirement", type: "retirement", currentMonthlyExpense: 100000, inflationRate: 6, targetYear: 2036, corpusMultiple: 35 }, "2026-06-24T00:00:00.000Z");

    expect(goal.name).toBe("Retirement");
    expect(goal.type).toBe("retirement");
    expect(goal.targetDate).toBe("2036-01-01");
    expect(goal.targetAmount).toBeGreaterThan(60000000);
    expect(goal.corpusMultiple).toBe(35);
  });

  it("projects mapped goal corpus using category return assumptions", () => {
    const backup = createEmptyBackup("INR");
    backup.goals.push({
      id: "goal_retire",
      name: "Retirement",
      type: "retirement",
      currentMonthlyExpense: 10000,
      targetAmount: 1200000,
      currency: "INR",
      targetDate: "2028-01-01",
      inflationRate: 0,
      corpusMultiple: 10,
      expectedReturn: 0,
      equityReturn: 10,
      debtReturn: 6,
      goldReturn: 6,
      cashReturn: 6,
      otherReturn: 6,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    backup.accounts.push(
      { id: "acct_eq", name: "Equity", institution: "Manual", type: "us_stock", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "acct_debt", name: "Debt", institution: "Manual", type: "ppf", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
    );
    backup.instruments.push(
      { id: "inst_eq", name: "Equity Holding", type: "us_stock", currency: "INR", country: "US", category: "Equity", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "inst_debt", name: "Debt Holding", type: "ppf", currency: "INR", country: "IN", category: "Debt", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
    );
    backup.manualBalances.push(
      { id: "bal_eq", accountId: "acct_eq", instrumentId: "inst_eq", label: "Equity Holding", category: "Equity", currency: "INR", value: 100000, investedAmount: 80000, investedCurrency: "INR", investedAsOfDate: "2026-01-01", asOfDate: "2026-01-01", source: { type: "manual" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "bal_debt", accountId: "acct_debt", instrumentId: "inst_debt", label: "Debt Holding", category: "Debt", currency: "INR", value: 100000, investedAmount: 90000, investedCurrency: "INR", investedAsOfDate: "2026-01-01", asOfDate: "2026-01-01", source: { type: "manual" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
    );
    backup.goalMappings.push(
      createGoalMapping("goal_retire", "bal_eq", 50, "2026-01-01T00:00:00.000Z"),
      createGoalMapping("goal_retire", "bal_debt", 100, "2026-01-01T00:00:00.000Z")
    );

    const progress = calculateGoalProgress(backup)[0];

    expect(progress.mappedCurrentValue).toBe(150000);
    expect(progress.categoryValues.Equity).toBe(50000);
    expect(progress.categoryValues.Debt).toBe(100000);
    expect(progress.projectedValue).toBeGreaterThan(progress.mappedCurrentValue);
    expect(progress.requiredCorpusToday).toBeGreaterThan(0);
    expect(progress.requiredCorpusToday).toBeLessThan(progress.targetCorpus);
    expect(progress.corpusTodayGap).toBeCloseTo(progress.requiredCorpusToday - progress.mappedCurrentValue, 2);
    expect(progress.mappedInvested).toBe(130000);
    expect(progress.mappedProfit).toBe(20000);
    expect(progress.mappedReturnPercent).toBe(15.38);
    expect(progress.fundedPercent).toBe(12.5);

    const summary = summarizeGoalProgress([progress]);
    expect(summary.requiredCorpusToday).toBe(progress.requiredCorpusToday);
    expect(summary.mappedCurrentValue).toBe(progress.mappedCurrentValue);
    expect(summary.mappedProfit).toBe(progress.mappedProfit);
  });

  it("calculates actual mapped goal XIRR from mapped holding cash flows", () => {
    const backup = createEmptyBackup("INR");
    backup.goals.push({
      id: "goal_retire",
      name: "Retirement",
      type: "retirement",
      currentMonthlyExpense: 10000,
      targetAmount: 1200000,
      currency: "INR",
      targetDate: "2028-01-01",
      inflationRate: 0,
      corpusMultiple: 10,
      expectedReturn: 0,
      equityReturn: 10,
      debtReturn: 6,
      goldReturn: 6,
      cashReturn: 6,
      otherReturn: 6,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    backup.accounts.push({ id: "acct", name: "Fund", institution: "Manual", type: "mutual_fund", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.instruments.push({ id: "inst", name: "Fund", type: "mutual_fund", currency: "INR", country: "IN", category: "Equity", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.manualBalances.push({ id: "bal", accountId: "acct", instrumentId: "inst", label: "Fund", category: "Equity", currency: "INR", value: 121000, asOfDate: "2027-01-01", source: { type: "manual" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2027-01-01T00:00:00.000Z" });
    backup.transactions.push({ id: "buy", accountId: "acct", instrumentId: "inst", date: "2026-01-01", type: "buy", quantity: 100, amount: 100000, currency: "INR", fees: 0, taxes: 0, source: { type: "import" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.goalMappings.push(createGoalMapping("goal_retire", "bal", 50, "2026-01-01T00:00:00.000Z"));

    const progress = calculateGoalProgress(backup);
    const mappedXirr = calculateMappedGoalXirr(backup, progress);

    expect(mappedXirr.mappedHoldings).toBe(1);
    expect(mappedXirr.cashFlowHoldings).toBe(1);
    expect(mappedXirr.missingFx).toEqual([]);
    expect(mappedXirr.xirr).toBeCloseTo(21, 1);
  });

  it("uses portfolio-equivalent XIRR when goal mappings cover the full portfolio", () => {
    const backup = createEmptyBackup("INR");
    backup.goals.push({
      id: "goal_all",
      name: "All Goals",
      type: "custom",
      currentMonthlyExpense: 10000,
      targetAmount: 1200000,
      currency: "INR",
      targetDate: "2028-01-01",
      inflationRate: 0,
      corpusMultiple: 10,
      expectedReturn: 0,
      equityReturn: 10,
      debtReturn: 6,
      goldReturn: 6,
      cashReturn: 6,
      otherReturn: 6,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    backup.accounts.push(
      { id: "cash", name: "INDMoney USD Cash", institution: "INDMoney", type: "cash", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "stock", name: "INDMoney", institution: "INDMoney", type: "us_stock", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
    );
    backup.instruments.push(
      { id: "cash_inst", name: "Cash", type: "cash", currency: "INR", country: "IN", category: "Cash", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "stock_inst", name: "Stock", type: "us_stock", symbol: "STK", currency: "INR", country: "US", category: "Equity", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
    );
    backup.transactions.push(
      { id: "deposit", accountId: "cash", instrumentId: "cash_inst", date: "2026-01-01", type: "deposit", amount: 100000, currency: "INR", fees: 0, taxes: 0, source: { type: "import", provider: "indmoney_export" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "buy", accountId: "stock", instrumentId: "stock_inst", date: "2026-07-01", type: "buy", quantity: 10, amount: 100000, currency: "INR", fees: 0, taxes: 0, source: { type: "import", provider: "indmoney_export" }, userModified: false, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z" }
    );
    backup.manualBalances.push({ id: "stock_bal", accountId: "stock", instrumentId: "stock_inst", label: "Stock", category: "Equity", currency: "INR", value: 120000, quantity: 10, price: 12000, asOfDate: "2027-01-01", source: { type: "import", provider: "indmoney_export" }, userModified: false, createdAt: "2027-01-01T00:00:00.000Z", updatedAt: "2027-01-01T00:00:00.000Z" });
    backup.goalMappings.push(createGoalMapping("goal_all", "stock_bal", 100, "2026-01-01T00:00:00.000Z"));

    const progress = calculateGoalProgress(backup);
    const mappedXirr = calculateMappedGoalXirr(backup, progress);
    const overallXirr = calculatePortfolioInsights(backup).xirrBase;

    expect(mappedXirr.basis).toBe("portfolio");
    expect(mappedXirr.xirr).toBe(overallXirr);
  });
});
