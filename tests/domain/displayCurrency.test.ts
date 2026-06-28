import { describe, expect, it } from "vitest";
import { createEmptyBackup } from "@/src/schema/backup";
import { formatUsdEquivalent, getDisplayCurrencySettings, latestUsdInrSnapshot, updateDisplayCurrencySettings } from "@/src/domain/displayCurrency";

const now = "2026-06-27T00:00:00.000Z";

describe("USD equivalent display settings", () => {
  it("defaults off and persists the toggle in canonical backup settings", () => {
    const backup = createEmptyBackup("INR");

    expect(getDisplayCurrencySettings(backup)).toEqual({ showUsdEquivalent: false });

    const updated = updateDisplayCurrencySettings(backup, { showUsdEquivalent: true });

    expect(getDisplayCurrencySettings(updated)).toEqual({ showUsdEquivalent: true });
    expect(updated.settings.displayCurrency).toEqual({ showUsdEquivalent: true });
    expect(backup.settings.displayCurrency).toBeUndefined();
  });

  it("uses the latest real USD/INR snapshot and never mutates INR values", () => {
    const backup = createEmptyBackup("INR");
    backup.settings.displayCurrency = { showUsdEquivalent: true };
    backup.priceSnapshots.push(
      { id: "old", instrumentId: "USDINR", price: 80, currency: "INR", asOfDate: "2026-06-20", source: "old_fx", createdAt: now },
      { id: "latest", instrumentId: "USDINR", price: 95, currency: "INR", asOfDate: "2026-06-27", source: "latest_fx", createdAt: now }
    );

    expect(latestUsdInrSnapshot(backup)).toMatchObject({ rate: 95, asOfDate: "2026-06-27", source: "latest_fx" });
    expect(formatUsdEquivalent(9500, backup)).toBe("~$100.00");
  });

  it("hides USD equivalent when disabled or when a real FX snapshot is missing", () => {
    const backup = createEmptyBackup("INR");
    expect(formatUsdEquivalent(9500, backup)).toBeUndefined();
    backup.settings.displayCurrency = { showUsdEquivalent: true };
    expect(formatUsdEquivalent(9500, backup)).toBeUndefined();
  });
});
