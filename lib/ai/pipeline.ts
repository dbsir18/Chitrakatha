import { db } from "@/lib/db";
import { designScene } from "@/lib/ai/scene-designer";
import {
  generateSceneImage,
  mapWithConcurrency,
  resolveSymbolImage,
  type LibraryLookup,
} from "@/lib/ai/image-generator";
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

/** True when any paid work remains: design, scene image, or symbol images. */
export function hasPendingWork(lesson: {
  status: string;
  sceneImageUrl: string | null;
  symbols: unknown;
}): boolean {
  if (lesson.status === "designing" || lesson.status === "failed") return true;
  if (!lesson.sceneImageUrl) return true;
  return parseStoredSymbols(lesson.symbols).some((s) => !s.imageUrl);
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
 * A wave of symbol images (at most 5 at a time, matching the image-API
 * concurrency limit). Each symbol's URL is persisted the moment it lands, so
 * a crash or retry mid-wave loses at most the single in-flight call.
 *
 * `chunk` names the symbols this call owns; which of them still need work is
 * decided from the DB, so a retried wave only pays for the still-missing
 * symbols. Throws after the wave settles if any symbol failed — the
 * successes are already persisted.
 */
export async function ensureSymbolImages(
  lessonId: string,
  chunk: StoredSymbol[]
): Promise<{ resolved: number }> {
  const lesson = await db.lesson.findUnique({ where: { id: lessonId } });
  if (!lesson) throw new Error(`Lesson ${lessonId} not found.`);

  // The DB array is authoritative; the chunk only selects which entries this
  // wave owns.
  const symbolsState = parseStoredSymbols(lesson.symbols);
  const pending = chunk.filter(
    (s) => !symbolsState.find((x) => x.conceptKey === s.conceptKey)?.imageUrl
  );
  if (pending.length === 0) return { resolved: 0 };

  const libraryRows = await db.symbolLibrary.findMany();
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

  // Serialized persistence for the symbols JSON column: concurrent workers
  // mutate symbolsState synchronously, then queue their DB write on this
  // chain so updates apply in order and the last write always includes every
  // mutation before it. A failed link is swallowed here and healed by the
  // final write below.
  let persistChain: Promise<unknown> = Promise.resolve();
  const queuePersist = () => {
    const write = () =>
      db.lesson.update({ where: { id: lessonId }, data: { symbols: symbolsState } });
    persistChain = persistChain.then(write, write);
    return persistChain;
  };

  try {
    await mapWithConcurrency(pending, 5, async (symbol) => {
      // Throws on failure — the executor retries this wave, and the DB check
      // above means the retry only pays for still-missing symbols.
      const resolved = await resolveSymbolImage(symbol, lookup);

      const idx = symbolsState.findIndex((s) => s.conceptKey === symbol.conceptKey);
      if (idx >= 0) {
        symbolsState[idx] = { ...resolved.symbol, imageUrl: resolved.imageUrl };
      }

      try {
        await queuePersist();
      } catch (err) {
        console.error(`Failed to persist symbol URL for "${symbol.conceptKey}":`, err);
      }

      // Library bookkeeping per symbol, crash-safe: a failure here doesn't
      // lose the image (already persisted above), only the library entry.
      try {
        if (resolved.isNewLibraryEntry && resolved.imageUrl) {
          // Recompute the embedding at upsert time so the library row stays
          // similarity-findable even on a resumed pass.
          const embedding = await embedText(
            `${resolved.symbol.name}: ${resolved.symbol.visualDescription}`
          ).catch(() => undefined);
          await db.symbolLibrary.upsert({
            where: { conceptKey: resolved.symbol.conceptKey },
            create: {
              conceptKey: resolved.symbol.conceptKey,
              displayName: resolved.symbol.name,
              description: resolved.symbol.visualDescription,
              imagePrompt: resolved.symbol.imagePrompt,
              category: resolved.symbol.category,
              referenceImageUrl: resolved.imageUrl,
              embedding,
            },
            update: { referenceImageUrl: resolved.imageUrl },
          });
        } else if (!resolved.isNewLibraryEntry && resolved.imageUrl) {
          await db.symbolLibrary
            .update({
              where: { conceptKey: resolved.symbol.conceptKey },
              data: { usageCount: { increment: 1 } },
            })
            .catch(() => undefined);
        }
      } catch (err) {
        console.error(`Library bookkeeping failed for "${resolved.symbol.conceptKey}":`, err);
      }
    });
  } catch (err) {
    // mapWithConcurrency rethrows the first failure after every item has
    // settled; the recount below reports the full picture.
    console.error("Symbol image wave had failures:", err);
  }

  // Heal write: publish the full array, covering any per-symbol persist that
  // failed above.
  await db.lesson
    .update({ where: { id: lessonId }, data: { symbols: symbolsState } })
    .catch(() => undefined);

  const stillMissing = pending.filter(
    (s) => !symbolsState.find((x) => x.conceptKey === s.conceptKey)?.imageUrl
  );
  if (stillMissing.length > 0) {
    throw new Error(
      `${stillMissing.length} of ${chunk.length} symbol image(s) failed: ${stillMissing
        .map((s) => s.conceptKey)
        .join(", ")}`
    );
  }

  return { resolved: pending.length };
}

/**
 * The completion phase: verifies the DB state and marks the lesson `ready`
 * (scene + every symbol image persisted) or `failed` with a description of
 * the gaps. Everything already generated stays saved either way.
 */
export async function completeLesson(lessonId: string): Promise<"ready" | "failed"> {
  const lesson = await db.lesson.findUnique({ where: { id: lessonId } });
  if (!lesson) throw new Error(`Lesson ${lessonId} not found.`);

  const symbols = parseStoredSymbols(lesson.symbols);
  const missing = symbols.filter((s) => !s.imageUrl);

  if (lesson.sceneImageUrl && missing.length === 0) {
    await db.lesson.update({
      where: { id: lessonId },
      data: { status: "ready", error: null },
    });
    return "ready";
  }

  const parts: string[] = [];
  if (!lesson.sceneImageUrl) parts.push("the scene image");
  if (missing.length > 0) {
    parts.push(`${missing.length} of ${symbols.length} symbol images`);
  }
  await db.lesson.update({
    where: { id: lessonId },
    data: {
      status: "failed",
      error: `Generation incomplete — ${parts.join(" and ")} failed. Everything else is saved; retry to fill the gaps.`,
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

  const storedSymbols = parseStoredSymbols(lesson.symbols);
  if (
    lesson.status === "ready" &&
    !!lesson.sceneImageUrl &&
    storedSymbols.every((s) => s.imageUrl)
  ) {
    return; // nothing to do
  }

  // ── Phase 1: design ──────────────────────────────────────────────────────
  let setting = lesson.setting;
  let symbolsState: StoredSymbol[] = [...storedSymbols];
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

  // ── Phases 2 + 3: scene image and symbol images ──────────────────────────
  // Both run concurrently, but each persists independently the moment it
  // lands, so partial progress is never lost. Failures here leave gaps that
  // the completion phase reports — this executor does not retry
  // automatically; the manual retry button (or a fresh poller kick) does.
  await Promise.all([
    ensureSceneImage(lessonId, setting, symbolsState).catch((err) => {
      console.error("Scene image generation failed:", err);
    }),
    ensureSymbolImages(lessonId, symbolsState).catch((err) => {
      console.error("Symbol image pass failed:", err);
    }),
  ]);

  // ── Completion ───────────────────────────────────────────────────────────
  await completeLesson(lessonId);
}
