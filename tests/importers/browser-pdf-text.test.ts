import { describe, expect, it } from "vitest";
import { normalizeCasPdfJsLines } from "@/src/importers/browserPdfText";

describe("browser PDF text normalization", () => {
  it("rejoins CAS unit-balance carry lines emitted before dated transaction rows", () => {
    expect(normalizeCasPdfJsLines([
      "79,662.388",
      "03-Aug-2022 Purchase - via HDFCMFOnline                              199,990.00    15,903.651       12.5751"
    ])).toEqual([
      "03-Aug-2022 Purchase - via HDFCMFOnline                              199,990.00    15,903.651       12.5751 79,662.388"
    ]);
  });

  it("rejoins carried descriptions with date-only numeric rows", () => {
    expect(normalizeCasPdfJsLines([
      "SIP Purchase - Instalment 1/934 - via HDFCMFOnline                              2,681.615",
      "02-Mar-2022                              29,998.50       192.630       155.7315"
    ])).toEqual([
      "02-Mar-2022 SIP Purchase - Instalment 1/934 - via HDFCMFOnline 29,998.50 192.630 155.7315 2,681.615"
    ]);
  });

  it("rejoins carried stamp duty descriptions with amount-only rows", () => {
    expect(normalizeCasPdfJsLines([
      "*** Stamp Duty ***",
      "15-Feb-2023                              1.25"
    ])).toEqual(["15-Feb-2023 *** Stamp Duty *** 1.25"]);
  });
});
