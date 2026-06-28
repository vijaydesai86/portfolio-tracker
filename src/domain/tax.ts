import { tryConvertToBase } from "@/src/domain/analytics";
import type { Account, Instrument, ManualBalance, PortfolioBackup, Transaction } from "@/src/schema/backup";

export type TaxRegime = "new" | "old";
export type TaxProfile = {
  residency: "resident_individual";
  regime: TaxRegime;
  slabRate: number;
  surchargeRate: number;
  cessRate: number;
  mode: "estimate";
};

export type TaxBucketId =
  | "indian_equity_stcg"
  | "indian_equity_ltcg"
  | "foreign_equity_stcg"
  | "foreign_equity_ltcg"
  | "debt_slab"
  | "exempt"
  | "other_slab";

export type TaxTrace = {
  accountId: string;
  instrumentId: string;
  saleTransactionId: string;
  fifoLotBuyDate: string;
  sellDate: string;
  quantityUsed: number;
  originalSaleQuantity: number;
  proceedsFormula: string;
  costFormula: string;
  gainFormula: string;
  bucket: TaxBucketId;
  bucketReason: string;
  taxRate: number;
  taxFormula: string;
};

export type TaxGainRow = {
  transactionId: string;
  assetName: string;
  assetType: string;
  region: "India" | "Foreign";
  date: string;
  quantity: number;
  proceeds: number;
  cost: number;
  gain: number;
  holdingDays: number;
  bucket: TaxBucketId;
  taxRate: number;
  trace?: TaxTrace;
};

export type TaxBucketSummary = {
  bucket: TaxBucketId;
  label: string;
  gain: number;
  positiveGain: number;
  lossSetoff: number;
  taxableGain: number;
  tax: number;
};

export type RealizedTaxHoldingRow = {
  assetName: string;
  assetType: string;
  bucket: TaxBucketId;
  quantity: number;
  proceeds: number;
  cost: number;
  gain: number;
  positiveGain: number;
  lossSetoff: number;
  grossTaxBeforeSetoff: number;
  allocatedTaxAfterSetoff: number;
  lots: number;
};

export type UnrealizedTaxRow = {
  accountId?: string;
  instrumentId?: string;
  assetName: string;
  assetType: string;
  quantity: number;
  currentValue: number;
  cost: number;
  gain: number;
  bucket: TaxBucketId;
  holdingDays: number;
  taxRate: number;
  potentialTaxBeforeSetoff: number;
  lots?: number;
};

export type TaxHarvestCandidate = {
  accountId: string;
  instrumentId: string;
  assetName: string;
  assetType: string;
  bucket: TaxBucketId | "mixed";
  quantity: number;
  currentValue: number;
  cost: number;
  loss: number;
  lots: number;
  note: string;
};

export type PortfolioTaxReport = {
  profile: TaxProfile;
  financialYear: string;
  realized: {
    rows: TaxGainRow[];
    byAssetBucket: RealizedTaxHoldingRow[];
    totalProceeds: number;
    totalCost: number;
    totalGain: number;
    byBucket: Record<TaxBucketId, TaxBucketSummary>;
  };
  unrealized: {
    rows: UnrealizedTaxRow[];
    byAssetBucket: UnrealizedTaxRow[];
    harvestCandidates: TaxHarvestCandidate[];
    totalValue: number;
    totalCost: number;
    totalGain: number;
  };
  income: {
    dividend: number;
    foreignDividend: number;
    interest: number;
    exemptInterest: number;
    foreignTaxPaid: number;
  };
  estimatedTax: {
    capitalGainsTax: number;
    incomeTax: number;
    totalBeforeSurcharge: number;
    surcharge: number;
    totalBeforeCess: number;
    cess: number;
    totalTax: number;
  };
  notes: string[];
};

