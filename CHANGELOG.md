# Changelog

All meaningful project changes are recorded here.

## 0.1.0 - Unreleased

- Added a Planning workspace with JSON-persisted scenario assumptions, stress projection, target-allocation drift, rebalance suggestions, performance attribution, snapshot comparison, and goal corpus longevity/drawdown analytics; refined drawdown into per-goal spend-growth/horizon/withdrawal assumptions, made holding details expand inline below the selected row, tightened native timeline tick sampling, and added real-browser Selenium coverage for responsive planning, holding detail drilldowns, snapshot comparison, settings persistence, and exported planning assumptions.

- Added staged native import previews for CAS, INDMoney, PF, and NPS batches plus a holding detail drawer for per-holding transactions, goal mappings, and tax lots without changing committed portfolio math before user confirmation.

- Restructured the Analytics cockpit into Overview, Allocation, Returns, Risk, and History tabs; moved asset-class deep dives into Allocation; added scope-aware returns/risk panels, a Goals coverage matrix, a Data-section-only Data Quality Matrix, and an optional JSON-persisted display-only USD-equivalent toggle backed by real stored USD/INR snapshots; extended domain and Selenium real-browser coverage for these changes.

- Fixed Manual CSV Preview rendering so metric tiles and preview tables stay contained inside the Imports card with internal scrolling across responsive widths; added Selenium coverage for the exact overflow case.

- Added manual CSV import preview before commit, tax rule trace audit rows with FIFO/FX/formula explanations, and market-data health coverage in the Data workspace; extended unit, build, and real-browser Selenium coverage for these trust-layer improvements.

- Fixed scoped Asset Classes command metric contrast so values, labels, and details remain readable on the hero panel across overall and goal-scoped analytics; added real-browser contrast assertions for these metric tiles.

- Improved workspace hierarchy and navigation by adding default-expanded chevron disclosure controls across pages and analytics subsections, stronger heading/subheading typography where section names visually outrank nested subsection names, goal metric tooltip explanations, and real-browser Selenium assertions for icon-only disclosure behavior and heading visibility.

- Added per-holding conservative value taper controls for goal planning, with no/light/medium/strong/custom factors using the tracked-price formula while preserving actual portfolio value, tax value, and market refresh behavior; added domain and Selenium coverage for taper persistence, goal projection, JSON export/restore, refresh, and responsive Goals rendering.

- Changed canonical JSON restore to reproduce the exported portfolio state exactly without implicit market refresh; users now press Refresh explicitly to update live NAV/quote/FX values after restore, and Selenium verifies both static restore and explicit refresh.

- Hardened chart and finance-table rendering across analytics, goals, snapshots, tax, and data workspaces by applying the Holdings-style stacked layout model, keeping numeric tax/audit cells on one line inside contained scrollers, clarifying tax set-off column labels, and adding real-browser assertions for cramped cards and unreadable tables.

- Fixed Refresh status so explicit market refresh reports how many current holding valuations changed while frozen portfolio snapshots remain unchanged.

- Fixed Fidelity/manual transaction CSV dashed numeric dates to parse as `DD-MM-YYYY`, so rows such as `01-06-2026` are treated as 1 June 2026, not 6 January 2026.

- Hardened responsive rendering for goal mappings and tax/data audit tables, added laptop viewport coverage to the real Selenium browser smoke test, and added a browser restore-refresh flow with deterministic market data assertions.

- Corrected loss-harvesting tax planning to use only FIFO-reachable sale prefixes; later loss lots are no longer shown as harvestable when older gain lots must be sold first.

- Reworked the Tax workspace into an auditable per-holding view: zero-value broker migration rows are ignored as taxable disposals, realized sales are summarized by holding and tax bucket with gross and allocated tax estimates, unrealized lots are grouped by STCG/LTCG bucket with rough potential tax, and explanatory notes clarify set-off, income, and loss-harvesting sections.

- Added an Indian resident individual portfolio Tax workspace with configurable regime, slab, surcharge, and cess settings; FIFO realized-lot audit; capital-gains and portfolio-income estimates; unrealized gain/loss review; and JSON-persisted tax assumptions.

