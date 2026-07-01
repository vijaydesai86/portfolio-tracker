import { calculatePortfolioInsights, calculatePortfolioSummary, tryConvertToBase } from "@/src/domain/analytics";
import { calculateDashboardPerformance } from "@/src/domain/dashboardPerformance";
import type { GoalProgress } from "@/src/domain/goalAnalytics";
import { calculateHoldingReturns } from "@/src/domain/holdingReturns";
import { snapshotAnalytics } from "@/src/domain/snapshots";
import type { AssetCategory, Goal, PortfolioBackup } from "@/src/schema/backup";

const categories: AssetCategory[] = ["Equity", "Debt", "Gold", "Others", "Cash"];

export type ScenarioSettings = {
  equityReturn: number;
  debtReturn: number;
  goldReturn: number;
  cashReturn: number;
  otherReturn: number;
  inflationRate: number;
  marketCorrectionPercent: number;
  usdInrShockPercent: number;
};

export type TargetAllocationSettings = Record<AssetCategory, number>;

export type DrawdownSettings = {
  annualSpendGrowth: number;
  horizonYears: number;
  withdrawalTiming: "beginning" | "end";
};

export type CashFlowSettings = {
  monthlySurplus: number;
  annualStepUpPercent: number;
  contributionYears: number;
  currentMonthInvestedDone: boolean;
  startDate: string;
  deploymentAllocation: TargetAllocationSettings;
  goalAllocations: Record<string, number>;
};

export type PlanningSettings = {
  scenario: ScenarioSettings;
  targetAllocation: TargetAllocationSettings;
  drawdown: DrawdownSettings;
  cashFlow: CashFlowSettings;
};

export type PlanningSettingsPatch = {
  scenario?: Partial<ScenarioSettings>;
  targetAllocation?: Partial<TargetAllocationSettings>;
  drawdown?: Partial<DrawdownSettings>;
  cashFlow?: Partial<CashFlowSettings>;
};

export type CashFlowGoalProjection = {
  goalId: string;
  goalName: string;
  targetCorpus: number;
  projectedWithoutContributions: number;
  allocatedMonthly: number;
  contributionFutureValue: number;
  projectedWithContributions: number;
  gapWithoutContributions: number;
  gapWithContributions: number;
  neededMonthly: number;
  fundedPercentWithoutContributions: number;
  fundedPercentWithContributions: number;
  monthsToGoal: number;
};

export type CashFlowPlan = {
  monthlySurplus: number;
  allocatedMonthlyTotal: number;
  unallocatedMonthly: number;
  annualStepUpPercent: number;
  contributionYears: number;
  currentMonthInvestedDone: boolean;
  deploymentReturn: number;
  startDate: string;
  rows: CashFlowGoalProjection[];
};

export type ScenarioCategoryRow = {
  category: AssetCategory;
  currentValue: number;
  stressedValue: number;
  oneYearProjectedValue: number;
  returnRate: number;
};

export type ScenarioPlan = {
  currentValue: number;
  stressedValue: number;
  oneYearProjectedValue: number;
  inflationAdjustedOneYearValue: number;
  stressDelta: number;
  categoryRows: ScenarioCategoryRow[];
};

export type RebalanceRow = {
  category: AssetCategory;
  currentValue: number;
  currentPercent: number;
  targetPercent: number;
  targetValue: number;
  driftValue: number;
  driftPercent: number;
  actionAmount: number;
  action: "add" | "reduce" | "hold";
};

export type GoalRebalancePlan = {
  goalId: string;
  goalName: string;
  currentValue: number;
  rows: RebalanceRow[];
};

export type IncomeProjectionRow = {
  key: "indian_dividend" | "foreign_dividend" | "taxable_interest" | "exempt_interest" | "maturity";
  label: string;
  captured: number;
  projectedAnnual: number;
  detail: string;
};

export type IncomeProjection = {
  observationStart: string | null;
  observationEnd: string | null;
  observationDays: number;
  capturedTotal: number;
  projectedAnnual: number;
  rows: IncomeProjectionRow[];
};

export type GoalDrawdownPoint = {
  year: number;
  calendarYear: number;
  startingCorpus: number;
  withdrawal: number;
  drawdownPercent: number;
  allocation: TargetAllocationSettings;
  weightedReturn: number;
  growth: number;
  endingCorpus: number;
};

export type GoalDrawdownReport = {
  goalId: string;
  goalName: string;
  targetYear: number;
  startingCorpus: number;
  firstYearWithdrawal: number;
  weightedReturn: number;
  averageWeightedReturn: number;
  annualSpendGrowth: number;
  horizonYears: number;
  withdrawalTiming: DrawdownSettings["withdrawalTiming"];
  depletionYear: number | null;
  lastsYears: number;
  surplusAtHorizon: number;
  initialAllocation: TargetAllocationSettings;
  finalAllocation: TargetAllocationSettings;
  glideRule: {
    intervalYears: number;
    shiftPercent: number;
    from: AssetCategory;
    to: AssetCategory;
    floorPercent: number;
  };
  points: GoalDrawdownPoint[];
};

