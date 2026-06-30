import Papa from "papaparse";
import type { Goal, GoalExpense, PortfolioBackup } from "@/src/schema/backup";

export type GoalExpenseImportMode = "single-goal" | "combined";

export type ParsedGoalExpenseImport = {
  rows: GoalExpense[];
  errors: string[];
  affectedGoalIds: string[];
  activeScenarios: Record<string, string>;
  mode: GoalExpenseImportMode;
};

export type GoalExpenseSummary = {
  rows: GoalExpense[];
  baseMonthlyExpense: number;
  currentMonthlyExpense: number;
  startingMonthlyExpense: number;
  firstYearExpense: number;
  selectedScenario?: string;
  scenarioTotals: Array<{ scenario: string; baseMonthlyExpense: number; rows: number }>;
  categoryTotals: Array<{ category: string; baseMonthlyExpense: number; rows: number }>;
  payerTotals: Array<{ payer: string; baseMonthlyExpense: number; rows: number }>;
  source: "manual" | "expenses";
};

type RawGoalExpenseRow = Record<string, unknown>;

const DAY_MS = 24 * 60 * 60 * 1000;
const frequencies = new Set(["monthly", "yearly", "one_time"]);

export function goalExpensesForGoal(backup: Pick<PortfolioBackup, "goalExpenses">, goalId: string): GoalExpense[] {
  return (backup.goalExpenses ?? []).filter((row) => row.goalId === goalId).sort((a, b) => a.baseDate.localeCompare(b.baseDate) || (a.scenario ?? "Current").localeCompare(b.scenario ?? "Current") || (a.category ?? "").localeCompare(b.category ?? "") || a.expense.localeCompare(b.expense));
}

export function summarizeGoalExpenses(goal: Goal, expenses: GoalExpense[], today = new Date()): GoalExpenseSummary {
  const scenarioTotals = summarizeBy(expenses, (row) => row.scenario || "Current").map(([scenario, value, rows]) => ({ scenario, baseMonthlyExpense: value, rows }));
  if (expenses.length === 0) {
    const startingMonthlyExpense = futureExpense(goal.currentMonthlyExpense ?? 0, goal.inflationRate, todayDate(today), goal.targetDate);
    return {
      rows: [],
      baseMonthlyExpense: roundMoney(goal.currentMonthlyExpense ?? 0),
      currentMonthlyExpense: roundMoney(goal.currentMonthlyExpense ?? 0),
      startingMonthlyExpense: roundMoney(startingMonthlyExpense),
      firstYearExpense: roundMoney(startingMonthlyExpense * 12),
      selectedScenario: goal.expenseScenario,
      scenarioTotals,
      categoryTotals: [],
      payerTotals: [],
      source: "manual"
    };
  }

  const selectedScenario = goal.expenseScenario || scenarioTotals[0]?.scenario || "Current";
  const selectedRows = expenses.filter((row) => (row.scenario || "Current") === selectedScenario);
  const rowsForMath = selectedRows.length > 0 ? selectedRows : expenses;
  let baseMonthlyExpense = 0;
  let currentMonthlyExpense = 0;
  let startingMonthlyExpense = 0;
  const todayText = todayDate(today);
  for (const row of rowsForMath) {
    baseMonthlyExpense += row.amount;
    currentMonthlyExpense += futureExpense(row.amount, goal.inflationRate, row.baseDate, todayText);
    startingMonthlyExpense += futureExpense(row.amount, goal.inflationRate, row.baseDate, goal.targetDate);
  }
  return {
    rows: rowsForMath,
    baseMonthlyExpense: roundMoney(baseMonthlyExpense),
    currentMonthlyExpense: roundMoney(currentMonthlyExpense),
    startingMonthlyExpense: roundMoney(startingMonthlyExpense),
    firstYearExpense: roundMoney(startingMonthlyExpense * 12),
    selectedScenario,
    scenarioTotals,
    categoryTotals: summarizeBy(rowsForMath, (row) => row.category || row.expense).map(([category, value, rows]) => ({ category, baseMonthlyExpense: value, rows })),
    payerTotals: summarizeBy(rowsForMath, (row) => row.payer || "Unassigned").map(([payer, value, rows]) => ({ payer, baseMonthlyExpense: value, rows })),
    source: "expenses"
  };
}

