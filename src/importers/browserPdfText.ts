export async function extractPdfTextInBrowser(file: File, password?: string): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data, password }).promise;
  let text = "";

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

      text += `${line}\n`;
    }
  }

  return text;
}