export type SnapshotComparison = {
  fromName: string;
  toName: string;
  fromDate: string;
  toDate: string;
  netWorthDelta: number;
  investedDelta: number;
  profitDelta: number;
  goalRequiredTodayDelta: number;
  goalMappedDelta: number;
  goalProjectedDelta: number;
  categoryDeltas: Record<AssetCategory, number>;
  regionDeltas: Record<string, number>;
  assetKindDeltas: Record<string, number>;
};

export type AttributionRow = {
  key: "net_cost_basis" | "cash_out" | "income" | "fees_tax" | "market_gain";
  label: string;
  value: number;
  description: string;
};

export type PerformanceAttribution = {
  currentValue: number;
  netCostBasis: number;
  externalCashIn: number;
  externalCashOut: number;
  income: number;
  feesAndTax: number;
  marketGain: number;
  rows: AttributionRow[];
};

const defaultPlanningSettings: PlanningSettings = {
  scenario: {
    equityReturn: 10,
    debtReturn: 6,
    goldReturn: 6,
    cashReturn: 4,
    otherReturn: 6,
    inflationRate: 6,
    marketCorrectionPercent: 0,
    usdInrShockPercent: 0
  },
  targetAllocation: {
    Equity: 65,
    Debt: 30,
    Gold: 0,
    Others: 0,
    Cash: 5
  },
  drawdown: {
    annualSpendGrowth: 6,
    horizonYears: 45,
    withdrawalTiming: "beginning"
  },
  cashFlow: {
    monthlySurplus: 0,
    annualStepUpPercent: 0,
    contributionYears: 0,
    currentMonthInvestedDone: false,
    startDate: "",
    deploymentAllocation: {
      Equity: 65,
      Debt: 30,
      Gold: 0,
      Others: 0,
      Cash: 5
    },
    goalAllocations: {}
  }
};

export function getPlanningSettings(backup: PortfolioBackup): PlanningSettings {
  const raw = isRecord(backup.settings?.planning) ? backup.settings.planning : {};
  const scenario = isRecord(raw.scenario) ? raw.scenario : {};
  const targetAllocation = isRecord(raw.targetAllocation) ? raw.targetAllocation : {};
  const drawdown = isRecord(raw.drawdown) ? raw.drawdown : {};
  const cashFlow = isRecord(raw.cashFlow) ? raw.cashFlow : {};
  const cashFlowDeployment = isRecord(cashFlow.deploymentAllocation) ? cashFlow.deploymentAllocation : {};
  const goalAllocations = isRecord(cashFlow.goalAllocations) ? Object.fromEntries(Object.entries(cashFlow.goalAllocations).map(([key, value]) => [key, Math.max(0, numberSetting(value, 0))])) : {};
  return {
    scenario: {
      equityReturn: numberSetting(scenario.equityReturn, defaultPlanningSettings.scenario.equityReturn),
      debtReturn: numberSetting(scenario.debtReturn, defaultPlanningSettings.scenario.debtReturn),
      goldReturn: numberSetting(scenario.goldReturn, defaultPlanningSettings.scenario.goldReturn),
      cashReturn: numberSetting(scenario.cashReturn, defaultPlanningSettings.scenario.cashReturn),
      otherReturn: numberSetting(scenario.otherReturn, defaultPlanningSettings.scenario.otherReturn),
      inflationRate: numberSetting(scenario.inflationRate, defaultPlanningSettings.scenario.inflationRate),
      marketCorrectionPercent: numberSetting(scenario.marketCorrectionPercent, defaultPlanningSettings.scenario.marketCorrectionPercent),
      usdInrShockPercent: numberSetting(scenario.usdInrShockPercent, defaultPlanningSettings.scenario.usdInrShockPercent)
    },
    targetAllocation: normalizeTargetAllocation({
      Equity: numberSetting(targetAllocation.Equity, defaultPlanningSettings.targetAllocation.Equity),
      Debt: numberSetting(targetAllocation.Debt, defaultPlanningSettings.targetAllocation.Debt),
      Gold: numberSetting(targetAllocation.Gold, defaultPlanningSettings.targetAllocation.Gold),
      Others: numberSetting(targetAllocation.Others, defaultPlanningSettings.targetAllocation.Others),
      Cash: numberSetting(targetAllocation.Cash, defaultPlanningSettings.targetAllocation.Cash)
    }),
    drawdown: {
      annualSpendGrowth: numberSetting(drawdown.annualSpendGrowth, defaultPlanningSettings.drawdown.annualSpendGrowth),
      horizonYears: Math.max(1, Math.min(100, Math.round(numberSetting(drawdown.horizonYears, defaultPlanningSettings.drawdown.horizonYears)))),
      withdrawalTiming: drawdown.withdrawalTiming === "end" ? "end" : "beginning"
    },
    cashFlow: {
      monthlySurplus: Math.max(0, numberSetting(cashFlow.monthlySurplus, defaultPlanningSettings.cashFlow.monthlySurplus)),
      annualStepUpPercent: Math.max(0, Math.min(100, numberSetting(cashFlow.annualStepUpPercent, defaultPlanningSettings.cashFlow.annualStepUpPercent))),
      contributionYears: Math.max(0, Math.min(100, numberSetting(cashFlow.contributionYears, defaultPlanningSettings.cashFlow.contributionYears))),
      currentMonthInvestedDone: cashFlow.currentMonthInvestedDone === true,
      startDate: typeof cashFlow.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cashFlow.startDate) ? cashFlow.startDate : defaultPlanningSettings.cashFlow.startDate,
      deploymentAllocation: normalizeTargetAllocation({
        Equity: numberSetting(cashFlowDeployment.Equity, defaultPlanningSettings.cashFlow.deploymentAllocation.Equity),
        Debt: numberSetting(cashFlowDeployment.Debt, defaultPlanningSettings.cashFlow.deploymentAllocation.Debt),
        Gold: numberSetting(cashFlowDeployment.Gold, defaultPlanningSettings.cashFlow.deploymentAllocation.Gold),
        Others: numberSetting(cashFlowDeployment.Others, defaultPlanningSettings.cashFlow.deploymentAllocation.Others),
        Cash: numberSetting(cashFlowDeployment.Cash, defaultPlanningSettings.cashFlow.deploymentAllocation.Cash)
      }),
      goalAllocations: normalizeGoalAllocations(goalAllocations)
    }
  };
}

