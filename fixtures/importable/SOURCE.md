# Importable Template Pack

Source type: application-defined manual CSV templates.

These files are intentionally not provider-native statement examples. They are real importable templates for the application manual importers and cover every requested asset class without committing fake market prices.

## Normal Manual Inputs

- `manual-transactions-template.csv`: use this for market-priced assets where the user can provide transaction facts only. Supported examples include Indian mutual funds, Indian stocks, US stocks/Fidelity-style broker exports converted to the simple format, and gold units. The app derives open holdings from net quantity and then refreshes real NAV/quotes/FX where supported.
- `manual-balances-template.csv`: blank zero-value template for fixed or manually valued assets. Fill `current_value`; fill `invested_amount`, `invested_currency`, and `invested_as_of_date` when you want invested/P&L display. Do not put invested amount in `notes`.
- `manual-balances-sample.csv`: non-zero synthetic sample you can import immediately to see manual balances, invested amount, P/L, allocation, and USD FX conversion behavior.

`manual-balances-template.csv` has zero-value rows for editing. `manual-balances-sample.csv` has synthetic non-zero values for UI testing and must be replaced with real user facts for actual tracking. Provider-native files must still be added separately only when legally reusable real samples are available.