type Lot = {
  instrumentId: string;
  originalQuantity: number;
  originalCostBase: number;
  originalCurrency: string;
  originalAmount: number;
  originalFees: number;
  originalFxRate?: number;
  originalTaxAmount: number;
  originalTaxFmvPrice?: number;
  accountId: string;
  assetName: string;
  accountType: Account["type"];
  instrumentType?: Instrument["type"];
  category: string;
  country?: string;
  buyDate: string;
  quantity: number;
  costBase: number;
};

const defaultProfile: TaxProfile = {
  residency: "resident_individual",
  regime: "new",
  slabRate: 30,
  surchargeRate: 10,
  cessRate: 4,
  mode: "estimate"
};

const bucketLabels: Record<TaxBucketId, string> = {
  indian_equity_stcg: "Indian equity STCG",
  indian_equity_ltcg: "Indian equity LTCG",
  foreign_equity_stcg: "Foreign equity STCG",
  foreign_equity_ltcg: "Foreign equity LTCG",
  debt_slab: "Debt / slab-rate gains",
  exempt: "Exempt / ignored for portfolio tax",
  other_slab: "Other slab-rate gains"
};

export function getTaxProfile(backup: PortfolioBackup): TaxProfile {
  const settings = backup.settings as Record<string, unknown>;
  const raw = typeof settings.taxProfile === "object" && settings.taxProfile !== null ? settings.taxProfile as Partial<TaxProfile> : {};
  return {
    ...defaultProfile,
    ...raw,
    residency: "resident_individual",
    mode: "estimate",
    regime: raw.regime === "old" ? "old" : "new",
    slabRate: normalizePercent(raw.slabRate, defaultProfile.slabRate),
    surchargeRate: normalizePercent(raw.surchargeRate, defaultProfile.surchargeRate),
    cessRate: normalizePercent(raw.cessRate, defaultProfile.cessRate)
  };
}

export function updateTaxProfile(backup: PortfolioBackup, patch: Partial<TaxProfile>): PortfolioBackup {
  const profile = { ...getTaxProfile(backup), ...patch, residency: "resident_individual" as const, mode: "estimate" as const };
  return { ...backup, exportedAt: new Date().toISOString(), settings: { ...backup.settings, taxProfile: profile } };
}

