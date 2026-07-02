import { describe, expect, it } from "vitest";
import { buildGoal, calculateGoalProgress, calculateMappedGoalXirr, createGoalMapping, summarizeGoalProgress } from "@/src/domain/goalAnalytics";
import { calculatePortfolioInsights, calculatePortfolioSummary } from "@/src/domain/analytics";
import { calculateTrackedLocalValue, calculateTrackedUnitPrice } from "@/src/domain/tapering";
import { createEmptyBackup, parseBackup } from "@/src/schema/backup";

describe("goal analytics", () => {
  it("calculates expense-inflated corpus target from a multiplier", () => {
    const goal = buildGoal({ name: "Retirement", type: "retirement", currentMonthlyExpense: 100000, inflationRate: 6, targetYear: 2036, corpusMultiple: 35 }, "2026-06-24T00:00:00.000Z");

    expect(goal.name).toBe("Retirement");
    expect(goal.type).toBe("retirement");
    expect(goal.targetDate).toBe("2036-01-01");
    expect(goal.targetAmount).toBeGreaterThan(60000000);
    expect(goal.corpusMultiple).toBe(35);
    expect(goal.includeInCombinedGoals).toBe(true);
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
      drawdownSpendGrowth: 6,
      drawdownHorizonYears: 45,
      drawdownWithdrawalTiming: "beginning",
      includeInCombinedGoals: true,
      includeInExpenseTotals: true,
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


  it("keeps goal projection unchanged unless accumulation glide is enabled", () => {
    const backup = createEmptyBackup("INR");
    const baseGoal = buildGoal({ name: "Retirement", type: "retirement", currentMonthlyExpense: 10000, inflationRate: 0, targetYear: 2030, corpusMultiple: 10, equityReturn: 10, debtReturn: 6 }, "2026-01-01T00:00:00.000Z");
    backup.goals.push({ ...baseGoal, id: "goal_retire", targetDate: "2030-01-01", targetAmount: 1200000, accumulationGlideShiftPercent: 0 });
    backup.accounts.push({ id: "acct_eq", name: "Equity", institution: "Manual", type: "mutual_fund", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.instruments.push({ id: "inst_eq", name: "Equity Holding", type: "mutual_fund", currency: "INR", country: "IN", category: "Equity", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.manualBalances.push({ id: "bal_eq", accountId: "acct_eq", instrumentId: "inst_eq", label: "Equity Holding", category: "Equity", currency: "INR", value: 100000, investedAmount: 80000, investedCurrency: "INR", investedAsOfDate: "2026-01-01", asOfDate: "2026-01-01", source: { type: "manual" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.goalMappings.push(createGoalMapping("goal_retire", "bal_eq", 100, "2026-01-01T00:00:00.000Z"));

    const progress = calculateGoalProgress(backup)[0];
    const expected = 100000 * Math.pow(1.1, progress.yearsToGoal);

    expect(progress.projectedValue).toBeCloseTo(expected, 2);
    expect(progress.projectedCategoryValues.Equity).toBeCloseTo(progress.projectedValue, 2);
    expect(progress.projectedCategoryValues.Debt).toBe(0);
  });

  it("applies accumulation glide to pre-goal projected category values", () => {
    const backup = createEmptyBackup("INR");
    const baseGoal = buildGoal({ name: "Retirement", type: "retirement", currentMonthlyExpense: 10000, inflationRate: 0, targetYear: 2030, corpusMultiple: 10, equityReturn: 10, debtReturn: 6 }, "2026-01-01T00:00:00.000Z");
    backup.goals.push({
      ...baseGoal,
      id: "goal_retire",
      targetDate: "2030-01-01",
      targetAmount: 1200000,
      accumulationGlideStartYearsBeforeGoal: 4,
      accumulationGlideIntervalYears: 1,
      accumulationGlideShiftPercent: 20,
      accumulationGlideFrom: "Equity",
      accumulationGlideTo: "Debt",
      accumulationGlideFloorPercent: 40
    });
    backup.accounts.push({ id: "acct_eq", name: "Equity", institution: "Manual", type: "mutual_fund", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.instruments.push({ id: "inst_eq", name: "Equity Holding", type: "mutual_fund", currency: "INR", country: "IN", category: "Equity", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.manualBalances.push({ id: "bal_eq", accountId: "acct_eq", instrumentId: "inst_eq", label: "Equity Holding", category: "Equity", currency: "INR", value: 100000, investedAmount: 80000, investedCurrency: "INR", investedAsOfDate: "2026-01-01", asOfDate: "2026-01-01", source: { type: "manual" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.goalMappings.push(createGoalMapping("goal_retire", "bal_eq", 100, "2026-01-01T00:00:00.000Z"));

    const progress = calculateGoalProgress(backup)[0];
    const noGlideProjection = 100000 * Math.pow(1.1, progress.yearsToGoal);

    expect(progress.projectedValue).toBeLessThan(noGlideProjection);
    expect(progress.projectedValue).toBeGreaterThan(progress.mappedCurrentValue);
    expect(progress.projectedCategoryValues.Equity).toBeGreaterThan(0);
    expect(progress.projectedCategoryValues.Debt).toBeGreaterThan(0);
    expect(progress.projectedCategoryValues.Equity + progress.projectedCategoryValues.Debt).toBeCloseTo(progress.projectedValue, 1);
  });

  it("uses accumulation target allocation as the glide starting mix when configured", () => {
    const makeBackup = (allocation?: { Equity?: number; Debt?: number }) => {
      const backup = createEmptyBackup("INR");
      const goal = buildGoal({ name: "Retirement", type: "retirement", currentMonthlyExpense: 10000, inflationRate: 0, targetYear: 2030, corpusMultiple: 10, equityReturn: 10, debtReturn: 6 }, "2026-01-01T00:00:00.000Z");
      backup.goals.push({
        ...goal,
        id: "goal_retire",
        targetDate: "2030-01-01",
        targetAmount: 1200000,
        accumulationTargetAllocation: allocation,
        accumulationGlideStartYearsBeforeGoal: 4,
        accumulationGlideIntervalYears: 1,
        accumulationGlideShiftPercent: 10,
        accumulationGlideFrom: "Equity",
        accumulationGlideTo: "Debt",
        accumulationGlideFloorPercent: 20
      });
      backup.accounts.push({ id: "acct_eq", name: "Equity", institution: "Manual", type: "mutual_fund", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
      backup.instruments.push({ id: "inst_eq", name: "Equity Holding", type: "mutual_fund", currency: "INR", country: "IN", category: "Equity", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
      backup.manualBalances.push({ id: "bal_eq", accountId: "acct_eq", instrumentId: "inst_eq", label: "Equity Holding", category: "Equity", currency: "INR", value: 100000, investedAmount: 80000, investedCurrency: "INR", investedAsOfDate: "2026-01-01", asOfDate: "2026-01-01", source: { type: "manual" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
      backup.goalMappings.push(createGoalMapping("goal_retire", "bal_eq", 100, "2026-01-01T00:00:00.000Z"));
      return backup;
    };

    const currentMixProgress = calculateGoalProgress(makeBackup())[0];
    const targetMixProgress = calculateGoalProgress(makeBackup({ Equity: 50, Debt: 50 }))[0];

    expect(targetMixProgress.projectedCategoryValues.Debt).toBeGreaterThan(currentMixProgress.projectedCategoryValues.Debt);
    expect(targetMixProgress.projectedCategoryValues.Equity).toBeLessThan(currentMixProgress.projectedCategoryValues.Equity);
    expect(targetMixProgress.projectedValue).toBeLessThan(currentMixProgress.projectedValue);
  });

  it("uses per-holding taper only for goal planning and keeps actual portfolio value unchanged", () => {
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
      drawdownSpendGrowth: 6,
      drawdownHorizonYears: 45,
      drawdownWithdrawalTiming: "beginning",
      includeInCombinedGoals: true,
      includeInExpenseTotals: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    backup.accounts.push({ id: "acct", name: "Stock", institution: "Manual", type: "us_stock", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.instruments.push({ id: "inst", name: "Stock", type: "us_stock", symbol: "STK", currency: "INR", country: "US", category: "Equity", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.manualBalances.push({ id: "bal", accountId: "acct", instrumentId: "inst", label: "Stock", category: "Equity", currency: "INR", value: 1000, quantity: 10, price: 100, taperMode: "medium", asOfDate: "2027-01-01", source: { type: "manual" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2027-01-01T00:00:00.000Z" });
    backup.transactions.push({ id: "buy", accountId: "acct", instrumentId: "inst", date: "2026-01-01", type: "buy", quantity: 10, amount: 800, currency: "INR", fees: 0, taxes: 0, source: { type: "manual" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.goalMappings.push(createGoalMapping("goal_retire", "bal", 100, "2026-01-01T00:00:00.000Z"));

    const trackedPrice = calculateTrackedUnitPrice(100, 0.05);
    const tracked = calculateTrackedLocalValue(backup.manualBalances[0]);
    const progress = calculateGoalProgress(backup)[0];
    const summary = calculatePortfolioSummary(backup);
    const insight = calculatePortfolioInsights(backup).holdings[0];
    const parsed = parseBackup(JSON.parse(JSON.stringify(backup)));
    const mappedXirr = calculateMappedGoalXirr(backup, [progress]);

    expect(trackedPrice).toBeCloseTo(66.6667, 4);
    expect(tracked.applied).toBe(true);
    expect(tracked.trackedLocalValue).toBe(666.67);
    expect(summary.netWorth).toBe(1000);
    expect(progress.mappedCurrentValue).toBe(666.67);
    expect(progress.mappedHoldings[0].actualValue).toBe(1000);
    expect(progress.mappedHoldings[0].trackedDiscount).toBe(333.33);
    expect(insight.valueInBase).toBe(1000);
    expect(insight.trackedValueInBase).toBe(666.67);
    expect(parsed.manualBalances[0].taperMode).toBe("medium");
    expect(mappedXirr.basis).toBe("holdings");
  });

  it("falls back to actual value when taper is configured on a balance without price and quantity", () => {
    const backup = createEmptyBackup("INR");
    backup.goals.push({
      id: "goal_cash",
      name: "Cash Goal",
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
      drawdownSpendGrowth: 6,
      drawdownHorizonYears: 45,
      drawdownWithdrawalTiming: "beginning",
      includeInCombinedGoals: true,
      includeInExpenseTotals: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    backup.accounts.push({ id: "cash", name: "Cash", institution: "Manual", type: "cash", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.manualBalances.push({ id: "cash_bal", accountId: "cash", label: "Cash", category: "Cash", currency: "INR", value: 50000, taperMode: "strong", asOfDate: "2027-01-01", source: { type: "manual" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2027-01-01T00:00:00.000Z" });
    backup.goalMappings.push(createGoalMapping("goal_cash", "cash_bal", 100, "2026-01-01T00:00:00.000Z"));

    const tracked = calculateTrackedLocalValue(backup.manualBalances[0]);
    const progress = calculateGoalProgress(backup)[0];

    expect(tracked.applied).toBe(false);
    expect(tracked.reason).toBe("needs price and quantity");
    expect(progress.mappedCurrentValue).toBe(50000);
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
      drawdownSpendGrowth: 6,
      drawdownHorizonYears: 45,
      drawdownWithdrawalTiming: "beginning",
      includeInCombinedGoals: true,
      includeInExpenseTotals: true,
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
      drawdownSpendGrowth: 6,
      drawdownHorizonYears: 45,
      drawdownWithdrawalTiming: "beginning",
      includeInCombinedGoals: true,
      includeInExpenseTotals: true,
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
