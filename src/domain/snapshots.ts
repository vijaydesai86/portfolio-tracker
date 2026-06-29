import { calculateDashboardPerformance, type DashboardPerformance } from "@/src/domain/dashboardPerformance";
import { calculateGoalProgress, summarizeGoalProgress, type GoalProgress, type GoalSummary } from "@/src/domain/goalAnalytics";
import { calculateHoldingReturns, type HoldingReturn } from "@/src/domain/holdingReturns";
import { calculatePortfolioInsights, calculatePortfolioSummary, type HoldingInsight, type PortfolioInsights, type PortfolioSummary } from "@/src/domain/analytics";
import type { AssetCategory, PortfolioBackup, PortfolioSnapshot, SnapshotFrozenData } from "@/src/schema/backup";

export type SnapshotTimelinePoint = {
  snapshotId: string;
  name: string;
  asOfDate: string;
  createdAt: string;
  netWorth: number;
  invested: number;
  profit: number;
  xirr: number | null;
  category: Record<AssetCategory, number>;
  region: Record<string, number>;
  assetKind: Record<string, number>;
  issuer: Record<string, number>;
  provider: Record<string, number>;
  goalTarget: number;
  goalRequiredToday: number;
  goalMappedCurrent: number;
  goalProjected: number;
  goalTodayGap: number;
  goalProjectedGap: number;
};

export type SnapshotHoldingRow = {
  holding: HoldingInsight;
  returns?: HoldingReturn;
};

export type SnapshotAnalytics = {
  generatedAt: string;
  summary: PortfolioSummary;
  performance: DashboardPerformance;
  insights: Pick<PortfolioInsights, "totalsByCategory" | "totalsByProvider" | "totalsByInstitution" | "totalsByIssuer" | "totalsByAssetKind" | "totalsByRegion" | "transactionStats" | "xirrBase">;
  holdings: SnapshotHoldingRow[];
  goals: GoalProgress[];
  goalSummary: GoalSummary;
  timelinePoint: SnapshotTimelinePoint;
};

const categories: AssetCategory[] = ["Equity", "Debt", "Gold", "Others", "Cash"];

export function createPortfolioSnapshot(backup: PortfolioBackup, input: { name?: string; notes?: string; asOfDate?: string; now?: string } = {}): PortfolioSnapshot {
  const now = input.now ?? new Date().toISOString();
  const frozenData = freezeBackupData(backup);
  const frozenBackup = backupFromFrozenData(backup, frozenData, now);
  const analytics = calculateSnapshotAnalytics(frozenBackup, {
    snapshotId: snapshotId(now),
    name: normalizedSnapshotName(input.name, now),
    asOfDate: input.asOfDate ?? latestPortfolioDate(backup),
    createdAt: now
  });

  return {
    id: analytics.timelinePoint.snapshotId,
    name: analytics.timelinePoint.name,
    asOfDate: analytics.timelinePoint.asOfDate,
    createdAt: now,
    baseCurrency: backup.baseCurrency,
    notes: input.notes?.trim() || undefined,
    frozenData,
    analytics: clone(analytics) as unknown as Record<string, unknown>
  };
}

export function calculateSnapshotAnalytics(backup: PortfolioBackup, identity: { snapshotId: string; name: string; asOfDate: string; createdAt: string }): SnapshotAnalytics {
  const summary = calculatePortfolioSummary(backup);
  const insights = calculatePortfolioInsights(backup);
  const holdingReturns = calculateHoldingReturns(backup);
  const performance = calculateDashboardPerformance(summary, insights.transactionStats, holdingReturns.values());
  const goals = calculateGoalProgress(backup);
  const includedGoals = goals.filter((goal) => goal.goal.includeInCombinedGoals !== false);
  const goalSummary = summarizeGoalProgress(includedGoals);
  const holdings = insights.holdings.map((holding) => ({ holding, returns: holdingReturns.get(holding.id) }));

  return {
    generatedAt: identity.createdAt,
    summary,
    performance,
    insights: {
      totalsByCategory: insights.totalsByCategory,
      totalsByProvider: insights.totalsByProvider,
      totalsByInstitution: insights.totalsByInstitution,
      totalsByIssuer: insights.totalsByIssuer,
      totalsByAssetKind: insights.totalsByAssetKind,
      totalsByRegion: insights.totalsByRegion,
      transactionStats: insights.transactionStats,
      xirrBase: insights.xirrBase
    },
    holdings,
    goals,
    goalSummary,
    timelinePoint: {
      snapshotId: identity.snapshotId,
      name: identity.name,
      asOfDate: identity.asOfDate,
      createdAt: identity.createdAt,
      netWorth: summary.netWorth,
      invested: performance.netInvested,
      profit: performance.profitKnown ? performance.totalProfit : 0,
      xirr: insights.xirrBase,
      category: Object.fromEntries(categories.map((category) => [category, summary.allocation[category].value])) as Record<AssetCategory, number>,
      region: rowsToRecord(insights.totalsByRegion),
      assetKind: rowsToRecord(insights.totalsByAssetKind),
      issuer: rowsToRecord(insights.totalsByIssuer),
      provider: rowsToRecord(insights.totalsByProvider),
      goalTarget: goalSummary.targetCorpus,
      goalRequiredToday: goalSummary.requiredCorpusToday,
      goalMappedCurrent: goalSummary.mappedCurrentValue,
      goalProjected: goalSummary.projectedValue,
      goalTodayGap: goalSummary.corpusTodayGap,
      goalProjectedGap: goalSummary.projectedGap
    }
  };
}