export function calculatePortfolioTaxReport(backup: PortfolioBackup, options?: { financialYear?: string }): PortfolioTaxReport {
  const profile = getTaxProfile(backup);
  const financialYear = options?.financialYear ?? currentFinancialYear();
  const notes = [
    "Portfolio tax estimate for a Resident Indian individual; this is not an ITR filing engine.",
    "ESPP contribution balances are not treated as payroll/perquisite income; stock purchases and sales are taxed as stock lots."
  ];
  const accounts = new Map(backup.accounts.map((account) => [account.id, account]));
  const instruments = new Map(backup.instruments.map((instrument) => [instrument.id, instrument]));
  const balancesByInstrument = new Map<string, ManualBalance[]>();
  for (const balance of backup.manualBalances) {
    if (!balance.instrumentId) continue;
    const rows = balancesByInstrument.get(balance.instrumentId) ?? [];
    rows.push(balance);
    balancesByInstrument.set(balance.instrumentId, rows);
  }

  const lots: Lot[] = [];
  const realizedRows: TaxGainRow[] = [];
  const income = { dividend: 0, foreignDividend: 0, interest: 0, exemptInterest: 0, foreignTaxPaid: 0 };
  const sortedTransactions = [...backup.transactions].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  for (const tx of sortedTransactions) {
    const account = accounts.get(tx.accountId);
    const instrument = instruments.get(tx.instrumentId);
    if (!account || !instrument) continue;
    if (tx.type === "dividend") {
      const amount = convertedAmount(tx.amount, tx.currency, backup, tx.date, notes);
      if (isForeign(account, instrument, tx.currency)) income.foreignDividend += amount;
      else income.dividend += amount;
      if (tx.taxes) income.foreignTaxPaid += convertedAmount(tx.taxes, tx.currency, backup, tx.date, notes);
      continue;
    }
    if (tx.type === "interest" || tx.type === "interest_accrual") {
      const amount = convertedAmount(tx.amount, tx.currency, backup, tx.date, notes);
      if (isExemptAccount(account.type)) income.exemptInterest += amount;
      else income.interest += amount;
      continue;
    }
    if (!isLotBuy(tx) && !isLotSell(tx)) continue;
    if (!tx.quantity || tx.quantity <= 0) continue;
    if (isZeroAmountLotTransfer(tx)) continue;

    if (isLotBuy(tx)) {
      const taxCostAmount = taxableTransactionAmount(tx, "cost");
      lots.push({
        instrumentId: tx.instrumentId,
        accountId: tx.accountId,
        assetName: instrument.name,
        accountType: account.type,
        instrumentType: instrument.type,
        category: instrument.category,
        country: instrument.country,
        buyDate: tx.date,
        quantity: tx.quantity,
        originalQuantity: tx.quantity,
        originalCostBase: convertedAmount(taxCostAmount, tx.currency, backup, tx.date, notes),
        originalCurrency: tx.currency,
        originalAmount: Math.abs(tx.amount),
        originalFees: Math.abs(tx.fees ?? 0),
        originalFxRate: tx.currency === backup.baseCurrency ? undefined : findFxRateForTax(tx.currency, backup.baseCurrency, backup, tx.date)?.price,
        originalTaxAmount: taxCostAmount,
        originalTaxFmvPrice: tx.taxFmvPrice,
        costBase: convertedAmount(taxCostAmount, tx.currency, backup, tx.date, notes)
      });
      continue;
    }

    if (!isInFinancialYear(tx.date, financialYear)) {
      consumeLots(lots, tx, backup, notes, false, account, instrument);
      continue;
    }
    realizedRows.push(...consumeLots(lots, tx, backup, notes, true, account, instrument));
  }

  const unrealizedRows = buildUnrealizedRows(lots, balancesByInstrument, accounts, instruments, backup, notes);
  const unrealizedByAssetBucket = summarizeUnrealizedByAssetBucket(unrealizedRows);
  const harvestCandidates = buildFifoHarvestCandidates(unrealizedRows);
  const byBucket = summarizeBuckets(realizedRows, profile);
  const realizedByAssetBucket = summarizeRealizedByAssetBucket(realizedRows, byBucket, profile);
  const capitalGainsTax = roundMoney(Object.values(byBucket).reduce((sum, bucket) => sum + bucket.tax, 0));
  const incomeTax = roundMoney((income.dividend + income.foreignDividend + income.interest) * (profile.slabRate / 100));
  const totalBeforeSurcharge = roundMoney(capitalGainsTax + incomeTax);
  const surcharge = roundMoney(totalBeforeSurcharge * (profile.surchargeRate / 100));
  const totalBeforeCess = roundMoney(totalBeforeSurcharge + surcharge);
  const cess = roundMoney(totalBeforeCess * (profile.cessRate / 100));
  const totalTax = roundMoney(totalBeforeCess + cess);

  return {
    profile,
    financialYear,
    realized: {
      rows: realizedRows,
      byAssetBucket: realizedByAssetBucket,
      totalProceeds: roundMoney(realizedRows.reduce((sum, row) => sum + row.proceeds, 0)),
      totalCost: roundMoney(realizedRows.reduce((sum, row) => sum + row.cost, 0)),
      totalGain: roundMoney(realizedRows.reduce((sum, row) => sum + row.gain, 0)),
      byBucket
    },
    unrealized: {
      rows: unrealizedRows,
      byAssetBucket: unrealizedByAssetBucket,
      harvestCandidates,
      totalValue: roundMoney(unrealizedRows.reduce((sum, row) => sum + row.currentValue, 0)),
      totalCost: roundMoney(unrealizedRows.reduce((sum, row) => sum + row.cost, 0)),
      totalGain: roundMoney(unrealizedRows.reduce((sum, row) => sum + row.gain, 0))
    },
    income: roundIncome(income),
    estimatedTax: { capitalGainsTax, incomeTax, totalBeforeSurcharge, surcharge, totalBeforeCess, cess, totalTax },
    notes: [...new Set(notes)]
  };
}

