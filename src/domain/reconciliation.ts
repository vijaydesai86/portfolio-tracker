import { tryConvertToBase } from "@/src/domain/analytics";
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
  sourceTotals: Array<{ source: string; holdings: number; transactions: number; value: number }>;
  validationRows: Array<{ label: string; expected?: number; actual?: number; status: "ok" | "warn" | "info"; detail: string }>;
};

export function buildReconciliationReport(backup: PortfolioBackup): ReconciliationReport {
  const sourceTotals = buildSourceTotals(backup);
  const marketDataGaps = buildMarketDataGaps(backup);
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
    sourceTotals,
    validationRows
  };
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
