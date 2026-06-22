# Testing Strategy

Testing is required for every feature.

## Test Order

1. Write failing tests that define the behavior.
2. Implement the smallest correct behavior.
3. Run tests and make them pass.
4. Add edge and failure cases.
5. Update docs and changelog.

## Test Types

- Unit tests for schema validation, math, deduplication, migrations, and category mapping.
- Importer tests for fixtures, malformed files, duplicate reuploads, and manual edit preservation.
- Component tests for dashboard and review flows.
- Selenium smoke tests for local browser rendering and screenshots.

## Private Fixture Checks

Private user files are never committed. They are verified through opt-in local commands:

```bash
CAS_PASSWORD=your-password npm run test:ui:cas
IND_XLSX_PATH=/path/to/private-indmoney.xlsx npm run test:ind:private
IND_XLSX_PATH=/path/to/private-indmoney.xlsx npm run test:ui:ind
```

## INR-First Analytics Checks

Analytics tests cover USD holdings converted to INR with latest FX, USD transaction cash flows converted using transaction-date FX, incomplete INR XIRR when FX is missing, and asset tags for category, asset kind, and India/US region.

## Market Data Checks

Market-data tests cover AMFI NAVAll parsing, Stooq quote/FX parsing, Frankfurter latest and historical USD/INR parsing, Open ER API USD/INR parsing, currency-api USD/INR parsing, Yahoo chart quote parsing, and applying market snapshots to linked holdings. Manual USD/INR CSV tests cover user-supplied real FX fallback import.