function consumeLots(lots: Lot[], tx: Transaction, backup: PortfolioBackup, notes: string[], emit: boolean, account: Account, instrument: Instrument): TaxGainRow[] {
  let remaining = Math.abs(tx.quantity ?? 0);
  const rows: TaxGainRow[] = [];
  const proceedsTotal = convertedAmount(taxableTransactionAmount(tx, "proceeds"), tx.currency, backup, tx.date, notes);
  while (remaining > 0.0000001) {
    const lot = lots.find((item) => item.instrumentId === tx.instrumentId && item.accountId === tx.accountId && item.quantity > 0);
    if (!lot) {
      notes.push(`Missing buy lot for ${instrument.name} sale on ${tx.date}.`);
      break;
    }
    const used = Math.min(remaining, lot.quantity);
    const ratio = used / Math.abs(tx.quantity ?? used);
    const lotRatio = used / lot.quantity;
    const proceeds = proceedsTotal * ratio;
    const cost = lot.costBase * lotRatio;
    const gain = proceeds - cost;
    const holdingDays = daysBetween(lot.buyDate, tx.date);
    lot.quantity = roundQuantity(lot.quantity - used);
    lot.costBase = roundMoney(lot.costBase - cost);
    remaining = roundQuantity(remaining - used);
    if (emit) {
      const bucket = classifyBucket(account, instrument, tx.currency, holdingDays);
      const taxRate = taxRateForBucket(bucket, getTaxProfile(backup));
      rows.push({
        transactionId: tx.id,
        assetName: instrument.name,
        assetType: instrument.type,
        region: isForeign(account, instrument, tx.currency) ? "Foreign" : "India",
        date: tx.date,
        quantity: roundQuantity(used),
        proceeds: roundMoney(proceeds),
        cost: roundMoney(cost),
        gain: roundMoney(gain),
        holdingDays,
        bucket,
        taxRate,
        trace: buildTaxTrace({ tx, lot, used, proceeds, cost, gain, bucket, taxRate, backup, account, instrument })
      });
    }
  }
  return rows;
}

function buildTaxTrace(input: { tx: Transaction; lot: Lot; used: number; proceeds: number; cost: number; gain: number; bucket: TaxBucketId; taxRate: number; backup: PortfolioBackup; account: Account; instrument: Instrument }): TaxTrace {
  const originalSaleQuantity = Math.abs(input.tx.quantity ?? input.used);
  const saleBasis = typeof input.tx.taxFmvPrice === "number" ? "tax FMV " + formatNumber(input.tx.taxFmvPrice) + " x " + formatNumber(originalSaleQuantity) : "sale amount " + formatNumber(Math.abs(input.tx.amount));
  const saleFx = input.tx.currency === input.backup.baseCurrency ? undefined : findFxRateForTax(input.tx.currency, input.backup.baseCurrency, input.backup, input.tx.date)?.price;
  const saleNet = taxableTransactionAmount(input.tx, "proceeds");
  const lotRatio = input.used / input.lot.originalQuantity;
  const sellRatio = input.used / originalSaleQuantity;
  const buyGross = input.lot.originalTaxAmount;
  const buyBasis = typeof input.lot.originalTaxFmvPrice === "number" ? "tax FMV " + formatNumber(input.lot.originalTaxFmvPrice) + " x " + formatNumber(input.lot.originalQuantity) : "buy amount " + formatNumber(input.lot.originalAmount);
  return {
    accountId: input.tx.accountId,
    instrumentId: input.tx.instrumentId,
    saleTransactionId: input.tx.id,
    fifoLotBuyDate: input.lot.buyDate,
    sellDate: input.tx.date,
    quantityUsed: roundQuantity(input.used),
    originalSaleQuantity: roundQuantity(originalSaleQuantity),
    proceedsFormula: formulaText([saleBasis, "net " + formatNumber(saleNet), input.tx.currency, sellRatio !== 1 ? "x sale ratio " + formatNumber(sellRatio) : "", saleFx ? "x FX " + formatNumber(saleFx) : "base currency"]) + " = " + formatInr(input.proceeds),
    costFormula: formulaText(["FIFO " + formatNumber(input.used) + "/" + formatNumber(input.lot.originalQuantity), buyBasis, "tax basis " + formatNumber(buyGross) + " " + input.lot.originalCurrency, input.lot.originalFxRate ? "x FX " + formatNumber(input.lot.originalFxRate) : "base currency", "lot ratio " + formatNumber(lotRatio)]) + " = " + formatInr(input.cost),
    gainFormula: formatInr(input.proceeds) + " - " + formatInr(input.cost) + " = " + formatInr(input.gain),
    bucket: input.bucket,
    bucketReason: bucketReason(input.bucket, input.account, input.instrument, input.tx.currency, daysBetween(input.lot.buyDate, input.tx.date)),
    taxRate: input.taxRate,
    taxFormula: formatInr(Math.max(0, input.gain)) + " x " + formatNumber(input.taxRate) + "% = " + formatInr(Math.max(0, input.gain) * (input.taxRate / 100)) + " before bucket set-off/exemption"
  };
}

