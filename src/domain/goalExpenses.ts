import Papa from "papaparse";
import type { Goal, GoalExpense, PortfolioBackup } from "@/src/schema/backup";

export type GoalExpenseImportMode = "single-goal" | "combined";

export type ParsedGoalExpenseImport = {
  rows: GoalExpense[];
  errors: string[];
  affectedGoalIds: string[];
  mode: GoalExpenseImportMode;
};

export type GoalExpenseSummary = {
  rows: GoalExpense[];
  baseMonthlyExpense: number;
  currentMonthlyExpense: number;
  startingMonthlyExpense: number;
  firstYearExpense: number;
  source: "manual" | "expenses";
};

type RawGoalExpenseRow = Record<string, unknown>;

const DAY_MS = 24 * 60 * 60 * 1000;

export function goalExpensesForGoal(backup: Pick<PortfolioBackup, "goalExpenses">, goalId: string): GoalExpense[] {
  return (backup.goalExpenses ?? []).filter((row) => row.goalId === goalId).sort((a, b) => a.baseDate.localeCompare(b.baseDate) || a.expense.localeCompare(b.expense));
}

export function summarizeGoalExpenses(goal: Goal, expenses: GoalExpense[], today = new Date()): GoalExpenseSummary {
  if (expenses.length === 0) {
    const startingMonthlyExpense = futureExpense(goal.currentMonthlyExpense ?? 0, goal.inflationRate, todayDate(today), goal.targetDate);
    return {
      rows: [],
      baseMonthlyExpense: roundMoney(goal.currentMonthlyExpense ?? 0),
      currentMonthlyExpense: roundMoney(goal.currentMonthlyExpense ?? 0),
      startingMonthlyExpense: roundMoney(startingMonthlyExpense),
      firstYearExpense: roundMoney(startingMonthlyExpense * 12),
      source: "manual"
    };
  }

  let baseMonthlyExpense = 0;
  let currentMonthlyExpense = 0;
  let startingMonthlyExpense = 0;
  const todayText = todayDate(today);
  for (const row of expenses) {
    baseMonthlyExpense += row.amount;
    currentMonthlyExpense += futureExpense(row.amount, goal.inflationRate, row.baseDate, todayText);
    startingMonthlyExpense += futureExpense(row.amount, goal.inflationRate, row.baseDate, goal.targetDate);
  }
  return {
    rows: expenses,
    baseMonthlyExpense: roundMoney(baseMonthlyExpense),
    currentMonthlyExpense: roundMoney(currentMonthlyExpense),
    startingMonthlyExpense: roundMoney(startingMonthlyExpense),
    firstYearExpense: roundMoney(startingMonthlyExpense * 12),
    source: "expenses"
  };
}

export function parseGoalExpenseCsv(input: string, backup: Pick<PortfolioBackup, "goals" | "baseCurrency">, options: { goalId?: string; baseDate?: string; now?: string } = {}): ParsedGoalExpenseImport {
  const normalizedInput = input.trim();
  if (!normalizedInput) return { rows: [], errors: ["Expense CSV is empty."], affectedGoalIds: [], mode: options.goalId ? "single-goal" : "combined" };
  const parsed = Papa.parse<RawGoalExpenseRow>(normalizedInput, { header: true, skipEmptyLines: true, transformHeader: normalizeHeader });
  const errors = parsed.errors.map((error) => "Row " + (error.row == null ? "?" : error.row + 2) + ": " + error.message);
  const data = parsed.data.filter((row) => Object.values(row).some((value) => String(value ?? "").trim().length > 0));
  const mode: GoalExpenseImportMode = hasCombinedHeaders(data) || !options.goalId ? "combined" : "single-goal";
  const now = options.now ?? new Date().toISOString();
  const rows: GoalExpense[] = [];
  const affectedGoalIds = new Set<string>();
  const goalsByName = new Map(backup.goals.map((goal) => [normalizeKey(goal.name), goal]));
  const goalsById = new Map(backup.goals.map((goal) => [goal.id, goal]));

  data.forEach((raw, index) => {
    const rowNumber = index + 2;
    const goal = mode === "single-goal" ? goalsById.get(options.goalId ?? "") : resolveGoal(raw, goalsByName, goalsById);
    if (!goal) {
      errors.push("Row " + rowNumber + ": goal is missing or does not match an existing goal.");
      return;
    }
    const expense = stringValue(raw.expense ?? raw.category ?? raw.name ?? raw.item);
    if (!expense) {
      errors.push("Row " + rowNumber + ": expense name is required.");
      return;
    }
    const amount = numericValue(raw.amount ?? raw.value ?? raw.monthly_amount ?? raw.monthlyexpense);
    if (!Number.isFinite(amount) || amount < 0) {
      errors.push("Row " + rowNumber + ": amount must be a non-negative number.");
      return;
    }
    const baseDate = stringValue(raw.base_date ?? raw.basedate ?? raw.date ?? raw.as_of_date ?? raw.asofdate) || options.baseDate || todayDate(new Date(now));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDate)) {
      errors.push("Row " + rowNumber + ": base date must be YYYY-MM-DD.");
      return;
    }
    const currency = (stringValue(raw.currency) || goal.currency || backup.baseCurrency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      errors.push("Row " + rowNumber + ": currency must be a 3-letter code.");
      return;
    }
    const id = goalExpenseId(goal.id, baseDate, expense, currency);
    rows.push({ id, goalId: goal.id, expense, amount: roundMoney(amount), currency, baseDate, createdAt: now, updatedAt: now });
    affectedGoalIds.add(goal.id);
  });

  return { rows, errors, affectedGoalIds: [...affectedGoalIds], mode };
}

export function mergeGoalExpenses(existing: GoalExpense[] | undefined, incoming: GoalExpense[], affectedGoalIds: string[], now = new Date().toISOString()): GoalExpense[] {
  const affected = new Set(affectedGoalIds);
  const retained = (existing ?? []).filter((row) => !affected.has(row.goalId));
  const normalizedIncoming = incoming.map((row) => ({ ...row, updatedAt: now, createdAt: row.createdAt || now }));
  return [...retained, ...normalizedIncoming].sort((a, b) => a.goalId.localeCompare(b.goalId) || a.baseDate.localeCompare(b.baseDate) || a.expense.localeCompare(b.expense));
}

export function goalExpenseId(goalId: string, baseDate: string, expense: string, currency = "INR"): string {
  return "goal_exp_" + slug(goalId) + "_" + baseDate + "_" + slug(expense) + "_" + currency.toLowerCase();
}

export function futureExpense(amount: number, inflationRate: number, fromDate: string, toDate: string): number {
  const years = yearsBetween(fromDate, toDate);
  return amount * Math.pow(1 + (inflationRate || 0) / 100, years);
}

function hasCombinedHeaders(rows: RawGoalExpenseRow[]): boolean {
  return rows.some((row) => row.goal !== undefined || row.goal_name !== undefined || row.goalid !== undefined || row.goal_id !== undefined);
}

function resolveGoal(row: RawGoalExpenseRow, goalsByName: Map<string, Goal>, goalsById: Map<string, Goal>): Goal | undefined {
  const goalText = stringValue(row.goal ?? row.goal_name ?? row.goalid ?? row.goal_id);
  if (!goalText) return undefined;
  return goalsById.get(goalText) ?? goalsByName.get(normalizeKey(goalText));
}

function numericValue(value: unknown): number {
  if (typeof value === "number") return value;
  const text = stringValue(value).replace(/,/g, "");
  return text ? Number(text) : NaN;
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
