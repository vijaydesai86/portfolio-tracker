import fs from "node:fs";
import readXlsxFile from "read-excel-file/node";
import { describe, expect, it } from "vitest";
import { calculatePortfolioInsights, calculatePortfolioSummary } from "@/src/domain/analytics";
import { calculateHoldingReturns } from "@/src/domain/holdingReturns";
import { applyCanonicalCasImport, buildCanonicalCasImport, parseCasText } from "@/src/importers/casText";
import { applyCanonicalEpfoImport, buildCanonicalEpfoImport, parseEpfoPassbookText } from "@/src/importers/epfoPassbook";
import { applyCanonicalIndMoneyImport, buildCanonicalIndMoneyImport, normalizeWorkbookRows, parseIndMoneyRows } from "@/src/importers/indmoneyXlsx";
import { applyCanonicalNpsImport, buildCanonicalNpsImport, parseNpsCsv } from "@/src/importers/npsStatement";
import { createEmptyBackup, type ManualBalance, type PortfolioBackup, type Transaction } from "@/src/schema/backup";

describe("private report validation", () => {
  it.skipIf(!process.env.CAS_TEXT_PATH)("validates CAS parser and holding report invariants", () => {
    const parsed = parseCasText(fs.readFileSync(process.env.CAS_TEXT_PATH!, "utf8"));
    expect(parsed.errors).toEqual([]);
    expect(parsed.schemes.length).toBeGreaterThan(0);

    for (const scheme of parsed.schemes) {
      if (scheme.closingUnitBalance === undefined) continue;
      const lastUnitBalance = scheme.transactions.map((row) => row.unitBalance).filter((value): value is number => value !== undefined).at(-1);
      if (lastUnitBalance !== undefined) expect(roundQuantity(lastUnitBalance)).toBeCloseTo(roundQuantity(scheme.closingUnitBalance), 3);
      const opening = scheme.openingUnitBalance ?? 0;
      const parsedUnitDelta = scheme.transactions.reduce((sum, row) => sum + (row.units ?? 0), 0);
      expect(roundQuantity(opening + parsedUnitDelta)).toBeCloseTo(roundQuantity(scheme.closingUnitBalance), 3);
    }

    const backup = applyCanonicalCasImport(createEmptyBackup("INR"), buildCanonicalCasImport(parsed, { importId: "private_cas", now: "2026-06-23T00:00:00.000Z" }));
    const returns = calculateHoldingReturns(backup);
    expect(backup.manualBalances).toHaveLength(parsed.schemes.filter((scheme) => scheme.marketValue !== undefined).length);
    for (const scheme of parsed.schemes) {
      const balance = backup.manualBalances.find((item) => item.label === scheme.schemeName);
      if (!balance || scheme.totalCostValue === undefined) continue;
      const row = returns.get(balance.id)!;
      const parsedCashCost = backup.transactions
        .filter((tx) => tx.accountId === balance.accountId && tx.instrumentId === balance.instrumentId && ["buy", "sip", "deposit", "contribution", "switch_in"].includes(tx.type))
        .reduce((sum, tx) => sum + Math.abs(tx.amount) + Math.abs(tx.fees ?? 0) + Math.abs(tx.taxes ?? 0), 0);
      expect(row.invested).toBeCloseTo(scheme.totalCostValue, 2);
      if (!costBasisMatchesTransactions(scheme.totalCostValue, parsedCashCost)) expect(row.xirr).toBeUndefined();
    }
    validateReportMath(backup);
  });

  it.skipIf(!process.env.IND_XLSX_PATH)("validates INDMoney parser and holding report invariants", async () => {
    const workbook = await readXlsxFile(process.env.IND_XLSX_PATH!);
    const parsed = parseIndMoneyRows(normalizeWorkbookRows(workbook as unknown));
    expect(parsed.errors).toEqual([]);
    expect(parsed.positions.length).toBeGreaterThan(0);

    const backup = applyCanonicalIndMoneyImport(createEmptyBackup("USD"), buildCanonicalIndMoneyImport(parsed, { importId: "private_ind", now: "2026-06-23T00:00:00.000Z" }));
    const returns = calculateHoldingReturns(backup);
    expect(backup.manualBalances).toHaveLength(parsed.positions.length);
    expect([...returns.values()].filter((row) => row.costBasisKnown && (row.currentValue ?? 0) > 0 && row.invested === 0)).toEqual([]);
    validateReportMath(backup);
  });

  it.skipIf(!process.env.PF_TEXT_PATHS)("validates PF parser and holding report invariants", () => {
    const paths = splitPaths(process.env.PF_TEXT_PATHS);
    let backup = createEmptyBackup("INR");
    for (const [index, file] of paths.entries()) {
      const parsed = parseEpfoPassbookText(fs.readFileSync(file, "utf8"));
      expect(parsed.errors).toEqual([]);
      const imported = buildCanonicalEpfoImport(parsed, { importId: "private_pf_" + index, now: "2026-06-23T00:00:00.000Z" });
      expect(imported.transactions.length).toBe(parsed.yearlyContributions.filter((row) => row.key !== "pension" && row.value > 0).length + parsed.yearlyInterest.filter((row) => row.key !== "pension" && row.value > 0).length);
      backup = applyCanonicalEpfoImport(backup, imported);
    }
    expect(backup.manualBalances.every((balance) => balance.asOfDate <= "2026-06-23")).toBe(true);
    validateReportMath(backup);
  });

  it.skipIf(!process.env.NPS_CSV_PATHS)("validates NPS parser and holding report invariants", () => {
    let backup = createEmptyBackup("INR");
    for (const [index, file] of splitPaths(process.env.NPS_CSV_PATHS).entries()) {
      const parsed = parseNpsCsv(fs.readFileSync(file, "utf8"));
      expect(parsed.errors).toEqual([]);
      expect(parsed.holdings.length).toBeGreaterThan(0);
      backup = applyCanonicalNpsImport(backup, buildCanonicalNpsImport(parsed, { importId: "private_nps_" + index, now: "2026-06-23T00:00:00.000Z" }));
    }
    validateReportMath(backup);
    const insights = calculatePortfolioInsights(backup);
    expect(insights.transactionStats.externalCashOutBase).toBe(0);
    expect(backup.transactions.filter((tx) => tx.type === "redemption")).toHaveLength(0);
    expect(backup.transactions.filter((tx) => tx.type === "switch_out").length).toBeGreaterThan(0);
  });
});

