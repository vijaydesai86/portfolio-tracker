import { calculateHoldingReturns } from "@/src/domain/holdingReturns";
import { signedPortfolioTransactionAmount, tryConvertToBase } from "@/src/domain/analytics";
import { calculateXirr } from "@/src/domain/xirr";
import { calculateTrackedLocalValue, hasAppliedTaper } from "@/src/domain/tapering";
import type { AssetCategory, Goal, GoalMapping, ManualBalance, PortfolioBackup, Transaction } from "@/src/schema/backup";

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
  drawdownSpendGrowth?: number;
  drawdownHorizonYears?: number;
  drawdownWithdrawalTiming?: Goal["drawdownWithdrawalTiming"];
};

export type GoalProgress = {
  goal: Goal;
  yearsToGoal: number;
  startingMonthlyExpense: number;
  firstYearExpense: number;
  targetCorpus: number;
  requiredCorpusToday: number;
  mappedCurrentValue: number;
  projectedValue: number;
  growthMultiplier: number;
  gapToday: number;
  corpusTodayGap: number;
  projectedGap: number;
  fundedPercent: number;
  corpusTodayFundedPercent: number;
  projectedFundedPercent: number;
  mappedInvested: number;
  mappedProfit: number;
  mappedReturnPercent?: number;
  xirrAvailable: number;
  xirrTotal: number;
  categoryValues: Record<AssetCategory, number>;
  projectedCategoryValues: Record<AssetCategory, number>;
  mappedHoldings: Array<{ balance: ManualBalance; mappedPercent: number; value: number; actualValue: number; trackedDiscount: number; projectedValue: number; invested?: number; profit?: number; xirr?: number | null; taperApplied: boolean }>;
};

export type GoalSummary = {
  goalCount: number;
  targetCorpus: number;
  requiredCorpusToday: number;
  mappedCurrentValue: number;
  projectedValue: number;
  corpusTodayGap: number;
  projectedGap: number;
  corpusTodayFundedPercent: number;
  projectedFundedPercent: number;
  mappedInvested: number;
  mappedProfit: number;
  mappedReturnPercent?: number;
  xirrAvailable: number;
  xirrTotal: number;
  categoryValues: Record<AssetCategory, number>;
  projectedCategoryValues: Record<AssetCategory, number>;
};

export type MappedGoalXirr = {
  xirr: number | null;
  cashFlowHoldings: number;
  mappedHoldings: number;
  missingFx: string[];
  basis: "portfolio" | "holdings";
};

