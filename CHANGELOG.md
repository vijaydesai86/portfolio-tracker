# Changelog

All meaningful project changes are recorded here.

## 0.1.0 - Unreleased

- Fixed transaction deletion for Add Entry records so deleting a manually added transaction also reconciles the matching holding value/quantity instead of only changing invested/P&L math.

- Added a dedicated Add Entry workspace with asset-specific transaction/snapshot forms that write canonical manual-entry records, update holdings immediately, seed opening cost basis for balance-only assets when needed, and are covered by domain and Selenium browser tests.

- Reworked Holdings top charts into no-overlap ranking bars with fixed label/value columns, contrast-aware tracks, and responsive labels for long mutual-fund names.

- Fixed browser CAS PDF extraction so pdfjs-split transaction descriptions and unit-balance columns are rejoined before parsing, restoring complete CAS transaction/XIRR coverage in browser imports.

- Changed holding performance to derive cost basis and XIRR from transactions whenever transactions exist, using balance-level invested amounts only for balance-only fallbacks; CAS stamp duty now contributes to mutual-fund cost basis and CAS `Total Cost Value` is validated rather than used as the reporting shortcut.

- Fixed CAS XIRR coverage for hyphenated `Switch-In` and `Switch-Out` rows so switch transactions are included in mutual-fund cost and cash-flow reconstruction.

- Fixed EPFO/PF yearly parsing to select the main passbook closing balance instead of taxable-data subtables, and to include main passbook transfer-in rows as PF cost-basis contributions.

- Fixed headline portfolio invested/P&L to match holdings remaining cost basis, relabeled supporting cash-flow metrics as recorded transaction-ledger cash in/out, and added regression coverage so Overview reconciles with Holdings for CAS, IND, NPS, and manual imports.

- Fixed CAS mutual-fund invested/P&L calculations to use statement `Total Cost Value` as authoritative cost basis, and suppress holding XIRR when the CAS statement window lacks complete acquisition cash flows.

- Fixed PF portfolio valuation to exclude EPS pension from net worth and external cash-in while keeping employee/employer PF shares from the latest detailed closing balance.

- Fixed NPS scheme preference changes so internal reallocations are represented as switches instead of external cash out/cash in.

- Fixed holding-return scoping so the same instrument in different accounts/brokers does not share cost basis or XIRR cash flows.

- Fixed INDMoney zero-amount migration rows so they no longer erase holding cost basis or create zero-cost open holdings, with private workbook validation.

- Fixed EPFO/PF parsing to prefer detailed employee/employer/pension buckets, capture detailed monthly contribution rows, avoid future-dated closing balances by using the printed date when needed, and validate PF report math against the private yearly passbooks.

- Added private parser-to-report validation that independently recomputes remaining cost basis, P/L, simple return, and XIRR from real CAS, INDMoney, PF, and NPS fixture imports.

- Fixed portfolio cash-flow math so brokers with cash ledgers do not double-count deposits and internal stock buys/sells, changed holding invested/P&L to remaining cost basis with FIFO partial-sale reduction, and added regression tests for both cases.

- Extended manual balance CSVs with optional invested amount fields, stopped fabricating P/L for balance-only rows without cost basis, auto-refreshes FX after foreign-currency balance imports, and added named import deletion plus transaction deletion controls.

- Replaced the complex manual XLSX workbook surface with simple manual transactions and balances CSV templates; transaction CSVs now derive current holdings from net quantity, manual balance CSVs cover fixed/manual assets, and browser/manual import flows refresh real market data after transaction imports.

- Reworked dashboard hierarchy so current high-confidence analytics and allocation exploration lead the Overview while historical reconstruction charts move into a dedicated History tab with market-data coverage guidance.

- Added Indian stock quote refresh support through Yahoo NSE/BSE symbol lookup for manually imported Indian stock transactions.

- Changed timeline chart rendering so today's current holdings snapshot is shown as a separate marker instead of a misleading connected line segment from the last complete historical valuation point.