export function parseGoalExpenseCsv(input: string, backup: Pick<PortfolioBackup, "goals" | "baseCurrency">, options: { goalId?: string; baseDate?: string; now?: string } = {}): ParsedGoalExpenseImport {
  const normalizedInput = input.trim();
  if (!normalizedInput) return { rows: [], errors: ["Expense CSV is empty."], affectedGoalIds: [], activeScenarios: {}, mode: options.goalId ? "single-goal" : "combined" };
  const parsed = Papa.parse<RawGoalExpenseRow>(normalizedInput, { header: true, skipEmptyLines: true, transformHeader: normalizeHeader });
  const errors = parsed.errors.map((error) => "Row " + (error.row == null ? "?" : error.row + 2) + ": " + error.message);
  const data = parsed.data.filter((row) => Object.values(row).some((value) => String(value ?? "").trim().length > 0));
  const mode: GoalExpenseImportMode = hasCombinedHeaders(data) || !options.goalId ? "combined" : "single-goal";
  const now = options.now ?? new Date().toISOString();
  const rows: GoalExpense[] = [];
  const affectedGoalIds = new Set<string>();
  const activeScenarios: Record<string, string> = {};
  const goalsByName = new Map(backup.goals.map((goal) => [normalizeKey(goal.name), goal]));
  const goalsById = new Map(backup.goals.map((goal) => [goal.id, goal]));

  data.forEach((raw, index) => {
    const rowNumber = index + 2;
    const goal = mode === "single-goal" ? goalsById.get(options.goalId ?? "") : resolveGoal(raw, goalsByName, goalsById);
    if (!goal) {
      errors.push("Row " + rowNumber + ": goal is missing or does not match an existing goal.");
      return;
    }
    const scenario = stringValue(raw.scenario ?? raw.case ?? raw.plan) || "Current";
    const category = stringValue(raw.category ?? raw.group) || undefined;
    const subCategory = stringValue(raw.sub_category ?? raw.subcategory ?? raw.section) || undefined;
    const expense = stringValue(raw.item ?? raw.expense ?? raw.name ?? category);
    if (!expense) {
      errors.push("Row " + rowNumber + ": item or expense name is required.");
      return;
    }
    const quantity = optionalNumeric(raw.quantity ?? raw.qty ?? raw.sessions);
    const unitAmount = optionalNumeric(raw.unit_amount ?? raw.unitamount ?? raw.per_session ?? raw.per_unit);
    const directAmount = optionalNumeric(raw.amount ?? raw.value ?? raw.monthly_amount ?? raw.monthlyexpense ?? raw.total);
    const rawAmount = directAmount ?? (quantity !== undefined && unitAmount !== undefined ? quantity * unitAmount : NaN);
    if (!Number.isFinite(rawAmount) || rawAmount < 0) {
      errors.push("Row " + rowNumber + ": amount must be non-negative, or quantity and unit_amount must compute a non-negative amount.");
      return;
    }
    const frequency = normalizeFrequency(stringValue(raw.frequency ?? raw.freq) || "monthly");
    if (!frequency) {
      errors.push("Row " + rowNumber + ": frequency must be monthly, yearly, or one_time.");
      return;
    }
    const amount = monthlyAmount(rawAmount, frequency);
    const rawBaseDate = stringValue(raw.base_date ?? raw.basedate ?? raw.date ?? raw.as_of_date ?? raw.asofdate) || options.baseDate || todayDate(new Date(now));
    const baseDate = normalizeExpenseDate(rawBaseDate);
    if (!baseDate) {
      errors.push("Row " + rowNumber + ": base date must be a valid date, for example YYYY-MM-DD or DD-MM-YYYY.");
      return;
    }
    const currency = (stringValue(raw.currency) || goal.currency || backup.baseCurrency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      errors.push("Row " + rowNumber + ": currency must be a 3-letter code.");
      return;
    }
    const payer = stringValue(raw.payer ?? raw.paid_by ?? raw.owner) || undefined;
    const notes = stringValue(raw.notes ?? raw.note ?? raw.description) || undefined;
    const id = goalExpenseId(goal.id, baseDate, scenario, category ?? "General", expense, currency);
    rows.push({ id, goalId: goal.id, expense, amount: roundMoney(amount), currency, baseDate, scenario, category, subCategory, payer, frequency, quantity, unitAmount, notes, createdAt: now, updatedAt: now });
    affectedGoalIds.add(goal.id);
    if (isTruthy(raw.active_scenario ?? raw.active ?? raw.selected_scenario ?? raw.selected)) activeScenarios[goal.id] = scenario;
  });

  return { rows, errors, affectedGoalIds: [...affectedGoalIds], activeScenarios, mode };
}

