import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, ImageIcon, LayoutGrid, Sparkles } from "lucide-react";
import { getLesson } from "@/app/actions/lessons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const CONTENT_TYPE_LABEL: Record<string, string> = {
  drug_profile: "Drug profile",
  organism_list: "Organism list",
  drug_hierarchy: "Hierarchy",
  general: "General",
};

export default async function LessonPage({ params }: PageProps<"/lessons/[id]">) {
  const { id } = await params;
  const lesson = await getLesson(id);
  if (!lesson) notFound();

  const symbols = lesson.symbols;
  const half = Math.ceil(symbols.length / 2);
  const columns = [symbols.slice(0, half), symbols.slice(half)];

  const groupNames = Array.from(new Set(symbols.map((s) => s.groupName)));

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-10 flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link href="/" className="text-sm text-muted-foreground hover:text-ink-600 w-fit">
          ← Back to lessons
        </Link>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
            {CONTENT_TYPE_LABEL[lesson.contentType]}
          </Badge>
          <span className="text-sm text-muted-foreground">{lesson.topic}</span>
        </div>
        <h1 className="font-heading text-3xl sm:text-4xl font-semibold tracking-tight text-ink-900">
          {lesson.sceneName}
        </h1>
      </div>

      <div className="relative aspect-[3/2] w-full overflow-hidden rounded-2xl border border-border bg-secondary shadow-sm">
        {lesson.sceneImageUrl ? (
          <Image
            src={lesson.sceneImageUrl}
            alt={lesson.sceneName}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 800px"
            priority
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <ImageIcon className="size-10" strokeWidth={1.5} />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm">
        <div className="flex items-center gap-2 text-ink-700">
          <LayoutGrid className="size-4" strokeWidth={1.75} />
          <p className="text-sm font-semibold">{groupNames.join(", ")}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5 text-sm text-foreground/90">
          {columns.map((col, colIdx) => (
            <ol key={colIdx} className="flex flex-col gap-2.5">
              {col.map((symbol, i) => {
                const number = colIdx === 0 ? i + 1 : half + i + 1;
                return (
                  <li
                    key={number}
                    className={cn(
                      "flex gap-2 leading-snug",
                      symbol.isGroupIntro && "border-l-2 border-gold-500 pl-2 -ml-2.5"
                    )}
                  >
                    <span className="text-muted-foreground shrink-0 tabular-nums">
                      {number}.
                    </span>
                    <span className={cn(symbol.isGroupIntro && "font-semibold text-ink-900")}>
                      {symbol.name}: {symbol.medicalFact}
                    </span>
                  </li>
                );
              })}
            </ol>
          ))}
        </div>
      </div>

      <details className="group rounded-2xl border border-border bg-secondary/40 p-5 sm:p-6">
        <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-muted-foreground group-open:text-ink-600 flex items-center gap-2">
          <Sparkles className="size-3.5" />
          Read the full story
        </summary>
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-foreground/90 leading-relaxed">{lesson.setting}</p>
          <p className="text-foreground/90 leading-relaxed whitespace-pre-line">
            {lesson.narrative}
          </p>
        </div>
      </details>

      <div className="flex flex-col sm:flex-row gap-3 sticky bottom-4">
        <Button
          render={<Link href={`/lessons/${lesson.id}/symbols`} />}
          className="flex-1 h-12 text-base bg-ink-600 hover:bg-ink-700 text-white"
        >
          Review Symbol Explorer
        </Button>
        <Button
          render={<Link href={`/lessons/${lesson.id}/quiz`} />}
          variant="outline"
          className="flex-1 h-12 text-base"
        >
          Take the Quiz
        </Button>
        <Button
          render={
            <a
              href={`/api/lessons/${lesson.id}/pdf`}
              download
              target="_blank"
              rel="noopener noreferrer"
            />
          }
          variant="outline"
          className="h-12 gap-2 text-base sm:flex-none px-4"
          aria-label="Download PDF"
        >
          <Download className="size-4" />
          PDF
        </Button>
      </div>
    </div>
  );
}
