import { describe, expect, it } from "vitest";
import { detectImportSource } from "@/src/importers/detectImport";
import { providerImportSpecs } from "@/src/importers/providerRegistry";

describe("native import source detection", () => {
  it("keeps the provider registry explicit about implemented versus detected-only support", () => {
    expect(providerImportSpecs.map((spec) => [spec.id, spec.status])).toEqual([
      ["canonical_json", "implemented"],
      ["manual_csv", "implemented"],
      ["cas_pdf", "implemented"],
      ["fidelity_csv", "detected_only"],
      ["indmoney_export", "implemented"],
      ["zerodha_tradebook", "implemented"],
      ["groww_stock_orders", "implemented"],
      ["epfo_passbook", "implemented"],
      ["nps_statement", "parser_implemented"],
      ["bank_small_savings", "detected_only"]
    ]);
  });

  it("detects canonical JSON backup files", () => {
    expect(
      detectImportSource({
        fileName: "portfolio-tracker-backup-v1.json",
        textSample: JSON.stringify({ schemaVersion: 1, app: "portfolio-tracker" })
      })
    ).toMatchObject({ providerId: "canonical_json", status: "implemented", confidence: "high" });
  });

  it("detects the implemented manual CSV format", () => {
    expect(
      detectImportSource({
        fileName: "manual.csv",
        textSample: "account_name,asset_name,asset_type,category,currency,current_value,as_of_date,notes"
      })
    ).toMatchObject({ providerId: "manual_csv", status: "implemented", confidence: "high" });
  });

  it("detects Fidelity CSV position and history headers from native exports", () => {
    expect(
      detectImportSource({
        fileName: "Portfolio_Positions_Jan-20-2026.csv",
        textSample: "Account Number,Account Name,Symbol,Description,Quantity,Last Price,Last Price Change,Current Value"
      })
    ).toMatchObject({ providerId: "fidelity_csv", status: "detected_only", confidence: "high" });

    expect(
      detectImportSource({
        fileName: "Accounts_History.csv",
        textSample: "Run Date,Account,Account Number,Action,Symbol,Description,Type,Price ($),Quantity"
      })
    ).toMatchObject({ providerId: "fidelity_csv", status: "detected_only", confidence: "high" });

    expect(
      detectImportSource({
        fileName: "History_for_Account_Z12345678.csv",
        textSample: "Run Date,Action,Symbol,Description,Type,Price ($),Quantity,Commission ($)"
      })
    ).toMatchObject({ providerId: "fidelity_csv", status: "detected_only", confidence: "high" });
  });

  it("detects native statement families with current support statuses", () => {
    expect(detectImportSource({ fileName: "cams-cas.pdf", textSample: "Consolidated Account Statement" })).toMatchObject({
      providerId: "cas_pdf",
      status: "implemented"
    });
    expect(detectImportSource({ fileName: "epfo-passbook.html", textSample: "Member Passbook EPFO" })).toMatchObject({
      providerId: "epfo_passbook",
      status: "implemented"
    });
    expect(detectImportSource({ fileName: "nps-statement.pdf", textSample: "National Pension System PRAN" })).toMatchObject({
      providerId: "nps_statement",
      status: "parser_implemented"
    });
    expect(detectImportSource({ fileName: "indmoney-export.csv", textSample: "INDMoney" })).toMatchObject({
      providerId: "indmoney_export",
      status: "implemented"
    });
    expect(detectImportSource({ fileName: "ppf-statement.pdf", textSample: "Public Provident Fund" })).toMatchObject({
      providerId: "bank_small_savings",
      status: "detected_only"
    });
  });
  it("detects PF yearly PDF filenames as EPFO passbook imports", () => {
    expect(detectImportSource({ fileName: "pf-yearly.pdf" })).toMatchObject({ providerId: "epfo_passbook", nativeInputType: "pdf" });
  });

  it("detects NPS yearly CSV statements", () => {
    expect(detectImportSource({ fileName: "nps-yearly.csv", textSample: "NPS Transaction Statement for Tier I Account\nPRAN,'############" })).toMatchObject({ providerId: "nps_statement", nativeInputType: "csv" });
  });

  it("detects NPS CSV by content even when the filename is arbitrary", () => {
    expect(detectImportSource({ fileName: "download.csv", textSample: "NPS Transaction Statement for Tier I Account\nPRAN,'############" })).toMatchObject({ providerId: "nps_statement", nativeInputType: "csv" });
  });

  it("detects EPFO text exports by content even when the filename is arbitrary", () => {
    expect(detectImportSource({ fileName: "download.html", textSample: "Member Passbook EPFO Closing Balance as on" })).toMatchObject({ providerId: "epfo_passbook", nativeInputType: "html" });
  });

  it("detects implemented Indian broker stock CSVs", () => {
    expect(detectImportSource({ fileName: "zerodha.csv", textSample: "symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time" })).toMatchObject({ providerId: "zerodha_tradebook", status: "implemented" });
    expect(detectImportSource({ fileName: "groww.csv", textSample: "Stock name,Symbol,ISIN,Type,Quantity,Value,Exchange,Exchange Order Id,Execution date and time,Order status" })).toMatchObject({ providerId: "groww_stock_orders", status: "implemented" });
  });

  it("returns an explicit unsupported detection for unknown files", () => {
    expect(detectImportSource({ fileName: "random-broker-export.csv", textSample: "foo,bar\n1,2" })).toMatchObject({
      providerId: "unsupported",
      status: "unsupported",
      confidence: "low"
    });
  });
});
