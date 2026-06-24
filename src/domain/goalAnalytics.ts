import { calculateHoldingReturns } from "@/src/domain/holdingReturns";
import { tryConvertToBase } from "@/src/domain/analytics";
import type { AssetCategory, Goal, GoalMapping, ManualBalance, PortfolioBackup } from "@/src/schema/backup";

export type GoalDraft = {
  name: string;
  type?: Goal["type"];
  currentMonthlyExpense: number;
  inflationRate: number;
  targetYear: number;
  corpusMultiple: number;
  currency?: string;
  expectedReturn?: number;
  equityReturn?: number;
  debtReturn?: number;
  goldReturn?: number;
  cashReturn?: number;
  otherReturn?: number;
};

export type GoalProgress = {
  goal: Goal;
  yearsToGoal: number;
  startingMonthlyExpense: number;
  firstYearExpense: number;
  targetCorpus: number;
  mappedCurrentValue: number;
  projectedValue: number;
  gapToday: number;
  projectedGap: number;
  fundedPercent: number;
  projectedFundedPercent: number;
  categoryValues: Record<AssetCategory, number>;
  projectedCategoryValues: Record<AssetCategory, number>;
  mappedHoldings: Array<{ balance: ManualBalance; mappedPercent: number; value: number; projectedValue: number }>;
};

const categories: AssetCategory[] = ["Equity", "Debt", "Gold", "Others", "Cash"];

export function buildGoal(input: GoalDraft, now = new Date().toISOString()): Goal {
  const targetYear = normalizeTargetYear(input.targetYear);
  const targetDate = `${targetYear}-01-01`;
  const years = yearsUntil(targetDate);
  const startingMonthlyExpense = futureValue(input.currentMonthlyExpense, input.inflationRate, years);
  const firstYearExpense = startingMonthlyExpense * 12;
  const targetAmount = firstYearExpense * input.corpusMultiple;
  return {
    id: "goal_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8),
    name: input.name.trim() || "Goal",
    type: input.type ?? "custom",
    currentMonthlyExpense: roundMoney(input.currentMonthlyExpense),
    targetAmount: roundMoney(targetAmount),
    currency: input.currency ?? "INR",
    targetDate,
    inflationRate: input.inflationRate,
    corpusMultiple: input.corpusMultiple,
    expectedReturn: input.expectedReturn ?? 0,
    equityReturn: input.equityReturn ?? 10,
    debtReturn: input.debtReturn ?? 6,
    goldReturn: input.goldReturn ?? 6,
    cashReturn: input.cashReturn ?? 6,
    otherReturn: input.otherReturn ?? 6,
    createdAt: now,
    updatedAt: now
  };
}

export function recalculateGoalTarget(goal: Goal): Goal {
  const years = yearsUntil(goal.targetDate);
  const startingMonthlyExpense = futureValue(goal.currentMonthlyExpense ?? 0, goal.inflationRate, years);
  return { ...goal, targetAmount: roundMoney(startingMonthlyExpense * 12 * (goal.corpusMultiple ?? 1)) };
}

