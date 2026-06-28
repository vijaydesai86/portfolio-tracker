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

- Canonical JSON backup and restore, including goals, asset-to-goal mappings, frozen portfolio snapshots, market data, and configurable tax assumptions as part of the complete restore file. Restoring a canonical JSON backup reproduces the exported state exactly without implicit market refresh; use the explicit Refresh button to update live market-linked holdings when NAV/quote/FX sources are available. Frozen snapshots remain unchanged and render from saved data only.
- Native import intake and provider detection for CAS PDF, Fidelity CSV, INDMoney exports, EPFO/PF, NPS, and PPF/SSY/FD statement families.
- CAS text parser and canonical normalization privately verified against the provided password-protected CAS PDF via local `pdftotext` extraction.
- Browser CAS PDF upload with password entry, staging, and commit flow privately verified against the provided password-protected CAS PDF via Selenium/Firefox.
- Browser INDMoney Transactions Ledger XLSX import for US stocks, dividends, taxes, stock splits, cash movements, open positions, and combined analytics.
- Browser EPFO/PF yearly PDF import for one or more yearly passbooks per batch, with employee and employer portfolio balance buckets, detailed monthly contribution rows when present, EPFO capitalized yearly interest accrual rows, and latest-closing-balance retention across reimports. EPS pension rows may be parsed from the passbook but are excluded from portfolio net worth because they are not a liquid PF corpus balance.
- Browser NPS yearly CSV statement import for one or more yearly CSVs per batch, retaining all scheme transactions and latest dated scheme balances/NAV snapshots across reimports. Subscriber-initiated scheme preference changes are treated as internal switches, not external cash out/in. NPS PDF/XLSX files remain detected-only until real fixtures are available.
- Live and historical market refresh route for Indian mutual fund NAV snapshots, US stock price snapshots, Indian stock price snapshots, latest USD/INR, and historical USD/INR for transaction-date conversion. USD/INR now uses reachable real-provider fallbacks; NAV and stock quote failures are surfaced in the UI instead of using fake fallback data.
- Tabbed analytics cockpit with Overview, Allocation, Returns, Risk, and History sections plus an Analytics Scope selector for Overall Portfolio, Combined Goals, and each individual goal; main KPIs for invested amount, current value, profit/loss, and XIRR; a scope-aware command insight deck for goal readiness, valuation quality, concentration, return engine, and allocation balance; supporting cash-flow analytics; native SVG month-end invested versus reconstructed current-value history from units and real dated NAV/quote/FX snapshots, with hover/focus tooltips showing all series values for each dated point; latest timeline value clamped to today and tied to the same current-holdings snapshot as dashboard totals; complete-valuation drilldowns by asset class, region, asset kind, and issuer; allocation, returns distribution, profit/loss contributors, best/worst XIRR review, concentration, currency exposure, source, and institution analytics. Allocation uses a dedicated donut chart with a center total and value legend, while dense ranking panels use HTML metric-row bars with visible values, percentages, and row-level colored fills instead of axis-heavy charts that can be misread as data rows.
- The loss watchlist is sign-strict: it only includes holdings with negative P/L, while low positive gains remain outside the loss panel.
- Separate Holdings, Transactions, and Add Entry workspaces. Holdings now has filtered summary metrics, top-holding/profit/XIRR charts with structured subtype tags, per-holding allocation, asset-class/subtype tags, invested amount, P/L, simple return, XIRR, search/sort, explicit edit mode, category overrides, quantity/price/value/invested edits, and per-holding conservative value taper controls. Tapering is a goal-planning overlay only: actual current value, price, tax, net worth, and market refresh remain true market/statement values. Transactions remain searchable with inline corrections and delete actions. Add Entry provides asset-specific forms for mutual funds, Indian/US stocks, NPS, PF/EPF, cash, PPF, SSY, FD, ESPP, gold, and other existing holdings; submitted entries write the same canonical transaction/balance records used by imports so analytics update immediately.
- Separate Tax workspace for Indian resident individual portfolio-tax estimates. It uses configurable regime, marginal slab, surcharge, and cess settings; reports FIFO realized capital gains, per-holding realized tax contribution, bucket-level loss set-off/exemption, grouped unrealized STCG/LTCG rough tax, FIFO-reachable loss-harvesting candidates, portfolio dividends/interest, foreign tax paid, surcharge/cess, and lot-level audit plus rule-trace tables showing FIFO source lot, FX formulas, bucket reason, gain, and tax formula; zero-value broker migration rows are ignored as taxable disposals; and it stays explicitly out of full ITR filing, salary, deductions, Form 16, and payroll ESPP perquisite calculations.
- Separate Data and Reconciliation workspace that audits import runs, source-ledger totals, validation checks, market-data gaps, market-data health by holding/FX pair, parser warnings, source value mix, and a dedicated Data Quality Matrix score before analytics are trusted. The Data Quality Matrix lives in Data, not the main Analytics cockpit. Responsive rendering is treated as part of correctness: charts, ranking rows, goal mappings, chevron disclosure controls for sections/subsections, heading hierarchy where section titles visually outrank nested subsection labels, and wide audit tables must remain usable across desktop, laptop, tablet, and mobile browser widths. Dense chart cards follow the Holdings workspace pattern by stacking before labels collide, and wide finance/audit tables keep numeric cells on one line inside their own scroll area instead of causing page-level overflow or broken digit stacks.
- Separate Settings workspace for user assumptions such as tax regime, slab, surcharge, cess, display-only USD-equivalent toggle, scenario assumptions, target allocation, and goal drawdown assumptions, stored inside the canonical JSON backup. USD equivalents are secondary cosmetic values from the latest stored real USD/INR snapshot and do not change INR math, tax, XIRR, imports, exports, or history.
- Separate Planning workspace for advisory analytics that must not mask factual portfolio math: scenario projection, stress impact, target-allocation drift, suggested rebalance actions, performance attribution, snapshot comparison, and goal corpus longevity/drawdown. Drawdown spend growth, horizon, and withdrawal timing are goal-level assumptions because each goal can behave differently; global Settings remain defaults for scenario/rebalance planning. These panels use existing canonical holdings, goals, market snapshots, and saved snapshots, but they remain planning overlays; they do not mutate imports, actual current value, tax, XIRR, cost basis, or frozen snapshot values.
- Separate Goals workspace for expense-driven planning. Goal inputs are entered from Add Entry, not CSV: goal name/type, current monthly expense, inflation assumption, target year, corpus multiple, and category return assumptions. Retirement defaults to a 35x first-year-expense corpus multiple; custom goals such as Bhoomi can use a 13x multiple. A top-level goal snapshot selector switches the visible goal analytics without scrolling, goal terms expose hover/focus explanations, a goal coverage matrix summarizes readiness by goal, and a separate asset-mapping panel assigns any holding percentage to one or more goals. Detailed goal analytics are shown from the main Analytics section by changing the scope to Combined Goals or a single goal; scoped analytics include funded status, corpus needed today, projected value, projected gap/surplus, mapped invested/P&L, actual mapped cash-flow XIRR, cash-flow coverage detail, mapped category split, allocation, issuer/source/region breakdowns, gain/loss contributors, and mapped-holding concentration.
- Implemented simple manual CSV import for three use cases: transaction CSVs for market-priced assets such as mutual funds, Indian stocks, US/Fidelity-style stocks, and gold units; balance CSVs for current manually valued assets; and a compact dated balance-ledger CSV for PPF, SSY, ESPP, and cash-style rows where `invest` adds invested/current value and `interest` adds current value only. Balance CSVs accept optional `invested_amount`, `invested_currency`, and `invested_as_of_date`; without those fields profit/return stay unavailable instead of being fabricated. Transaction CSVs derive open holdings from net quantity and use market refresh for current prices/FX when real data is available. Fidelity-style/manual US stock CSVs may use `price ($)` for buy/sell transaction prices and `USD-INR` for transaction-date FX; those CSV prices remain transaction facts, while current holding price/value comes from market refresh. Dashed numeric dates in manual/Fidelity transaction CSVs are interpreted as `DD-MM-YYYY`; slash dates keep the legacy template behavior used by older `M/D/YYYY` samples.
- Importable manual templates under `fixtures/importable/`, especially `manual-transactions-template.csv`, `manual-balances-template.csv`, and `manual-balance-ledger-sample.csv`, cover every requested asset class without committing fake market prices.
- Import pipeline with validation, deduplication, native CAS/IND/PF/NPS staged previews, manual CSV impact preview before commit, named import history, import deletion, review-oriented error reporting, commit history, and manual-edit preservation. Preview surfaces are additive review layers and do not mutate the portfolio until the user explicitly commits.
- Adaptive dashboard modules for future PF/EPF, PPF/SSY, NPS, FD, cash, ESPP, Indian stock, US stock, and mutual-fund inputs; empty modules stay visible as capability placeholders until data exists.
- Initial verified data-source work starts with the fixture manifest and source notes under `fixtures/`.
- Categories: `Equity`, `Debt`, `Gold`, `Others`, and `Cash`.