export function updatePlanningSettings(backup: PortfolioBackup, patch: PlanningSettingsPatch): PortfolioBackup {
  const current = getPlanningSettings(backup);
  const next: PlanningSettings = {
    scenario: { ...current.scenario, ...(patch.scenario ?? {}) },
    targetAllocation: normalizeTargetAllocation({ ...current.targetAllocation, ...(patch.targetAllocation ?? {}) }),
    drawdown: { ...current.drawdown, ...(patch.drawdown ?? {}) },
    cashFlow: {
      ...current.cashFlow,
      ...(patch.cashFlow ?? {}),
      deploymentAllocation: patch.cashFlow?.deploymentAllocation ? normalizeTargetAllocation({ ...current.cashFlow.deploymentAllocation, ...patch.cashFlow.deploymentAllocation }) : current.cashFlow.deploymentAllocation,
      goalAllocations: patch.cashFlow?.goalAllocations ? normalizeGoalAllocations({ ...patch.cashFlow.goalAllocations }) : current.cashFlow.goalAllocations
    }
  };
  return {
    ...backup,
    exportedAt: new Date().toISOString(),
    settings: {
      ...backup.settings,
      planning: next
    }
  };
}

export function calculateScenarioPlan(backup: PortfolioBackup, settings = getPlanningSettings(backup)): ScenarioPlan {
  const summary = calculatePortfolioSummary(backup);
  const rows = categories.map((category) => {
    const currentValue = summary.allocation[category].value;
    const returnRate = returnRateForCategory(settings.scenario, category);
    const equityStress = category === "Equity" ? Math.max(0, 1 - settings.scenario.marketCorrectionPercent / 100) : 1;
    const usdRatio = usdExposureRatio(backup, category);
    const inrPart = currentValue * (1 - usdRatio);
    const usdPart = currentValue * usdRatio * (1 + settings.scenario.usdInrShockPercent / 100);
    const stressedValue = (inrPart + usdPart) * equityStress;
    const oneYearProjectedValue = currentValue * (1 + returnRate / 100);
    return {
      category,
      currentValue: roundMoney(currentValue),
      stressedValue: roundMoney(stressedValue),
      oneYearProjectedValue: roundMoney(oneYearProjectedValue),
      returnRate
    };
  });
  const currentValue = roundMoney(rows.reduce((sum, row) => sum + row.currentValue, 0));
  const stressedValue = roundMoney(rows.reduce((sum, row) => sum + row.stressedValue, 0));
  const oneYearProjectedValue = roundMoney(rows.reduce((sum, row) => sum + row.oneYearProjectedValue, 0));
  return {
    currentValue,
    stressedValue,
    oneYearProjectedValue,
    inflationAdjustedOneYearValue: roundMoney(oneYearProjectedValue / (1 + settings.scenario.inflationRate / 100)),
    stressDelta: roundMoney(stressedValue - currentValue),
    categoryRows: rows
  };
}

