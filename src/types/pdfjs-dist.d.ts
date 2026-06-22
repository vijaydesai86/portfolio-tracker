declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export const GlobalWorkerOptions: { workerSrc?: string };
  export function getDocument(options: Record<string, unknown>): { promise: Promise<PdfDocument> };

  export type PdfDocument = {
    numPages: number;
    getPage(pageNumber: number): Promise<PdfPage>;
  };

  export type PdfPage = {
    getTextContent(): Promise<{ items: Array<{ str?: string; transform: number[] }> }>;
  };
}
