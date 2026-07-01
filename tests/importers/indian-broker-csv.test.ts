import { describe, expect, it } from "vitest";
import { createEmptyBackup } from "@/src/schema/backup";
import { commitParsedImport } from "@/src/importers/importPipeline";
import { parseGrowwStockOrderRows, parseGrowwStockOrdersCsv, parseZerodhaTradebookCsv } from "@/src/importers/indianBrokerCsv";
import { detectImportSource } from "@/src/importers/detectImport";
import { buildGoal, createGoalMapping } from "@/src/domain/goalAnalytics";

const zerodhaCsv = `symbol\tisin\ttrade_date\texchange\tsegment\tseries\ttrade_type\tauction\tquantity\tprice\ttrade_id\torder_id\torder_execution_time
ITC\tINE154A01025\t31-10-2025\tNSE\tEQ\tEQ\tsell\tFALSE\t100\t423.8\t203525328\t1100000001\t2025-10-31T11:24:50
ICICIBANK\tINE090A01021\t09-09-2025\tNSE\tEQ\tEQ\tbuy\tFALSE\t20\t1401\t205778673\t1100000002\t2025-09-09T13:44:21`;

const growwCsv = `Name\tExample User
Unique Client Code\t0000000000

Order history for stocks from 01-04-2022 to 30-06-2026

Stock name\tSymbol\tISIN\tType\tQuantity\tValue\tExchange\tExchange Order Id\tExecution date and time\tOrder status
ITC LTD\tITC\tINE154A01025\tBUY\t195\t64545\tNSE\t1100000009252026\t12-09-2022 12:40 PM\tExecuted
ITC LTD\tITC\tINE154A01025\tSELL\t195\t65325\tNSE\t1100000014491634\t13-09-2022 01:18 PM\tExecuted
BAD LTD\tBAD\tINE000000000\tBUY\t1\t100\tNSE\t110000001\t14-09-2022 01:18 PM\tCancelled`;

const growwOpenCsv = "Stock name\tSymbol\tISIN\tType\tQuantity\tValue\tExchange\tExchange Order Id\tExecution date and time\tOrder status\nITC LTD\tITC\tINE154A01025\tBUY\t195\t64545\tNSE\t1100000009252026\t12-09-2022 12:40 PM\tExecuted";