function formulaText(parts: string[]): string {
  return parts.filter(Boolean).join(" ");
}

function formatInr(value: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(roundMoney(value));
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(roundMoney(value));
}

function bucketReason(bucket: TaxBucketId, account: Account, instrument: Instrument, currency: string, holdingDays: number): string {
  if (bucket === "exempt") return "Account type " + account.type + " is treated as exempt in this estimate.";
  if (bucket === "indian_equity_stcg") return "Indian listed equity/equity mutual fund held " + holdingDays + " day(s), not more than 365 days.";
  if (bucket === "indian_equity_ltcg") return "Indian listed equity/equity mutual fund held " + holdingDays + " day(s), more than 365 days.";
  if (bucket === "foreign_equity_stcg") return "Foreign equity detected from account/instrument/currency and held " + holdingDays + " day(s), not more than 730 days.";
  if (bucket === "foreign_equity_ltcg") return "Foreign equity detected from account/instrument/currency and held " + holdingDays + " day(s), more than 730 days.";
  if (bucket === "debt_slab") return "Debt or slab-rate asset based on account type " + account.type + " and instrument category " + instrument.category + ".";
  return "Other slab-rate asset based on account type " + account.type + " and currency " + currency + ".";
}

function buildUnrealizedRows(lots: Lot[], balancesByInstrument: Map<string, ManualBalance[]>, accounts: Map<string, Account>, instruments: Map<string, Instrument>, backup: PortfolioBackup, notes: string[]): UnrealizedTaxRow[] {
  return lots.filter((lot) => lot.quantity > 0).flatMap((lot) => {
    const balance = (balancesByInstrument.get(lot.instrumentId) ?? []).find((item) => item.accountId === lot.accountId) ?? (balancesByInstrument.get(lot.instrumentId) ?? [])[0];
    const account = accounts.get(lot.accountId);
    const instrument = instruments.get(lot.instrumentId);
    if (!balance || !account || !instrument || !balance.quantity || balance.quantity <= 0) return [];
    const balanceBase = convertedAmount(balance.value, balance.currency, backup, balance.asOfDate, notes);
    const currentValue = balanceBase * (lot.quantity / balance.quantity);
    const holdingDays = daysBetween(lot.buyDate, balance.asOfDate);
    const bucket = classifyBucket(account, instrument, balance.currency, holdingDays);
    const gain = currentValue - lot.costBase;
    const taxRate = taxRateForBucket(bucket, getTaxProfile(backup));
    return [{ accountId: lot.accountId, instrumentId: lot.instrumentId, assetName: instrument.name, assetType: instrument.type, quantity: roundQuantity(lot.quantity), currentValue: roundMoney(currentValue), cost: roundMoney(lot.costBase), gain: roundMoney(gain), bucket, holdingDays, taxRate, potentialTaxBeforeSetoff: roundMoney(Math.max(0, gain) * (taxRate / 100)) }];
  });
}

