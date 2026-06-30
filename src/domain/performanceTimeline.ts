import { calculatePortfolioSummary, signedPortfolioTransactionAmount, tryConvertToBase } from "@/src/domain/analytics";
import { assetKindDimension, issuerOrPlatformDimension, regionDimension } from "@/src/domain/dimensions";
import type { AssetCategory, ManualBalance, PortfolioBackup, PriceSnapshot, Transaction } from "@/src/schema/backup";

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
  holdingValues: Record<string, number>;
  holdingInvested: Record<string, number>;
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
  const latestDate = todayIso();
  const dates = timelineDates(backup, latestDate);
  const points = dates.map((date) => date === latestDate ? buildLatestPoint(backup, latestDate) : buildPoint(backup, date));
  const pricedDates = points.filter((point) => point.current !== null).length;
  return {
    points,
    coverage: { pricedDates, totalDates: points.length, firstDate: points[0]?.date, latestDate: points.at(-1)?.date }
  };
}

function buildLatestPoint(backup: PortfolioBackup, date: string): PortfolioTimelinePoint {
  if (backup.manualBalances.length === 0) return buildPoint(backup, date);

  const historicalPoint = buildPoint(backup, date);
  const currentBreakdown = emptyBreakdowns();
  let convertedCount = 0;

  for (const balance of backup.manualBalances) {
    const value = tryConvertToBase(balance.value, balance.currency, backup);
    if (value === undefined) continue;
    convertedCount += 1;
    addBreakdowns(currentBreakdown, balanceDimensions(balance, backup), value);
  }

  const summary = calculatePortfolioSummary(backup);
  const current = convertedCount > 0 ? summary.netWorth : null;
  return {
    date,
    invested: historicalPoint.invested,
    current,
    profit: current === null ? null : roundMoney(current - historicalPoint.invested),
    holdingValues: roundBreakdown(Object.fromEntries(backup.manualBalances.map((balance) => {
      const value = tryConvertToBase(balance.value, balance.currency, backup);
      return [balance.id, value ?? 0];
    }))),
    holdingInvested: historicalPoint.holdingInvested,
    category: roundBreakdown(currentBreakdown.category),
    region: roundBreakdown(currentBreakdown.region),
    assetKind: roundBreakdown(currentBreakdown.assetKind),
    issuer: topBreakdown(roundBreakdown(currentBreakdown.issuer), 12)
  };
}

function buildPoint(backup: PortfolioBackup, date: string): PortfolioTimelinePoint {
  const investedBreakdown = emptyBreakdowns();
  const holdingInvested: Record<string, number> = {};
  let invested = 0;
  const units = new Map<string, PositionQuantity>();
  const capitalizedValue = new Map<string, PositionValue>();

  for (const tx of backup.transactions.filter((item) => item.date <= date).sort((a, b) => a.date.localeCompare(b.date))) {
    const converted = tryConvertToBase(tx.amount, tx.currency, backup, tx.date);
    const amount = converted === undefined ? undefined : Math.abs(converted);
    const dimensions = transactionDimensions(tx, backup);

    const signedPortfolioFlow = signedPortfolioTransactionAmount(tx, backup);
    const convertedPortfolioFlow = signedPortfolioFlow === 0 ? undefined : tryConvertToBase(signedPortfolioFlow, tx.currency, backup, tx.date);
    if (convertedPortfolioFlow !== undefined && convertedPortfolioFlow < 0) {
      invested += Math.abs(convertedPortfolioFlow);
      addBreakdowns(investedBreakdown, dimensions, Math.abs(convertedPortfolioFlow));
      addHoldingAmount(holdingInvested, holdingIdForTransaction(tx, backup), Math.abs(convertedPortfolioFlow));
    }
    if (convertedPortfolioFlow !== undefined && convertedPortfolioFlow > 0) {
      invested -= convertedPortfolioFlow;
      addBreakdowns(investedBreakdown, dimensions, -convertedPortfolioFlow);
      addHoldingAmount(holdingInvested, holdingIdForTransaction(tx, backup), -convertedPortfolioFlow);
    }

    const key = positionKey(tx.accountId, tx.instrumentId);
    if (tx.quantity !== undefined) {
      const previous = units.get(key) ?? { accountId: tx.accountId, instrumentId: tx.instrumentId, quantity: 0 };
      if (unitInTypes.has(tx.type)) previous.quantity += Math.abs(tx.quantity);
      if (unitOutTypes.has(tx.type)) previous.quantity -= Math.abs(tx.quantity);
      units.set(key, previous);
    }

    if (amount !== undefined && (tx.type === "interest_accrual" || (cashInTypes.has(tx.type) && isCapitalizedAccount(tx, backup)))) {
      const previous = capitalizedValue.get(key) ?? { accountId: tx.accountId, instrumentId: tx.instrumentId, value: 0 };
      previous.value += amount;
      capitalizedValue.set(key, previous);
    }
    if (amount !== undefined && cashOutTypes.has(tx.type) && isCapitalizedAccount(tx, backup)) {
      const previous = capitalizedValue.get(key) ?? { accountId: tx.accountId, instrumentId: tx.instrumentId, value: 0 };
      previous.value -= amount;
      capitalizedValue.set(key, previous);
    }
  }

  const currentBreakdown = emptyBreakdowns();
  const holdingValues: Record<string, number> = {};
  const activePositions = new Set<string>();
  const valuedPositions = new Set<string>();
  let current = 0;

  for (const [key, position] of units.entries()) {
    if (Math.abs(position.quantity) < 0.000001) continue;
    activePositions.add(key);
    const price = latestPrice(backup.priceSnapshots, position.instrumentId, date);
    if (!price) continue;
    const value = tryConvertToBase(position.quantity * price.price, price.currency, backup, date);
    if (value === undefined) continue;
    const dimensions = instrumentDimensions(position.instrumentId, backup, position.accountId);
    current += value;
    addBreakdowns(currentBreakdown, dimensions, value);
    addHoldingAmount(holdingValues, holdingIdForPosition(backup, position.accountId, position.instrumentId), value);
    valuedPositions.add(key);
  }

  for (const [key, position] of capitalizedValue.entries()) {
    if (position.value <= 0) continue;
    activePositions.add(key);
    if (valuedPositions.has(key)) continue;
    const dimensions = instrumentDimensions(position.instrumentId, backup, position.accountId);
    current += position.value;
    addBreakdowns(currentBreakdown, dimensions, position.value);
    addHoldingAmount(holdingValues, holdingIdForPosition(backup, position.accountId, position.instrumentId), position.value);
    valuedPositions.add(key);
  }

  for (const balance of backup.manualBalances.filter((item) => item.asOfDate <= date)) {
    const key = balance.instrumentId ? positionKey(balance.accountId, balance.instrumentId) : "balance:" + balance.id;
    activePositions.add(key);
    if (valuedPositions.has(key)) continue;
    const value = tryConvertToBase(balance.value, balance.currency, backup, date);
    if (value === undefined) continue;
    current += value;
    addBreakdowns(currentBreakdown, balanceDimensions(balance, backup), value);
    addHoldingAmount(holdingValues, balance.id, value);
    valuedPositions.add(key);
  }

  const hasCompleteValuation = activePositions.size > 0 && valuedPositions.size === activePositions.size;
  const roundedCurrent = hasCompleteValuation && current > 0 ? roundMoney(current) : null;
  return {
    date,
    invested: roundMoney(invested),
    current: roundedCurrent,
    profit: roundedCurrent === null ? null : roundMoney(roundedCurrent - invested),
    holdingValues: roundBreakdown(holdingValues),
    holdingInvested: roundBreakdown(holdingInvested),
    category: roundBreakdown(currentBreakdown.category),
    region: roundBreakdown(currentBreakdown.region),
    assetKind: roundBreakdown(currentBreakdown.assetKind),
    issuer: topBreakdown(roundBreakdown(currentBreakdown.issuer), 12)
  };
}

