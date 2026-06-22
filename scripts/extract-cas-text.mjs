#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const rawPdfPath = process.env.CAS_PDF;
const pdfPath = rawPdfPath ? resolve(rawPdfPath) : undefined;
const outPath = resolve(process.env.CAS_TEXT_OUT ?? "/tmp/private-cas.txt");
const password = process.env.CAS_PASSWORD;

if (!password) {
  console.error("CAS_PASSWORD is required. Example: CAS_PASSWORD=... npm run cas:extract");
  process.exit(2);
}

if (!pdfPath) {
  console.error("CAS_PDF is required.");
  process.exit(2);
}

if (!existsSync(pdfPath)) {
  console.error(`CAS PDF not found: ${pdfPath}`);
  process.exit(2);
}

execFileSync("pdftotext", ["-layout", "-upw", password, pdfPath, outPath], { stdio: "pipe" });
console.log(`Extracted CAS text to ${outPath}`);
