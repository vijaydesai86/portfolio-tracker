import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

describe("fixture manifest", () => {
  it("lists committed importable fallback fixtures and keeps them on disk", () => {
    const manifest = readFileSync(resolve(root, "fixtures/MANIFEST.md"), "utf8");
    const paths = [
      "fixtures/manual/manual-balances-template.csv",
      "fixtures/importable/all-assets-template.csv"
    ];

    for (const fixturePath of paths) {
      expect(manifest).toContain(fixturePath);
      expect(readFileSync(resolve(root, fixturePath), "utf8")).toContain(
        "account_name,asset_name,asset_type,category,currency,current_value,as_of_date,notes"
      );
    }
  });

  it("keeps provider-specific parsing blocked until fixtures exist", () => {
    const manifest = readFileSync(resolve(root, "fixtures/MANIFEST.md"), "utf8");
    const audit = readFileSync(resolve(root, "fixtures/PROVIDER_FIXTURE_AUDIT.md"), "utf8");

    for (const provider of ["cas", "fidelity", "indmoney", "epfo", "nps", "fd-ppf-ssy"]) {
      expect(manifest.toLowerCase()).toContain(`fixtures/research/${provider}/`);
    }

    expect(audit).toContain("Canonical JSON and manual CSV fallback are currently importable");
    expect(audit).toContain("Detect CAS PDFs but do not parse/commit CAS data yet");
    expect(audit).toContain("Detect Fidelity positions/history CSV headers but do not parse/commit Fidelity data yet");
  });
});
