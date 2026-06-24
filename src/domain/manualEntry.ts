import { slugId, stableHash } from "@/src/domain/hash";
import type { Account, ManualBalance, PortfolioBackup, PriceSnapshot, Transaction } from "@/src/schema/backup";

export type ManualEntryMode = "transaction" | "balance_snapshot";

export type ManualEntryAction = {
  id: string;
  label: string;
  transactionType?: Transaction["type"];
  mode: ManualEntryMode;
  needsQuantity?: boolean;
  needsPrice?: boolean;
  needsFees?: boolean;
  needsTaxes?: boolean;
  balanceDelta: "add" | "subtract" | "none" | "set";
  quantityDelta: "add" | "subtract" | "signed" | "none" | "set";
};

export type ManualEntryInput = {
  balanceId: string;
  actionId: string;
  date: string;
  amount?: number;
  quantity?: number;
  price?: number;
  fees?: number;
  taxes?: number;
  currentValue?: number;
  investedAmount?: number;
  notes?: string;
};

export type ManualEntryResult = {
  backup: PortfolioBackup;
  transaction?: Transaction;
  balance: ManualBalance;
  priceSnapshot?: PriceSnapshot;
  action: ManualEntryAction;
};

const marketActions: ManualEntryAction[] = [
  { id: "buy", label: "Buy", transactionType: "buy", mode: "transaction", needsQuantity: true, needsPrice: true, needsFees: true, needsTaxes: true, balanceDelta: "add", quantityDelta: "add" },
  { id: "sip", label: "SIP / Recurring Buy", transactionType: "sip", mode: "transaction", needsQuantity: true, needsPrice: true, needsFees: true, needsTaxes: true, balanceDelta: "add", quantityDelta: "add" },
  { id: "sell", label: "Sell / Redemption", transactionType: "sell", mode: "transaction", needsQuantity: true, needsPrice: true, needsFees: true, needsTaxes: true, balanceDelta: "subtract", quantityDelta: "subtract" },
  { id: "dividend", label: "Dividend", transactionType: "dividend", mode: "transaction", needsTaxes: true, balanceDelta: "none", quantityDelta: "none" },
  { id: "fee", label: "Fee", transactionType: "fee", mode: "transaction", balanceDelta: "none", quantityDelta: "none" },
  { id: "tax", label: "Tax", transactionType: "tax", mode: "transaction", balanceDelta: "none", quantityDelta: "none" }
];

const mutualFundActions: ManualEntryAction[] = [
  { id: "buy", label: "Purchase", transactionType: "buy", mode: "transaction", needsQuantity: true, needsPrice: true, needsFees: true, needsTaxes: true, balanceDelta: "add", quantityDelta: "add" },
  { id: "sip", label: "SIP", transactionType: "sip", mode: "transaction", needsQuantity: true, needsPrice: true, needsFees: true, needsTaxes: true, balanceDelta: "add", quantityDelta: "add" },
  { id: "redemption", label: "Redemption", transactionType: "redemption", mode: "transaction", needsQuantity: true, needsPrice: true, needsFees: true, needsTaxes: true, balanceDelta: "subtract", quantityDelta: "subtract" },
  { id: "switch_in", label: "Switch In", transactionType: "switch_in", mode: "transaction", needsQuantity: true, needsPrice: true, needsFees: true, balanceDelta: "add", quantityDelta: "add" },
  { id: "switch_out", label: "Switch Out", transactionType: "switch_out", mode: "transaction", needsQuantity: true, needsPrice: true, needsFees: true, balanceDelta: "subtract", quantityDelta: "subtract" },
  { id: "dividend", label: "Dividend", transactionType: "dividend", mode: "transaction", needsTaxes: true, balanceDelta: "none", quantityDelta: "none" },
  { id: "fee", label: "Fee / Exit Load", transactionType: "fee", mode: "transaction", balanceDelta: "none", quantityDelta: "none" },
  { id: "tax", label: "Tax / Stamp Duty", transactionType: "tax", mode: "transaction", balanceDelta: "none", quantityDelta: "none" }
];

