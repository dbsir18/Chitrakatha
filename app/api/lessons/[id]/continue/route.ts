import { after } from "next/server";
import { db } from "@/lib/db";
import {
  claimLesson,
  parseStoredSymbols,
  processLesson,
  releaseLesson,
  shouldAutoContinue,
} from "@/lib/ai/pipeline";

/**
 * Polled by the lesson page while a lesson is generating. If a previous
 * generation pass was interrupted (function restart, timeout), this resumes
 * it — the pipeline is idempotent, so the resume only does the missing work.
 * The lease claim prevents overlapping passes. Returns the current status
 * snapshot for the poller.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const lesson = await db.lesson.findUnique({ where: { id } });
  if (!lesson) {
    return Response.json({ error: "Lesson not found." }, { status: 404 });
  }

  if (shouldAutoContinue(lesson) && (await claimLesson(id))) {
    after(async () => {
      try {
        await processLesson(id);
      } catch (err) {
        console.error("Lesson continuation pass failed:", err);
      } finally {
        await releaseLesson(id);
      }
    });
  }

  const symbols = parseStoredSymbols(lesson.symbols);
  return Response.json({
    status: lesson.status,
    sceneReady: !!lesson.sceneImageUrl,
    symbolsTotal: symbols.length,
  });
}
