import type { Account, AssetCategory, Instrument, ManualBalance, PortfolioBackup, Transaction } from "@/src/schema/backup";
import { calculateXirr } from "@/src/domain/xirr";

const categories: AssetCategory[] = ["Equity", "Debt", "Gold", "Others", "Cash"];

export type AllocationBucket = {
  value: number;
  percent: number;
};

export type PortfolioSummary = {
  netWorth: number;
  allocation: Record<AssetCategory, AllocationBucket>;
  missingFx: string[];
};

export type HoldingInsight = {
  id: string;
  label: string;
  category: AssetCategory;
  assetKind: string;
  accountType?: Account["type"];
  instrumentType?: Instrument["type"];
  region: string;
  currency: string;
  value: number;
  valueInBase?: number;
  quantity?: number;
  price?: number;
  asOfDate: string;
  provider: string;
  institution: string;
  issuer: string;
};

export type PortfolioInsights = {
  holdings: HoldingInsight[];
  totalsByCategory: Array<{ name: AssetCategory; value: number; percent: number }>;
  totalsByProvider: Array<{ name: string; value: number }>;
  totalsByInstitution: Array<{ name: string; value: number }>;
  totalsByIssuer: Array<{ name: string; value: number }>;
  totalsByAssetKind: Array<{ name: string; value: number }>;
  totalsByRegion: Array<{ name: string; value: number }>;
  transactionStats: {
    count: number;
    investedBase: number;
    incomeBase: number;
    feesAndTaxesBase: number;
    investedByCurrency: Record<string, number>;
    incomeByCurrency: Record<string, number>;
    feesAndTaxesByCurrency: Record<string, number>;
    missingFx: string[];
  };
  xirrBase: number | null;
  xirrByCurrency: Record<string, number | null>;
};

export function calculatePortfolioSummary(backup: PortfolioBackup): PortfolioSummary {
  const totals = Object.fromEntries(categories.map((category) => [category, 0])) as Record<AssetCategory, number>;
  const missingFx = new Set<string>();

  for (const balance of backup.manualBalances) {
    const converted = tryConvertToBase(balance.value, balance.currency, backup);
    if (converted === undefined) {
      missingFx.add(balance.currency + "/" + backup.baseCurrency);
    } else {
      totals[balance.category] += converted;
    }
  }

  const netWorth = Object.values(totals).reduce((sum, value) => sum + value, 0);
  const allocation = Object.fromEntries(
    categories.map((category) => [
      category,
      {
        value: roundMoney(totals[category]),
        percent: netWorth === 0 ? 0 : roundPercent((totals[category] / netWorth) * 100)
      }
    ])
  ) as Record<AssetCategory, AllocationBucket>;

  return { netWorth: roundMoney(netWorth), allocation, missingFx: [...missingFx].sort() };
}

export function calculatePortfolioInsights(backup: PortfolioBackup): PortfolioInsights {
  const summary = calculatePortfolioSummary(backup);
  const missing = new Set<string>();
  const holdings = backup.manualBalances.map((balance) => buildHoldingInsight(balance, backup, missing));
  const totalsByCategory = categories.map((category) => ({ name: category, ...summary.allocation[category] }));
  const terminalFlowsByCurrency = terminalFlows(backup.manualBalances);
  const txFlowsByCurrency = transactionFlows(backup.transactions);
  const xirrByCurrency: Record<string, number | null> = {};

  for (const currency of new Set([...Object.keys(txFlowsByCurrency), ...Object.keys(terminalFlowsByCurrency)])) {
    xirrByCurrency[currency] = calculateXirr([...(txFlowsByCurrency[currency] ?? []), ...(terminalFlowsByCurrency[currency] ?? [])]);
  }

  const baseTxFlows = transactionFlowsInBase(backup.transactions, backup, missing);
  const baseTerminalFlows = terminalFlowsInBase(backup.manualBalances, backup, missing);
  const stats = transactionStats(backup.transactions, backup, missing);

  return {
    holdings: holdings.sort((a, b) => (b.valueInBase ?? 0) - (a.valueInBase ?? 0)),
    totalsByCategory,
    totalsByProvider: groupHoldings(holdings, "provider"),
    totalsByInstitution: groupHoldings(holdings, "institution"),
    totalsByIssuer: groupHoldings(holdings, "issuer"),
    totalsByAssetKind: groupHoldings(holdings, "assetKind"),
    totalsByRegion: groupHoldings(holdings, "region"),
    transactionStats: { ...stats, missingFx: [...missing].sort() },
    xirrBase: missing.size > 0 ? null : calculateXirr([...baseTxFlows, ...baseTerminalFlows]),
    xirrByCurrency
  };
}

export function calculateNetWorth(backup: PortfolioBackup): number {
  return roundMoney(
    backup.manualBalances.reduce((total, balance) => total + convertToBase(balance.value, balance.currency, backup), 0)
  );
}

