import { describe, expect, it } from "vitest";
import { calculateGoalProgress, buildGoal } from "@/src/domain/goalAnalytics";
import { mergeGoalExpenses, parseGoalExpenseCsv, summarizeGoalExpenses } from "@/src/domain/goalExpenses";
import { createEmptyBackup, parseBackup } from "@/src/schema/backup";

describe("goal expenses", () => {
  it("parses a two-column expense CSV for the selected goal", () => {
    const backup = createEmptyBackup("INR");
    const goal = buildGoal({ name: "Retirement", type: "retirement", currentMonthlyExpense: 1000, inflationRate: 0, targetYear: 2037, corpusMultiple: 35 }, "2026-06-29T00:00:00.000Z");
    backup.goals.push(goal);

    const parsed = parseGoalExpenseCsv("expense,amount\nGrocery,50000\nVegetable,50000\nMilk,20000\nFuel,20000\nOthers,1559", backup, { goalId: goal.id, baseDate: "2026-06-29", now: "2026-06-29T00:00:00.000Z" });

    expect(parsed.errors).toEqual([]);
    expect(parsed.mode).toBe("single-goal");
    expect(parsed.rows).toHaveLength(5);
    expect(parsed.affectedGoalIds).toEqual([goal.id]);
    expect(parsed.rows.reduce((sum, row) => sum + row.amount, 0)).toBe(141559);
  });

  it("parses a combined goal expense CSV by goal name", () => {
    const backup = createEmptyBackup("INR");
    const retirement = buildGoal({ name: "Retirement", type: "retirement", currentMonthlyExpense: 0, inflationRate: 0, targetYear: 2037, corpusMultiple: 35 }, "2026-06-29T00:00:00.000Z");
    const bhoomi = buildGoal({ name: "Bhoomi", type: "custom", currentMonthlyExpense: 0, inflationRate: 0, targetYear: 2037, corpusMultiple: 13 }, "2026-06-29T00:00:00.000Z");
    backup.goals.push(retirement, bhoomi);

    const parsed = parseGoalExpenseCsv("goal,base_date,expense,amount\nRetirement,2026-06-29,Grocery,50000\nBhoomi,2026-06-29,Grocery,25000", backup, { now: "2026-06-29T00:00:00.000Z" });

    expect(parsed.errors).toEqual([]);
    expect(parsed.mode).toBe("combined");
    expect(parsed.affectedGoalIds.sort()).toEqual([bhoomi.id, retirement.id].sort());
    expect(parsed.rows.find((row) => row.goalId === bhoomi.id)?.amount).toBe(25000);
  });

  it("derives goal target and first-year spend from expense rows when present", () => {
    const backup = createEmptyBackup("INR");
    const goal = buildGoal({ name: "Retirement", type: "retirement", currentMonthlyExpense: 1, inflationRate: 0, targetYear: 2037, corpusMultiple: 35 }, "2026-06-29T00:00:00.000Z");
    backup.goals.push(goal);
    const parsed = parseGoalExpenseCsv("expense,amount\nGrocery,50000\nVegetable,50000\nMilk,20000\nFuel,20000\nOthers,1559", backup, { goalId: goal.id, baseDate: "2026-06-29", now: "2026-06-29T00:00:00.000Z" });
    backup.goalExpenses = mergeGoalExpenses([], parsed.rows, parsed.affectedGoalIds, "2026-06-29T00:00:00.000Z");

    const progress = calculateGoalProgress(backup)[0];
    const expenseSummary = summarizeGoalExpenses(goal, backup.goalExpenses, new Date("2026-06-29T00:00:00.000Z"));

    expect(expenseSummary.baseMonthlyExpense).toBe(141559);
    expect(progress.expenseSource).toBe("expenses");
    expect(progress.expenseRowCount).toBe(5);
    expect(progress.startingMonthlyExpense).toBe(141559);
    expect(progress.firstYearExpense).toBe(1698708);
    expect(progress.targetCorpus).toBe(59454780);
  });

  it("keeps older JSON backups valid with no goal expense rows", () => {
    const backup = createEmptyBackup("INR");
    const raw = JSON.parse(JSON.stringify(backup));
    delete raw.goalExpenses;

    const parsed = parseBackup(raw);

    expect(parsed.goalExpenses).toEqual([]);
  });
});
