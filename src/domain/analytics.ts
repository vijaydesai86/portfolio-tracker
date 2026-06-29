import type { Account, AssetCategory, Instrument, ManualBalance, PortfolioBackup, TaperMode, Transaction } from "@/src/schema/backup";
import { calculateXirr } from "@/src/domain/xirr";
import { calculateTrackedLocalValue } from "@/src/domain/tapering";
import { assetKindDimension, cleanDimension, issuerOrPlatformDimension, regionDimension } from "@/src/domain/dimensions";

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
  taperMode?: TaperMode;
  taperFactor?: number;
  taperLabel: string;
  taperApplied: boolean;
  trackedValue?: number;
  trackedValueInBase?: number;
  trackedPrice?: number;
  taperDetail: string;
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
    externalCashInBase: number;
    externalCashOutBase: number;
    tradeBuyBase: number;
    tradeSellBase: number;
    externalCashInByCurrency: Record<string, number>;
    externalCashOutByCurrency: Record<string, number>;
    tradeBuyByCurrency: Record<string, number>;
    tradeSellByCurrency: Record<string, number>;
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
  const txFlowsByCurrency = transactionFlows(backup.transactions, backup);
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
  const tracked = calculateTrackedLocalValue(balance);
  const trackedValueInBase = tryConvertToBase(tracked.trackedLocalValue, balance.currency, backup);

  return {
    id: balance.id,
    label: balance.label,
    category: balance.category,
    assetKind: assetKindDimension(instrument, account),
    accountType: account?.type,
    instrumentType: instrument?.type,
    region: regionDimension(instrument, account, balance.currency),
    currency: balance.currency,
    value: balance.value,
    valueInBase: valueInBase === undefined ? undefined : roundMoney(valueInBase),
    quantity: balance.quantity,
    price: balance.price,
    taperMode: balance.taperMode,
    taperFactor: balance.taperFactor,
    taperLabel: tracked.label,
    taperApplied: tracked.applied,
    trackedValue: tracked.trackedLocalValue,
    trackedValueInBase: trackedValueInBase === undefined ? undefined : roundMoney(trackedValueInBase),
    trackedPrice: tracked.trackedPrice,
    taperDetail: tracked.applied ? "k=" + tracked.factor.toFixed(2) : tracked.reason,
    asOfDate: balance.asOfDate,
    provider: cleanDimension(balance.source.provider) ?? balance.source.type,
    institution: cleanDimension(account?.institution) ?? cleanDimension(balance.source.provider) ?? "Manual",
    issuer: issuerOrPlatformDimension(instrument, account, balance.source.provider)
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
  const externalCashInByCurrency: Record<string, number> = {};
  const externalCashOutByCurrency: Record<string, number> = {};
  const tradeBuyByCurrency: Record<string, number> = {};
  const tradeSellByCurrency: Record<string, number> = {};
  let investedBase = 0;
  let incomeBase = 0;
  let feesAndTaxesBase = 0;
  let externalCashInBase = 0;
  let externalCashOutBase = 0;
  let tradeBuyBase = 0;
  let tradeSellBase = 0;

  for (const tx of transactions) {
    const converted = tryConvertToBase(tx.amount, tx.currency, backup, tx.date);
    const convertedFees = tx.fees ? tryConvertToBase(tx.fees, tx.currency, backup, tx.date) : 0;
    const convertedTaxes = tx.taxes ? tryConvertToBase(tx.taxes, tx.currency, backup, tx.date) : 0;
    if ((converted === undefined || convertedFees === undefined || convertedTaxes === undefined) && tx.currency !== backup.baseCurrency) {
      missingFx.add(tx.currency + "/" + backup.baseCurrency + " on/after " + tx.date);
    }

    const amount = Math.abs(tx.amount);
    const role = portfolioFlowRole(tx, backup);
    if (role === "capital_in") {
      add(investedByCurrency, tx.currency, amount);
      add(externalCashInByCurrency, tx.currency, amount);
      if (converted !== undefined) {
        investedBase += Math.abs(converted);
        externalCashInBase += Math.abs(converted);
      }
    }
    if (role === "capital_out") {
      add(incomeByCurrency, tx.currency, amount);
      add(externalCashOutByCurrency, tx.currency, amount);
      if (converted !== undefined) {
        incomeBase += Math.abs(converted);
        externalCashOutBase += Math.abs(converted);
      }
    }
    if (tradeBuyTypes.has(tx.type)) {
      add(tradeBuyByCurrency, tx.currency, amount);
      if (converted !== undefined) tradeBuyBase += Math.abs(converted);
    }
    if (tradeSellTypes.has(tx.type)) {
      add(tradeSellByCurrency, tx.currency, amount);
      if (converted !== undefined) tradeSellBase += Math.abs(converted);
    }
    if (["fee", "tax"].includes(tx.type)) {
      add(feesAndTaxesByCurrency, tx.currency, amount);
      if (converted !== undefined) feesAndTaxesBase += Math.abs(converted);
    }
    if (tx.fees) {
      add(feesAndTaxesByCurrency, tx.currency, Math.abs(tx.fees));
      if (convertedFees !== undefined) feesAndTaxesBase += Math.abs(convertedFees);
    }
    if (tx.taxes) {
      add(feesAndTaxesByCurrency, tx.currency, Math.abs(tx.taxes));
      if (convertedTaxes !== undefined) feesAndTaxesBase += Math.abs(convertedTaxes);
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
    externalCashInBase: roundMoney(externalCashInBase),
    externalCashOutBase: roundMoney(externalCashOutBase),
    tradeBuyBase: roundMoney(tradeBuyBase),
    tradeSellBase: roundMoney(tradeSellBase),
    externalCashInByCurrency: roundRecord(externalCashInByCurrency),
    externalCashOutByCurrency: roundRecord(externalCashOutByCurrency),
    tradeBuyByCurrency: roundRecord(tradeBuyByCurrency),
    tradeSellByCurrency: roundRecord(tradeSellByCurrency),
    missingFx: []
  };
}

function transactionFlows(transactions: Transaction[], backup: PortfolioBackup): Record<string, Array<{ date: string; amount: number }>> {
  const flows: Record<string, Array<{ date: string; amount: number }>> = {};
  for (const tx of transactions) {
    const signed = signedPortfolioTransactionAmount(tx, backup);
    if (signed === 0) continue;
    flows[tx.currency] ??= [];
    flows[tx.currency].push({ date: tx.date, amount: signed });
  }
  return flows;
}

function transactionFlowsInBase(transactions: Transaction[], backup: PortfolioBackup, missingFx: Set<string>): Array<{ date: string; amount: number }> {
  const flows: Array<{ date: string; amount: number }> = [];
  for (const tx of transactions) {
    const signed = signedPortfolioTransactionAmount(tx, backup);
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

const capitalInTypes = new Set<Transaction["type"]>(["buy", "sip", "deposit", "contribution"]);
const capitalOutTypes = new Set<Transaction["type"]>(["sell", "redemption", "dividend", "interest", "maturity", "withdrawal"]);
const tradeBuyTypes = new Set<Transaction["type"]>(["buy", "sip"]);
const tradeSellTypes = new Set<Transaction["type"]>(["sell", "redemption"]);

type PortfolioFlowRole = "capital_in" | "capital_out" | "internal" | "fee_tax" | "none";

export function signedPortfolioTransactionAmount(tx: Transaction, backup: PortfolioBackup): number {
  const charges = Math.abs(tx.fees ?? 0) + Math.abs(tx.taxes ?? 0);
  const role = portfolioFlowRole(tx, backup);
  if (role === "capital_in") return -(Math.abs(tx.amount) + charges);
  if (role === "capital_out") return Math.abs(tx.amount) - charges;
  if (role === "fee_tax") return -Math.abs(tx.amount);
  return 0;
}

function portfolioFlowRole(tx: Transaction, backup: PortfolioBackup): PortfolioFlowRole {
  if (["split", "interest_accrual", "switch_in", "switch_out"].includes(tx.type)) return "none";
  if (["fee", "tax"].includes(tx.type)) return "fee_tax";

  const isCash = isCashTransaction(tx, backup);
  const providerHasCashLedger = transactionProviderHasCashLedger(tx, backup);

  if (tx.type === "deposit") return isCash ? "capital_in" : providerHasCashLedger ? "internal" : "capital_in";
  if (tx.type === "withdrawal") return isCash ? "capital_out" : providerHasCashLedger ? "internal" : "capital_out";
  if (tx.type === "contribution") return "capital_in";
  if (capitalInTypes.has(tx.type)) return providerHasCashLedger && !isCash ? "internal" : "capital_in";
  if (capitalOutTypes.has(tx.type)) return providerHasCashLedger && !isCash ? "internal" : "capital_out";
  return "none";
}

function transactionProviderHasCashLedger(tx: Transaction, backup: PortfolioBackup): boolean {
  const key = transactionProviderKey(tx, backup);
  return backup.transactions.some((item) => transactionProviderKey(item, backup) === key && isCashTransaction(item, backup) && ["deposit", "withdrawal"].includes(item.type));
}

function transactionProviderKey(tx: Transaction, backup: PortfolioBackup): string {
  const account = backup.accounts.find((item) => item.id === tx.accountId);
  return tx.source.provider ?? account?.institution ?? tx.accountId;
}

function isCashTransaction(tx: Transaction, backup: PortfolioBackup): boolean {
  const account = backup.accounts.find((item) => item.id === tx.accountId);
  const instrument = backup.instruments.find((item) => item.id === tx.instrumentId);
  return account?.type === "cash" || instrument?.type === "cash";
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
