import { getLessons, getSymbolLibraryStats } from "@/app/actions/lessons";
import { LessonForm } from "@/components/lesson-form";
import { LessonCard } from "@/components/lesson-card";

export default async function Home() {
  const [lessons, libraryStats] = await Promise.all([
    getLessons(),
    getSymbolLibraryStats(),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-14 flex flex-col gap-14">
      <section className="flex flex-col gap-4 text-center max-w-2xl mx-auto">
        <span className="mx-auto text-xs font-semibold uppercase tracking-[0.2em] text-gold-600">
          Method of Loci, illustrated
        </span>
        <h1 className="font-heading text-4xl sm:text-5xl font-semibold tracking-tight text-ink-900 text-balance">
          Turn any content into a memory palace
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          Paste a drug profile, a list of causative organisms, or a potency hierarchy.
          Chitrakatha designs one scene, gives every fact a symbol you can see, and
          quizzes your recall - the same symbol always means the same thing, everywhere.
        </p>
        {libraryStats.totalConcepts > 0 && (
          <p className="text-xs text-ink-500 font-medium">
            {libraryStats.totalConcepts} symbols in your universe so far · reused{" "}
            {libraryStats.totalReuses} times across lessons
          </p>
        )}
      </section>

      <section className="max-w-2xl mx-auto w-full">
        <LessonForm />
      </section>

      {lessons.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="font-heading text-lg font-semibold text-ink-900">
            Your lessons
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {lessons.map((lesson) => (
              <LessonCard key={lesson.id} lesson={lesson} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
