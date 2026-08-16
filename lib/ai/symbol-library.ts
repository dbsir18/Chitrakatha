import { db } from "@/lib/db";
import { cosineSimilarity, embedText, embedTexts } from "@/lib/ai/embeddings";
import type { ExistingSymbolEntry, HydratedSymbol, SymbolValue } from "@/lib/ai/schema";

// Cap on how many existing symbols get dumped into the scene-designer prompt.
// Below this, the model just sees the whole library. Above it, we retrieve
// only the most semantically relevant slice so prompt (input token) cost
// doesn't grow unbounded as the library scales into the hundreds.
const MAX_DICTIONARY_ENTRIES = 50;

// Cosine-similarity floor for treating a "new" symbol as secretly a
// duplicate of an existing concept the model's own fuzzy text matching
// missed (e.g. because the dictionary was truncated, or it just didn't
// notice "malignancy" == "cancer").
const REUSE_SIMILARITY_THRESHOLD = 0.86;

type LibraryRow = {
  conceptKey: string;
  displayName: string;
  description: string;
  imagePrompt: string;
  category: string;
  referenceImageUrl: string | null;
  embedding: number[] | null;
};

export type SymbolLibraryContext = {
  /** Narrowed slice actually sent to the LLM prompt. */
  forPrompt: ExistingSymbolEntry[];
  /** Full library, used for hydration + the embedding backstop below. */
  rows: LibraryRow[];
};

function toPromptEntries(rows: LibraryRow[]): ExistingSymbolEntry[] {
  return rows.map((r) => ({
    conceptKey: r.conceptKey,
    displayName: r.displayName,
    description: r.description,
    category: r.category,
  }));
}

function hasEmbedding(row: LibraryRow): row is LibraryRow & { embedding: number[] } {
  return Array.isArray(row.embedding) && row.embedding.length > 0;
}

/** Loads the shared symbol universe and, once it's large, retrieves only the
 * entries most relevant to this lesson's content instead of all of them. */
export async function loadSymbolLibrary(
  topic: string,
  rawContent: string
): Promise<SymbolLibraryContext> {
  const dbRows = await db.symbolLibrary.findMany();
  const rows: LibraryRow[] = dbRows.map((r) => ({
    conceptKey: r.conceptKey,
    displayName: r.displayName,
    description: r.description,
    imagePrompt: r.imagePrompt,
    category: r.category,
    referenceImageUrl: r.referenceImageUrl,
    embedding: (r.embedding as number[] | null) ?? null,
  }));

  if (rows.length <= MAX_DICTIONARY_ENTRIES) {
    return { forPrompt: toPromptEntries(rows), rows };
  }

  try {
    const queryEmbedding = await embedText(`${topic}\n${rawContent}`.slice(0, 6000));
    const ranked = rows
      .map((row) => ({
        row,
        score: hasEmbedding(row) ? cosineSimilarity(queryEmbedding, row.embedding) : 0,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_DICTIONARY_ENTRIES)
      .map((x) => x.row);
    return { forPrompt: toPromptEntries(ranked), rows };
  } catch (err) {
    console.error("Symbol library retrieval embedding failed, using most-recently-used slice:", err);
    return { forPrompt: toPromptEntries(rows.slice(0, MAX_DICTIONARY_ENTRIES)), rows };
  }
}

export type HydratedSymbolResult = {
  symbol: HydratedSymbol;
  /** True if this concept doesn't exist in the library yet and needs a fresh image + library row. */
  isNewConcept: boolean;
  /** Embedding computed during the backstop check, reused to avoid a second API call when saving a new concept. */
  embedding: number[] | null;
};

function titleCase(key: string): string {
  return key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Turns the model's raw symbol list into fully-hydrated symbols:
 * 1. Exact conceptKey match against the library -> copy name/description/
 *    imagePrompt from the stored entry (never trust the model to repeat
 *    them - this is both cheaper and guarantees pixel-identical continuity).
 * 2. No exact match -> embed the symbol and compare against every library
 *    entry. A close enough match means the model missed a real duplicate;
 *    treat it as reused anyway instead of paying for + generating a new image.
 * 3. Still no match -> genuinely new concept. Requires the model to have
 *    supplied name/visualDescription/imagePrompt; if it didn't (a stale
 *    isReused:true guess with nothing to fall back on), degrade gracefully
 *    instead of failing the whole lesson.
 */
export async function hydrateSymbols(
  rawSymbols: SymbolValue[],
  library: LibraryRow[]
): Promise<HydratedSymbolResult[]> {
  const byKey = new Map(library.map((r) => [r.conceptKey, r]));
  const withEmbeddings = library.filter(hasEmbedding);

  const results: HydratedSymbolResult[] = new Array(rawSymbols.length);
  const pendingIndexes: number[] = [];

  rawSymbols.forEach((symbol, index) => {
    const exact = symbol.isReused ? byKey.get(symbol.conceptKey) : undefined;
    if (exact) {
      results[index] = {
        symbol: {
          ...symbol,
          conceptKey: exact.conceptKey,
          name: exact.displayName,
          visualDescription: exact.description,
          imagePrompt: exact.imagePrompt || exact.description,
          isReused: true,
        },
        isNewConcept: false,
        embedding: null,
      };
    } else {
      pendingIndexes.push(index);
    }
  });

  if (pendingIndexes.length > 0) {
    let queryEmbeddings: number[][] | null = null;
    try {
      const queryTexts = pendingIndexes.map((i) => {
        const s = rawSymbols[i];
        return `${s.name ?? s.conceptKey}: ${s.visualDescription ?? s.medicalFact}`;
      });
      queryEmbeddings = await embedTexts(queryTexts);
    } catch (err) {
      console.error("Embedding backstop lookup failed, treating unmatched symbols as new:", err);
    }

    pendingIndexes.forEach((index, i) => {
      const symbol = rawSymbols[index];
      const queryEmbedding = queryEmbeddings?.[i] ?? null;

      let bestMatch: { row: LibraryRow & { embedding: number[] }; score: number } | null = null;
      if (queryEmbedding) {
        for (const row of withEmbeddings) {
          const score = cosineSimilarity(queryEmbedding, row.embedding);
          if (!bestMatch || score > bestMatch.score) bestMatch = { row, score };
        }
      }

      if (bestMatch && bestMatch.score >= REUSE_SIMILARITY_THRESHOLD) {
        results[index] = {
          symbol: {
            ...symbol,
            conceptKey: bestMatch.row.conceptKey,
            name: bestMatch.row.displayName,
            visualDescription: bestMatch.row.description,
            imagePrompt: bestMatch.row.imagePrompt || bestMatch.row.description,
            isReused: true,
          },
          isNewConcept: false,
          embedding: null,
        };
        return;
      }

      if (!symbol.name || !symbol.visualDescription || !symbol.imagePrompt) {
        console.warn(
          `Symbol "${symbol.conceptKey}" was marked reused but no library match was found; falling back to a generated description.`
        );
      }
      const name = symbol.name ?? titleCase(symbol.conceptKey);
      const visualDescription =
        symbol.visualDescription ?? `A symbol representing: ${symbol.medicalFact}`;
      const imagePrompt = symbol.imagePrompt ?? visualDescription;

      results[index] = {
        symbol: { ...symbol, name, visualDescription, imagePrompt, isReused: false },
        isNewConcept: true,
        embedding: queryEmbedding,
      };
    });
  }

  return results;
}