const npsActions: ManualEntryAction[] = [
  { id: "contribution", label: "Contribution", transactionType: "contribution", mode: "transaction", needsQuantity: true, needsPrice: true, needsFees: true, balanceDelta: "add", quantityDelta: "add" },
  { id: "switch_in", label: "Scheme Switch In", transactionType: "switch_in", mode: "transaction", needsQuantity: true, needsPrice: true, balanceDelta: "add", quantityDelta: "add" },
  { id: "switch_out", label: "Scheme Switch Out", transactionType: "switch_out", mode: "transaction", needsQuantity: true, needsPrice: true, balanceDelta: "subtract", quantityDelta: "subtract" },
  { id: "fee", label: "NPS Charge", transactionType: "fee", mode: "transaction", balanceDelta: "none", quantityDelta: "none" },
  { id: "snapshot", label: "Latest Scheme Balance", mode: "balance_snapshot", needsQuantity: true, needsPrice: true, balanceDelta: "set", quantityDelta: "set" }
];

const pfActions: ManualEntryAction[] = [
  { id: "contribution", label: "Contribution / Transfer In", transactionType: "contribution", mode: "transaction", balanceDelta: "add", quantityDelta: "none" },
  { id: "interest_accrual", label: "Interest Accrual", transactionType: "interest_accrual", mode: "transaction", balanceDelta: "add", quantityDelta: "none" },
  { id: "withdrawal", label: "Withdrawal", transactionType: "withdrawal", mode: "transaction", balanceDelta: "subtract", quantityDelta: "none" },
  { id: "snapshot", label: "Latest Closing Balance", mode: "balance_snapshot", balanceDelta: "set", quantityDelta: "none" }
];

const balanceActions: ManualEntryAction[] = [
  { id: "deposit", label: "Deposit / Contribution", transactionType: "deposit", mode: "transaction", balanceDelta: "add", quantityDelta: "none" },
  { id: "interest_accrual", label: "Interest / Accrual", transactionType: "interest_accrual", mode: "transaction", balanceDelta: "add", quantityDelta: "none" },
  { id: "withdrawal", label: "Withdrawal", transactionType: "withdrawal", mode: "transaction", balanceDelta: "subtract", quantityDelta: "none" },
  { id: "maturity", label: "Maturity / Closure", transactionType: "maturity", mode: "transaction", balanceDelta: "subtract", quantityDelta: "none" },
  { id: "snapshot", label: "Latest Balance Snapshot", mode: "balance_snapshot", balanceDelta: "set", quantityDelta: "none" }
];

export function manualEntryActionsForAccount(type: Account["type"]): ManualEntryAction[] {
  if (type === "mutual_fund") return mutualFundActions;
  if (type === "indian_stock" || type === "us_stock" || type === "gold") return marketActions;
  if (type === "nps") return npsActions;
  if (type === "epf") return pfActions;
  return balanceActions;
}

