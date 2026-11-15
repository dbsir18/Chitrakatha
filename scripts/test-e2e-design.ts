/**
 * End-to-end design-phase test: exercises the exact production path a lesson
 * takes after generateLesson creates its row — claimLesson → ensureDesign →
 * releaseLesson (the same calls after()/Inngest make). Skips the scene-image
 * phase (needs BLOB_READ_WRITE_TOKEN, unavailable locally), so the lesson
 * ends in the honest "painting" state with all designed text persisted.
 *
 * Usage: npx tsx scripts/test-e2e-design.ts [topic] [content-file]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const TOPIC = process.argv[2] ?? "Tetracyclines";
const CONTENT_FILE = process.argv[3];

const DEFAULT_CONTENT = `
Drug class: Tetracyclines
Examples: tetracycline, doxycycline, minocycline

Mechanism:
- Bind the 30S ribosomal subunit, blocking aminoacyl-tRNA entry (bacteriostatic)

Uses:
- Acne (doxycycline, minocycline first-line)
- Lyme disease (doxycycline)
- Rocky Mountain spotted fever (doxycycline first-line)
- Chlamydia infections

Side effects:
- Photosensitivity (doxycycline most)
- GI upset, esophageal erosion if taken without water ("pill esophagitis")
- Tooth discoloration and impaired bone growth in children and fetuses
- Vertigo (minocycline)

Contraindications:
- Pregnancy and children under 8
`.trim();

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

async function main() {
  await loadDotEnv();
  const CONTENT = CONTENT_FILE
    ? (await readFile(path.isAbsolute(CONTENT_FILE) ? CONTENT_FILE : path.join(process.cwd(), CONTENT_FILE), "utf8")).trim()
    : DEFAULT_CONTENT;
  const { db } = await import("../lib/db");
  const { claimLesson, releaseLesson, ensureDesign } = await import("../lib/ai/pipeline");

  // Same row shape generateLesson creates (app/actions/lessons.ts:41-55).
  const lesson = await db.lesson.create({
    data: {
      topic: TOPIC,
      rawContent: CONTENT,
      sceneName: "",
      setting: "",
      narrative: "",
      sceneImagePrompt: "",
      symbols: [],
      quizQuestions: [],
      status: "designing",
    },
  });
  console.log(`lesson created: ${lesson.id} (status designing)`);

  if (!(await claimLesson(lesson.id))) {
    throw new Error("could not claim lesson (lease held)");
  }
  try {
    await ensureDesign(lesson.id);
  } finally {
    await releaseLesson(lesson.id);
  }

  const after = await db.lesson.findUnique({ where: { id: lesson.id } });
  const symbols = (after?.symbols as Array<{ name?: string; isReused?: boolean; groupName?: string }>) ?? [];
  const reused = symbols.filter((s) => s.isReused).map((s) => s.name);
  console.log(`\nafter ensureDesign:`);
  console.log(`  status: ${after?.status}`);
  console.log(`  scene: "${after?.sceneName}"`);
  console.log(`  symbols: ${symbols.length} total, ${reused.length} reused from the Sketchy KB`);
  console.log(`  reused: ${reused.slice(0, 12).join(", ")}`);
  console.log(`  quiz questions: ${(after?.quizQuestions as unknown[])?.length ?? 0}`);
  console.log(`\nLESSON_ID=${lesson.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
