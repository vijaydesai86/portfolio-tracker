import { describe, expect, it } from "vitest";
import { createEmptyBackup } from "@/src/schema/backup";
import { calculateNetWorth, calculateAllocation, calculatePortfolioSummary, calculatePortfolioInsights, findFxRate } from "@/src/domain/analytics";

describe("portfolio analytics", () => {
  it("calculates net worth by base currency using FX snapshots", () => {
    const backup = createEmptyBackup("INR");
    backup.priceSnapshots.push({
      id: "fx_usd_inr",
      instrumentId: "USDINR",
      price: 83,
      currency: "INR",
      asOfDate: "2026-06-22",
      source: "manual",
      createdAt: "2026-06-22T00:00:00.000Z"
    });
    backup.manualBalances.push({
      id: "cash_inr",
      accountId: "acct_cash_inr",
      label: "INR Cash",
      category: "Cash",
      currency: "INR",
      value: 1000,
      asOfDate: "2026-06-22",
      source: { type: "manual" },
      userModified: false,
      createdAt: "2026-06-22T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z"
    });
    backup.manualBalances.push({
      id: "espp_usd",
      accountId: "acct_espp",
      label: "ESPP Contribution",
      category: "Equity",
      currency: "USD",
      value: 10,
      asOfDate: "2026-06-22",
      source: { type: "manual" },
      userModified: false,
      createdAt: "2026-06-22T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z"
    });

    expect(calculateNetWorth(backup)).toBe(1830);
  });

  it("calculates allocation by category", () => {
    const backup = createEmptyBackup("INR");
    backup.manualBalances.push(
      {
        id: "eq",
        accountId: "a1",
        label: "Equity",
        category: "Equity",
        currency: "INR",
        value: 60,
        asOfDate: "2026-06-22",
        source: { type: "manual" },
        userModified: false,
        createdAt: "2026-06-22T00:00:00.000Z",
        updatedAt: "2026-06-22T00:00:00.000Z"
      },
      {
        id: "debt",
        accountId: "a2",
        label: "Debt",
        category: "Debt",
        currency: "INR",
        value: 40,
        asOfDate: "2026-06-22",
        source: { type: "manual" },
        userModified: false,
        createdAt: "2026-06-22T00:00:00.000Z",
        updatedAt: "2026-06-22T00:00:00.000Z"
      }
    );

    expect(calculateAllocation(backup)).toMatchObject({
      Equity: { value: 60, percent: 60 },
      Debt: { value: 40, percent: 40 }
    });
  });

  it("keeps convertible balances visible and reports missing FX pairs", () => {
    const backup = createEmptyBackup("INR");
    backup.manualBalances.push(
      {
        id: "cash_inr",
        accountId: "acct_cash_inr",
        label: "INR Cash",
        category: "Cash",
        currency: "INR",
        value: 10000,
        asOfDate: "2026-06-22",
        source: { type: "manual" },
        userModified: false,
        createdAt: "2026-06-22T00:00:00.000Z",
        updatedAt: "2026-06-22T00:00:00.000Z"
      },
      {
        id: "espp_usd",
        accountId: "acct_espp",
        label: "ESPP Contribution",
        category: "Equity",
        currency: "USD",
        value: 2000,
        asOfDate: "2026-06-22",
        source: { type: "manual" },
        userModified: false,
        createdAt: "2026-06-22T00:00:00.000Z",
        updatedAt: "2026-06-22T00:00:00.000Z"
      }
    );

    const summary = calculatePortfolioSummary(backup);

    expect(summary.netWorth).toBe(10000);
    expect(summary.allocation.Cash).toMatchObject({ value: 10000, percent: 100 });
    expect(summary.missingFx).toEqual(["USD/INR"]);
  });


  it("does not treat capitalized PF interest as returned cash", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({
      id: "acct_epf",
      name: "EPFO Provident Fund",
      institution: "EPFO",
      type: "epf",
      currency: "INR",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    backup.instruments.push({
      id: "inst_epf_employee",
      name: "EPF Employee Share",
      type: "epf",
      currency: "INR",
      country: "IN",
      category: "Debt",
      issuer: "EPFO",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    backup.transactions.push(
      {
        id: "txn_epf_contribution",
        accountId: "acct_epf",
        instrumentId: "inst_epf_employee",
        date: "2026-03-31",
        type: "contribution",
        amount: 1000,
        currency: "INR",
        fees: 0,
        taxes: 0,
        source: { type: "import", provider: "epfo_passbook" },
        userModified: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      {
        id: "txn_epf_interest",
        accountId: "acct_epf",
        instrumentId: "inst_epf_employee",
        date: "2026-03-31",
        type: "interest_accrual",
        amount: 50,
        currency: "INR",
        fees: 0,
        taxes: 0,
        source: { type: "import", provider: "epfo_passbook" },
        userModified: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    );
    backup.manualBalances.push({
      id: "bal_epf_employee",
      accountId: "acct_epf",
      instrumentId: "inst_epf_employee",
      label: "EPF Employee Share",
      category: "Debt",
      currency: "INR",
      value: 1050,
      asOfDate: "2026-03-31",
      source: { type: "import", provider: "epfo_passbook" },
      userModified: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    const insights = calculatePortfolioInsights(backup);

    expect(insights.transactionStats.investedBase).toBe(1000);
    expect(insights.transactionStats.incomeBase).toBe(0);
    expect(insights.holdings[0]).toMatchObject({ assetKind: "PF", valueInBase: 1050 });
  });

  it("includes transaction fee and tax fields in portfolio XIRR cash flows", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({ id: "acct", name: "Broker", institution: "Broker", type: "indian_stock", currency: "INR", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.instruments.push({ id: "inst", name: "Stock", type: "indian_stock", currency: "INR", country: "IN", category: "Equity", issuer: "Company", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.transactions.push({ id: "buy", accountId: "acct", instrumentId: "inst", date: "2026-01-01", type: "buy", quantity: 10, amount: 1000, currency: "INR", fees: 10, taxes: 0, source: { type: "import" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.manualBalances.push({ id: "bal", accountId: "acct", instrumentId: "inst", label: "Stock", category: "Equity", currency: "INR", value: 1110, asOfDate: "2027-01-01", source: { type: "import" }, userModified: false, createdAt: "2027-01-01T00:00:00.000Z", updatedAt: "2027-01-01T00:00:00.000Z" });

    const insights = calculatePortfolioInsights(backup);

    expect(insights.xirrBase).toBeCloseTo(9.88, 1);
  });

  it("does not double count broker funding and security trades as portfolio cash in", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push(
      { id: "acct_cash", name: "Broker Cash", institution: "INDMoney", type: "cash", currency: "USD", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "acct_stock", name: "Broker Stocks", institution: "INDMoney", type: "us_stock", currency: "USD", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
    );
    backup.instruments.push(
      { id: "inst_cash", name: "USD Cash", type: "cash", symbol: "USD", currency: "USD", country: "US", category: "Cash", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "inst_stock", name: "AAPL", type: "us_stock", symbol: "AAPL", currency: "USD", country: "US", category: "Equity", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
    );
    backup.transactions.push(
      { id: "deposit", accountId: "acct_cash", instrumentId: "inst_cash", date: "2025-01-01", type: "deposit", amount: 1000, currency: "USD", fees: 0, taxes: 0, source: { type: "import", provider: "indmoney_export" }, userModified: false, createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z" },
      { id: "buy", accountId: "acct_stock", instrumentId: "inst_stock", date: "2025-01-02", type: "buy", quantity: 10, amount: 1000, currency: "USD", fees: 0, taxes: 0, source: { type: "import", provider: "indmoney_export" }, userModified: false, createdAt: "2025-01-02T00:00:00.000Z", updatedAt: "2025-01-02T00:00:00.000Z" }
    );
    backup.manualBalances.push({ id: "bal", accountId: "acct_stock", instrumentId: "inst_stock", label: "AAPL", category: "Equity", currency: "USD", value: 1200, quantity: 10, price: 120, asOfDate: "2026-01-01", source: { type: "import", provider: "indmoney_export" }, userModified: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.priceSnapshots.push(
      { id: "fx_2025", instrumentId: "USDINR", price: 80, currency: "INR", asOfDate: "2025-01-01", source: "test", createdAt: "2025-01-01T00:00:00.000Z" },
      { id: "fx_2026", instrumentId: "USDINR", price: 85, currency: "INR", asOfDate: "2026-01-01", source: "test", createdAt: "2026-01-01T00:00:00.000Z" }
    );

    const insights = calculatePortfolioInsights(backup);

    expect(insights.transactionStats.externalCashInBase).toBe(80000);
    expect(insights.transactionStats.tradeBuyBase).toBe(80000);
    expect(insights.transactionStats.investedBase).toBe(80000);
    expect(insights.xirrBase).toBeCloseTo(27.52, 1);
  });

  it("uses account institution, not stock issuer, for current stock issuer/platform charts", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push(
      { id: "acct_ind", name: "INDMoney US", institution: "INDMoney", type: "us_stock", currency: "USD", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "acct_fid", name: "Fidelity US", institution: "Fidelity", type: "us_stock", currency: "USD", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
    );
    backup.instruments.push({ id: "inst_arm", name: "Arm Holdings PLC ADR", type: "us_stock", symbol: "ARM", currency: "USD", country: "US", category: "Equity", issuer: "ARM", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    backup.manualBalances.push(
      { id: "bal_ind", accountId: "acct_ind", instrumentId: "inst_arm", label: "ARM", category: "Equity", currency: "USD", value: 200, quantity: 10, price: 20, asOfDate: "2026-06-22", source: { type: "import", provider: "indmoney_export" }, userModified: false, createdAt: "2026-06-22T00:00:00.000Z", updatedAt: "2026-06-22T00:00:00.000Z" },
      { id: "bal_fid", accountId: "acct_fid", instrumentId: "inst_arm", label: "ARM", category: "Equity", currency: "USD", value: 100, quantity: 5, price: 20, asOfDate: "2026-06-22", source: { type: "import", provider: "manual_positions" }, userModified: false, createdAt: "2026-06-22T00:00:00.000Z", updatedAt: "2026-06-22T00:00:00.000Z" }
    );
    backup.priceSnapshots.push({ id: "fx", instrumentId: "USDINR", price: 80, currency: "INR", asOfDate: "2026-06-22", source: "test", createdAt: "2026-06-22T00:00:00.000Z" });

    const insights = calculatePortfolioInsights(backup);

    expect(insights.totalsByIssuer).toEqual([
      { name: "INDMoney", value: 16000 },
      { name: "Fidelity", value: 8000 }
    ]);
  });

});

describe("INR-first multi-currency analytics", () => {
  it("uses transaction-date USD/INR for invested flows and latest USD/INR for current value", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({
      id: "acct_us",
      name: "US Stocks",
      institution: "INDMoney",
      type: "us_stock",
      currency: "USD",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    backup.instruments.push({
      id: "inst_aapl",
      name: "AAPL",
      type: "us_stock",
      symbol: "AAPL",
      currency: "USD",
      country: "US",
      category: "Equity",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    backup.transactions.push({
      id: "txn_buy",
      accountId: "acct_us",
      instrumentId: "inst_aapl",
      date: "2025-01-01",
      type: "buy",
      quantity: 1,
      price: 100,
      amount: 100,
      currency: "USD",
      fees: 0,
      taxes: 0,
      source: { type: "import", provider: "indmoney_export" },
      userModified: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    backup.manualBalances.push({
      id: "bal_aapl",
      accountId: "acct_us",
      instrumentId: "inst_aapl",
      label: "AAPL",
      category: "Equity",
      currency: "USD",
      value: 120,
      quantity: 1,
      price: 120,
      asOfDate: "2026-01-01",
      source: { type: "import", provider: "indmoney_export" },
      userModified: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    backup.priceSnapshots.push(
      { id: "fx_2025", instrumentId: "USDINR", price: 80, currency: "INR", asOfDate: "2025-01-01", source: "test", createdAt: "2025-01-01T00:00:00.000Z" },
      { id: "fx_2026", instrumentId: "USDINR", price: 85, currency: "INR", asOfDate: "2026-01-01", source: "test", createdAt: "2026-01-01T00:00:00.000Z" }
    );

    const summary = calculatePortfolioSummary(backup);
    const insights = calculatePortfolioInsights(backup);

    expect(summary.netWorth).toBe(10200);
    expect(insights.transactionStats.investedBase).toBe(8000);
    expect(insights.xirrBase).toBeCloseTo(27.52, 1);
    expect(insights.holdings[0]).toMatchObject({ assetKind: "Direct Stock", region: "US", valueInBase: 10200 });
    expect(findFxRate("USD", "INR", backup, "2025-06-01")?.price).toBe(80);
  });
});

it("marks base INR XIRR incomplete when USD FX is missing", () => {
  const backup = createEmptyBackup("INR");
  backup.accounts.push({
    id: "acct_us_missing_fx",
    name: "US Stocks",
    institution: "INDMoney",
    type: "us_stock",
    currency: "USD",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  });
  backup.instruments.push({
    id: "inst_msft_missing_fx",
    name: "MSFT",
    type: "us_stock",
    symbol: "MSFT",
    currency: "USD",
    country: "US",
    category: "Equity",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  });
  backup.transactions.push({
    id: "txn_us_missing_fx",
    accountId: "acct_us_missing_fx",
    instrumentId: "inst_msft_missing_fx",
    date: "2025-01-01",
    type: "buy",
    quantity: 1,
    price: 100,
    amount: 100,
    currency: "USD",
    fees: 0,
    taxes: 0,
    source: { type: "import", provider: "indmoney_export" },
    userModified: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  });
  backup.manualBalances.push({
    id: "bal_us_missing_fx",
    accountId: "acct_us_missing_fx",
    instrumentId: "inst_msft_missing_fx",
    label: "MSFT",
    category: "Equity",
    currency: "USD",
    value: 120,
    quantity: 1,
    price: 120,
    asOfDate: "2026-01-01",
    source: { type: "import", provider: "indmoney_export" },
    userModified: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  });

  const insights = calculatePortfolioInsights(backup);

  expect(insights.xirrBase).toBeNull();
  expect(insights.transactionStats.missingFx.some((item) => item.includes("USD/INR"))).toBe(true);
});