- Added a Data and Reconciliation workspace that audits committed imports, source totals, market-data gaps, validation checks, and source-ledger totals before analytics are trusted.

- Expanded Selenium browser smoke coverage across Tax, Data, and Settings views with responsive overflow checks so chart rows, audit tables, and navigation cannot silently regress visually.

- Made frozen snapshot ranking cards full-width so values and bars stay visible, and added native timeline hover/focus tooltips that show all series values for the selected date across history and snapshot charts.

- Reworked History and Snapshot timelines to deterministic native SVG line/dot charts, removed the redundant Analytics Holdings tab in favor of the dedicated Holdings workspace, widened ranking rows for readable holding names, and broadened Selenium visual checks across donut, bar, ranking, history, and snapshot chart families.

- Fixed Asset Classes subtype classification so NPS equity schemes remain `NPS` and are not counted under `Direct stocks`; direct-stock subtype totals now reconcile with the global Stock asset-type chart.

- Restored Allocation Map as a dedicated visible donut chart with center total and value legend, made asset-class subtype rows use explicit labels such as `Direct stocks`, added a top-level goal snapshot selector, and extended Selenium visual smoke tests to catch invisible donuts, missing subtype labels, and missing goal selection controls.

- Strengthened allocation and ranking chart rows with row-level colored fills so they read as visible graphs, not plain text tables; Selenium now verifies visible non-transparent bar fills in the real browser.

- Replaced dense SVG bar charts in allocation and ranking panels with readable metric-row bars, removed fake `0/max` axis rows from asset-class and holding reports, fixed subtype split tags, and added Selenium assertions so chart rows cannot regress into misleading rendered content.

- Added a scope-aware command insight deck to Analytics Overview with goal readiness, valuation quality, concentration, return engine, and allocation-balance cards; refined chart legends/ticks so dense finance graphs render with clearer labels and less visual collision.

- Added a scoped Asset Classes analytics section with Equity/Debt/Cash/Gold subtype splits, top holdings, profit drivers, return metrics, and XIRR coverage; added structured subtype tags such as Direct/MF/EPF/PPF/SSY beside class tags in Holdings and ranking charts; moved new-goal creation into Add Entry; changed history and snapshot breakdown charts from stacked areas to unstacked value lines.

- Fixed goal-scoped Analytics XIRR so full-portfolio Combined Goals uses the same portfolio-equivalent cash-flow basis as Overall Portfolio, while partial goals remain explicitly goal-weighted holding cash-flow returns; mapped holding cash-flow coverage is now only supporting detail.

- Made the main Analytics cockpit goal-aware with an explicit scope selector for Overall Portfolio, Combined Goals, and each individual goal; removed the misleading separate goal analytics widget and fixed combined-goal charts so they no longer imply an incorrect arithmetic total.

- Added frozen portfolio snapshots with snapshot capture, JSON export/restore persistence, no-market-fetch frozen reports, snapshot-history charts for portfolio/allocation/goals, and Selenium coverage for browser capture plus restore.

- Expanded Goals with detailed goal analytics covering combined-plan analytics, selected-goal funding metrics, category projection, mapped-holding rankings, profit contributors, and mapped cash-flow XIRR.

- Added a separate Goals workspace with UI-created expense-driven goals, retirement/custom corpus multiples, per-category return assumptions, corpus-needed-today analytics, combined-goal analytics, per-goal mapped invested/P&L and mapped XIRR, asset-to-goal percentage mapping, and JSON export/restore round-trip coverage for goals and mappings.

- Added Fidelity-style manual US stock CSV support for `price ($)` and `USD-INR`, preserving CSV buy/sell prices as transaction facts while using market refresh only for current holding valuation; sanitized committed manual sample fixtures to synthetic values.

- Added compact manual balance-ledger CSV support and a committed PPF/SSY/ESPP/Cash sample file where dated `invest` rows affect invested/current value and `interest` rows affect current value only.

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
