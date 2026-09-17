import { notFound, redirect } from "next/navigation";
import { getLesson } from "@/app/actions/lessons";
import { QuizRunner } from "@/components/quiz-runner";

export default async function QuizPage({ params }: PageProps<"/lessons/[id]/quiz">) {
  const { id } = await params;
  const lesson = await getLesson(id);
  if (!lesson) notFound();
  // No quiz until the design phase has completed.
  if (lesson.quizQuestions.length === 0) redirect(`/lessons/${id}`);

  return (
    <QuizRunner
      lessonId={lesson.id}
      sceneName={lesson.sceneName}
      questions={lesson.quizQuestions}
    />
  );
}
