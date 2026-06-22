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

    const parsed = parseBackup(JSON.parse(JSON.stringify(backup)));
    expect(parsed.accounts).toHaveLength(1);
    expect(parsed.manualBalances[0].value).toBe(125000);
  });
});
