import type { Account, Instrument } from "@/src/schema/backup";

export type AssetModuleHolding = {
  accountType?: Account["type"];
  instrumentType?: Instrument["type"];
  valueInBase?: number;
};

export type ReadinessModule = {
  label: string;
  detail: string;
  count: number;
  value: number;
  category: string;
};

type AssetModuleDefinition = {
  label: string;
  detail: string;
  category: string;
  matches: (type: Account["type"] | undefined) => boolean;
};

const moduleDefinitions: AssetModuleDefinition[] = [
  { label: "Mutual Funds", detail: "CAS/CAMS/KFin statement positions", category: "Equity/Debt/Gold/Others", matches: (type) => type === "mutual_fund" },
  { label: "Indian Stocks", detail: "Broker and demat equity positions", category: "Equity", matches: (type) => type === "indian_stock" },
  { label: "US Stocks", detail: "INDMoney, Fidelity, and other broker ledgers", category: "Equity", matches: (type) => type === "us_stock" },
  { label: "PF / EPF", detail: "Provident fund contribution balances", category: "Debt", matches: (type) => type === "epf" },
  { label: "PPF / SSY", detail: "Small savings balance modules", category: "Debt", matches: (type) => type === "ppf" || type === "ssy" },
  { label: "NPS", detail: "Tier I/II retirement allocations", category: "Equity/Debt/Others", matches: (type) => type === "nps" },
  { label: "FD", detail: "Fixed deposit maturity schedules", category: "Debt", matches: (type) => type === "fd" },
  { label: "Cash / ESPP", detail: "Manual cash and ESPP contribution entries", category: "Cash/Equity", matches: (type) => type === "cash" || type === "espp" }
];

export function buildReadinessModules(holdings: AssetModuleHolding[]): ReadinessModule[] {
  return moduleDefinitions.map((definition) => {
    const matched = holdings.filter((holding) => definition.matches(holding.instrumentType ?? holding.accountType));
    return {
      label: definition.label,
      detail: definition.detail,
      category: definition.category,
      count: matched.length,
      value: matched.reduce((sum, holding) => sum + (holding.valueInBase ?? 0), 0)
    };
  });
}
