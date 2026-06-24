export async function extractPdfTextInBrowser(file: File, password?: string): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const runningInNode = typeof process !== "undefined" && Boolean(process.versions?.node);
  if (!runningInNode) pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data, password, disableWorker: runningInNode }).promise;
  const lines: string[] = [];

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    const rows = new Map<number, Array<{ x: number; str: string }>>();

    for (const item of content.items) {
      const str = item.str?.trim();
      if (!str) continue;
      const x = item.transform[4] ?? 0;
      const y = Math.round(((item.transform[5] ?? 0) / 2)) * 2;
      const row = rows.get(y) ?? [];
      row.push({ x, str });
      rows.set(y, row);
    }

    for (const [, row] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
      row.sort((a, b) => a.x - b.x);
      let line = "";
      let lastX = 0;

      for (const item of row) {
        const gap = Math.max(1, Math.round((item.x - lastX) / 4));
        if (line) line += " ".repeat(Math.min(gap, 30));
        line += item.str;
        lastX = item.x + item.str.length * 4;
      }

      lines.push(line);
    }
  }

  return normalizeCasPdfJsLines(lines).join("\n");
}

const casDate = /^\d{2}-[A-Za-z]{3}-\d{4}/;
const standaloneUnitBalance = /^-?[\d,]+\.\d{3}$/;
const dateAmountOnly = /^(\d{2}-[A-Za-z]{3}-\d{4})\s+(-?[\d,]+\.\d{2})\s*$/;
const dateWithThreeNumericColumns = /^(\d{2}-[A-Za-z]{3}-\d{4})\s+(.+?)\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{3})\s+(-?[\d,]+\.\d{3,4})\s*$/;
const dateOnlyThreeNumericColumns = /^(\d{2}-[A-Za-z]{3}-\d{4})\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{3})\s+(-?[\d,]+\.\d{3,4})\s*$/;
const descriptionWithUnitBalance = /^(.+?)\s+(-?[\d,]+\.\d{3})\s*$/;

export function normalizeCasPdfJsLines(lines: string[]): string[] {
  const normalized: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]?.trim();
    const next = lines[index + 1]?.trim();
    if (!line) continue;

    if (next && casDate.test(next)) {
      const merged = mergePdfJsCarryLine(line, next);
      if (merged) {
        normalized.push(merged);
        index += 1;
        continue;
      }
    }

    normalized.push(line);
  }
  return normalized;
}

function mergePdfJsCarryLine(line: string, next: string): string | undefined {
  const nextMissingBalance = next.match(dateWithThreeNumericColumns);
  if (nextMissingBalance && standaloneUnitBalance.test(line)) return next + " " + line;

  const nextNoDescription = next.match(dateOnlyThreeNumericColumns);
  if (nextNoDescription) {
    const carriedDescription = line.match(descriptionWithUnitBalance);
    if (carriedDescription) return nextNoDescription[1] + " " + carriedDescription[1] + " " + nextNoDescription[2] + " " + nextNoDescription[3] + " " + nextNoDescription[4] + " " + carriedDescription[2];
  }

  const nextAmountOnly = next.match(dateAmountOnly);
  if (nextAmountOnly && isCarriedAmountDescription(line)) return nextAmountOnly[1] + " " + line + " " + nextAmountOnly[2];

  return undefined;
}

function isCarriedAmountDescription(line: string): boolean {
  if (casDate.test(line)) return false;
  if (standaloneUnitBalance.test(line)) return false;
  return /purchase|systematic investment|stamp duty|switch|redemption|dividend|fee|load/i.test(line);
}
