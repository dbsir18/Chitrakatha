"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, ArrowRight, ImageIcon } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SymbolWithImage } from "@/lib/types";

const CATEGORY_LABEL: Record<string, string> = {
  mechanism: "Mechanism",
  use: "Use",
  side_effect: "Side effect",
  dosing: "Dosing",
  organism: "Organism",
  feature: "Feature",
  potency: "Potency",
  example: "Example",
  other: "Other",
};

export function SymbolExplorer({
  lessonId,
  sceneName,
  symbols,
}: {
  lessonId: string;
  sceneName: string;
  symbols: SymbolWithImage[];
}) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const total = symbols.length;
  const symbol = symbols[index];
  const isLast = index === total - 1;

  const goNext = useCallback(() => {
    setFlipped(false);
    setIndex((i) => Math.min(i + 1, total - 1));
  }, [total]);

  const goPrev = useCallback(() => {
    setFlipped(false);
    setIndex((i) => Math.max(i - 1, 0));
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goNext, goPrev]);

  if (!symbol) return null;

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
            Symbol {index + 1} of {total}
          </span>
          <span className="text-muted-foreground/70">Space to flip · ← → to move</span>
        </div>
        <Progress value={((index + 1) / total) * 100} />
      </div>

      <div
        className={cn("flip-card w-full aspect-[4/5] cursor-pointer", flipped && "is-flipped")}
        onClick={() => setFlipped((f) => !f)}
      >
        <div className="flip-card-inner">
          <div className="flip-card-face front rounded-2xl border border-border bg-card shadow-md overflow-hidden flex flex-col">
            <div className="relative flex-1 bg-secondary">
              {symbol.imageUrl ? (
                <Image
                  src={symbol.imageUrl}
                  alt={symbol.name}
                  fill
                  className="object-cover"
                  sizes="600px"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  <ImageIcon className="size-10" strokeWidth={1.5} />
                </div>
              )}
            </div>
            <div className="flex flex-col items-center gap-2 p-4 text-center">
              <Badge variant="outline" className="text-[10px]">
                {CATEGORY_LABEL[symbol.category] ?? symbol.category}
              </Badge>
              <p className="font-heading font-semibold text-lg text-ink-900">{symbol.name}</p>
              <p className="text-xs text-muted-foreground">Tap to reveal the fact</p>
            </div>
          </div>

          <div className="flip-card-face back rounded-2xl border border-gold-400/60 bg-ink-50 shadow-md overflow-hidden flex flex-col items-center justify-center p-8 text-center gap-4">
            <Badge className="bg-ink-600 text-white text-[10px]">
              {CATEGORY_LABEL[symbol.category] ?? symbol.category}
            </Badge>
            <p className="font-heading text-xl font-semibold text-ink-900 leading-snug">
              {symbol.medicalFact}
            </p>
            <p className="text-sm text-ink-700/80 leading-relaxed">
              {symbol.visualDescription}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="outline"
          onClick={goPrev}
          disabled={index === 0}
          className="flex-1 h-11 gap-1.5"
        >
          <ArrowLeft className="size-4" /> Previous
        </Button>
        {isLast ? (
          <Button
            render={<Link href={`/lessons/${lessonId}/quiz`} />}
            className="flex-1 h-11 bg-ink-600 hover:bg-ink-700 text-white gap-1.5"
          >
            Start Quiz <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Button
            onClick={goNext}
            className="flex-1 h-11 bg-ink-600 hover:bg-ink-700 text-white gap-1.5"
          >
            Next <ArrowRight className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
