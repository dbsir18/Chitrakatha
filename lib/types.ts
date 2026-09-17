import type { ContentTypeValue, HydratedSymbol, QuizQuestionValue } from "@/lib/ai/schema";

export type SymbolWithImage = HydratedSymbol & {
  imageUrl: string;
};

export type LessonStatusValue = "designing" | "painting" | "ready" | "failed";

export type LessonSummary = {
  id: string;
  topic: string;
  sceneName: string;
  contentType: ContentTypeValue;
  sceneImageUrl: string | null;
  createdAt: string;
  status: LessonStatusValue;
};

export type LessonDetail = LessonSummary & {
  error: string | null;
  rawContent: string;
  setting: string;
  narrative: string;
  symbols: SymbolWithImage[];
  quizQuestions: QuizQuestionValue[];
};
