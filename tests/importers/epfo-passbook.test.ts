import { describe, expect, it } from "vitest";
import { applyCanonicalEpfoImport, buildCanonicalEpfoImport, parseEpfoPassbookText } from "@/src/importers/epfoPassbook";
import { createEmptyBackup } from "@/src/schema/backup";

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
  });

  it("builds and commits canonical EPF records without duplicate IDs", () => {
    const parsed = parseEpfoPassbookText(epfoText);
    const imported = buildCanonicalEpfoImport(parsed, { importId: "epfo_test", fileName: "pf-yearly.pdf", now: "2026-06-22T00:00:00.000Z" });
    const backup = applyCanonicalEpfoImport(createEmptyBackup("INR"), imported);

    expect(backup.accounts).toHaveLength(1);
    expect(backup.accounts[0]).toMatchObject({ type: "epf", institution: "EPFO" });
    expect(backup.instruments.map((item) => item.type)).toEqual(["epf", "epf", "epf"]);
    expect(backup.manualBalances).toHaveLength(3);
    expect(backup.transactions).toHaveLength(3);
    expect(backup.imports[0]).toMatchObject({ provider: "epfo_passbook", status: "committed" });
  });
});
