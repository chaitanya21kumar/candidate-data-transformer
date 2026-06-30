/**
 * PDF text extraction (Node-only I/O concern, kept out of the pure core).
 *
 * pdfjs-dist is imported lazily so it is only loaded when a PDF is actually read — the
 * engine and the browser build never pull it in. Extraction is text-only (no rendering),
 * which is deterministic for a given PDF and needs no system fonts.
 */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data, isEvalSupported: false }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  await doc.cleanup();
  return pages.join('\n');
}
