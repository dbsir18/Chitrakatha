"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, PenLine } from "lucide-react";
import { toast } from "sonner";
import { approveStory, reviseStory } from "@/app/actions/lessons";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * The review gate: shown while a lesson is `reviewing` — the story is
 * persisted and the scene image (the paid step) waits for the user.
 * Feedback runs one story-editor revision pass; approve flips the lesson
 * to `painting` and kicks the image.
 */
export function ReviewPanel({ lessonId }: { lessonId: string }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState("");
  const [revising, startRevision] = useTransition();
  const [approving, startApproval] = useTransition();

  function handleRevise() {
    if (!feedback.trim()) {
      toast.error("Tell the story editor what to change first.");
      return;
    }
    startRevision(async () => {
      const result = await reviseStory(lessonId, feedback);
      if (result.ok) {
        toast.success("Story revised — read the new version below.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Revision failed.");
      }
    });
  }

  function handleApprove() {
    startApproval(async () => {
      const result = await approveStory(lessonId);
      if (result.ok) {
        toast.success("Approved — painting the scene now.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Approval failed.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-gold-500/40 bg-gold-500/5 p-5 sm:p-6">
      <div className="flex items-center gap-2 text-ink-800">
        <PenLine className="size-4" strokeWidth={1.75} />
        <p className="text-sm font-semibold">
          Your story is ready — review it before the scene gets painted.
        </p>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Read the story and legend below. Leave notes for the story editor and
        revise as many times as you like — the scene image is only generated
        once you approve.
      </p>
      <Textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="e.g. make the side effects feel more like consequences of the battle, give the antagonist a stronger entrance…"
        className="min-h-24 text-sm"
      />
      <div className="flex flex-col sm:flex-row gap-3">
        <Button
          onClick={handleRevise}
          disabled={revising || approving}
          variant="outline"
          className="flex-1 h-11 gap-2"
        >
          {revising ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <PenLine className="size-4" />
          )}
          {revising ? "Revising the story…" : "Revise story"}
        </Button>
        <Button
          onClick={handleApprove}
          disabled={revising || approving}
          className="flex-1 h-11 gap-2 bg-ink-600 hover:bg-ink-700 text-white"
        >
          {approving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          {approving ? "Starting the painting…" : "Approve & paint the scene"}
        </Button>
      </div>
    </div>
  );
}
