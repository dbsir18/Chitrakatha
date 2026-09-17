import { NonRetriableError } from "inngest";
import { revalidatePath } from "next/cache";
import { inngest } from "@/lib/inngest/client";
import { NonRetryableImageError } from "@/lib/ai/image-generator";
import {
  claimLesson,
  completeLesson,
  ensureDesign,
  ensureSceneImage,
  markLessonFailed,
  refreshLessonLease,
  releaseLesson,
} from "@/lib/ai/pipeline";

/**
 * Runs one step's work, then revalidates the lesson pages.
 *
 * - Converts a NonRetryableImageError into Inngest's NonRetriableError so
 *   the run fails on the first attempt instead of retrying. Retrying a
 *   hopeless generation (bad request, auth/credit problem, unusable
 *   response, timeout) only re-bills the image API.
 * - Revalidates even when the step throws, because a failed pass may still
 *   have persisted partial work, and the lessons list is statically
 *   prerendered — the background run must explicitly mark it stale or it
 *   keeps showing the state from the last user action.
 */
async function runStep<T>(
  lessonId: string,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof NonRetryableImageError) {
      throw new NonRetriableError(err.message);
    }
    throw err;
  } finally {
    revalidatePath("/lessons");
    revalidatePath(`/lessons/${lessonId}`);
  }
}

/**
 * Durable lesson generation. Every step persists its result before the next
 * one begins, and every step re-checks the DB, so retries, crashes, and
 * replays never re-pay for completed work.
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

    await step.run("scene", async () => {
      await refreshLessonLease(lessonId);
      return runStep(lessonId, () =>
        ensureSceneImage(lessonId, design.setting, design.symbols)
      );
    });

    const status = await step.run("complete", async () => {
      const result = await completeLesson(lessonId);
      await releaseLesson(lessonId);
      revalidatePath("/lessons");
      revalidatePath(`/lessons/${lessonId}`);
      return result;
    });

    return { status };
  }
);
