import { describe, expect, it } from "vitest";
import { applyCanonicalNpsImport, buildCanonicalNpsImport, parseNpsCsv } from "@/src/importers/npsStatement";
import { createEmptyBackup } from "@/src/schema/backup";
import { calculatePortfolioInsights } from "@/src/domain/analytics";

const npsCsv = `NPS Transaction Statement for Tier I Account
Subscriber Details
PRAN,'############
Subscriber Name,Example User
Statement Generation Date :June 22  2026 12:00 PM

Investment Details - Scheme Wise Summary
Particulars,Scheme wise Value of your Holdings(Investments) (in Rs) (E = U * N),Total Units ( U ),NAV as on 20-Jun-2026 ( N ),
SBI PENSION FUND SCHEME E - TIER I POP,100000.50,1000.5000,99.9500,
SBI PENSION FUND SCHEME G - TIER I POP,200000.25,2000.2500,100.0000,

 Contribution/Redemption Details during the selected period
Date,Particulars,Uploaded By,Employee Contribution(Rs),Employer's Contribution(Rs),Total(Rs),
01-May-2026,By Arrear - Regular contribution of April,POP,1000.00,9000.00,10000.00,

Transaction Details
SBI PENSION FUND SCHEME E - TIER I POP
Date,Description,Amount (in Rs),NAV,Units
01-Apr-2026,Opening balance,,,1000.0000
10-Apr-2026,Billing for Q1 2026-2027,(10.00),99.9000,(0.1001)
01-May-2026,By Arrear - Regular contribution of April,4000.00,100.0000,40.0000
20-Jun-2026,Closing Balance,,,1040.0000

SBI PENSION FUND SCHEME G - TIER I POP
Date,Description,Amount (in Rs),NAV,Units
01-May-2026,By Arrear - Regular contribution of April,6000.00,100.0000,60.0000
20-Jun-2026,Closing Balance,,,2060.0000
`;

describe("NPS statement importer", () => {
  it("parses scheme-wise holdings, contributions, and scheme transactions", () => {
    const parsed = parseNpsCsv(npsCsv);

    expect(parsed.errors).toEqual([]);
    expect(parsed.accountTier).toBe("Tier I");
    expect(parsed.holdings).toHaveLength(2);
    expect(parsed.holdings[0]).toMatchObject({ category: "Equity", value: 100000.5, units: 1000.5, nav: 99.95, navDate: "2026-06-20" });
    expect(parsed.holdings[1]).toMatchObject({ category: "Debt", value: 200000.25 });
    expect(parsed.contributionRows).toHaveLength(1);
    expect(parsed.transactions.map((row) => row.type)).toEqual(["fee", "contribution", "contribution"]);
  });

  it("treats subscriber scheme preference changes as internal switches, not external cash out", () => {
    const switchCsv = npsCsv.replace(
      "20-Jun-2026,Closing Balance,,,1040.0000",
      "15-May-2026,To Withdrawal On Account of Subscriber Initiated Scheme Preference Change,(1000.00),100.0000,(10.0000)\n20-Jun-2026,Closing Balance,,,1040.0000"
    ).replace(
      "20-Jun-2026,Closing Balance,,,2060.0000",
      "15-May-2026,By Contribution On Account of Subscriber Initiated Scheme Preference Change,1000.00,100.0000,10.0000\n20-Jun-2026,Closing Balance,,,2060.0000"
    );

    const parsed = parseNpsCsv(switchCsv);
    const backup = applyCanonicalNpsImport(createEmptyBackup("INR"), buildCanonicalNpsImport(parsed, { importId: "nps_switch", now: "2026-06-22T00:00:00.000Z" }));
    const insights = calculatePortfolioInsights(backup);

    expect(parsed.transactions.map((row) => row.type)).toContain("switch_out");
    expect(parsed.transactions.map((row) => row.type)).toContain("switch_in");
    expect(backup.transactions.filter((tx) => tx.type === "switch_out")).toHaveLength(1);
    expect(backup.transactions.filter((tx) => tx.type === "switch_in")).toHaveLength(1);
    expect(insights.transactionStats.externalCashOutBase).toBe(0);
  });

  it("builds and commits canonical NPS records", () => {
    const parsed = parseNpsCsv(npsCsv);
    const imported = buildCanonicalNpsImport(parsed, { importId: "nps_test", fileName: "nps-yearly.csv", now: "2026-06-22T00:00:00.000Z" });
    const backup = applyCanonicalNpsImport(createEmptyBackup("INR"), imported);

    expect(backup.accounts).toHaveLength(1);
    expect(backup.accounts[0]).toMatchObject({ type: "nps", institution: "NPS" });
    expect(backup.instruments.map((item) => item.category)).toEqual(["Equity", "Debt"]);
    expect(backup.manualBalances).toHaveLength(2);
    expect(backup.priceSnapshots).toHaveLength(2);
    expect(backup.transactions).toHaveLength(3);
    expect(backup.imports[0]).toMatchObject({ provider: "nps_statement", status: "committed" });
  });

  it("keeps latest NPS scheme balances while retaining older yearly transactions", () => {
    const olderCsv = npsCsv.replaceAll("2026", "2025").replaceAll("20-Jun-2025", "20-Jun-2025").replace("100000.50", "50000.50").replace("200000.25", "80000.25").replace("1000.5000", "500.5000").replace("2000.2500", "800.2500");
    const newer = buildCanonicalNpsImport(parseNpsCsv(npsCsv), { importId: "nps_newer", fileName: "nps-newer.csv", now: "2026-06-22T00:00:00.000Z" });
    const older = buildCanonicalNpsImport(parseNpsCsv(olderCsv), { importId: "nps_older", fileName: "nps-older.csv", now: "2026-06-22T00:00:00.000Z" });

    const backup = applyCanonicalNpsImport(applyCanonicalNpsImport(createEmptyBackup("INR"), newer), older);

    expect(backup.manualBalances.find((balance) => balance.label === "SBI PENSION FUND SCHEME E - TIER I POP")).toMatchObject({ value: 100000.5, asOfDate: "2026-06-20" });
    expect(backup.transactions.length).toBeGreaterThan(newer.transactions.length);
    expect(backup.imports).toHaveLength(2);
  });
});
