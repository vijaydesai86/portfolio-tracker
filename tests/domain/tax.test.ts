import { describe, expect, it } from "vitest";
import { createEmptyBackup, type PortfolioBackup } from "@/src/schema/backup";
import { calculatePortfolioTaxReport, getTaxProfile, updateTaxProfile } from "@/src/domain/tax";

const now = "2026-06-27T00:00:00.000Z";

function addFx(backup: PortfolioBackup, date: string, rate: number) {
  backup.priceSnapshots.push({ id: `fx_${date}_${rate}`, instrumentId: "USDINR", price: rate, currency: "INR", asOfDate: date, source: "test", createdAt: now });
}

describe("Indian resident portfolio tax report", () => {
  it("defaults to resident Indian individual with configurable new-regime profile", () => {
    const backup = createEmptyBackup("INR");
    expect(getTaxProfile(backup)).toMatchObject({
      residency: "resident_individual",
      regime: "new",
      slabRate: 30,
      surchargeRate: 10,
      cessRate: 4,
      mode: "estimate"
    });

    const updated = updateTaxProfile(backup, { regime: "old", slabRate: 20, surchargeRate: 0 });
    expect(getTaxProfile(updated)).toMatchObject({ regime: "old", slabRate: 20, surchargeRate: 0, cessRate: 4 });
  });

  it("uses FIFO lots and transaction-date FX for US stock realized and unrealized gains", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({ id: "acct_us", name: "Fidelity", institution: "Fidelity", type: "us_stock", currency: "USD", createdAt: now, updatedAt: now });
    backup.instruments.push({ id: "inst_arm", name: "Arm Holdings PLC ADR", type: "us_stock", symbol: "ARM", currency: "USD", country: "US", category: "Equity", issuer: "ARM", createdAt: now, updatedAt: now });
    addFx(backup, "2024-01-10", 82);
    addFx(backup, "2025-01-10", 84);
    addFx(backup, "2026-01-10", 86);
    addFx(backup, "2026-06-27", 90);
    backup.transactions.push(
      { id: "buy1", accountId: "acct_us", instrumentId: "inst_arm", date: "2024-01-10", type: "buy", quantity: 10, price: 100, amount: 1000, currency: "USD", fees: 0, taxes: 0, source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now },
      { id: "buy2", accountId: "acct_us", instrumentId: "inst_arm", date: "2025-01-10", type: "buy", quantity: 5, price: 120, amount: 600, currency: "USD", fees: 0, taxes: 0, source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now },
      { id: "sell1", accountId: "acct_us", instrumentId: "inst_arm", date: "2026-01-10", type: "sell", quantity: 8, price: 150, amount: 1200, currency: "USD", fees: 0, taxes: 0, source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now },
      { id: "div1", accountId: "acct_us", instrumentId: "inst_arm", date: "2026-02-01", type: "dividend", amount: 10, currency: "USD", fees: 0, taxes: 2.5, source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now }
    );
    backup.manualBalances.push({ id: "bal_arm", accountId: "acct_us", instrumentId: "inst_arm", label: "Arm Holdings PLC ADR", category: "Equity", currency: "USD", value: 1120, quantity: 7, price: 160, asOfDate: "2026-06-27", source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now });

    const report = calculatePortfolioTaxReport(backup, { financialYear: "2025-26" });

    expect(report.realized.totalGain).toBe(37600);
    expect(report.realized.rows[0]).toMatchObject({ assetName: "Arm Holdings PLC ADR", quantity: 8, gain: 37600, bucket: "foreign_equity_ltcg" });
    expect(report.realized.byAssetBucket[0]).toMatchObject({ assetName: "Arm Holdings PLC ADR", bucket: "foreign_equity_ltcg", positiveGain: 37600, grossTaxBeforeSetoff: 4700, allocatedTaxAfterSetoff: 4700 });
    expect(report.unrealized.totalGain).toBe(34000);
    expect(report.income.foreignDividend).toBe(860);
    expect(report.income.foreignTaxPaid).toBe(215);
  });

  it("classifies Indian equity gains by holding period and applies FY tax settings", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({ id: "acct_in", name: "Broker", institution: "Broker", type: "indian_stock", currency: "INR", createdAt: now, updatedAt: now });
    backup.instruments.push({ id: "inst_eq", name: "Listed Equity", type: "indian_stock", symbol: "EQ", currency: "INR", country: "IN", category: "Equity", issuer: "EQ", createdAt: now, updatedAt: now });
    backup.transactions.push(
      { id: "buy_l", accountId: "acct_in", instrumentId: "inst_eq", date: "2024-01-01", type: "buy", quantity: 100, price: 100, amount: 10000, currency: "INR", fees: 0, taxes: 0, source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now },
      { id: "sell_l", accountId: "acct_in", instrumentId: "inst_eq", date: "2026-01-02", type: "sell", quantity: 100, price: 200, amount: 20000, currency: "INR", fees: 0, taxes: 0, source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now },
      { id: "buy_s", accountId: "acct_in", instrumentId: "inst_eq", date: "2025-10-01", type: "buy", quantity: 10, price: 100, amount: 1000, currency: "INR", fees: 0, taxes: 0, source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now },
      { id: "sell_s", accountId: "acct_in", instrumentId: "inst_eq", date: "2026-02-01", type: "sell", quantity: 10, price: 150, amount: 1500, currency: "INR", fees: 0, taxes: 0, source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now }
    );

    const report = calculatePortfolioTaxReport(updateTaxProfile(backup, { surchargeRate: 10, cessRate: 4 }), { financialYear: "2025-26" });

    expect(report.realized.byBucket.indian_equity_ltcg.gain).toBe(10000);
    expect(report.realized.byBucket.indian_equity_ltcg.positiveGain).toBe(10000);
    expect(report.realized.byBucket.indian_equity_stcg.gain).toBe(500);
    expect(report.estimatedTax.totalBeforeCess).toBe(110);
    expect(report.estimatedTax.cess).toBe(4.4);
    expect(report.estimatedTax.totalTax).toBe(114.4);
  });

  it("shows per-holding realized tax contribution after bucket set-off", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({ id: "acct", name: "US Broker", institution: "Fidelity", type: "us_stock", currency: "INR", createdAt: now, updatedAt: now });
    backup.instruments.push(
      { id: "gain", name: "Gain Stock", type: "us_stock", symbol: "GAIN", currency: "INR", country: "US", category: "Equity", issuer: "Gain", createdAt: now, updatedAt: now },
      { id: "loss", name: "Loss Stock", type: "us_stock", symbol: "LOSS", currency: "INR", country: "US", category: "Equity", issuer: "Loss", createdAt: now, updatedAt: now }
    );
    backup.transactions.push(
      { id: "buy_gain", accountId: "acct", instrumentId: "gain", date: "2026-01-01", type: "buy", quantity: 1, amount: 100, currency: "INR", fees: 0, taxes: 0, source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now },
      { id: "sell_gain", accountId: "acct", instrumentId: "gain", date: "2026-06-01", type: "sell", quantity: 1, amount: 200, currency: "INR", fees: 0, taxes: 0, source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now },
      { id: "buy_loss", accountId: "acct", instrumentId: "loss", date: "2026-01-01", type: "buy", quantity: 1, amount: 100, currency: "INR", fees: 0, taxes: 0, source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now },
      { id: "sell_loss", accountId: "acct", instrumentId: "loss", date: "2026-06-01", type: "sell", quantity: 1, amount: 40, currency: "INR", fees: 0, taxes: 0, source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now }
    );

    const report = calculatePortfolioTaxReport(backup, { financialYear: "2026-27" });
    const gainRow = report.realized.byAssetBucket.find((row) => row.assetName === "Gain Stock")!;
    const lossRow = report.realized.byAssetBucket.find((row) => row.assetName === "Loss Stock")!;

    expect(report.realized.byBucket.foreign_equity_stcg).toMatchObject({ gain: 40, positiveGain: 100, lossSetoff: 60, taxableGain: 40, tax: 12 });
    expect(gainRow).toMatchObject({ gain: 100, positiveGain: 100, grossTaxBeforeSetoff: 30, allocatedTaxAfterSetoff: 12 });
    expect(lossRow).toMatchObject({ gain: -60, positiveGain: 0, grossTaxBeforeSetoff: 0, allocatedTaxAfterSetoff: 0 });
  });

  it("ignores zero-amount broker migration rows for taxable realization and preserves open cost basis", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({ id: "acct", name: "US Broker", institution: "INDMoney", type: "us_stock", currency: "INR", createdAt: now, updatedAt: now });
    backup.instruments.push({ id: "inst", name: "Migrated Stock", type: "us_stock", symbol: "MIG", currency: "INR", country: "US", category: "Equity", issuer: "Company", createdAt: now, updatedAt: now });
    backup.transactions.push(
      { id: "buy1", accountId: "acct", instrumentId: "inst", date: "2025-01-01", type: "buy", quantity: 10, amount: 1000, currency: "INR", fees: 0, taxes: 0, source: { type: "import", provider: "indmoney_export" }, userModified: false, createdAt: now, updatedAt: now },
      { id: "migration_out", accountId: "acct", instrumentId: "inst", date: "2026-05-05", type: "sell", quantity: 10, amount: 0, currency: "INR", fees: 0, taxes: 0, source: { type: "import", provider: "indmoney_export" }, userModified: false, createdAt: now, updatedAt: now },
      { id: "migration_in", accountId: "acct", instrumentId: "inst", date: "2026-05-06", type: "buy", quantity: 10, amount: 0, currency: "INR", fees: 0, taxes: 0, source: { type: "import", provider: "indmoney_export" }, userModified: false, createdAt: now, updatedAt: now }
    );
    backup.manualBalances.push({ id: "bal", accountId: "acct", instrumentId: "inst", label: "Migrated Stock", category: "Equity", currency: "INR", value: 1500, quantity: 10, price: 150, asOfDate: "2026-06-23", source: { type: "import", provider: "indmoney_export" }, userModified: false, createdAt: now, updatedAt: now });

    const report = calculatePortfolioTaxReport(backup, { financialYear: "2026-27" });

    expect(report.realized.rows).toEqual([]);
    expect(report.realized.totalGain).toBe(0);
    expect(report.unrealized.totalCost).toBe(1000);
    expect(report.unrealized.totalGain).toBe(500);
  });

  it("groups unrealized tax lots by asset and STCG/LTCG bucket while retaining detailed lots", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({ id: "acct", name: "Fidelity", institution: "Fidelity", type: "us_stock", currency: "INR", createdAt: now, updatedAt: now });
    backup.instruments.push({ id: "inst", name: "Arm Holdings PLC ADR", type: "us_stock", symbol: "ARM", currency: "INR", country: "US", category: "Equity", issuer: "ARM", createdAt: now, updatedAt: now });
    backup.transactions.push(
      { id: "buy_l", accountId: "acct", instrumentId: "inst", date: "2023-01-01", type: "buy", quantity: 2, amount: 200, currency: "INR", fees: 0, taxes: 0, source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now },
      { id: "buy_s", accountId: "acct", instrumentId: "inst", date: "2026-01-01", type: "buy", quantity: 3, amount: 450, currency: "INR", fees: 0, taxes: 0, source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now }
    );
    backup.manualBalances.push({ id: "bal", accountId: "acct", instrumentId: "inst", label: "Arm Holdings PLC ADR", category: "Equity", currency: "INR", value: 1000, quantity: 5, price: 200, asOfDate: "2026-06-23", source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now });

    const report = calculatePortfolioTaxReport(backup, { financialYear: "2026-27" });

    expect(report.unrealized.rows).toHaveLength(2);
    expect(report.unrealized.byAssetBucket).toEqual([
      expect.objectContaining({ assetName: "Arm Holdings PLC ADR", bucket: "foreign_equity_ltcg", quantity: 2, currentValue: 400, cost: 200, gain: 200 }),
      expect.objectContaining({ assetName: "Arm Holdings PLC ADR", bucket: "foreign_equity_stcg", quantity: 3, currentValue: 600, cost: 450, gain: 150 })
    ]);
  });

  it("uses grouped net unrealized gain for rough tax so mixed-lot loss rows do not show tax", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({ id: "acct", name: "Broker", institution: "Broker", type: "indian_stock", currency: "INR", createdAt: now, updatedAt: now });
    backup.instruments.push({ id: "inst", name: "Mixed Lot Stock", type: "indian_stock", symbol: "MIX", currency: "INR", country: "IN", category: "Equity", issuer: "Mix", createdAt: now, updatedAt: now });
    backup.transactions.push(
      { id: "buy_gain", accountId: "acct", instrumentId: "inst", date: "2026-01-01", type: "buy", quantity: 1, amount: 90, currency: "INR", fees: 0, taxes: 0, source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now },
      { id: "buy_loss", accountId: "acct", instrumentId: "inst", date: "2026-02-01", type: "buy", quantity: 1, amount: 130, currency: "INR", fees: 0, taxes: 0, source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now }
    );
    backup.manualBalances.push({ id: "bal", accountId: "acct", instrumentId: "inst", label: "Mixed Lot Stock", category: "Equity", currency: "INR", value: 200, quantity: 2, price: 100, asOfDate: "2026-06-23", source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now });

    const report = calculatePortfolioTaxReport(backup, { financialYear: "2026-27" });
    const grouped = report.unrealized.byAssetBucket[0];

    expect(grouped).toMatchObject({ assetName: "Mixed Lot Stock", bucket: "indian_equity_stcg", gain: -20, potentialTaxBeforeSetoff: 0 });
  });

  it("only reports loss harvesting candidates that are reachable under FIFO", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({ id: "acct", name: "Broker", institution: "Broker", type: "mutual_fund", currency: "INR", createdAt: now, updatedAt: now });
    backup.instruments.push({ id: "blocked", name: "Blocked Harvest Fund", type: "mutual_fund", currency: "INR", country: "IN", category: "Equity", issuer: "AMC", createdAt: now, updatedAt: now });
    backup.transactions.push(
      { id: "old_gain", accountId: "acct", instrumentId: "blocked", date: "2023-01-01", type: "buy", quantity: 10, amount: 500, currency: "INR", fees: 0, taxes: 0, source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now },
      { id: "new_loss", accountId: "acct", instrumentId: "blocked", date: "2026-01-01", type: "buy", quantity: 10, amount: 1500, currency: "INR", fees: 0, taxes: 0, source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now }
    );
    backup.manualBalances.push({ id: "bal", accountId: "acct", instrumentId: "blocked", label: "Blocked Harvest Fund", category: "Equity", currency: "INR", value: 2000, quantity: 20, price: 100, asOfDate: "2026-06-23", source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now });

    const report = calculatePortfolioTaxReport(backup, { financialYear: "2026-27" });

    expect(report.unrealized.byAssetBucket.some((row) => row.gain < 0)).toBe(true);
    expect(report.unrealized.harvestCandidates).toEqual([]);
  });

  it("reports FIFO loss harvesting only when the sellable FIFO prefix is a net loss", () => {
    const backup = createEmptyBackup("INR");
    backup.accounts.push({ id: "acct", name: "Broker", institution: "Broker", type: "mutual_fund", currency: "INR", createdAt: now, updatedAt: now });
    backup.instruments.push({ id: "open", name: "Open Harvest Fund", type: "mutual_fund", currency: "INR", country: "IN", category: "Equity", issuer: "AMC", createdAt: now, updatedAt: now });
    backup.transactions.push(
      { id: "old_loss", accountId: "acct", instrumentId: "open", date: "2026-01-01", type: "buy", quantity: 10, amount: 1200, currency: "INR", fees: 0, taxes: 0, source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now },
      { id: "new_gain", accountId: "acct", instrumentId: "open", date: "2026-02-01", type: "buy", quantity: 10, amount: 800, currency: "INR", fees: 0, taxes: 0, source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now }
    );
    backup.manualBalances.push({ id: "bal", accountId: "acct", instrumentId: "open", label: "Open Harvest Fund", category: "Equity", currency: "INR", value: 2000, quantity: 20, price: 100, asOfDate: "2026-06-23", source: { type: "manual" }, userModified: false, createdAt: now, updatedAt: now });

    const report = calculatePortfolioTaxReport(backup, { financialYear: "2026-27" });

    expect(report.unrealized.harvestCandidates).toEqual([
      expect.objectContaining({ assetName: "Open Harvest Fund", quantity: 10, loss: -200, cost: 1200, currentValue: 1000, lots: 1 })
    ]);
  });
});
