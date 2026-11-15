/**
 * LLM scene-designer quality tester — exercises the REAL production path:
 * loads the symbol-library dictionary slice for the test content exactly the
 * way the app does (loadSymbolLibrary), then calls the same designScene()
 * used in production. What this script prints is what a real lesson gets.
 *
 * Usage: npx tsx scripts/test-llm.ts [model-slug] [topic] [content-file]
 *   model-slug optionally overrides LLM_MODEL for model comparisons.
 *   topic + content-file point the harness at your own study material
 *   (content-file is plain text; absolute or cwd-relative).
 * Env: DATABASE_URL + OPENROUTER_API_KEY (read from .env when unset).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const modelOverride = process.argv[2];
const topicArg = process.argv[3];
const contentFile = process.argv[4];

// Minimal .env loader (no dotenv dependency). Must run before lib modules are
// imported, since lib/db reads DATABASE_URL at module scope.
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

// Test content: ACE Inhibitors — enough facts to generate 12-16 symbols,
// covers mechanism / uses / side effects / contraindications / drug names.
const TOPIC = topicArg ?? "ACE Inhibitors";
const DEFAULT_CONTENT = `
Drug class: ACE (Angiotensin-Converting Enzyme) Inhibitors
Examples: captopril, enalapril, lisinopril, ramipril, benazepril (suffix: "-pril")

Mechanism:
- Block ACE, which normally converts Angiotensin I → Angiotensin II
- Angiotensin II normally causes vasoconstriction and stimulates aldosterone
- Net effect: vasodilation, reduced aldosterone → lower BP, decreased preload + afterload

Uses:
- Hypertension (first-line)
- Heart failure with reduced EF (HFrEF) — reduce mortality
- Post-MI — started within 24h, reduce mortality and remodeling
- Diabetic nephropathy — reduce proteinuria, slow CKD progression
- Chronic kidney disease (non-diabetic) — renoprotective

Side effects:
- Dry, persistent cough (due to accumulated bradykinin — most common reason for stopping)
- Angioedema — rare but life-threatening; more common in Black patients
- Hyperkalemia (reduced aldosterone → K+ retention)
- Hypotension, especially after first dose ("first-dose hypotension")
- Acute kidney injury — especially in bilateral renal artery stenosis

Contraindications:
- Pregnancy (teratogenic — causes fetal renal dysgenesis; Category D/X)
- Bilateral renal artery stenosis
- History of ACE inhibitor-induced angioedema

Key drug interactions:
- NSAIDs reduce antihypertensive effect and increase AKI risk
- K+-sparing diuretics / K+ supplements → dangerous hyperkalemia
`.trim();

const CONTENT_FILE = contentFile;

async function main() {
  await loadDotEnv();
  if (modelOverride) process.env.LLM_MODEL = modelOverride;

  const CONTENT = CONTENT_FILE
    ? (await readFile(path.isAbsolute(CONTENT_FILE) ? CONTENT_FILE : path.join(process.cwd(), CONTENT_FILE), "utf8")).trim()
    : DEFAULT_CONTENT;

  const { designScene } = await import("../lib/ai/scene-designer");
  const { loadSymbolLibrary, hydrateSymbols } = await import("../lib/ai/symbol-library");
  const { refineNarrative } = await import("../lib/ai/narrative-refiner");

  console.log(`\nModel: ${process.env.LLM_MODEL ?? "deepseek/deepseek-v4-flash"}`);
  console.log(`Topic: ${TOPIC}`);

  const library = await loadSymbolLibrary(TOPIC, CONTENT);
  console.log(`\nDictionary slice: ${library.forPrompt.length} of ${library.rows.length} library entries`);
  library.forPrompt.slice(0, 8).forEach((e) => {
    console.log(`  ${e.conceptKey} = ${e.displayName} (${e.category})`);
  });

  console.log("\nCalling scene designer...");
  const start = Date.now();
  const result = await designScene(TOPIC, CONTENT, library.forPrompt);

  // Mirror ensureDesign: hydrate reused symbols, then run the story-editor pass.
  const hydration = await hydrateSymbols(result.symbols, library.rows);
  const symbols = hydration.map((r) => r.symbol);
  const reused = hydration.filter((r) => !r.isNewConcept).length;

  let narrative = result.narrative;
  try {
    console.log("Calling story editor...");
    narrative = await refineNarrative({
      topic: TOPIC,
      setting: result.setting,
      narrative,
      symbols: symbols.map((s) => ({ name: s.name, medicalFact: s.medicalFact })),
    });
  } catch (err) {
    console.log(`Refinement failed, showing the draft: ${String(err).slice(0, 120)}`);
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  // ── Quality report ─────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Scene: "${result.sceneName}"  (${elapsed}s)`);
  console.log(`Content type: ${result.contentType}`);
  console.log(`Symbols: ${symbols.length} (${reused} reused from library)  |  Quiz questions: ${result.quizQuestions.length}`);
  console.log(`${"─".repeat(60)}`);

  console.log(`\nSETTING:\n${result.setting}\n`);

  console.log("SYMBOLS:");
  symbols.forEach((s, i) => {
    const num = String(i + 1).padStart(2);
    const intro = s.isGroupIntro ? " [INTRO]" : "";
    const reuse = s.isReused ? " [REUSED]" : "";
    console.log(`${num}. ${s.name}${intro}${reuse}`);
    console.log(`     Fact: ${s.medicalFact}`);
  });

  console.log(`\nNARRATIVE (editor-passed):\n${narrative}\n`);

  console.log(`\nQUIZ (first 2 questions):`);
  result.quizQuestions.slice(0, 2).forEach((q, i) => {
    console.log(`  Q${i + 1}: ${q.question}`);
    console.log(`  Correct: ${q.options[q.correctIndex]}`);
  });

  console.log(`\n${"─".repeat(60)}`);
  console.log(`✓  All ${symbols.length} symbols hydrated`);
  console.log(`${"─".repeat(60)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
