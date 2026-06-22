# Fixture Manifest

This manifest is the source of truth for import files committed to the repository.

## Importable Fixtures

| Path | Type | Source | Can be used for tests | Provider support implied |
| --- | --- | --- | --- | --- |
| `fixtures/manual/manual-balances-template.csv` | CSV | Application-defined manual import template | Yes | No provider support; manual/template only |
| `fixtures/importable/all-assets-template.csv` | CSV | Application-defined canonical template pack | Yes | No provider support; covers all requested asset classes |
| `fixtures/importable/equity-mf-india-us-template.csv` | CSV | Application-defined canonical template pack | Yes | No provider support; equity-focused template |
| `fixtures/importable/debt-small-savings-template.csv` | CSV | Application-defined canonical template pack | Yes | No provider support; debt/small-savings template |
| `fixtures/importable/cash-espp-template.csv` | CSV | Application-defined canonical template pack | Yes | No provider support; cash and ESPP contribution template |
| `fixtures/importable/gold-others-template.csv` | CSV | Application-defined canonical template pack | Yes | No provider support; gold and others template |

## Research-Only Sources

These directories contain source notes and search evidence, not importable provider fixtures.

| Path | Status | Reason |
| --- | --- | --- |
| `fixtures/research/cas/` | Detected-only | Native PDF family detection exists, but parser fixtures are encrypted/private or absent. |
| `fixtures/research/fidelity/` | Detected-only | Native Fidelity positions/history CSV headers are detected from parser references, but no reusable public Fidelity CSV fixture has been verified. |
| `fixtures/research/indmoney/` | Research-only | No reusable public INDMoney export fixture has been verified. |
| `fixtures/research/epfo/` | Detected-only | EPFO/PF document family detection exists, but no reusable public passbook fixture has been verified. |
| `fixtures/research/nps/` | Detected-only | NPS document/export family detection exists, but no reusable public statement fixture has been verified. |
| `fixtures/research/fd-ppf-ssy/` | Detected-only | PPF/SSY/FD statement family detection exists; bank/post-office formats vary and no reusable provider fixture has been verified. |
| `fixtures/market-data/amfi/` | Research-only | Official NAV feed exists, but this environment could not download a stable fixture via local `curl` at the time of audit. |

## Fixture Acceptance Gate

A provider fixture can be committed only when all are true:

- The source is official, explicitly sample/test data, or clearly licensed for reuse.
- The fixture does not expose real private account data unless already anonymized by the source owner.
- The source URL, license/usage note, retrieval date, and checksum are recorded.
- A failing parser test is added before implementation work.
- The parser normalizes into the canonical JSON model and stages uncertain fields for review.

Random leaked or user-like statements found on the internet are not acceptable fixtures.
