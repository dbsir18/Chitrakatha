import Link from "next/link";
import Image from "next/image";
import { ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { LessonSummary } from "@/lib/types";

const CONTENT_TYPE_LABEL: Record<LessonSummary["contentType"], string> = {
  drug_profile: "Drug profile",
  organism_list: "Organism list",
  drug_hierarchy: "Hierarchy",
  general: "General",
};

export function LessonCard({ lesson }: { lesson: LessonSummary }) {
  return (
    <Link
      href={`/lessons/${lesson.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 hover:border-ink-300"
    >
      <div className="relative aspect-[3/2] w-full bg-secondary">
        {lesson.sceneImageUrl ? (
          <Image
            src={lesson.sceneImageUrl}
            alt={lesson.sceneName}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 33vw"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <ImageIcon className="size-8" strokeWidth={1.5} />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <Badge variant="secondary" className="w-fit text-[10px] uppercase tracking-wide">
          {CONTENT_TYPE_LABEL[lesson.contentType]}
        </Badge>
        <h3 className="font-heading font-semibold text-ink-900 leading-snug group-hover:text-ink-600 transition-colors">
          {lesson.sceneName}
        </h3>
        <p className="text-sm text-muted-foreground">{lesson.topic}</p>
      </div>
    </Link>
  );
}
