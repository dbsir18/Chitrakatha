import OpenAI from "openai";

// Route through OpenRouter if OPENAI_API_KEY is absent but OPENROUTER_API_KEY
// is present. OpenRouter proxies OpenAI models, so we get the exact same
// text-embedding-3-small output (1536 dims) without a separate OpenAI account.
// If neither key is set, embedding calls throw and callers fall back gracefully.
const EMBEDDING_MODEL = "openai/text-embedding-3-small";

let embeddingClient: OpenAI | null = null;

function getEmbeddingClient(): OpenAI {
  if (embeddingClient) return embeddingClient;

  if (process.env.OPENAI_API_KEY) {
    embeddingClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return embeddingClient;
  }

  const orKey = process.env.OPENROUTER_API_KEY;
  if (orKey) {
    embeddingClient = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: orKey,
      defaultHeaders: {
        "HTTP-Referer": "https://chitrakatha.app",
        "X-Title": "Chitrakatha",
      },
    });
    return embeddingClient;
  }

  throw new Error(
    "No embedding key found. Set OPENROUTER_API_KEY (or OPENAI_API_KEY) in your .env file."
  );
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const client = getEmbeddingClient();
  const model = process.env.OPENAI_API_KEY ? "text-embedding-3-small" : EMBEDDING_MODEL;
  const result = await client.embeddings.create({ model, input: texts });
  return result.data.map((d) => d.embedding);
}

export async function embedText(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text]);
  return embedding;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
