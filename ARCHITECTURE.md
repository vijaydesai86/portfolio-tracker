# Architecture

## Principles

The application is local-first. Portfolio data is stored in browser storage and can be exported into one versioned canonical JSON file that restores the full app state.

External inputs are adapters. They do not own the domain model. Every upload is detected, parsed into staging records, validated, reviewed, and then committed into the canonical model.

## Canonical Model

- `accounts`: where assets are held.
- `instruments`: what assets are.
- `transactions`: money/quantity movements.
- `manualBalances`: balance-snapshot assets such as cash or simple ESPP contribution.
- `priceSnapshots`: NAVs, stock prices, FX rates, and manual valuations.
- `goals`: financial goals.
- `goalMappings`: asset-to-goal assignments.
- `imports`: import runs and status.
- `sourceDocuments`: uploaded file metadata.

## Import Flow

```text
Upload
-> Detect
-> Parse
-> Normalize
-> Stage
-> Validate
-> Review
-> Commit
```

## Data Integrity

Records include source metadata, stable IDs, timestamps, and user-modification flags. Reimport deduplication is based on deterministic source hashes and semantic transaction keys.

## Testing

Domain logic is tested independently from UI. Importers require fixtures and source notes. UI workflows use component tests and Selenium smoke tests.
