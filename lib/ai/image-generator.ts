import { put } from "@vercel/blob";
import type { HydratedSymbol } from "@/lib/ai/schema";

// ── Shared style header ──────────────────────────────────────────────────────
// Mirrors the STYLE block in reports/beta-blockers-prompt-test/prompt-v2.txt.
// Applied to BOTH the full-scene and individual symbol prompts.
const STYLE_BLOCK = `STYLE (apply to the entire image, no exceptions):
A single wide hand-painted gouache and colored-pencil storybook illustration. Visible brush and pencil texture, hatching, and canvas grain throughout — this must read as traditionally painted, NOT flat digital cartoon art, NOT cel-shaded, NOT flat vector illustration, NOT a glossy CGI render, NOT airbrushed-smooth plastic skin. Naturalistic varied color palette with true blacks and cool tones present (avoid an overall orange/sepia/amber cast). Soft even studio lighting, no lens flare, no bokeh blur, no vignette. Ink-outlined linework with imperfect, confident hand-drawn lines. Every character has a distinct face, age, body type, and posture — no two characters may look alike. Realistic hands with five fingers. Absolutely no legible text, letters, numbers, or watermarks anywhere in the image.`;

// ── Scene image prompt builder ───────────────────────────────────────────────
// Mirrors the exact structure of prompt-v2.txt:
//   STYLE → FORMAT → SETTING → REQUIRED ELEMENTS checklist → FINAL CHECK
// The numbered checklist explicitly tells the image model what to include,
// which dramatically improves coverage vs. a freeform paragraph description.
function buildScenePrompt(setting: string, symbols: HydratedSymbol[]): string {
  const elements = symbols
    .map((s, i) => `${i + 1}. ${s.visualDescription}`)
    .join("\n");

  return `${STYLE_BLOCK}

FORMAT: Widescreen, 16:9 landscape composition — the image must be noticeably wider than it is tall. Do not generate a portrait or square image.

SETTING: ${setting}

REQUIRED ELEMENTS — include ALL ${symbols.length} of the following as separate, clearly distinguishable vignettes placed around the scene. Treat this as a checklist: every single item must be visually present and identifiable on its own, even without a caption. No two items may be drawn to look like duplicates of each other.

${elements}

FINAL CHECK: Before finishing, verify all ${symbols.length} numbered elements above are present, none are merged together, none are duplicated to look identical, and the overall image is wide (16:9), not portrait or square.`;
}

// ── Symbol prompt builder ────────────────────────────────────────────────────
// For individual 1:1 symbol images, we use a simpler structure:
// STYLE + FORMAT + the symbol's own imagePrompt.
function buildSymbolPrompt(imagePrompt: string): string {
  return `${STYLE_BLOCK}

FORMAT: Square 1:1 composition, centered subject on a plain neutral background.

${imagePrompt}`;
}

function getOpenRouterKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Add it to your .env file before generating a lesson."
    );
  }
  return key;
}

// "scene" → 16:9 wide (the hero illustration), "symbol" → 1:1 square (flip-card icon).
// The caller is responsible for building the full structured prompt via
// buildScenePrompt() or buildSymbolPrompt() before passing it here.
async function generateImageB64(
  prompt: string,
  role: "scene" | "symbol"
): Promise<string> {
  const key = getOpenRouterKey();
  const res = await fetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://chitrakatha.app",
      "X-Title": "Chitrakatha",
    },
    body: JSON.stringify({
      model: "qwen/qwen-image-3-pro",
      prompt,
      resolution: role === "scene" ? "2K" : "1K",
      aspect_ratio: role === "scene" ? "16:9" : "1:1",
      n: 1,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Qwen image generation failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as { data: { b64_json: string }[] };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("Qwen image generation returned no data.");
  }
  return b64;
}

async function uploadToBlob(pathname: string, b64: string): Promise<string> {
  const buffer = Buffer.from(b64, "base64");
  const { url } = await put(pathname, buffer, {
    access: "public",
    contentType: "image/png",
  });
  return url;
}

export async function generateSceneImage(
  lessonId: string,
  setting: string,
  symbols: HydratedSymbol[]
): Promise<string> {
  const prompt = buildScenePrompt(setting, symbols);
  const b64 = await generateImageB64(prompt, "scene");
  return uploadToBlob(`lessons/${lessonId}/scene.png`, b64);
}

/** Simple concurrency-limited map so we don't blow past image-API rate limits. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}

export type LibraryLookup = Map<
  string,
  { referenceImageUrl: string | null; displayName: string; description: string }
>;

export type ResolvedSymbol = {
  symbol: HydratedSymbol;
  imageUrl: string;
  isNewLibraryEntry: boolean;
};

/**
 * For each symbol: if it's flagged as reused AND we actually have that concept
 * in the library with a stored image, reuse that exact CDN URL (no API call,
 * guarantees the same crab-means-cancer look every time). Otherwise generate a
 * fresh isolated symbol image and upload to Vercel Blob.
 */
export async function resolveSymbolImages(
  symbols: HydratedSymbol[],
  library: LibraryLookup
): Promise<ResolvedSymbol[]> {
  return mapWithConcurrency(symbols, 5, async (symbol) => {
    const existing = library.get(symbol.conceptKey);
    if (symbol.isReused && existing?.referenceImageUrl) {
      return {
        symbol,
        imageUrl: existing.referenceImageUrl,
        isNewLibraryEntry: false,
      };
    }

    try {
      const b64 = await generateImageB64(buildSymbolPrompt(symbol.imagePrompt), "symbol");
      const url = await uploadToBlob(`library/${symbol.conceptKey}.png`, b64);
      return { symbol, imageUrl: url, isNewLibraryEntry: true };
    } catch (err) {
      console.error(`Symbol image failed for "${symbol.conceptKey}":`, err);
      return { symbol, imageUrl: "", isNewLibraryEntry: false };
    }
  });
}