## Tax Estimates

Tax reporting is an estimate layer for a Resident Indian individual portfolio, not an ITR generator. The app calculates realized capital-gain lots using FIFO per account and instrument, classifies current portfolio income from transaction rows, shows foreign tax paid where the source ledger provides it, and applies configurable slab, surcharge, and cess assumptions from Settings. ESPP contribution balances remain simple portfolio balances; tax treatment for actual share purchases and sales is handled through the stock transaction lots the user imports or adds manually. Full salary income, deductions, Form 16, and ITR schedule preparation are intentionally outside the current scope.

## Data Reconciliation

The Data section is the trust layer for the portfolio. It reports import run counts, canonical record counts, source totals, market-data coverage gaps, per-holding/FX market-data health, validation checks, parser warnings, and a Data Quality Matrix covering market data, cost basis, XIRR coverage, and valuation freshness. A clean reconciliation report does not guarantee legal tax correctness, but it confirms that the app has finite values, usable transactions, and market data coverage for the analytics it renders.

## Snapshots

Snapshots are frozen portfolio archives stored inside the canonical JSON backup under `snapshots`. A snapshot captures the canonical records and computed analytics at that moment, including balances, transactions, prices, goals, goal mappings, performance, holdings, and timeline point data. Snapshot rendering must not call market-data refresh; restored snapshots must reproduce the saved values exactly. To build a multi-month history across browser sessions, restore the latest exported JSON first, take the next snapshot, then export JSON again. The Snapshots section builds frozen native SVG history charts from all saved snapshots in the restored JSON; even a single snapshot renders visible dots and values instead of an empty axis shell, and frozen ranking cards stay full-width so values remain visible. Snapshot comparison is a frozen comparison layer: it compares saved snapshot analytics only and must not fetch or recalculate current market prices while explaining past state.