export function buildSnapshotHistory(snapshots: PortfolioSnapshot[]): SnapshotTimelinePoint[] {
  return snapshots
    .map((snapshot) => snapshotTimelinePoint(snapshot))
    .filter((point): point is SnapshotTimelinePoint => point !== undefined)
    .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate) || a.createdAt.localeCompare(b.createdAt));
}

export function snapshotAnalytics(snapshot: PortfolioSnapshot): SnapshotAnalytics | undefined {
  const analytics = snapshot.analytics as unknown;
  if (!analytics || typeof analytics !== "object") return undefined;
  const candidate = analytics as Partial<SnapshotAnalytics>;
  if (!candidate.summary || !candidate.performance || !candidate.timelinePoint) return undefined;
  return candidate as SnapshotAnalytics;
}

function snapshotTimelinePoint(snapshot: PortfolioSnapshot): SnapshotTimelinePoint | undefined {
  const analytics = snapshotAnalytics(snapshot);
  if (analytics?.timelinePoint) return { ...analytics.timelinePoint, snapshotId: snapshot.id, name: snapshot.name, asOfDate: snapshot.asOfDate, createdAt: snapshot.createdAt };
  const maybeSummary = (snapshot.analytics as { summary?: PortfolioSummary; performance?: DashboardPerformance; insights?: { xirrBase?: number | null }; goalSummary?: GoalSummary }).summary;
  const maybePerformance = (snapshot.analytics as { performance?: DashboardPerformance }).performance;
  if (!maybeSummary || !maybePerformance) return undefined;
  return {
    snapshotId: snapshot.id,
    name: snapshot.name,
    asOfDate: snapshot.asOfDate,
    createdAt: snapshot.createdAt,
    netWorth: maybeSummary.netWorth,
    invested: maybePerformance.netInvested,
    profit: maybePerformance.profitKnown ? maybePerformance.totalProfit : 0,
    xirr: ((snapshot.analytics as { insights?: { xirrBase?: number | null } }).insights?.xirrBase ?? null),
    category: Object.fromEntries(categories.map((category) => [category, maybeSummary.allocation[category]?.value ?? 0])) as Record<AssetCategory, number>,
    region: {},
    assetKind: {},
    issuer: {},
    provider: {},
    goalTarget: ((snapshot.analytics as { goalSummary?: GoalSummary }).goalSummary?.targetCorpus ?? 0),
    goalRequiredToday: ((snapshot.analytics as { goalSummary?: GoalSummary }).goalSummary?.requiredCorpusToday ?? 0),
    goalMappedCurrent: ((snapshot.analytics as { goalSummary?: GoalSummary }).goalSummary?.mappedCurrentValue ?? 0),
    goalProjected: ((snapshot.analytics as { goalSummary?: GoalSummary }).goalSummary?.projectedValue ?? 0),
    goalTodayGap: ((snapshot.analytics as { goalSummary?: GoalSummary }).goalSummary?.corpusTodayGap ?? 0),
    goalProjectedGap: ((snapshot.analytics as { goalSummary?: GoalSummary }).goalSummary?.projectedGap ?? 0)
  };
}

function freezeBackupData(backup: PortfolioBackup): SnapshotFrozenData {
  return clone({
    settings: backup.settings,
    accounts: backup.accounts,
    instruments: backup.instruments,
    transactions: backup.transactions,
    manualBalances: backup.manualBalances,
    priceSnapshots: backup.priceSnapshots,
    goals: backup.goals,
    goalExpenses: backup.goalExpenses ?? [],
    goalMappings: backup.goalMappings,
    imports: backup.imports,
    sourceDocuments: backup.sourceDocuments
  });
}

function backupFromFrozenData(current: PortfolioBackup, frozenData: SnapshotFrozenData, exportedAt: string): PortfolioBackup {
  return {
    schemaVersion: current.schemaVersion,
    app: current.app,
    exportedAt,
    baseCurrency: current.baseCurrency,
    settings: frozenData.settings,
    accounts: frozenData.accounts,
    instruments: frozenData.instruments,
    transactions: frozenData.transactions,
    manualBalances: frozenData.manualBalances,
    priceSnapshots: frozenData.priceSnapshots,
    goals: frozenData.goals,
    goalExpenses: frozenData.goalExpenses ?? [],
    goalMappings: frozenData.goalMappings,
    snapshots: [],
    imports: frozenData.imports,
    sourceDocuments: frozenData.sourceDocuments
  };
}

function rowsToRecord(rows: Array<{ name: string; value: number }>): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [row.name, row.value]));
}

function latestPortfolioDate(backup: PortfolioBackup): string {
  const dates = [
    ...backup.manualBalances.map((balance) => balance.asOfDate),
    ...backup.transactions.map((transaction) => transaction.date),
    ...backup.priceSnapshots.map((price) => price.asOfDate)
  ].filter(Boolean).sort();
  return dates.at(-1) ?? new Date().toISOString().slice(0, 10);
}

function normalizedSnapshotName(name: string | undefined, now: string): string {
  const trimmed = name?.trim();
  return trimmed || "Snapshot " + now.slice(0, 10);
}

function snapshotId(now: string): string {
  return "snapshot_" + now.replace(/[^0-9]/g, "") + "_" + Math.random().toString(36).slice(2, 8);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
