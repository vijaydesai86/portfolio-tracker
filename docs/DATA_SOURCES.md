# Data Sources

This document tracks external sources used for imports, market data, fixtures, and parser research.

## Rules

- Prefer official sources.
- Public fixture files must be legally usable and must not expose private personal data.
- Open-source fixtures may be used only when license and source are recorded.
- If a fixture is synthetic, it must be clearly marked synthetic and cannot be used to claim real provider support.

## Sources Under Review

- AMFI NAVAll text feed for Indian mutual fund NAV refresh.
- Public/open-source CAS parser fixtures for CAMS, KFintech, NSDL, and CDSL statement structures.
- Public/open-source Fidelity CSV parser references.
- Official EPFO, NPS CRA, and provider documentation for statement availability.

## Implemented Market Refresh Sources

- AMFI `NAVAll.txt` is used by the server route for Indian mutual fund NAV refresh and matched by ISIN. The route tries both `portal.amfiindia.com` and `www.amfiindia.com` mirrors. Historical mutual-fund NAV refresh resolves AMFI scheme codes by ISIN and then requests dated NAV history from MFAPI, with AMFI historical NAV as a fallback; if those fail, the app reports the missing historical NAVs instead of interpolating.
- US stock quote refresh uses real quote providers only. The route tries Stooq CSV batch quotes and Yahoo Finance chart quotes. Historical US stock refresh requests daily Stooq/Yahoo chart prices from the first imported transaction/balance date through today. If providers time out or return unusable data, the UI reports that and leaves imported prices in place.
- USD/INR refresh uses real no-key providers with provider-specific source tags. Latest FX prefers Frankfurter, then Open ER API, then currency-api, then Stooq. Historical transaction-date FX prefers Frankfurter range data, then Stooq daily data.
- The app does not fabricate market prices. If a source times out or returns unusable data, the UI reports the error and leaves existing values in place.

## Current Local Reachability Notes

On 2026-06-22 in this development environment, direct probes succeeded for Frankfurter, Open ER API, and the jsDelivr currency-api feed. Direct probes timed out for AMFI NAVAll, MFAPI, Stooq, Yahoo Finance, and Nasdaq/FMP quote endpoints. This means USD/INR can refresh locally now, while live mutual-fund NAV and US stock quote refresh may still depend on running from a network where those finance hosts are reachable.

## USD/INR FX Handling

The portfolio is INR-first. Latest USD/INR is used for current USD holding values. Historical USD/INR daily snapshots are requested for imported USD transaction ranges and transaction analytics use the latest available FX snapshot on or before each transaction date. Missing FX is surfaced as an error or warning; the app must not invent conversion rates. Manual/imported FX CSV is allowed only as user-supplied real data when live providers are unavailable.
