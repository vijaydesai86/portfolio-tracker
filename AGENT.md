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
- Live market refresh uses AMFI NAVAll for mutual funds, Stooq/Yahoo for US stock quotes, Yahoo NSE/BSE lookup for Indian stock quotes, and Frankfurter/Open ER API/currency-api/Stooq for USD/INR. Never replace failed market fetches with fabricated fallback prices; manual FX must be user-supplied real data.
- Manual CSV import is implemented for `manual-transactions-template.csv` and `manual-balances-template.csv`. Do not ask users to maintain FX in normal manual files; dynamic market assets should use transaction facts, while fixed/manual assets should use current balances. Balance rows may include optional `invested_amount`, `invested_currency`, and `invested_as_of_date`; if absent, invested/P&L/XIRR must remain unavailable instead of treating current value as profit.

## INR-First Analytics Rule

The app is INR-first. Current foreign-currency holdings require latest FX. Foreign-currency transaction analytics require FX on or before each transaction date. Do not mix local currency values into INR totals without an FX snapshot, and do not fabricate missing FX.

## Portfolio Analytics Rule

- CAS mutual fund holdings must use `Total Cost Value` as authoritative invested cost when present. If that cost does not reconcile with parsed statement-window transactions, suppress holding XIRR because the cash-flow history is incomplete.
- Dashboard profit labels must distinguish external cash in, external cash out, remaining cost basis, current P/L, fees/tax, total P/L, and XIRR. Portfolio XIRR cash flows must not double-count broker cash-ledger deposits and the security trades funded by those deposits. For brokers with explicit cash ledgers, use external deposits/withdrawals for portfolio-level flows and keep buys/sells as internal trades for cost basis. Holding return calculations must be scoped by account plus instrument; the same ticker/fund in two brokers/accounts must not share lots or XIRR cash flows. Zero-amount broker migration rows must not add or remove cost basis or XIRR cash flows. For statements without separate cash ledgers, buys/SIPs/contributions and redemptions are portfolio capital flows. Holdings analytics should show per-holding allocation, remaining cost basis, P/L, simple return, and XIRR when transaction history and FX support it.
- New analytics panels must remain adaptive to future asset modules: PF/EPF, PPF/SSY, NPS, FD, cash, ESPP, Indian stocks, US stocks, and mutual funds.

- Asset modules must be classified from structured account/instrument types, never from free-text fund or provider names.
- Performance panels must be semantically strict: a loss watchlist must filter to negative P/L only and must not show low positive gains as losses.
- PF interest credited inside the account is capitalized interest, not cash returned to the user. Represent it without changing invested cash-flow totals or double-counting profit.
- PF/NPS yearly imports must retain all transactions from every imported year while keeping current balances from the latest statement date only. PF parsing must prefer the detailed employee/employer/pension table over any combined summary table and must use detailed monthly contribution rows when the statement provides them. PF portfolio value must include employee and employer shares only; EPS pension may be parsed but must not be counted in net worth or external cash-in. Do not depend on private filenames; parse by verified statement format.
- Keep PF categorized as Debt and NPS categorized from explicit scheme type: E as Equity, C/G as Debt, A as Others. NPS subscriber scheme preference changes must be represented as `switch_in`/`switch_out`, not external contributions/redemptions.
- Private validation tests must include an independent parser-to-report math audit for remaining cost basis, P/L, simple return, and XIRR when real private fixtures are available. The audit must respect authoritative balance-level invested amounts such as CAS `Total Cost Value` and must not reconstruct invested from partial transaction windows.
- Timeline current-value charts must not fabricate historical prices. Use imported statement balances, real price/NAV snapshots, and transaction units only; show invested flow even when historical current value is unavailable. Timeline axes must be clamped to today. If today is a holdings snapshot rather than a continuous reconstructed valuation point, render it as a separate snapshot marker instead of connecting it as a fake line segment.
- Portfolio timeline current value must be reconstructed from units held on sampled month-end/latest dates, capitalized PF transactions/interest, NPS statement NAV snapshots, and real historical NAV/quote/FX snapshots. Plot current value and breakdowns only on complete valuation dates where every active holding has a value. For foreign assets, convert local value using FX on the sampled valuation date, not the stale quote date.
