import { notFound, redirect } from "next/navigation";
import { getLesson } from "@/app/actions/lessons";
import { SymbolExplorer } from "@/components/symbol-explorer";

export default async function SymbolsPage({ params }: PageProps<"/lessons/[id]/symbols">) {
  const { id } = await params;
  const lesson = await getLesson(id);
  if (!lesson) notFound();
  // A lesson still in (or failed during) the design phase has no symbols yet.
  if (lesson.symbols.length === 0) redirect(`/lessons/${id}`);

  return (
    <SymbolExplorer
      lessonId={lesson.id}
      sceneName={lesson.sceneName}
      symbols={lesson.symbols}
    />
  );
}
