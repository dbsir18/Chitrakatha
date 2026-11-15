/**
 * Seeds the SymbolLibrary from the distilled Sketchy vocabulary
 * (data/sketchy/symbol-vocabulary.json).
 *
 * Usage: npx tsx scripts/seed-symbol-library.ts [--dry-run]
 *
 * - Skips conceptKeys that already exist (never clobbers user-generated entries).
 * - Embeds `${displayName}: ${description}` with text-embedding-3-small via
 *   OpenRouter, mirroring the pipeline's own new-concept embedding text
 *   (lib/ai/pipeline.ts) so seeded rows are similarity-findable the same way.
 * - Seeds with usageCount 0: the column tracks in-app reuse, and book
 *   occurrences stay recorded in the source JSON, not the DB.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const dryRun = process.argv.includes("--dry-run");

// Minimal .env loader (no dotenv dependency). Must run before lib/db is
// imported, since the PrismaClient reads DATABASE_URL at module scope.
async function loadDotEnv() {
  if (process.env.DATABASE_URL) return;
  const raw = await readFile(path.join(process.cwd(), ".env"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
    }
  }
}

type VocabEntry = {
  conceptKey: string;
  displayName: string;
  description: string;
  category: string;
  covers: number;
  occurrences: number;
};

async function main() {
  await loadDotEnv();
  const { db } = await import("../lib/db");
  const { embedTexts } = await import("../lib/ai/embeddings");

  const vocab: VocabEntry[] = JSON.parse(
    await readFile(
      path.join(process.cwd(), "data/sketchy/symbol-vocabulary.json"),
      "utf8"
    )
  );

  const existing = await db.symbolLibrary.findMany({
    select: { conceptKey: true },
  });
  const existingKeys = new Set(existing.map((r) => r.conceptKey));
  const fresh = vocab.filter((v) => !existingKeys.has(v.conceptKey));

  console.log(
    `vocabulary: ${vocab.length} entries; already in DB: ${existing.length}; to seed: ${fresh.length}`
  );
  if (dryRun) {
    console.log("dry run - no changes made");
    return;
  }
  if (fresh.length === 0) {
    console.log("nothing to seed");
    return;
  }

  const BATCH = 64;
  let seeded = 0;
  for (let i = 0; i < fresh.length; i += BATCH) {
    const batch = fresh.slice(i, i + BATCH);
    const texts = batch.map((v) => `${v.displayName}: ${v.description}`);

    let embeddings: number[][];
    try {
      embeddings = await embedTexts(texts);
    } catch (err) {
      console.error(
        `embedding batch at ${i} failed, retrying once:`,
        String(err).slice(0, 140)
      );
      await new Promise((r) => setTimeout(r, 3000));
      embeddings = await embedTexts(texts);
    }

    const rows = batch.map((v, j) => ({
      conceptKey: v.conceptKey,
      displayName: v.displayName,
      description: v.description,
      imagePrompt: "",
      category: v.category,
      referenceImageUrl: null,
      embedding: embeddings[j],
      usageCount: 0,
    }));

    const res = await db.symbolLibrary.createMany({
      data: rows,
      skipDuplicates: true,
    });
    seeded += res.count;
    console.log(`  seeded ${seeded}/${fresh.length}`);
  }

  const total = await db.symbolLibrary.count();
  console.log(
    `done. seeded ${seeded} new rows; library now has ${total} entries`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
