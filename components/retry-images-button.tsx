"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { retryLessonImages } from "@/app/actions/lessons";
import { cn } from "@/lib/utils";

export function RetryImagesButton({
  lessonId,
  className,
}: {
  lessonId: string;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);

  async function handleRetry() {
    setLoading(true);
    const result = await retryLessonImages(lessonId);
    setLoading(false);
    if (result.ok) {
      toast.success("Image generation queued. This page will update automatically.");
    } else {
      toast.error(result.error ?? "Failed to queue image generation.");
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleRetry}
      disabled={loading}
      className={cn("gap-2", className)}
    >
      <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
      {loading ? "Queuing…" : "Retry Images"}
    </Button>
  );
}
