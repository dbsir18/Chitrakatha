import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { getLesson } from "@/app/actions/lessons";
import { LessonPDF } from "@/components/lesson-pdf";

// react-pdf uses Node.js canvas/fs — must run on Node.js, not Edge.
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const lesson = await getLesson(id);

  if (!lesson) {
    return new Response("Lesson not found", { status: 404 });
  }

  try {
    // LessonPDF wraps <Document> but carries its own props ({ lesson });
    // cast to renderToBuffer's declared element type (weak-type mismatch).
    const buffer = await renderToBuffer(
      createElement(LessonPDF, { lesson }) as unknown as Parameters<
        typeof renderToBuffer
      >[0]
    );

    const filename = `${lesson.sceneName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`;

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.byteLength),
      },
    });
  } catch (err) {
    console.error("PDF generation failed:", err);
    return new Response("Failed to generate PDF", { status: 500 });
  }
}
