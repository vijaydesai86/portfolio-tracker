"use client";

import { AlertTriangle, Camera, Database, Download, FileJson, LayoutDashboard, Pencil, PlusCircle, ReceiptText, RefreshCw, RotateCcw, Search, Settings, ShieldCheck, Table2, Target, TrendingDown, TrendingUp, Upload } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { calculatePortfolioInsights, calculatePortfolioSummary, tryConvertToBase, type HoldingInsight } from "@/src/domain/analytics";
import { deleteImportRunFromBackup, deleteTransactionFromBackup } from "@/src/domain/deleteRecords";
import { assetSubtypeDisplayLabel, assetSubtypeLabel } from "@/src/domain/assetSubtype";
import { calculateHoldingReturns, type HoldingReturn } from "@/src/domain/holdingReturns";
import { calculateDashboardPerformance } from "@/src/domain/dashboardPerformance";
import { applyManualEntry, manualEntryActionsForAccount, type ManualEntryAction } from "@/src/domain/manualEntry";
import { buildPortfolioTimeline, type PortfolioTimelinePoint } from "@/src/domain/performanceTimeline";
import { buildGoal, calculateGoalProgress, calculateMappedGoalXirr, createGoalMapping, recalculateGoalTarget, summarizeGoalProgress, type GoalProgress, type GoalSummary } from "@/src/domain/goalAnalytics";
import { buildSnapshotHistory, createPortfolioSnapshot, snapshotAnalytics, type SnapshotAnalytics, type SnapshotTimelinePoint } from "@/src/domain/snapshots";
import { calculatePortfolioTaxReport, getTaxProfile, updateTaxProfile, type TaxProfile } from "@/src/domain/tax";
import { taperPresets } from "@/src/domain/tapering";
import { buildReconciliationReport } from "@/src/domain/reconciliation";
import { detectImportSource, type ImportDetection } from "@/src/importers/detectImport";
import { extractPdfTextInBrowser } from "@/src/importers/browserPdfText";
import { applyCanonicalCasImport, buildCanonicalCasImport, parseCasText, type CasCanonicalImport, type CasParseResult } from "@/src/importers/casText";
import { applyCanonicalIndMoneyImport, buildCanonicalIndMoneyImport, parseIndMoneyWorkbook, type IndMoneyCanonicalImport, type IndMoneyParseResult } from "@/src/importers/indmoneyXlsx";
import { applyCanonicalEpfoImport, buildCanonicalEpfoImport, parseEpfoPassbookText, type EpfoCanonicalImport, type EpfoPassbookParseResult } from "@/src/importers/epfoPassbook";
import { applyCanonicalNpsImport, buildCanonicalNpsImport, parseNpsCsv, type NpsCanonicalImport, type NpsParseResult } from "@/src/importers/npsStatement";
import { commitManualCsvImport } from "@/src/importers/importPipeline";
import { providerImportSpecs } from "@/src/importers/providerRegistry";
import { applyMarketDataPayload, type MarketDataPayload } from "@/src/marketData/marketData";
import { buildUsdInrSnapshot, mergePriceSnapshots, parseUsdInrFxCsv } from "@/src/marketData/manualFx";
import { createEmptyBackup, parseBackup, type AssetCategory, type Goal, type ManualBalance, type PortfolioBackup, type TaperMode, type Transaction } from "@/src/schema/backup";

const sampleTemplate = `balance_id,as_of_date,institution,asset_type,name,current_value,currency,category,invested_amount,invested_currency,invested_as_of_date,notes\ncash-main,2026-06-22,Manual,cash,Cash Wallet,10000,INR,Cash,,,,liquid cash\nespp-contribution,2026-06-22,Employer,espp,ESPP Contribution,2000,USD,Equity,2000,USD,2026-06-22,total contribution only\nppf-main,2026-06-22,Post Office,ppf,Public Provident Fund,300000,INR,Debt,250000,INR,2026-06-22,latest known balance`;

const categoryOrder: AssetCategory[] = ["Equity", "Debt", "Gold", "Others", "Cash"];
const chartColors = ["#0e7490", "#2563eb", "#8b5cf6", "#d97706", "#059669", "#dc2626", "#64748b", "#0891b2"];
const assetClassCards = [
  { key: "Equity", title: "Equity", description: "MF, Indian stocks, US stocks, ESPP" },
  { key: "Debt", title: "Debt", description: "Debt MF, PF, PPF, SSY, NPS debt, FD" },
  { key: "Gold", title: "Gold", description: "Gold funds, SGB, physical/manual gold" },
  { key: "Cash", title: "Cash", description: "Savings, broker cash, emergency funds" },
  { key: "Others", title: "Others", description: "Hybrid, unclassified, custom assets" }
] as const satisfies Array<{ key: AssetCategory; title: string; description: string }>;

const transactionTypes: Transaction["type"][] = ["buy", "sell", "sip", "redemption", "switch_in", "switch_out", "dividend", "interest", "interest_accrual", "deposit", "withdrawal", "fee", "tax", "maturity", "contribution", "split"];

type View = "dashboard" | "holdings" | "transactions" | "goals" | "tax" | "snapshots" | "add-entry" | "imports" | "data" | "settings" | "backup";
type AnalyticsTab = "overview" | "allocation" | "assets" | "history";
type AnalyticsScope = "portfolio" | "goals-combined" | `goal:${string}`;
type HoldingSort = "value" | "gain" | "xirr" | "allocation" | "name" | "category" | "source";

function currentIndianFinancialYear(date = new Date()): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const start = month >= 4 ? year : year - 1;
  return start + "-" + String(start + 1).slice(2);
}

function indianFinancialYearForDate(dateText: string): string | undefined {
  const date = new Date(dateText + "T00:00:00.000Z");
  if (Number.isNaN(date.getTime())) return undefined;
  return currentIndianFinancialYear(date);
}

function availableTaxFinancialYears(backup: PortfolioBackup): string[] {
  const years = new Set<string>([currentIndianFinancialYear()]);
  for (const tx of backup.transactions) {
    const year = indianFinancialYearForDate(tx.date);
    if (year) years.add(year);
  }
  return [...years].sort((a, b) => b.localeCompare(a));
}


type DashboardSignal = {
  label: string;
  value: string;
  detail: string;
  tone: "good" | "warn" | "neutral";
  icon: "shield" | "alert" | "trend";
};

type CommandInsightCard = {
  label: string;
  value: string;
  detail: string;
  tone: "good" | "warn" | "neutral" | "info";
  progress?: number;
  footnote?: string;
};

type ScopedHolding = HoldingInsight & {
  scopedValue: number;
  scopedInvested?: number;
  scopedProfit?: number;
  scopedReturnPercent?: number;
  scopedAllocationPercent: number;
  mappedPercent?: number;
};

type RankingDatum = { name: string; value: number; tag?: string; category?: AssetCategory };

type AssetClassInsight = {
  category: AssetCategory;
  value: number;
  percent: number;
  invested: number;
  profit: number;
  returnPercent?: number;
  holdings: number;
  xirrAvailable: number;
  xirrTotal: number;
  largest?: ScopedHolding;
  subtypeRows: RankingDatum[];
  topHoldings: RankingDatum[];
  topProfit: RankingDatum[];
};

type ScopedAnalyticsData = {
  scope: AnalyticsScope;
  scopeKind: "portfolio" | "goals-combined" | "goal";
  label: string;
  eyebrow: string;
  description: string;
  current: number;
  performance: {
    grossCashIn: number;
    current: number;
    cashOut: number;
    feesAndTax: number;
    netInvested: number;
    currentWithCostBasis: number;
    currentProfit: number;
    totalProfit: number;
    profitKnown: boolean;
    absoluteReturnPercent: number | null;
  };
  xirrLabel: string;
  xirrDetail: string;
  requiredToday?: number;
  projected?: number;
  goalGap?: number;
  allocation: Record<AssetCategory, { value: number; percent: number }>;
  holdings: ScopedHolding[];
  chartData: {
    allocation: Array<{ name: string; value: number; percent?: number }>;
    assetType: Array<{ name: string; value: number }>;
    region: Array<{ name: string; value: number }>;
    issuer: Array<{ name: string; value: number }>;
    category: Array<{ name: string; value: number; percent?: number }>;
    institution: Array<{ name: string; value: number }>;
    provider: Array<{ name: string; value: number }>;
  };
};

function buildScopedAnalytics(input: {
  backup: PortfolioBackup;
  scope: AnalyticsScope;
  summary: ReturnType<typeof calculatePortfolioSummary>;
  insights: ReturnType<typeof calculatePortfolioInsights>;
  performance: ReturnType<typeof calculateDashboardPerformance>;
  holdingReturns: Map<string, HoldingReturn>;
  goalProgress: GoalProgress[];
  goalSummary: GoalSummary;
}): ScopedAnalyticsData {
  if (input.scope === "portfolio") return portfolioScopedAnalytics(input);
  if (input.scope === "goals-combined") return goalScopedAnalytics(input, undefined);
  const goalId = input.scope.replace(/^goal:/, "");
  const goal = input.goalProgress.find((item) => item.goal.id === goalId);
  return goalScopedAnalytics(input, goal);
}

function portfolioScopedAnalytics(input: {
  scope: AnalyticsScope;
  summary: ReturnType<typeof calculatePortfolioSummary>;
  insights: ReturnType<typeof calculatePortfolioInsights>;
  performance: ReturnType<typeof calculateDashboardPerformance>;
  holdingReturns: Map<string, HoldingReturn>;
}): ScopedAnalyticsData {
  const holdings = input.insights.holdings.map((holding) => scopedHoldingFromInsight(holding, holding.valueInBase ?? 0, input.holdingReturns.get(holding.id))).sort((a, b) => b.scopedValue - a.scopedValue);
  return {
    scope: "portfolio",
    scopeKind: "portfolio",
    label: "Overall Portfolio",
    eyebrow: "Portfolio command center",
    description: `${holdings.length} holdings. Overall analytics use the full canonical portfolio ledger and current valuations.`,
    current: input.performance.current,
    performance: input.performance,
    xirrLabel: input.insights.xirrBase === null ? "-" : input.insights.xirrBase.toFixed(2) + "%",
    xirrDetail: "Timing-aware return using transaction-date FX when available",
    allocation: input.summary.allocation,
    holdings,
    chartData: chartDataFromScopedHoldings(holdings, input.summary.allocation)
  };
}

function goalScopedAnalytics(input: {
  backup: PortfolioBackup;
  scope: AnalyticsScope;
  insights: ReturnType<typeof calculatePortfolioInsights>;
  goalProgress: GoalProgress[];
  goalSummary: GoalSummary;
}, selected: GoalProgress | undefined): ScopedAnalyticsData {
  const progresses = selected ? [selected] : input.goalProgress;
  const holdingsById = new Map(input.insights.holdings.map((holding) => [holding.id, holding]));
  const rows: ScopedHolding[] = [];
  for (const progress of progresses) {
    for (const mapped of progress.mappedHoldings) {
      const insight = holdingsById.get(mapped.balance.id);
      if (!insight) continue;
      rows.push(scopedHoldingFromInsight(insight, mapped.value, undefined, {
        invested: mapped.invested,
        profit: mapped.profit,
        mappedPercent: mapped.mappedPercent
      }));
    }
  }
  const holdings = mergeScopedHoldings(rows).sort((a, b) => b.scopedValue - a.scopedValue);
  const current = selected ? selected.mappedCurrentValue : input.goalSummary.mappedCurrentValue;
  const invested = selected ? selected.mappedInvested : input.goalSummary.mappedInvested;
  const profit = selected ? selected.mappedProfit : input.goalSummary.mappedProfit;
  const returnPercent = selected ? selected.mappedReturnPercent : input.goalSummary.mappedReturnPercent;
  const allocation = allocationFromCategoryValues(selected ? selected.categoryValues : input.goalSummary.categoryValues, current);
  const mappedXirr = calculateMappedGoalXirr(input.backup, progresses);
  const xirrCoverageDetail = mappedXirr.mappedHoldings === 0
    ? "No mapped holdings yet"
    : mappedXirr.cashFlowHoldings + "/" + mappedXirr.mappedHoldings + " mapped holding(s) with dated cash flows";
  const xirrBasisDetail = mappedXirr.basis === "portfolio" ? "portfolio-equivalent cash-flow basis" : "goal-weighted holding cash-flow basis";
  const xirrDetail = mappedXirr.missingFx.length > 0 ? "FX needed: " + mappedXirr.missingFx.slice(0, 2).join(", ") : xirrBasisDetail + "; " + xirrCoverageDetail;
  const label = selected ? selected.goal.name : "Combined Goals";
  return {
    scope: selected ? `goal:${selected.goal.id}` : "goals-combined",
    scopeKind: selected ? "goal" : "goals-combined",
    label,
    eyebrow: selected ? "Goal analytics" : "Combined goal analytics",
    description: selected
      ? `${selected.goal.name} analytics are scoped to assets mapped to this goal. Values are weighted by mapping percentage and use the same holdings cost basis as the portfolio.`
      : `Combined goal analytics sum every goal's mapped corpus. If one asset is mapped to multiple goals, it is counted once per goal purpose because this is a goal-funding view, not portfolio net worth.`,
    current,
    performance: {
      grossCashIn: 0,
      current,
      cashOut: 0,
      feesAndTax: 0,
      netInvested: invested,
      currentWithCostBasis: current,
      currentProfit: profit,
      totalProfit: profit,
      profitKnown: invested > 0,
      absoluteReturnPercent: invested > 0 && returnPercent !== undefined ? returnPercent : null
    },
    xirrLabel: mappedXirr.xirr === null ? "-" : mappedXirr.xirr.toFixed(2) + "%",
    xirrDetail,
    requiredToday: selected ? selected.requiredCorpusToday : input.goalSummary.requiredCorpusToday,
    projected: selected ? selected.projectedValue : input.goalSummary.projectedValue,
    goalGap: selected ? selected.projectedGap : input.goalSummary.projectedGap,
    allocation,
    holdings,
    chartData: chartDataFromScopedHoldings(holdings, allocation)
  };
}

function scopedHoldingFromInsight(holding: HoldingInsight, value: number, returns?: HoldingReturn, override?: { invested?: number; profit?: number; mappedPercent?: number }): ScopedHolding {
  const invested = override?.invested ?? returns?.netInvested;
  const profit = override?.profit ?? returns?.profit;
  return {
    ...holding,
    valueInBase: value,
    scopedValue: roundMoney(value),
    scopedInvested: invested === undefined ? undefined : roundMoney(invested),
    scopedProfit: profit === undefined ? undefined : roundMoney(profit),
    scopedReturnPercent: profit === undefined || invested === undefined || invested <= 0 ? undefined : roundPercent((profit / invested) * 100),
    scopedAllocationPercent: 0,
    mappedPercent: override?.mappedPercent
  };
}

function mergeScopedHoldings(rows: ScopedHolding[]): ScopedHolding[] {
  const merged = new Map<string, ScopedHolding>();
  for (const row of rows) {
    const existing = merged.get(row.id);
    if (!existing) {
      merged.set(row.id, { ...row });
      continue;
    }
    const value = existing.scopedValue + row.scopedValue;
    const invested = (existing.scopedInvested ?? 0) + (row.scopedInvested ?? 0);
    const profit = (existing.scopedProfit ?? 0) + (row.scopedProfit ?? 0);
    merged.set(row.id, {
      ...existing,
      scopedValue: roundMoney(value),
      valueInBase: roundMoney(value),
      scopedInvested: invested > 0 ? roundMoney(invested) : existing.scopedInvested,
      scopedProfit: roundMoney(profit),
      scopedReturnPercent: invested > 0 ? roundPercent((profit / invested) * 100) : undefined,
      mappedPercent: undefined
    });
  }
  const total = [...merged.values()].reduce((sum, row) => sum + row.scopedValue, 0);
  return [...merged.values()].map((row) => ({ ...row, scopedAllocationPercent: total <= 0 ? 0 : roundPercent((row.scopedValue / total) * 100) }));
}

function allocationFromCategoryValues(values: Record<AssetCategory, number>, total: number): Record<AssetCategory, { value: number; percent: number }> {
  return Object.fromEntries(categoryOrder.map((category) => [category, { value: roundMoney(values[category] ?? 0), percent: total <= 0 ? 0 : roundPercent(((values[category] ?? 0) / total) * 100) }])) as Record<AssetCategory, { value: number; percent: number }>;
}

function chartDataFromScopedHoldings(holdings: ScopedHolding[], allocation: Record<AssetCategory, { value: number; percent: number }>): ScopedAnalyticsData["chartData"] {
  return {
    allocation: categoryOrder.map((category) => ({ name: category, value: allocation[category].value, percent: allocation[category].percent })).filter((item) => item.value > 0),
    category: categoryOrder.map((category) => ({ name: category, value: allocation[category].value, percent: allocation[category].percent })).filter((item) => item.value > 0),
    assetType: groupScopedHoldings(holdings, "assetKind").slice(0, 8),
    region: groupScopedHoldings(holdings, "region").slice(0, 8),
    issuer: groupScopedHoldings(holdings, "issuer").slice(0, 8),
    institution: groupScopedHoldings(holdings, "institution").slice(0, 8),
    provider: groupScopedHoldings(holdings, "provider").slice(0, 8)
  };
}

function groupScopedHoldings(holdings: ScopedHolding[], key: "assetKind" | "region" | "issuer" | "institution" | "provider"): Array<{ name: string; value: number }> {
  const totals = new Map<string, number>();
  for (const holding of holdings) totals.set(holding[key], (totals.get(holding[key]) ?? 0) + holding.scopedValue);
  return [...totals.entries()].map(([name, value]) => ({ name, value: roundMoney(value) })).filter((item) => item.value > 0).sort((a, b) => b.value - a.value);
}

function buildAssetClassInsights(holdings: ScopedHolding[], holdingReturns: Map<string, HoldingReturn>): AssetClassInsight[] {
  const total = holdings.reduce((sum, holding) => sum + holding.scopedValue, 0);
  return categoryOrder.map((category) => {
    const rows = holdings.filter((holding) => holding.category === category).sort((a, b) => b.scopedValue - a.scopedValue);
    const value = rows.reduce((sum, holding) => sum + holding.scopedValue, 0);
    const invested = rows.reduce((sum, holding) => sum + (holding.scopedInvested ?? holdingReturns.get(holding.id)?.netInvested ?? 0), 0);
    const profit = rows.reduce((sum, holding) => sum + (holding.scopedProfit ?? holdingReturns.get(holding.id)?.profit ?? 0), 0);
    const xirrRows = rows.map((holding) => holdingReturns.get(holding.id)?.xirr).filter((xirr): xirr is number => typeof xirr === "number");
    const subtypeTotals = new Map<string, number>();
    for (const holding of rows) {
      const subtype = assetSubtypeLabel(holding);
      subtypeTotals.set(subtype, (subtypeTotals.get(subtype) ?? 0) + holding.scopedValue);
    }
    return {
      category,
      value: roundMoney(value),
      percent: total <= 0 ? 0 : roundPercent((value / total) * 100),
      invested: roundMoney(invested),
      profit: roundMoney(profit),
      returnPercent: invested > 0 ? roundPercent((profit / invested) * 100) : undefined,
      holdings: rows.length,
      xirrAvailable: xirrRows.length,
      xirrTotal: rows.length,
      largest: rows[0],
      subtypeRows: [...subtypeTotals.entries()].map(([name, subtypeValue]) => ({ name: assetSubtypeDisplayLabel(category, name), value: roundMoney(subtypeValue), category })).sort((a, b) => b.value - a.value).slice(0, 6),
      topHoldings: rows.slice(0, 6).map((holding) => ({ name: holding.label, value: holding.scopedValue, tag: assetSubtypeLabel(holding), category: holding.category })),
      topProfit: rows.map((holding) => ({ name: holding.label, value: holding.scopedProfit ?? holdingReturns.get(holding.id)?.profit ?? 0, tag: assetSubtypeLabel(holding), category: holding.category })).filter((item) => item.value > 0).sort((a, b) => b.value - a.value).slice(0, 6)
    };
  }).filter((item) => item.value > 0 || item.holdings > 0);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundPercent(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

const goalTermHelp = {
  targetCorpus: "Future corpus required at the goal year. It is inflated monthly expense at that year x 12 x the corpus multiple.",
  neededToday: "Corpus required today to reach the target by the goal year using the mapped asset mix and return assumptions, without extra future investment.",
  mappedNow: "Current value mapped to this goal today. If a mapped holding has taper enabled, this uses tracked conservative value.",
  projectedAtGoal: "Estimated goal-date value of the mapped assets using category return assumptions and any active taper setting."
};

function installCollapsibleSections(root: HTMLElement, view: string, subScope: string) {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(".card, .chart-card, .cardless-panel, .command-hero, .analytics-scope-panel, .asset-class-card, .asset-type-hero, .asset-type-card, .asset-type-card-charts > div, .snapshot-command-panel, .goal-selector-panel, .goal-focus-panel, .goal-card, .goal-combined-panel, .goal-create-panel, .entry-selector-panel, .entry-form-panel"));
  for (const card of candidates) {
    const ownToggle = card.querySelector(":scope > .collapse-toggle, :scope > .collapsible-header > .collapse-toggle, :scope > .section-head > .collapse-toggle, :scope > .goal-card-head > .collapse-toggle");
    if (card.dataset.collapseBound === "true" && ownToggle) continue;
    if (card.closest(".mini-insight, .signal-item, .metric-card")) continue;
    const header = card.querySelector<HTMLElement>(":scope > .section-head, :scope > .goal-card-head") ?? card.querySelector<HTMLElement>(":scope > h2, :scope > h3") ?? card.querySelector<HTMLElement>(":scope > div:first-child");
    const titleSource = card.querySelector<HTMLElement>(":scope > .section-head h2, :scope > h2, :scope > h3, :scope > .goal-card-head input, :scope > .panel-heading span, :scope > .asset-type-card-head span, :scope > .hero-ledger .eyebrow, :scope > .asset-type-hero .eyebrow, :scope > div:first-child h2, :scope > div:first-child .eyebrow, :scope > div:first-child span");
    const title = (titleSource instanceof HTMLInputElement ? titleSource.value : titleSource?.textContent ?? "Section").trim();
    if (!header || !title || title.length > 80) continue;
    card.dataset.collapseBound = "true";
    card.classList.add("collapsible-section");
    header.classList.add("collapsible-header");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "collapse-toggle";
    button.setAttribute("aria-label", "Collapse " + title);
    button.title = "Collapse or expand this section";
    const storageKey = "portfolio-collapse:" + view + ":" + subScope + ":" + title;
    const sync = () => {
      const collapsed = card.classList.contains("is-collapsed");
      button.dataset.state = collapsed ? "collapsed" : "expanded";
      button.setAttribute("aria-expanded", collapsed ? "false" : "true");
      button.setAttribute("aria-label", (collapsed ? "Expand " : "Collapse ") + title);
      button.title = (collapsed ? "Expand " : "Collapse ") + title;
    };
    if (localStorage.getItem(storageKey) === "collapsed") card.classList.add("is-collapsed");
    sync();
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      card.classList.toggle("is-collapsed");
      localStorage.setItem(storageKey, card.classList.contains("is-collapsed") ? "collapsed" : "expanded");
      sync();
    });
    if (header.classList.contains("section-head") || header.classList.contains("goal-card-head")) {
      header.appendChild(button);
    } else if (header.tagName === "DIV") {
      header.appendChild(button);
    } else {
      card.insertBefore(button, header.nextSibling);
    }
  }
}

function GoalTermLabel({ children, help }: { children: string; help: string }) {
  return <span className="term-label" title={help} aria-label={children + ": " + help} tabIndex={0}>{children}</span>;
}