function buildFifoHarvestCandidates(rows: UnrealizedTaxRow[]): TaxHarvestCandidate[] {
  const grouped = new Map<string, UnrealizedTaxRow[]>();
  for (const row of rows) {
    if (!row.accountId || !row.instrumentId) continue;
    const key = row.accountId + "::" + row.instrumentId;
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }
  const candidates: TaxHarvestCandidate[] = [];
  for (const list of grouped.values()) {
    let quantity = 0;
    let currentValue = 0;
    let cost = 0;
    let lots = 0;
    let best: TaxHarvestCandidate | undefined;
    const buckets = new Set<TaxBucketId>();
    for (const row of list) {
      quantity += row.quantity;
      currentValue += row.currentValue;
      cost += row.cost;
      lots += 1;
      buckets.add(row.bucket);
      const gain = roundMoney(currentValue - cost);
      if (gain < 0 && (!best || gain < best.loss)) {
        best = {
          accountId: row.accountId!,
          instrumentId: row.instrumentId!,
          assetName: row.assetName,
          assetType: row.assetType,
          bucket: buckets.size === 1 ? row.bucket : "mixed",
          quantity: roundQuantity(quantity),
          currentValue: roundMoney(currentValue),
          cost: roundMoney(cost),
          loss: gain,
          lots,
          note: buckets.size === 1 ? "FIFO sale prefix is net loss in this bucket." : "FIFO sale prefix is net loss across mixed buckets."
        };
      }
    }
    if (best) candidates.push(best);
  }
  return candidates.sort((a, b) => a.loss - b.loss || b.cost - a.cost || a.assetName.localeCompare(b.assetName));
}

function summarizeUnrealizedByAssetBucket(rows: UnrealizedTaxRow[]): UnrealizedTaxRow[] {
  const grouped = new Map<string, UnrealizedTaxRow>();
  for (const row of rows) {
    const key = row.assetName + "::" + row.assetType + "::" + row.bucket;
    const existing = grouped.get(key) ?? { ...row, quantity: 0, currentValue: 0, cost: 0, gain: 0, potentialTaxBeforeSetoff: 0, holdingDays: row.holdingDays, lots: 0 };
    existing.quantity += row.quantity;
    existing.currentValue += row.currentValue;
    existing.cost += row.cost;
    existing.gain += row.gain;
    existing.potentialTaxBeforeSetoff += row.potentialTaxBeforeSetoff;
    existing.holdingDays = Math.min(existing.holdingDays, row.holdingDays);
    existing.lots = (existing.lots ?? 0) + 1;
    grouped.set(key, existing);
  }
  return [...grouped.values()]
    .map((row) => {
      const gain = roundMoney(row.gain);
      return { ...row, quantity: roundQuantity(row.quantity), currentValue: roundMoney(row.currentValue), cost: roundMoney(row.cost), gain, potentialTaxBeforeSetoff: roundMoney(Math.max(0, gain) * (row.taxRate / 100)) };
    })
    .sort((a, b) => Math.abs(b.gain) - Math.abs(a.gain) || b.currentValue - a.currentValue || a.assetName.localeCompare(b.assetName));
}

