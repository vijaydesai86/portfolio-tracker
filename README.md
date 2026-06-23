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
- Browser EPFO/PF yearly PDF import for one or more yearly passbooks per batch, with employee and employer portfolio balance buckets, detailed monthly contribution rows when present, EPFO capitalized yearly interest accrual rows, and latest-closing-balance retention across reimports. EPS pension rows may be parsed from the passbook but are excluded from portfolio net worth because they are not a liquid PF corpus balance.
- Browser NPS yearly CSV statement import for one or more yearly CSVs per batch, retaining all scheme transactions and latest dated scheme balances/NAV snapshots across reimports. Subscriber-initiated scheme preference changes are treated as internal switches, not external cash out/in. NPS PDF/XLSX files remain detected-only until real fixtures are available.
- Live and historical market refresh route for Indian mutual fund NAV snapshots, US stock price snapshots, Indian stock price snapshots, latest USD/INR, and historical USD/INR for transaction-date conversion. USD/INR now uses reachable real-provider fallbacks; NAV and stock quote failures are surfaced in the UI instead of using fake fallback data.
- Tabbed analytics cockpit with Overview, Allocation, Holdings, and History sections; main KPIs for invested amount, current value, profit/loss, and XIRR; supporting cash-flow analytics; month-end invested versus reconstructed current-value history from units and real dated NAV/quote/FX snapshots; latest timeline value clamped to today and tied to the same current-holdings snapshot as dashboard totals; complete-valuation drilldowns by asset class, region, asset kind, and issuer; allocation, concentration, source, and institution analytics.
- The loss watchlist is sign-strict: it only includes holdings with negative P/L, while low positive gains remain outside the loss panel.
- Separate Holdings and Transactions workspaces. Holdings now has filtered summary metrics, top-holding/profit/XIRR charts, per-holding allocation, invested amount, P/L, simple return, XIRR, search/sort, explicit edit mode, category overrides, and quantity/price/value/invested edits. Transactions remain searchable with inline corrections and delete actions.
- Implemented simple manual CSV import for two use cases: transaction CSVs for market-priced assets such as mutual funds, Indian stocks, US/Fidelity-style stocks, and gold units; and balance CSVs for cash, FD, ESPP contribution, PPF, SSY, NPS, EPF/PF, manually valued gold, and other assets. Balance CSVs accept optional `invested_amount`, `invested_currency`, and `invested_as_of_date`; without those fields profit/return stay unavailable instead of being fabricated. Transaction CSVs derive open holdings from net quantity and use market refresh for current prices/FX when real data is available.
- Importable manual templates under `fixtures/importable/`, especially `manual-transactions-template.csv` and `manual-balances-template.csv`, cover every requested asset class without committing fake market prices.
- Import pipeline with validation, deduplication, named import history, import deletion, review-oriented error reporting, commit history, and manual-edit preservation.
- Adaptive dashboard modules for future PF/EPF, PPF/SSY, NPS, FD, cash, ESPP, Indian stock, US stock, and mutual-fund inputs; empty modules stay visible as capability placeholders until data exists.
- Initial verified data-source work starts with the fixture manifest and source notes under `fixtures/`.
- Categories: `Equity`, `Debt`, `Gold`, `Others`, and `Cash`.

## Performance Math

The dashboard headline model is invested, current value, profit/loss, and XIRR. When transaction cash-flow data exists, headline invested means external capital in minus external capital out, so internal broker trades and NPS scheme switches do not distort portfolio-level P/L. Holding rows still show remaining cost basis for currently held units/balances. For CAS mutual funds, holding invested comes from the statement's authoritative `Total Cost Value` when present; current value comes from closing units multiplied by the latest real NAV after market refresh. Partial sales reduce cost basis using FIFO lot reduction; holding returns are scoped by account plus instrument so the same ticker can exist in multiple brokers without contaminating cost basis; zero-amount broker migration rows do not add/remove cost basis; sale proceeds, dividends, withdrawals, and broker funding movements stay in supporting cash-flow analytics. For brokers with an explicit cash ledger such as INDMoney, portfolio cash-in/out and portfolio XIRR use external deposits/withdrawals and do not double-count the internal stock buy/sell trades funded by those deposits. For statements without a separate cash ledger, buys/SIPs/contributions and redemptions are treated as portfolio capital flows. Timeline charts sample historical month ends, never extend beyond today because of future-dated source rows, and show today's current snapshot as a separate marker when it comes from the latest holdings snapshot rather than a continuous historical valuation line. XIRR cash flows include buy-side fees/taxes as outflows and sell/income fees/taxes as reductions to inflows. If a statement provides current cost basis but not complete acquisition cash flows, holding XIRR stays unavailable rather than using partial-history transactions.

## Asset Module Classification

Asset modules are classified from structured account/instrument types such as `mutual_fund`, `indian_stock`, `us_stock`, `epf`, `ppf`, `ssy`, `nps`, `fd`, `cash`, and `espp`. The app must not infer PF, stocks, or other modules from free-text fund names.

## Import Support Policy

PF/NPS yearly files can be imported as batches by selecting multiple files from the same import family. File names are not part of the parser contract; the supported contract is the real statement format. PF keeps employee/employer transactions from every imported year while the latest dated main passbook statement supplies current employee/employer portfolio balances; taxable-data subtables are not used as portfolio balances. EPS pension is parsed for audit context but excluded from portfolio value. NPS keeps scheme transactions from every imported year, but scheme preference changes are internal switches. Do not mix unrelated documents or different import families in one batch.

Automated provider parsing is not claimed without real, legally usable fixtures. Current parsing support is canonical JSON restore, the application-defined manual transactions CSV and manual balances CSV fallback, browser CAS PDF import, browser INDMoney Transactions Ledger XLSX import, browser EPFO/PF yearly PDF import, and browser NPS yearly CSV statement import. Native file detection exists for Fidelity, NPS PDF/XLSX, FD, PPF, and SSY families so the app can route files correctly while provider parsers are added test-first.

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