export function TrackerApp() {
  const [backup, setBackup] = useState<PortfolioBackup>(() => createEmptyBackup("INR"));
  const [view, setView] = useState<View>("dashboard");
  const [csv, setCsv] = useState(sampleTemplate);
  const [errors, setErrors] = useState<string[]>([]);
  const [nativeDetection, setNativeDetection] = useState<ImportDetection | null>(null);
  const [nativeFiles, setNativeFiles] = useState<File[]>([]);
  const [casPassword, setCasPassword] = useState("");
  const [casParse, setCasParse] = useState<CasParseResult | null>(null);
  const [stagedCas, setStagedCas] = useState<CasCanonicalImport | null>(null);
  const [indParse, setIndParse] = useState<IndMoneyParseResult | null>(null);
  const [stagedInd, setStagedInd] = useState<IndMoneyCanonicalImport | null>(null);
  const [epfoParse, setEpfoParse] = useState<EpfoPassbookParseResult[] | null>(null);
  const [stagedEpfo, setStagedEpfo] = useState<EpfoCanonicalImport[] | null>(null);
  const [npsParse, setNpsParse] = useState<NpsParseResult[] | null>(null);
  const [stagedNps, setStagedNps] = useState<NpsCanonicalImport[] | null>(null);
  const [status, setStatus] = useState("Empty local portfolio. Import a manual CSV, CAS PDF, INDMoney XLSX, or restore a backup.");
  const [importLabel, setImportLabel] = useState("");
  const [fxRate, setFxRate] = useState("");
  const [fxDate, setFxDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fxCsv, setFxCsv] = useState("date,rate\n2026-06-22,83.50");
  const [holdingQuery, setHoldingQuery] = useState("");
  const [transactionQuery, setTransactionQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<AssetCategory | "All">("All");
  const [holdingSort, setHoldingSort] = useState<HoldingSort>("value");
  const [holdingEditMode, setHoldingEditMode] = useState(false);
  const [transactionEditMode, setTransactionEditMode] = useState(false);
  const [entryHoldingId, setEntryHoldingId] = useState("");
  const [entryActionId, setEntryActionId] = useState("");
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [entryAmount, setEntryAmount] = useState("");
  const [entryQuantity, setEntryQuantity] = useState("");
  const [entryPrice, setEntryPrice] = useState("");
  const [entryFees, setEntryFees] = useState("0");
  const [entryTaxes, setEntryTaxes] = useState("0");
  const [entryCurrentValue, setEntryCurrentValue] = useState("");
  const [entryInvestedAmount, setEntryInvestedAmount] = useState("");
  const [entryNotes, setEntryNotes] = useState("");
  const [goalName, setGoalName] = useState("Retirement");
  const [goalType, setGoalType] = useState<Goal["type"]>("retirement");
  const [goalMonthlyExpense, setGoalMonthlyExpense] = useState("100000");
  const [goalInflation, setGoalInflation] = useState("6");
  const [goalTargetYear, setGoalTargetYear] = useState(() => String(new Date().getFullYear() + 15));
  const [goalMultiplier, setGoalMultiplier] = useState("35");
  const [goalEquityReturn, setGoalEquityReturn] = useState("10");
  const [goalDebtReturn, setGoalDebtReturn] = useState("6");
  const [goalGoldReturn, setGoalGoldReturn] = useState("6");
  const [goalCashReturn, setGoalCashReturn] = useState("6");
  const [goalOtherReturn, setGoalOtherReturn] = useState("6");
  const [selectedGoalId, setSelectedGoalId] = useState("");
  const [mappingGoalId, setMappingGoalId] = useState("");
  const [mappingBalanceId, setMappingBalanceId] = useState("");
  const [mappingPercent, setMappingPercent] = useState("100");
  const [analyticsTab, setAnalyticsTab] = useState<AnalyticsTab>("overview");
  const [analyticsScope, setAnalyticsScope] = useState<AnalyticsScope>("portfolio");
  const [snapshotName, setSnapshotName] = useState(() => "Snapshot " + new Date().toISOString().slice(0, 10));
  const [snapshotNotes, setSnapshotNotes] = useState("");
  const [selectedSnapshotId, setSelectedSnapshotId] = useState("");

  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".main");
    if (!root) return;
    const scope = analyticsTab + ":" + analyticsScope + ":" + selectedGoalId;
    let frame = 0;
    const run = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => installCollapsibleSections(root, view, scope));
    };
    run();
    const observer = new MutationObserver(run);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [analyticsScope, analyticsTab, selectedGoalId, view]);
  const [taxFinancialYear, setTaxFinancialYear] = useState(() => currentIndianFinancialYear());

  const summary = useMemo(() => calculatePortfolioSummary(backup), [backup]);
  const insights = useMemo(() => calculatePortfolioInsights(backup), [backup]);
  const timeline = useMemo(() => buildPortfolioTimeline(backup), [backup]);
  const allocation = summary.allocation;
  const holdingReturns = useMemo(() => calculateHoldingReturns(backup), [backup]);
  const performance = useMemo(() => calculateDashboardPerformance(summary, insights.transactionStats, holdingReturns.values()), [holdingReturns, insights.transactionStats, summary]);
  const goalProgress = useMemo(() => calculateGoalProgress(backup), [backup]);
  const goalSummary = useMemo(() => summarizeGoalProgress(goalProgress), [goalProgress]);
  const snapshotHistory = useMemo(() => buildSnapshotHistory(backup.snapshots), [backup.snapshots]);
  const taxProfile = useMemo(() => getTaxProfile(backup), [backup]);
  const taxFinancialYears = useMemo(() => availableTaxFinancialYears(backup), [backup]);
  const taxReport = useMemo(() => calculatePortfolioTaxReport(backup, { financialYear: taxFinancialYear }), [backup, taxFinancialYear]);
  const reconciliationReport = useMemo(() => buildReconciliationReport(backup), [backup]);
  const scopedAnalytics = useMemo(() => buildScopedAnalytics({ backup, scope: analyticsScope, summary, insights, performance, holdingReturns, goalProgress, goalSummary }), [analyticsScope, backup, goalProgress, goalSummary, holdingReturns, insights, performance, summary]);
  const scopedPerformance = scopedAnalytics.performance;
  const chartData = scopedAnalytics.chartData;

  const filteredHoldings = useMemo(() => {
    const q = holdingQuery.trim().toLowerCase();
    return insights.holdings
      .filter((holding) => categoryFilter === "All" || holding.category === categoryFilter)
      .filter((holding) => !q || [holding.label, holding.assetKind, holding.region, holding.provider, holding.institution, holding.issuer].join(" ").toLowerCase().includes(q))
      .sort((a, b) => {
        const aReturn = holdingReturns.get(a.id);
        const bReturn = holdingReturns.get(b.id);
        if (holdingSort === "name") return displayHoldingName(a.label).localeCompare(displayHoldingName(b.label));
        if (holdingSort === "category") return a.category.localeCompare(b.category) || (b.valueInBase ?? 0) - (a.valueInBase ?? 0);
        if (holdingSort === "source") return a.provider.localeCompare(b.provider) || (b.valueInBase ?? 0) - (a.valueInBase ?? 0);
        if (holdingSort === "gain") return (bReturn?.profit ?? -Infinity) - (aReturn?.profit ?? -Infinity);
        if (holdingSort === "xirr") return (bReturn?.xirr ?? -Infinity) - (aReturn?.xirr ?? -Infinity);
        if (holdingSort === "allocation") return (bReturn?.allocationPercent ?? 0) - (aReturn?.allocationPercent ?? 0);
        return (b.valueInBase ?? 0) - (a.valueInBase ?? 0);
      });
  }, [categoryFilter, holdingReturns, holdingQuery, holdingSort, insights.holdings]);

  const holdingPageAnalytics = useMemo(() => {
    const totalValue = filteredHoldings.reduce((sum, holding) => sum + (holding.valueInBase ?? 0), 0);
    const totalProfit = filteredHoldings.reduce((sum, holding) => sum + (holdingReturns.get(holding.id)?.profit ?? 0), 0);
    const xirrRows = filteredHoldings.map((holding) => holdingReturns.get(holding.id)?.xirr).filter((xirr): xirr is number => typeof xirr === "number");
    const topAllocation = filteredHoldings[0] ? holdingReturns.get(filteredHoldings[0].id)?.allocationPercent ?? 0 : 0;
    const valueChart = filteredHoldings.slice(0, 8).map((holding) => ({ name: holding.label, value: holding.valueInBase ?? 0, tag: assetSubtypeLabel(holding), category: holding.category })).filter((item) => item.value > 0);
    const profitChart = filteredHoldings.map((holding) => ({ name: holding.label, value: holdingReturns.get(holding.id)?.profit ?? 0, tag: assetSubtypeLabel(holding), category: holding.category })).filter((item) => item.value > 0).sort((a, b) => b.value - a.value).slice(0, 8);
    const xirrChart = filteredHoldings.map((holding) => ({ name: holding.label, value: holdingReturns.get(holding.id)?.xirr ?? 0, tag: assetSubtypeLabel(holding), category: holding.category })).filter((item) => item.value > 0).sort((a, b) => b.value - a.value).slice(0, 8);
    return { totalValue, totalProfit, xirrRows, topAllocation, valueChart, profitChart, xirrChart };
  }, [filteredHoldings, holdingReturns]);

  const filteredTransactions = useMemo(() => {
    const q = transactionQuery.trim().toLowerCase();
    return backup.transactions
      .filter((tx) => !q || transactionSearchText(tx, backup).includes(q))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [backup, transactionQuery]);

  const largestHolding = scopedAnalytics.holdings[0];
  const topFiveValue = scopedAnalytics.holdings.slice(0, 5).reduce((sum, holding) => sum + holding.scopedValue, 0);
  const topFivePercent = scopedAnalytics.current === 0 ? 0 : (topFiveValue / scopedAnalytics.current) * 100;
  const importProviders = new Set(backup.imports.map((run) => run.provider)).size;
  const assetClassSummary = assetClassCards.map((asset) => {
    const bucket = scopedAnalytics.allocation[asset.key];
    const count = scopedAnalytics.holdings.filter((holding) => holding.category === asset.key).length;
    return { ...asset, value: bucket.value, percent: bucket.percent, count };
  });
  const assetClassInsights = useMemo(() => buildAssetClassInsights(scopedAnalytics.holdings, holdingReturns), [holdingReturns, scopedAnalytics.holdings]);

  const totalFxIssues = new Set([...summary.missingFx, ...insights.transactionStats.missingFx]).size;
  const staleHoldings = scopedAnalytics.holdings.filter((holding) => daysSince(holding.asOfDate) > 7).length;
  const reviewCategoryCount = scopedAnalytics.holdings.filter((holding) => holding.category === "Others").length;
  const performanceBridge = [
    { name: "Cost Basis", value: performance.netInvested },
    { name: "Current Value", value: performance.current },
    { name: "Total P/L", value: performance.totalProfit }
  ].filter((item) => item.value !== 0);
  const valuationCoveragePercent = timeline.coverage.totalDates === 0 ? 100 : (timeline.coverage.pricedDates / timeline.coverage.totalDates) * 100;
  const xirrCoverageCount = scopedAnalytics.holdings.filter((holding) => typeof holdingReturns.get(holding.id)?.xirr === "number").length;
  const goalFundedPercent = scopedAnalytics.scopeKind === "portfolio"
    ? goalSummary.requiredCorpusToday > 0 ? goalSummary.corpusTodayFundedPercent : undefined
    : scopedAnalytics.requiredToday && scopedAnalytics.requiredToday > 0 ? (scopedAnalytics.current / scopedAnalytics.requiredToday) * 100 : undefined;
  const equityPercent = scopedAnalytics.allocation.Equity.percent;
  const debtPercent = scopedAnalytics.allocation.Debt.percent;
  const cashPercent = scopedAnalytics.allocation.Cash.percent;
  const commandInsights: CommandInsightCard[] = [
    {
      label: scopedAnalytics.scopeKind === "portfolio" ? "Goal Readiness" : "Scope Readiness",
      value: goalFundedPercent === undefined ? "Map goals" : goalFundedPercent.toFixed(1) + "%",
      detail: scopedAnalytics.scopeKind === "portfolio" ? "Combined mapped corpus versus corpus needed today." : "Mapped value versus this goal's corpus needed today.",
      tone: goalFundedPercent === undefined ? "neutral" : goalFundedPercent >= 100 ? "good" : goalFundedPercent >= 75 ? "info" : "warn",
      progress: goalFundedPercent === undefined ? undefined : goalFundedPercent,
      footnote: scopedAnalytics.scopeKind === "portfolio" ? String(goalProgress.length) + " goal(s)" : scopedAnalytics.label
    },
    {
      label: "Valuation Quality",
      value: timeline.coverage.totalDates === 0 ? "No history" : valuationCoveragePercent.toFixed(0) + "%",
      detail: timeline.coverage.totalDates === 0 ? "Import dated records to build valuation coverage." : String(timeline.coverage.pricedDates) + "/" + String(timeline.coverage.totalDates) + " complete historical valuation dates.",
      tone: valuationCoveragePercent >= 90 ? "good" : valuationCoveragePercent >= 60 ? "info" : "warn",
      progress: valuationCoveragePercent,
      footnote: totalFxIssues === 0 ? "FX/NAV covered" : String(totalFxIssues) + " market-data gap(s)"
    },
    {
      label: "Concentration",
      value: topFivePercent.toFixed(1) + "%",
      detail: "Top five holdings share of the selected scope.",
      tone: topFivePercent > 70 ? "warn" : topFivePercent > 50 ? "info" : "good",
      progress: topFivePercent,
      footnote: largestHolding ? "Largest: " + displayHoldingName(largestHolding.label) : "No holdings"
    },
    {
      label: "Return Engine",
      value: scopedAnalytics.xirrLabel,
      detail: scopedPerformance.absoluteReturnPercent === null ? "XIRR needs dated cash flows." : scopedPerformance.absoluteReturnPercent.toFixed(1) + "% simple return, timing shown as XIRR.",
      tone: scopedAnalytics.xirrLabel === "-" ? "neutral" : scopedPerformance.totalProfit >= 0 ? "good" : "warn",
      progress: scopedPerformance.absoluteReturnPercent === null ? undefined : Math.min(100, Math.max(0, scopedPerformance.absoluteReturnPercent)),
      footnote: String(xirrCoverageCount) + "/" + String(scopedAnalytics.holdings.length) + " holdings with XIRR"
    },
    {
      label: "Allocation Balance",
      value: equityPercent.toFixed(0) + "/" + debtPercent.toFixed(0),
      detail: "Equity/Debt split with cash at " + cashPercent.toFixed(1) + "%.",
      tone: reviewCategoryCount > 0 ? "warn" : "info",
      progress: equityPercent,
      footnote: reviewCategoryCount === 0 ? "Classified cleanly" : String(reviewCategoryCount) + " Others to review"
    }
  ];

  const dashboardSignals: DashboardSignal[] = [
    {
      label: "Market Data",
      value: totalFxIssues === 0 ? "Covered" : totalFxIssues + " gap(s)",
      detail: totalFxIssues === 0 ? "NAV, quotes, and FX are usable for INR analytics." : "Refresh or add real FX/NAV data before trusting INR totals.",
      tone: totalFxIssues === 0 ? "good" : "warn",
      icon: totalFxIssues === 0 ? "shield" : "alert"
    },
    {
      label: "Freshness",
      value: staleHoldings === 0 ? "Current" : staleHoldings + " stale",
      detail: staleHoldings === 0 ? "All holdings are within the freshness window." : "Some valuations are older than 7 days.",
      tone: staleHoldings === 0 ? "good" : "warn",
      icon: staleHoldings === 0 ? "shield" : "alert"
    },
    {
      label: "Concentration",
      value: topFivePercent.toFixed(1) + "%",
      detail: scopedAnalytics.scopeKind === "portfolio" ? "Portfolio value held by the five largest positions." : "Scoped goal value held by the five largest mapped positions.",
      tone: topFivePercent > 60 ? "warn" : "neutral",
      icon: "trend"
    },
    {
      label: "Classification",
      value: reviewCategoryCount === 0 ? "Clean" : reviewCategoryCount + " review",
      detail: reviewCategoryCount === 0 ? "No scoped holdings are parked in Others." : "Others is visible so hybrid/custom records can be reviewed.",
      tone: reviewCategoryCount === 0 ? "good" : "warn",
      icon: reviewCategoryCount === 0 ? "shield" : "alert"
    }
  ];
  const categoryTimelineKeys = categoryOrder.filter((category) => timeline.points.some((point) => (point.category[category] ?? 0) > 0));
  const regionTimelineKeys = topTimelineKeys(timeline.points, "region", 5);
  const assetKindTimelineKeys = topTimelineKeys(timeline.points, "assetKind", 6);
  const issuerTimelineKeys = topTimelineKeys(timeline.points, "issuer", 5);

  async function importCsv() {
    const importId = `manual_${Date.now()}`;
    const result = commitManualCsvImport(backup, csv, { importId, fileName: "manual-template.csv", label: importLabel.trim() || "Manual balance CSV" });
    setBackup(result.backup);
    setErrors(result.errors.map((error) => `Row ${error.row}: ${error.message}`));
    const message = `Manual CSV committed: ${result.addedBalances} holding(s), ${result.addedTransactions} transaction(s), ${result.addedPrices} price row(s); ${result.skippedDuplicates} duplicate(s) skipped.`;
    if (result.errors.length === 0 && shouldRefreshAfterImport(result.backup, result.addedTransactions)) {
      await refreshMarketDataFor(result.backup, message);
    } else {
      setStatus(message);
    }
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify({ ...backup, exportedAt: new Date().toISOString() }, null, 2)], {
      type: "application/json"
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "portfolio-tracker-backup-v1.json";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function restoreBackup(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = parseBackup(JSON.parse(await file.text()));
      setBackup(parsed);
      setErrors([]);
      setStatus(`Restored ${parsed.manualBalances.length} balance record(s) from backup exactly as exported. Press Refresh to update live NAV, quotes, and FX.`);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Invalid backup file"]);
    }
  }

  async function inspectNativeFile(fileList: FileList | File[] | undefined) {
    const files = Array.from(fileList ?? []);
    const file = files[0];
    if (!file) return;
    setNativeFiles(files);
    setCasParse(null);
    setStagedCas(null);
    setIndParse(null);
    setStagedInd(null);
    setEpfoParse(null);
    setStagedEpfo(null);
    setNpsParse(null);
    setStagedNps(null);
    const lowerName = file.name.toLowerCase();
    const canReadText = lowerName.endsWith(".csv") || lowerName.endsWith(".json") || lowerName.endsWith(".html") || lowerName.endsWith(".txt");
    const textSample = canReadText ? (await file.text()).slice(0, 20000) : "";
    const detection = detectImportSource({ fileName: file.name, mimeType: file.type, textSample });
    setNativeDetection(detection);

    if (detection.providerId === "canonical_json") {
      setStatus(`${detection.label}: restore the backup in browser.`);
    } else if (detection.providerId === "cas_pdf") {
      setStatus(`${detection.label}: enter the PDF password and parse in browser.`);
    } else if (detection.providerId === "manual_csv" && detection.nativeInputType === "csv") {
      setStatus(`${detection.label}: parse the manual CSV in browser.`);
    } else if (detection.providerId === "indmoney_export") {
      setStatus(`${detection.label}: parse the XLSX ledger in browser.`);
    } else if (detection.providerId === "epfo_passbook") {
      setStatus(`${detection.label}: parse ${files.length > 1 ? files.length + " PF PDFs" : "the PF PDF"} in browser.`);
    } else if (detection.providerId === "nps_statement" && detection.nativeInputType === "csv") {
      setStatus(`${detection.label}: parse ${files.length > 1 ? files.length + " NPS CSVs" : "the NPS CSV"} in browser.`);
    } else if (detection.providerId === "nps_statement") {
      setStatus(`${detection.label}: detected, but only the verified CSV statement parser is implemented.`);
    } else if (detection.providerId === "manual_csv") {
      setStatus(`${detection.label}: use the manual transactions or balances CSV template.`);
    } else if (detection.status === "implemented") {
      setStatus(`${detection.label}: implemented import path detected.`);
    } else {
      setStatus(`${detection.label}: native file detected, parser not implemented yet.`);
    }
  }

  async function restoreNativeBackup() {
    const nativeFile = nativeFiles[0];
    if (!nativeFile) {
      setErrors(["Select a JSON backup first."]);
      return;
    }
    await restoreBackup(nativeFile);
  }

  async function parseManualNativeInBrowser() {
    const nativeFile = nativeFiles[0];
    if (!nativeFile) {
      setErrors(["Select a manual CSV first."]);
      return;
    }
    setErrors([]);
    if (!nativeFile.name.toLowerCase().endsWith(".csv")) {
      setErrors(["Manual imports use CSV templates: manual-transactions-template.csv or manual-balances-template.csv."]);
      setStatus("Manual portfolio import needs a CSV file.");
      return;
    }
    setStatus("Parsing manual portfolio CSV in browser...");

    try {
      const importId = "manual_" + Date.now();
      const result = commitManualCsvImport(backup, await nativeFile.text(), { importId, fileName: nativeFile.name, label: importLabel.trim() || nativeFile.name });
      setBackup(result.backup);
      setErrors(result.errors.map((error) => "Row " + error.row + ": " + error.message));
      const message = "Manual CSV committed: " + result.addedBalances + " holding(s), " + result.addedTransactions + " transaction(s), " + result.addedPrices + " price row(s) added; " + result.skippedDuplicates + " duplicate(s) skipped.";
      if (result.errors.length === 0 && shouldRefreshAfterImport(result.backup, result.addedTransactions)) {
        await refreshMarketDataFor(result.backup, message);
      } else {
        setStatus(message);
      }
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Unable to parse manual portfolio file"]);
      setStatus("Manual portfolio import failed.");
    }
  }

  async function parseCasPdfInBrowser() {
    const nativeFile = nativeFiles[0];
    if (!nativeFile) {
      setErrors(["Select a CAS PDF first."]);
      return;
    }
    setErrors([]);
    setStatus("Extracting CAS PDF text in browser...");

    try {
      const text = await extractPdfTextInBrowser(nativeFile, casPassword || undefined);
      const parsed = parseCasText(text);
      const imported = buildCanonicalCasImport(parsed, {
        importId: `cas_${Date.now()}`,
        fileName: nativeFile.name
      });
      setCasParse(parsed);
      setStagedCas(imported);

      if (parsed.errors.length > 0) {
        setErrors(parsed.errors);
        setStatus(`CAS parsed with ${parsed.errors.length} error(s).`);
      } else {
        setStatus(`CAS staged: ${parsed.schemes.length} schemes, ${imported.transactions.length} transactions, ${imported.manualBalances.length} balances.`);
      }
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Unable to parse CAS PDF"]);
      setStatus("CAS PDF import failed.");
    }
  }

  async function parseIndMoneyXlsxInBrowser() {
    const nativeFile = nativeFiles[0];
    if (!nativeFile) {
      setErrors(["Select an INDMoney XLSX first."]);
      return;
    }
    setErrors([]);
    setStatus("Parsing INDMoney XLSX in browser...");

    try {
      const parsed = await parseIndMoneyWorkbook(nativeFile);
      const imported = buildCanonicalIndMoneyImport(parsed, {
        importId: `indmoney_${Date.now()}`,
        fileName: nativeFile.name
      });
      setIndParse(parsed);
      setStagedInd(imported);
      setErrors([...parsed.errors, ...parsed.warnings]);
      if (parsed.errors.length > 0) {
        setStatus(`INDMoney parsed with ${parsed.errors.length} error(s).`);
      } else {
        setStatus(`INDMoney staged: ${parsed.canonicalRows.length} rows, ${parsed.positions.length} open positions, ${imported.transactions.length} transactions.`);
      }
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Unable to parse INDMoney XLSX"]);
      setStatus("INDMoney XLSX import failed.");
    }
  }

  async function parseEpfoPdfInBrowser() {
    const files = nativeFiles.filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    if (files.length === 0) {
      setErrors(["Select one or more PF PDF files first."]);
      return;
    }
    setErrors([]);
    setStatus("Extracting " + files.length + " PF PDF file(s) in browser...");

    try {
      const parsedFiles: EpfoPassbookParseResult[] = [];
      const stagedFiles: EpfoCanonicalImport[] = [];
      for (const [index, file] of files.entries()) {
        const text = await extractPdfTextInBrowser(file);
        const parsed = parseEpfoPassbookText(text);
        const imported = buildCanonicalEpfoImport(parsed, {
          importId: `epfo_${Date.now()}_${index}`,
          fileName: file.name
        });
        parsedFiles.push(parsed);
        stagedFiles.push(imported);
      }
      setEpfoParse(parsedFiles);
      setStagedEpfo(stagedFiles);
      const allErrors = parsedFiles.flatMap((parsed) => [...parsed.errors, ...parsed.warnings]);
      setErrors(allErrors);
      const latestDate = latestAsOfDate(parsedFiles.map((parsed) => parsed.asOfDate));
      const transactionCount = stagedFiles.reduce((sum, imported) => sum + imported.transactions.length, 0);
      setStatus(allErrors.some(Boolean) && parsedFiles.some((parsed) => parsed.errors.length > 0) ? `PF parsed with errors across ${files.length} file(s).` : `PF staged: ${files.length} file(s), ${transactionCount} transactions, latest closing ${latestDate}.`);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Unable to parse PF PDF"]);
      setStatus("PF PDF import failed.");
    }
  }

  async function parseNpsCsvInBrowser() {
    const files = nativeFiles.filter((file) => file.type === "text/csv" || file.name.toLowerCase().endsWith(".csv"));
    if (files.length === 0) {
      setErrors(["Select one or more NPS CSV files first."]);
      return;
    }
    setErrors([]);
    setStatus("Parsing " + files.length + " NPS CSV file(s) in browser...");

    try {
      const parsedFiles: NpsParseResult[] = [];
      const stagedFiles: NpsCanonicalImport[] = [];
      for (const [index, file] of files.entries()) {
        const parsed = parseNpsCsv(await file.text());
        const imported = buildCanonicalNpsImport(parsed, {
          importId: `nps_${Date.now()}_${index}`,
          fileName: file.name
        });
        parsedFiles.push(parsed);
        stagedFiles.push(imported);
      }
      setNpsParse(parsedFiles);
      setStagedNps(stagedFiles);
      const allErrors = parsedFiles.flatMap((parsed) => [...parsed.errors, ...parsed.warnings]);
      setErrors(allErrors);
      const latestDate = latestAsOfDate(parsedFiles.map((parsed) => parsed.asOfDate));
      const transactionCount = stagedFiles.reduce((sum, imported) => sum + imported.transactions.length, 0);
      setStatus(parsedFiles.some((parsed) => parsed.errors.length > 0) ? `NPS parsed with errors across ${files.length} file(s).` : `NPS staged: ${files.length} file(s), ${transactionCount} transactions, latest holdings ${latestDate}.`);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Unable to parse NPS CSV"]);
      setStatus("NPS CSV import failed.");
    }
  }

  async function commitStagedCas() {
    if (!stagedCas) return;
    const next = applyCanonicalCasImport(backup, withImportLabel(stagedCas, importLabel.trim()));
    setBackup(next);
    setErrors([]);
    setStagedCas(null);
    await refreshMarketDataFor(next, `CAS committed: ${stagedCas.transactions.length} transactions and ${stagedCas.manualBalances.length} balances added.`);
  }

  async function commitStagedIndMoney() {
    if (!stagedInd) return;
    const next = applyCanonicalIndMoneyImport(backup, withImportLabel(stagedInd, importLabel.trim()));
    setBackup(next);
    setErrors([]);
    setStagedInd(null);
    await refreshMarketDataFor(next, `INDMoney committed: ${stagedInd.transactions.length} transactions and ${stagedInd.manualBalances.length} balances added.`);
  }

  function commitStagedEpfo() {
    if (!stagedEpfo || stagedEpfo.length === 0) return;
    const next = stagedEpfo.reduce((current, imported) => applyCanonicalEpfoImport(current, withImportLabel(imported, importLabel.trim())), backup);
    setBackup(next);
    setErrors([]);
    setStagedEpfo(null);
    const transactionCount = stagedEpfo.reduce((sum, imported) => sum + imported.transactions.length, 0);
    setStatus(`PF committed: ${stagedEpfo.length} file(s), ${transactionCount} transactions; latest closing balances retained.`);
  }

  function commitStagedNps() {
    if (!stagedNps || stagedNps.length === 0) return;
    const next = stagedNps.reduce((current, imported) => applyCanonicalNpsImport(current, withImportLabel(imported, importLabel.trim())), backup);
    setBackup(next);
    setErrors([]);
    setStagedNps(null);
    const transactionCount = stagedNps.reduce((sum, imported) => sum + imported.transactions.length, 0);
    setStatus(`NPS committed: ${stagedNps.length} file(s), ${transactionCount} transactions; latest scheme balances retained.`);
  }

  async function refreshMarketData() {
    await refreshMarketDataFor(backup);
  }

  async function refreshMarketDataFor(portfolio: PortfolioBackup, prefix?: string) {
    const isins = portfolio.instruments.map((instrument) => instrument.isin).filter((isin): isin is string => Boolean(isin));
    const symbols = portfolio.instruments
      .filter((instrument) => instrument.type === "us_stock" && instrument.symbol)
      .map((instrument) => instrument.symbol as string);
    const indianSymbols = portfolio.instruments
      .filter((instrument) => instrument.type === "indian_stock" && instrument.symbol)
      .map((instrument) => instrument.symbol as string);
    const fxDates = [
      ...portfolio.transactions.filter((tx) => tx.currency === "USD").map((tx) => tx.date),
      ...portfolio.manualBalances.filter((balance) => balance.currency === "USD").map((balance) => balance.asOfDate)
    ].filter(Boolean).sort();
    const historyDates = [
      ...portfolio.transactions.map((tx) => tx.date),
      ...portfolio.manualBalances.map((balance) => balance.asOfDate)
    ].filter(Boolean).sort();

    if (isins.length === 0 && symbols.length === 0 && indianSymbols.length === 0 && fxDates.length === 0) {
      setStatus(prefix ?? "No mutual fund ISINs, stock symbols, or USD cash flows available for market refresh.");
      return;
    }

    setStatus(prefix ? prefix + " Refreshing live and historical market data..." : "Refreshing live and historical market data...");
    setErrors([]);
    const params = new URLSearchParams();
    if (isins.length > 0) params.set("isins", [...new Set(isins)].join(","));
    if (symbols.length > 0) params.set("symbols", [...new Set(symbols)].join(","));
    if (indianSymbols.length > 0) params.set("indianSymbols", [...new Set(indianSymbols)].join(","));
    const today = new Date().toISOString().slice(0, 10);
    if (fxDates.length > 0) {
      params.set("fxStart", fxDates[0]);
      params.set("fxEnd", today);
    }
    if (historyDates.length > 0 && (isins.length > 0 || symbols.length > 0 || indianSymbols.length > 0)) {
      params.set("historyStart", historyDates[0]);
      params.set("historyEnd", today);
    }

    try {
      const response = await fetch("/api/market-data?" + params.toString());
      const payload = (await response.json()) as MarketDataPayload;
      const refreshed = applyMarketDataPayload(portfolio, payload);
      const updatedValuations = countChangedCurrentValuations(portfolio, refreshed);
      setBackup(refreshed);
      setErrors(payload.errors);
      setStatus(
        (prefix ? prefix + " " : "") +
          `Market refresh complete: ${payload.navs.length} NAV snapshot(s), ${payload.stocks.length} stock price snapshot(s), ${(payload.fxs?.length ?? 0) + (payload.fx ? 1 : 0)} USD/INR rate(s), ${updatedValuations} holding valuation(s) updated.`
      );
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Market refresh failed"]);
      setStatus(prefix ? prefix + " Market refresh failed." : "Market refresh failed.");
    }
  }

  function applyManualFxRate() {
    try {
      const snapshot = buildUsdInrSnapshot(Number(fxRate), fxDate, "manual_fx");
      setBackup((current) => ({
        ...current,
        exportedAt: new Date().toISOString(),
        priceSnapshots: mergePriceSnapshots(current.priceSnapshots, [snapshot])
      }));
      setErrors([]);
      setStatus(`USD/INR rate added for ${snapshot.asOfDate}.`);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Invalid USD/INR rate"]);
    }
  }

  function importFxCsvText() {
    const parsed = parseUsdInrFxCsv(fxCsv);
    if (parsed.snapshots.length > 0) {
      setBackup((current) => ({
        ...current,
        exportedAt: new Date().toISOString(),
        priceSnapshots: mergePriceSnapshots(current.priceSnapshots, parsed.snapshots)
      }));
    }
    setErrors(parsed.errors);
    setStatus(`Imported ${parsed.snapshots.length} USD/INR rate(s) from CSV.`);
  }

  async function importFxCsvFile(file: File | undefined) {
    if (!file) return;
    const parsed = parseUsdInrFxCsv(await file.text());
    if (parsed.snapshots.length > 0) {
      setBackup((current) => ({
        ...current,
        exportedAt: new Date().toISOString(),
        priceSnapshots: mergePriceSnapshots(current.priceSnapshots, parsed.snapshots)
      }));
    }
    setErrors(parsed.errors);
    setStatus(`Imported ${parsed.snapshots.length} USD/INR rate(s) from ${file.name}.`);
  }

  function updateTaxProfileFromForm(patch: Partial<TaxProfile>) {
    setBackup((current) => updateTaxProfile(current, patch));
    setStatus("Tax profile updated locally. Export JSON to preserve the tax settings.");
  }

  function resetPortfolio() {
    setBackup(createEmptyBackup("INR"));
    setErrors([]);
    setStatus("Portfolio reset locally.");
  }

  function updateBalance(balanceId: string, patch: Partial<ManualBalance>) {
    const now = new Date().toISOString();
    const taperOnlyEdit = Object.keys(patch).every((key) => key === "taperMode" || key === "taperFactor");
    setBackup((current) => {
      const editedBalance = current.manualBalances.find((balance) => balance.id === balanceId);
      return {
        ...current,
        exportedAt: now,
        manualBalances: current.manualBalances.map((balance) => balance.id === balanceId ? { ...balance, ...patch, userModified: taperOnlyEdit ? balance.userModified : true, updatedAt: now } : balance),
        instruments: current.instruments.map((instrument) => editedBalance?.instrumentId === instrument.id && patch.category ? { ...instrument, category: patch.category, updatedAt: now } : instrument)
      };
    });
    setStatus("Holding edit saved locally. Export backup to preserve browser edits outside this device.");
  }

  function shouldRefreshAfterImport(portfolio: PortfolioBackup, addedTransactions: number): boolean {
    return addedTransactions > 0 || portfolio.manualBalances.some((balance) => balance.currency !== portfolio.baseCurrency);
  }


  function countChangedCurrentValuations(before: PortfolioBackup, after: PortfolioBackup): number {
    const beforeById = new Map(before.manualBalances.map((balance) => [balance.id, balance]));
    return after.manualBalances.filter((balance) => {
      const previous = beforeById.get(balance.id);
      return previous && (previous.value !== balance.value || previous.price !== balance.price || previous.asOfDate !== balance.asOfDate || previous.currency !== balance.currency);
    }).length;
  }

  function withImportLabel<T extends { importRun: { label?: string; fileName?: string } }>(imported: T, label: string): T {
    if (!label) return imported;
    return { ...imported, importRun: { ...imported.importRun, label } };
  }

  function deleteImport(importId: string) {
    setBackup((current) => deleteImportRunFromBackup(current, importId));
    setStatus("Import deleted locally. Export backup to preserve this deletion outside this device.");
  }

  function deleteTransaction(transactionId: string) {
    setBackup((current) => deleteTransactionFromBackup(current, transactionId));
    setStatus("Transaction deleted locally. Add Entry holdings are reconciled when applicable.");
  }

  function updateTransaction(transactionId: string, patch: Partial<Transaction>) {
    const now = new Date().toISOString();
    setBackup((current) => ({
      ...current,
      exportedAt: now,
      transactions: current.transactions.map((tx) => tx.id === transactionId ? { ...tx, ...patch, userModified: true, updatedAt: now } : tx)
    }));
    setStatus("Transaction edit saved locally. Export backup to preserve browser edits outside this device.");
  }

  async function addManualEntryFromForm() {
    const balance = backup.manualBalances.find((item) => item.id === entryHoldingId) ?? backup.manualBalances[0];
    if (!balance) {
      setErrors(["Import or create a holding before adding an entry."]);
      return;
    }
    const account = backup.accounts.find((item) => item.id === balance.accountId);
    const action = account ? manualEntryActionsForAccount(account.type).find((item) => item.id === entryActionId) ?? manualEntryActionsForAccount(account.type)[0] : undefined;
    if (!action) {
      setErrors(["Selected holding does not support manual entries."]);
      return;
    }

    try {
      const result = applyManualEntry(backup, {
        balanceId: balance.id,
        actionId: action.id,
        date: entryDate,
        amount: parseOptionalNumber(entryAmount),
        quantity: parseOptionalNumber(entryQuantity),
        price: parseOptionalNumber(entryPrice),
        fees: parseOptionalNumber(entryFees),
        taxes: parseOptionalNumber(entryTaxes),
        currentValue: parseOptionalNumber(entryCurrentValue),
        investedAmount: parseOptionalNumber(entryInvestedAmount),
        notes: entryNotes
      });
      setBackup(result.backup);
      setErrors([]);
      setEntryAmount("");
      setEntryQuantity("");
      setEntryFees("0");
      setEntryTaxes("0");
      setEntryCurrentValue("");
      setEntryInvestedAmount("");
      setEntryNotes("");
      const message = "Added " + result.action.label + " for " + displayHoldingName(result.balance.label) + ".";
      if (shouldRefreshAfterImport(result.backup, result.transaction ? 1 : 0)) {
        await refreshMarketDataFor(result.backup, message);
      } else {
        setStatus(message);
      }
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Unable to add entry"]);
    }
  }

  function addGoalFromForm() {
    try {
      const now = new Date().toISOString();
      const goal = buildGoal({
        name: goalName,
        type: goalType,
        currentMonthlyExpense: parseFormNumber(goalMonthlyExpense, 0),
        inflationRate: parseFormNumber(goalInflation, 0),
        targetYear: parseFormNumber(goalTargetYear, new Date().getFullYear()),
        corpusMultiple: parseFormNumber(goalMultiplier, 1),
        currency: backup.baseCurrency,
        expectedReturn: parseFormNumber(goalEquityReturn, 10),
        equityReturn: parseFormNumber(goalEquityReturn, 10),
        debtReturn: parseFormNumber(goalDebtReturn, 6),
        goldReturn: parseFormNumber(goalGoldReturn, 6),
        cashReturn: parseFormNumber(goalCashReturn, 6),
        otherReturn: parseFormNumber(goalOtherReturn, 6)
      }, now);
      setBackup((current) => ({ ...current, exportedAt: now, goals: [...current.goals, goal] }));
      setSelectedGoalId(goal.id);
      setMappingGoalId(goal.id);
      setErrors([]);
      setStatus("Goal added locally. Export JSON to preserve the full goal plan and mappings.");
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Unable to add goal"]);
    }
  }

  function updateGoalRecord(goalId: string, patch: Partial<Goal>) {
    const now = new Date().toISOString();
    setBackup((current) => ({
      ...current,
      exportedAt: now,
      goals: current.goals.map((goal) => {
        if (goal.id !== goalId) return goal;
        const next = { ...goal, ...patch, updatedAt: now };
        if (typeof next.name === "string" && next.name.trim().length === 0) next.name = "Goal";
        return recalculateGoalTarget(next);
      })
    }));
    setStatus("Goal updated locally. Export JSON to preserve this plan outside the browser.");
  }

  function deleteGoalRecord(goalId: string) {
    const now = new Date().toISOString();
    setBackup((current) => ({
      ...current,
      exportedAt: now,
      goals: current.goals.filter((goal) => goal.id !== goalId),
      goalMappings: current.goalMappings.filter((mapping) => mapping.goalId !== goalId)
    }));
    setSelectedGoalId((current) => current === goalId ? "" : current);
    setMappingGoalId((current) => current === goalId ? "" : current);
    setStatus("Goal and its asset mappings deleted locally.");
  }

  function upsertGoalMappingFromForm() {
    const goalId = mappingGoalId || selectedGoalId || backup.goals[0]?.id;
    const balanceId = mappingBalanceId || backup.manualBalances[0]?.id;
    if (!goalId || !balanceId) {
      setErrors(["Create a goal and import at least one asset before mapping."]);
      return;
    }
    const percent = parseFormNumber(mappingPercent, 100);
    const now = new Date().toISOString();
    setBackup((current) => {
      const existing = current.goalMappings.find((mapping) => mapping.goalId === goalId && mapping.manualBalanceId === balanceId);
      return {
        ...current,
        exportedAt: now,
        goalMappings: existing
          ? current.goalMappings.map((mapping) => mapping.id === existing.id ? { ...mapping, percent: clampGoalPercent(percent), updatedAt: now } : mapping)
          : [...current.goalMappings, createGoalMapping(goalId, balanceId, percent, now)]
      };
    });
    setErrors([]);
    setStatus("Asset mapped to goal locally. Export JSON to preserve mappings.");
  }

  function deleteGoalMapping(mappingId: string) {
    const now = new Date().toISOString();
    setBackup((current) => ({
      ...current,
      exportedAt: now,
      goalMappings: current.goalMappings.filter((mapping) => mapping.id !== mappingId)
    }));
    setStatus("Goal mapping deleted locally.");
  }

  function applyGoalPreset(name: string, type: Goal["type"], multiple: number) {
    setGoalName(name);
    setGoalType(type);
    setGoalMultiplier(String(multiple));
  }

  function takePortfolioSnapshot() {
    const snapshot = createPortfolioSnapshot(backup, { name: snapshotName, notes: snapshotNotes });
    setBackup((current) => ({
      ...current,
      exportedAt: new Date().toISOString(),
      snapshots: [...current.snapshots, snapshot]
    }));
    setSelectedSnapshotId(snapshot.id);
    setSnapshotName("Snapshot " + new Date().toISOString().slice(0, 10));
    setSnapshotNotes("");
    setErrors([]);
    setStatus("Snapshot captured locally. Export JSON to preserve the frozen analytics outside this browser.");
  }

  function deletePortfolioSnapshot(snapshotId: string) {
    setBackup((current) => ({
      ...current,
      exportedAt: new Date().toISOString(),
      snapshots: current.snapshots.filter((snapshot) => snapshot.id !== snapshotId)
    }));
    setSelectedSnapshotId((current) => current === snapshotId ? "" : current);
    setStatus("Snapshot deleted locally. Export JSON to preserve this deletion outside this browser.");
  }

  return (
    <div className="shell app-shell-v2">
      <aside className="sidebar">
        <div className="brand">Portfolio Tracker</div>
        <nav className="nav" aria-label="Primary">
          <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}><LayoutDashboard size={18} /> Analytics</button>
          <button className={view === "holdings" ? "active" : ""} onClick={() => setView("holdings")}><Table2 size={18} /> Holdings</button>
          <button className={view === "transactions" ? "active" : ""} onClick={() => setView("transactions")}><Pencil size={18} /> Transactions</button>
          <button className={view === "goals" ? "active" : ""} onClick={() => setView("goals")}><Target size={18} /> Goals</button>
          <button className={view === "tax" ? "active" : ""} onClick={() => setView("tax")}><ReceiptText size={18} /> Tax</button>
          <button className={view === "snapshots" ? "active" : ""} onClick={() => setView("snapshots")}><Camera size={18} /> Snapshots</button>
          <button className={view === "add-entry" ? "active" : ""} onClick={() => setView("add-entry")}><PlusCircle size={18} /> Add Entry</button>
          <button className={view === "imports" ? "active" : ""} onClick={() => setView("imports")}><Upload size={18} /> Imports</button>
          <button className={view === "data" ? "active" : ""} onClick={() => setView("data")}><Database size={18} /> Data</button>
          <button className={view === "backup" ? "active" : ""} onClick={() => setView("backup")}><FileJson size={18} /> Backup</button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}><Settings size={18} /> Settings</button>
        </nav>
      </aside>

      <main className="main">
        <header className="header">
          <div>
            <h1>{viewTitle(view)}</h1>
            <p>{status}</p>
          </div>
          <div className="actions">
            <button onClick={refreshMarketData} title="Refresh live and historical NAV, quotes, and FX"><RefreshCw size={16} /> Refresh</button>
            <button onClick={exportBackup} title="Export canonical JSON backup"><Download size={16} /> Export</button>
            <button onClick={resetPortfolio} title="Reset local portfolio"><RotateCcw size={16} /> Reset</button>
          </div>
        </header>

        {errors.length > 0 && <div className="error-list global-errors">{errors.map((error) => <div key={error}>{error}</div>)}</div>}

        {view === "dashboard" && (
          <section className="analytics-command pro-analytics">
            <div className="command-hero analytics-hero-v3">
              <div className="hero-ledger">
                <span className="eyebrow">{scopedAnalytics.eyebrow}</span>
                <h2>{formatMoney(scopedPerformance.current, backup.baseCurrency)}</h2>
                <p>{scopedAnalytics.description}</p>
                <div className="hero-meta-row">
                  <span>{backup.baseCurrency} base</span>
                  <span>{scopedAnalytics.label}</span>
                  <span>{timeline.coverage.pricedDates}/{timeline.coverage.totalDates} complete valuation date(s)</span>
                  <span>{summary.missingFx.length === 0 ? "FX covered" : summary.missingFx.length + " FX pair gap(s)"}</span>
                </div>
              </div>
              <div className="hero-stack">
                <div className={"profit-tile " + (scopedPerformance.totalProfit >= 0 ? "positive" : "negative")}>
                  <span>Total Profit / Loss</span>
                  <strong>{scopedPerformance.profitKnown ? formatMoney(scopedPerformance.totalProfit, backup.baseCurrency) : "-"}</strong>
                  <small>{scopedPerformance.absoluteReturnPercent === null ? "Return unavailable" : scopedPerformance.absoluteReturnPercent.toFixed(2) + "% simple return"}</small>
                </div>
                <div className="xirr-tile">
                  <span>XIRR</span>
                  <strong>{scopedAnalytics.xirrLabel}</strong>
                  <small>{scopedAnalytics.xirrDetail}</small>
                </div>
              </div>
            </div>

            <AnalyticsScopeSelector scope={analyticsScope} setScope={setAnalyticsScope} goals={goalProgress} />

            <AnalyticsTabs active={analyticsTab} setActive={setAnalyticsTab} />

            {(summary.missingFx.length > 0 || insights.transactionStats.missingFx.length > 0) && (
              <div className="notice critical-notice">Missing FX/NAV inputs affect INR analytics: {[...new Set([...summary.missingFx, ...insights.transactionStats.missingFx])].join(", ")}. Refresh market data or import real rates under Imports.</div>
            )}

            {analyticsTab === "overview" && (
              <div className="analytics-tab-panel">
                <div className="wealth-strip main-wealth-strip">
                  <Metric label="Invested" value={formatMoney(scopedPerformance.netInvested, backup.baseCurrency)} />
                  <Metric label="Current Value" value={formatMoney(scopedPerformance.current, backup.baseCurrency)} />
                  <Metric label="Profit / Loss" value={scopedPerformance.profitKnown ? formatMoney(scopedPerformance.totalProfit, backup.baseCurrency) : "-"} />
                </div>
                <CommandInsightDeck cards={commandInsights} />
                <div className="feature-grid">
                  <ChartCard title="Current Allocation Explorer"><CurrentAllocationExplorer datasets={chartData} currency={backup.baseCurrency} /></ChartCard>
                  <div className="signal-panel cardless-panel">
                    <div className="panel-heading"><span>Portfolio Signals</span><strong>{dashboardSignals.filter((signal) => signal.tone === "warn").length} action(s)</strong></div>
                    <div className="signal-list">{dashboardSignals.map((signal) => <SignalCard signal={signal} key={signal.label} />)}</div>
                  </div>
                </div>
                <div className="sub-analytics-strip">
                  <MiniInsight label="Cost Basis" value={formatMoney(scopedPerformance.netInvested, backup.baseCurrency)} detail={scopedAnalytics.scopeKind === "portfolio" ? "same basis used for headline P/L" : "mapped goal cost basis"} />
                  <MiniInsight label="Required Today" value={scopedAnalytics.requiredToday === undefined ? "-" : formatMoney(scopedAnalytics.requiredToday, backup.baseCurrency)} detail={scopedAnalytics.requiredToday === undefined ? "portfolio scope" : "corpus needed today"} />
                  <MiniInsight label="Projected" value={scopedAnalytics.projected === undefined ? "-" : formatMoney(scopedAnalytics.projected, backup.baseCurrency)} detail={scopedAnalytics.projected === undefined ? "portfolio scope" : "at goal date"} />
                  <MiniInsight label={scopedAnalytics.scopeKind === "portfolio" ? "Fees & Taxes" : "Goal Gap"} value={scopedAnalytics.scopeKind === "portfolio" ? formatMoney(scopedPerformance.feesAndTax, backup.baseCurrency) : formatMoney(scopedAnalytics.goalGap ?? 0, backup.baseCurrency)} detail={scopedAnalytics.scopeKind === "portfolio" ? "recorded charges and tax fields" : "projected gap/surplus"} />
                </div>
              </div>
            )}

            {analyticsTab === "allocation" && (
              <div className="analytics-tab-panel">
                <div className="asset-class-grid asset-command-grid">
                  {assetClassSummary.map((asset) => (
                    <div className={"asset-class-card asset-" + asset.key} key={asset.key}>
                      <div><span>{asset.title}</span><strong>{formatMoney(asset.value, backup.baseCurrency)}</strong></div>
                      <small>{asset.count} holding(s) · {asset.percent.toFixed(1)}%</small>
                      <p>{asset.description}</p>
                    </div>
                  ))}
                </div>
                <div className="analytics-grid">
                  <ChartCard title="Allocation Map"><DonutChart data={chartData.allocation} currency={backup.baseCurrency} /></ChartCard>
                  <ChartCard title="By Asset Type"><HorizontalBar data={chartData.assetType} currency={backup.baseCurrency} /></ChartCard>
                  <ChartCard title="By Region"><HorizontalBar data={chartData.region} currency={backup.baseCurrency} /></ChartCard>
                  <ChartCard title="Top AMC / Issuer"><HorizontalBar data={chartData.issuer} currency={backup.baseCurrency} /></ChartCard>
                  <ChartCard title="Data Source Mix"><HorizontalBar data={chartData.provider} currency={backup.baseCurrency} /></ChartCard>
                </div>
              </div>
            )}

            {analyticsTab === "assets" && (
              <AssetClassesPanel insights={assetClassInsights} currency={backup.baseCurrency} scopeLabel={scopedAnalytics.label} />
            )}

            {analyticsTab === "history" && (
              <div className="analytics-tab-panel">
                {scopedAnalytics.scopeKind === "portfolio" ? (
                  <>
                    <div className="notice history-notice">Historical charts reconstruct month-end value from transactions plus available real NAV/quote/FX snapshots. Use them as a research view; current dashboard totals remain the source of truth when historical market coverage is incomplete.</div>
                    <div className="analytics-grid">
                      <ChartCard title="Portfolio Growth"><PortfolioGrowthChart points={timeline.points} currency={backup.baseCurrency} /></ChartCard>
                      <ChartCard title="Asset Class Growth"><BreakdownGrowthChart points={timeline.points} field="category" keys={categoryTimelineKeys} currency={backup.baseCurrency} /></ChartCard>
                      <ChartCard title="Region Growth"><BreakdownGrowthChart points={timeline.points} field="region" keys={regionTimelineKeys} currency={backup.baseCurrency} /></ChartCard>
                      <ChartCard title="Asset Type Growth"><BreakdownGrowthChart points={timeline.points} field="assetKind" keys={assetKindTimelineKeys} currency={backup.baseCurrency} /></ChartCard>
                      <ChartCard title="Issuer / AMC Growth"><BreakdownGrowthChart points={timeline.points} field="issuer" keys={issuerTimelineKeys} currency={backup.baseCurrency} /></ChartCard>
                      <ChartCard title="Institution Accounts"><HorizontalBar data={chartData.institution} currency={backup.baseCurrency} /></ChartCard>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="notice history-notice">Goal-scoped history needs dated snapshots because current goal mappings are not historical facts. Use Snapshots after each review cycle to build real goal history without market refresh.</div>
                    <div className="analytics-grid">
                      <ChartCard title="Snapshot Goal History"><SnapshotGoalHistoryChart points={snapshotHistory} currency={backup.baseCurrency} /></ChartCard>
                      <ChartCard title="Current Goal Allocation"><CurrentAllocationExplorer datasets={chartData} currency={backup.baseCurrency} /></ChartCard>
                    </div>
                  </>
                )}
              </div>
            )}

          </section>
        )}

        {view === "holdings" && (
          <section className="grid">
            <div className="card wide-card holdings-card">
              <div className="section-head">
                <div><h2>Holdings</h2><p>Search, sort, inspect cost/profit, and turn on edit mode to change every visible field inline.</p></div>
                <div className="toolbar">
                  <button className={holdingEditMode ? "primary" : ""} onClick={() => setHoldingEditMode(!holdingEditMode)}><Pencil size={15} /> {holdingEditMode ? "Done Editing" : "Edit Holdings"}</button>
                  <label className="search-box"><Search size={15} /><input value={holdingQuery} onChange={(event) => setHoldingQuery(event.target.value)} placeholder="Search holdings" /></label>
                  <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as AssetCategory | "All")}>
                    <option value="All">All categories</option>
                    {categoryOrder.map((category) => <option value={category} key={category}>{category}</option>)}
                  </select>
                  <select value={holdingSort} onChange={(event) => setHoldingSort(event.target.value as HoldingSort)}>
                    <option value="value">Sort by value</option>
                    <option value="gain">Sort by gain</option>
                    <option value="xirr">Sort by XIRR</option>
                    <option value="allocation">Sort by allocation</option>
                    <option value="name">Sort by name</option>
                    <option value="category">Sort by category</option>
                    <option value="source">Sort by source</option>
                  </select>
                </div>
              </div>
              {filteredHoldings.length === 0 ? <p className="message">No holdings match the current filters.</p> : (
                <>
                  <div className="holding-command-strip">
                    <MiniInsight label="Filtered Value" value={formatMoney(holdingPageAnalytics.totalValue, backup.baseCurrency)} detail={String(filteredHoldings.length) + " holding(s)"} />
                    <MiniInsight label="Filtered P/L" value={formatMoney(holdingPageAnalytics.totalProfit, backup.baseCurrency)} detail="current value minus net invested" />
                    <MiniInsight label="XIRR Coverage" value={String(holdingPageAnalytics.xirrRows.length) + "/" + String(filteredHoldings.length)} detail="holdings with usable cash-flow return" />
                    <MiniInsight label="Largest Weight" value={holdingPageAnalytics.topAllocation.toFixed(1) + "%"} detail="top visible holding allocation" />
                  </div>
                  <div className="holding-visual-grid">
                    <ChartCard title="Top Holdings"><RankingBar data={holdingPageAnalytics.valueChart} formatValue={(value) => formatMoney(value, backup.baseCurrency)} emptyMessage="No holding value yet." /></ChartCard>
                    <ChartCard title="Top Profit Contributors"><RankingBar data={holdingPageAnalytics.profitChart} formatValue={(value) => formatMoney(value, backup.baseCurrency)} emptyMessage="No positive profit contributors yet." tone="profit" /></ChartCard>
                    <ChartCard title="Top Holding XIRR"><RankingBar data={holdingPageAnalytics.xirrChart} formatValue={(value) => value.toFixed(2) + "%"} emptyMessage="No positive holding XIRR yet." tone="return" /></ChartCard>
                  </div>
                  <div className="holding-list pro-holding-list">
                    {filteredHoldings.map((holding) => (
                      holdingEditMode ?
                        <HoldingEditRow key={holding.id} balance={backup.manualBalances.find((balance) => balance.id === holding.id)!} updateBalance={updateBalance} /> :
                        <HoldingRow key={holding.id} holding={holding} baseCurrency={backup.baseCurrency} returns={holdingReturns.get(holding.id)} />
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        {view === "transactions" && (
          <section className="grid">
            <div className="card wide-card">
              <div className="section-head">
                <div><h2>Transactions</h2><p>Every imported transaction is searchable. Edit mode makes the latest matching rows directly editable.</p></div>
                <div className="toolbar">
                  <button className={transactionEditMode ? "primary" : ""} onClick={() => setTransactionEditMode(!transactionEditMode)}><Pencil size={15} /> {transactionEditMode ? "Done Editing" : "Edit Transactions"}</button>
                  <label className="search-box"><Search size={15} /><input value={transactionQuery} onChange={(event) => setTransactionQuery(event.target.value)} placeholder="Search transactions" /></label>
                </div>
              </div>
              <div className="transaction-list">
                {filteredTransactions.length === 0 ? <p className="message">No transactions match the current search.</p> : filteredTransactions.slice(0, 300).map((tx) => (
                  transactionEditMode ?
                    <TransactionEditRow key={tx.id} tx={tx} updateTransaction={updateTransaction} deleteTransaction={deleteTransaction} /> :
                    <TransactionRow key={tx.id} tx={tx} backup={backup} />
                ))}
              </div>
              {filteredTransactions.length > 300 && <p className="message">Showing latest 300 matching transactions. Narrow the search to inspect older rows.</p>}
            </div>
          </section>
        )}

        {view === "goals" && <GoalsView {...{ backup, goalProgress, goalSummary, selectedGoalId, setSelectedGoalId, mappingGoalId, setMappingGoalId, mappingBalanceId, setMappingBalanceId, mappingPercent, setMappingPercent, updateGoalRecord, deleteGoalRecord, upsertGoalMappingFromForm, deleteGoalMapping }} />}

        {view === "tax" && <TaxView report={taxReport} currency={backup.baseCurrency} financialYears={taxFinancialYears} selectedFinancialYear={taxFinancialYear} setSelectedFinancialYear={setTaxFinancialYear} />}

        {view === "snapshots" && <SnapshotsView {...{ backup, snapshotName, setSnapshotName, snapshotNotes, setSnapshotNotes, selectedSnapshotId, setSelectedSnapshotId, snapshotHistory, takePortfolioSnapshot, deletePortfolioSnapshot }} />}

        {view === "add-entry" && <AddEntryView {...{ backup, entryHoldingId, setEntryHoldingId, entryActionId, setEntryActionId, entryDate, setEntryDate, entryAmount, setEntryAmount, entryQuantity, setEntryQuantity, entryPrice, setEntryPrice, entryFees, setEntryFees, entryTaxes, setEntryTaxes, entryCurrentValue, setEntryCurrentValue, entryInvestedAmount, setEntryInvestedAmount, entryNotes, setEntryNotes, addManualEntryFromForm, goalName, setGoalName, goalType, setGoalType, goalMonthlyExpense, setGoalMonthlyExpense, goalInflation, setGoalInflation, goalTargetYear, setGoalTargetYear, goalMultiplier, setGoalMultiplier, goalEquityReturn, setGoalEquityReturn, goalDebtReturn, setGoalDebtReturn, goalGoldReturn, setGoalGoldReturn, goalCashReturn, setGoalCashReturn, goalOtherReturn, setGoalOtherReturn, addGoalFromForm, applyGoalPreset }} />}

        {view === "imports" && <ImportsView {...{ backup, csv, setCsv, importCsv, importLabel, setImportLabel, deleteImport, nativeDetection, nativeFileCount: nativeFiles.length, inspectNativeFile, casPassword, setCasPassword, parseCasPdfInBrowser, restoreNativeBackup, parseManualNativeInBrowser, parseIndMoneyXlsxInBrowser, parseEpfoPdfInBrowser, parseNpsCsvInBrowser, casParse, stagedCas, commitStagedCas, indParse, stagedInd, commitStagedIndMoney, epfoParse, stagedEpfo, commitStagedEpfo, npsParse, stagedNps, commitStagedNps, fxRate, setFxRate, fxDate, setFxDate, applyManualFxRate, importFxCsvFile, fxCsv, setFxCsv, importFxCsvText }} />}

        {view === "data" && <DataAuditView report={reconciliationReport} currency={backup.baseCurrency} />}

        {view === "settings" && <SettingsView profile={taxProfile} updateTaxProfile={updateTaxProfileFromForm} />}

        {view === "backup" && (
          <section className="grid two">
            <div className="card"><h2>Restore Canonical JSON</h2><input type="file" accept="application/json" onChange={(event) => restoreBackup(event.target.files?.[0])} /></div>
            <div className="card"><h2>Canonical Format</h2><p className="message">A single versioned JSON file restores accounts, balances, imports, goals, snapshots, prices, and source metadata.</p><pre>{JSON.stringify({ schemaVersion: backup.schemaVersion, baseCurrency: backup.baseCurrency, records: backup.manualBalances.length, goals: backup.goals.length, goalMappings: backup.goalMappings.length, snapshots: backup.snapshots.length }, null, 2)}</pre></div>
          </section>
        )}
      </main>
    </div>
  );
}



function SnapshotsView(props: {
  backup: PortfolioBackup;
  snapshotName: string;
  setSnapshotName: (value: string) => void;
  snapshotNotes: string;
  setSnapshotNotes: (value: string) => void;
  selectedSnapshotId: string;
  setSelectedSnapshotId: (value: string) => void;
  snapshotHistory: SnapshotTimelinePoint[];
  takePortfolioSnapshot: () => void;
  deletePortfolioSnapshot: (snapshotId: string) => void;
}) {
  const selectedSnapshot = props.backup.snapshots.find((snapshot) => snapshot.id === props.selectedSnapshotId) ?? props.backup.snapshots.at(-1);
  const selectedAnalytics = selectedSnapshot ? snapshotAnalytics(selectedSnapshot) : undefined;
  const latestPoint = props.snapshotHistory.at(-1);
  const categoryKeys = categoryOrder.filter((category) => props.snapshotHistory.some((point) => (point.category[category] ?? 0) > 0));
  const regionKeys = topSnapshotKeys(props.snapshotHistory, "region", 5);
  const assetKindKeys = topSnapshotKeys(props.snapshotHistory, "assetKind", 6);
  const issuerKeys = topSnapshotKeys(props.snapshotHistory, "issuer", 5);

  return (
    <section className="grid snapshot-section">
      <div className="snapshot-command-panel">
        <div className="snapshot-command-main">
          <span className="eyebrow">Frozen portfolio archive</span>
          <h2>Snapshots</h2>
          <p>Capture a full point-in-time portfolio state with the current canonical ledger, prices, goals, mappings, and computed analytics. Snapshot views use frozen JSON only and do not refresh NAV, quotes, or FX. To continue history across browsers or months, restore the latest exported JSON first, take the new snapshot, then export again.</p>
          <div className="snapshot-form-row">
            <label><span>Name</span><input value={props.snapshotName} onChange={(event) => props.setSnapshotName(event.target.value)} /></label>
            <label><span>Notes</span><input value={props.snapshotNotes} onChange={(event) => props.setSnapshotNotes(event.target.value)} placeholder="Optional snapshot context" /></label>
            <button className="primary" onClick={props.takePortfolioSnapshot}><Camera size={15} /> Take Snapshot</button>
          </div>
        </div>
        <div className="snapshot-command-metrics">
          <MiniInsight label="Snapshots" value={String(props.backup.snapshots.length)} detail="stored in JSON backup" />
          <MiniInsight label="Latest net worth" value={latestPoint ? formatMoney(latestPoint.netWorth, props.backup.baseCurrency) : "-"} detail={latestPoint?.asOfDate ?? "capture first snapshot"} />
          <MiniInsight label="Latest P/L" value={latestPoint ? formatMoney(latestPoint.profit, props.backup.baseCurrency) : "-"} detail="frozen performance" />
          <MiniInsight label="Goal readiness" value={latestPoint && latestPoint.goalRequiredToday > 0 ? ((latestPoint.goalMappedCurrent / latestPoint.goalRequiredToday) * 100).toFixed(1) + "%" : "-"} detail="mapped now vs needed today" />
        </div>
      </div>

      <div className="snapshot-history-grid">
        <ChartCard title="Snapshot History"><SnapshotPortfolioHistoryChart points={props.snapshotHistory} currency={props.backup.baseCurrency} /></ChartCard>
        <ChartCard title="Asset Class Timeline"><SnapshotBreakdownChart points={props.snapshotHistory} field="category" keys={categoryKeys} currency={props.backup.baseCurrency} /></ChartCard>
        <ChartCard title="Region Timeline"><SnapshotBreakdownChart points={props.snapshotHistory} field="region" keys={regionKeys} currency={props.backup.baseCurrency} /></ChartCard>
        <ChartCard title="Asset Type Timeline"><SnapshotBreakdownChart points={props.snapshotHistory} field="assetKind" keys={assetKindKeys} currency={props.backup.baseCurrency} /></ChartCard>
        <ChartCard title="Issuer / AMC Timeline"><SnapshotBreakdownChart points={props.snapshotHistory} field="issuer" keys={issuerKeys} currency={props.backup.baseCurrency} /></ChartCard>
        <ChartCard title="Goal Corpus Timeline"><SnapshotGoalHistoryChart points={props.snapshotHistory} currency={props.backup.baseCurrency} /></ChartCard>
      </div>

      <div className="snapshot-review-grid">
        <div className="card snapshot-list-card">
          <div className="section-head"><div><h2>Snapshot Library</h2><p>Select any saved snapshot to inspect frozen analytics exactly as captured.</p></div></div>
          {props.backup.snapshots.length === 0 ? <p className="message">No snapshots yet. Capture one after importing data and refreshing market data.</p> : (
            <div className="snapshot-list">
              {[...props.backup.snapshots].sort((a, b) => b.asOfDate.localeCompare(a.asOfDate) || b.createdAt.localeCompare(a.createdAt)).map((snapshot) => {
                const analytics = snapshotAnalytics(snapshot);
                const active = selectedSnapshot?.id === snapshot.id;
                return (
                  <div className={"snapshot-list-row" + (active ? " active" : "")} key={snapshot.id}>
                    <button onClick={() => props.setSelectedSnapshotId(snapshot.id)}>
                      <strong>{snapshot.name}</strong>
                      <span>{snapshot.asOfDate} · {analytics ? formatMoney(analytics.summary.netWorth, snapshot.baseCurrency) : "analytics unavailable"}</span>
                    </button>
                    <button className="danger-button" onClick={() => props.deletePortfolioSnapshot(snapshot.id)}>Delete</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <FrozenSnapshotReport snapshot={selectedSnapshot} analytics={selectedAnalytics} currency={props.backup.baseCurrency} />
      </div>
    </section>
  );
}

function FrozenSnapshotReport({ snapshot, analytics, currency }: { snapshot?: PortfolioBackup["snapshots"][number]; analytics?: SnapshotAnalytics; currency: string }) {
  if (!snapshot || !analytics) return <div className="card frozen-report-card"><h2>Frozen Report</h2><p className="message">Select or capture a snapshot to inspect frozen analytics.</p></div>;
  const topHoldings = analytics.holdings.slice(0, 8).map((row) => ({ name: row.holding.label, value: row.holding.valueInBase ?? 0 })).filter((row) => row.value > 0);
  const profitRows = analytics.holdings.map((row) => ({ name: row.holding.label, value: row.returns?.profit ?? 0 })).filter((row) => row.value > 0).sort((a, b) => b.value - a.value).slice(0, 8);
  return (
    <div className="card frozen-report-card">
      <div className="section-head">
        <div><h2>{snapshot.name}</h2><p>Frozen mode · {snapshot.asOfDate} · created {new Date(snapshot.createdAt).toLocaleString()}</p></div>
        <span className="snapshot-mode-pill">No market fetch</span>
      </div>
      {snapshot.notes && <p className="snapshot-note-text">{snapshot.notes}</p>}
      <div className="snapshot-report-metrics">
        <MiniInsight label="Net worth" value={formatMoney(analytics.summary.netWorth, currency)} detail="frozen current value" />
        <MiniInsight label="Invested" value={formatMoney(analytics.performance.netInvested, currency)} detail="frozen cost basis" />
        <MiniInsight label="Profit / Loss" value={analytics.performance.profitKnown ? formatMoney(analytics.performance.totalProfit, currency) : "-"} detail={analytics.performance.absoluteReturnPercent === null ? "return unavailable" : analytics.performance.absoluteReturnPercent.toFixed(1) + "% simple"} />
        <MiniInsight label="XIRR" value={analytics.insights.xirrBase === null ? "-" : analytics.insights.xirrBase.toFixed(2) + "%"} detail="frozen cash-flow return" />
        <MiniInsight label="Goals needed today" value={formatMoney(analytics.goalSummary.requiredCorpusToday, currency)} detail={analytics.goalSummary.goalCount + " goal(s)"} />
        <MiniInsight label="Projected goals" value={formatMoney(analytics.goalSummary.projectedValue, currency)} detail={analytics.goalSummary.projectedFundedPercent.toFixed(1) + "% funded"} />
      </div>
      <div className="snapshot-report-charts frozen-ranking-charts">
        <ChartCard title="Frozen Top Holdings"><RankingBar data={topHoldings} formatValue={(value) => formatMoney(value, currency)} emptyMessage="No holding value in this snapshot." /></ChartCard>
        <ChartCard title="Frozen Profit Contributors"><RankingBar data={profitRows} formatValue={(value) => formatMoney(value, currency)} emptyMessage="No positive profit in this snapshot." tone="profit" /></ChartCard>
      </div>
    </div>
  );
}

function GoalsView(props: {
  backup: PortfolioBackup;
  goalProgress: GoalProgress[];
  goalSummary: GoalSummary;
  selectedGoalId: string;
  setSelectedGoalId: (value: string) => void;
  mappingGoalId: string;
  setMappingGoalId: (value: string) => void;
  mappingBalanceId: string;
  setMappingBalanceId: (value: string) => void;
  mappingPercent: string;
  setMappingPercent: (value: string) => void;
  updateGoalRecord: (goalId: string, patch: Partial<Goal>) => void;
  deleteGoalRecord: (goalId: string) => void;
  upsertGoalMappingFromForm: () => void;
  deleteGoalMapping: (mappingId: string) => void;
}) {
  const selectedProgress = props.goalProgress.find((item) => item.goal.id === props.selectedGoalId) ?? props.goalProgress[0];
  const mappedRows = props.backup.goalMappings.flatMap((mapping) => {
    const goal = props.backup.goals.find((item) => item.id === mapping.goalId);
    const balance = props.backup.manualBalances.find((item) => item.id === mapping.manualBalanceId);
    const progress = props.goalProgress.find((item) => item.goal.id === mapping.goalId);
    const mappedHolding = progress?.mappedHoldings.find((item) => item.balance.id === mapping.manualBalanceId);
    if (!goal || !balance) return [];
    return [{ mapping, goal, balance, mappedHolding }];
  });
  const defaultMappingGoalId = props.mappingGoalId || props.selectedGoalId || props.backup.goals[0]?.id || "";
  const defaultMappingBalanceId = props.mappingBalanceId || props.backup.manualBalances[0]?.id || "";
  const selectedGoalValue = selectedProgress?.goal.id ?? "";

  return (
    <section className="grid goals-section">
      <div className="card wide-card goals-card">
        <div className="section-head">
          <div>
            <h2>Goals</h2>
            <p>Analyze goal readiness, mapped assets, projected corpus, and category mix. Create new goals from Add Entry so this workspace stays focused on goal analytics and mappings.</p>
          </div>
        </div>
        {props.goalProgress.length > 0 && selectedProgress && (
          <div className="goal-selector-panel">
            <label className="goal-selector-control">
              <span>Selected goal snapshot</span>
              <select value={selectedGoalValue} onChange={(event) => { props.setSelectedGoalId(event.target.value); props.setMappingGoalId(event.target.value); }}>
                {props.goalProgress.map((progress) => <option value={progress.goal.id} key={progress.goal.id}>{progress.goal.name}</option>)}
              </select>
            </label>
            <MiniInsight label="Needed today" value={formatMoney(selectedProgress.requiredCorpusToday, props.backup.baseCurrency)} detail="present corpus required" />
            <MiniInsight label="Mapped now" value={formatMoney(selectedProgress.mappedCurrentValue, props.backup.baseCurrency)} detail={selectedProgress.corpusTodayFundedPercent.toFixed(1) + "% funded today"} />
            <MiniInsight label="Projected" value={formatMoney(selectedProgress.projectedValue, props.backup.baseCurrency)} detail={selectedProgress.projectedFundedPercent.toFixed(1) + "% of future target"} />
          </div>
        )}
        <div className="goal-workspace goal-analysis-workspace">
          <div className="goal-focus-panel">
            <span className="eyebrow">Goal snapshot</span>
            {selectedProgress ? <GoalSnapshot progress={selectedProgress} backup={props.backup} currency={props.backup.baseCurrency} /> : <p className="message">Use Add Entry to create a goal, then map assets here to see funded status, projected corpus, and category split.</p>}
          </div>
        </div>
      </div>

      {props.goalProgress.length > 0 && <GoalCombinedPanel summary={props.goalSummary} progress={props.goalProgress} backup={props.backup} currency={props.backup.baseCurrency} />}

      {props.goalProgress.length > 0 && (
        <div className="goal-summary-grid">
          {props.goalProgress.map((progress) => <GoalCard key={progress.goal.id} progress={progress} currency={props.backup.baseCurrency} selected={selectedProgress?.goal.id === progress.goal.id} setSelectedGoalId={props.setSelectedGoalId} updateGoalRecord={props.updateGoalRecord} deleteGoalRecord={props.deleteGoalRecord} />)}
        </div>
      )}

      <div className="card wide-card goal-map-card">
        <div className="section-head">
          <div><h2>Map Assets to Goals</h2><p>Assign any imported or manually added holding to one or more goals. Percentages apply only to goal planning and do not change the portfolio ledger.</p></div>
          <button className="primary" disabled={props.backup.goals.length === 0 || props.backup.manualBalances.length === 0} onClick={props.upsertGoalMappingFromForm}>Save Mapping</button>
        </div>
        {props.backup.goals.length === 0 || props.backup.manualBalances.length === 0 ? <p className="message">Create a goal and import at least one asset before mapping.</p> : (
          <>
            <div className="goal-map-form">
              <label><span>Goal</span><select value={defaultMappingGoalId} onChange={(event) => { props.setMappingGoalId(event.target.value); props.setSelectedGoalId(event.target.value); }}>{props.backup.goals.map((goal) => <option value={goal.id} key={goal.id}>{goal.name}</option>)}</select></label>
              <label><span>Asset</span><select value={defaultMappingBalanceId} onChange={(event) => props.setMappingBalanceId(event.target.value)}>{props.backup.manualBalances.map((balance) => {
                const account = props.backup.accounts.find((item) => item.id === balance.accountId);
                return <option value={balance.id} key={balance.id}>{displayHoldingName(balance.label)} · {account ? assetTypeLabel(account.type) : "Asset"} · {balance.category}</option>;
              })}</select></label>
              <label><span>Mapped %</span><input type="number" step="1" min="0" max="100" value={props.mappingPercent} onChange={(event) => props.setMappingPercent(event.target.value)} /></label>
            </div>
            <div className="goal-mapping-list">
              {mappedRows.length === 0 ? <p className="message">No assets mapped yet.</p> : mappedRows.map(({ mapping, goal, balance, mappedHolding }) => (
                <div className="goal-mapping-row" key={mapping.id}>
                  <div className="goal-mapping-asset"><strong>{goal.name}</strong><span>{displayHoldingName(balance.label)} · {balance.category}</span></div>
                  <em>{mapping.percent.toFixed(1)}%</em>
                  <div className="goal-mapping-values"><strong>{formatMoney(mappedHolding?.value ?? 0, props.backup.baseCurrency)}</strong><span>{formatMoney(mappedHolding?.projectedValue ?? 0, props.backup.baseCurrency)} projected</span></div>
                  <button className="danger-button" onClick={() => props.deleteGoalMapping(mapping.id)}>Delete</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}


function GoalCombinedPanel({ summary, progress, backup, currency }: { summary: GoalSummary; progress: GoalProgress[]; backup: PortfolioBackup; currency: string }) {
  const mappedXirr = calculateMappedGoalXirr(backup, progress);
  return (
    <div className="goal-combined-panel">
      <div>
        <span className="eyebrow">Combined goals</span>
        <h2>{formatMoney(summary.targetCorpus, currency)}</h2>
        <p>{summary.goalCount} goal(s). Required today is the amount needed now, under each goal's mapped asset mix, to reach all target corpuses without further investment.</p>
      </div>
      <div className="goal-combined-metrics">
        <MiniInsight label="Needed today" value={formatMoney(summary.requiredCorpusToday, currency)} detail="present value of all targets" />
        <MiniInsight label="Mapped now" value={formatMoney(summary.mappedCurrentValue, currency)} detail={summary.corpusTodayFundedPercent.toFixed(1) + "% of needed today"} />
        <MiniInsight label="Projected" value={formatMoney(summary.projectedValue, currency)} detail={summary.projectedFundedPercent.toFixed(1) + "% of future target"} />
        <MiniInsight label="Today gap" value={formatMoney(summary.corpusTodayGap, currency)} detail={summary.corpusTodayGap <= 0 ? "ahead of required corpus" : "additional corpus needed now"} />
        <MiniInsight label="Mapped P/L" value={formatMoney(summary.mappedProfit, currency)} detail={summary.mappedReturnPercent === undefined ? "cost basis unavailable" : summary.mappedReturnPercent.toFixed(1) + "% simple"} />
        <MiniInsight label="XIRR" value={mappedXirr.xirr === null ? "-" : mappedXirr.xirr.toFixed(2) + "%"} detail={mappedXirr.basis === "portfolio" ? "portfolio-equivalent basis" : String(mappedXirr.cashFlowHoldings) + "/" + String(mappedXirr.mappedHoldings) + " mapped cash-flow holdings"} />
      </div>
      <GoalCategoryStack progressLike={summary} currency={currency} />
    </div>
  );
}

function GoalSnapshot({ progress, backup, currency }: { progress: GoalProgress; backup: PortfolioBackup; currency: string }) {
  const mappedXirr = calculateMappedGoalXirr(backup, [progress]);
  const todayWidth = Math.min(100, Math.max(0, progress.corpusTodayFundedPercent));
  const projectedWidth = Math.min(100, Math.max(0, progress.projectedFundedPercent));
  return (
    <div className="goal-snapshot">
      <h3>{progress.goal.name}</h3>
      <div className="goal-snapshot-value"><GoalTermLabel help={goalTermHelp.targetCorpus}>Target corpus</GoalTermLabel><strong>{formatMoney(progress.targetCorpus, currency)}</strong></div>
      <div className="goal-progress-line"><GoalTermLabel help={goalTermHelp.neededToday}>Corpus needed today</GoalTermLabel><strong>{formatMoney(progress.requiredCorpusToday, currency)}</strong></div>
      <div className="goal-progress-line"><GoalTermLabel help={goalTermHelp.mappedNow}>Mapped now</GoalTermLabel><strong>{formatMoney(progress.mappedCurrentValue, currency)}</strong></div>
      <div className="goal-progress-rail"><div style={{ width: todayWidth + "%" }} /></div>
      <div className="goal-progress-line"><GoalTermLabel help={goalTermHelp.projectedAtGoal}>Projected at goal</GoalTermLabel><strong>{formatMoney(progress.projectedValue, currency)}</strong></div>
      <div className="goal-progress-rail projected"><div style={{ width: projectedWidth + "%" }} /></div>
      <div className="goal-mini-grid">
        <MiniInsight label="Today readiness" value={progress.corpusTodayFundedPercent.toFixed(1) + "%"} detail={progress.corpusTodayGap <= 0 ? "no extra corpus needed now" : "versus needed today"} />
        <MiniInsight label="Projected" value={progress.projectedFundedPercent.toFixed(1) + "%"} detail="category return assumptions" />
        <MiniInsight label="First month" value={formatMoney(progress.startingMonthlyExpense, currency)} detail="inflated monthly expense" />
        <MiniInsight label="Today gap" value={formatMoney(progress.corpusTodayGap, currency)} detail="needed today minus mapped now" />
        <MiniInsight label="Mapped P/L" value={formatMoney(progress.mappedProfit, currency)} detail={progress.mappedReturnPercent === undefined ? "cost basis unavailable" : progress.mappedReturnPercent.toFixed(1) + "% simple"} />
        <MiniInsight label="XIRR" value={mappedXirr.xirr === null ? "-" : mappedXirr.xirr.toFixed(2) + "%"} detail={mappedXirr.basis === "portfolio" ? "portfolio-equivalent basis" : String(mappedXirr.cashFlowHoldings) + "/" + String(mappedXirr.mappedHoldings) + " mapped cash-flow holdings"} />
      </div>
    </div>
  );
}

function GoalCard({ progress, currency, selected, setSelectedGoalId, updateGoalRecord, deleteGoalRecord }: { progress: GoalProgress; currency: string; selected: boolean; setSelectedGoalId: (value: string) => void; updateGoalRecord: (goalId: string, patch: Partial<Goal>) => void; deleteGoalRecord: (goalId: string) => void }) {
  const goal = progress.goal;
  const targetYear = goal.targetDate.slice(0, 4);
  return (
    <div className={"goal-card" + (selected ? " selected" : "")} onClick={() => setSelectedGoalId(goal.id)}>
      <div className="goal-card-head">
        <div><input value={goal.name} onChange={(event) => updateGoalRecord(goal.id, { name: event.target.value })} onClick={(event) => event.stopPropagation()} /><span>{goal.type === "retirement" ? "Retirement" : "Custom"} · {targetYear} · {progress.yearsToGoal.toFixed(1)} years</span></div>
        <button className="danger-button" onClick={(event) => { event.stopPropagation(); deleteGoalRecord(goal.id); }}>Delete</button>
      </div>
      <div className="goal-card-metrics">
        <MiniInsight label="Target" value={formatMoney(progress.targetCorpus, currency)} detail="future corpus" />
        <MiniInsight label="Needed today" value={formatMoney(progress.requiredCorpusToday, currency)} detail="present corpus required" />
        <MiniInsight label="Mapped now" value={formatMoney(progress.mappedCurrentValue, currency)} detail={progress.corpusTodayFundedPercent.toFixed(1) + "% of today need"} />
        <MiniInsight label="Projected" value={formatMoney(progress.projectedValue, currency)} detail={progress.projectedFundedPercent.toFixed(1) + "% of target"} />
        <MiniInsight label="Invested" value={formatMoney(progress.mappedInvested, currency)} detail="mapped cost basis" />
        <MiniInsight label="P/L" value={formatMoney(progress.mappedProfit, currency)} detail={progress.mappedReturnPercent === undefined ? "cost basis unavailable" : progress.mappedReturnPercent.toFixed(1) + "% simple"} />
      </div>
      <div className="goal-edit-grid" onClick={(event) => event.stopPropagation()}>
        <label><span>Monthly expense</span><input type="number" value={goal.currentMonthlyExpense} onChange={(event) => updateGoalRecord(goal.id, { currentMonthlyExpense: Number(event.target.value) })} /></label>
        <label><span>Inflation %</span><input type="number" step="0.1" value={goal.inflationRate} onChange={(event) => updateGoalRecord(goal.id, { inflationRate: Number(event.target.value) })} /></label>
        <label><span>Target year</span><input type="number" value={targetYear} onChange={(event) => updateGoalRecord(goal.id, { targetDate: normalizeGoalYearInput(event.target.value) + "-01-01" })} /></label>
        <label><span>Multiple</span><input type="number" step="0.1" value={goal.corpusMultiple} onChange={(event) => updateGoalRecord(goal.id, { corpusMultiple: Number(event.target.value) })} /></label>
      </div>
      <GoalCategoryStack progressLike={progress} currency={currency} />
    </div>
  );
}

function GoalCategoryStack({ progressLike, currency }: { progressLike: Pick<GoalProgress, "mappedCurrentValue" | "categoryValues"> | Pick<GoalSummary, "mappedCurrentValue" | "categoryValues">; currency: string }) {
  const total = progressLike.mappedCurrentValue;
  return (
    <div className="goal-category-block">
      <div className="goal-category-stack" aria-label="Mapped category split">
        {categoryOrder.map((category, index) => {
          const value = progressLike.categoryValues[category];
          const width = total <= 0 ? 0 : (value / total) * 100;
          return value > 0 ? <span key={category} title={category + " · " + formatMoney(value, currency)} style={{ width: width + "%", background: chartColors[index % chartColors.length] }} /> : null;
        })}
      </div>
      <div className="goal-category-list">
        {categoryOrder.filter((category) => progressLike.categoryValues[category] > 0).map((category, index) => <span key={category}><i style={{ background: chartColors[index % chartColors.length] }} />{category} {formatMoney(progressLike.categoryValues[category], currency)}</span>)}
      </div>
    </div>
  );
}

function AddEntryView(props: {
  backup: PortfolioBackup;
  entryHoldingId: string;
  setEntryHoldingId: (value: string) => void;
  entryActionId: string;
  setEntryActionId: (value: string) => void;
  entryDate: string;
  setEntryDate: (value: string) => void;
  entryAmount: string;
  setEntryAmount: (value: string) => void;
  entryQuantity: string;
  setEntryQuantity: (value: string) => void;
  entryPrice: string;
  setEntryPrice: (value: string) => void;
  entryFees: string;
  setEntryFees: (value: string) => void;
  entryTaxes: string;
  setEntryTaxes: (value: string) => void;
  entryCurrentValue: string;
  setEntryCurrentValue: (value: string) => void;
  entryInvestedAmount: string;
  setEntryInvestedAmount: (value: string) => void;
  entryNotes: string;
  setEntryNotes: (value: string) => void;
  addManualEntryFromForm: () => void;
  goalName: string;
  setGoalName: (value: string) => void;
  goalType: Goal["type"];
  setGoalType: (value: Goal["type"]) => void;
  goalMonthlyExpense: string;
  setGoalMonthlyExpense: (value: string) => void;
  goalInflation: string;
  setGoalInflation: (value: string) => void;
  goalTargetYear: string;
  setGoalTargetYear: (value: string) => void;
  goalMultiplier: string;
  setGoalMultiplier: (value: string) => void;
  goalEquityReturn: string;
  setGoalEquityReturn: (value: string) => void;
  goalDebtReturn: string;
  setGoalDebtReturn: (value: string) => void;
  goalGoldReturn: string;
  setGoalGoldReturn: (value: string) => void;
  goalCashReturn: string;
  setGoalCashReturn: (value: string) => void;
  goalOtherReturn: string;
  setGoalOtherReturn: (value: string) => void;
  addGoalFromForm: () => void;
  applyGoalPreset: (name: string, type: Goal["type"], multiple: number) => void;
}) {
  const holdings = props.backup.manualBalances.flatMap((balance) => {
    const account = props.backup.accounts.find((item) => item.id === balance.accountId);
    const instrument = balance.instrumentId ? props.backup.instruments.find((item) => item.id === balance.instrumentId) : undefined;
    return account && instrument ? [{ balance, account, instrument }] : [];
  });
  const selected = holdings.find((item) => item.balance.id === props.entryHoldingId) ?? holdings[0];
  const actions = selected ? manualEntryActionsForAccount(selected.account.type) : [];
  const action = actions.find((item) => item.id === props.entryActionId) ?? actions[0];
  const isSnapshot = action?.mode === "balance_snapshot";
  return (
    <section className="grid">
      <div className="card wide-card add-entry-card">
        <div className="section-head">
          <div><h2>Add Entry</h2><p>Add a transaction or balance snapshot to an existing imported/manual asset. The record is saved in the same canonical ledger used by imports.</p></div>
          <button className="primary" disabled={!selected || !action} onClick={props.addManualEntryFromForm}><PlusCircle size={15} /> Add Entry</button>
        </div>
        {holdings.length === 0 ? <p className="message">Import or create a holding before adding entries.</p> : (
          <div className="entry-workbench">
            <div className="entry-selector-panel">
              <label><span>Asset</span><select value={selected?.balance.id ?? ""} onChange={(event) => { props.setEntryHoldingId(event.target.value); props.setEntryActionId(""); }}>
                {holdings.map(({ balance, account }) => <option key={balance.id} value={balance.id}>{displayHoldingName(balance.label)} · {assetTypeLabel(account.type)}</option>)}
              </select></label>
              {selected && <div className="entry-asset-summary">
                <strong>{displayHoldingName(selected.balance.label)}</strong>
                <span>{assetTypeLabel(selected.account.type)} · {selected.instrument.category} · {selected.balance.currency}</span>
                <div><em>Current</em><b>{formatMoney(selected.balance.value, selected.balance.currency)}</b></div>
                <div><em>Qty/Units</em><b>{selected.balance.quantity === undefined ? "-" : formatNumber(selected.balance.quantity)}</b></div>
              </div>}
            </div>
            <div className="entry-form-panel">
              <div className="entry-form-grid">
                <label><span>Entry type</span><select value={action?.id ?? ""} onChange={(event) => props.setEntryActionId(event.target.value)}>{actions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                <label><span>Date</span><input type="date" value={props.entryDate} onChange={(event) => props.setEntryDate(event.target.value)} /></label>
                {!isSnapshot && <label><span>Amount</span><input type="number" step="0.01" value={props.entryAmount} onChange={(event) => props.setEntryAmount(event.target.value)} placeholder={action?.needsQuantity && action?.needsPrice ? "auto from qty x price" : "0.00"} /></label>}
                {action?.needsQuantity && <label><span>{selected?.account.type === "mutual_fund" || selected?.account.type === "nps" ? "Units" : "Quantity"}</span><input type="number" step="0.000001" value={props.entryQuantity} onChange={(event) => props.setEntryQuantity(event.target.value)} /></label>}
                {action?.needsPrice && <label><span>{selected?.account.type === "mutual_fund" || selected?.account.type === "nps" ? "NAV" : "Price"}</span><input type="number" step="0.0001" value={props.entryPrice} onChange={(event) => props.setEntryPrice(event.target.value)} /></label>}
                {action?.needsFees && <label><span>Fees</span><input type="number" step="0.01" value={props.entryFees} onChange={(event) => props.setEntryFees(event.target.value)} /></label>}
                {action?.needsTaxes && <label><span>Taxes</span><input type="number" step="0.01" value={props.entryTaxes} onChange={(event) => props.setEntryTaxes(event.target.value)} /></label>}
                {isSnapshot && <label><span>Current value</span><input type="number" step="0.01" value={props.entryCurrentValue} onChange={(event) => props.setEntryCurrentValue(event.target.value)} /></label>}
                {isSnapshot && <label><span>Invested amount</span><input type="number" step="0.01" value={props.entryInvestedAmount} onChange={(event) => props.setEntryInvestedAmount(event.target.value)} placeholder="optional" /></label>}
                <label className="entry-notes"><span>Notes</span><input value={props.entryNotes} onChange={(event) => props.setEntryNotes(event.target.value)} placeholder="Optional source/reference" /></label>
              </div>
              {action && <p className="entry-hint">{entryActionHint(action, selected?.account.type)}</p>}
            </div>
          </div>
        )}
      </div>
    
      <div className="card wide-card add-goal-card">
        <div className="section-head">
          <div><h2>Add Goal</h2><p>Create an expense-driven goal. After adding it, use Goals to map assets and inspect readiness analytics.</p></div>
          <button className="primary" onClick={props.addGoalFromForm}><Target size={15} /> Add Goal</button>
        </div>
        <div className="goal-create-panel embedded-goal-create">
          <div className="goal-preset-row">
            <button onClick={() => props.applyGoalPreset("Retirement", "retirement", 35)}>Retirement 35x</button>
            <button onClick={() => props.applyGoalPreset("Bhoomi", "custom", 13)}>Bhoomi 13x</button>
          </div>
          <div className="goal-form-grid">
            <label><span>Goal name</span><input value={props.goalName} onChange={(event) => props.setGoalName(event.target.value)} /></label>
            <label><span>Goal type</span><select value={props.goalType} onChange={(event) => props.setGoalType(event.target.value as Goal["type"])}><option value="retirement">Retirement</option><option value="custom">Custom</option></select></label>
            <label><span>Current monthly expense</span><input type="number" step="1000" value={props.goalMonthlyExpense} onChange={(event) => props.setGoalMonthlyExpense(event.target.value)} /></label>
            <label><span>Inflation %</span><input type="number" step="0.1" value={props.goalInflation} onChange={(event) => props.setGoalInflation(event.target.value)} /></label>
            <label><span>Target year</span><input type="number" step="1" value={props.goalTargetYear} onChange={(event) => props.setGoalTargetYear(event.target.value)} /></label>
            <label><span>Corpus multiple</span><input type="number" step="0.1" value={props.goalMultiplier} onChange={(event) => props.setGoalMultiplier(event.target.value)} /></label>
          </div>
          <div className="goal-return-grid">
            <label><span>Equity return %</span><input type="number" step="0.1" value={props.goalEquityReturn} onChange={(event) => props.setGoalEquityReturn(event.target.value)} /></label>
            <label><span>Debt return %</span><input type="number" step="0.1" value={props.goalDebtReturn} onChange={(event) => props.setGoalDebtReturn(event.target.value)} /></label>
            <label><span>Gold return %</span><input type="number" step="0.1" value={props.goalGoldReturn} onChange={(event) => props.setGoalGoldReturn(event.target.value)} /></label>
            <label><span>Cash return %</span><input type="number" step="0.1" value={props.goalCashReturn} onChange={(event) => props.setGoalCashReturn(event.target.value)} /></label>
            <label><span>Other return %</span><input type="number" step="0.1" value={props.goalOtherReturn} onChange={(event) => props.setGoalOtherReturn(event.target.value)} /></label>
          </div>
          <p className="message">Target corpus is inflated monthly expense at goal year x 12 x corpus multiple. Goals are stored in the same JSON backup as portfolio data.</p>
        </div>
      </div>
    </section>
  );
}

function ImportsView(props: {
  backup: PortfolioBackup;
  csv: string;
  setCsv: (value: string) => void;
  importCsv: () => void;
  importLabel: string;
  setImportLabel: (value: string) => void;
  deleteImport: (importId: string) => void;
  nativeDetection: ImportDetection | null;
  inspectNativeFile: (files: FileList | File[] | undefined) => void;
  nativeFileCount: number;
  casPassword: string;
  setCasPassword: (value: string) => void;
  parseCasPdfInBrowser: () => void;
  restoreNativeBackup: () => void;
  parseManualNativeInBrowser: () => void;
  parseIndMoneyXlsxInBrowser: () => void;
  parseEpfoPdfInBrowser: () => void;
  parseNpsCsvInBrowser: () => void;
  casParse: CasParseResult | null;
  stagedCas: CasCanonicalImport | null;
  commitStagedCas: () => void;
  indParse: IndMoneyParseResult | null;
  stagedInd: IndMoneyCanonicalImport | null;
  commitStagedIndMoney: () => void;
  epfoParse: EpfoPassbookParseResult[] | null;
  stagedEpfo: EpfoCanonicalImport[] | null;
  commitStagedEpfo: () => void;
  npsParse: NpsParseResult[] | null;
  stagedNps: NpsCanonicalImport[] | null;
  commitStagedNps: () => void;
  fxRate: string;
  setFxRate: (value: string) => void;
  fxDate: string;
  setFxDate: (value: string) => void;
  applyManualFxRate: () => void;
  importFxCsvFile: (file: File | undefined) => void;
  fxCsv: string;
  setFxCsv: (value: string) => void;
  importFxCsvText: () => void;
}) {
  const epfoParses = props.epfoParse ?? [];
  const npsParses = props.npsParse ?? [];
  const epfoBalanceCount = epfoParses.reduce((sum, parsed) => sum + parsed.balances.length, 0);
  const epfoContributionCount = epfoParses.reduce((sum, parsed) => sum + parsed.yearlyContributions.length, 0);
  const epfoInterestCount = epfoParses.reduce((sum, parsed) => sum + parsed.yearlyInterest.length, 0);
  const epfoWarningCount = epfoParses.reduce((sum, parsed) => sum + parsed.warnings.length, 0);
  const epfoHasErrors = epfoParses.some((parsed) => parsed.errors.length > 0);
  const npsHoldingCount = npsParses.reduce((sum, parsed) => sum + parsed.holdings.length, 0);
  const npsTransactionCount = npsParses.reduce((sum, parsed) => sum + parsed.transactions.length, 0);
  const npsWarningCount = npsParses.reduce((sum, parsed) => sum + parsed.warnings.length, 0);
  const npsHasErrors = npsParses.some((parsed) => parsed.errors.length > 0);
  return (
    <section className="grid">
      <div className="grid two">
        <div className="card">
          <h2>Native File Intake</h2>
          <input placeholder="Import name" value={props.importLabel} onChange={(event) => props.setImportLabel(event.target.value)} />
          <input type="file" multiple accept=".json,.csv,.pdf,.html,.xlsx,application/json,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => props.inspectNativeFile(event.target.files ?? undefined)} />
          {props.nativeDetection && <div className="detection"><div><span>Provider</span><strong>{props.nativeDetection.label}</strong></div><div><span>Files</span><strong>{props.nativeFileCount}</strong></div><div><span>Status</span><strong>{props.nativeDetection.status}</strong></div><div><span>Type</span><strong>{props.nativeDetection.nativeInputType}</strong></div><div><span>Confidence</span><strong>{props.nativeDetection.confidence}</strong></div><p>{props.nativeDetection.reason}</p></div>}
          {props.nativeDetection?.providerId === "canonical_json" && <div className="native-actions"><button className="primary" onClick={props.restoreNativeBackup}>Restore JSON Backup</button></div>}
          {props.nativeDetection?.providerId === "cas_pdf" && <div className="native-actions"><input type="password" placeholder="CAS PDF password" value={props.casPassword} onChange={(event) => props.setCasPassword(event.target.value)} /><button className="primary" onClick={props.parseCasPdfInBrowser}>Parse CAS PDF</button></div>}
          {props.nativeDetection?.providerId === "manual_csv" && props.nativeDetection.nativeInputType === "csv" && <div className="native-actions"><button className="primary" onClick={props.parseManualNativeInBrowser}>Parse Manual CSV</button></div>}
          {props.nativeDetection?.providerId === "indmoney_export" && <div className="native-actions"><button className="primary" onClick={props.parseIndMoneyXlsxInBrowser}>Parse INDMoney XLSX</button></div>}
          {props.nativeDetection?.nativeInputType === "pdf" && props.nativeDetection.providerId !== "cas_pdf" && <div className="native-actions"><button className="primary" onClick={props.parseEpfoPdfInBrowser}>Parse PF PDF{props.nativeFileCount > 1 ? "s" : ""}</button></div>}
          {props.nativeDetection?.providerId === "nps_statement" && props.nativeDetection.nativeInputType === "csv" && <div className="native-actions"><button className="primary" onClick={props.parseNpsCsvInBrowser}>Parse NPS CSV{props.nativeFileCount > 1 ? "s" : ""}</button></div>}
          {props.nativeDetection?.providerId === "nps_statement" && props.nativeDetection.nativeInputType !== "csv" && <p className="message">NPS file detected. The verified parser currently supports the yearly CSV statement format.</p>}
          {props.casParse && <div className="detection"><div><span>Schemes</span><strong>{props.casParse.schemes.length}</strong></div><div><span>Dated rows</span><strong>{props.casParse.datedRows}</strong></div><div><span>Financial rows</span><strong>{props.casParse.parsedFinancialRows}</strong></div><div><span>Warnings</span><strong>{props.casParse.warnings.length}</strong></div>{props.casParse.warnings.length > 0 && <p>{props.casParse.warnings.join("; ")}</p>}<button className="primary" onClick={props.commitStagedCas} disabled={!props.stagedCas || props.casParse.errors.length > 0}>Commit CAS Import</button></div>}
          {props.indParse && <div className="detection"><div><span>Rows</span><strong>{props.indParse.rows.length}</strong></div><div><span>Canonical</span><strong>{props.indParse.canonicalRows.length}</strong></div><div><span>Positions</span><strong>{props.indParse.positions.length}</strong></div><div><span>Warnings</span><strong>{props.indParse.warnings.length}</strong></div><button className="primary" onClick={props.commitStagedIndMoney} disabled={!props.stagedInd || props.indParse.errors.length > 0}>Commit INDMoney Import</button></div>}
          {props.epfoParse && <div className="detection"><div><span>Files</span><strong>{epfoParses.length}</strong></div><div><span>Balances</span><strong>{epfoBalanceCount}</strong></div><div><span>Contributions</span><strong>{epfoContributionCount}</strong></div><div><span>Interest</span><strong>{epfoInterestCount}</strong></div><div><span>Latest as of</span><strong>{latestAsOfDate(epfoParses.map((parsed) => parsed.asOfDate))}</strong></div><div><span>Warnings</span><strong>{epfoWarningCount}</strong></div><button className="primary" onClick={props.commitStagedEpfo} disabled={!props.stagedEpfo || epfoHasErrors}>Commit PF Import</button></div>}
          {props.npsParse && <div className="detection"><div><span>Files</span><strong>{npsParses.length}</strong></div><div><span>Schemes</span><strong>{npsHoldingCount}</strong></div><div><span>Transactions</span><strong>{npsTransactionCount}</strong></div><div><span>Latest as of</span><strong>{latestAsOfDate(npsParses.map((parsed) => parsed.asOfDate))}</strong></div><div><span>Warnings</span><strong>{npsWarningCount}</strong></div><button className="primary" onClick={props.commitStagedNps} disabled={!props.stagedNps || npsHasErrors}>Commit NPS Import</button></div>}
        </div>
        <div className="card"><h2>Provider Support</h2><div className="support-list">{providerImportSpecs.map((spec) => <div className="support-row" key={spec.id}><span>{spec.label}</span><strong className={`status-pill ${spec.status}`}>{spec.status}</strong></div>)}</div></div>
      </div>
      <div className="grid two">
        <div className="card"><h2>USD/INR FX Rates</h2><div className="native-actions"><input type="number" step="0.0001" placeholder="USD/INR rate" value={props.fxRate} onChange={(event) => props.setFxRate(event.target.value)} /><input type="date" value={props.fxDate} onChange={(event) => props.setFxDate(event.target.value)} /><button className="primary" onClick={props.applyManualFxRate}>Add Rate</button></div><p className="message">Use a real USD/INR rate. Current holdings use the latest rate; transaction analytics use rates on or before each transaction date.</p><input type="file" accept=".csv,text/csv" onChange={(event) => props.importFxCsvFile(event.target.files?.[0])} /><textarea value={props.fxCsv} onChange={(event) => props.setFxCsv(event.target.value)} spellCheck={false} /><div className="actions" style={{ marginTop: 12 }}><button className="primary" onClick={props.importFxCsvText}>Import FX CSV</button></div></div>
        <div className="card"><h2>Manual Balance CSV</h2><p className="message">Use the committed templates for normal uploads. This text box is the same balance CSV parser for quick cash, ESPP contribution, PPF, SSY, FD, EPF, NPS, gold, and other balance entries.</p><textarea value={props.csv} onChange={(event) => props.setCsv(event.target.value)} spellCheck={false} /><div className="actions" style={{ marginTop: 12 }}><button className="primary" onClick={props.importCsv}>Stage and Commit</button></div></div>
        <div className="card"><h2>Import History</h2>{props.backup.imports.length === 0 ? <p className="message">No imports yet.</p> : <div className="table-wrap"><table><thead><tr><th>Name</th><th>Provider</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>{props.backup.imports.map((run) => <tr key={run.id}><td>{run.label ?? run.fileName ?? run.id}</td><td>{run.provider}</td><td>{run.status}</td><td>{new Date(run.createdAt).toLocaleString()}</td><td><button className="danger-button" onClick={() => props.deleteImport(run.id)}>Delete</button></td></tr>)}</tbody></table></div>}</div>
      </div>
    </section>
  );
}

function TaxView({ report, currency, financialYears, selectedFinancialYear, setSelectedFinancialYear }: { report: ReturnType<typeof calculatePortfolioTaxReport>; currency: string; financialYears: string[]; selectedFinancialYear: string; setSelectedFinancialYear: (value: string) => void }) {
  const realizedBucketDetails = Object.values(report.realized.byBucket).filter((bucket) => bucket.gain !== 0 || bucket.taxableGain !== 0 || bucket.tax !== 0 || bucket.positiveGain !== 0);
  const realizedHoldingRows = report.realized.byAssetBucket.slice(0, 80);
  const bucketRows = realizedBucketDetails.map((bucket) => ({ name: bucket.label, value: Math.abs(bucket.gain), tag: (bucket.gain < 0 ? "net loss " : "net gain ") + formatMoney(bucket.gain, currency) + " · tax " + formatMoney(bucket.tax, currency) }));
  const realizedRows = report.realized.rows.slice(0, 160);
  const unrealizedGrouped = report.unrealized.byAssetBucket;
  const unrealizedPotentialTax = unrealizedGrouped.reduce((sum, row) => sum + row.potentialTaxBeforeSetoff, 0);
  const unrealizedGainRows = unrealizedGrouped.filter((row) => row.gain > 0).slice(0, 8).map((row) => ({ name: row.assetName + " · " + taxBucketLabel(row.bucket), value: row.gain, tag: "net rough tax " + formatMoney(row.potentialTaxBeforeSetoff, currency) }));
  const harvestRows = report.unrealized.harvestCandidates.slice(0, 12);
  const detailRows = unrealizedGrouped.slice(0, 100);
  return (
    <section className="grid tax-workspace">
      <div className="card wide-card">
        <div className="section-head">
          <div><h2>Portfolio Tax Estimates</h2><p>Estimate layer for an Indian resident individual. Realized tax uses FY sale lots after bucket-level loss set-off/exemption. Unrealized tax is only a rough what-if if open lots are sold now.</p></div>
          <label className="tax-year-picker"><span>Financial year</span><select value={selectedFinancialYear} onChange={(event) => setSelectedFinancialYear(event.target.value)}>{financialYears.map((year) => <option value={year} key={year}>FY {year}</option>)}</select></label>
        </div>
        <div className="holding-command-strip">
          <MiniInsight label="Estimated tax payable" value={formatMoney(report.estimatedTax.totalTax, currency)} detail="realized capital-gain tax + taxable income tax" />
          <MiniInsight label="Realized net gain/loss" value={formatMoney(report.realized.totalGain, currency)} detail={String(report.realized.rows.length) + " taxable disposal lot row(s), after ignoring zero-value migrations"} />
          <MiniInsight label="Unrealized gain/loss" value={formatMoney(report.unrealized.totalGain, currency)} detail="not payable until sold" />
          <MiniInsight label="Unrealized rough tax" value={formatMoney(unrealizedPotentialTax, currency)} detail="net by holding bucket, before future FY offsets" />
        </div>
        <div className="sub-analytics-strip">
          <MiniInsight label="Capital-gain tax" value={formatMoney(report.estimatedTax.capitalGainsTax, currency)} detail="after FY set-off/exemption" />
          <MiniInsight label="Income tax" value={formatMoney(report.estimatedTax.incomeTax, currency)} detail="taxable portfolio income at configured slab" />
          <MiniInsight label="Foreign tax paid" value={formatMoney(report.income.foreignTaxPaid, currency)} detail="withholding captured from transactions" />
          <MiniInsight label="Surcharge + cess" value={formatMoney(report.estimatedTax.surcharge + report.estimatedTax.cess, currency)} detail={report.profile.surchargeRate.toFixed(1) + "% surcharge, " + report.profile.cessRate.toFixed(1) + "% cess"} />
        </div>
      </div>

      <div className="card wide-card tax-explainer">
        <h2>How To Read This</h2>
        <div className="detection">
          <div><span>Realized</span><strong>Only sales/redemptions in this FY</strong><small>These rows drive estimated tax payable.</small></div>
          <div><span>Set-off</span><strong>Losses reduce gains inside the bucket</strong><small>Per-holding tax is therefore an estimate/contribution, not a separate legal bill per holding.</small></div>
          <div><span>Unrealized</span><strong>Open holdings only</strong><small>Useful for planning; not tax payable until you sell.</small></div>
          <div><span>Migration rows</span><strong>Zero-value broker transfer rows ignored</strong><small>They preserve holdings but are not treated as taxable disposals.</small></div>
        </div>
      </div>

      <div className="analytics-grid">
        <ChartCard title="Realized Bucket Magnitude"><RankingBar data={bucketRows} formatValue={(value) => formatMoney(value, currency)} emptyMessage="No realized disposal buckets in the selected FY yet." tone="profit" /></ChartCard>
        <ChartCard title="Unrealized Gain Watch"><RankingBar data={unrealizedGainRows} formatValue={(value) => formatMoney(value, currency)} emptyMessage="No unrealized gains in open lots yet." tone="profit" /></ChartCard>
        <div className="card"><h2>Portfolio Income</h2><p className="chart-note compact-note">Taxable income is separate from capital gains. Dividends/interest are taken from transaction rows; exempt interest is shown for context and not included in taxable income.</p><div className="signal-list"><MiniInsight label="Indian dividend" value={formatMoney(report.income.dividend, currency)} detail="taxable portfolio dividend rows" /><MiniInsight label="Foreign dividend" value={formatMoney(report.income.foreignDividend, currency)} detail="converted using transaction-date FX" /><MiniInsight label="Taxable interest" value={formatMoney(report.income.interest, currency)} detail="FD/cash/non-exempt interest" /><MiniInsight label="Exempt interest" value={formatMoney(report.income.exemptInterest, currency)} detail="PPF/SSY style rows, excluded" /></div></div>
        <div className="card"><h2>FIFO Harvesting Watch</h2><p className="chart-note compact-note">Only shows losses reachable by selling from the front of the FIFO queue. Later loss lots are not shown if older gain lots must be sold first and the FIFO sale prefix is still profitable.</p>{harvestRows.length === 0 ? <p className="message">No FIFO-reachable loss harvesting candidate detected from current open lots.</p> : <div className="table-wrap"><table><thead><tr><th>Asset</th><th>Bucket</th><th>FIFO qty</th><th>Cost</th><th>Value</th><th>Loss</th><th>Why</th></tr></thead><tbody>{harvestRows.map((row) => <tr key={row.accountId + row.instrumentId + row.loss}><td>{displayHoldingName(row.assetName)}</td><td>{row.bucket === "mixed" ? "Mixed FIFO" : taxBucketLabel(row.bucket)}</td><td>{formatNumber(row.quantity)}</td><td>{formatMoney(row.cost, currency)}</td><td>{formatMoney(row.currentValue, currency)}</td><td>{formatMoney(row.loss, currency)}</td><td>{row.note}</td></tr>)}</tbody></table></div>}</div>
      </div>

      <div className="card wide-card"><h2>Realized Tax By Holding</h2><p className="chart-note compact-note">This is the main realized tax drilldown. Tax before offset is each profitable holding's tax before same-bucket losses are applied. Estimated tax after offset is the final bucket tax allocated back to profitable holdings after loss set-off; loss rows show zero tax because they reduce taxable gains.</p>{realizedHoldingRows.length === 0 ? <p className="message">No realized holding rows for this financial year yet.</p> : <div className="table-wrap"><table><thead><tr><th>Asset</th><th>Bucket</th><th>Lots</th><th>Qty</th><th>Proceeds</th><th>Cost</th><th>Net gain/loss</th><th>Taxable positive gain</th><th>Offset used</th><th>Tax before offset</th><th>Estimated tax after offset</th></tr></thead><tbody>{realizedHoldingRows.map((row) => <tr key={row.assetName + row.bucket}><td>{displayHoldingName(row.assetName)}</td><td>{taxBucketLabel(row.bucket)}</td><td>{row.lots}</td><td>{formatNumber(row.quantity)}</td><td>{formatMoney(row.proceeds, currency)}</td><td>{formatMoney(row.cost, currency)}</td><td>{formatMoney(row.gain, currency)}</td><td>{formatMoney(row.positiveGain, currency)}</td><td>{formatMoney(row.lossSetoff, currency)}</td><td>{formatMoney(row.grossTaxBeforeSetoff, currency)}</td><td>{formatMoney(row.allocatedTaxAfterSetoff, currency)}</td></tr>)}</tbody></table></div>}</div>

      <div className="card wide-card"><h2>Realized Bucket Details</h2><p className="chart-note compact-note">Bucket totals show the actual set-off math used for estimated tax: gains and losses are netted inside each tax bucket before tax is calculated.</p>{realizedBucketDetails.length === 0 ? <p className="message">No realized tax buckets for this financial year yet.</p> : <div className="table-wrap"><table><thead><tr><th>Bucket</th><th>Total positive gains</th><th>Loss offset used</th><th>Net gain/loss</th><th>Taxable after offset</th><th>Estimated tax</th></tr></thead><tbody>{realizedBucketDetails.map((row) => <tr key={row.bucket}><td>{row.label}</td><td>{formatMoney(row.positiveGain, currency)}</td><td>{formatMoney(row.lossSetoff, currency)}</td><td>{formatMoney(row.gain, currency)}</td><td>{formatMoney(row.taxableGain, currency)}</td><td>{formatMoney(row.tax, currency)}</td></tr>)}</tbody></table></div>}</div>

      <div className="card wide-card"><h2>Unrealized Tax If Sold Today</h2><p className="chart-note compact-note">Grouped by holding and STCG/LTCG bucket. A holding can appear once with LTCG gain and again with STCG loss because different purchase lots have different holding periods and costs. This is planning data only; it is not included in estimated tax payable until sold.</p>{detailRows.length === 0 ? <p className="message">No open tax lots with current valuation yet.</p> : <div className="table-wrap"><table><thead><tr><th>Asset</th><th>Bucket</th><th>Lots</th><th>Qty</th><th>Current value</th><th>Cost</th><th>Gain/loss</th><th>Rate</th><th>Net rough tax</th></tr></thead><tbody>{detailRows.map((row) => <tr key={row.assetName + row.bucket}><td>{displayHoldingName(row.assetName)}</td><td>{taxBucketLabel(row.bucket)}</td><td>{row.lots ?? 1}</td><td>{formatNumber(row.quantity)}</td><td>{formatMoney(row.currentValue, currency)}</td><td>{formatMoney(row.cost, currency)}</td><td>{formatMoney(row.gain, currency)}</td><td>{row.taxRate.toFixed(1)}%</td><td>{formatMoney(row.potentialTaxBeforeSetoff, currency)}</td></tr>)}</tbody></table></div>}</div>

      <div className="card wide-card"><h2>Realized Lot Audit</h2><p className="chart-note compact-note">Raw taxable disposal lots used to build the holding and bucket summaries above. Zero-value broker migration rows are filtered out before this table.</p>{realizedRows.length === 0 ? <p className="message">No realized gain/loss lots for this financial year yet.</p> : <div className="table-wrap"><table><thead><tr><th>Date</th><th>Asset</th><th>Bucket</th><th>Qty</th><th>Proceeds</th><th>Cost</th><th>Gain</th></tr></thead><tbody>{realizedRows.map((row) => <tr key={row.transactionId + row.assetName + row.quantity}><td>{row.date}</td><td>{displayHoldingName(row.assetName)}</td><td>{taxBucketLabel(row.bucket)}</td><td>{formatNumber(row.quantity)}</td><td>{formatMoney(row.proceeds, currency)}</td><td>{formatMoney(row.cost, currency)}</td><td>{formatMoney(row.gain, currency)}</td></tr>)}</tbody></table></div>}</div>
      <div className="card wide-card"><h2>Tax Assumptions</h2><div className="detection"><div><span>Taxpayer</span><strong>Resident Indian individual</strong></div><div><span>Regime</span><strong>{report.profile.regime}</strong></div><div><span>Slab</span><strong>{report.profile.slabRate}%</strong></div><div><span>Surcharge</span><strong>{report.profile.surchargeRate}%</strong></div><div><span>Cess</span><strong>{report.profile.cessRate}%</strong></div></div><div className="error-list">{report.notes.map((note) => <div key={note}>{note}</div>)}</div></div>
    </section>
  );
}

function DataAuditView({ report, currency }: { report: ReturnType<typeof buildReconciliationReport>; currency: string }) {
  return (
    <section className="grid data-audit-workspace">
      <div className="card wide-card">
        <div className="section-head"><div><h2>Data Reconciliation</h2><p>Audit imports, source totals, market-data gaps, and validation checks before trusting analytics. This is the trust layer for parser and valuation quality.</p></div><span className={report.summary.marketDataGaps === 0 ? "status-pill implemented" : "status-pill planned"}>{report.summary.marketDataGaps === 0 ? "Clean" : report.summary.marketDataGaps + " gap(s)"}</span></div>
        <div className="holding-command-strip">
          <MiniInsight label="Imports" value={String(report.summary.imports)} detail={report.summary.documents + " source document(s)"} />
          <MiniInsight label="Holdings" value={String(report.summary.holdings)} detail="canonical balance records" />
          <MiniInsight label="Transactions" value={String(report.summary.transactions)} detail="canonical ledger rows" />
          <MiniInsight label="Market gaps" value={String(report.summary.marketDataGaps)} detail="FX/price/NAV review items" />
        </div>
      </div>
      <div className="analytics-grid">
        <ChartCard title="Source Value Mix"><HorizontalBar data={report.sourceTotals.map((row) => ({ name: row.source, value: row.value }))} currency={currency} /></ChartCard>
        <div className="card"><h2>Validation Checks</h2><div className="signal-list">{report.validationRows.map((row) => <div className={"signal-item " + (row.status === "ok" ? "good" : "warn")} key={row.label}><ShieldCheck size={18} /><div><span>{row.label}</span><strong>{row.status.toUpperCase()}</strong><small>{row.detail}</small></div></div>)}</div></div>
        <div className="card"><h2>Market Data Gaps</h2>{report.marketDataGaps.length === 0 ? <p className="message">No current FX/price/NAV gaps detected.</p> : <div className="table-wrap"><table><thead><tr><th>Kind</th><th>Label</th><th>Date</th><th>Severity</th></tr></thead><tbody>{report.marketDataGaps.slice(0, 40).map((gap) => <tr key={gap.kind + gap.label + gap.date}><td>{gap.kind}</td><td>{gap.label}</td><td>{gap.date ?? "-"}</td><td>{gap.severity}</td></tr>)}</tbody></table></div>}</div>
        <div className="card"><h2>Import Quality</h2>{report.imports.length === 0 ? <p className="message">No committed imports yet.</p> : <div className="table-wrap"><table><thead><tr><th>Import</th><th>Provider</th><th>Records</th><th>Confidence</th></tr></thead><tbody>{report.imports.map((run) => <tr key={run.id}><td>{run.label}</td><td>{run.provider}</td><td>{run.records}</td><td>{run.confidence}</td></tr>)}</tbody></table></div>}</div>
      </div>
      <div className="card wide-card"><h2>Source Ledger Totals</h2>{report.sourceTotals.length === 0 ? <p className="message">No source records yet.</p> : <div className="table-wrap"><table><thead><tr><th>Source</th><th>Holdings</th><th>Transactions</th><th>Current Value</th></tr></thead><tbody>{report.sourceTotals.map((row) => <tr key={row.source}><td>{row.source}</td><td>{row.holdings}</td><td>{row.transactions}</td><td>{formatMoney(row.value, currency)}</td></tr>)}</tbody></table></div>}</div>
    </section>
  );
}

function SettingsView({ profile, updateTaxProfile }: { profile: TaxProfile; updateTaxProfile: (patch: Partial<TaxProfile>) => void }) {
  return (
    <section className="grid settings-workspace">
      <div className="card wide-card">
        <div className="section-head"><div><h2>Settings</h2><p>Configure assumptions used by portfolio estimates. Settings are stored in the canonical JSON backup and restored across browsers.</p></div></div>
        <div className="settings-grid">
          <label><span>Taxpayer</span><select value={profile.residency} disabled><option value="resident_individual">Resident Indian individual</option></select></label>
          <label><span>Tax regime</span><select value={profile.regime} onChange={(event) => updateTaxProfile({ regime: event.target.value as TaxProfile["regime"] })}><option value="new">New regime</option><option value="old">Old regime</option></select></label>
          <label><span>Slab / marginal rate</span><select value={String(profile.slabRate)} onChange={(event) => updateTaxProfile({ slabRate: Number(event.target.value) })}>{[0, 5, 10, 15, 20, 25, 30].map((rate) => <option value={rate} key={rate}>{rate}%</option>)}</select></label>
          <label><span>Surcharge</span><select value={String(profile.surchargeRate)} onChange={(event) => updateTaxProfile({ surchargeRate: Number(event.target.value) })}>{[0, 10, 15, 25, 37].map((rate) => <option value={rate} key={rate}>{rate}%</option>)}</select></label>
          <label><span>Cess</span><input type="number" step="0.1" value={profile.cessRate} onChange={(event) => updateTaxProfile({ cessRate: Number(event.target.value) })} /></label>
          <label><span>Tax mode</span><select value={profile.mode} disabled><option value="estimate">Portfolio tax estimate</option></select></label>
        </div>
        <p className="message">The Tax section intentionally estimates portfolio tax only. Salary, deductions, Form 16, full ITR schedules, and ESPP payroll/perquisite treatment stay outside this tracker unless explicitly added later.</p>
      </div>
    </section>
  );
}

function taxBucketLabel(bucket: string): string {
  return bucket.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function AssetClassesPanel({ insights, currency, scopeLabel }: { insights: AssetClassInsight[]; currency: string; scopeLabel: string }) {
  if (insights.length === 0) return <div className="analytics-tab-panel"><p className="message">No scoped asset-class data yet.</p></div>;
  const topClass = insights[0];
  const totalValue = insights.reduce((sum, item) => sum + item.value, 0);
  const totalProfit = insights.reduce((sum, item) => sum + item.profit, 0);
  const classCount = insights.filter((item) => item.value > 0).length;
  return (
    <div className="analytics-tab-panel asset-type-panel">
      <div className="asset-type-hero">
        <div>
          <span className="eyebrow">Asset class command center</span>
          <h2>{scopeLabel}</h2>
          <p>Deep scoped view of Equity, Debt, Cash, Gold, and Others with subtype splits, concentration, cost basis, return, XIRR coverage, and top contributors.</p>
        </div>
        <div className="asset-type-hero-metrics">
          <MiniInsight label="Scoped value" value={formatMoney(totalValue, currency)} detail={classCount + " active class(es)"} />
          <MiniInsight label="Scoped P/L" value={formatMoney(totalProfit, currency)} detail="sum of class profit" />
          <MiniInsight label="Largest class" value={topClass?.category ?? "-"} detail={topClass ? topClass.percent.toFixed(1) + "% of scope" : ""} />
        </div>
      </div>
      <div className="asset-type-grid">
        {insights.map((item) => <AssetClassCard insight={item} currency={currency} key={item.category} />)}
      </div>
    </div>
  );
}

function AssetClassCard({ insight, currency }: { insight: AssetClassInsight; currency: string }) {
  return (
    <div className={"asset-type-card asset-type-" + insight.category}>
      <div className="asset-type-card-head">
        <div><span>{insight.category}</span><strong>{formatMoney(insight.value, currency)}</strong></div>
        <em>{insight.percent.toFixed(1)}%</em>
      </div>
      <div className="asset-type-metrics">
        <MiniInsight label="Invested" value={formatMoney(insight.invested, currency)} detail="remaining cost basis" />
        <MiniInsight label="P/L" value={formatMoney(insight.profit, currency)} detail={insight.returnPercent === undefined ? "return unavailable" : insight.returnPercent.toFixed(1) + "% simple"} />
        <MiniInsight label="Holdings" value={String(insight.holdings)} detail={insight.largest ? "largest: " + chartLabel(insight.largest.label) : "none"} />
        <MiniInsight label="XIRR coverage" value={String(insight.xirrAvailable) + "/" + String(insight.xirrTotal)} detail="holding cash-flow return" />
      </div>
      <div className="asset-type-card-charts">
        <div><h3>Subtype Split</h3><RankingBar data={insight.subtypeRows} formatValue={(value) => formatMoney(value, currency)} emptyMessage="No subtype value yet." tone="value" /></div>
        <div><h3>Largest Holdings</h3><RankingBar data={insight.topHoldings} formatValue={(value) => formatMoney(value, currency)} emptyMessage="No holdings in this class." tone="value" /></div>
        <div><h3>Profit Drivers</h3><RankingBar data={insight.topProfit} formatValue={(value) => formatMoney(value, currency)} emptyMessage="No positive profit in this class." tone="profit" /></div>
      </div>
    </div>
  );
}

function AnalyticsScopeSelector({ scope, setScope, goals }: { scope: AnalyticsScope; setScope: (scope: AnalyticsScope) => void; goals: GoalProgress[] }) {
  return (
    <div className="analytics-scope-panel">
      <div>
        <span className="eyebrow">Analytics scope</span>
        <p>Switch the entire analytics cockpit between the overall portfolio, combined goal funding, or one selected goal.</p>
      </div>
      <div className="analytics-scope-control" role="tablist" aria-label="Analytics scope">
        <button className={scope === "portfolio" ? "active" : ""} onClick={() => setScope("portfolio")}><strong>Overall</strong><span>full portfolio</span></button>
        <button className={scope === "goals-combined" ? "active" : ""} onClick={() => setScope("goals-combined")} disabled={goals.length === 0}><strong>Combined Goals</strong><span>sum of goal mappings</span></button>
        {goals.map((goal) => {
          const id = `goal:${goal.goal.id}` as AnalyticsScope;
          return <button key={goal.goal.id} className={scope === id ? "active" : ""} onClick={() => setScope(id)}><strong>{goal.goal.name}</strong><span>{goal.corpusTodayFundedPercent.toFixed(1)}% ready today</span></button>;
        })}
      </div>
    </div>
  );
}

function AnalyticsTabs({ active, setActive }: { active: AnalyticsTab; setActive: (tab: AnalyticsTab) => void }) {
  const tabs: Array<{ id: AnalyticsTab; label: string; detail: string }> = [
    { id: "overview", label: "Overview", detail: "current value and signals" },
    { id: "allocation", label: "Allocation", detail: "class, region, issuer" },
    { id: "assets", label: "Asset Classes", detail: "equity, debt, cash" },
    { id: "history", label: "History", detail: "market-data dependent" }
  ];
  return <div className="analytics-tabs" role="tablist">{tabs.map((tab) => <button key={tab.id} className={active === tab.id ? "active" : ""} onClick={() => setActive(tab.id)}><strong>{tab.label}</strong><span>{tab.detail}</span></button>)}</div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="card"><div className="metric-label">{label}</div><div className="metric-value">{value}</div></div>;
}

function MiniInsight({ label, value, detail, explain }: { label: string; value: string; detail: string; explain?: string }) {
  return <div className="mini-insight" title={explain}><span>{label}</span><strong title={value}>{value}</strong><small>{detail}</small></div>;
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="chart-card"><h2>{title}</h2>{children}</div>;
}


type NativeLinePoint = { ts: number; date: string; value: number | null };
type NativeLineSeries = { key: string; label: string; color: string; dashed?: boolean; points: NativeLinePoint[] };
type NativeLineHover = { x: number; y: number; date: string; rows: Array<{ label: string; color: string; value: number }> };

function NativeLineChart({ series, currency, note, emptyMessage }: { series: NativeLineSeries[]; currency: string; note?: string; emptyMessage: string }) {
  const [hover, setHover] = useState<NativeLineHover | null>(null);
  const visibleSeries = series.map((item) => ({ ...item, points: item.points.filter((point) => point.value !== null && Number.isFinite(point.value)) })).filter((item) => item.points.length > 0);
  const allPoints = visibleSeries.flatMap((item) => item.points.map((point) => ({ ...point, value: point.value ?? 0 })));
  if (allPoints.length === 0) return <p className="message">{emptyMessage}</p>;

  const width = 780;
  const height = 320;
  const pad = { left: 76, right: 18, top: 30, bottom: 52 };
  const xs = allPoints.map((point) => point.ts);
  const values = allPoints.map((point) => point.value);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(0, ...values);
  const maxYBase = Math.max(...values);
  const maxY = maxYBase === minY ? maxYBase + 1 : maxYBase;
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const xFor = (ts: number) => maxX === minX ? pad.left + plotWidth / 2 : pad.left + ((ts - minX) / (maxX - minX)) * plotWidth;
  const yFor = (value: number) => pad.top + plotHeight - ((value - minY) / (maxY - minY)) * plotHeight;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => minY + (maxY - minY) * ratio);
  const xTicks = nativeTimelineTicks(allPoints);
  const tooltipHeight = hover ? Math.min(230, Math.max(96, 34 + hover.rows.length * 24)) : 112;

  return (
    <div className="native-line-chart-block">
      <div className="native-line-legend">
        {visibleSeries.map((item) => <span key={item.key}><i style={{ background: item.color }} />{item.label}</span>)}
      </div>
      <svg className="native-line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Time series chart" onMouseLeave={() => setHover(null)} onPointerLeave={() => setHover(null)}>
        <rect className="native-line-bg" x={pad.left} y={pad.top} width={plotWidth} height={plotHeight} rx="10" />
        {yTicks.map((tick) => {
          const y = yFor(tick);
          return <g key={tick.toFixed(2)}><line className="native-line-grid" x1={pad.left} x2={width - pad.right} y1={y} y2={y} /><text className="native-line-axis" x={pad.left - 10} y={y + 4} textAnchor="end">{compactMoney(tick)}</text></g>;
        })}
        {xTicks.map((tick) => <text className="native-line-axis" key={tick.ts} x={xFor(tick.ts)} y={height - 18} textAnchor="middle">{tick.label}</text>)}
        {visibleSeries.map((item) => {
          const path = linePath(item.points, xFor, yFor);
          return (
            <g key={item.key}>
              {path && <path className="native-line-path" d={path} fill="none" stroke={item.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={item.dashed ? "7 6" : undefined}><title>{item.label}: {item.points.length === 1 ? "single snapshot point" : item.points.length + " points"}</title></path>}
              {item.points.map((point) => {
                const value = point.value ?? 0;
                return <circle className="native-line-dot" key={item.key + point.ts + value} cx={xFor(point.ts)} cy={yFor(value)} r="5.4" fill={item.color} tabIndex={0} onPointerEnter={() => setHover(nativeLineHoverForPoint(point.ts, visibleSeries, xFor, yFor))} onPointerOver={() => setHover(nativeLineHoverForPoint(point.ts, visibleSeries, xFor, yFor))} onMouseEnter={() => setHover(nativeLineHoverForPoint(point.ts, visibleSeries, xFor, yFor))} onMouseOver={() => setHover(nativeLineHoverForPoint(point.ts, visibleSeries, xFor, yFor))} onFocus={() => setHover(nativeLineHoverForPoint(point.ts, visibleSeries, xFor, yFor))}><title>{item.label}: {formatMoney(value, currency)} on {point.date}</title></circle>;
              })}
            </g>
          );
        })}
        {hover && (
          <foreignObject className="native-line-tooltip-wrap" x={Math.min(width - 248, Math.max(pad.left + 4, hover.x + 12))} y={Math.min(height - tooltipHeight - 8, Math.max(8, hover.y - 54))} width="236" height={tooltipHeight}>
            <div className="native-line-tooltip">
              <strong>{hover.date}</strong>
              {hover.rows.map((row) => <span key={row.label}><i style={{ background: row.color }} />{row.label}<b>{formatMoney(row.value, currency)}</b></span>)}
            </div>
          </foreignObject>
        )}
      </svg>
      <p className="chart-note">{note ? note + " " : ""}Dots indicate dated valuation points; a series becomes a line when at least two dated points exist. Hover or focus a dot to inspect all series values for that date.</p>
    </div>
  );
}

function nativeLineHoverForPoint(ts: number, series: Array<NativeLineSeries & { points: NativeLinePoint[] }>, xFor: (ts: number) => number, yFor: (value: number) => number): NativeLineHover | null {
  const rows = series.flatMap((item) => {
    const point = item.points.find((candidate) => candidate.ts === ts);
    if (!point || point.value === null) return [];
    return [{ label: item.label, color: item.color, value: point.value }];
  });
  if (rows.length === 0) return null;
  const firstPoint = series.flatMap((item) => item.points).find((point) => point.ts === ts && point.value !== null);
  if (!firstPoint || firstPoint.value === null) return null;
  return { x: xFor(ts), y: yFor(firstPoint.value), date: firstPoint.date, rows };
}

function linePath(points: NativeLinePoint[], xFor: (ts: number) => number, yFor: (value: number) => number): string {
  return points.map((point, index) => {
    const value = point.value ?? 0;
    return (index === 0 ? "M" : "L") + " " + roundMoney(xFor(point.ts)) + " " + roundMoney(yFor(value));
  }).join(" ");
}

function nativeTimelineTicks(points: Array<{ ts: number; date: string }>): Array<{ ts: number; label: string }> {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.ts - b.ts);
  const ticks = new Map<number, string>();
  ticks.set(sorted[0].ts, timelineTickLabel(sorted[0].ts));
  for (const point of sorted) {
    const label = timelineTickLabel(point.ts);
    if (![...ticks.values()].includes(label)) ticks.set(point.ts, label);
  }
  ticks.set(sorted.at(-1)!.ts, timelineTickLabel(sorted.at(-1)!.ts));
  return [...ticks.entries()].map(([ts, label]) => ({ ts, label })).slice(0, 7);
}

function snapshotPointTs(point: Pick<SnapshotTimelinePoint, "createdAt" | "asOfDate">): number {
  const created = Date.parse(point.createdAt);
  return Number.isFinite(created) ? created : toTimestamp(point.asOfDate);
}

function SnapshotPortfolioHistoryChart({ points, currency }: { points: SnapshotTimelinePoint[]; currency: string }) {
  if (points.length === 0) return <p className="message">Capture at least one snapshot to build a frozen history timeline.</p>;
  const sorted = [...points].sort((a, b) => snapshotPointTs(a) - snapshotPointTs(b));
  return <NativeLineChart currency={currency} emptyMessage="Capture snapshots to build a frozen history timeline." note="Frozen snapshot history uses only saved snapshot analytics. It never fetches market data while rendering this timeline." series={[
    { key: "invested", label: "Invested", color: "#64748b", points: sorted.map((point) => ({ ts: snapshotPointTs(point), date: point.asOfDate, value: point.invested })) },
    { key: "netWorth", label: "Net Worth", color: "#0e7490", points: sorted.map((point) => ({ ts: snapshotPointTs(point), date: point.asOfDate, value: point.netWorth })) },
    { key: "profit", label: "Profit", color: "#047857", points: sorted.map((point) => ({ ts: snapshotPointTs(point), date: point.asOfDate, value: point.profit })) }
  ]} />;
}

function SnapshotBreakdownChart({ points, field, keys, currency }: { points: SnapshotTimelinePoint[]; field: keyof Pick<SnapshotTimelinePoint, "category" | "region" | "assetKind" | "issuer" | "provider">; keys: string[]; currency: string }) {
  if (points.length === 0 || keys.length === 0) return <p className="message">Capture snapshots with this breakdown to build a frozen trend.</p>;
  const sorted = [...points].sort((a, b) => snapshotPointTs(a) - snapshotPointTs(b));
  return <NativeLineChart currency={currency} emptyMessage="Capture snapshots with this breakdown to build a frozen trend." series={keys.map((key, index) => ({
    key,
    label: chartLabel(key),
    color: chartColors[index % chartColors.length],
    points: sorted.map((point) => ({ ts: snapshotPointTs(point), date: point.asOfDate, value: Number((point[field] as Record<string, number>)[key] ?? 0) }))
  }))} />;
}

function SnapshotGoalHistoryChart({ points, currency }: { points: SnapshotTimelinePoint[]; currency: string }) {
  const usable = points.filter((point) => point.goalTarget > 0 || point.goalRequiredToday > 0 || point.goalMappedCurrent > 0 || point.goalProjected > 0);
  if (usable.length === 0) return <p className="message">Capture snapshots after adding goals to build a goal funding history.</p>;
  const sorted = [...usable].sort((a, b) => snapshotPointTs(a) - snapshotPointTs(b));
  return <NativeLineChart currency={currency} emptyMessage="Capture snapshots after adding goals to build a goal funding history." series={[
    { key: "goalMappedCurrent", label: "Mapped Now", color: "#0e7490", points: sorted.map((point) => ({ ts: snapshotPointTs(point), date: point.asOfDate, value: point.goalMappedCurrent })) },
    { key: "goalRequiredToday", label: "Needed Today", color: "#7c3aed", points: sorted.map((point) => ({ ts: snapshotPointTs(point), date: point.asOfDate, value: point.goalRequiredToday })) },
    { key: "goalProjected", label: "Projected", color: "#047857", points: sorted.map((point) => ({ ts: snapshotPointTs(point), date: point.asOfDate, value: point.goalProjected })) },
    { key: "goalTarget", label: "Target", color: "#b7791f", dashed: true, points: sorted.map((point) => ({ ts: snapshotPointTs(point), date: point.asOfDate, value: point.goalTarget })) }
  ]} />;
}

function PortfolioGrowthChart({ points, currency }: { points: PortfolioTimelinePoint[]; currency: string }) {
  if (points.length === 0) return <p className="message">Import transactions and balances to build a growth timeline.</p>;
  const chartData = timelineChartData(points);
  const completeValuePoints = points.filter((point) => point.current !== null).length;
  return <NativeLineChart currency={currency} emptyMessage="Import transactions and balances to build a growth timeline." note={"Sampled at month-end plus today's current snapshot. The final marker matches the dashboard current value; historical current value is not connected to today when the latest point is a different current-holdings snapshot. Coverage: " + completeValuePoints + "/" + points.length + " valuation point(s)."} series={[
    { key: "invested", label: "Invested", color: "#64748b", points: chartData.map((point) => ({ ts: point.ts, date: point.date, value: point.invested })) },
    { key: "historicalCurrent", label: "Historical Current", color: "#0f766e", points: chartData.map((point) => ({ ts: point.ts, date: point.date, value: point.historicalCurrent })) },
    { key: "latestCurrent", label: "Today Snapshot", color: "#0f766e", points: chartData.map((point) => ({ ts: point.ts, date: point.date, value: point.latestCurrent })) }
  ]} />;
}

function BreakdownGrowthChart({ points, field, keys, currency }: { points: PortfolioTimelinePoint[]; field: keyof Pick<PortfolioTimelinePoint, "category" | "region" | "assetKind" | "issuer">; keys: string[]; currency: string }) {
  if (points.length === 0 || keys.length === 0) return <p className="message">No dated valuation snapshots yet for this breakdown.</p>;
  const today = todayIso();
  const completePoints = points.filter((point) => point.date !== today && point.current !== null);
  if (completePoints.length === 0) return <p className="message">Historical market coverage is not complete enough to draw this breakdown yet.</p>;
  return <NativeLineChart currency={currency} emptyMessage="Historical market coverage is not complete enough to draw this breakdown yet." note="Unstacked month-end value lines using complete portfolio valuation points only. Each line is its own actual value, not a stacked position. Today's snapshot is shown in dashboard totals and allocation bars, not connected as a fake historical segment." series={keys.map((key, index) => ({
    key,
    label: chartLabel(key),
    color: chartColors[index % chartColors.length],
    points: completePoints.map((point) => ({ ts: toTimestamp(point.date), date: point.date, value: Number((point[field] as Record<string, number>)[key] ?? 0) }))
  }))} />;
}

type AllocationExplorerKey = "category" | "assetType" | "region" | "issuer" | "provider";

function CurrentAllocationExplorer({ datasets, currency }: { datasets: { allocation: Array<{ name: string; value: number; percent?: number }>; assetType: Array<{ name: string; value: number }>; region: Array<{ name: string; value: number }>; issuer: Array<{ name: string; value: number }>; provider: Array<{ name: string; value: number }> }; currency: string }) {
  const [view, setView] = useState<AllocationExplorerKey>("category");
  const options: Array<{ id: AllocationExplorerKey; label: string }> = [
    { id: "category", label: "Class" },
    { id: "assetType", label: "Asset" },
    { id: "region", label: "Region" },
    { id: "issuer", label: "Issuer" },
    { id: "provider", label: "Source" }
  ];
  const rows = view === "category" ? datasets.allocation : datasets[view];
  const total = rows.reduce((sum, item) => sum + item.value, 0);
  const top = rows[0];

  return (
    <div className="allocation-explorer">
      <div className="segment-control" role="tablist">
        {options.map((option) => <button key={option.id} className={view === option.id ? "active" : ""} onClick={() => setView(option.id)}>{option.label}</button>)}
      </div>
      <div className="allocation-explorer-body">
        <div className="allocation-focus">
          <span>Largest Exposure</span>
          <strong title={top?.name}>{top ? chartLabel(top.name) : "-"}</strong>
          <small>{top ? formatMoney(top.value, currency) + " · " + (total === 0 ? "0.0" : ((top.value / total) * 100).toFixed(1)) + "%" : "No current holdings"}</small>
        </div>
        <div className="allocation-rank-list">
          {rows.length === 0 ? <p className="message">No current allocation data yet.</p> : rows.slice(0, 7).map((item, index) => {
            const percent = total === 0 ? 0 : (item.value / total) * 100;
            return <div className="allocation-rank-row" key={item.name}><div><span style={{ background: chartColors[index % chartColors.length] }} /><strong title={item.name}>{chartLabel(item.name)}</strong></div><em>{formatMoney(item.value, currency)}</em><small>{percent.toFixed(1)}%</small></div>;
          })}
        </div>
      </div>
    </div>
  );
}

function CommandInsightDeck({ cards }: { cards: CommandInsightCard[] }) {
  return (
    <div className="command-insight-deck">
      {cards.map((card) => (
        <div className={"command-insight-card " + card.tone} key={card.label}>
          <div className="command-insight-head"><span>{card.label}</span>{card.footnote && <em>{card.footnote}</em>}</div>
          <strong>{card.value}</strong>
          <p>{card.detail}</p>
          {card.progress !== undefined && <div className="insight-progress" aria-label={card.label + " progress"}><span style={{ width: clampGoalPercent(card.progress) + "%" }} /></div>}
        </div>
      ))}
    </div>
  );
}

function SignalCard({ signal }: { signal: DashboardSignal }) {
  const Icon = signal.icon === "alert" ? AlertTriangle : signal.icon === "trend" ? TrendingUp : ShieldCheck;
  return <div className={"signal-item " + signal.tone}><Icon size={18} /><div><span>{signal.label}</span><strong>{signal.value}</strong><small>{signal.detail}</small></div></div>;
}


function donutSectors(data: Array<{ name: string; value: number }>, total: number) {
  let cursor = 0;
  const gap = data.length > 1 ? 2 : 0;
  return data.map((item) => {
    const rawAngle = total <= 0 ? 0 : (item.value / total) * 360;
    const startAngle = cursor + gap / 2;
    const endAngle = Math.max(startAngle + 0.1, cursor + rawAngle - gap / 2);
    cursor += rawAngle;
    return {
      name: item.name,
      value: item.value,
      percent: total <= 0 ? 0 : (item.value / total) * 100,
      path: donutSlicePath(150, 150, 82, 126, startAngle, data.length === 1 ? 359.99 : Math.min(359.99, endAngle))
    };
  });
}

function donutSlicePath(cx: number, cy: number, innerRadius: number, outerRadius: number, startAngle: number, endAngle: number): string {
  const outerStart = polarToCartesian(cx, cy, outerRadius, endAngle);
  const outerEnd = polarToCartesian(cx, cy, outerRadius, startAngle);
  const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle);
  const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle);
  const largeArc = endAngle - startAngle <= 180 ? "0" : "1";
  return [
    "M", outerStart.x, outerStart.y,
    "A", outerRadius, outerRadius, 0, largeArc, 0, outerEnd.x, outerEnd.y,
    "L", innerStart.x, innerStart.y,
    "A", innerRadius, innerRadius, 0, largeArc, 1, innerEnd.x, innerEnd.y,
    "Z"
  ].join(" ");
}

function polarToCartesian(cx: number, cy: number, radius: number, angleInDegrees: number): { x: number; y: number } {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: roundMoney(cx + radius * Math.cos(angleInRadians)),
    y: roundMoney(cy + radius * Math.sin(angleInRadians))
  };
}

function DonutChart({ data, currency }: { data: Array<{ name: string; value: number; percent?: number }>; currency: string }) {
  const chartData = data.filter((item) => Number.isFinite(item.value) && item.value > 0);
  if (chartData.length === 0) return <p className="message">No data yet.</p>;
  const total = chartData.reduce((sum, item) => sum + item.value, 0);
  return (
    <div className="allocation-donut-frame">
      <div className="allocation-donut-visual" aria-label="Allocation donut chart">
        <svg className="allocation-donut-svg" viewBox="0 0 300 300" role="img" aria-label="Portfolio allocation by category">
          <title>Portfolio allocation by category</title>
          {donutSectors(chartData, total).map((sector, index) => (
            <path className="allocation-donut-sector" key={sector.name} d={sector.path} fill={chartColors[index % chartColors.length]} stroke="#ffffff" strokeWidth="3">
              <title>{sector.name}: {sector.percent.toFixed(1)}%, {formatMoney(sector.value, currency)}</title>
            </path>
          ))}
        </svg>
        <div className="allocation-donut-center">
          <span>Total</span>
          <strong>{formatMoney(total, currency)}</strong>
        </div>
      </div>
      <div className="allocation-legend-list">
        {chartData.map((item, index) => {
          const percent = item.percent ?? (total <= 0 ? 0 : (item.value / total) * 100);
          return (
            <div className="allocation-legend-row" key={item.name} style={{ "--legend-color": chartColors[index % chartColors.length], "--legend-percent": Math.max(3, Math.min(100, percent)) + "%" } as CSSProperties}>
              <span className="legend-dot" />
              <strong>{item.name}</strong>
              <em>{percent.toFixed(1)}%</em>
              <small>{formatMoney(item.value, currency)}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HorizontalBar({ data, currency }: { data: Array<{ name: string; value: number }>; currency: string }) {
  const chartData = labeledChartData(data.filter((item) => Number.isFinite(item.value) && item.value > 0).slice(0, 8));
  if (chartData.length === 0) return <p className="message">No data yet.</p>;
  const total = chartData.reduce((sum, item) => sum + item.value, 0);
  return (
    <div className="metric-bar-list">
      {chartData.map((item, index) => {
        const percent = total <= 0 ? 0 : (item.value / total) * 100;
        const color = chartColors[index % chartColors.length];
        const visualWidth = Math.max(4, percent);
        return (
          <div className="metric-bar-row" key={item.fullName} title={item.fullName + " · " + formatMoney(item.value, currency)} style={{ "--bar-color": color, "--bar-percent": visualWidth + "%" } as CSSProperties}>
            <div className="metric-bar-label"><span>{index + 1}</span><strong>{item.shortName}</strong><em>{percent.toFixed(1)}%</em></div>
            <div className="metric-bar-track" aria-hidden="true"><span style={{ width: visualWidth + "%", background: color }} /></div>
            <strong className="metric-bar-value">{formatMoney(item.value, currency)}</strong>
          </div>
        );
      })}
      {data.length > chartData.length && <p className="chart-note compact-note">Showing top {chartData.length} of {data.length} positive-value items.</p>}
    </div>
  );
}

type RankingBarProps = {
  data: RankingDatum[];
  formatValue: (value: number) => string;
  emptyMessage: string;
  tone?: "value" | "profit" | "return";
};

function RankingBar({ data, formatValue, emptyMessage, tone = "value" }: RankingBarProps) {
  const chartData = labeledChartData(data.filter((item) => Number.isFinite(item.value) && item.value > 0).slice(0, 8));
  if (chartData.length === 0) return <p className="message">{emptyMessage}</p>;
  const max = Math.max(...chartData.map((item) => item.value));
  const total = chartData.reduce((sum, item) => sum + item.value, 0);
  return (
    <div className={"ranking-bar-chart tone-" + tone} role="list">
      {chartData.map((item, index) => {
        const width = max <= 0 ? 0 : Math.max(4, (item.value / max) * 100);
        const share = total <= 0 ? 0 : (item.value / total) * 100;
        const color = chartColors[index % chartColors.length];
        return (
          <div className="ranking-row" key={item.fullName} role="listitem" title={item.fullName + " · " + formatValue(item.value)} style={{ "--bar-color": color, "--bar-percent": width + "%" } as CSSProperties}>
            <div className="ranking-label"><span>{index + 1}</span><strong>{item.shortName}</strong>{item.tag && <em className="ranking-tag">{item.tag}</em>}</div>
            <div className="ranking-track" aria-hidden="true"><div className="ranking-fill" style={{ width: width + "%", background: color }} /></div>
            <div className="ranking-value-block"><strong className="ranking-value">{formatValue(item.value)}</strong><span>{share.toFixed(1)}%</span></div>
          </div>
        );
      })}
    </div>
  );
}
function HoldingRow({ holding, baseCurrency, returns }: { holding: ReturnType<typeof calculatePortfolioInsights>["holdings"][number]; baseCurrency: string; returns?: HoldingReturn }) {
  const value = holding.valueInBase === undefined ? "FX needed" : formatMoney(holding.valueInBase, baseCurrency);
  const price = holding.price === undefined ? "-" : formatMoney(holding.price, holding.currency);
  const priceDetail = holding.price === undefined ? "not available" : holding.quantity === undefined ? "latest unit price" : "per unit/share";
  const trackedValue = holding.trackedValueInBase === undefined ? "-" : formatMoney(holding.trackedValueInBase, baseCurrency);
  const trackedDetail = holding.taperApplied ? holding.taperLabel + " · " + holding.taperDetail : "actual for goals";
  const profitTone = (returns?.profit ?? 0) >= 0 ? "positive-text" : "negative-text";
  const costKnown = returns?.costBasisKnown === true;
  const xirrDetail = returns?.missingFx.length ? "FX needed" : returns?.hasCashFlows ? "cash-flow return" : "needs transactions";
  const subtype = assetSubtypeLabel(holding);
  return <div className="holding-row pro-row holding-analysis-row"><div className="holding-name-block"><strong title={holding.label}>{displayHoldingName(holding.label)}</strong><span>{holding.assetKind} · {holding.region} · {holding.provider} · {holding.asOfDate}</span></div><div className="holding-chips"><span className={`badge category-${holding.category}`}>{holding.category}</span><span className="badge subtype-badge">{subtype}</span><span className="badge muted-badge">{returns?.allocationPercent.toFixed(1) ?? "0.0"}%</span><span className="badge muted-badge">{holding.quantity === undefined ? "No qty" : formatNumber(holding.quantity)}</span></div><div className="holding-metric"><span>Value</span><strong>{value}</strong><small>{holding.currency === baseCurrency ? "base" : formatMoney(holding.value, holding.currency)}</small></div><div className="holding-metric"><span>Price</span><strong>{price}</strong><small>{priceDetail}</small></div><div className="holding-metric"><span>Tracked</span><strong>{trackedValue}</strong><small>{trackedDetail}</small></div><div className="holding-metric"><span>Invested</span><strong>{costKnown ? formatMoney(returns?.netInvested ?? 0, baseCurrency) : "-"}</strong><small>{costKnown ? "remaining cost basis" : "not provided"}</small></div><div className="holding-metric"><span>P/L</span><strong className={profitTone}>{returns?.profit === undefined ? "-" : formatMoney(returns.profit, baseCurrency)}</strong><small>{returns?.returnPercent === undefined ? "return unavailable" : returns.returnPercent.toFixed(1) + "% simple"}</small></div><div className="holding-metric"><span>XIRR</span><strong>{returns?.xirr === undefined || returns?.xirr === null ? "-" : returns.xirr.toFixed(2) + "%"}</strong><small>{xirrDetail}</small></div></div>;
}
function HoldingEditRow({ balance, updateBalance }: { balance: ManualBalance; updateBalance: (id: string, patch: Partial<ManualBalance>) => void }) {
  const taperMode = balance.taperMode ?? "none";
  return <div className="edit-row holding-edit-row"><input value={balance.label} onChange={(event) => updateBalance(balance.id, { label: event.target.value })} /><select value={balance.category} onChange={(event) => updateBalance(balance.id, { category: event.target.value as AssetCategory })}>{categoryOrder.map((category) => <option key={category} value={category}>{category}</option>)}</select><input value={balance.currency} onChange={(event) => updateBalance(balance.id, { currency: event.target.value.toUpperCase() })} /><input type="number" step="0.01" value={balance.value} onChange={(event) => updateBalance(balance.id, { value: Number(event.target.value) })} /><input type="number" step="0.01" placeholder="Invested" value={balance.investedAmount ?? ""} onChange={(event) => updateBalance(balance.id, { investedAmount: event.target.value === "" ? undefined : Number(event.target.value) })} /><input placeholder="Inv curr" value={balance.investedCurrency ?? ""} onChange={(event) => updateBalance(balance.id, { investedCurrency: event.target.value === "" ? undefined : event.target.value.toUpperCase() })} /><input type="date" value={balance.investedAsOfDate ?? balance.asOfDate} onChange={(event) => updateBalance(balance.id, { investedAsOfDate: event.target.value })} /><input type="number" step="0.000001" value={balance.quantity ?? ""} onChange={(event) => updateBalance(balance.id, { quantity: event.target.value === "" ? undefined : Number(event.target.value) })} /><input type="number" step="0.0001" value={balance.price ?? ""} onChange={(event) => updateBalance(balance.id, { price: event.target.value === "" ? undefined : Number(event.target.value) })} /><select className="taper-mode-select" value={taperMode} onChange={(event) => updateBalance(balance.id, { taperMode: event.target.value as TaperMode, taperFactor: event.target.value === "custom" ? (balance.taperFactor ?? 0.05) : undefined })}>{taperPresets.map((preset) => <option key={preset.mode} value={preset.mode}>{preset.label}</option>)}</select><input className="taper-factor-input" type="number" min="0" max="1" step="0.01" placeholder="k" disabled={taperMode !== "custom"} value={taperMode === "custom" ? (balance.taperFactor ?? 0.05) : ""} onChange={(event) => updateBalance(balance.id, { taperFactor: event.target.value === "" ? undefined : Number(event.target.value) })} /><input type="date" value={balance.asOfDate} onChange={(event) => updateBalance(balance.id, { asOfDate: event.target.value })} /><input value={balance.notes ?? ""} onChange={(event) => updateBalance(balance.id, { notes: event.target.value })} /></div>;
}

function TransactionRow({ tx, backup }: { tx: Transaction; backup: PortfolioBackup }) {
  const instrument = backup.instruments.find((item) => item.id === tx.instrumentId);
  return <div className="transaction-row pro-row"><div className="record-main"><strong>{tx.date} · {tx.type}</strong><span title={instrument?.name}>{displayHoldingName(instrument?.name ?? tx.instrumentId)} · {tx.source.provider ?? tx.source.type}</span></div><div className="record-value">{formatMoney(tx.amount, tx.currency)}</div><div className="record-value muted-value">{tx.quantity === undefined ? "-" : formatNumber(tx.quantity)}</div><div className="record-value muted-value">{tx.fees || tx.taxes ? formatMoney((tx.fees ?? 0) + (tx.taxes ?? 0), tx.currency) : "-"}</div></div>;
}

function TransactionEditRow({ tx, updateTransaction, deleteTransaction }: { tx: Transaction; updateTransaction: (id: string, patch: Partial<Transaction>) => void; deleteTransaction: (id: string) => void }) {
  return <div className="edit-row transaction-edit-row"><input type="date" value={tx.date} onChange={(event) => updateTransaction(tx.id, { date: event.target.value })} /><select value={tx.type} onChange={(event) => updateTransaction(tx.id, { type: event.target.value as Transaction["type"] })}>{transactionTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select><input value={tx.currency} onChange={(event) => updateTransaction(tx.id, { currency: event.target.value.toUpperCase() })} /><input type="number" step="0.01" value={tx.amount} onChange={(event) => updateTransaction(tx.id, { amount: Number(event.target.value) })} /><input type="number" step="0.000001" value={tx.quantity ?? ""} onChange={(event) => updateTransaction(tx.id, { quantity: event.target.value === "" ? undefined : Number(event.target.value) })} /><input type="number" step="0.0001" value={tx.price ?? ""} onChange={(event) => updateTransaction(tx.id, { price: event.target.value === "" ? undefined : Number(event.target.value) })} /><input type="number" step="0.01" value={tx.fees ?? 0} onChange={(event) => updateTransaction(tx.id, { fees: Number(event.target.value) })} /><input type="number" step="0.01" value={tx.taxes ?? 0} onChange={(event) => updateTransaction(tx.id, { taxes: Number(event.target.value) })} /><button className="danger-button" onClick={() => deleteTransaction(tx.id)}>Delete</button></div>;
}


function daysSince(date: string): number {
  const parsed = Date.parse(date + "T00:00:00.000Z");
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, Math.floor((Date.now() - parsed) / 86400000));
}

function topTimelineKeys(points: PortfolioTimelinePoint[], field: keyof Pick<PortfolioTimelinePoint, "category" | "region" | "assetKind" | "issuer">, limit: number): string[] {
  const totals = new Map<string, number>();
  for (const point of points) {
    for (const [key, value] of Object.entries(point[field])) totals.set(key, Math.max(totals.get(key) ?? 0, value));
  }
  return [...totals.entries()].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key]) => key);
}

function topSnapshotKeys(points: SnapshotTimelinePoint[], field: keyof Pick<SnapshotTimelinePoint, "region" | "assetKind" | "issuer" | "provider">, limit: number): string[] {
  const totals = new Map<string, number>();
  for (const point of points) {
    for (const [key, value] of Object.entries(point[field])) totals.set(key, Math.max(totals.get(key) ?? 0, value));
  }
  return [...totals.entries()].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key]) => key);
}

function labeledChartData<T extends { name: string; value: number }>(items: T[]): Array<T & { fullName: string; shortName: string }> {
  const used = new Map<string, number>();
  return items.map((item) => {
    const base = chartLabel(item.name);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return { ...item, fullName: item.name, shortName: count === 0 ? base : base + " " + String(count + 1) };
  });
}

function chartLabel(value: string): string {
  const normalized = displayHoldingName(value)
    .replace(/^Registrar\s*:\s*/i, "")
    .replace(/^HUSTGT-/i, "")
    .replace(/S\s+and\s+P/gi, "S&P")
    .replace(/Transactions Ledger/gi, "Ledger")
    .replace(/indmoney_export/gi, "INDMoney")
    .replace(/cas_pdf/gi, "CAS")
    .replace(/nps_statement/gi, "NPS")
    .replace(/epfo_passbook/gi, "EPFO")
    .replace(/\bMutual Fund\b/gi, "MF")
    .replace(/\bInstitution\b/gi, "Inst")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized || normalized === "0") return "Other";
  if (["Direct stocks", "Equity MF", "Debt MF", "Cash balance"].includes(normalized)) return normalized;
  if (/^[A-Z]{1,6}$/.test(normalized)) return normalized;

  const issuer = issuerAlias(normalized);
  const strategy = strategyAlias(normalized);
  if (issuer && strategy) return compactChartLabel(issuer + " " + strategy, 24);
  if (issuer) return issuer;
  if (strategy) return compactChartLabel(strategy, 24);
  return compactChartLabel(normalized, 24);
}

function issuerAlias(value: string): string | undefined {
  if (/Parag Parikh|PPFAS/i.test(value)) return "PPFAS";
  if (/ICICI Prudential/i.test(value)) return "ICICI Pru";
  if (/Motilal Oswal|\bOswal\b/i.test(value)) return "MO";
  if (/HDFC/i.test(value)) return "HDFC";
  if (/SBI Pension Fund|SBI PENSION FUND/i.test(value)) return "SBI NPS";
  if (/EPFO|EPF/i.test(value)) return "EPFO";
  if (/INDMoney/i.test(value)) return "INDMoney";
  return undefined;
}

function strategyAlias(value: string): string | undefined {
  if (/Nifty\s*50/i.test(value)) return "Nifty 50";
  if (/S&P\s*500/i.test(value)) return "S&P 500";
  if (/Gilt/i.test(value)) return "Gilt";
  if (/Flexi Cap/i.test(value)) return "Flexi";
  if (/Dynamic Asset Allocation/i.test(value)) return "Dynamic AA";
  if (/Conservative Hybrid|Conservative/i.test(value)) return "Conservative";
  if (/Ultra Short Term|Ultra ST/i.test(value)) return "Ultra ST";
  if (/Scheme\s*E|SCHEME E/i.test(value)) return "Scheme E";
  if (/Scheme\s*G|SCHEME G/i.test(value)) return "Scheme G";
  if (/Cash/i.test(value)) return "Cash";
  if (/ESPP/i.test(value)) return "ESPP";
  return undefined;
}

function compactChartLabel(value: string, max = 24): string {
  const cleaned = value
    .replace(/\b(Fund|Direct|Growth|Plan|Option|Index|Tier I|POP|MF)\b/gi, "")
    .replace(/\s+-\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= max) return cleaned;
  const words = cleaned.split(" ");
  let label = "";
  for (const word of words) {
    const next = label ? label + " " + word : word;
    if (next.length > max) break;
    label = next;
  }
  return label || cleaned.slice(0, max).trimEnd();
}

type TimelineChartPoint = PortfolioTimelinePoint & { ts: number; historicalCurrent: number | null; latestCurrent: number | null };

function timelineChartData(points: PortfolioTimelinePoint[]): TimelineChartPoint[] {
  const today = todayIso();
  return points.map((point) => ({
    ...point,
    ts: toTimestamp(point.date),
    historicalCurrent: point.date === today ? null : point.current,
    latestCurrent: point.date === today ? point.current : null
  }));
}

function timelineTicks(points: Array<{ ts: number }>): number[] {
  if (points.length === 0) return [];
  const ticks: number[] = [];
  const years = new Set<string>();
  for (const point of points) {
    const year = new Date(point.ts).getUTCFullYear().toString();
    if (!years.has(year)) {
      years.add(year);
      ticks.push(point.ts);
    }
  }
  const latest = points.at(-1)?.ts;
  if (latest && !ticks.includes(latest)) ticks.push(latest);
  return ticks;
}

function timelineTickLabel(value: number): string {
  const today = todayIso();
  if (dateFromTimestamp(value) === today) return "Today";
  return new Date(value).getUTCFullYear().toString();
}

function toTimestamp(date: string): number {
  return Date.parse(date + "T00:00:00.000Z");
}

function dateFromTimestamp(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function dateLabel(value: number): string {
  const date = dateFromTimestamp(value);
  return date === todayIso() ? date + " (today)" : date;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function latestAsOfDate(dates: string[]): string {
  return dates.filter(Boolean).sort().at(-1) ?? "unknown date";
}

function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseFormNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampGoalPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function normalizeGoalYearInput(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return String(new Date().getFullYear());
  return String(Math.min(2200, Math.max(1900, Math.round(parsed))));
}

function assetTypeLabel(type: PortfolioBackup["accounts"][number]["type"]): string {
  const labels: Record<PortfolioBackup["accounts"][number]["type"], string> = {
    mutual_fund: "Mutual Fund",
    indian_stock: "Indian Stock",
    us_stock: "US Stock",
    fd: "Fixed Deposit",
    ppf: "PPF",
    ssy: "SSY",
    nps: "NPS",
    epf: "PF / EPF",
    cash: "Cash",
    espp: "ESPP",
    gold: "Gold",
    other: "Other"
  };
  return labels[type];
}

function entryActionHint(action: ManualEntryAction, accountType?: PortfolioBackup["accounts"][number]["type"]): string {
  if (action.mode === "balance_snapshot") return "Updates the latest balance/units checkpoint without creating a synthetic transaction; use it for statement closing balances or manually valued assets.";
  if (accountType === "mutual_fund") return "Creates a mutual-fund ledger row with units, NAV, fees/tax, cost basis, XIRR cash flow, and latest value from the entered units/NAV until market refresh updates NAV.";
  if (accountType === "us_stock" || accountType === "indian_stock") return "Creates a stock trade or income row with quantity, price, fees/tax, cost basis, XIRR cash flow, and current value from the entered price until market refresh updates quotes.";
  if (accountType === "nps") return "Creates an NPS scheme transaction with units/NAV for contribution or internal switch accounting; later NPS statement imports can still validate balances.";
  if (accountType === "epf") return action.id === "interest_accrual" ? "Adds capitalized PF interest to current value without treating it as new invested capital." : "Adds a PF contribution, transfer, or withdrawal as a dated ledger row used by invested amount, P/L, and XIRR.";
  return "Creates a dated balance-ledger row used by invested amount, current value, profit/loss, and XIRR when there is enough cash-flow history.";
}

function viewTitle(view: View): string {
  if (view === "imports") return "Imports";
  if (view === "backup") return "Backup and Restore";
  if (view === "holdings") return "Holdings";
  if (view === "transactions") return "Transactions";
  if (view === "goals") return "Goals";
  if (view === "tax") return "Tax";
  if (view === "data") return "Data and Reconciliation";
  if (view === "settings") return "Settings";
  if (view === "snapshots") return "Snapshots";
  if (view === "add-entry") return "Add Entry";
  return "Portfolio Analytics";
}

function displayHoldingName(name: string): string {
  const cleaned = name.replace(/^Registrar\s*:\s*[^\s]+\s+/i, "").replace(/\s*\([^)]*\)/g, "").replace(/\s+formerly\s+.*$/i, "").replace(/\s+erstwhile\s+.*$/i, "").replace(/\s+-\s+Direct Plan\s+-\s+Growth Option/i, " Direct Growth").replace(/\s+-\s+Direct Plan\s+-\s+Growth/i, " Direct Growth").replace(/\s+-\s+Direct Plan Growth/i, " Direct Growth").replace(/\s+-\s+Direct Growth/i, " Direct Growth").replace(/\s+-\s+Growth Option/i, " Growth").replace(/\s+Plan\s+Growth/i, " Growth").replace(/\s+/g, " ").trim();
  return cleaned.length <= 58 ? cleaned : cleaned.slice(0, 55).trimEnd() + "...";
}

function transactionSearchText(tx: Transaction, backup: PortfolioBackup): string {
  const instrument = backup.instruments.find((item) => item.id === tx.instrumentId);
  const account = backup.accounts.find((item) => item.id === tx.accountId);
  return [tx.date, tx.type, tx.currency, tx.amount, tx.source.provider, instrument?.name, instrument?.symbol, account?.name, account?.institution].join(" ").toLowerCase();
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function compactMoney(value: number): string {
  if (Math.abs(value) >= 10000000) return `${(value / 10000000).toFixed(1)}Cr`;
  if (Math.abs(value) >= 100000) return `${(value / 100000).toFixed(1)}L`;
  return String(Math.round(value));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 6 }).format(value);
}
