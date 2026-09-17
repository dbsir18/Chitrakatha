"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { claimLesson, hasPendingWork, processLesson, releaseLesson } from "@/lib/ai/pipeline";
import { inngest, inngestConfigured } from "@/lib/inngest/client";
import type { LessonDetail, LessonSummary, SymbolWithImage } from "@/lib/types";
import type { ContentTypeValue, HydratedSymbol, QuizQuestionValue } from "@/lib/ai/schema";

export type GenerateLessonResult =
  | { ok: true; lessonId: string }
  | { ok: false; error: string };

/**
 * Creates the lesson row immediately and kicks generation in the background.
 *
 * The request does NO AI work — it cannot time out, and the user's content is
 * saved before a single credit is spent. The lesson page polls
 * /api/lessons/[id]/continue, which resumes the idempotent pipeline whenever
 * a previous pass was interrupted.
 */
export async function generateLesson(
  topic: string,
  rawContent: string
): Promise<GenerateLessonResult> {
  const trimmedTopic = topic.trim();
  const trimmedContent = rawContent.trim();

  if (!trimmedTopic) {
    return { ok: false, error: "Please give this lesson a topic name." };
  }
  if (!trimmedContent || trimmedContent.length < 10) {
    return {
      ok: false,
      error: "Please paste the content you want to memorize (drug profile, organism list, etc.).",
    };
  }

  try {
    const lesson = await db.lesson.create({
      data: {
        topic: trimmedTopic,
        rawContent: trimmedContent,
        // Placeholder text fields — filled in by the design phase. The row
        // exists so the input is durable BEFORE any paid call runs.
        sceneName: "",
        setting: "",
        narrative: "",
        sceneImagePrompt: "",
        symbols: [],
        quizQuestions: [],
        status: "designing",
      },
    });

    // Prefer the durable executor: hand the lesson to Inngest and return.
    // If the send fails (e.g. the dev server isn't running), fall back to the
    // after() executor so generation still proceeds.
    if (inngestConfigured()) {
      try {
        await inngest.send({ name: "lesson/generate", data: { lessonId: lesson.id } });
        revalidatePath("/");
        return { ok: true, lessonId: lesson.id };
      } catch (err) {
        console.error("Inngest event send failed, using after() fallback:", err);
      }
    }

    after(async () => {
      if (!(await claimLesson(lesson.id))) return;
      try {
        await processLesson(lesson.id);
      } catch (err) {
        console.error("Lesson generation pass failed:", err);
      } finally {
        await releaseLesson(lesson.id);
      }
    });

    revalidatePath("/");
    return { ok: true, lessonId: lesson.id };
  } catch (err) {
    console.error("generateLesson failed:", err);
    const message =
      err instanceof Error ? err.message : "Something went wrong creating the lesson.";
    return { ok: false, error: message };
  }
}

export async function getLessons(): Promise<LessonSummary[]> {
  const lessons = await db.lesson.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      topic: true,
      sceneName: true,
      contentType: true,
      sceneImageUrl: true,
      status: true,
      createdAt: true,
    },
  });

  return lessons.map((l) => ({
    ...l,
    sceneName: l.sceneName || l.topic,
    createdAt: l.createdAt.toISOString(),
  }));
}

export async function getLesson(id: string): Promise<LessonDetail | null> {
  const lesson = await db.lesson.findUnique({ where: { id } });
  if (!lesson) return null;

  return {
    id: lesson.id,
    topic: lesson.topic,
    sceneName: lesson.sceneName || lesson.topic,
    contentType: lesson.contentType,
    sceneImageUrl: lesson.sceneImageUrl,
    status: lesson.status,
    error: lesson.error,
    createdAt: lesson.createdAt.toISOString(),
    rawContent: lesson.rawContent,
    setting: lesson.setting,
    narrative: lesson.narrative,
    symbols: lesson.symbols as unknown as SymbolWithImage[],
    quizQuestions: lesson.quizQuestions as unknown as QuizQuestionValue[],
  };
}

export async function deleteLesson(id: string): Promise<void> {
  await db.lesson.delete({ where: { id } });
  // Drop any staged (paid but never uploaded) scene bytes for this lesson.
  // Symbol staging is library-scoped and reusable across lessons, so it stays.
  await db.stagedImage.deleteMany({
    where: { key: { startsWith: `lesson/${id}/` } },
  });
  revalidatePath("/");
}

export async function saveQuizSession(
  lessonId: string,
  answers: number[],
  score: number,
  total: number
): Promise<void> {
  await db.quizSession.create({
    data: { lessonId, answers, score, total },
  });
}

export async function getSymbolLibraryStats(): Promise<{
  totalConcepts: number;
  totalReuses: number;
}> {
  const rows = await db.symbolLibrary.findMany({ select: { usageCount: true } });
  return {
    totalConcepts: rows.length,
    totalReuses: rows.reduce((sum, r) => sum + Math.max(0, r.usageCount - 1), 0),
  };
}

export type LessonWithStatus = LessonSummary & {
  symbolsTotal: number;
  symbolsWithImages: number;
};

export async function getLessonsWithStatus(): Promise<LessonWithStatus[]> {
  const lessons = await db.lesson.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      topic: true,
      sceneName: true,
      contentType: true,
      sceneImageUrl: true,
      status: true,
      createdAt: true,
      symbols: true,
    },
  });

  return lessons.map((l) => {
    const symbols = l.symbols as (HydratedSymbol & { imageUrl?: string })[];
    return {
      id: l.id,
      topic: l.topic,
      sceneName: l.sceneName || l.topic,
      contentType: l.contentType as ContentTypeValue,
      sceneImageUrl: l.sceneImageUrl,
      status: l.status,
      createdAt: l.createdAt.toISOString(),
      symbolsTotal: symbols.length,
      symbolsWithImages: symbols.filter((s) => !!s.imageUrl).length,
    };
  });
}

/**
 * Manual resume: force-claims the lease and re-runs the idempotent pipeline.
 * Only regenerates what is missing — completed work is never re-paid.
 */
export async function resumeLesson(
  lessonId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const lesson = await db.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) return { ok: false, error: "Lesson not found." };
    if (!hasPendingWork(lesson)) {
      return { ok: false, error: "Everything is already generated for this lesson." };
    }

    // Prefer the durable executor for the retry too — the new run's steps
    // re-check the DB and only pay for what is still missing.
    if (inngestConfigured()) {
      try {
        await inngest.send({ name: "lesson/generate", data: { lessonId } });
        revalidatePath(`/lessons/${lessonId}`);
        revalidatePath("/lessons");
        return { ok: true };
      } catch (err) {
        console.error("Inngest event send failed, using after() fallback:", err);
      }
    }

    // Force-claim: a human asked for this. If a pass is genuinely still
    // running, the overlap is bounded — each pass persists per-symbol, so the
    // worst case is one image being regenerated on the next pass.
    if (!(await claimLesson(lessonId, true))) {
      return { ok: false, error: "Could not claim the lesson for generation." };
    }

    after(async () => {
      try {
        await processLesson(lessonId);
      } catch (err) {
        console.error("Lesson resume pass failed:", err);
      } finally {
        await releaseLesson(lessonId);
      }
    });

    revalidatePath(`/lessons/${lessonId}`);
    revalidatePath("/lessons");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return { ok: false, error: message };
  }
}
