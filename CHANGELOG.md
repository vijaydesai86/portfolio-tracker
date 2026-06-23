# Changelog

All meaningful project changes are recorded here.

## 0.1.0 - Unreleased

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
