import { findFxRate, tryConvertToBase } from "@/src/domain/analytics";
import { calculateHoldingReturns } from "@/src/domain/holdingReturns";
import type { PortfolioBackup } from "@/src/schema/backup";

export type ReconciliationReport = {
  summary: {
    imports: number;
    documents: number;
    holdings: number;
    transactions: number;
    priceSnapshots: number;
    marketDataGaps: number;
    parserWarnings: number;
  };
  imports: Array<{ id: string; label: string; provider: string; status: string; confidence: string; records: number; documents: number; createdAt: string }>;
  marketDataGaps: Array<{ kind: "fx" | "price" | "nav"; label: string; date?: string; severity: "warn" | "critical" }>;
  marketDataHealth: Array<{ kind: "fx" | "price" | "nav"; label: string; status: "covered" | "missing" | "stale"; severity: "info" | "warn" | "critical"; source?: string; asOfDate?: string; detail: string }>;
  dataQuality: { score: number; blockers: number; warnings: number; rows: Array<{ area: string; status: "ok" | "warning" | "blocker"; score: number; detail: string }> };
  sourceTotals: Array<{ source: string; holdings: number; transactions: number; value: number }>;
  validationRows: Array<{ label: string; expected?: number; actual?: number; status: "ok" | "warn" | "info"; detail: string }>;
};

export function buildReconciliationReport(backup: PortfolioBackup): ReconciliationReport {
  const sourceTotals = buildSourceTotals(backup);
  const marketDataGaps = buildMarketDataGaps(backup);
  const marketDataHealth = buildMarketDataHealth(backup);
  const dataQuality = buildDataQuality(backup, marketDataGaps);
  const imports = backup.imports.map((run) => {
    const holdings = backup.manualBalances.filter((balance) => balance.source.importId === run.id).length;
    const transactions = backup.transactions.filter((tx) => tx.source.importId === run.id).length;
    const documents = backup.sourceDocuments.filter((doc) => doc.importId === run.id).length;
    return {
      id: run.id,
      label: run.label ?? run.fileName ?? run.id,
      provider: run.provider,
      status: run.status,
      confidence: run.confidence,
      records: holdings + transactions,
      documents,
      createdAt: run.createdAt
    };
  });
  const validationRows = [
    {
      label: "Holdings ledger",
      expected: backup.manualBalances.length,
      actual: backup.manualBalances.filter((balance) => Number.isFinite(balance.value)).length,
      status: backup.manualBalances.every((balance) => Number.isFinite(balance.value)) ? "ok" as const : "warn" as const,
      detail: "Every holding should carry a finite current value in its holding currency."
    },
    {
      label: "Transaction ledger",
      expected: backup.transactions.length,
      actual: backup.transactions.filter((tx) => Number.isFinite(tx.amount)).length,
      status: backup.transactions.every((tx) => Number.isFinite(tx.amount)) ? "ok" as const : "warn" as const,
      detail: "Every transaction should carry a finite amount before analytics can trust cash flows."
    },
    {
      label: "Market data coverage",
      expected: 0,
      actual: marketDataGaps.length,
      status: marketDataGaps.length === 0 ? "ok" as const : "warn" as const,
      detail: marketDataGaps.length === 0 ? "All current FX conversions are covered." : "Some current or transaction-date FX/price inputs need review."
    }
  ];
  return {
    summary: {
      imports: backup.imports.length,
      documents: backup.sourceDocuments.length,
      holdings: backup.manualBalances.length,
      transactions: backup.transactions.length,
      priceSnapshots: backup.priceSnapshots.length,
      marketDataGaps: marketDataGaps.length,
      parserWarnings: backup.imports.filter((run) => run.confidence === "low" || run.status === "failed").length
    },
    imports,
    marketDataGaps,
    marketDataHealth,
    dataQuality,
    sourceTotals,
    validationRows
  };
}

