"use server";

import { after } from "next/server";
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
import type { ContentTypeValue, HydratedSymbol, QuizQuestionValue } from "@/lib/ai/schema";

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

    // ── Phase 1: save text content immediately, redirect user now ────────────
    // Image generation (scene + symbols) is expensive (5–12 min for large
    // lessons). We save the lesson with all text content first so the user
    // can read the narrative and legend right away, then fire images in the
    // background via after() so the HTTP response isn't held open.
    const lesson = await db.lesson.create({
      data: {
        topic: trimmedTopic,
        rawContent: trimmedContent,
        contentType: design.contentType,
        sceneName: design.sceneName,
        setting: design.setting,
        narrative: design.narrative,
        sceneImagePrompt: design.sceneImagePrompt,
        symbols: hydratedSymbols, // no imageUrl yet — added after image gen
        quizQuestions: design.quizQuestions,
        sceneImageUrl: null, // signals "images pending" to the lesson page
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

    // ── Phase 2: image generation runs after the response is sent ────────────
    // The lesson page polls (router.refresh every 8s) until sceneImageUrl
    // is no longer null, then shows the painted scene.
    after(async () => {
      try {
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
                update: { referenceImageUrl: r.imageUrl },
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
          data: { sceneImageUrl, symbols: symbolsWithImages },
        });
      } catch (err) {
        console.error("Background image generation failed:", err);
      }
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
      createdAt: true,
      symbols: true,
    },
  });

  return lessons.map((l) => {
    const symbols = l.symbols as (HydratedSymbol & { imageUrl?: string })[];
    return {
      id: l.id,
      topic: l.topic,
      sceneName: l.sceneName,
      contentType: l.contentType as ContentTypeValue,
      sceneImageUrl: l.sceneImageUrl,
      createdAt: l.createdAt.toISOString(),
      symbolsTotal: symbols.length,
      symbolsWithImages: symbols.filter((s) => !!s.imageUrl).length,
    };
  });
}

export async function retryLessonImages(
  lessonId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const lesson = await db.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) return { ok: false, error: "Lesson not found." };

    const storedSymbols = lesson.symbols as (HydratedSymbol & { imageUrl?: string })[];
    const needsSceneImage = !lesson.sceneImageUrl;
    const symbolsNeedingImages = storedSymbols.filter((s) => !s.imageUrl);

    if (!needsSceneImage && symbolsNeedingImages.length === 0) {
      return { ok: false, error: "All images are already generated for this lesson." };
    }

    const conceptKeys = symbolsNeedingImages.map((s) => s.conceptKey);
    const libraryRows =
      conceptKeys.length > 0
        ? await db.symbolLibrary.findMany({ where: { conceptKey: { in: conceptKeys } } })
        : [];

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

    after(async () => {
      try {
        const [newSceneImageUrl, resolvedSymbols] = await Promise.all([
          needsSceneImage
            ? generateSceneImage(
                lessonId,
                lesson.setting,
                storedSymbols as HydratedSymbol[]
              ).catch((err) => {
                console.error("Scene image retry failed:", err);
                return null;
              })
            : Promise.resolve(lesson.sceneImageUrl),
          symbolsNeedingImages.length > 0
            ? resolveSymbolImages(symbolsNeedingImages as HydratedSymbol[], lookup)
            : Promise.resolve([]),
        ]);

        const resolvedMap = new Map(
          resolvedSymbols.map((r) => [r.symbol.conceptKey, r.imageUrl])
        );
        const mergedSymbols: SymbolWithImage[] = storedSymbols.map((s) => ({
          ...s,
          imageUrl: s.imageUrl || resolvedMap.get(s.conceptKey) || "",
        }));

        await Promise.all(
          resolvedSymbols
            .filter((r) => r.isNewLibraryEntry && r.imageUrl)
            .map((r) =>
              db.symbolLibrary.upsert({
                where: { conceptKey: r.symbol.conceptKey },
                create: {
                  conceptKey: r.symbol.conceptKey,
                  displayName: r.symbol.name,
                  description: r.symbol.visualDescription,
                  imagePrompt: r.symbol.imagePrompt,
                  category: r.symbol.category,
                  referenceImageUrl: r.imageUrl,
                },
                update: { referenceImageUrl: r.imageUrl },
              })
            )
        );

        await db.lesson.update({
          where: { id: lessonId },
          data: { sceneImageUrl: newSceneImageUrl, symbols: mergedSymbols },
        });
      } catch (err) {
        console.error("Retry image generation failed:", err);
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
