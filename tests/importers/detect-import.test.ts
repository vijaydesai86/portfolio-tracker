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
      ["epfo_passbook", "detected_only"],
      ["nps_statement", "detected_only"],
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
      status: "detected_only"
    });
    expect(detectImportSource({ fileName: "nps-statement.pdf", textSample: "National Pension System PRAN" })).toMatchObject({
      providerId: "nps_statement",
      status: "detected_only"
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
});
