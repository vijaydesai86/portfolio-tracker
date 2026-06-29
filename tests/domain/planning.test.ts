import { describe, expect, it } from "vitest";
import { createEmptyBackup, type PortfolioBackup } from "@/src/schema/backup";
import { buildGoal, calculateGoalProgress, createGoalMapping } from "@/src/domain/goalAnalytics";
import { parseGoalExpenseCsv, mergeGoalExpenses } from "@/src/domain/goalExpenses";
import {
  calculateGoalDrawdowns,
  calculateGoalRebalancingPlans,
  calculateIncomeProjection,
  calculatePerformanceAttribution,
  calculateRebalancingPlan,
  calculateScenarioPlan,
  compareSnapshots,
  getPlanningSettings,
  updatePlanningSettings
} from "@/src/domain/planning";
import { createPortfolioSnapshot } from "@/src/domain/snapshots";

function backupFixture(): PortfolioBackup {
  const now = "2026-06-28T00:00:00.000Z";
  const backup = createEmptyBackup("INR");
  backup.accounts.push(
    { id: "acc_eq", name: "Fidelity", institution: "Broker", type: "us_stock", currency: "USD", createdAt: now, updatedAt: now },
    { id: "acc_debt", name: "PPF", institution: "Bank", type: "ppf", currency: "INR", createdAt: now, updatedAt: now },
    { id: "acc_cash", name: "Cash", institution: "Bank", type: "cash", currency: "INR", createdAt: now, updatedAt: now }
  );
  backup.instruments.push(
    { id: "arm", type: "us_stock", name: "ARM", symbol: "ARM", category: "Equity", currency: "USD", country: "US", createdAt: now, updatedAt: now },
    { id: "ppf", type: "ppf", name: "PPF", category: "Debt", currency: "INR", country: "IN", createdAt: now, updatedAt: now },
    { id: "cash", type: "cash", name: "Cash", category: "Cash", currency: "INR", country: "IN", createdAt: now, updatedAt: now }
  );
  backup.priceSnapshots.push(
    { id: "fx_1", instrumentId: "USDINR", asOfDate: "2025-01-01", price: 80, currency: "INR", source: "test", createdAt: now },
    { id: "fx_2", instrumentId: "USDINR", asOfDate: "2026-06-28", price: 90, currency: "INR", source: "test", createdAt: now }
  );
  backup.manualBalances.push(
    { id: "bal_arm", accountId: "acc_eq", instrumentId: "arm", label: "ARM", category: "Equity", value: 1000, currency: "USD", quantity: 10, price: 100, asOfDate: "2026-06-28", source: { type: "manual", provider: "Fidelity" }, createdAt: now, updatedAt: now, userModified: false },
    { id: "bal_ppf", accountId: "acc_debt", instrumentId: "ppf", label: "PPF", category: "Debt", value: 50000, currency: "INR", asOfDate: "2026-06-28", source: { type: "manual", provider: "Manual" }, createdAt: now, updatedAt: now, userModified: false },
    { id: "bal_cash", accountId: "acc_cash", instrumentId: "cash", label: "Cash", category: "Cash", value: 10000, currency: "INR", asOfDate: "2026-06-28", source: { type: "manual", provider: "Manual" }, createdAt: now, updatedAt: now, userModified: false }
  );
  backup.transactions.push(
    { id: "tx_arm_buy", accountId: "acc_eq", instrumentId: "arm", date: "2025-01-01", type: "buy", amount: 500, currency: "USD", quantity: 10, fees: 0, taxes: 0, userModified: false, source: { type: "manual", provider: "Fidelity" }, createdAt: now, updatedAt: now },
    { id: "tx_ppf", accountId: "acc_debt", instrumentId: "ppf", date: "2025-04-01", type: "contribution", amount: 45000, currency: "INR", fees: 0, taxes: 0, userModified: false, source: { type: "manual", provider: "Manual" }, createdAt: now, updatedAt: now },
    { id: "tx_ppf_interest", accountId: "acc_debt", instrumentId: "ppf", date: "2026-03-31", type: "interest_accrual", amount: 5000, currency: "INR", fees: 0, taxes: 0, userModified: false, source: { type: "manual", provider: "Manual" }, createdAt: now, updatedAt: now },
    { id: "tx_cash", accountId: "acc_cash", instrumentId: "cash", date: "2026-01-01", type: "deposit", amount: 10000, currency: "INR", fees: 0, taxes: 0, userModified: false, source: { type: "manual", provider: "Manual" }, createdAt: now, updatedAt: now }
  );
  const goal = buildGoal({ name: "Retirement", type: "retirement", currentMonthlyExpense: 50000, inflationRate: 6, targetYear: 2036, corpusMultiple: 35, equityReturn: 10, debtReturn: 6, cashReturn: 4 }, now);
  backup.goals.push(goal);
  backup.goalMappings.push(createGoalMapping(goal.id, "bal_arm", 100, now), createGoalMapping(goal.id, "bal_ppf", 100, now), createGoalMapping(goal.id, "bal_cash", 100, now));
  return backup;
}

