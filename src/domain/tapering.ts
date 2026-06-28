import type { ManualBalance, TaperMode } from "@/src/schema/backup";

export type TaperPreset = { mode: TaperMode; label: string; factor: number; description: string };

export const taperPresets: TaperPreset[] = [
  { mode: "none", label: "No taper", factor: 0, description: "Use actual market value" },
  { mode: "light", label: "Light taper", factor: 0.02, description: "Small volatility haircut" },
  { mode: "medium", label: "Medium taper", factor: 0.05, description: "Excel-style volatility control" },
  { mode: "strong", label: "Strong taper", factor: 0.08, description: "More conservative planning value" },
  { mode: "custom", label: "Custom taper", factor: 0.05, description: "Use the custom factor below" }
];

const presetByMode = new Map(taperPresets.map((preset) => [preset.mode, preset]));

export type TrackedValue = {
  mode: TaperMode;
  label: string;
  factor: number;
  actualLocalValue: number;
  trackedLocalValue: number;
  actualPrice?: number;
  trackedPrice?: number;
  applied: boolean;
  reason: string;
};

export function taperModeLabel(mode?: TaperMode): string {
  return presetByMode.get(mode ?? "none")?.label ?? "No taper";
}

export function taperFactorForBalance(balance: Pick<ManualBalance, "taperMode" | "taperFactor">): number {
  const mode = balance.taperMode ?? "none";
  if (mode === "none") return 0;
  if (mode === "custom") return clampFactor(balance.taperFactor ?? 0.05);
  return presetByMode.get(mode)?.factor ?? 0;
}

export function calculateTrackedUnitPrice(price: number, factor: number): number {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(factor) || factor <= 0) return price;
  return price / (1 + factor * Math.sqrt(price));
}

export function calculateTrackedLocalValue(balance: ManualBalance): TrackedValue {
  const mode = balance.taperMode ?? "none";
  const factor = taperFactorForBalance(balance);
  const actualLocalValue = balance.value;
  const label = taperModeLabel(mode);
  if (factor <= 0) {
    return { mode, label, factor, actualLocalValue, trackedLocalValue: actualLocalValue, actualPrice: balance.price, trackedPrice: balance.price, applied: false, reason: "actual market value" };
  }
  if (!Number.isFinite(balance.price ?? NaN) || !Number.isFinite(balance.quantity ?? NaN) || (balance.price ?? 0) <= 0 || (balance.quantity ?? 0) <= 0) {
    return { mode, label, factor, actualLocalValue, trackedLocalValue: actualLocalValue, actualPrice: balance.price, trackedPrice: balance.price, applied: false, reason: "needs price and quantity" };
  }
  const actualPrice = balance.price ?? 0;
  const trackedPrice = calculateTrackedUnitPrice(actualPrice, factor);
  const trackedLocalValue = trackedPrice * (balance.quantity ?? 0);
  return {
    mode,
    label,
    factor,
    actualLocalValue,
    trackedLocalValue: roundMoney(trackedLocalValue),
    actualPrice,
    trackedPrice: roundMoney(trackedPrice),
    applied: true,
    reason: "tracked price = actual / (1 + k x sqrt(actual))"
  };
}

export function hasAppliedTaper(balance: ManualBalance): boolean {
  return calculateTrackedLocalValue(balance).applied;
}

function clampFactor(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
