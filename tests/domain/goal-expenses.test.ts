import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  it("accepts DD-MM-YYYY expense dates and stores canonical dates", () => {
    const backup = createEmptyBackup("INR");
    const goal = buildGoal({ name: "Chinnu", type: "custom", currentMonthlyExpense: 0, inflationRate: 0, targetYear: 2030, corpusMultiple: 1 }, "2026-06-29T00:00:00.000Z");
    backup.goals.push(goal);

    const parsed = parseGoalExpenseCsv("goal,as_of_date,scenario,category,item,amount,active_scenario\nChinnu,01-01-2026,Current,Graduation,Graduation,85000,yes", backup, { now: "2026-06-29T00:00:00.000Z" });

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0].baseDate).toBe("2026-01-01");
    expect(parsed.activeScenarios[goal.id]).toBe("Current");
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

  it("parses detail-first rows with scenario, quantity math, payer split, and yearly monthly spread", () => {
    const backup = createEmptyBackup("INR");
    const goal = buildGoal({ name: "Retirement", type: "retirement", currentMonthlyExpense: 1, inflationRate: 0, targetYear: 2037, corpusMultiple: 35 }, "2026-06-29T00:00:00.000Z");
    backup.goals.push(goal);

    const csv = [
      "goal,as_of_date,scenario,category,sub_category,item,amount,frequency,payer,quantity,unit_amount,active_scenario,notes",
      "Retirement,2026-01-01,Retirement,Adhoc,Yearly spread,House tax,30000,yearly,Vijay,,,yes,annual spread",
      "Retirement,2026-01-01,Retirement,Classes,Math,Teacher,,monthly,Archana,2,1000,,quantity x unit",
      "Retirement,2026-01-01,Current,Food,Grocery,Grocery,50000,monthly,Vijay,,,,comparison scenario"
    ].join("\n");

    const parsed = parseGoalExpenseCsv(csv, backup, { now: "2026-06-29T00:00:00.000Z" });

    expect(parsed.errors).toEqual([]);
    expect(parsed.mode).toBe("combined");
    expect(parsed.activeScenarios[goal.id]).toBe("Retirement");
    expect(parsed.rows.find((row) => row.expense === "House tax")?.amount).toBe(2500);
    expect(parsed.rows.find((row) => row.expense === "Teacher")?.amount).toBe(2000);

    const summary = summarizeGoalExpenses({ ...goal, expenseScenario: parsed.activeScenarios[goal.id] }, parsed.rows, new Date("2026-06-29T00:00:00.000Z"));
    expect(summary.source).toBe("expenses");
    expect(summary.selectedScenario).toBe("Retirement");
    expect(summary.baseMonthlyExpense).toBe(4500);
    expect(summary.categoryTotals).toEqual([
      { category: "Adhoc", baseMonthlyExpense: 2500, rows: 1 },
      { category: "Classes", baseMonthlyExpense: 2000, rows: 1 }
    ]);
    expect(summary.payerTotals).toEqual([
      { payer: "Vijay", baseMonthlyExpense: 2500, rows: 1 },
      { payer: "Archana", baseMonthlyExpense: 2000, rows: 1 }
    ]);
  });

  it("parses importable goal-expense fixtures with exact base monthly totals", () => {
    const backup = createEmptyBackup("INR");
    const retirement = buildGoal({ name: "Retirement", type: "retirement", currentMonthlyExpense: 0, inflationRate: 7, targetYear: 2037, corpusMultiple: 35 }, "2026-06-29T00:00:00.000Z");
    const bhoomi = buildGoal({ name: "Bhoomi", type: "custom", currentMonthlyExpense: 0, inflationRate: 9, targetYear: 2037, corpusMultiple: 13 }, "2026-06-29T00:00:00.000Z");
    const chinnu = buildGoal({ name: "Chinnu", type: "custom", currentMonthlyExpense: 0, inflationRate: 9, targetYear: 2030, corpusMultiple: 1 }, "2026-06-29T00:00:00.000Z");
    backup.goals.push(retirement, bhoomi, chinnu);

    for (const name of ["goal-expenses-retirement.csv", "goal-expenses-bhoomi.csv", "goal-expenses-chinnu.csv"]) {
      const csv = readFileSync(resolve(__dirname, "../..", "fixtures/importable", name), "utf8");
      const parsed = parseGoalExpenseCsv(csv, backup, { now: "2026-06-29T00:00:00.000Z" });
      expect(parsed.errors, name).toEqual([]);
      backup.goalExpenses = mergeGoalExpenses(backup.goalExpenses, parsed.rows, parsed.affectedGoalIds, "2026-06-29T00:00:00.000Z");
      backup.goals = backup.goals.map((goal) => parsed.activeScenarios[goal.id] ? { ...goal, expenseScenario: parsed.activeScenarios[goal.id] } : goal);
    }

    const retirementSummary = summarizeGoalExpenses(backup.goals.find((goal) => goal.name === "Retirement")!, backup.goalExpenses.filter((row) => row.goalId === retirement.id), new Date("2026-06-29T00:00:00.000Z"));
    const bhoomiSummary = summarizeGoalExpenses(backup.goals.find((goal) => goal.name === "Bhoomi")!, backup.goalExpenses.filter((row) => row.goalId === bhoomi.id), new Date("2026-06-29T00:00:00.000Z"));
    const chinnuSummary = summarizeGoalExpenses(backup.goals.find((goal) => goal.name === "Chinnu")!, backup.goalExpenses.filter((row) => row.goalId === chinnu.id), new Date("2026-06-29T00:00:00.000Z"));

    expect(retirementSummary.selectedScenario).toBe("Retirement");
    expect(retirementSummary.baseMonthlyExpense).toBe(137500);
    expect(retirementSummary.scenarioTotals).toEqual(expect.arrayContaining([
      { scenario: "Current", baseMonthlyExpense: 210700, rows: 62 },
      { scenario: "Retirement", baseMonthlyExpense: 137500, rows: 16 },
      { scenario: "Bare Minimum", baseMonthlyExpense: 133125, rows: 16 },
      { scenario: "Retire Now", baseMonthlyExpense: 210700, rows: 16 }
    ]));
    expect(retirementSummary.categoryTotals.find((row) => row.category === "Adhoc")?.baseMonthlyExpense).toBe(27250);
    const currentRetirementSummary = summarizeGoalExpenses({ ...retirement, expenseScenario: "Current" }, backup.goalExpenses.filter((row) => row.goalId === retirement.id), new Date("2026-06-29T00:00:00.000Z"));
    expect(currentRetirementSummary.baseMonthlyExpense).toBe(210700);
    expect(currentRetirementSummary.payerTotals).toEqual([
      { payer: "Vijay", baseMonthlyExpense: 112200, rows: 46 },
      { payer: "Archana", baseMonthlyExpense: 98500, rows: 15 },
      { payer: "Unassigned", baseMonthlyExpense: 0, rows: 1 }
    ]);
    expect(bhoomiSummary.baseMonthlyExpense).toBe(74500);
    expect(chinnuSummary.baseMonthlyExpense).toBe(141559);
  });

  it("keeps older JSON backups valid with no goal expense rows", () => {
    const backup = createEmptyBackup("INR");
    const raw = JSON.parse(JSON.stringify(backup));
    delete raw.goalExpenses;

    const parsed = parseBackup(raw);

    expect(parsed.goalExpenses).toEqual([]);
  });
});
