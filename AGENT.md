# Agent Instructions

This file is machine-readable operating guidance for AI coding agents working on this repository.

## Non-Negotiable Rules

- Never invent financial data, statement formats, provider behavior, or market prices.
- Never treat model memory or training data as proof. Verify with official docs, public samples, real fixtures, or clearly documented open-source fixtures.
- Use test-driven development: write failing tests first, implement, then make tests pass.
- Every new feature must include tests covering normal, edge, and failure paths.
- Update `README.md`, `CHANGELOG.md`, and relevant docs in the same change as meaningful behavior changes.
- Preserve user/manual edits during reimports unless the user explicitly chooses overwrite.
- Do not silently accept uncertain imported data. Stage it and require review.
- Keep the canonical JSON backup format versioned and migration-friendly.

## Preferred Commands

```bash
npm install
npm run typecheck
npm test
npm run build
npm run test:ui
CAS_PASSWORD=your-password npm run test:ui:cas
PF_TEXT_PATH=/tmp/private-pf.txt NPS_CSV_PATH=/path/to/private-nps.csv npm run test:pf-nps:private
PF_PDF_PATH=/path/to/private-pf.pdf NPS_CSV_PATH=/path/to/private-nps.csv npm run test:ui:pf-nps
```

## Environment Notes

- Use `registry=https://registry.yarnpkg.com` from `.npmrc`.
- Playwright browser downloads are blocked in this environment.
- Use Selenium with `/arm/tools/mozilla/firefox/146.0.1/linux64/firefox/firefox` and `/arm/tools/mozilla/geckodriver/0.35.0/linux64/geckodriver` for browser checks.

## Importer Requirements

For each importer, document:

- Provider/source.
- File type.
- Fixture source and license/usage notes.
- Confidence level.
- Parsed fields.
- Known gaps.
- Tests.

If no real public sample exists, implement only the manual/template path and mark automated import as unsupported.

Current automated CAS support includes browser PDF upload, password entry, client-side PDF text extraction, staged review, and commit to the canonical backup. The private raw PDF and extracted text must never be committed.

## Fixture Audit Files

- `fixtures/MANIFEST.md` lists importable fixtures and research-only folders.
- `fixtures/PROVIDER_FIXTURE_AUDIT.md` records public fixture search evidence.
- Do not downgrade a research-only provider to supported without adding the fixture, source note, parser tests, and documentation in the same change.

## Current Implemented Importers

- CAS PDF browser import is implemented and private-file verified.
- INDMoney Transactions Ledger XLSX browser import is implemented and private-file verified.
- EPFO/PF yearly PDF browser import is implemented and private-file verified. The private raw PDF and extracted text must never be committed.
- NPS yearly CSV statement browser import is implemented and private-file verified. NPS PDF/XLSX remains detected-only until real fixtures are available.
- Live market refresh uses AMFI NAVAll for mutual funds, Stooq/Yahoo for US stock quotes, and Frankfurter/Open ER API/currency-api/Stooq for USD/INR. Never replace failed market fetches with fabricated fallback prices; manual FX import must be user-supplied real data.

## INR-First Analytics Rule

The app is INR-first. Current foreign-currency holdings require latest FX. Foreign-currency transaction analytics require FX on or before each transaction date. Do not mix local currency values into INR totals without an FX snapshot, and do not fabricate missing FX.

## Portfolio Analytics Rule

- Dashboard profit labels must distinguish lifetime cash in, lifetime cash out, net invested, current P/L, fees/tax, total P/L, and XIRR. Main analytics should keep invested, current value, and profit/loss primary; supporting cash-flow analytics can show cash in/out and fees/taxes.
- New analytics panels must remain adaptive to future asset modules: PF/EPF, PPF/SSY, NPS, FD, cash, ESPP, Indian stocks, US stocks, and mutual funds.

- Asset modules must be classified from structured account/instrument types, never from free-text fund or provider names.
- Performance panels must be semantically strict: a loss watchlist must filter to negative P/L only and must not show low positive gains as losses.
- PF interest credited inside the account is capitalized interest, not cash returned to the user. Represent it without changing invested cash-flow totals or double-counting profit.
- PF/NPS yearly imports must retain all transactions from every imported year while keeping current balances from the latest statement date only. Do not depend on private filenames; parse by verified statement format.
- Keep PF categorized as Debt and NPS categorized from explicit scheme type: E as Equity, C/G as Debt, A as Others.
- Timeline current-value charts must not fabricate historical prices. Use imported statement balances, real price/NAV snapshots, and transaction units only; show invested flow even when historical current value is unavailable.