export function calculateRebalancingPlan(backup: PortfolioBackup, settings = getPlanningSettings(backup)): RebalanceRow[] {
  const summary = calculatePortfolioSummary(backup);
  const targets = normalizeTargetAllocation(settings.targetAllocation);
  return categories.map((category) => {
    const currentValue = summary.allocation[category].value;
    const currentPercent = summary.allocation[category].percent;
    const targetPercent = targets[category];
    const targetValue = summary.netWorth * (targetPercent / 100);
    const driftValue = currentValue - targetValue;
    const driftPercent = currentPercent - targetPercent;
    return {
      category,
      currentValue,
      currentPercent,
      targetPercent,
      targetValue: roundMoney(targetValue),
      driftValue: roundMoney(driftValue),
      driftPercent: roundPercent(driftPercent),
      actionAmount: roundMoney(Math.abs(driftValue)),
      action: Math.abs(driftValue) < Math.max(100, summary.netWorth * 0.0025) ? "hold" : driftValue > 0 ? "reduce" : "add"
    };
  });
}

export function calculateGoalRebalancingPlans(goals: GoalProgress[], settings: PlanningSettings): GoalRebalancePlan[] {
  return goals.map((goal) => {
    const targets = targetAllocationForGoal(goal.goal, settings.targetAllocation, "accumulation") ?? normalizeTargetAllocation(settings.targetAllocation);
    const total = goal.mappedCurrentValue;
    const rows = categories.map((category) => {
      const currentValue = goal.categoryValues[category] ?? 0;
      const currentPercent = total <= 0 ? 0 : roundPercent((currentValue / total) * 100);
      const targetPercent = targets[category];
      const targetValue = total * (targetPercent / 100);
      const driftValue = currentValue - targetValue;
      const driftPercent = currentPercent - targetPercent;
      return { category, currentValue: roundMoney(currentValue), currentPercent, targetPercent, targetValue: roundMoney(targetValue), driftValue: roundMoney(driftValue), driftPercent: roundPercent(driftPercent), actionAmount: roundMoney(Math.abs(driftValue)), action: Math.abs(driftValue) < Math.max(100, total * 0.0025) ? "hold" as const : driftValue > 0 ? "reduce" as const : "add" as const };
    });
    return { goalId: goal.goal.id, goalName: goal.goal.name, currentValue: roundMoney(total), rows };
  });
}

export function calculateCashFlowPlan(goals: GoalProgress[], settings: PlanningSettings, today = new Date()): CashFlowPlan {
  const cashFlow = settings.cashFlow;
  const todayDate = today.toISOString().slice(0, 10);
  const monthAwareStartDate = cashFlow.currentMonthInvestedDone ? firstDayOfNextMonth(todayDate) : todayDate;
  const startDate = cashFlow.startDate && cashFlow.startDate > monthAwareStartDate ? cashFlow.startDate : monthAwareStartDate;
  const deploymentReturn = weightedReturnForSettingsAllocation(settings.scenario, cashFlow.deploymentAllocation);
  const monthlySurplus = Math.max(0, cashFlow.monthlySurplus);
  const rows = goals.map((goal) => {
    const allocationPercent = Math.max(0, Number(cashFlow.goalAllocations[goal.goal.id]) || 0);
    const allocatedMonthly = roundMoney(monthlySurplus * allocationPercent / 100);
    const monthsToGoal = Math.max(0, Math.ceil(monthsBetween(startDate, goal.goal.targetDate)));
    const contributionMonths = cashFlow.contributionYears > 0 ? Math.min(monthsToGoal, Math.round(cashFlow.contributionYears * 12)) : monthsToGoal;
    const contributionFutureValue = monthlyContributionFutureValue(allocatedMonthly, contributionMonths, monthsToGoal, deploymentReturn, cashFlow.annualStepUpPercent);
    const projectedWithContributions = roundMoney(goal.projectedValue + contributionFutureValue);
    const gapWithoutContributions = roundMoney(goal.targetCorpus - goal.projectedValue);
    const gapWithContributions = roundMoney(goal.targetCorpus - projectedWithContributions);
    const neededMonthly = gapWithoutContributions <= 0 ? 0 : solveNeededMonthly(gapWithoutContributions, contributionMonths, monthsToGoal, deploymentReturn, cashFlow.annualStepUpPercent);
    return {
      goalId: goal.goal.id,
      goalName: goal.goal.name,
      targetCorpus: goal.targetCorpus,
      projectedWithoutContributions: goal.projectedValue,
      allocatedMonthly,
      contributionFutureValue: roundMoney(contributionFutureValue),
      projectedWithContributions,
      gapWithoutContributions,
      gapWithContributions,
      neededMonthly,
      fundedPercentWithoutContributions: goal.targetCorpus <= 0 ? 0 : roundPercent((goal.projectedValue / goal.targetCorpus) * 100),
      fundedPercentWithContributions: goal.targetCorpus <= 0 ? 0 : roundPercent((projectedWithContributions / goal.targetCorpus) * 100),
      monthsToGoal
    };
  });
  const allocatedMonthlyTotal = roundMoney(rows.reduce((sum, row) => sum + row.allocatedMonthly, 0));
  return {
    monthlySurplus,
    allocatedMonthlyTotal,
    unallocatedMonthly: roundMoney(Math.max(0, monthlySurplus - allocatedMonthlyTotal)),
    annualStepUpPercent: cashFlow.annualStepUpPercent,
    contributionYears: cashFlow.contributionYears,
    currentMonthInvestedDone: cashFlow.currentMonthInvestedDone,
    deploymentReturn: roundPercent(deploymentReturn),
    startDate,
    rows
  };
}