describe("Indian broker CSV importers", () => {
  it("detects Zerodha and Groww stock CSVs", () => {
    expect(detectImportSource({ fileName: "tradebook.csv", textSample: zerodhaCsv })).toMatchObject({ providerId: "zerodha_tradebook", status: "implemented" });
    expect(detectImportSource({ fileName: "groww.csv", textSample: growwCsv })).toMatchObject({ providerId: "groww_stock_orders", status: "implemented" });
    expect(detectImportSource({ fileName: "Stocks_Order_History_8689599389_01-04-2025_30-06-2026.xlsx", textSample: "" })).toMatchObject({ providerId: "groww_stock_orders", nativeInputType: "xlsx", status: "implemented" });
  });

  it("parses Zerodha tradebook rows as canonical Indian stock transactions", () => {
    const parsed = parseZerodhaTradebookCsv(zerodhaCsv, { importId: "zerodha_1", now: "2026-07-01T00:00:00.000Z" });
    expect(parsed.errors).toEqual([]);
    expect(parsed.transactions).toHaveLength(2);
    expect(parsed.transactions[0]).toMatchObject({ type: "sell", quantity: 100, price: 423.8, amount: 42380, currency: "INR", source: { provider: "zerodha_tradebook" } });
    expect(parsed.instruments.find((item) => item.symbol === "ICICIBANK")).toMatchObject({ isin: "INE090A01021", type: "indian_stock", category: "Equity" });
  });

  it("parses only executed Groww stock orders and derives price from value divided by quantity", () => {
    const parsed = parseGrowwStockOrdersCsv(growwCsv, { importId: "groww_1", now: "2026-07-01T00:00:00.000Z" });
    expect(parsed.errors).toEqual([]);
    expect(parsed.transactions).toHaveLength(2);
    expect(parsed.transactions.map((tx) => tx.price)).toEqual([331, 335]);
    expect(parsed.transactions.map((tx) => tx.date)).toEqual(["2022-09-12", "2022-09-13"]);
  });


  it("parses Groww XLSX-style workbook rows with metadata before the header", () => {
    const parsed = parseGrowwStockOrderRows([
      ["Name", "Example User"],
      ["Unique Client Code", "0000000000"],
      [],
      ["Order history for stocks from 01-04-2022 to 30-06-2026"],
      [],
      ["Stock name", "Symbol", "ISIN", "Type", "Quantity", "Value", "Exchange", "Exchange Order Id", "Execution date and time", "Order status"],
      ["ITC LTD", "ITC", "INE154A01025", "BUY", 195, 64545, "NSE", "1100000009252026", "12-09-2022 12:40 PM", "Executed"],
      ["HINDUSTAN UNILEVER LTD.", "HINDUNILVR", "INE030A01027", "SELL", 25, 64157.5, "NSE", "1100000022039263", "15-09-2022 02:43 PM", "Executed"]
    ], { importId: "groww_xlsx", now: "2026-07-01T00:00:00.000Z" });

    expect(parsed.errors).toEqual([]);
    expect(parsed.transactions).toHaveLength(2);
    expect(parsed.transactions.map((tx) => tx.date)).toEqual(["2022-09-12", "2022-09-15"]);
    expect(parsed.transactions.map((tx) => tx.price)).toEqual([331, 2566.3]);
    expect(parsed.instruments.find((item) => item.symbol === "HINDUNILVR")).toMatchObject({ name: "HINDUSTAN UNILEVER LTD.", isin: "INE030A01027" });
  });

  it("commits broker rows through the same replacement/dedupe pipeline", () => {
    const firstParsed = parseGrowwStockOrdersCsv(growwCsv, { importId: "groww_old", now: "2026-07-01T00:00:00.000Z" });
    const first = commitParsedImport(createEmptyBackup("INR"), firstParsed, { importId: "groww_old", provider: "groww_stock_orders", now: "2026-07-01T00:00:00.000Z" }).backup;
    const replacementParsed = parseGrowwStockOrdersCsv(growwCsv, { importId: "groww_new", now: "2026-07-02T00:00:00.000Z" });
    const replaced = commitParsedImport(first, replacementParsed, { importId: "groww_new", replaceImportId: "groww_old", provider: "groww_stock_orders", now: "2026-07-02T00:00:00.000Z" }).backup;
    expect(replaced.transactions).toHaveLength(2);
    expect(replaced.transactions.every((tx) => tx.source.importId === "groww_new")).toBe(true);
    expect(replaced.imports.some((run) => run.id === "groww_old")).toBe(false);
  });

  it("preserves derived holding edits and goal mappings when replacing transaction-only broker imports", () => {
    const now = "2026-07-01T00:00:00.000Z";
    const firstParsed = parseGrowwStockOrdersCsv(growwOpenCsv, { importId: "groww_old", now });
    const firstResult = commitParsedImport(createEmptyBackup("INR"), firstParsed, { importId: "groww_old", provider: "groww_stock_orders", now });
    const first = firstResult.backup;
    const holding = first.manualBalances.find((balance) => balance.source.provider === "manual_positions");
    expect(holding).toBeDefined();
    const goal = buildGoal({ name: "Goal", type: "custom", currentMonthlyExpense: 1000, inflationRate: 6, targetYear: 2035, corpusMultiple: 10 }, now);
    first.goals.push(goal);
    first.goalMappings.push(createGoalMapping(goal.id, holding!.id, 100, now));
    first.manualBalances = first.manualBalances.map((balance) => balance.id === holding!.id ? { ...balance, taperMode: "medium", taperFactor: 0.05, userModified: true } : balance);

    const replacementParsed = parseGrowwStockOrdersCsv(growwOpenCsv, { importId: "groww_new", now: "2026-07-02T00:00:00.000Z" });
    const replaced = commitParsedImport(first, replacementParsed, { importId: "groww_new", replaceImportId: "groww_old", provider: "groww_stock_orders", now: "2026-07-02T00:00:00.000Z" }).backup;
    const replacedHolding = replaced.manualBalances.find((balance) => balance.id === holding!.id);

    expect(replacedHolding).toMatchObject({ taperMode: "medium", taperFactor: 0.05, userModified: true, source: { importId: "groww_new", provider: "manual_positions" } });
    expect(replaced.goalMappings.some((mapping) => mapping.manualBalanceId === holding!.id)).toBe(true);
  });
});
