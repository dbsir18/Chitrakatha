import { NonRetriableError } from "inngest";
import { inngest } from "@/lib/inngest/client";
import { NonRetryableImageError } from "@/lib/ai/image-generator";
import {
  claimLesson,
  completeLesson,
  ensureDesign,
  ensureSceneImage,
  ensureSymbolImages,
  markLessonFailed,
  refreshLessonLease,
  releaseLesson,
  type StoredSymbol,
} from "@/lib/ai/pipeline";

/**
 * Converts a NonRetryableImageError into Inngest's NonRetriableError so the
 * run fails on the first attempt instead of retrying. Retrying a hopeless
 * generation (bad request, auth/credit problem, unusable response, timeout)
 * only re-bills the image API — the exact failure mode that burned credits
 * while the Blob upload was broken.
 */
async function failFast<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof NonRetryableImageError) {
      throw new NonRetriableError(err.message);
    }
    throw err;
  }
}

/**
 * Symbols per step. Matches the image-API concurrency limit (5), so each step
 * is one in-process wave of generation — small enough to fit comfortably
 * inside a single serverless invocation, and a retry of the step only pays
 * for the symbols that are still missing.
 */
const SYMBOLS_PER_STEP = 5;

function chunkSymbols(symbols: StoredSymbol[], size: number): StoredSymbol[][] {
  const chunks: StoredSymbol[][] = [];
  for (let i = 0; i < symbols.length; i += size) {
    chunks.push(symbols.slice(i, i + size));
  }
  return chunks;
}

/**
 * Durable lesson generation. Every step persists its result before the next
 * one begins, and every step re-checks the DB, so retries, crashes, and
 * replays never re-pay for completed work. Step IDs are derived from the
 * memoized design output, which keeps them deterministic across replays.
 *
 * The lease is claimed for the run and refreshed by every step, which keeps
 * the lesson page's poller (the fallback executor) from overlapping this
 * run; if this run dies without releasing, the lease self-expires and the
 * poller takes over.
 */
export const generateLessonFunction = inngest.createFunction(
  {
    id: "lesson-generate",
    name: "Lesson generation",
    retries: 3,
    triggers: [{ event: "lesson/generate" }],
    onFailure: async ({ event, error }) => {
      const lessonId = (event.data.event.data as { lessonId?: string }).lessonId;
      if (!lessonId) return;
      await markLessonFailed(
        lessonId,
        `Generation failed after retries: ${error.message}`
      );
      await releaseLesson(lessonId);
    },
  },
  async ({ event, step }) => {
    const lessonId = (event.data as { lessonId: string }).lessonId;

    // Claim the lease so the poller's fallback pass never overlaps this run.
    // If the poller claimed first, its pass owns the lesson — exit quietly.
    const claimed = await step.run("claim", () => claimLesson(lessonId));
    if (!claimed) return { status: "busy" };

    const design = await step.run("design", async () => {
      await refreshLessonLease(lessonId);
      return ensureDesign(lessonId);
    });

    const chunks = chunkSymbols(design.symbols, SYMBOLS_PER_STEP);

    // The scene image and the first symbol wave run in parallel; each
    // persists independently the moment it lands.
    await Promise.all([
      step.run("scene", async () => {
        await refreshLessonLease(lessonId);
        return failFast(() =>
          ensureSceneImage(lessonId, design.setting, design.symbols)
        );
      }),
      chunks.length > 0
        ? step.run("symbols-0", async () => {
            await refreshLessonLease(lessonId);
            return failFast(() => ensureSymbolImages(lessonId, chunks[0]));
          })
        : Promise.resolve(null),
    ]);

    for (let i = 1; i < chunks.length; i++) {
      await step.run(`symbols-${i}`, async () => {
        await refreshLessonLease(lessonId);
        return failFast(() => ensureSymbolImages(lessonId, chunks[i]));
      });
    }

    const status = await step.run("complete", async () => {
      const result = await completeLesson(lessonId);
      await releaseLesson(lessonId);
      return result;
    });

    return { status };
  }
);
