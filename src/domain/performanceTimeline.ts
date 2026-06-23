import { tryConvertToBase } from "@/src/domain/analytics";
import type { Account, AssetCategory, Instrument, ManualBalance, PortfolioBackup, PriceSnapshot, Transaction } from "@/src/schema/backup";

export type TimelineBreakdowns = {
  category: Record<string, number>;
  region: Record<string, number>;
  assetKind: Record<string, number>;
  issuer: Record<string, number>;
};

export type PortfolioTimelinePoint = TimelineBreakdowns & {
  date: string;
  invested: number;
  current: number | null;
  profit: number | null;
};

export type PortfolioTimeline = {
  points: PortfolioTimelinePoint[];
  coverage: { pricedDates: number; totalDates: number; firstDate?: string; latestDate?: string };
};

const cashInTypes = new Set<Transaction["type"]>(["buy", "sip", "deposit", "contribution"]);
const cashOutTypes = new Set<Transaction["type"]>(["sell", "redemption", "dividend", "interest", "maturity", "withdrawal"]);
const unitInTypes = new Set<Transaction["type"]>(["buy", "sip", "deposit", "contribution", "switch_in"]);
const unitOutTypes = new Set<Transaction["type"]>(["sell", "redemption", "withdrawal", "maturity", "switch_out", "fee", "tax"]);

export function buildPortfolioTimeline(backup: PortfolioBackup): PortfolioTimeline {
  const dates = timelineDates(backup);
  const points = dates.map((date) => buildPoint(backup, date));
  const pricedDates = points.filter((point) => point.current !== null).length;
  return {
    points,
    coverage: { pricedDates, totalDates: points.length, firstDate: points[0]?.date, latestDate: points.at(-1)?.date }
  };
}

function buildPoint(backup: PortfolioBackup, date: string): PortfolioTimelinePoint {
  const investedBreakdown = emptyBreakdowns();
  let invested = 0;
  const units = new Map<string, number>();
  const capitalizedValue = new Map<string, number>();

  for (const tx of backup.transactions.filter((item) => item.date <= date).sort((a, b) => a.date.localeCompare(b.date))) {
    const converted = tryConvertToBase(tx.amount, tx.currency, backup, tx.date);
    const amount = converted === undefined ? undefined : Math.abs(converted);
    const dimensions = transactionDimensions(tx, backup);

    if (amount !== undefined && cashInTypes.has(tx.type)) {
      invested += amount;
      addBreakdowns(investedBreakdown, dimensions, amount);
    }
    if (amount !== undefined && cashOutTypes.has(tx.type)) {
      invested -= amount;
      addBreakdowns(investedBreakdown, dimensions, -amount);
    }

    if (tx.quantity !== undefined) {
      const previous = units.get(tx.instrumentId) ?? 0;
      if (unitInTypes.has(tx.type)) units.set(tx.instrumentId, previous + Math.abs(tx.quantity));
      if (unitOutTypes.has(tx.type)) units.set(tx.instrumentId, previous - Math.abs(tx.quantity));
    }

    if (amount !== undefined && tx.type === "interest_accrual") {
      capitalizedValue.set(tx.instrumentId, (capitalizedValue.get(tx.instrumentId) ?? 0) + amount);
    }
    if (amount !== undefined && cashInTypes.has(tx.type) && isCapitalizedAccount(tx, backup)) {
      capitalizedValue.set(tx.instrumentId, (capitalizedValue.get(tx.instrumentId) ?? 0) + amount);
    }
    if (amount !== undefined && cashOutTypes.has(tx.type) && isCapitalizedAccount(tx, backup)) {
      capitalizedValue.set(tx.instrumentId, (capitalizedValue.get(tx.instrumentId) ?? 0) - amount);
    }
  }

  const currentBreakdown = emptyBreakdowns();
  const activePositions = new Set<string>();
  const valuedPositions = new Set<string>();
  const valuedInstruments = new Set<string>();
  let current = 0;

  for (const [instrumentId, quantity] of units.entries()) {
    if (Math.abs(quantity) < 0.000001) continue;
    activePositions.add("instrument:" + instrumentId);
    const price = latestPrice(backup.priceSnapshots, instrumentId, date);
    if (!price) continue;
    const value = tryConvertToBase(quantity * price.price, price.currency, backup, price.asOfDate);
    if (value === undefined) continue;
    const dimensions = instrumentDimensions(instrumentId, backup);
    current += value;
    addBreakdowns(currentBreakdown, dimensions, value);
    valuedInstruments.add(instrumentId);
    valuedPositions.add("instrument:" + instrumentId);
  }

  for (const [instrumentId, value] of capitalizedValue.entries()) {
    if (value <= 0) continue;
    activePositions.add("instrument:" + instrumentId);
    if (valuedInstruments.has(instrumentId)) continue;
    const dimensions = instrumentDimensions(instrumentId, backup);
    current += value;
    addBreakdowns(currentBreakdown, dimensions, value);
    valuedInstruments.add(instrumentId);
    valuedPositions.add("instrument:" + instrumentId);
  }

  for (const balance of backup.manualBalances.filter((item) => item.asOfDate <= date)) {
    const positionKey = balance.instrumentId ? "instrument:" + balance.instrumentId : "balance:" + balance.id;
    activePositions.add(positionKey);
    if (balance.instrumentId && valuedInstruments.has(balance.instrumentId)) continue;
    const value = tryConvertToBase(balance.value, balance.currency, backup, balance.asOfDate);
    if (value === undefined) continue;
    current += value;
    addBreakdowns(currentBreakdown, balanceDimensions(balance, backup), value);
    valuedPositions.add(positionKey);
  }

  const hasCompleteValuation = activePositions.size > 0 && valuedPositions.size === activePositions.size;
  const roundedCurrent = hasCompleteValuation && current > 0 ? roundMoney(current) : null;
  return {
    date,
    invested: roundMoney(invested),
    current: roundedCurrent,
    profit: roundedCurrent === null ? null : roundMoney(roundedCurrent - invested),
    category: roundBreakdown(currentBreakdown.category),
    region: roundBreakdown(currentBreakdown.region),
    assetKind: roundBreakdown(currentBreakdown.assetKind),
    issuer: topBreakdown(roundBreakdown(currentBreakdown.issuer), 12)
  };
}

