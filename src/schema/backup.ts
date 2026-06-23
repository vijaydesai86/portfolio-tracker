import { z } from "zod";

export const categorySchema = z.enum(["Equity", "Debt", "Gold", "Others", "Cash"]);
export type AssetCategory = z.infer<typeof categorySchema>;

export const currencySchema = z.string().regex(/^[A-Z]{3}$/);

const timestampSchema = z.string().datetime();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const sourceMetadataSchema = z.object({
  type: z.enum(["manual", "import", "system"]),
  importId: z.string().optional(),
  provider: z.string().optional(),
  sourceRecordHash: z.string().optional()
});
export type SourceMetadata = z.infer<typeof sourceMetadataSchema>;

export const accountSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  institution: z.string().min(1),
  type: z.enum([
    "mutual_fund",
    "indian_stock",
    "us_stock",
    "fd",
    "ppf",
    "ssy",
    "nps",
    "epf",
    "cash",
    "espp",
    "gold",
    "other"
  ]),
  currency: currencySchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
});
export type Account = z.infer<typeof accountSchema>;

export const instrumentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: accountSchema.shape.type,
  symbol: z.string().optional(),
  isin: z.string().optional(),
  currency: currencySchema,
  country: z.string().optional(),
  category: categorySchema,
  issuer: z.string().optional(),
  categoryBreakdown: z.record(categorySchema, z.number().min(0).max(100)).optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
});
export type Instrument = z.infer<typeof instrumentSchema>;

export const transactionSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  instrumentId: z.string().min(1),
  date: dateSchema,
  type: z.enum([
    "buy",
    "sell",
    "sip",
    "redemption",
    "switch_in",
    "switch_out",
    "dividend",
    "interest",
    "interest_accrual",
    "deposit",
    "withdrawal",
    "fee",
    "tax",
    "maturity",
    "contribution",
    "split"
  ]),
  quantity: z.number().optional(),
  price: z.number().optional(),
  amount: z.number(),
  currency: currencySchema,
  fees: z.number().default(0),
  taxes: z.number().default(0),
  source: sourceMetadataSchema,
  userModified: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
});
export type Transaction = z.infer<typeof transactionSchema>;

export const manualBalanceSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  instrumentId: z.string().optional(),
  label: z.string().min(1),
  category: categorySchema,
  currency: currencySchema,
  value: z.number().finite(),
  investedAmount: z.number().finite().optional(),
  investedCurrency: currencySchema.optional(),
  investedAsOfDate: dateSchema.optional(),
  quantity: z.number().finite().optional(),
  price: z.number().finite().optional(),
  asOfDate: dateSchema,
  notes: z.string().optional(),
  source: sourceMetadataSchema,
  userModified: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
});
export type ManualBalance = z.infer<typeof manualBalanceSchema>;

export const priceSnapshotSchema = z.object({
  id: z.string().min(1),
  instrumentId: z.string().min(1),
  price: z.number().finite().positive(),
  currency: currencySchema,
  asOfDate: dateSchema,
  source: z.string().min(1),
  createdAt: timestampSchema
});
export type PriceSnapshot = z.infer<typeof priceSnapshotSchema>;

export const goalSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  targetAmount: z.number().finite().nonnegative(),
  currency: currencySchema,
  targetDate: dateSchema,
  inflationRate: z.number().min(0).max(100),
  expectedReturn: z.number().min(0).max(100),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
});
export type Goal = z.infer<typeof goalSchema>;

export const goalMappingSchema = z.object({
  id: z.string().min(1),
  goalId: z.string().min(1),
  accountId: z.string().optional(),
  instrumentId: z.string().optional(),
  manualBalanceId: z.string().optional(),
  percent: z.number().min(0).max(100),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
});
export type GoalMapping = z.infer<typeof goalMappingSchema>;

export const importRunSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  fileName: z.string().optional(),
  label: z.string().optional(),
  status: z.enum(["staged", "committed", "failed"]),
  confidence: z.enum(["high", "medium", "low", "manual-only"]),
  createdAt: timestampSchema,
  committedAt: timestampSchema.optional(),
  notes: z.string().optional()
});
export type ImportRun = z.infer<typeof importRunSchema>;

export const sourceDocumentSchema = z.object({
  id: z.string().min(1),
  importId: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().optional(),
  sha256: z.string().optional(),
  addedAt: timestampSchema
});
export type SourceDocument = z.infer<typeof sourceDocumentSchema>;

export const backupSchema = z.object({
  schemaVersion: z.literal(1),
  app: z.literal("portfolio-tracker"),
  exportedAt: timestampSchema,
  baseCurrency: currencySchema,
  settings: z.record(z.string(), z.unknown()),
  accounts: z.array(accountSchema),
  instruments: z.array(instrumentSchema),
  transactions: z.array(transactionSchema),
  manualBalances: z.array(manualBalanceSchema),
  priceSnapshots: z.array(priceSnapshotSchema),
  goals: z.array(goalSchema),
  goalMappings: z.array(goalMappingSchema),
  imports: z.array(importRunSchema),
  sourceDocuments: z.array(sourceDocumentSchema)
});
export type PortfolioBackup = z.infer<typeof backupSchema>;

export function createEmptyBackup(baseCurrency: string): PortfolioBackup {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    app: "portfolio-tracker",
    exportedAt: now,
    baseCurrency,
    settings: {},
    accounts: [],
    instruments: [],
    transactions: [],
    manualBalances: [],
    priceSnapshots: [],
    goals: [],
    goalMappings: [],
    imports: [],
    sourceDocuments: []
  };
}

export function parseBackup(input: unknown): PortfolioBackup {
  const result = backupSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid canonical backup schema: ${result.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  return result.data;
}
