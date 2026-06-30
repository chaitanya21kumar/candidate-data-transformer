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
    // Reconstruct line breaks from pdfjs' end-of-line markers so section-based parsing
    // (SKILLS / EXPERIENCE / EDUCATION) works — a naive space-join would lose them.
    const lines: string[] = [];
    let parts: string[] = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      if (item.str) parts.push(item.str);
      if (item.hasEOL) {
        lines.push(parts.join(' '));
        parts = [];
      }
    }
    if (parts.length) lines.push(parts.join(' '));
    pages.push(lines.join('\n'));
  }
  await doc.cleanup();
  return pages.join('\n');
}