function validateReportMath(backup: PortfolioBackup) {
  const summary = calculatePortfolioSummary(backup);
  const insights = calculatePortfolioInsights(backup);
  const returns = calculateHoldingReturns(backup);
  const balanceTotal = roundMoney(backup.manualBalances.reduce((sum, balance) => sum + balance.value, 0));

  expect(roundMoney(summary.netWorth)).toBe(balanceTotal);
  expect(roundMoney(insights.holdings.reduce((sum, holding) => sum + (holding.valueInBase ?? 0), 0))).toBe(balanceTotal);
  for (const balance of backup.manualBalances) {
    const row = returns.get(balance.id)!;
    expect(row.currentValue).toBe(balance.value);
    if (row.profit !== undefined) expect(row.profit).toBeCloseTo(roundMoney(balance.value - row.invested), 2);
    if (row.returnPercent !== undefined && row.invested > 0) expect(row.returnPercent).toBeCloseTo(roundPercent(((row.profit ?? 0) / row.invested) * 100), 2);

    const audit = independentlyAuditHolding(backup, balance);
    expect(row.costBasisKnown).toBe(audit.costBasisKnown);
    expect(row.invested).toBeCloseTo(audit.invested, 2);
    if (audit.profit === undefined) {
      expect(row.profit).toBeUndefined();
    } else {
      expect(row.profit).toBeCloseTo(audit.profit, 2);
    }
    if (audit.returnPercent === undefined) {
      expect(row.returnPercent).toBeUndefined();
    } else {
      expect(row.returnPercent).toBeCloseTo(audit.returnPercent, 2);
    }
    if (audit.xirr === undefined) {
      expect(row.xirr).toBeUndefined();
    } else if (audit.xirr === null) {
      expect(row.xirr).toBeNull();
    } else {
      expect(row.xirr).toBeCloseTo(audit.xirr, 1);
    }
  }
}

