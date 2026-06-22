import { describe, expect, it } from "vitest";
import { buildReadinessModules } from "@/src/domain/assetModules";

describe("asset module classification", () => {
  it("uses structured account and instrument types instead of fund-name fragments", () => {
    const modules = buildReadinessModules([
      {
        accountType: "mutual_fund",
        instrumentType: "mutual_fund",
        valueInBase: 6793647.88
      },
      {
        accountType: "mutual_fund",
        instrumentType: "mutual_fund",
        valueInBase: 3366847.29
      },
      {
        accountType: "us_stock",
        instrumentType: "us_stock",
        valueInBase: 13947259.53
      }
    ]);

    expect(modules.find((module) => module.label === "Mutual Funds")).toMatchObject({ count: 2, value: 10160495.17 });
    expect(modules.find((module) => module.label === "US Stocks")).toMatchObject({ count: 1, value: 13947259.53 });
    expect(modules.find((module) => module.label === "Indian Stocks")).toMatchObject({ count: 0, value: 0 });
    expect(modules.find((module) => module.label === "PF / EPF")).toMatchObject({ count: 0, value: 0 });
  });

  it("routes future manual asset modules only from their explicit types", () => {
    const modules = buildReadinessModules([
      { accountType: "epf", valueInBase: 100 },
      { accountType: "ppf", valueInBase: 200 },
      { accountType: "ssy", valueInBase: 300 },
      { accountType: "nps", valueInBase: 400 },
      { accountType: "fd", valueInBase: 500 },
      { accountType: "cash", valueInBase: 600 },
      { accountType: "espp", valueInBase: 700 }
    ]);

    expect(modules.find((module) => module.label === "PF / EPF")).toMatchObject({ count: 1, value: 100 });
    expect(modules.find((module) => module.label === "PPF / SSY")).toMatchObject({ count: 2, value: 500 });
    expect(modules.find((module) => module.label === "NPS")).toMatchObject({ count: 1, value: 400 });
    expect(modules.find((module) => module.label === "FD")).toMatchObject({ count: 1, value: 500 });
    expect(modules.find((module) => module.label === "Cash / ESPP")).toMatchObject({ count: 2, value: 1300 });
  });
});