export function calculateGoalProgress(backup: PortfolioBackup): GoalProgress[] {
  const holdingReturns = calculateHoldingReturns(backup);
  return backup.goals.map((goal) => {
    const recalculated = recalculateGoalTarget(goal);
    const years = yearsUntil(recalculated.targetDate);
    const categoryValues = emptyCategoryRecord();
    const projectedCategoryValues = emptyCategoryRecord();
    const mappedHoldings: GoalProgress["mappedHoldings"] = [];

    for (const balance of backup.manualBalances) {
      const percent = mappingPercentForBalance(backup.goalMappings, recalculated.id, balance);
      if (percent <= 0) continue;
      const current = holdingReturns.get(balance.id)?.currentValue ?? tryConvertToBase(balance.value, balance.currency, backup) ?? 0;
      const mappedValue = current * (percent / 100);
      const projectedValue = mappedValue * Math.pow(1 + returnRateForCategory(recalculated, balance.category) / 100, years);
      categoryValues[balance.category] += mappedValue;
      projectedCategoryValues[balance.category] += projectedValue;
      mappedHoldings.push({ balance, mappedPercent: percent, value: roundMoney(mappedValue), projectedValue: roundMoney(projectedValue) });
    }

    const mappedCurrentValue = sumCategories(categoryValues);
    const projectedValue = sumCategories(projectedCategoryValues);
    const startingMonthlyExpense = futureValue(recalculated.currentMonthlyExpense ?? 0, recalculated.inflationRate, years);
    const firstYearExpense = startingMonthlyExpense * 12;
    const targetCorpus = recalculated.targetAmount;
    return {
      goal: recalculated,
      yearsToGoal: years,
      startingMonthlyExpense: roundMoney(startingMonthlyExpense),
      firstYearExpense: roundMoney(firstYearExpense),
      targetCorpus: roundMoney(targetCorpus),
      mappedCurrentValue: roundMoney(mappedCurrentValue),
      projectedValue: roundMoney(projectedValue),
      gapToday: roundMoney(targetCorpus - mappedCurrentValue),
      projectedGap: roundMoney(targetCorpus - projectedValue),
      fundedPercent: targetCorpus <= 0 ? 0 : roundPercent((mappedCurrentValue / targetCorpus) * 100),
      projectedFundedPercent: targetCorpus <= 0 ? 0 : roundPercent((projectedValue / targetCorpus) * 100),
      categoryValues: roundCategoryRecord(categoryValues),
      projectedCategoryValues: roundCategoryRecord(projectedCategoryValues),
      mappedHoldings: mappedHoldings.sort((a, b) => b.value - a.value)
    };
  });
}

export function createGoalMapping(goalId: string, manualBalanceId: string, percent: number, now = new Date().toISOString()): GoalMapping {
  return {
    id: "goalmap_" + goalId + "_" + manualBalanceId + "_" + Date.now().toString(36),
    goalId,
    manualBalanceId,
    percent: clampPercent(percent),
    createdAt: now,
    updatedAt: now
  };
}

export function mappingPercentForBalance(mappings: GoalMapping[], goalId: string, balance: ManualBalance): number {
  return clampPercent(mappings
    .filter((mapping) => mapping.goalId === goalId)
    .filter((mapping) => mapping.manualBalanceId === balance.id || (!mapping.manualBalanceId && mapping.accountId === balance.accountId && (!mapping.instrumentId || mapping.instrumentId === balance.instrumentId)))
    .reduce((sum, mapping) => sum + mapping.percent, 0));
}

export function yearsUntil(targetDate: string, now = new Date()): number {
  const target = new Date(targetDate + "T00:00:00.000Z");
  if (!Number.isFinite(target.getTime())) return 0;
  return Math.max(0, (target.getTime() - now.getTime()) / 31557600000);
}

function normalizeTargetYear(value: number): number {
  if (!Number.isFinite(value)) return new Date().getFullYear();
  return Math.min(2200, Math.max(1900, Math.round(value)));
}

function futureValue(value: number, annualRate: number, years: number): number {
  return Math.max(0, value) * Math.pow(1 + Math.max(0, annualRate) / 100, Math.max(0, years));
}

function returnRateForCategory(goal: Goal, category: AssetCategory): number {
  if (category === "Equity") return goal.equityReturn ?? goal.expectedReturn ?? 10;
  if (category === "Debt") return goal.debtReturn ?? 6;
  if (category === "Gold") return goal.goldReturn ?? 6;
  if (category === "Cash") return goal.cashReturn ?? 6;
  return goal.otherReturn ?? 6;
}

function emptyCategoryRecord(): Record<AssetCategory, number> {
  return { Equity: 0, Debt: 0, Gold: 0, Others: 0, Cash: 0 };
}

function roundCategoryRecord(record: Record<AssetCategory, number>): Record<AssetCategory, number> {
  return Object.fromEntries(categories.map((category) => [category, roundMoney(record[category])])) as Record<AssetCategory, number>;
}

function sumCategories(record: Record<AssetCategory, number>): number {
  return categories.reduce((sum, category) => sum + record[category], 0);
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundPercent(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