export function applyManualEntry(backup: PortfolioBackup, input: ManualEntryInput, now = new Date().toISOString()): ManualEntryResult {
  const balance = backup.manualBalances.find((item) => item.id === input.balanceId);
  if (!balance) throw new Error("Select an existing holding first.");
  const account = backup.accounts.find((item) => item.id === balance.accountId);
  if (!account) throw new Error("Selected holding has no matching account.");
  const instrument = balance.instrumentId ? backup.instruments.find((item) => item.id === balance.instrumentId) : undefined;
  if (!instrument) throw new Error("Selected holding has no matching instrument.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Entry date must be in YYYY-MM-DD format.");

  const action = manualEntryActionsForAccount(account.type).find((item) => item.id === input.actionId);
  if (!action) throw new Error("Unsupported entry type for selected asset.");

  const currency = balance.currency;
  const quantity = numberOrUndefined(input.quantity);
  const price = numberOrUndefined(input.price);
  const fees = numberOrZero(input.fees);
  const taxes = numberOrZero(input.taxes);
  const explicitAmount = numberOrUndefined(input.amount);
  const computedAmount = explicitAmount ?? (quantity !== undefined && price !== undefined ? Math.abs(quantity * price) : undefined);
  const amount = action.mode === "balance_snapshot" ? 0 : computedAmount;

  if (action.mode === "transaction" && (amount === undefined || amount < 0)) throw new Error("Amount is required for this entry.");
  if (action.needsQuantity && (quantity === undefined || quantity === 0)) throw new Error("Quantity/units are required for this entry.");
  if (action.needsPrice && (price === undefined || price <= 0)) throw new Error("Price/NAV is required for this entry.");
  if (fees < 0 || taxes < 0) throw new Error("Fees and taxes cannot be negative.");

  const quantityDelta = quantityChange(action, quantity);
  const valueDelta = valueChange(action, amount ?? 0);
  const nextQuantity = action.quantityDelta === "set" ? quantity : balance.quantity === undefined && quantityDelta === undefined ? undefined : roundQuantity((balance.quantity ?? 0) + (quantityDelta ?? 0));
  const nextPrice = price ?? balance.price;
  const currentValue = numberOrUndefined(input.currentValue);
  if (action.mode === "balance_snapshot" && currentValue === undefined && !(nextQuantity !== undefined && nextPrice !== undefined)) throw new Error("Current value is required for a balance snapshot.");
  const nextValue = action.mode === "balance_snapshot"
    ? currentValue ?? (nextQuantity !== undefined && nextPrice !== undefined ? roundMoney(nextQuantity * nextPrice) : balance.value)
    : nextQuantity !== undefined && nextPrice !== undefined && isMarketLike(account.type)
      ? roundMoney(Math.max(0, nextQuantity) * nextPrice)
      : roundMoney(Math.max(0, balance.value + valueDelta));

  const nextBalance: ManualBalance = {
    ...balance,
    value: nextValue,
    quantity: nextQuantity,
    price: nextPrice,
    investedAmount: input.investedAmount === undefined ? balance.investedAmount : input.investedAmount,
    investedCurrency: input.investedAmount === undefined ? balance.investedCurrency : currency,
    investedAsOfDate: input.investedAmount === undefined ? balance.investedAsOfDate : input.date,
    asOfDate: input.date,
    notes: mergeNotes(balance.notes, input.notes),
    source: { type: "manual", provider: "manual_entry", sourceRecordHash: stableHash({ balanceId: balance.id, input, now }) },
    userModified: true,
    updatedAt: now
  };

  const transaction = action.mode === "transaction" && action.transactionType ? buildTransaction({ balance, input, action, amount: amount ?? 0, quantity, price, fees, taxes, currency, now }) : undefined;
  const openingTransaction = transaction && transactionsForBalance(backup, balance).length === 0 ? buildOpeningTransaction({ balance, account, now }) : undefined;
  const priceSnapshot = price !== undefined && price > 0 ? buildPriceSnapshot(instrument.id, price, currency, input.date, now) : undefined;

  return {
    backup: {
      ...backup,
      exportedAt: now,
      manualBalances: backup.manualBalances.map((item) => item.id === balance.id ? nextBalance : item),
      transactions: transaction ? [...backup.transactions, ...(openingTransaction ? [openingTransaction] : []), transaction] : backup.transactions,
      priceSnapshots: priceSnapshot ? mergePriceSnapshot(backup.priceSnapshots, priceSnapshot) : backup.priceSnapshots
    },
    transaction,
    balance: nextBalance,
    priceSnapshot,
    action
  };
}

function buildTransaction(args: { balance: ManualBalance; input: ManualEntryInput; action: ManualEntryAction; amount: number; quantity?: number; price?: number; fees: number; taxes: number; currency: string; now: string }): Transaction {
  const sourceRecordHash = stableHash({ provider: "manual_entry", balanceId: args.balance.id, input: args.input, now: args.now });
  return {
    id: slugId("txn", [sourceRecordHash]),
    accountId: args.balance.accountId,
    instrumentId: args.balance.instrumentId!,
    date: args.input.date,
    type: args.action.transactionType!,
    quantity: args.quantity === undefined ? undefined : Math.abs(args.quantity),
    price: args.price,
    amount: Math.abs(args.amount),
    currency: args.currency,
    fees: args.fees,
    taxes: args.taxes,
    source: { type: "manual", provider: "manual_entry", sourceRecordHash },
    userModified: true,
    createdAt: args.now,
    updatedAt: args.now
  };
}

