import { describe, expect, it } from "vitest";
import { parseManualCsv } from "@/src/importers/manualCsv";
import { createEmptyBackup } from "@/src/schema/backup";
import { commitManualCsvImport } from "@/src/importers/importPipeline";

describe("manual CSV importer", () => {
  it("normalizes balance CSV rows for fixed and manual asset classes", () => {
    const csv = `balance_id,as_of_date,institution,asset_type,name,current_value,currency,category,notes
cash-main,2026-06-22,Manual,cash,Cash Wallet,10000,INR,Cash,liquid
espp-main,2026-06-22,Employer,espp,ESPP Contribution,2000,USD,Equity,contribution only
ppf-main,2026-06-22,Post Office,ppf,Public Provident Fund,300000,INR,Debt,manual balance
ssy-main,2026-06-22,SBI,ssy,Sukanya Samriddhi Account,0,INR,Debt,template
fd-main,2026-06-22,HDFC Bank,fd,Fixed Deposit,0,INR,Debt,template
epf-main,2026-06-22,EPFO,epf,EPF Balance,0,INR,Debt,template
nps-main,2026-06-22,NPS,nps,NPS Manual Balance,0,INR,Others,template
gold-main,2026-06-22,Manual,gold,Gold Holding,0,INR,Gold,template
other-main,2026-06-22,Manual,other,Private Asset,0,INR,Others,template`;

    const result = parseManualCsv(csv, { importId: "import_manual" });

    expect(result.errors).toEqual([]);
    expect(result.accounts).toHaveLength(9);
    expect(result.manualBalances.map((b) => b.category)).toEqual([
      "Cash",
      "Equity",
      "Debt",
      "Debt",
      "Debt",
      "Debt",
      "Others",
      "Gold",
      "Others"
    ]);
    expect(result.transactions).toHaveLength(0);
  });

  it("parses transaction CSV rows and derives dynamic open holdings from net quantity", () => {
    const csv = `transaction_id,date,platform,asset_type,symbol_or_isin,name,type,quantity,price,amount,fees,taxes,currency,category,notes
us-buy-1,2026-01-15,Fidelity,us_stock,AAPL,Apple Inc,buy,10,100,,1,0,USD,Equity,real user transaction
us-sell-1,2026-02-15,Fidelity,us_stock,AAPL,Apple Inc,sell,4,120,,1,0,USD,Equity,real user transaction
in-buy-1,2026-03-01,Zerodha,indian_stock,RELIANCE,Reliance Industries,buy,5,2800,,20,0,INR,Equity,real user transaction
mf-buy-1,2026-04-01,MF Platform,mutual_fund,INF000000000,Example Mutual Fund,buy,100,50,,0,0,INR,Equity,real user transaction`;

    const result = parseManualCsv(csv, { importId: "manual_tx", now: "2026-06-23T00:00:00.000Z" });

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(4);
    expect(result.manualBalances).toHaveLength(3);
    expect(result.manualBalances.find((balance) => balance.label === "Apple Inc")).toMatchObject({ quantity: 6, price: 120, value: 720, currency: "USD", source: { provider: "manual_positions" } });
    expect(result.manualBalances.find((balance) => balance.label === "Reliance Industries")).toMatchObject({ quantity: 5, price: 2800, value: 14000, currency: "INR" });
    expect(result.priceSnapshots).toHaveLength(4);
  });

  it("keeps repeated template transaction ids when transaction facts differ", () => {
    const tsv = `transaction_id	date	platform	asset_type	symbol_or_isin	name	type	quantity	price	amount	fees	taxes	currency	category	notes
fidelity-us-buy-template	1/15/2025	Fidelity	us_stock	TST	Example US Stock	buy	10	10		0	0	USD	Equity	first synthetic lot
fidelity-us-buy-template	4/15/2025	Fidelity	us_stock	TST	Example US Stock	buy	20	11		0	0	USD	Equity	second synthetic lot
fidelity-us-buy-template	7/15/2025	Fidelity	us_stock	TST	Example US Stock	buy	5	12		0	0	USD	Equity	third synthetic lot
fidelity-us-buy-template	5/15/2026	Fidelity	us_stock	TST	Example US Stock	sell	7	15		0	0	USD	Equity	synthetic sale`;

    const result = parseManualCsv(tsv, { importId: "arm_manual", now: "2026-06-23T00:00:00.000Z" });

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(4);
    expect(result.transactions.map((tx) => tx.date)).toEqual(["2025-01-15", "2025-04-15", "2025-07-15", "2026-05-15"]);
    expect(new Set(result.transactions.map((tx) => tx.source.sourceRecordHash)).size).toBe(4);
    expect(result.manualBalances).toHaveLength(1);
    expect(result.manualBalances[0]).toMatchObject({ label: "Example US Stock", quantity: 28, price: 15, value: 420, currency: "USD" });
  });

  it("parses optional invested fields on balance CSV rows", () => {
    const csv = `balance_id,as_of_date,institution,asset_type,name,current_value,currency,category,invested_amount,invested_currency,invested_as_of_date,notes
ppf-main,22-06-2026,Post Office,ppf,Public Provident Fund,50000,INR,Debt,45000,INR,22-06-2026,manual balance`;

    const result = parseManualCsv(csv, { importId: "import_invested" });

    expect(result.errors).toEqual([]);
    expect(result.manualBalances[0]).toMatchObject({
      value: 50000,
      investedAmount: 45000,
      investedCurrency: "INR",
      investedAsOfDate: "2026-06-22",
      asOfDate: "2026-06-22"
    });
  });

  it("rejects invalid categories and keeps rows out of staged data", () => {
    const csv = `balance_id,as_of_date,institution,asset_type,name,current_value,currency,category
bad,2026-06-22,Manual,other,Bad Asset,100,INR,RealEstate`;
    const result = parseManualCsv(csv, { importId: "import_bad" });

    expect(result.manualBalances).toHaveLength(0);
    expect(result.errors[0].message).toMatch(/category/i);
  });

  it("uses stable source hashes for balance reuploads", () => {
    const firstCsv = `balance_id,as_of_date,institution,asset_type,name,current_value,currency,category
cash-main,2026-06-22,Manual,cash,Cash,100,INR,Cash`;
    const secondCsv = `balance_id,as_of_date,institution,asset_type,name,current_value,currency,category
cash-main,2026-06-23,Manual,cash,Cash,250,INR,Cash`;
    const first = parseManualCsv(firstCsv, { importId: "a" });
    const second = parseManualCsv(secondCsv, { importId: "b" });

    expect(first.manualBalances[0].source.sourceRecordHash).toBe(second.manualBalances[0].source.sourceRecordHash);
  });


  it("derives fixed-asset holdings from a mixed monthly transaction ledger", () => {
    const csv = `id,date,asset_type,platform,institution,name,symbol_or_isin,type,quantity,price,amount,fees,taxes,currency,fx_rate,category,notes,fmv
mf-1,2026-06-05,mutual_fund,MFU,PPFAS,Parag Parikh Flexi Cap Fund,INF879O01027,buy,10,100,,0,0,INR,,Equity,monthly SIP,
arm-1,2026-06-07,us_stock,Fidelity,Fidelity,Arm Holdings PLC - ADR,ARM,buy,2,120,,0,0,USD,84.5,Equity,manual US buy,125
ppf-1,2026-06-08,ppf,Manual,Post Office,Public Provident Fund,,invest,,,150000,0,0,INR,,Debt,annual PPF,
ppf-int,2026-06-30,ppf,Manual,Post Office,Public Provident Fund,,interest,,,1200,0,0,INR,,Debt,PPF interest,
ssy-1,2026-06-09,ssy,Manual,Bank,Sukanya Samriddhi Account,,invest,,,50000,0,0,INR,,Debt,SSY contribution,
cash-1,2026-06-10,cash,Manual,Manual,Cash Balance,,deposit,,,20000,0,0,INR,,Cash,monthly cash,`;

    const result = parseManualCsv(csv, { importId: "monthly", now: "2026-06-30T00:00:00.000Z" });

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(6);
    expect(result.priceSnapshots.some((snapshot) => snapshot.instrumentId === "USDINR" && snapshot.price === 84.5)).toBe(true);
    expect(result.transactions.some((tx) => tx.taxFmvPrice === 125)).toBe(true);
    expect(result.manualBalances.find((balance) => balance.label === "Parag Parikh Flexi Cap Fund")).toMatchObject({ quantity: 10, value: 1000, source: { provider: "manual_positions" } });
    expect(result.manualBalances.find((balance) => balance.label === "Arm Holdings PLC - ADR")).toMatchObject({ quantity: 2, value: 240, currency: "USD" });
    expect(result.manualBalances.find((balance) => balance.label === "Public Provident Fund")).toMatchObject({ value: 151200, investedAmount: 150000, category: "Debt", source: { provider: "manual_balance_ledger" } });
    expect(result.manualBalances.find((balance) => balance.label === "Sukanya Samriddhi Account")).toMatchObject({ value: 50000, investedAmount: 50000, category: "Debt" });
    expect(result.manualBalances.find((balance) => balance.label === "Cash Balance")).toMatchObject({ value: 20000, investedAmount: 20000, category: "Cash" });
  });


  it("preserves edited rows during manual CSV replacement and removes stale rows", () => {
    const firstCsv = `balance_id,as_of_date,institution,asset_type,name,current_value,currency,category,invested_amount,invested_currency,invested_as_of_date,notes
cash-main,2026-06-22,Manual,cash,Cash Wallet,10000,INR,Cash,10000,INR,2026-06-22,first
ppf-main,2026-06-22,Post Office,ppf,Public Provident Fund,300000,INR,Debt,250000,INR,2026-06-22,first`;
    const secondCsv = `balance_id,as_of_date,institution,asset_type,name,current_value,currency,category,invested_amount,invested_currency,invested_as_of_date,notes
cash-main,2026-07-22,Manual,cash,Cash Wallet,12000,INR,Cash,12000,INR,2026-07-22,second`;
    const first = commitManualCsvImport(createEmptyBackup("INR"), firstCsv, { importId: "import_old", now: "2026-06-22T00:00:00.000Z", label: "June manual" }).backup;
    const editedCash = first.manualBalances.find((balance) => balance.label === "Cash Wallet")!;
    const edited = { ...first, manualBalances: first.manualBalances.map((balance) => balance.id === editedCash.id ? { ...balance, notes: "user note", userModified: true } : balance) };

    const replaced = commitManualCsvImport(edited, secondCsv, { importId: "import_new", replaceImportId: "import_old", now: "2026-07-22T00:00:00.000Z", label: "July manual" }).backup;

    expect(replaced.manualBalances).toHaveLength(1);
    expect(replaced.manualBalances[0]).toMatchObject({ label: "Cash Wallet", notes: "user note", userModified: true, source: { importId: "import_new" } });
    expect(replaced.imports.some((run) => run.id === "import_old")).toBe(false);
    expect(replaced.imports.some((run) => run.id === "import_new")).toBe(true);
  });
  it("preserves user overlays while replacing matching manual stock imports with or without FMV", () => {
    const noFmvCsv = `transaction_id,date,platform,asset_type,symbol_or_isin,name,type,quantity,price ($),USD-INR,fees,taxes,currency,category,notes
1,15-02-2025,Fidelity,us_stock,TST,Example US Stock,buy,10,10,80,0,,USD,Equity,RSU1
2,28-05-2026,Fidelity,us_stock,TST,Example US Stock,sell,3,30,90,0,,USD,Equity,RSU1`;
    const withFmvCsv = `transaction_id,date,platform,asset_type,symbol_or_isin,name,type,quantity,price ($),USD-INR,fees,taxes,currency,category,notes,FMV
1,15-02-2025,Fidelity,us_stock,TST,Example US Stock,buy,10,10,80,0,,USD,Equity,RSU1,11
2,28-05-2026,Fidelity,us_stock,TST,Example US Stock,sell,3,30,90,0,,USD,Equity,RSU1,31`;

    const first = commitManualCsvImport(createEmptyBackup("INR"), noFmvCsv, { importId: "manual_old", fileName: "fidelity.csv", now: "2026-06-24T00:00:00.000Z" }).backup;
    const holding = first.manualBalances.find((balance) => balance.source.provider === "manual_positions")!;
    const edited = {
      ...first,
      manualBalances: first.manualBalances.map((balance) => balance.id === holding.id ? { ...balance, taperMode: "medium" as const, taperFactor: 0.05 } : balance),
      goalMappings: [{ id: "map_keep", goalId: "goal_keep", manualBalanceId: holding.id, percent: 100, createdAt: "2026-06-24T00:00:00.000Z", updatedAt: "2026-06-24T00:00:00.000Z" }]
    };

    const replaced = commitManualCsvImport(edited, withFmvCsv, { importId: "manual_new", replaceImportId: "manual_old", fileName: "fidelity.csv", now: "2026-06-25T00:00:00.000Z" }).backup;

    expect(replaced.transactions).toHaveLength(2);
    expect(replaced.transactions.map((tx) => tx.taxFmvPrice)).toEqual([11, 31]);
    expect(replaced.transactions.every((tx) => tx.source.importId === "manual_new")).toBe(true);
    expect(replaced.manualBalances).toHaveLength(1);
    expect(replaced.manualBalances[0]).toMatchObject({ id: holding.id, taperMode: "medium", taperFactor: 0.05, source: { importId: "manual_new", provider: "manual_positions" } });
    expect(replaced.goalMappings).toEqual([{ id: "map_keep", goalId: "goal_keep", manualBalanceId: holding.id, percent: 100, createdAt: "2026-06-24T00:00:00.000Z", updatedAt: "2026-06-24T00:00:00.000Z" }]);

    const manuallyEditedFmv = {
      ...replaced,
      transactions: replaced.transactions.map((tx) => tx.date === "2025-02-15" ? { ...tx, taxFmvPrice: 99, userModified: true } : tx)
    };
    const replacedAgain = commitManualCsvImport(manuallyEditedFmv, noFmvCsv, { importId: "manual_newer", replaceImportId: "manual_new", fileName: "fidelity.csv", now: "2026-06-26T00:00:00.000Z" }).backup;

    expect(replacedAgain.transactions).toHaveLength(2);
    expect(replacedAgain.transactions.find((tx) => tx.date === "2025-02-15")).toMatchObject({ taxFmvPrice: 99, userModified: true, source: { importId: "manual_newer" } });
    expect(replacedAgain.transactions.find((tx) => tx.date === "2026-05-28")?.taxFmvPrice).toBeUndefined();
    expect(replacedAgain.manualBalances[0]).toMatchObject({ id: holding.id, taperMode: "medium", taperFactor: 0.05, source: { importId: "manual_newer" } });
    expect(replacedAgain.goalMappings).toHaveLength(1);
  });

  it("keeps mappings and taper when a new monthly CSV adds rows for an existing asset", () => {
    const firstCsv = `id,date,asset_type,platform,institution,name,symbol_or_isin,type,quantity,price,amount,fees,taxes,currency,fx_rate,category,notes,fmv
arm-1,2026-06-07,us_stock,Fidelity,Fidelity,Arm Holdings PLC - ADR,ARM,buy,2,120,,0,0,USD,84.5,Equity,manual US buy,125`;
    const secondCsv = `id,date,asset_type,platform,institution,name,symbol_or_isin,type,quantity,price,amount,fees,taxes,currency,fx_rate,category,notes,fmv
arm-2,2026-07-07,us_stock,Fidelity,Fidelity,Arm Holdings PLC - ADR,ARM,buy,1,130,,0,0,USD,85,Equity,monthly add,135`;

    const first = commitManualCsvImport(createEmptyBackup("INR"), firstCsv, { importId: "month_1", fileName: "monthly-june.csv", now: "2026-06-24T00:00:00.000Z" }).backup;
    const holding = first.manualBalances.find((balance) => balance.source.provider === "manual_positions")!;
    const edited = {
      ...first,
      manualBalances: first.manualBalances.map((balance) => balance.id === holding.id ? { ...balance, taperMode: "medium" as const, taperFactor: 0.05 } : balance),
      goalMappings: [{ id: "map_keep", goalId: "goal_1", manualBalanceId: holding.id, percent: 100, createdAt: "2026-06-24T00:00:00.000Z", updatedAt: "2026-06-24T00:00:00.000Z" }]
    };

    const second = commitManualCsvImport(edited, secondCsv, { importId: "month_2", fileName: "monthly-july.csv", now: "2026-07-24T00:00:00.000Z" }).backup;

    expect(second.transactions).toHaveLength(2);
    expect(second.manualBalances).toHaveLength(1);
    expect(second.manualBalances[0]).toMatchObject({ id: holding.id, quantity: 3, price: 130, value: 390, taperMode: "medium", taperFactor: 0.05 });
    expect(second.goalMappings).toEqual([{ id: "map_keep", goalId: "goal_1", manualBalanceId: holding.id, percent: 100, createdAt: "2026-06-24T00:00:00.000Z", updatedAt: "2026-06-24T00:00:00.000Z" }]);
  });
});