export function calculateIncomeProjection(backup: PortfolioBackup): IncomeProjection {
  const dated = backup.transactions.map((tx) => tx.date).filter(Boolean).sort();
  const observationEnd = dated.at(-1) ?? null;
  const observationStart = observationEnd ? dateMonthsBefore(observationEnd, 12) : null;
  const rows: IncomeProjectionRow[] = [
    { key: "indian_dividend", label: "Indian dividends", captured: 0, projectedAnnual: 0, detail: "taxable dividend rows from Indian holdings" },
    { key: "foreign_dividend", label: "Foreign dividends", captured: 0, projectedAnnual: 0, detail: "foreign dividend rows converted using transaction-date FX" },
    { key: "taxable_interest", label: "Taxable interest", captured: 0, projectedAnnual: 0, detail: "interest rows outside exempt PPF and SSY accounts" },
    { key: "exempt_interest", label: "Exempt interest", captured: 0, projectedAnnual: 0, detail: "PPF and SSY interest rows shown separately" },
    { key: "maturity", label: "Maturity cash", captured: 0, projectedAnnual: 0, detail: "maturity rows are shown as known cash events, not recurring yield" }
  ];
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const accounts = new Map(backup.accounts.map((account) => [account.id, account]));
  for (const tx of backup.transactions) {
    if (observationStart && tx.date < observationStart) continue;
    if (observationEnd && tx.date > observationEnd) continue;
    const converted = tryConvertToBase(Math.abs(tx.amount), tx.currency, backup, tx.date);
    const value = converted ?? (tx.currency === backup.baseCurrency ? Math.abs(tx.amount) : 0);
    if (value <= 0) continue;
    const account = accounts.get(tx.accountId);
    const key = tx.type === "dividend"
      ? tx.currency !== backup.baseCurrency || account?.type === "us_stock" ? "foreign_dividend" : "indian_dividend"
      : tx.type === "interest" || tx.type === "interest_accrual"
        ? account?.type === "ppf" || account?.type === "ssy" ? "exempt_interest" : "taxable_interest"
        : tx.type === "maturity" ? "maturity" : undefined;
    if (!key) continue;
    byKey.get(key)!.captured += value;
  }
  const observationDays = observationStart && observationEnd ? Math.max(1, Math.round((Date.parse(observationEnd + "T00:00:00.000Z") - Date.parse(observationStart + "T00:00:00.000Z")) / 86400000)) : 0;
  const normalizedRows = rows.map((row) => ({ ...row, captured: roundMoney(row.captured), projectedAnnual: row.key === "maturity" ? 0 : roundMoney(observationDays > 0 ? row.captured * (365 / observationDays) : 0) }));
  return { observationStart, observationEnd, observationDays, capturedTotal: roundMoney(normalizedRows.reduce((sum, row) => sum + row.captured, 0)), projectedAnnual: roundMoney(normalizedRows.reduce((sum, row) => sum + row.projectedAnnual, 0)), rows: normalizedRows };
}

export function calculateGoalDrawdowns(goals: GoalProgress[], settings: PlanningSettings): GoalDrawdownReport[] {
  return goals.map((goal) => {
    const targetYear = Number.parseInt(goal.goal.targetDate.slice(0, 4), 10);
    const drawdown = drawdownSettingsForGoal(goal, settings);
    const horizonYears = drawdown.horizonYears;
    const baseAllocation = baseConsumptionAllocation(goal);
    const points: GoalDrawdownPoint[] = [];
    let corpus = goal.projectedValue;
    let withdrawal = goal.firstYearExpense;
    let depletionYear: number | null = null;

    for (let year = 1; year <= horizonYears; year += 1) {
      const allocation = allocationForDrawdownYear(goal.goal, baseAllocation, year);
      const weightedReturn = weightedReturnForAllocation(goal, allocation);
      const startingCorpus = corpus;
      let growth = 0;
      if (drawdown.withdrawalTiming === "beginning") {
        corpus = Math.max(0, corpus - withdrawal);
        growth = corpus * (weightedReturn / 100);
        corpus += growth;
      } else {
        growth = corpus * (weightedReturn / 100);
        corpus += growth;
        corpus = Math.max(0, corpus - withdrawal);
      }
      points.push({
        year,
        calendarYear: targetYear + year - 1,
        startingCorpus: roundMoney(startingCorpus),
        withdrawal: roundMoney(withdrawal),
        drawdownPercent: startingCorpus <= 0 ? 0 : roundPercent((withdrawal / startingCorpus) * 100),
        allocation,
        weightedReturn: roundPercent(weightedReturn),
        growth: roundMoney(growth),
        endingCorpus: roundMoney(corpus)
      });
      if (depletionYear === null && corpus <= 0) depletionYear = targetYear + year - 1;
      withdrawal *= 1 + drawdown.annualSpendGrowth / 100;
    }

    const firstAllocation = points[0]?.allocation ?? baseAllocation;
    const finalAllocation = points.at(-1)?.allocation ?? baseAllocation;
    const averageWeightedReturn = points.length > 0 ? points.reduce((sum, point) => sum + point.weightedReturn, 0) / points.length : weightedReturnForAllocation(goal, baseAllocation);
    return {
      goalId: goal.goal.id,
      goalName: goal.goal.name,
      targetYear,
      startingCorpus: roundMoney(goal.projectedValue),
      firstYearWithdrawal: roundMoney(goal.firstYearExpense),
      weightedReturn: roundPercent(points[0]?.weightedReturn ?? weightedReturnForAllocation(goal, baseAllocation)),
      averageWeightedReturn: roundPercent(averageWeightedReturn),
      annualSpendGrowth: drawdown.annualSpendGrowth,
      horizonYears,
      withdrawalTiming: drawdown.withdrawalTiming,
      depletionYear,
      lastsYears: depletionYear === null ? horizonYears : Math.max(0, depletionYear - targetYear + 1),
      surplusAtHorizon: roundMoney(points.at(-1)?.endingCorpus ?? 0),
      initialAllocation: firstAllocation,
      finalAllocation,
      glideRule: drawdownGlideRule(goal.goal),
      points
    };
  });
}

