/**
 * Post-processes raw text extracted from a PDF.
 *
 * Fixes ligature encoding corruption common in older academic/textbook PDFs
 * where Type 1 font ligatures are mapped to wrong characters:
 *   # → ff  (e#ects → effects, di#erent → different)
 *   % → fi  (e%cacy → efficacy, bene%t → benefit)
 *
 * Also strips internal page-break markers and normalises whitespace.
 */
export function cleanPdfText(raw: string): string {
  return raw
    .replace(/([a-z])#([a-z])/gi, "$1ff$2")
    .replace(/([a-z])%([a-z])/gi, "$1fi$2")
    .replace(/^--\s*\d+\s*of\s*\d+\s*--$/gm, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