describe("planning analytics", () => {
  it("stores planning assumptions separately from portfolio records", () => {
    const backup = backupFixture();
    const updated = updatePlanningSettings(backup, { scenario: { marketCorrectionPercent: 25 }, targetAllocation: { Equity: 60, Debt: 35, Gold: 0, Others: 0, Cash: 5 } });

    expect(getPlanningSettings(updated).scenario.marketCorrectionPercent).toBe(25);
    expect(getPlanningSettings(updated).targetAllocation.Equity).toBe(60);
    expect(updated.manualBalances).toEqual(backup.manualBalances);
  });

  it("calculates scenario stress without changing real net worth", () => {
    const backup = updatePlanningSettings(backupFixture(), { scenario: { marketCorrectionPercent: 20, usdInrShockPercent: 10 } });
    const plan = calculateScenarioPlan(backup);

    expect(plan.currentValue).toBe(150000);
    expect(plan.stressedValue).toBe(139200);
    expect(plan.oneYearProjectedValue).toBeGreaterThan(plan.currentValue);
    expect(plan.categoryRows.find((row) => row.category === "Equity")?.stressedValue).toBe(79200);
  });

  it("calculates rebalance actions from configurable targets", () => {
    const backup = updatePlanningSettings(backupFixture(), { targetAllocation: { Equity: 50, Debt: 40, Gold: 0, Others: 0, Cash: 10 } });
    const rows = calculateRebalancingPlan(backup);
    const equity = rows.find((row) => row.category === "Equity");
    const debt = rows.find((row) => row.category === "Debt");

    expect(equity?.action).toBe("reduce");
    expect(equity?.driftValue).toBe(15000);
    expect(equity?.actionAmount).toBe(15000);
    expect(debt?.action).toBe("add");
    expect(debt?.driftValue).toBe(-10000);
    expect(debt?.actionAmount).toBe(10000);
  });

  it("calculates goal-level rebalancing from mapped goal values", () => {
    const backup = updatePlanningSettings(backupFixture(), { targetAllocation: { Equity: 50, Debt: 40, Gold: 0, Others: 0, Cash: 10 } });
    const plan = calculateGoalRebalancingPlans(calculateGoalProgress(backup), getPlanningSettings(backup))[0];
    const equity = plan.rows.find((row) => row.category === "Equity");

    expect(plan.goalName).toBe("Retirement");
    expect(plan.currentValue).toBe(150000);
    expect(equity?.action).toBe("reduce");
    expect(equity?.actionAmount).toBe(15000);
  });

  it("projects portfolio income separately from capital gains", () => {
    const backup = backupFixture();
    const projection = calculateIncomeProjection(backup);
    const exempt = projection.rows.find((row) => row.key === "exempt_interest");

    expect(projection.capturedTotal).toBe(5000);
    expect(projection.projectedAnnual).toBeGreaterThan(0);
    expect(exempt?.captured).toBe(5000);
    expect(projection.rows.find((row) => row.key === "maturity")?.projectedAnnual).toBe(0);
  });

  it("projects goal corpus drawdown and depletion from mapped goal corpus", () => {
    const backup = updatePlanningSettings(backupFixture(), { drawdown: { annualSpendGrowth: 6, horizonYears: 45, withdrawalTiming: "beginning" } });
    const progress = calculateGoalProgress(backup);
    const report = calculateGoalDrawdowns(progress, getPlanningSettings(backup));

    expect(report.length).toBe(1);
    expect(report[0].goalName).toBe("Retirement");
    expect(report[0].points.length).toBeGreaterThan(5);
    expect(report[0].startingCorpus).toBe(progress[0].projectedValue);
    expect(report[0].firstYearWithdrawal).toBe(progress[0].firstYearExpense);
    expect(report[0].points[0].drawdownPercent).toBeCloseTo((report[0].points[0].withdrawal / report[0].points[0].startingCorpus) * 100, 1);
  });


  it("uses goal expense rows as drawdown first withdrawal input", () => {
    const backup = backupFixture();
    backup.goals[0] = { ...backup.goals[0], currentMonthlyExpense: 1, inflationRate: 0, corpusMultiple: 10 };
    const parsed = parseGoalExpenseCsv(`expense,amount\nGrocery,50000\nVegetable,50000\nMilk,20000\nFuel,20000\nOthers,1559`, backup, { goalId: backup.goals[0].id, baseDate: "2026-06-28", now: "2026-06-28T00:00:00.000Z" });
    backup.goalExpenses = mergeGoalExpenses([], parsed.rows, parsed.affectedGoalIds, "2026-06-28T00:00:00.000Z");

    const progress = calculateGoalProgress(backup)[0];
    const report = calculateGoalDrawdowns([progress], getPlanningSettings(backup))[0];

    expect(parsed.errors).toEqual([]);
    expect(progress.expenseSource).toBe("expenses");
    expect(progress.firstYearExpense).toBe(1698708);
    expect(report.firstYearWithdrawal).toBe(1698708);
    expect(report.points[0].withdrawal).toBe(1698708);
  });

  it("uses per-goal drawdown assumptions instead of one global assumption", () => {
    const backup = backupFixture();
    const baseGoal = backup.goals[0];
    const secondGoal = buildGoal({ name: "Education", type: "custom", currentMonthlyExpense: 25000, inflationRate: 5, targetYear: 2032, corpusMultiple: 8, equityReturn: 8, debtReturn: 5, cashReturn: 4, drawdownSpendGrowth: 3, drawdownHorizonYears: 12, drawdownWithdrawalTiming: "end" }, "2026-06-28T00:00:00.000Z");
    backup.goals[0] = { ...baseGoal, drawdownSpendGrowth: 7, drawdownHorizonYears: 20, drawdownWithdrawalTiming: "beginning" };
    backup.goals.push(secondGoal);
    backup.goalMappings.push(createGoalMapping(secondGoal.id, "bal_ppf", 50, "2026-06-28T00:00:00.000Z"));

    const report = calculateGoalDrawdowns(calculateGoalProgress(backup), getPlanningSettings(backup));
    const retirement = report.find((row) => row.goalName === "Retirement");
    const education = report.find((row) => row.goalName === "Education");

    expect(retirement?.annualSpendGrowth).toBe(7);
    expect(retirement?.horizonYears).toBe(20);
    expect(retirement?.withdrawalTiming).toBe("beginning");
    expect(education?.annualSpendGrowth).toBe(3);
    expect(education?.horizonYears).toBe(12);
    expect(education?.withdrawalTiming).toBe("end");
  });

  it("derives yearly drawdown returns from the consumption glidepath allocation", () => {
    const backup = backupFixture();
    backup.goals[0] = {
      ...backup.goals[0],
      equityReturn: 10,
      debtReturn: 5,
      cashReturn: 3,
      consumptionTargetAllocation: { Equity: 60, Debt: 35, Gold: 0, Others: 0, Cash: 5 },
      consumptionGlideIntervalYears: 2,
      consumptionGlideShiftPercent: 10,
      consumptionGlideFrom: "Equity",
      consumptionGlideTo: "Debt",
      consumptionGlideFloorPercent: 40,
      drawdownHorizonYears: 6
    };

    const report = calculateGoalDrawdowns(calculateGoalProgress(backup), getPlanningSettings(backup))[0];

    expect(report.points[0].allocation.Equity).toBe(60);
    expect(report.points[0].allocation.Debt).toBe(35);
    expect(report.points[0].weightedReturn).toBeCloseTo(7.9, 5);
    expect(report.points[2].allocation.Equity).toBe(50);
    expect(report.points[2].allocation.Debt).toBe(45);
    expect(report.points[2].weightedReturn).toBeCloseTo(7.4, 5);
    expect(report.points[4].allocation.Equity).toBe(40);
    expect(report.points[4].allocation.Debt).toBe(55);
    expect(report.points[4].weightedReturn).toBeCloseTo(6.9, 5);
    expect(report.points[5].allocation.Equity).toBe(40);
    expect(report.finalAllocation.Equity).toBe(40);
  });

  it("uses corpus consumption years as the exact drawdown projection length", () => {
    const backup = backupFixture();
    backup.goals[0] = { ...backup.goals[0], drawdownHorizonYears: 8, drawdownSpendGrowth: 5, drawdownWithdrawalTiming: "beginning" };

    const report = calculateGoalDrawdowns(calculateGoalProgress(backup), getPlanningSettings(backup))[0];

    expect(report.horizonYears).toBe(8);
    expect(report.points).toHaveLength(8);
    expect(report.points[0].calendarYear).toBe(Number.parseInt(report.targetYear.toString(), 10));
    expect(report.points.at(-1)?.calendarYear).toBe(report.targetYear + 7);
  });


  it("uses per-goal accumulation and consumption target allocations", () => {
    const backup = backupFixture();
    backup.goals[0] = {
      ...backup.goals[0],
      accumulationTargetAllocation: { Equity: 20, Debt: 70, Gold: 0, Others: 0, Cash: 10 },
      consumptionTargetAllocation: { Equity: 0, Debt: 100, Gold: 0, Others: 0, Cash: 0 }
    };

    const progress = calculateGoalProgress(backup);
    const rebalancing = calculateGoalRebalancingPlans(progress, getPlanningSettings(backup))[0];
    const drawdown = calculateGoalDrawdowns(progress, getPlanningSettings(backup))[0];

    expect(rebalancing.rows.find((row) => row.category === "Equity")?.targetPercent).toBe(20);
    expect(rebalancing.rows.find((row) => row.category === "Debt")?.targetPercent).toBe(70);
    expect(drawdown.weightedReturn).toBe(backup.goals[0].debtReturn);
  });


  it("compares frozen snapshots without market refresh", () => {
    const first = createPortfolioSnapshot(backupFixture(), { name: "First", now: "2026-06-28T00:00:00.000Z" });
    const secondBackup = backupFixture();
    secondBackup.manualBalances[0] = { ...secondBackup.manualBalances[0], value: 1200, price: 120 };
    const second = createPortfolioSnapshot(secondBackup, { name: "Second", now: "2026-07-28T00:00:00.000Z" });

    const comparison = compareSnapshots(first, second);

    expect(comparison.netWorthDelta).toBe(18000);
    expect(comparison.categoryDeltas.Equity).toBe(18000);
    expect(comparison.fromName).toBe("First");
    expect(comparison.toName).toBe("Second");
  });

  it("builds a performance attribution bridge from existing portfolio math", () => {
    const attribution = calculatePerformanceAttribution(backupFixture());

    expect(attribution.currentValue).toBe(150000);
    expect(attribution.netCostBasis).toBeGreaterThan(0);
    expect(attribution.marketGain).toBeGreaterThan(0);
    expect(attribution.rows.map((row) => row.key)).toContain("market_gain");
  });
});
