import Link from "next/link";
import Image from "next/image";
import { CheckCircle2, Clock, ExternalLink, ImageIcon, Images } from "lucide-react";
import { getLessonsWithStatus } from "@/app/actions/lessons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RetryImagesButton } from "@/components/retry-images-button";

const CONTENT_TYPE_LABEL: Record<string, string> = {
  drug_profile: "Drug profile",
  organism_list: "Organism list",
  drug_hierarchy: "Hierarchy",
  general: "General",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function LessonsPage() {
  const lessons = await getLessonsWithStatus();

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-10 flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Link href="/" className="text-sm text-muted-foreground hover:text-ink-600 w-fit">
          ← Home
        </Link>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-ink-900">
          My Lessons
        </h1>
        <p className="text-sm text-muted-foreground">
          {lessons.length === 0
            ? "No lessons yet."
            : `${lessons.length} lesson${lessons.length === 1 ? "" : "s"} generated`}
        </p>
      </div>

      {lessons.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-20 text-center text-muted-foreground">
          <ImageIcon className="size-10" strokeWidth={1.25} />
          <p className="text-sm">
            You haven&apos;t generated any lessons yet.{" "}
            <Link href="/" className="underline hover:text-ink-600">
              Create your first one.
            </Link>
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {lessons.map((lesson) => {
            const imagesComplete =
              !!lesson.sceneImageUrl && lesson.symbolsWithImages === lesson.symbolsTotal;
            const imagesPending = !imagesComplete;
            const symbolsComplete = lesson.symbolsWithImages === lesson.symbolsTotal;

            return (
              <div
                key={lesson.id}
                className="flex flex-col sm:flex-row gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm"
              >
                {/* Thumbnail */}
                <Link
                  href={`/lessons/${lesson.id}`}
                  className="relative aspect-[3/2] sm:aspect-auto sm:w-40 shrink-0 overflow-hidden rounded-xl bg-secondary border border-border"
                >
                  {lesson.sceneImageUrl ? (
                    <Image
                      src={lesson.sceneImageUrl}
                      alt={lesson.sceneName}
                      fill
                      className="object-cover"
                      sizes="160px"
                    />
                  ) : (
                    <div className="flex h-full min-h-[80px] items-center justify-center text-muted-foreground">
                      <ImageIcon className="size-6" strokeWidth={1.5} />
                    </div>
                  )}
                </Link>

                {/* Info */}
                <div className="flex flex-1 flex-col gap-2 min-w-0">
                  <div className="flex items-start gap-2 justify-between">
                    <div className="flex flex-col gap-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge
                          variant="secondary"
                          className="text-[10px] uppercase tracking-wide shrink-0"
                        >
                          {CONTENT_TYPE_LABEL[lesson.contentType]}
                        </Badge>
                        <span className="text-xs text-muted-foreground truncate">
                          {lesson.topic}
                        </span>
                      </div>
                      <Link
                        href={`/lessons/${lesson.id}`}
                        className="font-heading font-semibold text-ink-900 hover:text-ink-600 transition-colors leading-snug"
                      >
                        {lesson.sceneName}
                      </Link>
                    </div>
                  </div>

                  {/* Status row */}
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    {/* Scene image status */}
                    <span
                      className={`flex items-center gap-1 font-medium ${
                        lesson.sceneImageUrl
                          ? "text-emerald-600"
                          : "text-amber-600"
                      }`}
                    >
                      {lesson.sceneImageUrl ? (
                        <CheckCircle2 className="size-3.5" />
                      ) : (
                        <Clock className="size-3.5" />
                      )}
                      Scene image
                    </span>

                    {/* Symbol image status */}
                    <span
                      className={`flex items-center gap-1 font-medium ${
                        symbolsComplete ? "text-emerald-600" : "text-amber-600"
                      }`}
                    >
                      {symbolsComplete ? (
                        <CheckCircle2 className="size-3.5" />
                      ) : (
                        <Images className="size-3.5" />
                      )}
                      {lesson.symbolsWithImages} / {lesson.symbolsTotal} symbols
                    </span>

                    <span className="text-muted-foreground ml-auto">
                      {formatDate(lesson.createdAt)}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <Button
                      render={<Link href={`/lessons/${lesson.id}`} />}
                      variant="outline"
                      size="sm"
                      className="gap-1.5 h-8 text-xs"
                    >
                      <ExternalLink className="size-3" />
                      Open lesson
                    </Button>
                    {imagesPending && (
                      <RetryImagesButton lessonId={lesson.id} className="h-8 text-xs" />
                    )}
                    {imagesComplete && (
                      <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                        <CheckCircle2 className="size-3.5" />
                        All images ready
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
