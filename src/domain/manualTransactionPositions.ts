import { slugId, stableHash } from "@/src/domain/hash";
import type { Account, AssetCategory, ManualBalance, PortfolioBackup, Transaction } from "@/src/schema/backup";

const positionProviders = new Set(["manual_transactions", "zerodha_tradebook", "groww_stock_orders"]);
const derivedPositionProvider = "manual_positions";
const dynamicTypes = new Set<Account["type"]>(["mutual_fund", "indian_stock", "us_stock", "gold"]);
const cashInTypes = new Set<Transaction["type"]>(["buy", "sip", "switch_in", "contribution"]);
const lotOutTypes = new Set<Transaction["type"]>(["sell", "redemption", "switch_out", "withdrawal", "maturity"]);

type PositionSeed = {
  accountId: string;
  instrumentId: string;
  latestTransactionImportId?: string;
  latestTransactionDate: string;
  latestTransactionPrice?: number;
  latestTransactionPriceCurrency?: string;
  latestTransactionPriceDate?: string;
  quantity: number;
};

export function reconcileManualTransactionPositions(backup: PortfolioBackup, now = new Date().toISOString()): PortfolioBackup {
  const seeds = buildSeeds(backup);
  const existingByKey = new Map(
    backup.manualBalances
      .filter((balance) => balance.source.provider === derivedPositionProvider && balance.instrumentId)
      .map((balance) => [positionKey(balance.accountId, balance.instrumentId!), balance])
  );
  const reconciled: ManualBalance[] = [];

  for (const seed of seeds.values()) {
    const account = backup.accounts.find((item) => item.id === seed.accountId);
    const instrument = backup.instruments.find((item) => item.id === seed.instrumentId);
    if (!account || !instrument || !dynamicTypes.has(account.type)) continue;

    const quantity = roundQuantity(seed.quantity);
    if (quantity <= 0) continue;

    const existing = existingByKey.get(positionKey(seed.accountId, seed.instrumentId));
    const pricePoint = choosePrice(existing, seed, backup);
    if (!pricePoint) continue;

    const logicalKey = positionKey(seed.accountId, seed.instrumentId);
    const sourceRecordHash = stableHash({ provider: derivedPositionProvider, logicalKey });
    reconciled.push({
      id: existing?.id ?? slugId("bal", [derivedPositionProvider, logicalKey]),
      accountId: seed.accountId,
      instrumentId: seed.instrumentId,
      label: existing?.label ?? instrument.name,
      category: existing?.category ?? (instrument.category as AssetCategory),
      currency: pricePoint.currency,
      value: roundMoney(quantity * pricePoint.price),
      quantity,
      price: pricePoint.price,
      asOfDate: pricePoint.asOfDate,
      notes: existing?.notes ?? "Derived from manual transaction CSV. Market refresh replaces the latest transaction price when a real quote or NAV is available.",
      taperMode: existing?.taperMode,
      taperFactor: existing?.taperFactor,
      source: {
        type: "import",
        importId: seed.latestTransactionImportId ?? existing?.source.importId,
        provider: derivedPositionProvider,
        sourceRecordHash
      },
      userModified: existing?.userModified ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    });
  }

  return {
    ...backup,
    exportedAt: now,
    manualBalances: [
      ...backup.manualBalances.filter((balance) => balance.source.provider !== derivedPositionProvider),
      ...reconciled
    ]
  };
}

function buildSeeds(backup: PortfolioBackup): Map<string, PositionSeed> {
  const seeds = new Map<string, PositionSeed>();
  const transactions = backup.transactions
    .filter((tx) => tx.instrumentId && positionProviders.has(tx.source.provider ?? ""))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  for (const tx of transactions) {
    const key = positionKey(tx.accountId, tx.instrumentId!);
    const existing = seeds.get(key) ?? {
      accountId: tx.accountId,
      instrumentId: tx.instrumentId!,
      latestTransactionDate: tx.date,
      quantity: 0
    };
    existing.quantity += quantityDelta(tx);
    if (tx.price !== undefined && tx.price > 0 && isQuantityChanging(tx.type)) {
      existing.latestTransactionPrice = tx.price;
      existing.latestTransactionPriceCurrency = tx.currency;
      existing.latestTransactionPriceDate = tx.date;
    }
    if (tx.date >= existing.latestTransactionDate) {
      existing.latestTransactionDate = tx.date;
      existing.latestTransactionImportId = tx.source.importId ?? existing.latestTransactionImportId;
    }
    seeds.set(key, existing);
  }

  return seeds;
}

function choosePrice(existing: ManualBalance | undefined, seed: PositionSeed, backup: PortfolioBackup): { price: number; asOfDate: string; currency: string } | undefined {
  if (existing?.price !== undefined && existing.price > 0 && hasExternalPriceSnapshot(backup, seed.instrumentId, existing)) {
    return { price: existing.price, asOfDate: existing.asOfDate, currency: existing.currency };
  }
  if (seed.latestTransactionPrice !== undefined && seed.latestTransactionPrice > 0) {
    return { price: seed.latestTransactionPrice, asOfDate: seed.latestTransactionPriceDate ?? seed.latestTransactionDate, currency: seed.latestTransactionPriceCurrency ?? existing?.currency ?? "INR" };
  }
  if (existing?.price !== undefined && existing.price > 0) {
    return { price: existing.price, asOfDate: existing.asOfDate, currency: existing.currency };
  }
  return undefined;
}

function hasExternalPriceSnapshot(backup: PortfolioBackup, instrumentId: string, balance: ManualBalance): boolean {
  return backup.priceSnapshots.some((snapshot) =>
    snapshot.instrumentId === instrumentId &&
    snapshot.asOfDate === balance.asOfDate &&
    snapshot.price === balance.price &&
    snapshot.currency === balance.currency &&
    !snapshot.source.startsWith("manual_transactions")
  );
}

function quantityDelta(tx: Transaction): number {
  const quantity = Math.abs(tx.quantity ?? 0);
  if (cashInTypes.has(tx.type)) return quantity;
  if (lotOutTypes.has(tx.type)) return -quantity;
  if (tx.type === "split") return tx.quantity ?? 0;
  return 0;
}

function isQuantityChanging(type: Transaction["type"]): boolean {
  return cashInTypes.has(type) || lotOutTypes.has(type) || type === "split";
}

function positionKey(accountId: string, instrumentId: string): string {
  return accountId + "|" + instrumentId;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000000) / 1000000;
}
