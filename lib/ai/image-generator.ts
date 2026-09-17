import { put } from "@vercel/blob";
import { db } from "@/lib/db";
import type { HydratedSymbol } from "@/lib/ai/schema";

/**
 * A failure a retry cannot fix — retrying would only re-bill the image API
 * with no chance of success (bad request, auth/credit problem, unusable
 * response, or a generation too slow to fit the serverless step budget).
 * The Inngest layer converts this to NonRetriableError so the run fails
 * fast instead of burning credits on retries.
 */
export class NonRetryableImageError extends Error {}

// Must stay comfortably under the 300s serverless request budget so a step
// can fail with a classified error (and stage nothing) instead of being
// killed by the platform mid-generation.
const GENERATE_TIMEOUT_MS = 240_000;

// ── Shared style header ──────────────────────────────────────────────────────
// Mirrors the STYLE block in reports/beta-blockers-prompt-test/prompt-v2.txt.
// Applied to the scene prompt.
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

function getOpenRouterKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Add it to your .env file before generating a lesson."
    );
  }
  return key;
}

// "scene" → 16:9 wide (the hero illustration), "symbol" → 1:1 square. The
// caller is responsible for building the full structured prompt via
// buildScenePrompt() before passing it here.
async function generateImageB64(
  prompt: string,
  role: "scene" | "symbol"
): Promise<string> {
  const key = getOpenRouterKey();
  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/images", {
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
      signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      // A generation this slow will never fit the step budget; a retry would
      // re-bill and time out the same way.
      throw new NonRetryableImageError(
        `Image generation timed out after ${GENERATE_TIMEOUT_MS / 1000}s — too slow for the serverless step budget.`
      );
    }
    throw err;
  }

  if (!res.ok) {
    const body = await res.text();
    const message = `Qwen image generation failed (${res.status}): ${body}`;
    // 4xx (except 429 rate-limit) will not fix themselves on a retry —
    // retrying only re-bills. Fail the run instead.
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      throw new NonRetryableImageError(message);
    }
    throw new Error(message);
  }

  const json = (await res.json()) as { data: { b64_json: string }[] };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) {
    // The request was billed but the response is unusable; a retry would
    // re-bill for the same shape.
    throw new NonRetryableImageError("Qwen image generation returned no data.");
  }
  return b64;
}

async function uploadToBlob(pathname: string, b64: string): Promise<string> {
  const buffer = Buffer.from(b64, "base64");
  const { url } = await put(pathname, buffer, {
    access: "public",
    contentType: "image/png",
    // The Blob SDK only auto-reads the unprefixed BLOB_READ_WRITE_TOKEN,
    // but Vercel namespaces linked store variables by the store's name
    // (this store's are BLOB1_*). Prefer the canonical name if it ever
    // exists, else the store's namespaced one.
    token:
      process.env.BLOB_READ_WRITE_TOKEN ??
      process.env.BLOB1_READ_WRITE_TOKEN,
  });
  return url;
}

// ── Paid-image staging ───────────────────────────────────────────────────────
// Every generated image's bytes are persisted to Postgres the moment they
// arrive — BEFORE the Blob upload. A retried step finds the staged bytes and
// only re-attempts the (free) upload, so each image is paid for at most once,
// no matter what breaks downstream. Rows are deleted once the Blob upload
// succeeds; the Blob store is the durable home.

async function obtainImageB64(
  key: string,
  prompt: string,
  role: "scene" | "symbol"
): Promise<string> {
  const staged = await db.stagedImage.findUnique({ where: { key } });
  if (staged) return staged.b64;

  const b64 = await generateImageB64(prompt, role);
  await db.stagedImage.upsert({
    where: { key },
    create: { key, b64 },
    update: { b64 },
  });
  return b64;
}

async function uploadStaged(
  pathname: string,
  key: string,
  b64: string
): Promise<string> {
  const url = await uploadToBlob(pathname, b64);
  await db.stagedImage.delete({ where: { key } }).catch(() => {
    // Already gone — nothing to clean up.
  });
  return url;
}

export async function generateSceneImage(
  lessonId: string,
  setting: string,
  symbols: HydratedSymbol[]
): Promise<string> {
  const prompt = buildScenePrompt(setting, symbols);
  const key = `lesson/${lessonId}/scene`;
  const b64 = await obtainImageB64(key, prompt, "scene");
  return uploadStaged(`lessons/${lessonId}/scene.png`, key, b64);
}
