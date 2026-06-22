# Importers

Importer support is evidence-based. Each importer must cite real public fixtures, official documentation, or verified open-source fixtures. Unsupported providers should fall back to manual entry or the internal Excel/CSV template.

## Confidence Levels

- `high`: tested with real fixtures covering common edge cases.
- `medium`: tested with at least one real fixture or verified parser reference, but edge cases remain.
- `low`: source format is known only partially; import must require review.
- `manual-only`: no reliable public format fixture is available yet.

## Initial Targets

| Provider / Asset | Status | Notes |
| --- | --- | --- |
| Canonical JSON backup | Implemented | Full restore source of truth. |
| Manual CSV template | Implemented | Baseline for every asset type; provider-neutral and clearly marked as template input. |
| Indian mutual fund CAS | Browser import implemented | CAS text parser and canonical normalization are implemented; a private CAS PDF passes aggregate parser acceptance via pdftotext extraction and browser upload/parse/commit smoke verification via Selenium/Firefox. |
| AMFI NAVAll | Researching | Public official NAV text feed; local download has timed out so far. |
| Fidelity CSV | Detected only | Positions and history CSV headers are detected from verified open-source parser references; normalization parser still needs fixture-backed tests. |
| EPFO passbook | Detected only | PDF/HTML family detection exists; parser still needs reusable passbook fixtures. |
| NPS statement | Detected only | PDF/CSV/XLSX family detection exists; parser still needs CRA statement fixtures. |
| INDMoney | Browser import implemented | Transactions Ledger XLSX parser is implemented and privately verified against the a private INDMoney workbook. The private workbook is not committed. |
| PPF/SSY/FD | Detected only | Statement-family detection exists; provider-specific formats vary and need fixtures. |


## Implemented Manual CSV Columns

```text
account_name,asset_name,asset_type,category,currency,current_value,as_of_date,notes
```

Supported categories: `Equity`, `Debt`, `Gold`, `Others`, `Cash`.

Supported manual asset types include `cash`, `espp`, `ppf`, `ssy`, `nps`, `epf`, `fd`, `gold`, `mutual_fund`, `indian_stock`, `us_stock`, and `other`.

Canonical importable templates are committed under `fixtures/importable/` and are tested as real import inputs. These files are not provider-native examples.

## Fixture Gate

Provider import work must begin from `fixtures/MANIFEST.md`. If a provider has no committed reusable fixture, the importer remains unsupported in the UI and docs. Parser code may be researched, but it should not be wired into production import flows until there is a fixture-backed failing test.

## Native Detection

Native file detection is implemented in `src/importers/detectImport.ts`. Detection is not the same as parsing. Detected-only providers are visible in the app but must not commit data until a tested parser exists.

## CAS Parser Status

`src/importers/casText.ts` parses extracted CAMS/KFintech-style CAS text into scheme summaries, transactions, balances, NAV snapshots, and canonical portfolio records. The private fixture test is skipped by default and runs with `CAS_TEXT_PATH=/tmp/private-cas.txt npm test -- tests/importers/cas-private.test.ts`. The raw private PDF and extracted text are not committed.

Browser CAS import uses `src/importers/browserPdfText.ts` and the PDF.js worker in `public/pdf.worker.mjs` to extract text client-side after the user enters the PDF password. The app stages parsed schemes, transactions, balances, and warnings for review before committing records to the portfolio.


### Local Private CAS Verification

The raw CAS PDF is not committed. To verify the private CAS parser locally:

```bash
CAS_PASSWORD=your-password npm run cas:extract
npm run test:cas:private
```

Optional paths:

```bash
CAS_PDF=/path/to/CAS.pdf CAS_TEXT_OUT=/tmp/private-cas.txt CAS_PASSWORD=your-password npm run cas:extract
```

To verify the full browser path against a local private PDF:

```bash
CAS_PDF=/path/to/CAS.pdf CAS_PASSWORD=your-password npm run test:ui:cas
```

## INDMoney XLSX Status

`src/importers/indmoneyXlsx.ts` parses the `Transactions Ledger` workbook shape observed in the private workbook. It supports `BUY`, `SELL`, `DIV`, `DIVTAX`, `JNLC`, `CSD`, `MEM`, and `STOCK_SPLIT` rows, stages canonical transactions, derives open US-stock positions, and records linked `quantity` and `price` fields so live quote refresh can revalue the holdings.

The private workbook is not committed. Verify it locally with:

```bash
IND_XLSX_PATH=/path/to/private-indmoney.xlsx npm run test:ind:private
IND_XLSX_PATH=/path/to/private-indmoney.xlsx npm run test:ui:ind
```
