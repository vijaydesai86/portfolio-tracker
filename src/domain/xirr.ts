export type CashFlow = {
  date: string;
  amount: number;
};

export function calculateXirr(flows: CashFlow[]): number | null {
  const valid = flows
    .filter((flow) => Number.isFinite(flow.amount) && flow.amount !== 0 && !Number.isNaN(Date.parse(flow.date)))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  if (valid.length < 2) return null;
  if (!valid.some((flow) => flow.amount > 0) || !valid.some((flow) => flow.amount < 0)) return null;

  let low = -0.999999;
  let high = 10;
  let lowValue = npv(valid, low);
  let highValue = npv(valid, high);

  for (let i = 0; i < 80 && lowValue * highValue > 0; i++) {
    high *= 2;
    highValue = npv(valid, high);
    if (high > 1_000_000) return null;
  }

  for (let i = 0; i < 160; i++) {
    const mid = (low + high) / 2;
    const midValue = npv(valid, mid);
    if (Math.abs(midValue) < 0.000001) return roundPercent(mid * 100);
    if (lowValue * midValue <= 0) {
      high = mid;
      highValue = midValue;
    } else {
      low = mid;
      lowValue = midValue;
    }
  }

  return roundPercent(((low + high) / 2) * 100);
}

function npv(flows: CashFlow[], rate: number): number {
  const start = Date.parse(flows[0].date);
  return flows.reduce((total, flow) => {
    const years = (Date.parse(flow.date) - start) / (365.25 * 24 * 60 * 60 * 1000);
    return total + flow.amount / Math.pow(1 + rate, years);
  }, 0);
}

function roundPercent(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