## Goal Planning

Goals are first-class canonical records stored in JSON backup fields `goals` and `goalMappings`. No separate goal CSV is required. Add goals in the Goals section, map existing holdings by percentage, and export the JSON backup to preserve the goal definitions, assumptions, mappings, and all portfolio records in one restore file. Goal target corpus is calculated as inflated monthly expense at the goal year times 12 times the corpus multiple. Corpus needed today is calculated by discounting that future target corpus using the projected growth multiplier from the goal's mapped asset mix; without mapped assets, the goal equity-return assumption is used as the fallback discount rate. Goal projections use category assumptions: default Equity 10%, Debt 6%, Gold 6%, Cash 6%, and Others 6%, editable per goal. If a holding has a taper mode selected, goal mapped value and projection use the tracked value from the per-unit formula `tracked price = actual price / (1 + k * sqrt(actual price))`; no taper uses the actual value, and fixed assets without price/quantity fall back to actual value. Combined-goal analytics sum target corpus, required corpus today, mapped current value, projected value, mapped invested/P&L, and category split across every goal. If the combined mappings cover the full portfolio exactly once, Combined Goals XIRR uses the same portfolio-equivalent cash-flow basis as Overall Portfolio; otherwise scoped goals show explicit goal-weighted holding cash-flow XIRR.

## Performance Math

