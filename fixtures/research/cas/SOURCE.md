# CAS Parser Research Sources

## codereverser/casparser

- Repository: https://github.com/codereverser/casparser
- Description from GitHub API: Parser for Consolidated Account Statements generated from CAMS/Karvy/Kfintech.
- License from GitHub API: MIT.
- Public evidence found: tests for CAMS, KFintech, NSDL, CDSL, demat units, gains, and errors.
- Fixture caveat: test fixture bundle is `tests/files.enc`, an encrypted file. The extraction script decrypts it with `FILES_PASSPHRASE` and expands `tests/files.tar.bz2`; the passphrase is not public. The repository tree inspected here does not expose plain sample statement PDFs directly.
- Implementation status: research reference only until real non-private fixture files are added.

## ukkit/processCASpdf

- Repository: https://github.com/ukkit/processCASpdf
- Description from GitHub API: Python library to extract transaction data from Indian Mutual Fund CAS PDFs, supports CAMS and KFintech.
- License from GitHub API: MIT.
- Fixture caveat: no sample PDFs were found in the repository top-level listing inspected here.
- Implementation status: research reference only.

## CASParser/cas-parser-go

- Repository: https://github.com/CASParser/cas-parser-go
- Description from GitHub API: CAS Parser API client; mentions NSDL, CDSL, CAMS, KFintech.
- License from GitHub API: Apache-2.0.
- Implementation status: research reference only.

## Rule

Do not claim automated CAS support until parser tests include real, legally usable, non-private statement fixtures or a documented parser integration.
