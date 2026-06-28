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
- Goals, goal mappings, snapshots, and settings are part of the canonical JSON snapshot and must round-trip through browser export/restore tests when changed.

## Preferred Commands

```bash
npm install
npm run typecheck
npm test
npm run build
npm run test:ui
CAS_PASSWORD=your-password npm run test:ui:cas
CAS_PDF_PATH=/path/to/private-cas.pdf CAS_PDF_PASSWORD=your-password npm test -- tests/importers/cas-browser-private.test.ts
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
- Live market refresh uses AMFI NAVAll for mutual funds, Stooq/Yahoo for US stock quotes, Yahoo NSE/BSE lookup for Indian stock quotes, and Frankfurter/Open ER API/currency-api/Stooq for USD/INR. Canonical JSON restore must reproduce the exported state exactly and must not call market refresh implicitly; the explicit Refresh button updates live market-linked holdings when possible. Frozen portfolio snapshots must remain static. Never replace failed market fetches with fabricated fallback prices; manual FX must be user-supplied real data.
- Manual CSV import is implemented for `manual-transactions-template.csv`, `manual-balances-template.csv`, and compact manual balance-ledger files such as `manual-balance-ledger-sample.csv`. Do not ask users to maintain FX in normal manual files; dynamic market assets should use transaction facts, while fixed/manual assets should use current balances or dated ledger facts. Balance rows may include optional `invested_amount`, `invested_currency`, and `invested_as_of_date`; if absent, invested/P&L/XIRR must remain unavailable instead of treating current value as profit. In compact balance ledgers, `invest` adds invested/current value and `interest` adds current value only. For manual/Fidelity transaction CSVs, dashed numeric dates are day-first (`DD-MM-YYYY`); do not pass ambiguous dashed numeric dates to `Date.parse`.
- Add Entry must stay asset-specific, not a generic notes form. It must write canonical transactions, balance snapshots, and price snapshots in the same schema as imports. If the first manual transaction is added to a balance-only holding with user-provided invested amount, preserve that opening cost basis as an explicit manual opening transaction so invested/P&L do not reset.

## Tax Estimate Rule

- Tax is currently an estimate layer for a Resident Indian individual portfolio, not a full ITR generator. Keep salary, deductions, Form 16, and payroll ESPP perquisite treatment outside scope unless explicitly added test-first.
- Tax profile assumptions such as regime, slab, surcharge, and cess must be configurable and persisted in canonical JSON settings.
- Realized capital gains must be derived from canonical transaction lots using FIFO per account and instrument; do not derive tax from displayed P/L shortcuts. Zero-amount broker migration rows must not create taxable disposals or artificial zero-cost gains. Per-holding tax views must show gross tax before set-off and allocated tax after bucket-level set-off/exemption where possible. Loss-harvesting candidates must be based on an actual FIFO sale simulation from the front of the open lot queue; do not show later loss lots as harvestable when older gain lots block them.
- Foreign-currency tax calculations must use transaction-date FX when available and surface missing-FX notes instead of fabricating rates.
- Add or change tax rules only after checking current official/reliable tax references and adding regression tests for the rule.

## Data Reconciliation Rule

- Data and Reconciliation is the trust layer. It must surface import counts, source totals, validation checks, parser warnings, and market-data gaps.
- Do not hide uncertain data quality behind clean UI. If finite values, FX, prices, NAVs, or parser confidence are missing, report it explicitly.
- Browser smoke must cover Tax, Data, Settings, core analytics, holdings, goals, snapshots, JSON exact restore plus explicit refresh, responsive layouts at desktop/laptop/tablet/mobile representative widths, visible charts, default-expanded chevron disclosure controls for sections and subsections with no visible Expand/Collapse text pills, clear heading hierarchy where section titles visually outrank nested subsection labels, goal term hover/focus explanations, no fake axis rows, no chart/table page overflow, contained scrolling for wide tables, non-wrapping numeric finance cells, no cramped/escaping cards, and native tooltip behavior.

## INR-First Analytics Rule

The app is INR-first. Current foreign-currency holdings require latest FX. Foreign-currency transaction analytics require FX on or before each transaction date. Do not mix local currency values into INR totals without an FX snapshot, and do not fabricate missing FX.

## Portfolio Analytics Rule

- CAS mutual fund holdings must derive units, remaining cost basis, P/L, and XIRR from parsed ledger transactions whenever transactions exist. CAS `Total Cost Value` and closing units are validation/checkpoint targets; non-zero opening units must be represented as explicit opening lots. Browser-path CAS PDF extraction must be tested with `tests/importers/cas-browser-private.test.ts` when a private PDF is available.
- Dashboard profit labels must distinguish external cash in, external cash out, headline invested capital, remaining cost basis, current P/L, fees/tax, total P/L, and XIRR. Headline invested/P&L must match holdings remaining cost basis; external cash-in/out must remain supporting cash-flow analytics and must not replace headline invested. Portfolio XIRR cash flows must not double-count broker cash-ledger deposits and the security trades funded by those deposits. For brokers with explicit cash ledgers, use external deposits/withdrawals for portfolio-level flows and keep buys/sells as internal trades for cost basis. Holding return calculations must be scoped by account plus instrument; the same ticker/fund in two brokers/accounts must not share lots or XIRR cash flows. Zero-amount broker migration rows must not add or remove cost basis or XIRR cash flows. For statements without separate cash ledgers, buys/SIPs/contributions and redemptions are portfolio capital flows. Holdings analytics should show per-holding allocation, remaining cost basis, P/L, simple return, and XIRR when transaction history and FX support it.
- New analytics panels must remain adaptive to future asset modules: PF/EPF, PPF/SSY, NPS, FD, cash, ESPP, Indian stocks, US stocks, and mutual funds. Asset-class analytics and command-center insight cards must be scope-aware, decision-oriented, and use structured subtype labels from account/instrument type, never free-text fund names. Chart improvements must reduce ambiguity and label collisions without using decorative or misleading visuals. Allocation Map must remain a real visible donut/pie visualization with readable legends, not an empty-looking text block. Asset-class subtype rows must use semantic labels such as `Direct stocks`, `Equity MF`, `Debt MF`, `NPS`, `EPF`, `PPF`, and `SSY`; a rank number alone is a rendering failure. `Direct stocks` must only include structured Indian/US stock holdings, never NPS equity schemes or ESPP. Ranking/allocation visuals must not render chart axes as data rows; browser smoke should catch fake `0/max` rows, invisible donut sectors, missing subtype labels, invisible bar fills, chart-row overlap, hidden frozen ranking values, cramped ranking rows on laptop/tablet/mobile widths, missing native timeline tooltips, invisible native timeline paths/dots, and stacked-area timeline regressions.
- Goal planning must stay in a separate Goals workspace with an immediately visible goal snapshot selector, bold primary goal terms, and hover/focus explanations for target corpus, corpus needed today, mapped now, and projected at goal. Goal inputs are UI records, not required CSV uploads; asset-to-goal mapping must be explicit and percentage based. Goal-scoped Analytics must show actual XIRR as the headline metric; when the mapped goal scope covers the full portfolio exactly once and no mapped holding uses tapering, it must match Overall Portfolio XIRR by using portfolio-equivalent cash-flow rules. Partial or tapered goals may use explicit goal-weighted holding cash-flow XIRR. Coverage counts are supporting detail only. Per-holding tapering is a conservative planning overlay: it may affect goal mapped/projected values and goal terminal XIRR, but it must not change actual portfolio net worth, holding actual value, tax calculations, imports, market prices, or explicit Refresh behavior. Taper-only edits must not mark an imported holding as user-modified in a way that blocks market refresh.

- Asset modules must be classified from structured account/instrument types, never from free-text fund or provider names.
- Performance panels must be semantically strict: a loss watchlist must filter to negative P/L only and must not show low positive gains as losses. Historical/snapshot breakdown charts must not use stacked lines/areas when the user needs to compare actual series values, and must render visible paths or dots in the real browser rather than only legends/axes.
- PF interest credited inside the account is capitalized interest, not cash returned to the user. Represent it without changing invested cash-flow totals or double-counting profit.
- PF/NPS yearly imports must retain all transactions from every imported year while keeping current balances from the latest statement date only. PF parsing must prefer the main EPF passbook closing balance over taxable-data subtables and must use detailed monthly contribution and transfer-in rows when the statement provides them. PF portfolio value must include employee and employer shares only; EPS pension may be parsed but must not be counted in net worth or external cash-in. Do not depend on private filenames; parse by verified statement format.
- Keep PF categorized as Debt and NPS categorized from explicit scheme type: E as Equity, C/G as Debt, A as Others. NPS subscriber scheme preference changes must be represented as `switch_in`/`switch_out`, not external contributions/redemptions.
- Private validation tests must include an independent parser-to-report math audit for remaining cost basis, P/L, simple return, and XIRR when real private fixtures are available. The audit must derive invested/cost basis from transactions when transactions exist, using balance-level invested amounts only for balance-only rows or explicit opening-lot checkpoints.
- Timeline current-value charts must not fabricate historical prices. Use imported statement balances, real price/NAV snapshots, and transaction units only; show invested flow even when historical current value is unavailable. Timeline axes must be clamped to today. If today is a holdings snapshot rather than a continuous reconstructed valuation point, render it as a separate snapshot marker instead of connecting it as a fake line segment.
- Portfolio timeline current value must be reconstructed from units held on sampled month-end/latest dates, capitalized PF transactions/interest, NPS statement NAV snapshots, and real historical NAV/quote/FX snapshots. Plot current value and breakdowns only on complete valuation dates where every active holding has a value. For foreign assets, convert local value using FX on the sampled valuation date, not the stale quote date.
