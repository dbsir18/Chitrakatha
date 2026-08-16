// eslint-disable-next-line @typescript-eslint/no-require-imports
const { renderToBuffer } = require("@react-pdf/renderer") as {
  renderToBuffer: (element: React.ReactElement) => Promise<Buffer>;
};
import { createElement } from "react";
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
    const buffer = await renderToBuffer(
      createElement(LessonPDF, { lesson })
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