- Fixed portfolio timeline chart correctness by clamping timeline dates to today, forcing the latest plotted current value and breakdowns to match the dashboard current-holdings snapshot, normalizing invalid chart buckets, and replacing hard-truncated chart labels with readable finance aliases.

- Rebuilt the Holdings workspace with filtered summary metrics, top-holding/profit/XIRR charts, per-holding allocation, invested amount, P/L, simple return, XIRR, and richer responsive holding rows.

- Reworked bar-chart rendering into a vertical, color-coded dashboard chart with compact labels, top-value labels, richer spacing, and readable tooltips.

- Changed performance timeline rendering to month-end plus latest-date sampling, with carried-forward real prices converted using FX on the sampled valuation date so the latest graph point matches current INR value.

- Added historical market-data refresh for mutual-fund NAVs and US stock prices, then rebuilt timeline charts to reconstruct dated portfolio value from units, PF book value, NPS statement NAVs, and real FX/NAV/quote snapshots.

- Fixed performance timeline semantics so portfolio current value appears only on complete valuation dates, removed the misleading profit line from sparse growth charts, and relabeled breakdown charts around complete valuation history.

- Rebuilt dashboard analytics into tabbed Overview/Allocation/Growth/Risk sections with portfolio timeline charts and drilldowns by asset class, region, asset type, and issuer.

- Added multi-file yearly PF/NPS import handling that retains all yearly transactions while keeping latest dated closing balances.

- Fixed EPFO/PF parsing to capture capitalized yearly interest rows separately from contributions and closing balances.

- Fixed the dashboard loss watchlist so it only shows holdings with negative P/L instead of the lowest positive gains.

- Added browser EPFO/PF yearly PDF import and NPS yearly CSV statement import with canonical balances, transactions, private-file parser tests, and Selenium upload/commit smoke coverage.

- Refined dashboard KPI hierarchy so invested/current/profit stay primary, moved lifetime cash in/out and fees/taxes into supporting analytics, and fixed asset-module categorization to use structured account/instrument types instead of fragile name matching.

- Rebuilt the analytics page into a distinct wealth cockpit with dark navigation, command hero, performance bridge, portfolio signal panel, gain/loss contributor lists, adaptive asset modules for future PF/NPS/PPF/FD/cash/ESPP/Fidelity inputs, and corrected gross-cash-in vs net-invested profit terminology.

- Initialized project governance, package configuration, and test setup.
- Added canonical backup schema, manual CSV importer, import commit pipeline, and analytics tests.
- Added local-first dashboard with manual CSV import, JSON backup/restore, allocation, holdings, and import history.
- Added Selenium/Firefox smoke test for local UI verification.
- Added fixture source notes for manual template, CAS, Fidelity, EPFO, NPS, INDMoney, AMFI NAVAll, and FD/PPF/SSY research status.
- Added a fixture manifest and provider fixture audit to make unsupported provider imports explicit.
- Added tested importable canonical CSV templates for all requested asset classes.
- Added native import provider registry, source detection, and import UI status matrix.
- Added CAS text parser, canonical normalization, and optional private CAS fixture acceptance test.
- Added local CAS extraction script and private CAS verification npm scripts.
- Added browser CAS PDF upload, password extraction, staging, commit flow, tolerant missing-FX analytics, and Selenium CAS import smoke test.
- Added INDMoney XLSX browser import, private XLSX fixture test, Selenium import smoke test, linked quantity/price balances, XIRR analytics, grouped dashboard statistics, and live market-data refresh routes.
- Fixed INR-first multi-currency analytics: latest USD/INR converts current USD holdings, historical USD/INR converts USD transaction cash flows, and dashboard holdings show asset kind plus India/US region tags.
- Added real USD/INR provider fallbacks using Frankfurter, Open ER API, and currency-api, plus manual real-FX CSV import for blocked-source recovery and provider-specific market refresh errors.
- Revamped the app into an analytics-first portfolio dashboard with invested/current/profit/return/XIRR metrics, allocation and breakdown charts, separate Holdings and Transactions workspaces, explicit inline edit modes, and improved mutual-fund category inference.