const categories: AssetCategory[] = ["Equity", "Debt", "Gold", "Others", "Cash"];
const cashInTypes = new Set<Transaction["type"]>(["buy", "sip", "deposit", "contribution", "switch_in"]);
const cashOutTypes = new Set<Transaction["type"]>(["sell", "redemption", "dividend", "interest", "maturity", "withdrawal", "switch_out"]);
const feeTypes = new Set<Transaction["type"]>(["fee", "tax"]);

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
    drawdownSpendGrowth: input.drawdownSpendGrowth ?? 6,
    drawdownHorizonYears: input.drawdownHorizonYears ?? 45,
    drawdownWithdrawalTiming: input.drawdownWithdrawalTiming ?? "beginning",
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
    let mappedInvested = 0;
    let mappedProfit = 0;
    let xirrAvailable = 0;
    let xirrTotal = 0;

    for (const balance of backup.manualBalances) {
      const percent = mappingPercentForBalance(backup.goalMappings, recalculated.id, balance);
      if (percent <= 0) continue;
      const returns = holdingReturns.get(balance.id);
      const actualCurrent = returns?.currentValue ?? tryConvertToBase(balance.value, balance.currency, backup) ?? 0;
      const tracked = calculateTrackedLocalValue(balance);
      const trackedCurrent = tryConvertToBase(tracked.trackedLocalValue, balance.currency, backup) ?? actualCurrent;
      const current = tracked.applied ? trackedCurrent : actualCurrent;
      const mappedValue = current * (percent / 100);
      const mappedActualValue = actualCurrent * (percent / 100);
      const projectedValue = mappedValue * Math.pow(1 + returnRateForCategory(recalculated, balance.category) / 100, years);
      const invested = returns?.costBasisKnown ? returns.netInvested * (percent / 100) : undefined;
      const profit = invested === undefined ? undefined : mappedValue - invested;
      if (invested !== undefined) mappedInvested += invested;
      if (profit !== undefined) mappedProfit += profit;
      if (returns?.hasCashFlows) {
        xirrTotal += 1;
        if (typeof returns.xirr === "number") xirrAvailable += 1;
      }
      categoryValues[balance.category] += mappedValue;
      projectedCategoryValues[balance.category] += projectedValue;
      mappedHoldings.push({ balance, mappedPercent: percent, value: roundMoney(mappedValue), actualValue: roundMoney(mappedActualValue), trackedDiscount: roundMoney(mappedActualValue - mappedValue), projectedValue: roundMoney(projectedValue), invested: invested === undefined ? undefined : roundMoney(invested), profit: profit === undefined ? undefined : roundMoney(profit), xirr: returns?.xirr, taperApplied: tracked.applied });
    }

    const mappedCurrentValue = sumCategories(categoryValues);
    const projectedValue = sumCategories(projectedCategoryValues);
    const startingMonthlyExpense = futureValue(recalculated.currentMonthlyExpense ?? 0, recalculated.inflationRate, years);
    const firstYearExpense = startingMonthlyExpense * 12;
    const targetCorpus = recalculated.targetAmount;
    const growthMultiplier = mappedCurrentValue > 0 ? projectedValue / mappedCurrentValue : fallbackGrowthMultiplier(recalculated, years);
    const requiredCorpusToday = growthMultiplier > 0 ? targetCorpus / growthMultiplier : targetCorpus;
    return {
      goal: recalculated,
      yearsToGoal: years,
      startingMonthlyExpense: roundMoney(startingMonthlyExpense),
      firstYearExpense: roundMoney(firstYearExpense),
      targetCorpus: roundMoney(targetCorpus),
      requiredCorpusToday: roundMoney(requiredCorpusToday),
      mappedCurrentValue: roundMoney(mappedCurrentValue),
      projectedValue: roundMoney(projectedValue),
      growthMultiplier: roundPercent(growthMultiplier),
      gapToday: roundMoney(targetCorpus - mappedCurrentValue),
      corpusTodayGap: roundMoney(requiredCorpusToday - mappedCurrentValue),
      projectedGap: roundMoney(targetCorpus - projectedValue),
      fundedPercent: targetCorpus <= 0 ? 0 : roundPercent((mappedCurrentValue / targetCorpus) * 100),
      corpusTodayFundedPercent: requiredCorpusToday <= 0 ? 0 : roundPercent((mappedCurrentValue / requiredCorpusToday) * 100),
      projectedFundedPercent: targetCorpus <= 0 ? 0 : roundPercent((projectedValue / targetCorpus) * 100),
      mappedInvested: roundMoney(mappedInvested),
      mappedProfit: roundMoney(mappedProfit),
      mappedReturnPercent: mappedInvested <= 0 ? undefined : roundPercent((mappedProfit / mappedInvested) * 100),
      xirrAvailable,
      xirrTotal,
      categoryValues: roundCategoryRecord(categoryValues),
      projectedCategoryValues: roundCategoryRecord(projectedCategoryValues),
      mappedHoldings: mappedHoldings.sort((a, b) => b.value - a.value)
    };
  });
}