export function calculateAllocation(backup: PortfolioBackup): Record<AssetCategory, AllocationBucket> {
  const totals = Object.fromEntries(categories.map((category) => [category, 0])) as Record<AssetCategory, number>;

  for (const balance of backup.manualBalances) {
    totals[balance.category] += convertToBase(balance.value, balance.currency, backup);
  }

  const netWorth = Object.values(totals).reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(
    categories.map((category) => [
      category,
      {
        value: roundMoney(totals[category]),
        percent: netWorth === 0 ? 0 : roundPercent((totals[category] / netWorth) * 100)
      }
    ])
  ) as Record<AssetCategory, AllocationBucket>;
}

export function convertToBase(value: number, currency: string, backup: PortfolioBackup, asOfDate?: string): number {
  const converted = tryConvertToBase(value, currency, backup, asOfDate);
  if (converted === undefined) {
    throw new Error("Missing FX rate for " + currency + "/" + backup.baseCurrency + (asOfDate ? " on " + asOfDate : ""));
  }
  return converted;
}

export function tryConvertToBase(value: number, currency: string, backup: PortfolioBackup, asOfDate?: string): number | undefined {
  if (currency === backup.baseCurrency) return value;
  const fx = findFxRate(currency, backup.baseCurrency, backup, asOfDate);
  if (!fx) return undefined;
  return value * fx.price;
}

export function findFxRate(from: string, to: string, backup: PortfolioBackup, asOfDate?: string) {
  const pair = from + to;
  const snapshots = backup.priceSnapshots
    .filter((snapshot) => snapshot.instrumentId === pair && snapshot.currency === to)
    .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate) || a.createdAt.localeCompare(b.createdAt));
  if (snapshots.length === 0) return undefined;
  if (!asOfDate) return snapshots[snapshots.length - 1];
  return snapshots.filter((snapshot) => snapshot.asOfDate <= asOfDate).at(-1);
}

function buildHoldingInsight(balance: ManualBalance, backup: PortfolioBackup, missingFx: Set<string>): HoldingInsight {
  const account = backup.accounts.find((item) => item.id === balance.accountId);
  const instrument = balance.instrumentId ? backup.instruments.find((item) => item.id === balance.instrumentId) : undefined;
  const valueInBase = tryConvertToBase(balance.value, balance.currency, backup);
  if (valueInBase === undefined) missingFx.add(balance.currency + "/" + backup.baseCurrency);

  return {
    id: balance.id,
    label: balance.label,
    category: balance.category,
    assetKind: assetKind(instrument, account),
    accountType: account?.type,
    instrumentType: instrument?.type,
    region: region(instrument, account, balance.currency),
    currency: balance.currency,
    value: balance.value,
    valueInBase: valueInBase === undefined ? undefined : roundMoney(valueInBase),
    quantity: balance.quantity,
    price: balance.price,
    asOfDate: balance.asOfDate,
    provider: balance.source.provider ?? balance.source.type,
    institution: account?.institution ?? balance.source.provider ?? "Manual",
    issuer: instrument?.issuer ?? account?.institution ?? balance.source.provider ?? "Manual"
  };
}

