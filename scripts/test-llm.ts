/**
 * LLM scene-designer quality tester.
 * Usage: npx tsx scripts/test-llm.ts [openrouter-key] [model-slug]
 *
 * Example:
 *   npx tsx scripts/test-llm.ts sk-or-v1-... deepseek/deepseek-v4-flash
 *   npx tsx scripts/test-llm.ts sk-or-v1-... google/gemini-3.7-flash
 */
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { SceneDesignSchema } from "../lib/ai/schema";

const [, , apiKey, modelSlug = "deepseek/deepseek-v4-flash"] = process.argv;
if (!apiKey) {
  console.error("Usage: npx tsx scripts/test-llm.ts <openrouter-key> [model-slug]");
  process.exit(1);
}

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey,
  defaultHeaders: {
    "HTTP-Referer": "https://chitrakatha.app",
    "X-Title": "Chitrakatha",
  },
});

// Test content: ACE Inhibitors — enough facts to generate 12-16 symbols,
// covers mechanism / uses / side effects / contraindications / drug names.
const TOPIC = "ACE Inhibitors";
const CONTENT = `
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

const SYSTEM_PROMPT = `You are the lead mnemonic designer for a medical education studio that teaches exactly like Sketchy Medical: dense, high-yield content is converted into ONE coherent, densely-packed "memory palace" scene using the Method of Loci and elaborative encoding, illustrated as a single wide painting with a numbered legend below it.

Your job: given a topic and raw study content (a drug profile, a class of several drugs, a list of causative organisms, a potency hierarchy, or general notes), design a single visual scene where every fact from the content is encoded as a specific, absurd, memorable symbol living inside that scene - matching the density and structure of real Sketchy pages (often 15-30+ numbered symbols covering multiple drugs/organisms in one scene).

STRUCTURAL RULES:
1. Classify content type: "drug_profile", "organism_list", "drug_hierarchy", or "general".
2. Assign each symbol a groupName (the drug/organism/tier it belongs to). Mark isGroupIntro: true on the first symbol introducing each group.
3. Every fact in the provided content must map to exactly one symbol.
4. Be genuinely funny, weird, and vivid. Puns on drug names are highly encouraged.
5. Medical accuracy is non-negotiable.
6. For isReused: false symbols, provide name, visualDescription, and imagePrompt. For isReused: true, set those three fields to null.

EXISTING SYMBOL DICTIONARY: (empty - this is the first lesson, invent all new symbols)`;

async function main() {
  console.log(`\nModel: ${modelSlug}`);
  console.log(`Topic: ${TOPIC}\n`);
  console.log("Calling scene designer...");

  const start = Date.now();

  const completion = await client.chat.completions.parse({
    model: modelSlug,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `EXISTING SYMBOL DICTIONARY: (empty - first lesson)\n\nTopic: ${TOPIC}\n\nRaw content:\n"""\n${CONTENT}\n"""\n\nDesign the memory palace scene now.`,
      },
    ],
    response_format: zodResponseFormat(SceneDesignSchema, "scene_design"),
    temperature: 0.9,
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const result = completion.choices[0]?.message?.parsed;

  if (!result) {
    console.error("No parsed result.");
    console.error(JSON.stringify(completion.choices[0]?.message, null, 2));
    process.exit(1);
  }

  // ── Quality report ─────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Scene: "${result.sceneName}"  (${elapsed}s)`);
  console.log(`Content type: ${result.contentType}`);
  console.log(`Symbols: ${result.symbols.length}  |  Quiz questions: ${result.quizQuestions.length}`);
  console.log(`${"─".repeat(60)}`);

  console.log(`\nSETTING:\n${result.setting}\n`);

  console.log("SYMBOLS:");
  let schemaViolations = 0;
  result.symbols.forEach((s, i) => {
    const num = String(i + 1).padStart(2);
    const intro = s.isGroupIntro ? " [INTRO]" : "";
    const reused = s.isReused ? " [REUSED]" : "";
    // Schema check: new symbols must have name/visualDescription/imagePrompt
    if (!s.isReused && (!s.name || !s.visualDescription || !s.imagePrompt)) {
      schemaViolations++;
      console.log(`${num}. ⚠ SCHEMA VIOLATION — isReused:false but missing required fields`);
    } else {
      console.log(`${num}. ${s.name ?? "(null — reused)"}${intro}${reused}`);
      console.log(`     Fact: ${s.medicalFact}`);
    }
  });

  console.log(`\nNARRATIVE (first 500 chars):\n${result.narrative.slice(0, 500)}...`);

  console.log(`\nQUIZ (first 2 questions):`);
  result.quizQuestions.slice(0, 2).forEach((q, i) => {
    console.log(`  Q${i + 1}: ${q.question}`);
    console.log(`  Correct: ${q.options[q.correctIndex]}`);
  });

  console.log(`\n${"─".repeat(60)}`);
  if (schemaViolations > 0) {
    console.log(`⚠  ${schemaViolations} schema violation(s) — model did not fully comply`);
  } else {
    console.log(`✓  Schema compliance: all ${result.symbols.length} symbols valid`);
  }

  const inputTokens = completion.usage?.prompt_tokens ?? 0;
  const outputTokens = completion.usage?.completion_tokens ?? 0;
  console.log(`Tokens: ${inputTokens} in / ${outputTokens} out`);
  // DeepSeek V4 Flash pricing
  const cost = (inputTokens * 0.06146 + outputTokens * 0.1229) / 1_000_000;
  console.log(`Estimated cost: $${cost.toFixed(5)}`);
  console.log(`${"─".repeat(60)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
