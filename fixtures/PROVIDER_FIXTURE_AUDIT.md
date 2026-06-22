# Provider Fixture Audit

Audit date: 2026-06-22

This file records what was actually checked for real, reusable example files. It is intentionally strict because provider importers are only useful if they are tested against real formats.

## Current Result

Canonical JSON and manual CSV fallback are currently importable from committed files. Native provider-specific parsing remains blocked until real reusable fixtures are available or the implementation integrates a verified parser with lawful fixture coverage. Native file-family detection now exists for several provider families.

## Findings

| Area | Public evidence found | Reusable committed fixture found | Current decision |
| --- | --- | --- | --- |
| Indian mutual fund CAS / Indian demat CAS | `codereverser/casparser` supports CAMS, KFintech, NSDL, and CDSL parser paths and publishes JSON schemas. Its test statement bundle is `tests/files.enc`, decrypted in CI with a secret passphrase. | No | Detect CAS PDFs but do not parse/commit CAS data yet. Use CASParser as a reference/integration candidate, not as proof of fixture coverage. |
| Fidelity US CSV | Public parser projects exist, including `idwpan/ynab-fidelity` and other Fidelity CSV import projects. | No | Detect Fidelity positions/history CSV headers but do not parse/commit Fidelity data yet. Derive a parser only after a reusable CSV fixture or official sample is found. |
| INDMoney | No reusable public export fixture verified. | No | Manual CSV only. |
| EPFO/PF | No reusable public EPFO passbook fixture verified. | No | Manual CSV only. |
| NPS | No reusable public NPS statement fixture verified. | No | Manual CSV only. |
| PPF/SSY/FD | Formats differ by bank/post-office/provider, and no reusable public provider statement fixture was verified. | No | Manual CSV only until per-provider fixtures exist. |
| AMFI NAV market data | Official NAVAll text feed endpoint is known, but local `curl` timed out or failed during this audit. | No | Treat as market-data research only until a stable downloaded fixture is committed. |

## Search Log

- GitHub API tree audit: `codereverser/casparser`.
- GitHub API content audit: `codereverser/casparser/.github/scripts/extract_files.sh`.
- GitHub API tree audit: `idwpan/ynab-fidelity`.
- GitHub repository search: `NPS statement parser India` returned no repositories.
- GitHub repository search: `EPFO passbook parser` returned no repositories.
- GitHub repository search: `INDMoney portfolio parser` returned no repositories.
- GitHub repository search: `Fidelity CSV parser portfolio` returned public parser projects but no clearly reusable sample CSV fixture in the inspected trees.
- Local `curl` audit: `https://www.amfiindia.com/spages/NAVAll.txt` timed out after 60 seconds.
- Local `curl` audit: `http://portal.amfiindia.com/spages/NAVAll.txt` failed without usable content.

## Why This Repo Still Matters

The repository now provides:

- A versioned canonical backup format.
- A working manual CSV import path covering all requested asset buckets.
- A tested import pipeline with validation, deduplication, import history, and manual-edit preservation.
- A dashboard and local verification setup.
- A strict fixture gate so later provider importers cannot be added on guesses.

The next high-value step is not to invent sample files. It is to add the first legally reusable provider fixture and then build that importer test-first.
