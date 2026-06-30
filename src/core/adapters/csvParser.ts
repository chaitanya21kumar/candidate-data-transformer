/**
 * A small, dependency-free RFC-4180 CSV parser.
 *
 * Written by hand rather than pulled from a library because (a) it keeps the core
 * isomorphic with zero deps, and (b) the quoting rules are simple enough to own and
 * explain. It handles quoted fields, escaped quotes (""), and commas/newlines inside
 * quotes, and tolerates both LF and CRLF line endings.
 *
 * It never throws: malformed input simply yields whatever rows could be read.
 */
export function parseCsv(input: string): string[][] {
  if (input.charCodeAt(0) === 0xfeff) input = input.slice(1); // strip a leading BOM
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let fieldStarted = false; // distinguishes a real empty trailing row from genuine data

  const pushField = () => {
    row.push(field);
    field = '';
    fieldStarted = false;
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"'; // escaped quote
          i++;
        } else {
          inQuotes = false; // closing quote
        }
      } else {
        field += char;
      }
      continue;
    }

    switch (char) {
      case '"':
        inQuotes = true;
        fieldStarted = true;
        break;
      case ',':
        pushField();
        fieldStarted = true; // a comma implies another field follows
        break;
      case '\r':
        // Swallow CR; the following LF (if any) ends the row.
        if (input[i + 1] !== '\n') pushRow();
        break;
      case '\n':
        pushRow();
        break;
      default:
        field += char;
        fieldStarted = true;
    }
  }

  // Flush a final field/row if the file did not end with a newline.
  if (fieldStarted || field.length > 0 || row.length > 0) pushRow();

  // Drop fully-empty rows (e.g. a trailing blank line) for cleanliness.
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}