export function summarizeGoalProgress(goals: GoalProgress[]): GoalSummary {
  const categoryValues = emptyCategoryRecord();
  const projectedCategoryValues = emptyCategoryRecord();
  let targetCorpus = 0;
  let requiredCorpusToday = 0;
  let mappedCurrentValue = 0;
  let projectedValue = 0;
  let mappedInvested = 0;
  let mappedProfit = 0;
  let xirrAvailable = 0;
  let xirrTotal = 0;

  for (const goal of goals) {
    targetCorpus += goal.targetCorpus;
    requiredCorpusToday += goal.requiredCorpusToday;
    mappedCurrentValue += goal.mappedCurrentValue;
    projectedValue += goal.projectedValue;
    mappedInvested += goal.mappedInvested;
    mappedProfit += goal.mappedProfit;
    xirrAvailable += goal.xirrAvailable;
    xirrTotal += goal.xirrTotal;
    for (const category of categories) {
      categoryValues[category] += goal.categoryValues[category];
      projectedCategoryValues[category] += goal.projectedCategoryValues[category];
    }
  }

  return {
    goalCount: goals.length,
    targetCorpus: roundMoney(targetCorpus),
    requiredCorpusToday: roundMoney(requiredCorpusToday),
    mappedCurrentValue: roundMoney(mappedCurrentValue),
    projectedValue: roundMoney(projectedValue),
    corpusTodayGap: roundMoney(requiredCorpusToday - mappedCurrentValue),
    projectedGap: roundMoney(targetCorpus - projectedValue),
    corpusTodayFundedPercent: requiredCorpusToday <= 0 ? 0 : roundPercent((mappedCurrentValue / requiredCorpusToday) * 100),
    projectedFundedPercent: targetCorpus <= 0 ? 0 : roundPercent((projectedValue / targetCorpus) * 100),
    mappedInvested: roundMoney(mappedInvested),
    mappedProfit: roundMoney(mappedProfit),
    mappedReturnPercent: mappedInvested <= 0 ? undefined : roundPercent((mappedProfit / mappedInvested) * 100),
    xirrAvailable,
    xirrTotal,
    categoryValues: roundCategoryRecord(categoryValues),
    projectedCategoryValues: roundCategoryRecord(projectedCategoryValues)
  };
}

export function calculateMappedGoalXirr(backup: PortfolioBackup, goals: GoalProgress[]): MappedGoalXirr {
  const coverage = mappedCashFlowCoverage(backup, goals);
  if (isPortfolioEquivalentGoalScope(backup, goals)) {
    const portfolio = calculatePortfolioEquivalentXirr(backup);
    return { ...portfolio, ...coverage, basis: "portfolio" };
  }

  const holding = calculateMappedHoldingXirr(backup, goals);
  return { ...holding, ...coverage, basis: "holdings" };
}

function mappedCashFlowCoverage(backup: PortfolioBackup, goals: GoalProgress[]): { cashFlowHoldings: number; mappedHoldings: number } {
  let cashFlowHoldings = 0;
  let mappedHoldings = 0;
  for (const goal of goals) {
    for (const mapped of goal.mappedHoldings) {
      mappedHoldings += 1;
      if (transactionsForBalance(backup, mapped.balance).some((tx) => signedHoldingTransactionAmount(tx) !== 0)) cashFlowHoldings += 1;
    }
  }
  return { cashFlowHoldings, mappedHoldings };
}

function calculatePortfolioEquivalentXirr(backup: PortfolioBackup): Pick<MappedGoalXirr, "xirr" | "missingFx"> {
  const flows: Array<{ date: string; amount: number }> = [];
  const missingFx = new Set<string>();

  for (const tx of backup.transactions) {
    const signed = signedPortfolioTransactionAmount(tx, backup);
    if (signed === 0) continue;
    const converted = tryConvertToBase(signed, tx.currency, backup, tx.date);
    if (converted === undefined) {
      if (tx.currency !== backup.baseCurrency) missingFx.add(tx.currency + "/" + backup.baseCurrency + " on/after " + tx.date);
      continue;
    }
    flows.push({ date: tx.date, amount: converted });
  }

  for (const balance of backup.manualBalances) {
    if (balance.value === 0) continue;
    const converted = tryConvertToBase(balance.value, balance.currency, backup);
    if (converted === undefined) {
      if (balance.currency !== backup.baseCurrency) missingFx.add(balance.currency + "/" + backup.baseCurrency);
      continue;
    }
    flows.push({ date: balance.asOfDate, amount: converted });
  }

  return { xirr: missingFx.size > 0 ? null : calculateXirr(flows), missingFx: [...missingFx].sort() };
}

