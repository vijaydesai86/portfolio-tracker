import { describe, expect, it } from "vitest";
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

    const parsed = parseBackup(JSON.parse(JSON.stringify(backup)));
    expect(parsed.accounts).toHaveLength(1);
    expect(parsed.manualBalances[0].value).toBe(125000);
    expect(parsed.goals[0].name).toBe("Retirement");
    expect(parsed.goals[0].corpusMultiple).toBe(35);
    expect(parsed.goalMappings[0].manualBalanceId).toBe("bal_cash");
  });
});
