"use server";

// pdf-parse only has a CommonJS default export; use require to avoid TS ESM issues.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{ text: string; numpages: number }>;

/**
 * Post-processes raw text extracted from a PDF:
 *
 * 1. Fixes ligature encoding corruption common in older academic/textbook PDFs
 *    where Type 1 font ligatures map to wrong characters:
 *      # → ff  (e#ects → effects, di#erent → different)
 *      % → fi  (e%cacy → efficacy, bene%t → benefit)
 *    We only apply these within word boundaries so we don't corrupt real
 *    # symbols (e.g. "pH #4") or % signs in actual percentages ("4.4%").
 *
 * 2. Strips internal page-break markers ("-- 1 of 5 --") that pdf-parse
 *    injects between pages.
 *
 * 3. Normalises whitespace.
 */
function cleanPdfText(raw: string): string {
  return raw
    // Ligature fix: # between word chars = ff (e#ects, di#erent, a#ord)
    .replace(/([a-z])#([a-z])/gi, "$1ff$2")
    // Ligature fix: % between word chars = fi (e%cacy, bene%t, pro%le)
    .replace(/([a-z])%([a-z])/gi, "$1fi$2")
    // Strip pdf-parse page markers
    .replace(/^--\s*\d+\s*of\s*\d+\s*--$/gm, "")
    // Normalise line endings and collapse excessive blank lines
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type ExtractPdfResult =
  | { ok: true; text: string; pageCount: number }
  | { ok: false; error: string };

/**
 * Extracts plain text from an uploaded PDF file.
 * Called from the lesson form when the user uploads a PDF instead of typing.
 */
export async function extractPdfContent(
  formData: FormData
): Promise<ExtractPdfResult> {
  const file = formData.get("pdf");

  if (!(file instanceof File)) {
    return { ok: false, error: "No PDF file received." };
  }
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return { ok: false, error: "Please upload a PDF file." };
  }
  // 20 MB guard — large PDFs are slow to parse and rarely needed for study notes
  if (file.size > 20 * 1024 * 1024) {
    return { ok: false, error: "PDF is too large (max 20 MB). Try a single chapter or page range." };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await pdfParse(buffer);

    const text = cleanPdfText(result.text);

    if (!text || text.length < 20) {
      return {
        ok: false,
        error:
          "Could not extract readable text from this PDF. It may be a scanned image — try copy-pasting the text manually.",
      };
    }

    return { ok: true, text, pageCount: result.numpages };
  } catch {
    return {
      ok: false,
      error: "Failed to parse the PDF. Make sure it's a valid, non-password-protected PDF.",
    };
  }
}
