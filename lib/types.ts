import type { ContentTypeValue, HydratedSymbol, QuizQuestionValue } from "@/lib/ai/schema";

export type SymbolWithImage = HydratedSymbol & {
  imageUrl: string;
};

export type LessonSummary = {
  id: string;
  topic: string;
  sceneName: string;
  contentType: ContentTypeValue;
  sceneImageUrl: string | null;
  createdAt: string;
};

export type LessonDetail = LessonSummary & {
  rawContent: string;
  setting: string;
  narrative: string;
  symbols: SymbolWithImage[];
  quizQuestions: QuizQuestionValue[];
};
