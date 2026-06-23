# Importable Template Pack

Source type: application-defined canonical CSV templates and generic manual XLSX workbook template.

These files are intentionally not provider-native statement examples. They are real importable templates for the application manual importers and cover every requested asset class:

- Indian mutual funds
- Indian stocks
- US stocks
- ESPP contribution
- Cash
- PPF
- SSY
- NPS
- EPF/PF
- Fixed deposits
- Gold
- Others

Use these when a provider-native fixture is unavailable or when the user wants to correct/import balances manually. Provider-native files must still be added separately only when legally reusable real samples are available.

## Generic Manual Workbook

`fixtures/importable/generic-manual-portfolio-template.xlsx` is the preferred manual format. It contains `Manifest`, `Holdings`, `Transactions`, `Prices`, and `FX` sheets. The matching CSV files in `fixtures/importable/manual-workbook-template/` are committed so the sheet schema is reviewable in git. Holdings and transactions contain zero-value template rows to avoid committing fake financial data; replace them with real values before importing. Add only real price/NAV and FX rows.
