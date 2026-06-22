# Canonical JSON Format

The canonical backup file is the source of truth for full restore.

```json
{
  "schemaVersion": 1,
  "app": "portfolio-tracker",
  "exportedAt": "2026-06-22T00:00:00.000Z",
  "baseCurrency": "INR",
  "settings": {},
  "accounts": [],
  "instruments": [],
  "transactions": [],
  "manualBalances": [],
  "priceSnapshots": [],
  "goals": [],
  "goalMappings": [],
  "imports": [],
  "sourceDocuments": []
}
```

The schema is versioned. Future changes must include migration tests.


## Implemented Validation

The TypeScript/Zod schema validates schema version, base currency, accounts, instruments, transactions, manual balances, prices, goals, goal mappings, imports, and source documents. Unsupported schema versions are rejected.

## Linked Balances

Manual balance records may include optional `instrumentId`, `quantity`, and `price` fields. Importers use these fields for CAS mutual fund units and INDMoney US-stock shares so live NAV or quote refresh can update current value while preserving the canonical JSON backup as the source of truth.

Instrument records may include optional `issuer` metadata, populated from market data where available, for AMC/fund-house and issuer-level analytics.

## FX Snapshots

FX rates are stored as `priceSnapshots` where `instrumentId` is the currency pair, for example `USDINR`, and `currency` is the base currency `INR`. Current holding conversion uses the newest snapshot for the pair. Transaction analytics use the newest snapshot on or before the transaction date.