function independentlyAuditHolding(backup: PortfolioBackup, balance: ManualBalance) {
  const transactions = backup.transactions
    .filter((tx) => tx.accountId === balance.accountId && (balance.instrumentId ? tx.instrumentId === balance.instrumentId : !tx.instrumentId))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const lots: Array<{ quantity: number; cost: number }> = [];
  const flows: Array<{ date: string; amount: number }> = [];
  let unallocatedCost = 0;
  let costBasisKnown = false;

  for (const tx of transactions) {
    const amount = Math.abs(tx.amount);
    const fees = Math.abs(tx.fees ?? 0);
    const taxes = Math.abs(tx.taxes ?? 0);
    if (isAuditCashIn(tx.type)) {
      const cost = amount + fees + taxes;
      if (cost <= 0) continue;
      costBasisKnown = true;
      addAuditLot(lots, Math.abs(tx.quantity ?? 0), cost, (value) => { unallocatedCost += value; });
      flows.push({ date: tx.date, amount: -cost });
      continue;
    }
    if (isAuditCashOut(tx.type)) {
      if (amount <= 0 && fees <= 0 && taxes <= 0) continue;
      const proceeds = amount - fees - taxes;
      if (isAuditLotOut(tx.type)) removeAuditLot(lots, Math.abs(tx.quantity ?? 0), amount, (value) => { unallocatedCost = Math.max(0, unallocatedCost - value); });
      flows.push({ date: tx.date, amount: proceeds });
      continue;
    }
    if (tx.type === "fee" || tx.type === "tax") flows.push({ date: tx.date, amount: -amount });
  }

  const reconstructed = lots.reduce((sum, lot) => sum + lot.cost, unallocatedCost);
  let invested = reconstructed;
  let xirrComplete = true;
  if (balance.investedAmount !== undefined) {
    invested = balance.investedAmount;
    costBasisKnown = true;
    xirrComplete = transactions.length === 0 || costBasisMatchesTransactions(balance.investedAmount, reconstructed);
  }

  invested = roundMoney(invested);
  if (transactions.length > 0 && xirrComplete && balance.value !== 0) flows.push({ date: balance.asOfDate, amount: balance.value });
  const profit = costBasisKnown ? roundMoney(balance.value - invested) : undefined;
  return {
    costBasisKnown,
    invested,
    profit,
    returnPercent: profit === undefined || invested <= 0 ? undefined : roundPercent((profit / invested) * 100),
    xirr: transactions.length === 0 || !xirrComplete ? undefined : independentXirr(flows)
  };
}

function costBasisMatchesTransactions(authoritative: number, reconstructed: number): boolean {
  const tolerance = Math.max(1, Math.abs(authoritative) * 0.01);
  return Math.abs(authoritative - reconstructed) <= tolerance;
}

function isAuditCashIn(type: Transaction["type"]): boolean {
  return ["buy", "sip", "deposit", "contribution", "switch_in"].includes(type);
}

function isAuditCashOut(type: Transaction["type"]): boolean {
  return ["sell", "redemption", "dividend", "interest", "maturity", "withdrawal", "switch_out"].includes(type);
}

function isAuditLotOut(type: Transaction["type"]): boolean {
  return ["sell", "redemption", "switch_out"].includes(type);
}

