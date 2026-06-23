import { describe, expect, it } from "vitest";
import { applyCanonicalEpfoImport, buildCanonicalEpfoImport, parseEpfoPassbookText } from "@/src/importers/epfoPassbook";
import { createEmptyBackup } from "@/src/schema/backup";


const epfoDualSummaryText = `
EPF Passbook [ Financial Year - 2024-2025 ]
Total Contributions for the year [ 2024 ]                            3,07,800                3,07,800                           0
Total Transfer-Ins/VDRs for the year [ 2024 ]                               6,79,429                6,79,429                           0
Total Withdrawals for the year [ 2024 ]                                          0                      0                       0
Int. Updated upto 31/03/2025                                                                                                                                        54,934                  54,934                          0
Closing Balance as on 31/03/2025                                                                                                                                10,68,502              10,68,502                            0
OB Int. Updated upto 01/04/2024                                                                     26,339                                                 26,339                                                          0
Jan-2025                                                                                            25,800                                               2,50,000                                                  32,000
Feb-2025                                                                                            25,800                                               2,50,000                                                  32,000
Mar-2025                                                                                            25,800                                               2,50,000                                                  57,800
TOTAL                                                                                            3,07,800                                                2,50,000                                                  57,800
Int. Updated upto 31/03/2025                                                                        54,934                                                 54,671                                                       263
Closing Balance as on 31/03/2025                                                                 3,89,073                                                3,31,010                                                  58,063
Printed On : 23-06-2026 10:58:25
`;

const epfoText = `
EPF Passbook [ Financial Year - 2025-2026 ]
Total Contributions for the year [ 2025 ]
12,000
10,000
8,000
Total Withdrawals for the year [ 2025 ]
0
0
0
1,234
987
765
1,23,456
98,765
76,543
Int. Updated upto 31/03/2026
Closing Balance as on 31/03/2026
`;

describe("EPFO passbook importer", () => {
  it("parses closing PF buckets and yearly contributions", () => {
    const parsed = parseEpfoPassbookText(epfoText);

    expect(parsed.errors).toEqual([]);
    expect(parsed.asOfDate).toBe("2026-03-31");
    expect(parsed.balances).toEqual([
      { key: "employee", label: "EPF Employee Share", value: 123456 },
      { key: "employer", label: "EPF Employer Share", value: 98765 },
      { key: "pension", label: "EPS Pension Share", value: 76543 }
    ]);
    expect(parsed.yearlyContributions.map((row) => row.value)).toEqual([12000, 10000, 8000]);
    expect(parsed.yearlyInterest.map((row) => row.value)).toEqual([1234, 987, 765]);
  });


  it("prefers detailed PF buckets over the combined summary table", () => {
    const parsed = parseEpfoPassbookText(epfoDualSummaryText);

    expect(parsed.errors).toEqual([]);
    expect(parsed.asOfDate).toBe("2025-03-31");
    expect(parsed.balances.map((row) => row.value)).toEqual([389073, 331010, 58063]);
    expect(sumBucket(parsed.yearlyContributions, "employee")).toBe(77400);
    expect(sumBucket(parsed.yearlyContributions, "employer")).toBe(250000);
    expect(sumBucket(parsed.yearlyContributions, "pension")).toBe(57800);
    expect(parsed.yearlyInterest.map((row) => row.value)).toEqual([54934, 54671, 263]);
  });

  it("builds and commits canonical EPF records without duplicate IDs", () => {
    const parsed = parseEpfoPassbookText(epfoText);
    const imported = buildCanonicalEpfoImport(parsed, { importId: "epfo_test", fileName: "pf-yearly.pdf", now: "2026-06-22T00:00:00.000Z" });
    const backup = applyCanonicalEpfoImport(createEmptyBackup("INR"), imported);

    expect(backup.accounts).toHaveLength(1);
    expect(backup.accounts[0]).toMatchObject({ type: "epf", institution: "EPFO" });
    expect(backup.instruments.map((item) => item.type)).toEqual(["epf", "epf", "epf"]);
    expect(backup.instruments.map((item) => item.category)).toEqual(["Debt", "Debt", "Debt"]);
    expect(backup.manualBalances).toHaveLength(3);
    expect(backup.manualBalances.map((balance) => balance.category)).toEqual(["Debt", "Debt", "Debt"]);
    expect(backup.transactions).toHaveLength(6);
    expect(backup.transactions.filter((tx) => tx.type === "interest_accrual").map((tx) => tx.amount)).toEqual([1234, 987, 765]);
    expect(backup.imports[0]).toMatchObject({ provider: "epfo_passbook", status: "committed" });
  });

  it("keeps the latest PF closing balance when yearly files are imported out of order", () => {
    const olderText = epfoText.replaceAll("31/03/2026", "31/03/2025").replace("1,23,456", "50,000").replace("98,765", "40,000").replace("76,543", "30,000");
    const newer = buildCanonicalEpfoImport(parseEpfoPassbookText(epfoText), { importId: "pf_newer", fileName: "pf-newer.pdf", now: "2026-06-22T00:00:00.000Z" });
    const older = buildCanonicalEpfoImport(parseEpfoPassbookText(olderText), { importId: "pf_older", fileName: "pf-older.pdf", now: "2026-06-22T00:00:00.000Z" });

    const backup = applyCanonicalEpfoImport(applyCanonicalEpfoImport(createEmptyBackup("INR"), newer), older);

    expect(backup.manualBalances.find((balance) => balance.label === "EPF Employee Share")).toMatchObject({ value: 123456, asOfDate: "2026-03-31" });
    expect(backup.transactions.length).toBeGreaterThan(newer.transactions.length);
    expect(backup.imports).toHaveLength(2);
  });
});

function sumBucket(rows: Array<{ key: string; value: number }>, key: string): number {
  return rows.filter((row) => row.key === key).reduce((sum, row) => sum + row.value, 0);
}