function groupHoldings(holdings: HoldingInsight[], key: "provider" | "institution" | "issuer" | "assetKind" | "region"): Array<{ name: string; value: number }> {
  const totals = new Map<string, number>();
  for (const holding of holdings) {
    totals.set(holding[key], (totals.get(holding[key]) ?? 0) + (holding.valueInBase ?? 0));
  }
  return [...totals.entries()]
    .map(([name, value]) => ({ name, value: roundMoney(value) }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);
}

function transactionStats(transactions: Transaction[], backup: PortfolioBackup, missingFx: Set<string>): PortfolioInsights["transactionStats"] {
  const investedByCurrency: Record<string, number> = {};
  const incomeByCurrency: Record<string, number> = {};
  const feesAndTaxesByCurrency: Record<string, number> = {};
  let investedBase = 0;
  let incomeBase = 0;
  let feesAndTaxesBase = 0;

  for (const tx of transactions) {
    const converted = tryConvertToBase(tx.amount, tx.currency, backup, tx.date);
    const convertedFees = tx.fees ? tryConvertToBase(tx.fees, tx.currency, backup, tx.date) : 0;
    const convertedTaxes = tx.taxes ? tryConvertToBase(tx.taxes, tx.currency, backup, tx.date) : 0;
    if ((converted === undefined || convertedFees === undefined || convertedTaxes === undefined) && tx.currency !== backup.baseCurrency) {
      missingFx.add(tx.currency + "/" + backup.baseCurrency + " on/after " + tx.date);
    }

    if (["buy", "sip", "deposit", "contribution"].includes(tx.type)) {
      add(investedByCurrency, tx.currency, tx.amount);
      if (converted !== undefined) investedBase += converted;
    }
    if (["sell", "redemption", "dividend", "interest", "maturity", "withdrawal"].includes(tx.type)) {
      add(incomeByCurrency, tx.currency, tx.amount);
      if (converted !== undefined) incomeBase += converted;
    }
    if (["fee", "tax"].includes(tx.type)) {
      add(feesAndTaxesByCurrency, tx.currency, tx.amount);
      if (converted !== undefined) feesAndTaxesBase += converted;
    }
    if (tx.fees) {
      add(feesAndTaxesByCurrency, tx.currency, tx.fees);
      if (convertedFees !== undefined) feesAndTaxesBase += convertedFees;
    }
    if (tx.taxes) {
      add(feesAndTaxesByCurrency, tx.currency, tx.taxes);
      if (convertedTaxes !== undefined) feesAndTaxesBase += convertedTaxes;
    }
  }

  return {
    count: transactions.length,
    investedBase: roundMoney(investedBase),
    incomeBase: roundMoney(incomeBase),
    feesAndTaxesBase: roundMoney(feesAndTaxesBase),
    investedByCurrency: roundRecord(investedByCurrency),
    incomeByCurrency: roundRecord(incomeByCurrency),
    feesAndTaxesByCurrency: roundRecord(feesAndTaxesByCurrency),
    missingFx: []
  };
}

function transactionFlows(transactions: Transaction[]): Record<string, Array<{ date: string; amount: number }>> {
  const flows: Record<string, Array<{ date: string; amount: number }>> = {};
  for (const tx of transactions) {
    const signed = signedTransactionAmount(tx);
    if (signed === 0) continue;
    flows[tx.currency] ??= [];
    flows[tx.currency].push({ date: tx.date, amount: signed });
  }
  return flows;
}

function transactionFlowsInBase(transactions: Transaction[], backup: PortfolioBackup, missingFx: Set<string>): Array<{ date: string; amount: number }> {
  const flows: Array<{ date: string; amount: number }> = [];
  for (const tx of transactions) {
    const signed = signedTransactionAmount(tx);
    if (signed === 0) continue;
    const converted = tryConvertToBase(signed, tx.currency, backup, tx.date);
    if (converted === undefined) {
      if (tx.currency !== backup.baseCurrency) missingFx.add(tx.currency + "/" + backup.baseCurrency + " on/after " + tx.date);
      continue;
    }
    flows.push({ date: tx.date, amount: converted });
  }
  return flows;
}

function terminalFlows(balances: ManualBalance[]): Record<string, Array<{ date: string; amount: number }>> {
  const flows: Record<string, Array<{ date: string; amount: number }>> = {};
  for (const balance of balances) {
    if (balance.value === 0) continue;
    flows[balance.currency] ??= [];
    flows[balance.currency].push({ date: balance.asOfDate, amount: balance.value });
  }
  return flows;
}

function terminalFlowsInBase(balances: ManualBalance[], backup: PortfolioBackup, missingFx: Set<string>): Array<{ date: string; amount: number }> {
  const flows: Array<{ date: string; amount: number }> = [];
  for (const balance of balances) {
    if (balance.value === 0) continue;
    const converted = tryConvertToBase(balance.value, balance.currency, backup);
    if (converted === undefined) {
      if (balance.currency !== backup.baseCurrency) missingFx.add(balance.currency + "/" + backup.baseCurrency);
      continue;
    }
    flows.push({ date: balance.asOfDate, amount: converted });
  }
  return flows;
}

function signedTransactionAmount(tx: Transaction): number {
  if (["buy", "sip", "deposit", "contribution", "fee", "tax"].includes(tx.type)) return -Math.abs(tx.amount);
  if (["sell", "redemption", "dividend", "interest", "maturity", "withdrawal"].includes(tx.type)) return Math.abs(tx.amount);
  return 0;
}

function assetKind(instrument?: Instrument, account?: Account): string {
  const type = instrument?.type ?? account?.type;
  if (type === "mutual_fund") return "Mutual Fund";
  if (type === "indian_stock" || type === "us_stock") return "Direct Stock";
  if (type === "cash") return "Cash";
  if (type === "fd") return "Fixed Deposit";
  if (type === "ppf") return "PPF";
  if (type === "ssy") return "SSY";
  if (type === "nps") return "NPS";
  if (type === "epf") return "PF";
  if (type === "gold") return "Gold";
  if (type === "espp") return "ESPP";
  return "Other";
}

function region(instrument?: Instrument, account?: Account, currency?: string): string {
  if (instrument?.country === "US" || account?.currency === "USD" || currency === "USD") return "US";
  if (instrument?.country === "IN" || account?.currency === "INR" || currency === "INR") return "India";
  return "Other";
}

function add(record: Record<string, number>, key: string, value: number) {
  record[key] = (record[key] ?? 0) + value;
}

function roundRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, roundMoney(value)]));
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundPercent(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
