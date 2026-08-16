import OpenAI from "openai";

let openaiClient: OpenAI | null = null;
let openrouterClient: OpenAI | null = null;

// Only used when LLM_MODEL is a plain OpenAI slug (e.g. "gpt-4o").
// With the default LLM_MODEL=deepseek/deepseek-v4-flash this is never called.
export function getOpenAI(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY is not set. Required when LLM_MODEL is an OpenAI model (e.g. gpt-4o)."
      );
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

/**
 * Returns an OpenAI-compatible client + model name for scene design, driven
 * by the LLM_MODEL env var.
 *
 * - Any model containing "/" (e.g. "deepseek/deepseek-v4-flash",
 *   "google/gemini-3.7-flash") routes through OpenRouter using
 *   OPENROUTER_API_KEY.
 * - Everything else (e.g. "gpt-4o") uses the standard OpenAI client.
 *
 * Default: "gpt-4o" (falls back to OpenAI if LLM_MODEL is unset).
 */
export function getLLMClient(): { client: OpenAI; model: string } {
  const model = process.env.LLM_MODEL ?? "deepseek/deepseek-v4-flash";

  if (model.includes("/")) {
    if (!openrouterClient) {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error(
          `LLM_MODEL is "${model}" (OpenRouter) but OPENROUTER_API_KEY is not set.`
        );
      }
      openrouterClient = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey,
        defaultHeaders: {
          "HTTP-Referer": "https://chitrakatha.app",
          "X-Title": "Chitrakatha",
        },
      });
    }
    return { client: openrouterClient, model };
  }

  return { client: getOpenAI(), model };
}
