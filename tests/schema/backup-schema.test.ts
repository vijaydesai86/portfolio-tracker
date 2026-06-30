import { describe, expect, it } from "vitest";
import { createPortfolioSnapshot } from "@/src/domain/snapshots";
import { createEmptyBackup, parseBackup } from "@/src/schema/backup";

describe("canonical backup schema", () => {
  it("creates a valid empty backup", () => {
    const backup = createEmptyBackup("INR");
    expect(backup.schemaVersion).toBe(1);
    expect(backup.baseCurrency).toBe("INR");
    expect(parseBackup(backup).baseCurrency).toBe("INR");
  });

  it("rejects unsupported schema versions", () => {
    const backup = createEmptyBackup("INR") as any;
    backup.schemaVersion = 999;
    expect(() => parseBackup(backup)).toThrow(/schema/i);
  });

  it("defaults snapshots for legacy backups", () => {
    const backup = createEmptyBackup("INR") as any;
    delete backup.snapshots;

    expect(parseBackup(backup).snapshots).toEqual([]);
  });

  it("defaults new goal and transaction fields for older backups", () => {
    const backup = createEmptyBackup("INR") as any;
    backup.accounts.push({ id: "acct", name: "Broker", institution: "Broker", type: "us_stock", currency: "USD", createdAt: "2026-06-22T00:00:00.000Z", updatedAt: "2026-06-22T00:00:00.000Z" });
    backup.instruments.push({ id: "inst", name: "Stock", type: "us_stock", symbol: "STK", currency: "USD", country: "US", category: "Equity", createdAt: "2026-06-22T00:00:00.000Z", updatedAt: "2026-06-22T00:00:00.000Z" });
    backup.transactions.push({ id: "tx", accountId: "acct", instrumentId: "inst", date: "2026-06-22", type: "buy", quantity: 1, price: 10, amount: 10, currency: "USD", fees: 0, taxes: 0, source: { type: "manual" }, userModified: false, createdAt: "2026-06-22T00:00:00.000Z", updatedAt: "2026-06-22T00:00:00.000Z" });
    backup.goals.push({ id: "goal", name: "Goal", type: "custom", currentMonthlyExpense: 1000, targetAmount: 120000, currency: "INR", targetDate: "2030-01-01", inflationRate: 6, corpusMultiple: 10, expectedReturn: 10, equityReturn: 10, debtReturn: 6, goldReturn: 6, cashReturn: 6, otherReturn: 6, drawdownSpendGrowth: 6, drawdownHorizonYears: 45, drawdownWithdrawalTiming: "beginning", createdAt: "2026-06-22T00:00:00.000Z", updatedAt: "2026-06-22T00:00:00.000Z" });

    const parsed = parseBackup(backup);
    expect(parsed.transactions[0].taxFmvPrice).toBeUndefined();
    expect(parsed.goals[0].includeInCombinedGoals).toBe(true);
    expect(parsed.goals[0].includeInExpenseTotals).toBe(true);
  });

  it("round-trips a full backup without losing records", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({
      id: "acct_cash",
      name: "Emergency Cash",
      institution: "Manual",
      type: "cash",
      currency: "INR",
      createdAt: "2026-06-22T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z"
    });
    backup.manualBalances.push({
      id: "bal_cash",
      accountId: "acct_cash",
      label: "Emergency Cash",
      category: "Cash",
      currency: "INR",
      value: 125000,
      asOfDate: "2026-06-22",
      source: { type: "manual" },
      userModified: false,
      createdAt: "2026-06-22T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z"
    });
    backup.goals.push({
      id: "goal_retirement",
      name: "Retirement",
      type: "retirement",
      currentMonthlyExpense: 100000,
      targetAmount: 60000000,
      currency: "INR",
      targetDate: "2040-01-01",
      inflationRate: 6,
      corpusMultiple: 35,
      expectedReturn: 10,
      equityReturn: 10,
      debtReturn: 6,
      goldReturn: 6,
      cashReturn: 6,
      otherReturn: 6,
      drawdownSpendGrowth: 6,
      drawdownHorizonYears: 45,
      drawdownWithdrawalTiming: "beginning",
      includeInCombinedGoals: true,
      includeInExpenseTotals: true,
      createdAt: "2026-06-22T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z"
    });
    backup.goalMappings.push({
      id: "map_cash_retirement",
      goalId: "goal_retirement",
      manualBalanceId: "bal_cash",
      percent: 50,
      createdAt: "2026-06-22T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z"
    });
    backup.snapshots.push(createPortfolioSnapshot(backup, { name: "Schema snapshot", asOfDate: "2026-06-22", now: "2026-06-22T12:00:00.000Z" }));

    const parsed = parseBackup(JSON.parse(JSON.stringify(backup)));
    expect(parsed.accounts).toHaveLength(1);
    expect(parsed.manualBalances[0].value).toBe(125000);
    expect(parsed.goals[0].name).toBe("Retirement");
    expect(parsed.goals[0].corpusMultiple).toBe(35);
    expect(parsed.goalMappings[0].manualBalanceId).toBe("bal_cash");
    expect(parsed.snapshots).toHaveLength(1);
    expect(parsed.snapshots[0].name).toBe("Schema snapshot");
    expect(parsed.snapshots[0].frozenData.manualBalances[0].value).toBe(125000);
  });
});
