import { notFound } from "next/navigation";
import { getLesson } from "@/app/actions/lessons";
import { SymbolExplorer } from "@/components/symbol-explorer";

export default async function SymbolsPage({ params }: PageProps<"/lessons/[id]/symbols">) {
  const { id } = await params;
  const lesson = await getLesson(id);
  if (!lesson) notFound();

  return (
    <SymbolExplorer
      lessonId={lesson.id}
      sceneName={lesson.sceneName}
      symbols={lesson.symbols}
    />
  );
}
