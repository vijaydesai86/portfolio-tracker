# Fidelity Import Research Sources

## idwpan/ynab-fidelity

- Repository: https://github.com/idwpan/ynab-fidelity
- Description from GitHub API: Parse .CSV from Fidelity account and upload transactions to YNAB budget via API.
- Evidence: public parser reference exists for Fidelity CSV account exports.
- Fixture caveat: the inspected repository tree has parser code and usage documentation, but no reusable sample Fidelity CSV fixture.
- Implementation status: manual/template import only until a real legally usable CSV fixture is added.

## Rule

Do not claim Fidelity automated CSV support until tests parse a real public fixture or a documented sample from Fidelity.
