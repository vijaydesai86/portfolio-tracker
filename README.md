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
- Browser EPFO/PF yearly PDF import for one or more yearly passbooks per batch, with employee, employer, and pension balance buckets, yearly contribution rows, EPFO capitalized yearly interest accrual rows, and latest-closing-balance retention across reimports.
- Browser NPS yearly CSV statement import for one or more yearly CSVs per batch, retaining all scheme transactions and latest dated scheme balances/NAV snapshots across reimports. NPS PDF/XLSX files remain detected-only until real fixtures are available.
- Live and historical market refresh route for Indian mutual fund NAV snapshots, US stock price snapshots, latest USD/INR, and historical USD/INR for transaction-date conversion. USD/INR now uses reachable real-provider fallbacks; NAV and stock quote failures are surfaced in the UI instead of using fake fallback data.
- Tabbed analytics cockpit with Overview, Allocation, Growth, and Risk sections; main KPIs for invested amount, current value, profit/loss, and XIRR; supporting cash-flow analytics; month-end invested versus reconstructed current-value history from units and real dated NAV/quote/FX snapshots; latest timeline value clamped to today and tied to the same current-holdings snapshot as dashboard totals; complete-valuation drilldowns by asset class, region, asset kind, and issuer; allocation, concentration, source, and institution analytics.
- The loss watchlist is sign-strict: it only includes holdings with negative P/L, while low positive gains remain outside the loss panel.
- Separate Holdings and Transactions workspaces. Holdings now has filtered summary metrics, top-holding/profit/XIRR charts, per-holding allocation, invested amount, P/L, simple return, XIRR, search/sort, explicit edit mode, category overrides, and quantity/price/value edits. Transactions remain searchable with inline corrections.
- Implemented manual CSV fallback for holdings, cash, simple ESPP contribution buckets, PPF, SSY, NPS, EPF, FD, gold, and other manual balances.
- Importable canonical CSV fallback templates under `fixtures/importable/` covering every requested asset class.
- Import pipeline with validation, deduplication, review-oriented error reporting, commit history, and manual-edit preservation.
- Adaptive dashboard modules for future PF/EPF, PPF/SSY, NPS, FD, cash, ESPP, Indian stock, US stock, and mutual-fund inputs; empty modules stay visible as capability placeholders until data exists.
- Initial verified data-source work starts with the fixture manifest and source notes under `fixtures/`.
- Categories: `Equity`, `Debt`, `Gold`, `Others`, and `Cash`.

## Performance Math

The dashboard does not treat lifetime cash in as the only invested number. Sells, redemptions, dividends, interest, maturities, and withdrawals reduce net invested for current profit/loss. The headline model is: invested, current value, profit/loss, and XIRR. Supporting cash-flow analytics show lifetime cash in, lifetime cash out, fees/taxes, and current P/L before fees. Timeline charts sample historical month ends, never extend beyond today because of future-dated source rows, and require the latest plotted current value to match the dashboard current value.

## Asset Module Classification

Asset modules are classified from structured account/instrument types such as `mutual_fund`, `indian_stock`, `us_stock`, `epf`, `ppf`, `ssy`, `nps`, `fd`, `cash`, and `espp`. The app must not infer PF, stocks, or other modules from free-text fund names.

## Import Support Policy

PF/NPS yearly files can be imported as batches by selecting multiple files from the same import family. File names are not part of the parser contract; the supported contract is the real statement format. Do not mix unrelated documents or different import families in one batch.

Automated provider parsing is not claimed without real, legally usable fixtures. Current parsing support is canonical JSON restore, the application-defined manual CSV fallback, browser CAS PDF import, browser INDMoney Transactions Ledger XLSX import, browser EPFO/PF yearly PDF import, and browser NPS yearly CSV statement import. Native file detection exists for Fidelity, NPS PDF/XLSX, FD, PPF, and SSY families so the app can route files correctly while provider parsers are added test-first.

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
PF_TEXT_PATH=/tmp/private-pf.txt NPS_CSV_PATH=/path/to/private-nps.csv npm run test:pf-nps:private
PF_TEXT_PATHS=/tmp/pf-2024.txt:/tmp/pf-2025.txt NPS_CSV_PATHS=/path/to/nps-24-25.csv:/path/to/nps-25-26.csv npm run test:pf-nps:private
PF_PDF_PATH=/path/to/private-pf.pdf NPS_CSV_PATH=/path/to/private-nps.csv npm run test:ui:pf-nps
PF_PDF_PATHS=/path/to/pf-2024.pdf:/path/to/pf-2025.pdf NPS_CSV_PATHS=/path/to/nps-24-25.csv:/path/to/nps-25-26.csv npm run test:ui:pf-nps
```

## Deployment

The app is designed for Vercel. Connect the repository to Vercel later and use the production branch `main`.
