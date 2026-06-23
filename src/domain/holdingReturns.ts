import { tryConvertToBase } from "@/src/domain/analytics";
import { calculateXirr } from "@/src/domain/xirr";
import type { ManualBalance, PortfolioBackup, Transaction } from "@/src/schema/backup";

export type HoldingReturn = {
  currentValue?: number;
  invested: number;
  cashOut: number;
  netInvested: number;
  profit?: number;
  returnPercent?: number;
  xirr?: number | null;
  allocationPercent: number;
  missingFx: string[];
};

const cashInTypes = new Set<Transaction["type"]>(["buy", "sip", "deposit", "contribution"]);
const cashOutTypes = new Set<Transaction["type"]>(["sell", "redemption", "dividend", "interest", "maturity", "withdrawal"]);
const feeTypes = new Set<Transaction["type"]>(["fee", "tax"]);

export function calculateHoldingReturns(backup: PortfolioBackup): Map<string, HoldingReturn> {
  const netWorth = portfolioValue(backup);
  const returns = new Map<string, HoldingReturn>();

  for (const balance of backup.manualBalances) {
    const missingFx = new Set<string>();
    const currentValue = convert(balance.value, balance.currency, backup, undefined, missingFx);
    const transactions = balance.instrumentId ? backup.transactions.filter((tx) => tx.instrumentId === balance.instrumentId) : [];
    let invested = 0;
    let cashOut = 0;
    const flows: Array<{ date: string; amount: number }> = [];

    for (const tx of transactions) {
      const amount = convert(Math.abs(tx.amount), tx.currency, backup, tx.date, missingFx);
      const fees = tx.fees ? convert(Math.abs(tx.fees), tx.currency, backup, tx.date, missingFx) : 0;
      const taxes = tx.taxes ? convert(Math.abs(tx.taxes), tx.currency, backup, tx.date, missingFx) : 0;
      if (amount === undefined || fees === undefined || taxes === undefined) continue;

      if (cashInTypes.has(tx.type)) {
        invested += amount + fees + taxes;
        flows.push({ date: tx.date, amount: -(amount + fees + taxes) });
      } else if (cashOutTypes.has(tx.type)) {
        cashOut += amount;
        flows.push({ date: tx.date, amount: amount - fees - taxes });
      } else if (feeTypes.has(tx.type)) {
        invested += amount;
        flows.push({ date: tx.date, amount: -amount });
      }
    }

    if (currentValue !== undefined && currentValue !== 0) flows.push({ date: balance.asOfDate, amount: currentValue });
    const netInvested = invested - cashOut;
    const profit = currentValue === undefined ? undefined : currentValue - netInvested;
    returns.set(balance.id, {
      currentValue: currentValue === undefined ? undefined : roundMoney(currentValue),
      invested: roundMoney(invested),
      cashOut: roundMoney(cashOut),
      netInvested: roundMoney(netInvested),
      profit: profit === undefined ? undefined : roundMoney(profit),
      returnPercent: profit === undefined || netInvested <= 0 ? undefined : roundPercent((profit / netInvested) * 100),
      xirr: missingFx.size > 0 ? null : calculateXirr(flows),
      allocationPercent: currentValue === undefined || netWorth <= 0 ? 0 : roundPercent((currentValue / netWorth) * 100),
      missingFx: [...missingFx].sort()
    });
  }

  return returns;
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
