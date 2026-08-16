"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { designScene } from "@/lib/ai/scene-designer";
import {
  generateSceneImage,
  resolveSymbolImages,
  type LibraryLookup,
} from "@/lib/ai/image-generator";
import { hydrateSymbols, loadSymbolLibrary } from "@/lib/ai/symbol-library";
import type { LessonDetail, LessonSummary, SymbolWithImage } from "@/lib/types";
import type { QuizQuestionValue } from "@/lib/ai/schema";

export type GenerateLessonResult =
  | { ok: true; lessonId: string }
  | { ok: false; error: string };

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
    const { forPrompt: existingSymbols, rows: libraryRows } = await loadSymbolLibrary(
      trimmedTopic,
      trimmedContent
    );
    const design = await designScene(trimmedTopic, trimmedContent, existingSymbols);

    // Fill in name/visualDescription/imagePrompt for every symbol the model
    // flagged as reused (or that a similarity check catches it having missed),
    // instead of trusting the model to have repeated that text itself.
    const hydrationResults = await hydrateSymbols(design.symbols, libraryRows);
    const hydratedSymbols = hydrationResults.map((r) => r.symbol);
    const newConceptEmbeddings = new Map(
      hydrationResults
        .filter((r) => r.isNewConcept && r.embedding)
        .map((r) => [r.symbol.conceptKey, r.embedding as number[]])
    );

    const lesson = await db.lesson.create({
      data: {
        topic: trimmedTopic,
        rawContent: trimmedContent,
        contentType: design.contentType,
        sceneName: design.sceneName,
        setting: design.setting,
        narrative: design.narrative,
        sceneImagePrompt: design.sceneImagePrompt,
        symbols: hydratedSymbols,
        quizQuestions: design.quizQuestions,
      },
    });

    const lookup: LibraryLookup = new Map(
      libraryRows.map((r) => [
        r.conceptKey,
        {
          referenceImageUrl: r.referenceImageUrl,
          displayName: r.displayName,
          description: r.description,
        },
      ])
    );

    const [sceneImageUrl, resolvedSymbols] = await Promise.all([
      generateSceneImage(lesson.id, design.setting, hydratedSymbols).catch((err) => {
        console.error("Scene image generation failed:", err);
        return null;
      }),
      resolveSymbolImages(hydratedSymbols, lookup),
    ]);

    const symbolsWithImages: SymbolWithImage[] = resolvedSymbols.map((r) => ({
      ...r.symbol,
      imageUrl: r.imageUrl,
    }));

    await Promise.all(
      resolvedSymbols.map((r) => {
        if (r.isNewLibraryEntry && r.imageUrl) {
          return db.symbolLibrary.upsert({
            where: { conceptKey: r.symbol.conceptKey },
            create: {
              conceptKey: r.symbol.conceptKey,
              displayName: r.symbol.name,
              description: r.symbol.visualDescription,
              imagePrompt: r.symbol.imagePrompt,
              category: r.symbol.category,
              referenceImageUrl: r.imageUrl,
              embedding: newConceptEmbeddings.get(r.symbol.conceptKey) ?? undefined,
            },
            update: {
              referenceImageUrl: r.imageUrl,
            },
          });
        }
        if (!r.isNewLibraryEntry && r.imageUrl) {
          return db.symbolLibrary
            .update({
              where: { conceptKey: r.symbol.conceptKey },
              data: { usageCount: { increment: 1 } },
            })
            .catch(() => undefined);
        }
        return Promise.resolve();
      })
    );

    await db.lesson.update({
      where: { id: lesson.id },
      data: {
        sceneImageUrl,
        symbols: symbolsWithImages,
      },
    });

    revalidatePath("/");
    return { ok: true, lessonId: lesson.id };
  } catch (err) {
    console.error("generateLesson failed:", err);
    const message =
      err instanceof Error ? err.message : "Something went wrong generating the lesson.";
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
      createdAt: true,
    },
  });

  return lessons.map((l) => ({
    ...l,
    createdAt: l.createdAt.toISOString(),
  }));
}

export async function getLesson(id: string): Promise<LessonDetail | null> {
  const lesson = await db.lesson.findUnique({ where: { id } });
  if (!lesson) return null;

  return {
    id: lesson.id,
    topic: lesson.topic,
    sceneName: lesson.sceneName,
    contentType: lesson.contentType,
    sceneImageUrl: lesson.sceneImageUrl,
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
