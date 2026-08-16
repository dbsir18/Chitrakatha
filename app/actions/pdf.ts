"use server";

// pdf-parse only has a CommonJS default export; use require to avoid TS ESM issues.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{ text: string; numpages: number }>;

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

    const text = result.text
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

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