function timelineDates(backup: PortfolioBackup): string[] {
  const dates = new Set<string>();
  for (const tx of backup.transactions) dates.add(tx.date);
  for (const balance of backup.manualBalances) dates.add(balance.asOfDate);
  for (const snapshot of backup.priceSnapshots) {
    if (!isFxSnapshot(snapshot)) dates.add(snapshot.asOfDate);
  }
  return [...dates].filter(Boolean).sort();
}

function latestPrice(snapshots: PriceSnapshot[], instrumentId: string, date: string): PriceSnapshot | undefined {
  return snapshots
    .filter((snapshot) => snapshot.instrumentId === instrumentId && snapshot.asOfDate <= date && !isFxSnapshot(snapshot))
    .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate) || a.createdAt.localeCompare(b.createdAt))
    .at(-1);
}

function isFxSnapshot(snapshot: PriceSnapshot): boolean {
  return /^[A-Z]{6}$/.test(snapshot.instrumentId) && snapshot.currency.length === 3;
}

function isCapitalizedAccount(tx: Transaction, backup: PortfolioBackup): boolean {
  const account = backup.accounts.find((item) => item.id === tx.accountId);
  const instrument = backup.instruments.find((item) => item.id === tx.instrumentId);
  return (instrument?.type ?? account?.type) === "epf";
}

function transactionDimensions(tx: Transaction, backup: PortfolioBackup): Dimensions {
  return instrumentDimensions(tx.instrumentId, backup, tx.accountId);
}

function instrumentDimensions(instrumentId: string, backup: PortfolioBackup, accountId?: string): Dimensions {
  const instrument = backup.instruments.find((item) => item.id === instrumentId);
  const account = accountId ? backup.accounts.find((item) => item.id === accountId) : backup.accounts.find((item) => item.type === instrument?.type);
  return {
    category: instrument?.category ?? "Others",
    region: region(instrument, account, instrument?.currency),
    assetKind: assetKind(instrument, account),
    issuer: instrument?.issuer ?? account?.institution ?? "Unassigned"
  };
}

function balanceDimensions(balance: ManualBalance, backup: PortfolioBackup): Dimensions {
  const instrument = balance.instrumentId ? backup.instruments.find((item) => item.id === balance.instrumentId) : undefined;
  const account = backup.accounts.find((item) => item.id === balance.accountId);
  return {
    category: balance.category,
    region: region(instrument, account, balance.currency),
    assetKind: assetKind(instrument, account),
    issuer: instrument?.issuer ?? account?.institution ?? balance.source.provider ?? "Manual"
  };
}

type Dimensions = { category: AssetCategory | string; region: string; assetKind: string; issuer: string };

function emptyBreakdowns(): TimelineBreakdowns {
  return { category: {}, region: {}, assetKind: {}, issuer: {} };
}

function addBreakdowns(target: TimelineBreakdowns, dimensions: Dimensions, value: number) {
  add(target.category, dimensions.category, value);
  add(target.region, dimensions.region, value);
  add(target.assetKind, dimensions.assetKind, value);
  add(target.issuer, dimensions.issuer, value);
}

function add(record: Record<string, number>, key: string, value: number) {
  record[key] = (record[key] ?? 0) + value;
}

function roundBreakdown(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value > 0).map(([key, value]) => [key, roundMoney(value)]));
}

function topBreakdown(record: Record<string, number>, limit: number): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort((a, b) => b[1] - a[1]).slice(0, limit));
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

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
