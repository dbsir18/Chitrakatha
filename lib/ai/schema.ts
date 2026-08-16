import { z } from "zod";

export const ContentTypeSchema = z.enum([
  "drug_profile",
  "organism_list",
  "drug_hierarchy",
  "general",
]);
export type ContentTypeValue = z.infer<typeof ContentTypeSchema>;

export const SymbolCategorySchema = z.enum([
  "mechanism",
  "use",
  "side_effect",
  "dosing",
  "organism",
  "feature",
  "potency",
  "example",
  "other",
]);

export const SymbolSchema = z.object({
  name: z
    .string()
    .nullable()
    .describe(
      "Short punchy descriptor for the symbol, e.g. 'Furious kid clinging to food' or 'Cracked crab'. REQUIRED if isReused is false. Set to null if isReused is true - the canonical name is pulled automatically from the existing dictionary entry, do not repeat it."
    ),
  medicalFact: z
    .string()
    .describe(
      "The exact medical fact this symbol encodes. Must be a real fact from the provided content."
    ),
  visualDescription: z
    .string()
    .nullable()
    .describe(
      "The canonical, detailed visual description of what this symbol looks like - precise enough that redrawing it later from this text alone would look the same (pose, colors, objects, expression). 2-3 sentences. REQUIRED if isReused is false. Set to null if isReused is true."
    ),
  imagePrompt: z
    .string()
    .nullable()
    .describe(
      "A standalone, detailed prompt to generate an isolated illustration of just this symbol on a plain background, in the shared house illustration style. REQUIRED if isReused is false. Set to null if isReused is true."
    ),
  category: SymbolCategorySchema,
  conceptKey: z
    .string()
    .describe(
      "Short, generic, snake_case key for the underlying CLINICAL CONCEPT this symbol represents, independent of which drug/organism/lesson it's attached to (e.g. 'cancer', 'hyperkalemia', 'hepatotoxicity', 'psoriasis'). If this matches a key from the EXISTING SYMBOL DICTIONARY provided, use that exact key. If new, invent a short reusable key other future lessons could match too."
    ),
  isReused: z
    .boolean()
    .describe(
      "True if conceptKey matches an entry from the EXISTING SYMBOL DICTIONARY (name/visualDescription/imagePrompt will be hydrated automatically from that entry - leave them null). False if this is a newly invented symbol (name/visualDescription/imagePrompt required)."
    ),
  groupName: z
    .string()
    .describe(
      "The specific drug, organism, or tier within this lesson's content that this symbol belongs to (e.g. 'Furosemide', 'Cetuximab', 'Super-high potency'). If the content is about a single subject, use that subject's name for every symbol."
    ),
  isGroupIntro: z
    .boolean()
    .describe(
      "True only for the single symbol that first introduces `groupName` into the scene's narrative sequence (this item gets bolded in the legend, like Sketchy does). False for all other symbols in that group."
    ),
});
export type SymbolValue = z.infer<typeof SymbolSchema>;

/** A symbol after the library-hydration pass, where name/visualDescription/
 * imagePrompt are guaranteed to be filled in (either by the model directly,
 * or copied from the matched SymbolLibrary entry). This is the shape every
 * downstream consumer (image generation, DB storage, UI) should use. */
export type HydratedSymbol = Omit<
  SymbolValue,
  "name" | "visualDescription" | "imagePrompt"
> & {
  name: string;
  visualDescription: string;
  imagePrompt: string;
};

export const QuizQuestionSchema = z.object({
  question: z.string(),
  options: z
    .array(z.string())
    .length(4)
    .describe("Exactly 4 answer options."),
  correctIndex: z
    .number()
    .int()
    .min(0)
    .max(3)
    .describe("Index (0-3) of the correct option in `options`."),
  explanation: z
    .string()
    .describe(
      "Why the answer is correct, referencing the symbol/scene detail that encodes it."
    ),
});
export type QuizQuestionValue = z.infer<typeof QuizQuestionSchema>;

export const SceneDesignSchema = z.object({
  contentType: ContentTypeSchema,
  reasoning: z
    .string()
    .describe(
      "Internal reasoning, not shown to the user. For each fact in the content, in order: (1) name the fact, (2) check the EXISTING SYMBOL DICTIONARY for a matching clinical concept and state whether reusing it or inventing a new one, (3) if new, name the symbol. Do this thinking FIRST, then write setting/narrative/symbols to match it exactly."
    ),
  sceneName: z
    .string()
    .describe(
      "A short, punny, memorable name for this memory palace scene, e.g. 'The Metro Taxi', 'Loop de Loop of Henle'."
    ),
  setting: z
    .string()
    .describe(
      "A vivid 2-4 sentence description of the memory palace setting/world - one single cohesive location big enough to hold every symbol."
    ),
  narrative: z
    .string()
    .describe(
      "A 2-3 paragraph story walking through the scene like a guided tour, weaving in every symbol in sequence. Absurd, funny, and memorable. Every symbol from `symbols` must be mentioned in the order it appears in the array."
    ),
  sceneImagePrompt: z
    .string()
    .describe(
      "A single, richly detailed prompt for ONE wide illustration containing ALL symbols together in the scene, laid out so every symbol is visible and identifiable, in the shared house illustration style. Explicitly re-describe every reused symbol using its exact canonical visualDescription so recurring characters look consistent. No text or labels in the image."
    ),
  symbols: z
    .array(SymbolSchema)
    .min(6)
    .max(32)
    .describe(
      "6-32 symbols, one per key fact from the provided content, in the exact order they're introduced in the narrative. Cover EVERY fact given - do not summarize or skip facts. If the content covers multiple drugs/organisms/tiers, include all of them in this one scene."
    ),
  quizQuestions: z
    .array(QuizQuestionSchema)
    .min(4)
    .max(8)
    .describe("4-8 multiple choice questions testing recall of the provided content."),
});
export type SceneDesignValue = z.infer<typeof SceneDesignSchema>;

export type ExistingSymbolEntry = {
  conceptKey: string;
  displayName: string;
  description: string;
  category: string;
};
