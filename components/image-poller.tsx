"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Silently refreshes the current page every 8 seconds so the server component
 * re-fetches the lesson from DB. Drop this into the lesson page when
 * sceneImageUrl is null (images still being painted in the background).
 * The parent server component will stop rendering it once images are ready.
 */
export function ImagePoller() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(id);
  }, [router]);

  return null;
}