export function compareSnapshots(from: PortfolioBackup["snapshots"][number], to: PortfolioBackup["snapshots"][number]): SnapshotComparison {
  const fromAnalytics = snapshotAnalytics(from);
  const toAnalytics = snapshotAnalytics(to);
  if (!fromAnalytics || !toAnalytics) {
    throw new Error("Both snapshots need embedded analytics for comparison.");
  }
  return {
    fromName: from.name,
    toName: to.name,
    fromDate: from.asOfDate,
    toDate: to.asOfDate,
    netWorthDelta: roundMoney(toAnalytics.summary.netWorth - fromAnalytics.summary.netWorth),
    investedDelta: roundMoney(toAnalytics.performance.netInvested - fromAnalytics.performance.netInvested),
    profitDelta: roundMoney(toAnalytics.performance.totalProfit - fromAnalytics.performance.totalProfit),
    goalRequiredTodayDelta: roundMoney(toAnalytics.goalSummary.requiredCorpusToday - fromAnalytics.goalSummary.requiredCorpusToday),
    goalMappedDelta: roundMoney(toAnalytics.goalSummary.mappedCurrentValue - fromAnalytics.goalSummary.mappedCurrentValue),
    goalProjectedDelta: roundMoney(toAnalytics.goalSummary.projectedValue - fromAnalytics.goalSummary.projectedValue),
    categoryDeltas: diffCategoryRecords(fromAnalytics.summary.allocation, toAnalytics.summary.allocation),
    regionDeltas: diffNamedRows(fromAnalytics.insights.totalsByRegion, toAnalytics.insights.totalsByRegion),
    assetKindDeltas: diffNamedRows(fromAnalytics.insights.totalsByAssetKind, toAnalytics.insights.totalsByAssetKind)
  };
}

export function calculatePerformanceAttribution(backup: PortfolioBackup): PerformanceAttribution {
  const summary = calculatePortfolioSummary(backup);
  const insights = calculatePortfolioInsights(backup);
  const returns = calculateHoldingReturns(backup);
  const performance = calculateDashboardPerformance(summary, insights.transactionStats, returns.values());
  const income = insights.transactionStats.incomeBase;
  const feesAndTax = performance.feesAndTax;
  const marketGain = performance.totalProfit;
  const rows: AttributionRow[] = [
    { key: "net_cost_basis", label: "Remaining cost basis", value: performance.netInvested, description: "Capital still represented by open holdings." },
    { key: "cash_out", label: "External cash out", value: performance.cashOut, description: "Withdrawals, redemptions, dividends, and maturity cash that left the portfolio scope." },
    { key: "income", label: "Portfolio income", value: income, description: "Dividend and interest rows captured in the transaction ledger." },
    { key: "fees_tax", label: "Fees and taxes", value: -feesAndTax, description: "Recorded charges and tax rows reduce realized economics." },
    { key: "market_gain", label: "Market, FX, and price gain", value: marketGain, description: "Residual gain from current value minus remaining cost basis." }
  ].filter((row) => row.value !== 0) as AttributionRow[];
  return {
    currentValue: performance.current,
    netCostBasis: performance.netInvested,
    externalCashIn: performance.grossCashIn,
    externalCashOut: performance.cashOut,
    income,
    feesAndTax,
    marketGain,
    rows
  };
}

