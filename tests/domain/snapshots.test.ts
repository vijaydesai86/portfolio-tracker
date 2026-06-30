import { describe, expect, it } from "vitest";
import { buildSnapshotHistory, createPortfolioSnapshot, snapshotAnalytics } from "@/src/domain/snapshots";
import { createGoalMapping } from "@/src/domain/goalAnalytics";
import { createEmptyBackup, parseBackup, type PortfolioBackup } from "@/src/schema/backup";

describe("portfolio snapshots", () => {
  it("freezes canonical records and computed analytics", () => {
    const backup = fixtureBackup();
    const snapshot = createPortfolioSnapshot(backup, { name: "June close", notes: "Verified", asOfDate: "2026-06-24", now: "2026-06-24T10:00:00.000Z" });
    const analytics = snapshotAnalytics(snapshot);

    expect(snapshot.name).toBe("June close");
    expect(snapshot.notes).toBe("Verified");
    expect(snapshot.frozenData.manualBalances[0].value).toBe(100000);
    expect(snapshot.frozenData).not.toHaveProperty("snapshots");
    expect(analytics?.summary.netWorth).toBe(100000);
    expect(analytics?.performance.netInvested).toBe(80000);
    expect(analytics?.performance.totalProfit).toBe(20000);
    expect(analytics?.timelinePoint.netWorth).toBe(100000);
    expect(analytics?.goalSummary.mappedCurrentValue).toBe(100000);

    backup.manualBalances[0].value = 150000;
    backup.goals[0].targetAmount = 999999;

    expect(snapshot.frozenData.manualBalances[0].value).toBe(100000);
    expect(snapshotAnalytics(snapshot)?.summary.netWorth).toBe(100000);
    expect(snapshotAnalytics(snapshot)?.goalSummary.targetCorpus).not.toBe(999999);
  });

  it("builds a deterministic frozen history from saved snapshots", () => {
    const backup = fixtureBackup();
    const later = createPortfolioSnapshot(backup, { name: "Later", asOfDate: "2026-07-31", now: "2026-07-31T10:00:00.000Z" });
    backup.manualBalances[0].value = 90000;
    backup.manualBalances[0].asOfDate = "2026-05-31";
    const earlier = createPortfolioSnapshot(backup, { name: "Earlier", asOfDate: "2026-05-31", now: "2026-05-31T10:00:00.000Z" });

    const history = buildSnapshotHistory([later, earlier]);

    expect(history.map((point) => point.name)).toEqual(["Earlier", "Later"]);
    expect(history.map((point) => point.netWorth)).toEqual([90000, 100000]);
    expect(history[0].category.Equity).toBe(90000);
  });

  it("round-trips through canonical backup JSON", () => {
    const backup = fixtureBackup();
    const snapshot = createPortfolioSnapshot(backup, { name: "Exported", asOfDate: "2026-06-24", now: "2026-06-24T10:00:00.000Z" });
    const parsed = parseBackup(JSON.parse(JSON.stringify({ ...backup, snapshots: [snapshot] })));

    expect(parsed.snapshots).toHaveLength(1);
    expect(snapshotAnalytics(parsed.snapshots[0])?.performance.totalProfit).toBe(20000);
  });

  it("freezes combined-goal snapshot totals using only included goals", () => {
    const backup = fixtureBackup();
    backup.goals.push({ ...backup.goals[0], id: "goal_excluded", name: "Excluded", includeInCombinedGoals: false });
    backup.goalMappings.push(createGoalMapping("goal_excluded", "bal_eq", 100, "2026-01-01T00:00:00.000Z"));

    const snapshot = createPortfolioSnapshot(backup, { name: "Goal filter", asOfDate: "2026-06-24", now: "2026-06-24T10:00:00.000Z" });
    const analytics = snapshotAnalytics(snapshot)!;

    expect(analytics.goals).toHaveLength(2);
    expect(analytics.goalSummary.mappedCurrentValue).toBe(100000);
    expect(analytics.timelinePoint.goalMappedCurrent).toBe(100000);
  });

  it("freezes goal expense rows inside snapshots", () => {
    const backup = fixtureBackup();
    backup.goalExpenses.push({ id: "goal_exp_retirement_grocery", goalId: "goal_retire", expense: "Grocery", amount: 50000, currency: "INR", baseDate: "2026-06-29", scenario: "Current", frequency: "monthly", createdAt: "2026-06-29T00:00:00.000Z", updatedAt: "2026-06-29T00:00:00.000Z" });

    const snapshot = createPortfolioSnapshot(backup, { name: "Expense freeze", asOfDate: "2026-06-29", now: "2026-06-29T10:00:00.000Z" });

    expect(snapshot.frozenData.goalExpenses).toHaveLength(1);
    expect(snapshot.frozenData.goalExpenses[0].expense).toBe("Grocery");
    expect(snapshotAnalytics(snapshot)?.goals[0].expenseSource).toBe("expenses");
  });

});

function fixtureBackup(): PortfolioBackup {
  const backup = createEmptyBackup("INR");
  const now = "2026-01-01T00:00:00.000Z";
  backup.accounts.push({ id: "acct_eq", name: "Equity", institution: "Manual", type: "us_stock", currency: "INR", createdAt: now, updatedAt: now });
  backup.instruments.push({ id: "inst_eq", name: "Equity Holding", type: "us_stock", symbol: "EQ", currency: "INR", country: "IN", category: "Equity", issuer: "Manual Issuer", createdAt: now, updatedAt: now });
  backup.transactions.push({ id: "tx_buy", accountId: "acct_eq", instrumentId: "inst_eq", date: "2026-01-01", type: "buy", quantity: 10, price: 8000, amount: 80000, currency: "INR", fees: 0, taxes: 0, source: { type: "manual", provider: "manual_entry" }, userModified: false, createdAt: now, updatedAt: now });
  backup.manualBalances.push({ id: "bal_eq", accountId: "acct_eq", instrumentId: "inst_eq", label: "Equity Holding", category: "Equity", currency: "INR", value: 100000, quantity: 10, price: 10000, asOfDate: "2026-06-24", source: { type: "manual", provider: "manual_entry" }, userModified: false, createdAt: now, updatedAt: now });
  backup.goals.push({ id: "goal_retire", name: "Retirement", type: "retirement", currentMonthlyExpense: 10000, targetAmount: 1200000, currency: "INR", targetDate: "2030-01-01", inflationRate: 0, corpusMultiple: 10, expectedReturn: 10, equityReturn: 10, debtReturn: 6, goldReturn: 6, cashReturn: 6, otherReturn: 6, drawdownSpendGrowth: 6, drawdownHorizonYears: 45, drawdownWithdrawalTiming: "beginning", includeInCombinedGoals: true, includeInExpenseTotals: true, createdAt: now, updatedAt: now });
  backup.goalMappings.push(createGoalMapping("goal_retire", "bal_eq", 100, now));
  return backup;
}
