# Portfolio Tracker

Portfolio Tracker is a local-first multi-asset portfolio tracker and goal planner for Indian and US investors. It is designed to import real statement files where public, verified formats are available, normalize them into one canonical data model, and let users manually review, correct, export, and restore their data.

## Golden Rules

- No fake market data, fake statement formats, invented provider behavior, or training-data assumptions.
- Research comes before implementation for every importer and external data source.
- Every parser must be backed by real public samples, official documentation, verified open-source fixtures, or explicitly marked as template/manual-only.
- Tests are written before feature implementation. A new feature without tests is incomplete.
- Imports must stage data for review before committing to the portfolio.
- Unknown or low-confidence data must never be silently accepted.
- Manual edits must be preserved unless the user explicitly chooses to overwrite them.
- Documentation and `CHANGELOG.md` must be updated with every meaningful change.

## Current Scope

- Canonical JSON backup and restore.
- Native import intake and provider detection for CAS PDF, Fidelity CSV, INDMoney exports, EPFO/PF, NPS, and PPF/SSY/FD statement families.
- CAS text parser and canonical normalization privately verified against the provided password-protected CAS PDF via local `pdftotext` extraction.
- Browser CAS PDF upload with password entry, staging, and commit flow privately verified against the provided password-protected CAS PDF via Selenium/Firefox.
- Browser INDMoney Transactions Ledger XLSX import for US stocks, dividends, taxes, stock splits, cash movements, open positions, and combined analytics.
- Live market refresh route for AMFI mutual fund NAVs, US stock quotes, latest USD/INR, and historical USD/INR for transaction-date conversion. USD/INR now uses reachable real-provider fallbacks; NAV and stock quote failures are surfaced in the UI instead of using fake fallback data.
- Analytics-first dashboard with invested amount, current value, current profit/loss, absolute return, INR XIRR with historical FX, returned cash, fees/tax, allocation charts, concentration, asset-kind totals, India/US totals, source totals, and institution/AMC-style totals.
- Separate Holdings and Transactions workspaces with search, sorting, explicit edit mode, inline editing, category overrides, quantity/price/value edits, and transaction corrections.
- Implemented manual CSV fallback for holdings, cash, simple ESPP contribution buckets, PPF, SSY, NPS, EPF, FD, gold, and other manual balances.
- Importable canonical CSV fallback templates under `fixtures/importable/` covering every requested asset class.
- Import pipeline with validation, deduplication, review-oriented error reporting, commit history, and manual-edit preservation.
- Dashboard with net worth, allocation, holdings, import history, and JSON backup/restore.
- Initial verified data-source work starts with the fixture manifest and source notes under `fixtures/`.
- Categories: `Equity`, `Debt`, `Gold`, `Others`, and `Cash`.

## Import Support Policy

Automated provider parsing is not claimed without real, legally usable fixtures. Current parsing support is canonical JSON restore, the application-defined manual CSV fallback, browser CAS PDF import, and browser INDMoney Transactions Ledger XLSX import. Native file detection exists for Fidelity, EPFO, NPS, FD, PPF, and SSY families so the app can route files correctly while provider parsers are added test-first.

See `fixtures/MANIFEST.md` for the exact list of committed importable files and `fixtures/PROVIDER_FIXTURE_AUDIT.md` for the provider fixture search log.

## Local Setup

The project uses npm with the Yarn registry because `registry.npmjs.org` is not reachable in the current environment.

```bash
npm install
npm run dev
```

Useful tool modules in this environment:

```bash
module load nodejs/node/22.18.0
module load python/python/3.14.0
module load qpdf/qpdf/10.0.2
module load mozilla/firefox/146.0.1
module load mozilla/geckodriver/0.35.0
```

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run test:ui
CAS_PASSWORD=your-password npm run test:ui:cas
IND_XLSX_PATH=/path/to/private-indmoney.xlsx npm run test:ind:private
IND_XLSX_PATH=/path/to/private-indmoney.xlsx npm run test:ui:ind
```

## Deployment

The app is designed for Vercel. Connect the repository to Vercel later and use the production branch `main`.