function summarizeBuckets(rows: TaxGainRow[], profile: TaxProfile): Record<TaxBucketId, TaxBucketSummary> {
  const result = Object.fromEntries((Object.keys(bucketLabels) as TaxBucketId[]).map((bucket) => [bucket, { bucket, label: bucketLabels[bucket], gain: 0, positiveGain: 0, lossSetoff: 0, taxableGain: 0, tax: 0 }])) as Record<TaxBucketId, TaxBucketSummary>;
  for (const row of rows) {
    result[row.bucket].gain += row.gain;
    if (row.gain > 0) result[row.bucket].positiveGain += row.gain;
  }
  for (const bucket of Object.keys(result) as TaxBucketId[]) {
    const gain = roundMoney(result[bucket].gain);
    const positiveGain = roundMoney(result[bucket].positiveGain);
    const lossSetoff = roundMoney(Math.max(0, positiveGain - Math.max(0, gain)));
    const taxableGain = roundMoney(Math.max(0, gain - exemptionForBucket(bucket)));
    result[bucket] = { ...result[bucket], gain, positiveGain, lossSetoff, taxableGain, tax: roundMoney(taxableGain * (taxRateForBucket(bucket, profile) / 100)) };
  }
  return result;
}

function summarizeRealizedByAssetBucket(rows: TaxGainRow[], bucketSummary: Record<TaxBucketId, TaxBucketSummary>, profile: TaxProfile): RealizedTaxHoldingRow[] {
  const grouped = new Map<string, RealizedTaxHoldingRow>();
  for (const row of rows) {
    const key = row.assetName + "::" + row.assetType + "::" + row.bucket;
    const existing = grouped.get(key) ?? { assetName: row.assetName, assetType: row.assetType, bucket: row.bucket, quantity: 0, proceeds: 0, cost: 0, gain: 0, positiveGain: 0, lossSetoff: 0, grossTaxBeforeSetoff: 0, allocatedTaxAfterSetoff: 0, lots: 0 };
    existing.quantity += row.quantity;
    existing.proceeds += row.proceeds;
    existing.cost += row.cost;
    existing.gain += row.gain;
    if (row.gain > 0) existing.positiveGain += row.gain;
    existing.lots += 1;
    grouped.set(key, existing);
  }
  const rowsByBucket = new Map<TaxBucketId, RealizedTaxHoldingRow[]>();
  for (const row of grouped.values()) {
    const rounded = row;
    rounded.quantity = roundQuantity(rounded.quantity);
    rounded.proceeds = roundMoney(rounded.proceeds);
    rounded.cost = roundMoney(rounded.cost);
    rounded.gain = roundMoney(rounded.gain);
    rounded.positiveGain = roundMoney(rounded.positiveGain);
    rounded.lossSetoff = roundMoney(Math.max(0, rounded.positiveGain - Math.max(0, rounded.gain)));
    rounded.grossTaxBeforeSetoff = roundMoney(rounded.positiveGain * (taxRateForBucket(rounded.bucket, profile) / 100));
    const bucketRows = rowsByBucket.get(rounded.bucket) ?? [];
    bucketRows.push(rounded);
    rowsByBucket.set(rounded.bucket, bucketRows);
  }
  for (const [bucket, bucketRows] of rowsByBucket.entries()) {
    const positiveTotal = bucketRows.reduce((sum, row) => sum + row.positiveGain, 0);
    const bucketTax = bucketSummary[bucket].tax;
    for (const row of bucketRows) row.allocatedTaxAfterSetoff = positiveTotal > 0 ? roundMoney(bucketTax * (row.positiveGain / positiveTotal)) : 0;
  }
  return [...grouped.values()].sort((a, b) => Math.abs(b.gain) - Math.abs(a.gain) || b.proceeds - a.proceeds || a.assetName.localeCompare(b.assetName));
}