function calculateMappedHoldingXirr(backup: PortfolioBackup, goals: GoalProgress[]): Pick<MappedGoalXirr, "xirr" | "missingFx"> {
  const flows: Array<{ date: string; amount: number }> = [];
  const missingFx = new Set<string>();

  for (const goal of goals) {
    for (const mapped of goal.mappedHoldings) {
      const percent = mapped.mappedPercent / 100;
      let hasFlow = false;
      for (const tx of transactionsForBalance(backup, mapped.balance)) {
        const signed = signedHoldingTransactionAmount(tx);
        if (signed === 0) continue;
        const converted = tryConvertToBase(signed, tx.currency, backup, tx.date);
        if (converted === undefined) {
          if (tx.currency !== backup.baseCurrency) missingFx.add(tx.currency + "/" + backup.baseCurrency + " on/after " + tx.date);
          continue;
        }
        const amount = roundMoney(converted * percent);
        if (amount === 0) continue;
        flows.push({ date: tx.date, amount });
        hasFlow = true;
      }
      if (hasFlow) flows.push({ date: mapped.balance.asOfDate, amount: mapped.value });
    }
  }

  return { xirr: missingFx.size > 0 ? null : calculateXirr(flows), missingFx: [...missingFx].sort() };
}

function isPortfolioEquivalentGoalScope(backup: PortfolioBackup, goals: GoalProgress[]): boolean {
  if (goals.length === 0) return false;
  const mappedPercentByBalance = new Map<string, number>();
  for (const goal of goals) {
    for (const mapped of goal.mappedHoldings) {
      mappedPercentByBalance.set(mapped.balance.id, (mappedPercentByBalance.get(mapped.balance.id) ?? 0) + mapped.mappedPercent);
    }
  }

  let portfolioCurrent = 0;
  let mappedCurrent = 0;
  for (const balance of backup.manualBalances) {
    if (hasAppliedTaper(balance)) return false;
    const current = tryConvertToBase(balance.value, balance.currency, backup) ?? 0;
    if (current === 0) continue;
    portfolioCurrent += current;
    const mappedPercent = mappedPercentByBalance.get(balance.id) ?? 0;
    if (Math.abs(mappedPercent - 100) > 0.01) return false;
    mappedCurrent += current * (mappedPercent / 100);
  }

  const tolerance = Math.max(1, Math.abs(portfolioCurrent) * 0.000001);
  return portfolioCurrent > 0 && Math.abs(portfolioCurrent - mappedCurrent) <= tolerance;
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

function fallbackGrowthMultiplier(goal: Goal, years: number): number {
  return Math.pow(1 + returnRateForCategory(goal, "Equity") / 100, Math.max(0, years));
}

function returnRateForCategory(goal: Goal, category: AssetCategory): number {
  if (category === "Equity") return goal.equityReturn ?? goal.expectedReturn ?? 10;
  if (category === "Debt") return goal.debtReturn ?? 6;
  if (category === "Gold") return goal.goldReturn ?? 6;
  if (category === "Cash") return goal.cashReturn ?? 6;
  return goal.otherReturn ?? 6;
}

function transactionsForBalance(backup: PortfolioBackup, balance: ManualBalance): Transaction[] {
  return backup.transactions
    .filter((tx) => tx.accountId === balance.accountId && (balance.instrumentId ? tx.instrumentId === balance.instrumentId : !tx.instrumentId))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

function signedHoldingTransactionAmount(tx: Transaction): number {
  const amount = Math.abs(tx.amount);
  const charges = Math.abs(tx.fees ?? 0) + Math.abs(tx.taxes ?? 0);
  if (cashInTypes.has(tx.type)) return -(amount + charges);
  if (cashOutTypes.has(tx.type)) return amount - charges;
  if (feeTypes.has(tx.type)) return -amount;
  return 0;
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