function normalizeGoalAllocations(input: Record<string, number>): Record<string, number> {
  const cleaned = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, Math.max(0, Number(value) || 0)]));
  const total = Object.values(cleaned).reduce((sum, value) => sum + value, 0);
  if (total <= 100) return cleaned;
  return Object.fromEntries(Object.entries(cleaned).map(([key, value]) => [key, roundPercent((value / total) * 100)]));
}

function normalizeTargetAllocation(input: TargetAllocationSettings): TargetAllocationSettings {
  const cleaned = Object.fromEntries(categories.map((category) => [category, Math.max(0, Number(input[category]) || 0)])) as TargetAllocationSettings;
  const total = categories.reduce((sum, category) => sum + cleaned[category], 0);
  if (total <= 0) return defaultPlanningSettings.targetAllocation;
  return Object.fromEntries(categories.map((category) => [category, roundPercent((cleaned[category] / total) * 100)])) as TargetAllocationSettings;
}

function drawdownSettingsForGoal(goal: GoalProgress, settings: PlanningSettings): DrawdownSettings {
  return {
    annualSpendGrowth: numberSetting(goal.goal.drawdownSpendGrowth, settings.drawdown.annualSpendGrowth),
    horizonYears: Math.max(1, Math.min(100, Math.round(numberSetting(goal.goal.drawdownHorizonYears, settings.drawdown.horizonYears)))),
    withdrawalTiming: goal.goal.drawdownWithdrawalTiming === "end" ? "end" : goal.goal.drawdownWithdrawalTiming === "beginning" ? "beginning" : settings.drawdown.withdrawalTiming
  };
}

function baseConsumptionAllocation(goal: GoalProgress): TargetAllocationSettings {
  const consumptionTarget = targetAllocationForGoal(goal.goal, undefined, "consumption");
  if (consumptionTarget) return consumptionTarget;
  if (goal.projectedValue > 0) return allocationFromValues(goal.projectedCategoryValues, goal.projectedValue);
  if (goal.mappedCurrentValue > 0) return allocationFromValues(goal.categoryValues, goal.mappedCurrentValue);
  return normalizeTargetAllocation({ Equity: 65, Debt: 30, Gold: 0, Others: 0, Cash: 5 });
}

function allocationForDrawdownYear(goal: Goal, baseAllocation: TargetAllocationSettings, year: number): TargetAllocationSettings {
  const rule = drawdownGlideRule(goal);
  if (rule.shiftPercent <= 0 || rule.from === rule.to) return normalizeTargetAllocation(baseAllocation);
  const steps = Math.floor((Math.max(1, year) - 1) / rule.intervalYears);
  const requestedShift = steps * rule.shiftPercent;
  if (requestedShift <= 0) return normalizeTargetAllocation(baseAllocation);
  const fromStart = baseAllocation[rule.from] ?? 0;
  const fromFloor = Math.min(rule.floorPercent, fromStart);
  const shifted = Math.min(requestedShift, Math.max(0, fromStart - fromFloor));
  const next = { ...baseAllocation };
  next[rule.from] = fromStart - shifted;
  next[rule.to] = (next[rule.to] ?? 0) + shifted;
  return normalizeTargetAllocation(next);
}

function drawdownGlideRule(goal: Goal): GoalDrawdownReport["glideRule"] {
  const rawFrom = goal.consumptionGlideFrom;
  const rawTo = goal.consumptionGlideTo;
  const from: AssetCategory = rawFrom && categories.includes(rawFrom as AssetCategory) ? rawFrom as AssetCategory : "Equity";
  const to: AssetCategory = rawTo && categories.includes(rawTo as AssetCategory) ? rawTo as AssetCategory : "Debt";
  return {
    intervalYears: Math.max(1, Math.min(50, Math.round(numberSetting(goal.consumptionGlideIntervalYears, 5)))),
    shiftPercent: Math.max(0, Math.min(100, numberSetting(goal.consumptionGlideShiftPercent, 0))),
    from,
    to,
    floorPercent: Math.max(0, Math.min(100, numberSetting(goal.consumptionGlideFloorPercent, 20)))
  };
}

function allocationFromValues(values: Record<AssetCategory, number>, total: number): TargetAllocationSettings {
  if (total <= 0) return normalizeTargetAllocation({ Equity: 65, Debt: 30, Gold: 0, Others: 0, Cash: 5 });
  return normalizeTargetAllocation(Object.fromEntries(categories.map((category) => [category, (values[category] / total) * 100])) as TargetAllocationSettings);
}

function weightedReturnForAllocation(goal: GoalProgress, allocation: TargetAllocationSettings): number {
  return categories.reduce((sum, category) => sum + (allocation[category] / 100) * categoryReturnFromGoal(goal, category), 0);
}

function weightedReturnForSettingsAllocation(scenario: ScenarioSettings, allocation: TargetAllocationSettings): number {
  return categories.reduce((sum, category) => sum + (allocation[category] / 100) * returnRateForCategory(scenario, category), 0);
}