function timelineDates(backup: PortfolioBackup, end: string): string[] {
  const sourceDates = new Set<string>();
  for (const tx of backup.transactions) sourceDates.add(tx.date);
  for (const balance of backup.manualBalances) sourceDates.add(balance.asOfDate);
  for (const snapshot of backup.priceSnapshots) {
    if (!isFxSnapshot(snapshot)) sourceDates.add(snapshot.asOfDate);
  }

  const sortedSourceDates = [...sourceDates].filter((date) => Boolean(date) && date <= end).sort();
  if (sortedSourceDates.length === 0) return backup.manualBalances.length > 0 ? [end] : [];

  const start = sortedSourceDates[0];
  const dates = new Set<string>([start, end]);
  let cursor = monthEnd(start);
  while (cursor < end) {
    if (cursor >= start) dates.add(cursor);
    cursor = nextMonthEnd(cursor);
  }

  return [...dates].sort();
}

function monthEnd(date: string): string {
  const parsed = parseIsoDate(date);
  const monthEndDate = new Date(Date.UTC(parsed.year, parsed.month + 1, 0));
  return toIsoDate(monthEndDate);
}

function nextMonthEnd(date: string): string {
  const parsed = parseIsoDate(date);
  const next = new Date(Date.UTC(parsed.year, parsed.month + 2, 0));
  return toIsoDate(next);
}

function parseIsoDate(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month: month - 1, day };
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}


function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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

function holdingIdForTransaction(tx: Transaction, backup: PortfolioBackup): string | undefined {
  return tx.instrumentId ? holdingIdForPosition(backup, tx.accountId, tx.instrumentId) : undefined;
}

function holdingIdForPosition(backup: PortfolioBackup, accountId: string, instrumentId: string): string | undefined {
  return backup.manualBalances.find((balance) => balance.accountId === accountId && balance.instrumentId === instrumentId)?.id;
}

function addHoldingAmount(record: Record<string, number>, holdingId: string | undefined, value: number) {
  if (!holdingId || !Number.isFinite(value) || value === 0) return;
  record[holdingId] = (record[holdingId] ?? 0) + value;
}

function instrumentDimensions(instrumentId: string, backup: PortfolioBackup, accountId?: string): Dimensions {
  const instrument = backup.instruments.find((item) => item.id === instrumentId);
  const account = accountId ? backup.accounts.find((item) => item.id === accountId) : undefined;
  return {
    category: instrument?.category ?? "Others",
    region: regionDimension(instrument, account, instrument?.currency),
    assetKind: assetKindDimension(instrument, account),
    issuer: issuerOrPlatformDimension(instrument, account)
  };
}

function balanceDimensions(balance: ManualBalance, backup: PortfolioBackup): Dimensions {
  const instrument = balance.instrumentId ? backup.instruments.find((item) => item.id === balance.instrumentId) : undefined;
  const account = backup.accounts.find((item) => item.id === balance.accountId);
  return {
    category: balance.category,
    region: regionDimension(instrument, account, balance.currency),
    assetKind: assetKindDimension(instrument, account),
    issuer: issuerOrPlatformDimension(instrument, account, balance.source.provider)
  };
}

type PositionQuantity = { accountId: string; instrumentId: string; quantity: number };
type PositionValue = { accountId: string; instrumentId: string; value: number };
type Dimensions = { category: AssetCategory | string; region: string; assetKind: string; issuer: string };

function positionKey(accountId: string, instrumentId: string): string {
  return accountId + "::" + instrumentId;
}

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


function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
