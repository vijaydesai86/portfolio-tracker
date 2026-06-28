import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { calculatePortfolioInsights, calculatePortfolioSummary } from "@/src/domain/analytics";
import { calculateDashboardPerformance } from "@/src/domain/dashboardPerformance";
import { calculateHoldingReturns } from "@/src/domain/holdingReturns";
import { commitManualCsvImport, previewManualCsvImport } from "@/src/importers/importPipeline";
import { createEmptyBackup } from "@/src/schema/backup";

const balanceCsv = `balance_id,as_of_date,institution,asset_type,name,current_value,currency,category
cash-main,2026-06-22,Manual,cash,Cash,100,INR,Cash`;
const transactionCsv = `transaction_id,date,platform,asset_type,symbol_or_isin,name,type,quantity,price,amount,fees,taxes,currency,category
aapl-buy-1,2026-01-15,Fidelity,us_stock,AAPL,Apple Inc,buy,10,100,,0,0,USD,Equity`;

describe("import pipeline", () => {
  it("does not duplicate manual balance records on reimport", () => {
    const backup = createEmptyBackup("INR");
    const first = commitManualCsvImport(backup, balanceCsv, { importId: "one", fileName: "manual.csv" });
    const second = commitManualCsvImport(first.backup, balanceCsv, { importId: "two", fileName: "manual.csv" });

    expect(second.backup.accounts).toHaveLength(1);
    expect(second.backup.manualBalances).toHaveLength(1);
    expect(second.skippedDuplicates).toBe(1);
  });

  it("preserves user-modified balances during reimport", () => {
    const backup = createEmptyBackup("INR");
    const first = commitManualCsvImport(backup, balanceCsv, { importId: "one", fileName: "manual.csv" }).backup;
    first.manualBalances[0] = {
      ...first.manualBalances[0],
      value: 250,
      userModified: true
    };

    const second = commitManualCsvImport(first, balanceCsv, { importId: "two", fileName: "manual.csv" });
    expect(second.backup.manualBalances[0].value).toBe(250);
    expect(second.backup.manualBalances[0].userModified).toBe(true);
  });

  it("does not duplicate manual transaction records or derived positions on reimport", () => {
    const backup = createEmptyBackup("INR");
    const first = commitManualCsvImport(backup, transactionCsv, { importId: "one", fileName: "tx.csv" });
    const second = commitManualCsvImport(first.backup, transactionCsv, { importId: "two", fileName: "tx.csv" });

    expect(second.backup.transactions).toHaveLength(1);
    expect(second.backup.manualBalances).toHaveLength(1);
    expect(second.skippedDuplicates).toBeGreaterThanOrEqual(2);
  });

  it("updates non-edited balance values when the same balance id is reuploaded", () => {
    const backup = createEmptyBackup("INR");
    const first = commitManualCsvImport(backup, balanceCsv, { importId: "one", fileName: "manual.csv" }).backup;
    const updatedCsv = `balance_id,as_of_date,institution,asset_type,name,current_value,currency,category
cash-main,2026-06-23,Manual,cash,Cash,250,INR,Cash`;

    const second = commitManualCsvImport(first, updatedCsv, { importId: "two", fileName: "manual.csv" });
    expect(second.backup.manualBalances).toHaveLength(1);
    expect(second.backup.manualBalances[0].value).toBe(250);
    expect(second.backup.manualBalances[0].asOfDate).toBe("2026-06-23");
  });

  it("imports compact manual balance ledger rows into transactions, holdings, and analytics", () => {
    const backup = createEmptyBackup("INR");
    const csv = readFileSync(resolve(__dirname, "../../fixtures/importable/manual-balance-ledger-sample.csv"), "utf8");

    const result = commitManualCsvImport(backup, csv, { importId: "ledger", fileName: "manual-balance-ledger-sample.csv", now: "2026-06-24T00:00:00.000Z" });
    const summary = calculatePortfolioSummary(result.backup);
    const insights = calculatePortfolioInsights(result.backup);
    const holdingReturns = calculateHoldingReturns(result.backup);
    const performance = calculateDashboardPerformance(summary, insights.transactionStats, holdingReturns.values());

    expect(result.errors).toEqual([]);
    expect(result.addedTransactions).toBe(33);
    expect(result.backup.manualBalances).toHaveLength(5);
    expect(result.backup.accounts.map((account) => account.type).sort()).toEqual(["cash", "cash", "espp", "ppf", "ssy"]);
    expect(summary.netWorth).toBe(8940);
    expect(summary.allocation.Debt.value).toBe(8110);
    expect(summary.allocation.Equity.value).toBe(330);
    expect(summary.allocation.Cash.value).toBe(500);
    expect(performance.netInvested).toBe(8730);
    expect(performance.totalProfit).toBe(210);
    expect(insights.transactionStats.externalCashInBase).toBe(8730);
    expect(result.backup.transactions.filter((tx) => tx.type === "interest_accrual")).toHaveLength(8);
    expect([...holdingReturns.values()].filter((row) => row.costBasisKnown)).toHaveLength(4);
  });
  it("imports Fidelity-style manual US stock rows with USD price and row-level USD-INR FX", () => {
    const csv = `transaction_id,date,platform,asset_type,symbol_or_isin,name,type,quantity,price ($),USD-INR,fees,taxes,currency,category,notes,FMV
1,15-02-2025,Fidelity,us_stock,TST,Example US Stock,buy,10,10,80,0,,USD,Equity,RSU1,11
2,15-05-2025,Fidelity,us_stock,TST,Example US Stock,buy,5,12,81,0,,USD,Equity,RSU2,13
3,28-05-2026,Fidelity,us_stock,TST,Example US Stock,sell,3,30,90,0,,USD,Equity,RSU1,31`;

    const result = commitManualCsvImport(createEmptyBackup("INR"), csv, { importId: "fid_manual", fileName: "manual-fidelity.csv", now: "2026-06-24T00:00:00.000Z" });
    const holdingReturns = calculateHoldingReturns(result.backup);
    const holding = result.backup.manualBalances[0];
    const row = holdingReturns.get(holding.id)!;

    expect(result.errors).toEqual([]);
    expect(result.addedTransactions).toBe(3);
    expect(result.addedBalances).toBe(1);
    expect(result.addedPrices).toBe(6);
    expect(result.backup.priceSnapshots.filter((snapshot) => snapshot.instrumentId === "USDINR").map((snapshot) => snapshot.price)).toEqual([80, 81, 90]);
    expect(result.backup.transactions.map((tx) => tx.taxFmvPrice)).toEqual([11, 13, 31]);
    expect(holding.quantity).toBe(12);
    expect(holding.price).toBe(30);
    expect(holding.value).toBe(360);
    expect(row.invested).toBe(10460);
    expect(row.currentValue).toBe(32400);
  });

  it("reconciles Fidelity-style manual US stock rows across multiple uploads", () => {
    const firstCsv = `transaction_id,date,platform,asset_type,symbol_or_isin,name,type,quantity,price ($),USD-INR,fees,taxes,currency,category,notes
1,15-02-2025,Fidelity,us_stock,TST,Example US Stock,buy,10,10,80,0,,USD,Equity,RSU1
2,15-05-2025,Fidelity,us_stock,TST,Example US Stock,buy,5,12,81,0,,USD,Equity,RSU2`;
    const secondCsv = `transaction_id,date,platform,asset_type,symbol_or_isin,name,type,quantity,price ($),USD-INR,fees,taxes,currency,category,notes
3,28-05-2026,Fidelity,us_stock,TST,Example US Stock,sell,3,30,90,0,,USD,Equity,RSU1`;

    const first = commitManualCsvImport(createEmptyBackup("INR"), firstCsv, { importId: "fid_manual_1", fileName: "manual-fidelity-1.csv", now: "2026-06-24T00:00:00.000Z" });
    const second = commitManualCsvImport(first.backup, secondCsv, { importId: "fid_manual_2", fileName: "manual-fidelity-2.csv", now: "2026-06-24T00:00:00.000Z" });
    const holding = second.backup.manualBalances[0];
    const row = calculateHoldingReturns(second.backup).get(holding.id)!;

    expect(second.errors).toEqual([]);
    expect(second.backup.transactions).toHaveLength(3);
    expect(second.backup.manualBalances).toHaveLength(1);
    expect(holding.quantity).toBe(12);
    expect(holding.price).toBe(30);
    expect(holding.value).toBe(360);
    expect(row.invested).toBe(10460);
    expect(row.currentValue).toBe(32400);
  });

  it("parses Fidelity-style dashed numeric dates as DD-MM-YYYY", () => {
    const csv = `transaction_id,date,platform,asset_type,symbol_or_isin,name,type,quantity,price ($),USD-INR,fees,taxes,currency,category,notes
1,01-06-2026,Fidelity,us_stock,TST,Example US Stock,sell,50,409,95.2,0,,USD,Equity,RSU2`;

    const result = commitManualCsvImport(createEmptyBackup("INR"), csv, { importId: "fid_date", fileName: "manual-fidelity.csv", now: "2026-06-24T00:00:00.000Z" });

    expect(result.errors).toEqual([]);
    expect(result.backup.transactions[0].date).toBe("2026-06-01");
  });

  it("rejects impossible dates in Fidelity-style manual rows", () => {
    const csv = `transaction_id,date,platform,asset_type,symbol_or_isin,name,type,quantity,price ($),USD-INR,fees,taxes,currency,category,notes
1,30-02-2026,Fidelity,us_stock,TST,Example US Stock,buy,1,10,80,0,,USD,Equity,bad date`;

    const result = commitManualCsvImport(createEmptyBackup("INR"), csv, { importId: "fid_bad", fileName: "manual-fidelity.csv" });

    expect(result.errors).toEqual([{ row: 2, message: "Invalid date: 30-02-2026" }]);
    expect(result.backup.transactions).toEqual([]);
  });

  it("previews manual CSV impact before committing without mutating the backup", () => {
    const backup = createEmptyBackup("INR");
    const first = commitManualCsvImport(backup, balanceCsv, { importId: "existing", fileName: "manual.csv", now: "2026-06-22T00:00:00.000Z" }).backup;
    const csv = [
      "balance_id,as_of_date,institution,asset_type,name,current_value,currency,category",
      "cash-main,2026-06-23,Manual,cash,Cash,250,INR,Cash",
      "new-cash,2026-06-23,Manual,cash,New Cash,50,INR,Cash"
    ].join("\n");

    const preview = previewManualCsvImport(first, csv, { importId: "preview", fileName: "manual.csv", label: "Manual preview", now: "2026-06-23T00:00:00.000Z" });

    expect(first.manualBalances).toHaveLength(1);
    expect(first.manualBalances[0].value).toBe(100);
    expect(preview.errors).toEqual([]);
    expect(preview.incoming).toMatchObject({ balances: 2, transactions: 0, prices: 0 });
    expect(preview.effective).toMatchObject({ addedBalances: 1, updatedBalances: 1, addedTransactions: 0, addedPrices: 0, skippedDuplicates: 1 });
    expect(preview.before).toMatchObject({ holdings: 1, transactions: 0, netWorth: 100 });
    expect(preview.after).toMatchObject({ holdings: 2, transactions: 0, netWorth: 300 });
    expect(preview.deltas).toMatchObject({ holdings: 1, transactions: 0, netWorth: 200 });
    expect(preview.rows.some((row) => row.label === "Cash" && row.action === "update")).toBe(true);
    expect(preview.rows.some((row) => row.label === "New Cash" && row.action === "add")).toBe(true);
  });

});