function classifyBucket(account: Account, instrument: Instrument, currency: string, holdingDays: number): TaxBucketId {
  if (isExemptAccount(account.type)) return "exempt";
  const foreign = isForeign(account, instrument, currency);
  if (account.type === "indian_stock" || instrument.type === "indian_stock" || (instrument.type === "mutual_fund" && instrument.category === "Equity" && !foreign)) {
    return holdingDays > 365 ? "indian_equity_ltcg" : "indian_equity_stcg";
  }
  if (foreign && (account.type === "us_stock" || instrument.type === "us_stock")) return holdingDays > 730 ? "foreign_equity_ltcg" : "foreign_equity_stcg";
  if (instrument.category === "Debt" || account.type === "fd" || account.type === "nps" || account.type === "epf") return "debt_slab";
  return foreign ? (holdingDays > 730 ? "foreign_equity_ltcg" : "foreign_equity_stcg") : "other_slab";
}

function taxRateForBucket(bucket: TaxBucketId, profile: TaxProfile): number {
  if (bucket === "indian_equity_stcg") return 20;
  if (bucket === "indian_equity_ltcg") return 12.5;
  if (bucket === "foreign_equity_ltcg") return 12.5;
  if (bucket === "foreign_equity_stcg" || bucket === "debt_slab" || bucket === "other_slab") return profile.slabRate;
  return 0;
}

function exemptionForBucket(bucket: TaxBucketId): number {
  return bucket === "indian_equity_ltcg" ? 125000 : 0;
}

function isLotBuy(tx: Transaction): boolean {
  return tx.type === "buy" || tx.type === "sip" || tx.type === "switch_in" || tx.type === "contribution";
}

function isZeroAmountLotTransfer(tx: Transaction): boolean {
  return (isLotBuy(tx) || isLotSell(tx)) && Math.abs(tx.amount) === 0 && Math.abs(tx.fees ?? 0) === 0 && Math.abs(tx.taxes ?? 0) === 0;
}

function isLotSell(tx: Transaction): boolean {
  return tx.type === "sell" || tx.type === "redemption" || tx.type === "switch_out" || tx.type === "maturity";
}

function taxableTransactionAmount(tx: Transaction, mode: "cost" | "proceeds"): number {
  const quantity = Math.abs(tx.quantity ?? 0);
  const fmvBase = typeof tx.taxFmvPrice === "number" && quantity > 0 ? Math.abs(tx.taxFmvPrice * quantity) : Math.abs(tx.amount);
  const fees = Math.abs(tx.fees ?? 0);
  return mode === "cost" ? fmvBase + fees : fmvBase - fees;
}

function isForeign(account: Account, instrument: Instrument, currency: string): boolean {
  return currency !== "INR" || instrument.country === "US" || account.type === "us_stock";
}

function isExemptAccount(type: Account["type"]): boolean {
  return type === "ppf" || type === "ssy";
}

function convertedAmount(value: number, currency: string, backup: PortfolioBackup, date: string, notes: string[]): number {
  const converted = tryConvertToBase(value, currency, backup, date);
  if (converted === undefined) {
    notes.push(`Missing ${currency}/${backup.baseCurrency} FX for tax conversion on ${date}; used raw ${currency} amount.`);
    return value;
  }
  return converted;
}

function findFxRateForTax(from: string, to: string, backup: PortfolioBackup, asOfDate: string) {
  const pair = from + to;
  return backup.priceSnapshots
    .filter((snapshot) => snapshot.instrumentId === pair && snapshot.currency === to && snapshot.asOfDate <= asOfDate)
    .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate) || a.createdAt.localeCompare(b.createdAt))
    .at(-1);
}

function isInFinancialYear(date: string, financialYear: string): boolean {
  const [startText, endText] = financialYear.split("-");
  const startYear = Number(startText);
  const endYear = endText.length === 2 ? Number(String(startYear).slice(0, 2) + endText) : Number(endText);
  return date >= `${startYear}-04-01` && date <= `${endYear}-03-31`;
}

function currentFinancialYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

function daysBetween(start: string, end: string): number {
  return Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 86400000));
}

function normalizePercent(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function roundIncome<T extends Record<string, number>>(income: T): T {
  return Object.fromEntries(Object.entries(income).map(([key, value]) => [key, roundMoney(value)])) as T;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
