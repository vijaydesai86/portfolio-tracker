# Importable Template Pack

Source type: application-defined manual CSV templates.

These files are intentionally not provider-native statement examples. They are real importable templates for the application manual importers and cover every requested asset class without committing fake market prices.

## Normal Manual Inputs

- `manual-transactions-template.csv`: use this for market-priced assets where the user can provide transaction facts only. Supported examples include Indian mutual funds, Indian stocks, US stocks/Fidelity-style broker exports converted to the simple format, and gold units. The app derives open holdings from net quantity and then refreshes real NAV/quotes/FX where supported.
- `manual-balances-template.csv`: use this for fixed or manually valued assets where the user knows the current balance. Supported examples include cash, ESPP contribution, PPF, SSY, EPF/PF fallback, NPS fallback, FD, manually valued gold, and other assets.

The zero-value rows are templates, not market data. Replace them with real user facts before importing. Provider-native files must still be added separately only when legally reusable real samples are available.
