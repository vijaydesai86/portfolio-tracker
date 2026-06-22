
import { describe, expect, it } from "vitest";
import { buildCanonicalCasImport, parseCasText } from "@/src/importers/casText";

const sampleCasText = `Consolidated Account Statement
Date          Transaction                                                                         Amount               Units             Price                 Unit
                                                                                                       (INR)                              (INR)                Balance
Sample Mutual Fund
Folio No: 123456 / 78                                                                            PAN: REDACTED                                   KYC: OK PAN: OK
REDACTED INVESTOR
ABC1-Sample Flexi Cap Fund - Direct Plan - Growth (Non-Demat) - ISIN: INF000000001(Advisor: DIRECT)                                               Registrar : CAMS
Nominee 1:      REDACTED                               Nominee 2:                                              Nominee 3:
                                                                                                                                           Opening Unit Balance: 0.000
04-Nov-2025   Purchase - via AMCOnline                                                            14,999.25             6.639         2,259.271                   6.639
04-Nov-2025   *** Stamp Duty ***                                                                       0.75
Closing Unit Balance: 6.639             NAV on 19-Jun-2026: INR 2,199.955       Total Cost Value: 15,000.00            Market Value on 19-Jun-2026: INR 14,605.50`;

describe("CAS text parser", () => {
  it("parses scheme identity, transaction rows, and closing valuation", () => {
    const parsed = parseCasText(sampleCasText);

    expect(parsed.errors).toEqual([]);
    expect(parsed.schemes).toHaveLength(1);
    expect(parsed.datedRows).toBe(2);
    expect(parsed.parsedFinancialRows).toBe(2);
    expect(parsed.schemes[0]).toMatchObject({
      folio: "123456 / 78",
      registrar: "CAMS",
      schemeCode: "ABC1",
      schemeName: "Sample Flexi Cap Fund - Direct Plan - Growth (Non-Demat)",
      isin: "INF000000001",
      openingUnitBalance: 0,
      closingUnitBalance: 6.639,
      navDate: "2026-06-19",
      nav: 2199.955,
      totalCostValue: 15000,
      marketValueDate: "2026-06-19",
      marketValue: 14605.5
    });
    expect(parsed.schemes[0].transactions.map((tx) => tx.type)).toEqual(["purchase", "stamp_duty"]);
  });

  it("normalizes parsed CAS data into canonical portfolio records", () => {
    const parsed = parseCasText(sampleCasText);
    const imported = buildCanonicalCasImport(parsed, {
      importId: "cas_test",
      fileName: "sample-cas.pdf",
      now: "2026-06-22T00:00:00.000Z"
    });

    expect(imported.accounts).toHaveLength(1);
    expect(imported.instruments).toHaveLength(1);
    expect(imported.transactions).toHaveLength(2);
    expect(imported.manualBalances).toHaveLength(1);
    expect(imported.priceSnapshots).toHaveLength(1);
    expect(imported.importRun).toMatchObject({ provider: "cas_pdf", status: "staged", confidence: "medium" });
  });
});