The dashboard headline model is invested, current value, profit/loss, and XIRR. Headline invested and P/L use the same remaining cost basis shown in Holdings so Overview and Holdings reconcile. Recorded cash in/out stays in supporting analytics and can differ from invested because it is transaction-ledger-only: balance-only manual files can provide cost basis without transaction rows, and trade imports can include sells, switches, fees, broker cash ledgers, and FX timing differences. For CAS mutual funds, parsed transactions are primary for units, remaining cost basis, cash flows, and XIRR; CAS `Total Cost Value` and closing units are validation/checkpoint values, not the normal reporting shortcut. Non-zero opening CAS units are represented as an explicit opening lot so later transaction math remains ledger-based. Current mutual-fund value comes from derived/statement units multiplied by the latest real NAV after market refresh. Partial sales reduce cost basis using FIFO lot reduction; holding returns are scoped by account plus instrument so the same ticker can exist in multiple brokers without contaminating cost basis; zero-amount broker migration rows do not add/remove cost basis; sale proceeds, dividends, withdrawals, and broker funding movements stay in supporting cash-flow analytics. For brokers with an explicit cash ledger such as INDMoney, portfolio cash-in/out and portfolio XIRR use external deposits/withdrawals and do not double-count the internal stock buy/sell trades funded by those deposits. For statements without a separate cash ledger, buys/SIPs/contributions and redemptions are treated as portfolio capital flows. Timeline charts sample historical month ends, never extend beyond today because of future-dated source rows, show today's current snapshot as a separate marker when it comes from the latest holdings snapshot rather than a continuous historical valuation line, and render breakdown history as unstacked value lines so every series shows its own actual value rather than stacked position. XIRR cash flows include buy-side fees/taxes as outflows and sell/income fees/taxes as reductions to inflows. If a balance-only asset provides current cost basis but no transaction history, invested/P&L can be shown but XIRR stays unavailable. If transaction history exists, XIRR is calculated from dated ledger cash flows plus terminal current value. Goal-scoped XIRR uses the tracked terminal value when tapering is active, while overall portfolio XIRR and tax calculations continue to use actual current value. Goal longevity/drawdown analytics are advisory projections from mapped corpus, goal-year corpus, per-goal annual spend growth, per-goal withdrawal timing, per-goal horizon, and category return assumptions; they show whether the mapped corpus lasts through the configured horizon without changing actual holdings or tax math.

## Asset Module Classification

Asset modules and asset-class subtypes are classified from structured account/instrument types such as `mutual_fund`, `indian_stock`, `us_stock`, `epf`, `ppf`, `ssy`, `nps`, `fd`, `cash`, and `espp`. The app must not infer PF, stocks, or other modules from free-text fund names. Equity NPS remains an `NPS` subtype, not `Direct stocks`; `Direct stocks` is reserved for structured Indian/US stock holdings.

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
CAS_PDF_PATH=/path/to/private-cas.pdf CAS_PDF_PASSWORD=your-password npm test -- tests/importers/cas-browser-private.test.ts
IND_XLSX_PATH=/path/to/private-indmoney.xlsx npm run test:ind:private
IND_XLSX_PATH=/path/to/private-indmoney.xlsx npm run test:ui:ind
PF_TEXT_PATH=/tmp/private-pf.txt NPS_CSV_PATH=/path/to/private-nps.csv npm run test:pf-nps:private
PF_TEXT_PATHS=/tmp/pf-2024.txt:/tmp/pf-2025.txt NPS_CSV_PATHS=/path/to/nps-24-25.csv:/path/to/nps-25-26.csv npm run test:pf-nps:private
PF_PDF_PATH=/path/to/private-pf.pdf NPS_CSV_PATH=/path/to/private-nps.csv npm run test:ui:pf-nps
PF_PDF_PATHS=/path/to/pf-2024.pdf:/path/to/pf-2025.pdf NPS_CSV_PATHS=/path/to/nps-24-25.csv:/path/to/nps-25-26.csv npm run test:ui:pf-nps
```

## Deployment

The app is designed for Vercel. Connect the repository to Vercel later and use the production branch `main`.