function addAuditLot(lots: Array<{ quantity: number; cost: number }>, quantity: number, cost: number, addUnallocated: (cost: number) => void) {
  if (quantity > 0) lots.push({ quantity, cost });
  else addUnallocated(cost);
}

function removeAuditLot(lots: Array<{ quantity: number; cost: number }>, quantity: number, fallbackAmount: number, removeUnallocated: (cost: number) => void) {
  if (quantity <= 0) {
    removeUnallocated(fallbackAmount);
    return;
  }
  let remaining = quantity;
  while (remaining > 0.0000001 && lots.length > 0) {
    const lot = lots[0];
    const consumed = Math.min(lot.quantity, remaining);
    const consumedCost = lot.quantity === 0 ? 0 : lot.cost * (consumed / lot.quantity);
    lot.quantity = Math.max(0, lot.quantity - consumed);
    lot.cost = Math.max(0, lot.cost - consumedCost);
    remaining -= consumed;
    if (lot.quantity <= 0.0000001) lots.shift();
  }
}

function independentXirr(flows: Array<{ date: string; amount: number }>): number | null {
  const valid = flows.filter((flow) => flow.amount !== 0 && Number.isFinite(flow.amount) && !Number.isNaN(Date.parse(flow.date))).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  if (valid.length < 2 || !valid.some((flow) => flow.amount > 0) || !valid.some((flow) => flow.amount < 0)) return null;
  let rate = 0.1;
  for (let iteration = 0; iteration < 100; iteration++) {
    const { value, derivative } = independentNpvAndDerivative(valid, rate);
    if (Math.abs(value) < 0.000001) return roundPercent(rate * 100);
    if (derivative === 0) break;
    const next = rate - value / derivative;
    if (!Number.isFinite(next) || next <= -0.999999) break;
    if (Math.abs(next - rate) < 0.0000000001) return roundPercent(next * 100);
    rate = next;
  }
  return independentBisectionXirr(valid);
}

function independentNpvAndDerivative(flows: Array<{ date: string; amount: number }>, rate: number) {
  const start = Date.parse(flows[0].date);
  return flows.reduce((acc, flow) => {
    const years = (Date.parse(flow.date) - start) / (365.25 * 24 * 60 * 60 * 1000);
    const base = Math.pow(1 + rate, years);
    acc.value += flow.amount / base;
    acc.derivative += years === 0 ? 0 : -years * flow.amount / Math.pow(1 + rate, years + 1);
    return acc;
  }, { value: 0, derivative: 0 });
}

function independentBisectionXirr(flows: Array<{ date: string; amount: number }>): number | null {
  let low = -0.999999;
  let high = 10;
  let lowValue = independentNpv(flows, low);
  let highValue = independentNpv(flows, high);
  for (let i = 0; i < 80 && lowValue * highValue > 0; i++) {
    high *= 2;
    highValue = independentNpv(flows, high);
    if (high > 1_000_000) return null;
  }
  for (let i = 0; i < 160; i++) {
    const mid = (low + high) / 2;
    const midValue = independentNpv(flows, mid);
    if (Math.abs(midValue) < 0.000001) return roundPercent(mid * 100);
    if (lowValue * midValue <= 0) {
      high = mid;
      highValue = midValue;
    } else {
      low = mid;
      lowValue = midValue;
    }
  }
  return roundPercent(((low + high) / 2) * 100);
}

function independentNpv(flows: Array<{ date: string; amount: number }>, rate: number): number {
  const start = Date.parse(flows[0].date);
  return flows.reduce((sum, flow) => {
    const years = (Date.parse(flow.date) - start) / (365.25 * 24 * 60 * 60 * 1000);
    return sum + flow.amount / Math.pow(1 + rate, years);
  }, 0);
}


function splitPaths(value: string | undefined): string[] {
  return String(value ?? "").split(process.platform === "win32" ? ";" : ":").map((item) => item.trim()).filter(Boolean);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundPercent(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
