import { tryConvertToBase } from "@/src/domain/analytics";
import { calculateXirr } from "@/src/domain/xirr";
import type { ManualBalance, PortfolioBackup, Transaction } from "@/src/schema/backup";

export type HoldingReturn = {
  currentValue?: number;
  invested: number;
  cashOut: number;
  netInvested: number;
  costBasisKnown: boolean;
  hasCashFlows: boolean;
  profit?: number;
  returnPercent?: number;
  xirr?: number | null;
  allocationPercent: number;
  missingFx: string[];
};

const cashInTypes = new Set<Transaction["type"]>(["buy", "sip", "deposit", "contribution", "switch_in"]);
const lotOutTypes = new Set<Transaction["type"]>(["sell", "redemption", "switch_out"]);
const cashOutTypes = new Set<Transaction["type"]>(["sell", "redemption", "dividend", "interest", "maturity", "withdrawal", "switch_out"]);
const feeTypes = new Set<Transaction["type"]>(["fee", "tax"]);

type CostLot = { quantity: number; cost: number };

export function calculateHoldingReturns(backup: PortfolioBackup): Map<string, HoldingReturn> {
  const netWorth = portfolioValue(backup);
  const returns = new Map<string, HoldingReturn>();

  for (const balance of backup.manualBalances) {
    const missingFx = new Set<string>();
    const currentValue = convert(balance.value, balance.currency, backup, undefined, missingFx);
    const transactions = backup.transactions.filter((tx) => tx.accountId === balance.accountId && (balance.instrumentId ? tx.instrumentId === balance.instrumentId : !tx.instrumentId));
    let realizedCashOut = 0;
    let unallocatedCostBasis = 0;
    let hasCostBasisInput = false;
    const lots: CostLot[] = [];
    const flows: Array<{ date: string; amount: number }> = [];
    const hasCashFlows = transactions.length > 0;

    for (const tx of transactions.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
      const amount = convert(Math.abs(tx.amount), tx.currency, backup, tx.date, missingFx);
      const fees = tx.fees ? convert(Math.abs(tx.fees), tx.currency, backup, tx.date, missingFx) : 0;
      const taxes = tx.taxes ? convert(Math.abs(tx.taxes), tx.currency, backup, tx.date, missingFx) : 0;
      if (amount === undefined || fees === undefined || taxes === undefined) continue;

      if (cashInTypes.has(tx.type)) {
        const cost = amount + fees + taxes;
        if (cost > 0) {
          hasCostBasisInput = true;
          addCost(lots, tx.quantity, cost, (value) => { unallocatedCostBasis += value; });
          flows.push({ date: tx.date, amount: -cost });
        }
      } else if (cashOutTypes.has(tx.type)) {
        const proceeds = amount - fees - taxes;
        if (amount > 0 || fees > 0 || taxes > 0) {
          realizedCashOut += proceeds;
          if (lotOutTypes.has(tx.type)) {
            removeCost(lots, tx.quantity, amount, (value) => { unallocatedCostBasis = Math.max(0, unallocatedCostBasis - value); });
          }
          flows.push({ date: tx.date, amount: proceeds });
        }
      } else if (feeTypes.has(tx.type)) {
        if (isCostBasisCharge(tx)) {
          hasCostBasisInput = true;
          unallocatedCostBasis += amount;
        }
        flows.push({ date: tx.date, amount: -amount });
      }
    }

    const reconstructedCostBasis = lots.reduce((sum, lot) => sum + lot.cost, unallocatedCostBasis);
    let remainingCostBasis = reconstructedCostBasis;
    let costBasisKnown = hasCostBasisInput;

    if (!hasCashFlows && balance.investedAmount !== undefined) {
      const investedValue = convert(balance.investedAmount, balance.investedCurrency ?? balance.currency, backup, balance.investedAsOfDate ?? balance.asOfDate, missingFx);
      if (investedValue !== undefined) {
        remainingCostBasis = investedValue;
        costBasisKnown = true;
      }
    }

    if (hasCashFlows && currentValue !== undefined && currentValue !== 0) flows.push({ date: balance.asOfDate, amount: currentValue });
    const profit = costBasisKnown && currentValue !== undefined ? currentValue - remainingCostBasis : undefined;
    returns.set(balance.id, {
      currentValue: currentValue === undefined ? undefined : roundMoney(currentValue),
      invested: roundMoney(remainingCostBasis),
      cashOut: roundMoney(realizedCashOut),
      netInvested: roundMoney(remainingCostBasis),
      costBasisKnown,
      hasCashFlows,
      profit: profit === undefined ? undefined : roundMoney(profit),
      returnPercent: profit === undefined || remainingCostBasis <= 0 ? undefined : roundPercent((profit / remainingCostBasis) * 100),
      xirr: !hasCashFlows ? undefined : missingFx.size > 0 ? null : calculateXirr(flows),
      allocationPercent: currentValue === undefined || netWorth <= 0 ? 0 : roundPercent((currentValue / netWorth) * 100),
      missingFx: [...missingFx].sort()
    });
  }

  return returns;
}

function isCostBasisCharge(tx: Transaction): boolean {
  return tx.source.provider === "cas_pdf" && (tx.type === "tax" || tx.type === "fee");
}

function addCost(lots: CostLot[], quantity: number | undefined, cost: number, addUnallocated: (cost: number) => void) {
  const qty = Math.abs(quantity ?? 0);
  if (qty > 0) lots.push({ quantity: qty, cost });
  else addUnallocated(cost);
}

function removeCost(lots: CostLot[], quantity: number | undefined, fallbackAmount: number, removeUnallocated: (cost: number) => void): number {
  let remainingQuantity = Math.abs(quantity ?? 0);
  if (remainingQuantity <= 0) {
    removeUnallocated(fallbackAmount);
    return fallbackAmount;
  }

  let removed = 0;
  while (remainingQuantity > 0.0000001 && lots.length > 0) {
    const lot = lots[0];
    const consumed = Math.min(lot.quantity, remainingQuantity);
    const consumedCost = lot.quantity === 0 ? 0 : lot.cost * (consumed / lot.quantity);
    lot.quantity = roundQuantity(lot.quantity - consumed);
    lot.cost = Math.max(0, lot.cost - consumedCost);
    removed += consumedCost;
    remainingQuantity = roundQuantity(remainingQuantity - consumed);
    if (lot.quantity <= 0.0000001) lots.shift();
  }
  return removed;
}

function portfolioValue(backup: PortfolioBackup): number {
  return backup.manualBalances.reduce((sum, balance) => sum + (tryConvertToBase(balance.value, balance.currency, backup) ?? 0), 0);
}

function convert(value: number, currency: string, backup: PortfolioBackup, asOfDate: string | undefined, missingFx: Set<string>): number | undefined {
  const converted = tryConvertToBase(value, currency, backup, asOfDate);
  if (converted === undefined && currency !== backup.baseCurrency) missingFx.add(currency + "/" + backup.baseCurrency + (asOfDate ? " on/after " + asOfDate : ""));
  return converted;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundPercent(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 100000000) / 100000000;
}
