import { describe, expect, it } from "vitest";
import { buildGoal, calculateGoalProgress, createGoalMapping } from "@/src/domain/goalAnalytics";
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
      { id: "bal_eq", accountId: "acct_eq", instrumentId: "inst_eq", label: "Equity Holding", category: "Equity", currency: "INR", value: 100000, asOfDate: "2026-01-01", source: { type: "manual" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "bal_debt", accountId: "acct_debt", instrumentId: "inst_debt", label: "Debt Holding", category: "Debt", currency: "INR", value: 100000, asOfDate: "2026-01-01", source: { type: "manual" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
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
    expect(progress.fundedPercent).toBe(12.5);
  });
});