function firstDayOfNextMonth(date: string): string {
  const parsed = new Date(date + "T00:00:00.000Z");
  if (!Number.isFinite(parsed.getTime())) return date;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

function monthsBetween(fromDate: string, toDate: string): number {
  const from = new Date(fromDate + "T00:00:00.000Z").getTime();
  const to = new Date(toDate + "T00:00:00.000Z").getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  return (to - from) / (365.25 * 24 * 60 * 60 * 1000) * 12;
}

function monthlyContributionFutureValue(monthlyAmount: number, contributionMonths: number, growthMonths: number, annualReturn: number, annualStepUpPercent: number): number {
  if (monthlyAmount <= 0 || contributionMonths <= 0 || growthMonths <= 0) return 0;
  const monthlyReturn = Math.pow(1 + annualReturn / 100, 1 / 12) - 1;
  let value = 0;
  for (let month = 0; month < growthMonths; month += 1) {
    if (month < contributionMonths) {
      value += monthlyAmount * Math.pow(1 + annualStepUpPercent / 100, Math.floor(month / 12));
    }
    value *= 1 + monthlyReturn;
  }
  return roundMoney(value);
}

function solveNeededMonthly(targetFutureValue: number, contributionMonths: number, growthMonths: number, annualReturn: number, annualStepUpPercent: number): number {
  if (targetFutureValue <= 0 || contributionMonths <= 0 || growthMonths <= 0) return 0;
  let low = 0;
  let high = Math.max(1000, targetFutureValue / Math.max(1, contributionMonths));
  while (monthlyContributionFutureValue(high, contributionMonths, growthMonths, annualReturn, annualStepUpPercent) < targetFutureValue) high *= 2;
  for (let index = 0; index < 30; index += 1) {
    const mid = (low + high) / 2;
    if (monthlyContributionFutureValue(mid, contributionMonths, growthMonths, annualReturn, annualStepUpPercent) >= targetFutureValue) high = mid;
    else low = mid;
  }
  return roundMoney(high);
}

function categoryReturnFromGoal(goal: GoalProgress, category: AssetCategory): number {
  if (category === "Equity") return goal.goal.equityReturn ?? goal.goal.expectedReturn ?? 10;
  if (category === "Debt") return goal.goal.debtReturn ?? 6;
  if (category === "Gold") return goal.goal.goldReturn ?? 6;
  if (category === "Cash") return goal.goal.cashReturn ?? 6;
  return goal.goal.otherReturn ?? 6;
}

function targetAllocationForGoal(goal: Goal, fallback: TargetAllocationSettings | undefined, phase: "accumulation" | "consumption"): TargetAllocationSettings | undefined {
  const raw = phase === "accumulation" ? goal.accumulationTargetAllocation : goal.consumptionTargetAllocation;
  const total = raw ? categories.reduce((sum, category) => sum + (Number(raw[category]) || 0), 0) : 0;
  if (total > 0) {
    return normalizeTargetAllocation(Object.fromEntries(categories.map((category) => [category, Number(raw?.[category]) || 0])) as TargetAllocationSettings);
  }
  return fallback ? normalizeTargetAllocation(fallback) : undefined;
}

function returnRateForCategory(settings: ScenarioSettings, category: AssetCategory): number {
  if (category === "Equity") return settings.equityReturn;
  if (category === "Debt") return settings.debtReturn;
  if (category === "Gold") return settings.goldReturn;
  if (category === "Cash") return settings.cashReturn;
  return settings.otherReturn;
}

function usdExposureRatio(backup: PortfolioBackup, category: AssetCategory): number {
  let total = 0;
  let usd = 0;
  for (const balance of backup.manualBalances) {
    if (balance.category !== category) continue;
    const value = Number(balance.value) || 0;
    total += value;
    if (balance.currency === "USD") usd += value;
  }
  return total <= 0 ? 0 : usd / total;
}

function diffCategoryRecords(
  from: ReturnType<typeof calculatePortfolioSummary>["allocation"],
  to: ReturnType<typeof calculatePortfolioSummary>["allocation"]
): Record<AssetCategory, number> {
  return Object.fromEntries(categories.map((category) => [category, roundMoney(to[category].value - from[category].value)])) as Record<AssetCategory, number>;
}

function diffNamedRows(fromRows: Array<{ name: string; value: number }>, toRows: Array<{ name: string; value: number }>): Record<string, number> {
  const names = new Set([...fromRows.map((row) => row.name), ...toRows.map((row) => row.name)]);
  const from = new Map(fromRows.map((row) => [row.name, row.value]));
  const to = new Map(toRows.map((row) => [row.name, row.value]));
  return Object.fromEntries([...names].map((name) => [name, roundMoney((to.get(name) ?? 0) - (from.get(name) ?? 0))]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dateMonthsBefore(date: string, months: number): string {
  const parsed = new Date(date + "T00:00:00.000Z");
  if (Number.isNaN(parsed.getTime())) return date;
  parsed.setUTCMonth(parsed.getUTCMonth() - months);
  return parsed.toISOString().slice(0, 10);
}

function numberSetting(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundPercent(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
