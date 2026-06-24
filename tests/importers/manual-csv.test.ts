import { describe, expect, it } from "vitest";
import { parseManualCsv } from "@/src/importers/manualCsv";

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
});
