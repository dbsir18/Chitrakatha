"use client";

import { useState } from "react";
import Link from "next/link";
import { BookOpen, Flame, Trophy } from "lucide-react";
import { saveQuizSession } from "@/app/actions/lessons";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { QuizQuestionValue } from "@/lib/ai/schema";

export function QuizRunner({
  lessonId,
  sceneName,
  questions,
}: {
  lessonId: string;
  sceneName: string;
  questions: QuizQuestionValue[];
}) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [finished, setFinished] = useState(false);
  const [saved, setSaved] = useState(false);

  const total = questions.length;
  const question = questions[index];
  const isLast = index === total - 1;
  const hasAnswered = selected !== null;

  function selectOption(optionIndex: number) {
    if (hasAnswered) return;
    setSelected(optionIndex);
  }

  async function next() {
    const newAnswers = [...answers, selected as number];
    setAnswers(newAnswers);
    setSelected(null);

    if (isLast) {
      const score = newAnswers.filter((a, i) => a === questions[i].correctIndex).length;
      setFinished(true);
      if (!saved) {
        setSaved(true);
        await saveQuizSession(lessonId, newAnswers, score, total);
      }
    } else {
      setIndex((i) => i + 1);
    }
  }

  function restart() {
    setIndex(0);
    setSelected(null);
    setAnswers([]);
    setFinished(false);
    setSaved(false);
  }

  if (finished) {
    const score = answers.filter((a, i) => a === questions[i].correctIndex).length;
    const pct = Math.round((score / total) * 100);
    const ResultIcon = pct >= 80 ? Trophy : pct >= 50 ? Flame : BookOpen;
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-gold-300/40 text-gold-600">
          <ResultIcon className="size-8" strokeWidth={1.75} />
        </div>
        <h1 className="font-heading text-2xl font-semibold text-ink-900">
          You scored {score} / {total}
        </h1>
        <p className="text-muted-foreground">
          {pct >= 80
            ? "Excellent recall! The symbols are sticking."
            : pct >= 50
              ? "Good start - revisit the symbols that tripped you up."
              : "Head back to the Symbol Explorer for another pass."}
        </p>
        <div className="flex w-full flex-col sm:flex-row gap-3">
          <Button
            render={<Link href={`/lessons/${lessonId}/symbols`} />}
            variant="outline"
            className="flex-1 h-11"
          >
            Review Symbols
          </Button>
          <Button onClick={restart} variant="outline" className="flex-1 h-11">
            Retake Quiz
          </Button>
          <Button
            render={<Link href="/" />}
            className="flex-1 h-11 bg-ink-600 hover:bg-ink-700 text-white"
          >
            New Lesson
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-2">
        <Link
          href={`/lessons/${lessonId}`}
          className="text-sm text-muted-foreground hover:text-ink-600 w-fit"
        >
          ← Back to {sceneName}
        </Link>
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Question {index + 1} of {total}
          </span>
        </div>
        <Progress value={((index + (hasAnswered ? 1 : 0)) / total) * 100} />
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm flex flex-col gap-5">
        <h2 className="font-heading text-lg font-semibold text-ink-900 leading-snug">
          {question.question}
        </h2>

        <div className="flex flex-col gap-3">
          {question.options.map((option, i) => {
            const isCorrect = i === question.correctIndex;
            const isSelected = i === selected;
            const showState = hasAnswered;

            return (
              <button
                key={i}
                type="button"
                onClick={() => selectOption(i)}
                disabled={hasAnswered}
                className={cn(
                  "text-left rounded-xl border px-4 py-3 text-sm font-medium transition-colors",
                  !showState && "border-border hover:border-ink-400 hover:bg-ink-50",
                  showState && isCorrect && "border-emerald-400 bg-emerald-50 text-emerald-900",
                  showState && isSelected && !isCorrect && "border-red-400 bg-red-50 text-red-900",
                  showState && !isSelected && !isCorrect && "border-border text-muted-foreground"
                )}
              >
                {option}
              </button>
            );
          })}
        </div>

        {hasAnswered && (
          <div className="rounded-xl bg-secondary/60 border border-border p-4 text-sm text-secondary-foreground leading-relaxed">
            <span className="font-semibold text-ink-900">
              {selected === question.correctIndex ? "Correct — " : "Not quite — "}
            </span>
            {question.explanation}
          </div>
        )}

        <Button
          onClick={next}
          disabled={!hasAnswered}
          className="h-11 bg-ink-600 hover:bg-ink-700 text-white"
        >
          {isLast ? "See results" : "Next question →"}
        </Button>
      </div>
    </div>
  );
}
