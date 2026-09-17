import { db } from "@/lib/db";
import { designScene } from "@/lib/ai/scene-designer";
import { generateSceneImage } from "@/lib/ai/image-generator";
import { hydrateSymbols, loadSymbolLibrary } from "@/lib/ai/symbol-library";
import { embedText } from "@/lib/ai/embeddings";
import type { HydratedSymbol } from "@/lib/ai/schema";

/** A symbol as stored in the Lesson.symbols JSON column. */
export type StoredSymbol = HydratedSymbol & { imageUrl?: string };

export function parseStoredSymbols(raw: unknown): StoredSymbol[] {
  return Array.isArray(raw) ? (raw as StoredSymbol[]) : [];
}

// ── Lease ─────────────────────────────────────────────────────────────────────
// A DB lease so two executors never run overlapping passes on the same lesson
// (concurrent passes would race on the symbols JSON column and double-pay for
// images). A pass holds the lease for at most LEASE_MS; a crashed holder's
// lease self-expires and the next executor takes over.

const LEASE_MS = 10 * 60 * 1000;

export async function claimLesson(lessonId: string, force = false): Promise<boolean> {
  const result = await db.lesson.updateMany({
    where: force
      ? { id: lessonId }
      : {
          id: lessonId,
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }],
        },
    data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
  });
  return result.count === 1;
}

/** Unconditionally extends the lease — used by a run that already holds it. */
export async function refreshLessonLease(lessonId: string): Promise<void> {
  await db.lesson
    .updateMany({
      where: { id: lessonId },
      data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
    })
    .catch(() => undefined);
}

export async function releaseLesson(lessonId: string): Promise<void> {
  await db.lesson
    .updateMany({ where: { id: lessonId }, data: { leaseExpiresAt: null } })
    .catch(() => undefined);
}

// ── Predicates ────────────────────────────────────────────────────────────────

/** True when any paid work remains: the design or the scene image. */
export function hasPendingWork(lesson: {
  status: string;
  sceneImageUrl: string | null;
}): boolean {
  if (lesson.status === "designing" || lesson.status === "failed") return true;
  return !lesson.sceneImageUrl;
}

/**
 * Auto-continuation (page poller) only fires for in-flight states. `failed`
 * means a full pass already attempted and came up short — auto-retrying it
 * every 8 seconds would burn image credits on a persistent error, so failed
 * lessons wait for a manual retry.
 */
export function shouldAutoContinue(lesson: { status: string }): boolean {
  return lesson.status === "designing" || lesson.status === "painting";
}

// ── Phase primitives ───────────────────────────────────────────────────────────
// Each primitive is one complete, idempotent unit of work: it checks the DB,
// does at most the missing paid work, and persists its result BEFORE the next
// paid call begins. They throw on failure — the executor (an Inngest step or
// the after() fallback) decides whether and how to retry. Because every
// primitive re-checks the DB, a retry only ever pays for what is still
// missing; completed work is never re-paid.

export type DesignState = { setting: string; symbols: StoredSymbol[] };

/**
 * The design phase: one LLM call that produces the scene, narrative, legend,
 * and quiz. If the lesson is already designed, returns the stored state with
 * zero AI calls.
 */
export async function ensureDesign(lessonId: string): Promise<DesignState> {
  const lesson = await db.lesson.findUnique({ where: { id: lessonId } });
  if (!lesson) throw new Error(`Lesson ${lessonId} not found.`);

  if (lesson.narrative) {
    return { setting: lesson.setting, symbols: parseStoredSymbols(lesson.symbols) };
  }

  const { forPrompt: existingSymbols, rows: libraryRows } = await loadSymbolLibrary(
    lesson.topic,
    lesson.rawContent
  );
  const design = await designScene(lesson.topic, lesson.rawContent, existingSymbols);
  const hydrationResults = await hydrateSymbols(design.symbols, libraryRows);
  const hydratedSymbols = hydrationResults.map((r) => r.symbol);

  // Persist the designed text IMMEDIATELY: the expensive LLM result is never
  // lost to a later timeout, and the user can read it right away.
  await db.lesson.update({
    where: { id: lessonId },
    data: {
      contentType: design.contentType,
      sceneName: design.sceneName,
      setting: design.setting,
      narrative: design.narrative,
      sceneImagePrompt: design.sceneImagePrompt,
      symbols: hydratedSymbols,
      quizQuestions: design.quizQuestions,
      status: "painting",
      error: null,
    },
  });

  // Library bookkeeping, design-owned and failure-tolerant: recurring
  // concepts increment usageCount; genuinely new ones get their canonical
  // row. A bookkeeping error must never fail the lesson — the concept just
  // stays unrecorded until a later design includes it again.
  const total = hydrationResults.length;
  const reused = hydrationResults.filter((r) => !r.isNewConcept).length;
  console.log(
    `designed ${total} symbols: ${reused} reused from library, ${total - reused} new — 0 image calls`
  );
  for (const result of hydrationResults) {
    try {
      if (result.isNewConcept) {
        // Reuse the embedding hydration computed when present; re-embed via
        // embedText when missing so the row stays similarity-findable.
        const embedding =
          result.embedding ??
          (await embedText(
            `${result.symbol.name}: ${result.symbol.visualDescription}`
          ).catch(() => undefined));
        await db.symbolLibrary.create({
          data: {
            conceptKey: result.symbol.conceptKey,
            displayName: result.symbol.name,
            description: result.symbol.visualDescription,
            imagePrompt: result.symbol.imagePrompt,
            category: result.symbol.category,
            embedding,
          },
        });
      } else {
        await db.symbolLibrary.update({
          where: { conceptKey: result.symbol.conceptKey },
          data: { usageCount: { increment: 1 } },
        });
      }
    } catch (err) {
      console.error(
        `Library bookkeeping failed for "${result.symbol.conceptKey}":`,
        err
      );
    }
  }

  return { setting: design.setting, symbols: hydratedSymbols };
}