function buildDataQuality(backup: PortfolioBackup, marketDataGaps: ReconciliationReport["marketDataGaps"]): ReconciliationReport["dataQuality"] {
  const returns = calculateHoldingReturns(backup);
  const valuedHoldings = backup.manualBalances.filter((balance) => Number.isFinite(balance.value) && balance.value > 0);
  const criticalMarketGaps = marketDataGaps.filter((gap) => gap.severity === "critical").length;
  const marketStatus = criticalMarketGaps > 0 ? "blocker" : marketDataGaps.length > 0 ? "warning" : "ok";
  const marketScore = criticalMarketGaps > 0 ? 0 : marketDataGaps.length > 0 ? 70 : 100;

  const costBasisKnown = valuedHoldings.filter((balance) => returns.get(balance.id)?.costBasisKnown === true).length;
  const costBasisScore = valuedHoldings.length === 0 ? 100 : Math.round((costBasisKnown / valuedHoldings.length) * 100);

  const cashFlowHoldings = valuedHoldings.filter((balance) => returns.get(balance.id)?.hasCashFlows === true);
  const xirrAvailable = cashFlowHoldings.filter((balance) => typeof returns.get(balance.id)?.xirr === "number").length;
  const xirrScore = cashFlowHoldings.length === 0 ? 100 : Math.round((xirrAvailable / cashFlowHoldings.length) * 100);

  const referenceDate = latestHoldingDate(valuedHoldings) ?? todayIsoDate();
  const staleHoldings = valuedHoldings.filter((balance) => daysBetween(balance.asOfDate, referenceDate) > 30).length;
  const staleScore = valuedHoldings.length === 0 ? 100 : Math.round(((valuedHoldings.length - staleHoldings) / valuedHoldings.length) * 100);

  const rows: ReconciliationReport["dataQuality"]["rows"] = [
    {
      area: "Market data",
      status: marketStatus,
      score: marketScore,
      detail: marketDataGaps.length === 0 ? "No current FX, price, or NAV gaps detected." : criticalMarketGaps + " critical and " + (marketDataGaps.length - criticalMarketGaps) + " warning market-data gap(s)."
    },
    {
      area: "Cost basis",
      status: costBasisScore === 100 ? "ok" : "warning",
      score: costBasisScore,
      detail: costBasisKnown + "/" + valuedHoldings.length + " valued holding(s) have transaction-derived or explicit cost basis."
    },
    {
      area: "XIRR coverage",
      status: xirrScore === 100 ? "ok" : "warning",
      score: xirrScore,
      detail: cashFlowHoldings.length === 0 ? "No dated cash-flow holdings need XIRR yet." : xirrAvailable + "/" + cashFlowHoldings.length + " cash-flow holding(s) have computable XIRR."
    },
    {
      area: "Valuation freshness",
      status: staleHoldings === 0 ? "ok" : staleHoldings <= 2 ? "warning" : "blocker",
      score: staleScore,
      detail: staleHoldings === 0 ? "No holding valuation is older than 30 days relative to the latest holding date." : staleHoldings + "/" + valuedHoldings.length + " holding valuation(s) are older than 30 days."
    }
  ];
  const blockers = rows.filter((row) => row.status === "blocker").length;
  const warnings = rows.filter((row) => row.status === "warning").length;
  const score = rows.length === 0 ? 100 : Math.round(rows.reduce((sum, row) => sum + row.score, 0) / rows.length);
  return { score, blockers, warnings, rows };
}

function latestHoldingDate(holdings: PortfolioBackup["manualBalances"]): string | undefined {
  return holdings.map((holding) => holding.asOfDate).filter(Boolean).sort().at(-1);
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  const startMs = Date.parse(start + "T00:00:00.000Z");
  const endMs = Date.parse(end + "T00:00:00.000Z");
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return 0;
  return Math.max(0, Math.floor((endMs - startMs) / 86400000));
}

function buildSourceTotals(backup: PortfolioBackup): ReconciliationReport["sourceTotals"] {
  const rows = new Map<string, { source: string; holdings: number; transactions: number; value: number }>();
  for (const balance of backup.manualBalances) {
    const source = balance.source.provider ?? balance.source.type;
    const row = rows.get(source) ?? { source, holdings: 0, transactions: 0, value: 0 };
    row.holdings += 1;
    row.value += tryConvertToBase(balance.value, balance.currency, backup, balance.asOfDate) ?? 0;
    rows.set(source, row);
  }
  for (const tx of backup.transactions) {
    const source = tx.source.provider ?? tx.source.type;
    const row = rows.get(source) ?? { source, holdings: 0, transactions: 0, value: 0 };
    row.transactions += 1;
    rows.set(source, row);
  }
  return [...rows.values()].map((row) => ({ ...row, value: roundMoney(row.value) })).sort((a, b) => b.value - a.value || b.transactions - a.transactions);
}