function buildOpeningTransaction(args: { balance: ManualBalance; account: Account; now: string }): Transaction | undefined {
  const investedAmount = numberOrUndefined(args.balance.investedAmount);
  if (investedAmount === undefined || investedAmount <= 0) return undefined;
  const quantity = args.balance.quantity !== undefined && args.balance.quantity > 0 ? args.balance.quantity : undefined;
  const currency = args.balance.investedCurrency ?? args.balance.currency;
  const date = args.balance.investedAsOfDate ?? args.balance.asOfDate;
  const type = openingTransactionType(args.account.type);
  const sourceRecordHash = stableHash({ provider: "manual_entry_opening", balanceId: args.balance.id, investedAmount, currency, date, quantity });
  return {
    id: slugId("txn", [sourceRecordHash]),
    accountId: args.balance.accountId,
    instrumentId: args.balance.instrumentId!,
    date,
    type,
    quantity: quantity === undefined ? undefined : Math.abs(quantity),
    price: quantity === undefined ? undefined : investedAmount / Math.abs(quantity),
    amount: investedAmount,
    currency,
    fees: 0,
    taxes: 0,
    source: { type: "manual", provider: "manual_entry_opening", sourceRecordHash },
    userModified: true,
    createdAt: args.now,
    updatedAt: args.now
  };
}

function openingTransactionType(type: Account["type"]): Transaction["type"] {
  if (type === "mutual_fund" || type === "indian_stock" || type === "us_stock" || type === "gold") return "buy";
  if (type === "nps" || type === "epf") return "contribution";
  return "deposit";
}

function transactionsForBalance(backup: PortfolioBackup, balance: ManualBalance): Transaction[] {
  return backup.transactions.filter((tx) => tx.accountId === balance.accountId && (balance.instrumentId ? tx.instrumentId === balance.instrumentId : !tx.instrumentId));
}

function buildPriceSnapshot(instrumentId: string, price: number, currency: string, asOfDate: string, now: string): PriceSnapshot {
  return {
    id: slugId("price", [instrumentId, asOfDate, price, "manual_entry"]),
    instrumentId,
    price,
    currency,
    asOfDate,
    source: "manual_entry",
    createdAt: now
  };
}

function mergePriceSnapshot(existing: PriceSnapshot[], incoming: PriceSnapshot): PriceSnapshot[] {
  const withoutExisting = existing.filter((item) => !(item.instrumentId === incoming.instrumentId && item.asOfDate === incoming.asOfDate && item.source === incoming.source));
  return [...withoutExisting, incoming];
}

function quantityChange(action: ManualEntryAction, quantity: number | undefined): number | undefined {
  if (quantity === undefined || action.quantityDelta === "none" || action.quantityDelta === "set") return undefined;
  if (action.quantityDelta === "subtract") return -Math.abs(quantity);
  if (action.quantityDelta === "signed") return quantity;
  return Math.abs(quantity);
}

function valueChange(action: ManualEntryAction, amount: number): number {
  if (action.balanceDelta === "subtract") return -Math.abs(amount);
  if (action.balanceDelta === "add") return Math.abs(amount);
  return 0;
}

function isMarketLike(type: Account["type"]): boolean {
  return type === "mutual_fund" || type === "indian_stock" || type === "us_stock" || type === "nps" || type === "gold";
}

function numberOrUndefined(value: number | undefined): number | undefined {
  return value === undefined || Number.isNaN(value) || !Number.isFinite(value) ? undefined : value;
}

function numberOrZero(value: number | undefined): number {
  return value === undefined || Number.isNaN(value) || !Number.isFinite(value) ? 0 : value;
}

function mergeNotes(existing: string | undefined, incoming: string | undefined): string | undefined {
  const note = incoming?.trim();
  if (!note) return existing;
  return existing ? existing + " | Manual entry: " + note : "Manual entry: " + note;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 100000000) / 100000000;
}