/**
 * The scene image: one image call, persisted the moment it uploads. Returns
 * the stored URL without any AI work if the scene already exists.
 */
export async function ensureSceneImage(
  lessonId: string,
  setting: string,
  symbols: StoredSymbol[]
): Promise<string> {
  const lesson = await db.lesson.findUnique({
    where: { id: lessonId },
    select: { sceneImageUrl: true },
  });
  if (lesson?.sceneImageUrl) return lesson.sceneImageUrl;

  const url = await generateSceneImage(lessonId, setting, symbols);
  await db.lesson.update({ where: { id: lessonId }, data: { sceneImageUrl: url } });
  return url;
}

/**
 * The completion phase: verifies the DB state and marks the lesson `ready`
 * (design + scene image persisted) or `failed` with a description of the
 * gap. Everything already generated stays saved either way.
 */
export async function completeLesson(lessonId: string): Promise<"ready" | "failed"> {
  const lesson = await db.lesson.findUnique({ where: { id: lessonId } });
  if (!lesson) throw new Error(`Lesson ${lessonId} not found.`);

  if (lesson.narrative && lesson.sceneImageUrl) {
    await db.lesson.update({
      where: { id: lessonId },
      data: { status: "ready", error: null },
    });
    return "ready";
  }

  await db.lesson.update({
    where: { id: lessonId },
    data: {
      status: "failed",
      error: "Generation incomplete — the scene image failed. Everything else is saved; retry to fill the gaps.",
    },
  });
  return "failed";
}

/** Terminal failure marker for executors whose retries were exhausted. */
export async function markLessonFailed(lessonId: string, message: string): Promise<void> {
  await db.lesson
    .update({ where: { id: lessonId }, data: { status: "failed", error: message } })
    .catch(() => undefined);
}

// ── The fallback executor ─────────────────────────────────────────────────────
//
// Runs the whole pipeline inside one long-lived after() callback. Used when
// Inngest is not configured (plain local dev) and as the poller's
// self-healing takeover when a durable run dies: the lease expiry is the
// handoff signal. Semantics are identical to the step executor above — the
// same primitives, composed in one pass with gaps reported at completion
// instead of per-step retries.

export async function processLesson(lessonId: string): Promise<void> {
  const lesson = await db.lesson.findUnique({ where: { id: lessonId } });
  if (!lesson) return;

  if (lesson.status === "ready" && !!lesson.sceneImageUrl) {
    return; // nothing to do
  }

  // ── Phase 1: design ──────────────────────────────────────────────────────
  let setting = lesson.setting;
  let symbolsState: StoredSymbol[] = parseStoredSymbols(lesson.symbols);
  if (!lesson.narrative) {
    try {
      const design = await ensureDesign(lessonId);
      setting = design.setting;
      symbolsState = design.symbols;
    } catch (err) {
      console.error("Scene design failed:", err);
      const message = err instanceof Error ? err.message : "Scene design failed.";
      await db.lesson
        .update({ where: { id: lessonId }, data: { status: "failed", error: message } })
        .catch(() => undefined);
      return;
    }
  }

  // ── Phase 2: scene image ──────────────────────────────────────────────────
  // Persisted the moment it lands, so partial progress is never lost. A
  // failure here leaves a gap that the completion phase reports — this
  // executor does not retry automatically; the manual retry button (or a
  // fresh poller kick) does.
  await ensureSceneImage(lessonId, setting, symbolsState).catch((err) => {
    console.error("Scene image generation failed:", err);
  });

  // ── Completion ───────────────────────────────────────────────────────────
  await completeLesson(lessonId);
}
