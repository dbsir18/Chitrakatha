"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * While a lesson is still generating (designing/painting), every 8 seconds:
 *   1. POST /api/lessons/[id]/continue — resumes the pipeline if a previous
 *      pass was interrupted (each resume only does the missing work), and
 *   2. router.refresh() — re-render the server component with fresh DB state.
 * The parent stops rendering this component once the lesson is ready or
 * failed.
 */
export function ProgressPoller({ lessonId }: { lessonId: string }) {
  const router = useRouter();

  useEffect(() => {
    const tick = async () => {
      try {
        await fetch(`/api/lessons/${lessonId}/continue`, { method: "POST" });
      } catch {
        // transient network error — the next tick retries
      }
      router.refresh();
    };

    const id = setInterval(tick, 8000);
    return () => clearInterval(id);
  }, [lessonId, router]);

  return null;
}
