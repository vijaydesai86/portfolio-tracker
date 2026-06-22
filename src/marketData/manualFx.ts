import { slugId } from "@/src/domain/hash";
import type { PriceSnapshot } from "@/src/schema/backup";

export type FxCsvParseResult = {
  snapshots: PriceSnapshot[];
  errors: string[];
};

export function buildUsdInrSnapshot(rate: number, asOfDate: string, source = "manual_fx"): PriceSnapshot {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("USD/INR rate must be a positive number.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) throw new Error("FX date must be in YYYY-MM-DD format.");
  return {
    id: slugId("price", ["USDINR", asOfDate, String(rate), source]),
    instrumentId: "USDINR",
    price: rate,
    currency: "INR",
    asOfDate,
    source,
    createdAt: new Date().toISOString()
  };
}

export function parseUsdInrFxCsv(text: string, source = "manual_fx_csv"): FxCsvParseResult {
  const snapshots: PriceSnapshot[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (index === 0 && /date/i.test(line) && /rate/i.test(line)) continue;
    const [date, rateText] = line.split(/[,;\t]/).map((part) => part.trim());
    const rate = Number(rateText);
    try {
      snapshots.push(buildUsdInrSnapshot(rate, date, source));
    } catch (error) {
      errors.push(`Line ${index + 1}: ${error instanceof Error ? error.message : "Invalid FX row"}`);
    }
  }

  return { snapshots, errors };
}

export function mergePriceSnapshots(existing: PriceSnapshot[], incoming: PriceSnapshot[]): PriceSnapshot[] {
  const map = new Map(existing.map((snapshot) => [snapshot.id, snapshot]));
  for (const snapshot of incoming) map.set(snapshot.id, snapshot);
  return [...map.values()];
}
