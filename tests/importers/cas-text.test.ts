
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

  it("classifies hyphenated CAS switch transactions as switch flows", () => {
    const parsed = parseCasText(`Consolidated Account Statement
Folio No: 123456 PAN: REDACTED
REDACTED INVESTOR
ABC1-Sample Index Fund - Direct Plan Growth - ISIN: INF000000003 Registrar : CAMS
Nominee 1: REDACTED Opening Unit Balance: 0.000
03-Nov-2022   Switch-In - From Sample Sensex Fund - via AMCOnline                         1,526,065.80         8,935.722          170.7826              8,935.722
03-Nov-2022   Switch-Out - To Sample Nifty Fund - via AMCOnline                             100,000.00          -500.000          200.0000              8,435.722
Closing Unit Balance: 8,435.722 NAV on 19-Jun-2026: INR 200.0000 Total Cost Value: 1,426,065.80 Market Value on 19-Jun-2026: INR 1,687,144.40`);

    expect(parsed.errors).toEqual([]);
    expect(parsed.schemes[0].transactions.map((tx) => tx.type)).toEqual(["switch_in", "switch_out"]);
  });

  it("uses CAS Total Cost Value as holding invested amount when statement-window transactions are partial", () => {
    const partialHistoryCas = `Consolidated Account Statement
Date          Transaction                                                                         Amount               Units             Price                 Unit
                                                                                                       (INR)                              (INR)                Balance
Sample Mutual Fund
Folio No: 123456 / 78                                                                            PAN: REDACTED                                   KYC: OK PAN: OK
REDACTED INVESTOR
ABC1-Sample Index Fund - Direct Plan - Growth - ISIN: INF000000002 Registrar : CAMS
Nominee 1: REDACTED Opening Unit Balance: 100.000
04-Nov-2025   Purchase - via AMCOnline                                                            10,000.00            10.000         1,000.000                 110.000
Closing Unit Balance: 110.000             NAV on 19-Jun-2026: INR 1,200.000       Total Cost Value: 1,10,000.00            Market Value on 19-Jun-2026: INR 1,32,000.00`;

    const imported = buildCanonicalCasImport(parseCasText(partialHistoryCas), {
      importId: "cas_test_partial_history",
      fileName: "sample-cas.pdf",
      now: "2026-06-22T00:00:00.000Z"
    });

    expect(imported.manualBalances[0]).toMatchObject({
      value: 132000,
      investedAmount: 110000,
      investedCurrency: "INR",
      investedAsOfDate: "2026-06-19"
    });
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

  it("classifies common mutual fund categories from scheme names", () => {
    const multiSchemeCas = `Consolidated Account Statement
Folio No: 1 PAN: REDACTED
REDACTED INVESTOR
AAA-Parag Parikh Dynamic Asset Allocation Fund - Direct Plan Growth - ISIN: INF000000010 Registrar : CAMS
Nominee 1: REDACTED Opening Unit Balance: 0.000
Closing Unit Balance: 10.000 NAV on 19-Jun-2026: INR 10.000 Total Cost Value: 100.00 Market Value on 19-Jun-2026: INR 100.00
Folio No: 2 PAN: REDACTED
REDACTED INVESTOR
BBB-Parag Parikh Conservative Hybrid Fund - Direct Plan Growth - ISIN: INF000000011 Registrar : CAMS
Nominee 1: REDACTED Opening Unit Balance: 0.000
Closing Unit Balance: 10.000 NAV on 19-Jun-2026: INR 10.000 Total Cost Value: 100.00 Market Value on 19-Jun-2026: INR 100.00`;

    const parsed = parseCasText(multiSchemeCas);

    expect(parsed.schemes.map((scheme) => ({ name: scheme.schemeName, category: scheme.category }))).toEqual([
      { name: "Parag Parikh Dynamic Asset Allocation Fund - Direct Plan Growth", category: "Equity" },
      { name: "Parag Parikh Conservative Hybrid Fund - Direct Plan Growth", category: "Debt" }
    ]);
  });

});