export function mergeGoalExpenses(existing: GoalExpense[] | undefined, incoming: GoalExpense[], affectedGoalIds: string[], now = new Date().toISOString()): GoalExpense[] {
  const affected = new Set(affectedGoalIds);
  const retained = (existing ?? []).filter((row) => !affected.has(row.goalId));
  const normalizedIncoming = incoming.map((row) => ({ ...row, updatedAt: now, createdAt: row.createdAt || now }));
  return [...retained, ...normalizedIncoming].sort((a, b) => a.goalId.localeCompare(b.goalId) || a.baseDate.localeCompare(b.baseDate) || (a.scenario ?? "Current").localeCompare(b.scenario ?? "Current") || (a.category ?? "").localeCompare(b.category ?? "") || a.expense.localeCompare(b.expense));
}

export function goalExpenseId(goalId: string, baseDate: string, scenario: string, category: string, expense: string, currency = "INR"): string {
  return "goal_exp_" + slug(goalId) + "_" + baseDate + "_" + slug(scenario) + "_" + slug(category) + "_" + slug(expense) + "_" + currency.toLowerCase();
}

export function futureExpense(amount: number, inflationRate: number, fromDate: string, toDate: string): number {
  const years = yearsBetween(fromDate, toDate);
  return amount * Math.pow(1 + (inflationRate || 0) / 100, years);
}

function summarizeBy(rows: GoalExpense[], keyFn: (row: GoalExpense) => string): Array<[string, number, number]> {
  const totals = new Map<string, { value: number; rows: number }>();
  for (const row of rows) {
    const key = keyFn(row) || "Other";
    const existing = totals.get(key) ?? { value: 0, rows: 0 };
    existing.value += row.amount;
    existing.rows += 1;
    totals.set(key, existing);
  }
  return [...totals.entries()].map(([key, item]) => [key, roundMoney(item.value), item.rows] as [string, number, number]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function hasCombinedHeaders(rows: RawGoalExpenseRow[]): boolean {
  return rows.some((row) => row.goal !== undefined || row.goal_name !== undefined || row.goalid !== undefined || row.goal_id !== undefined);
}

function resolveGoal(row: RawGoalExpenseRow, goalsByName: Map<string, Goal>, goalsById: Map<string, Goal>): Goal | undefined {
  const goalText = stringValue(row.goal ?? row.goal_name ?? row.goalid ?? row.goal_id);
  if (!goalText) return undefined;
  return goalsById.get(goalText) ?? goalsByName.get(normalizeKey(goalText));
}

function optionalNumeric(value: unknown): number | undefined {
  const text = stringValue(value).replace(/,/g, "");
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeExpenseDate(value: string): string | undefined {
  const text = value.trim();
  if (!text) return undefined;
  const iso = text.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (iso) return canonicalDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const indian = text.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (indian) return canonicalDate(Number(indian[3]), Number(indian[2]), Number(indian[1]));
  const parsed = new Date(text);
  if (Number.isFinite(parsed.getTime())) return todayDate(parsed);
  return undefined;
}

function canonicalDate(year: number, month: number, day: number): string | undefined {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return undefined;
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return String(year).padStart(4, "0") + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}

function normalizeFrequency(value: string): GoalExpense["frequency"] | undefined {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "annual") return "yearly";
  if (normalized === "once") return "one_time";
  return frequencies.has(normalized) ? normalized as GoalExpense["frequency"] : undefined;
}

function monthlyAmount(amount: number, frequency: GoalExpense["frequency"]): number {
  if (frequency === "yearly" || frequency === "one_time") return amount / 12;
  return amount;
}

function isTruthy(value: unknown): boolean {
  const text = stringValue(value).toLowerCase();
  return ["1", "true", "yes", "y", "active", "selected"].includes(text);
}

function stringValue(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/^\uFEFF/, "").replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "row";
}

function todayDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function yearsBetween(fromDate: string, toDate: string): number {
  const from = new Date(fromDate + "T00:00:00.000Z").getTime();
  const to = new Date(toDate + "T00:00:00.000Z").getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, (to - from) / (365.25 * DAY_MS));
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