function buildMarketDataHealth(backup: PortfolioBackup): ReconciliationReport["marketDataHealth"] {
  const rows: ReconciliationReport["marketDataHealth"] = [];
  const seen = new Set<string>();
  const push = (row: ReconciliationReport["marketDataHealth"][number]) => {
    const key = row.kind + "::" + row.label + "::" + (row.asOfDate ?? "") + "::" + row.status;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };
  for (const balance of backup.manualBalances) {
    if (balance.currency !== backup.baseCurrency) {
      const fx = findFxRate(balance.currency, backup.baseCurrency, backup, balance.asOfDate);
      if (fx) push({ kind: "fx", label: balance.label, status: "covered", severity: "info", source: fx.source, asOfDate: fx.asOfDate, detail: balance.currency + "/" + backup.baseCurrency + " covered by " + fx.source + " on " + fx.asOfDate + "." });
      else push({ kind: "fx", label: balance.label, status: "missing", severity: "critical", detail: "Missing " + balance.currency + "/" + backup.baseCurrency + " FX for holding valuation on " + balance.asOfDate + "." });
    }
    if (balance.quantity !== undefined && balance.quantity > 0) {
      if (balance.price !== undefined) push({ kind: priceKind(balance, backup), label: balance.label, status: "covered", severity: "info", source: "holding", asOfDate: balance.asOfDate, detail: "Current price is present on the holding snapshot." });
      else push({ kind: priceKind(balance, backup), label: balance.label, status: "missing", severity: "warn", asOfDate: balance.asOfDate, detail: "Quantity exists but current price is missing." });
    }
  }
  for (const tx of backup.transactions) {
    if (tx.currency === backup.baseCurrency) continue;
    const fx = findFxRate(tx.currency, backup.baseCurrency, backup, tx.date);
    if (fx) push({ kind: "fx", label: transactionLabel(tx, backup), status: "covered", severity: "info", source: fx.source, asOfDate: fx.asOfDate, detail: tx.currency + "/" + backup.baseCurrency + " covered for transaction date " + tx.date + "." });
    else push({ kind: "fx", label: transactionLabel(tx, backup), status: "missing", severity: "critical", detail: "Missing " + tx.currency + "/" + backup.baseCurrency + " FX for transaction on " + tx.date + "." });
  }
  return rows.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
}

function priceKind(balance: PortfolioBackup["manualBalances"][number], backup: PortfolioBackup): "price" | "nav" {
  const account = backup.accounts.find((item) => item.id === balance.accountId);
  return account?.type === "mutual_fund" || account?.type === "nps" ? "nav" : "price";
}

function transactionLabel(tx: PortfolioBackup["transactions"][number], backup: PortfolioBackup): string {
  return backup.instruments.find((instrument) => instrument.id === tx.instrumentId)?.name ?? tx.instrumentId;
}

function severityRank(severity: "info" | "warn" | "critical"): number {
  if (severity === "critical") return 3;
  if (severity === "warn") return 2;
  return 1;
}

function buildMarketDataGaps(backup: PortfolioBackup): ReconciliationReport["marketDataGaps"] {
  const gaps: ReconciliationReport["marketDataGaps"] = [];
  const seen = new Set<string>();
  const addGap = (kind: "fx" | "price" | "nav", label: string, date?: string, severity: "warn" | "critical" = "warn") => {
    const key = kind + label + (date ?? "");
    if (seen.has(key)) return;
    seen.add(key);
    gaps.push({ kind, label, date, severity });
  };
  for (const balance of backup.manualBalances) {
    if (balance.currency !== backup.baseCurrency && tryConvertToBase(balance.value, balance.currency, backup, balance.asOfDate) === undefined) {
      addGap("fx", `${balance.currency}/${backup.baseCurrency}`, balance.asOfDate, "critical");
    }
    if (balance.quantity !== undefined && balance.quantity > 0 && balance.price === undefined) {
      addGap("price", balance.label, balance.asOfDate, "warn");
    }
  }
  for (const tx of backup.transactions) {
    if (tx.currency !== backup.baseCurrency && tryConvertToBase(tx.amount, tx.currency, backup, tx.date) === undefined) {
      addGap("fx", `${tx.currency}/${backup.baseCurrency}`, tx.date, "critical");
    }
  }
  return gaps.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.label.localeCompare(b.label));
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
