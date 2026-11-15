import { getLLMClient } from "@/lib/ai/client";

/**
 * Second-pass story editor for lesson narratives.
 *
 * The scene-design call produces the whole design (scene, symbols, quiz,
 * narrative) in one giant structured output — and under that load the
 * narrative's tail (side effects, risks, monitoring) tends to degrade into a
 * located checklist ("in a dark corner sleeps...", "on a table sits...")
 * instead of a causal chain. This pass gets one focused job: rewrite the
 * narrative so every transition is an event, deriving all consequences from
 * the central fight. Failure is non-fatal — callers fall back to the draft.
 */

const REFINE_SYSTEM_PROMPT = `You are the story editor for an interconnected medical-memory anthology. Each lesson is one scene in a shared universe where drugs fight pathologies. You receive a draft scene narrative and the exact list of symbols it must cover. Your job: rewrite the narrative so it reads as ONE interconnected story, never a tour.

THE ONE RULE - EVERY TRANSITION IS AN EVENT:
Each symbol's moment must be CAUSED by the previous symbol's action. If a sentence merely says where something is, or cuts to another corner of the scene, rewrite it so an action hands the camera over. The draft's central conflict (the drug protagonists fighting the pathology antagonist) is usually strong; the draft's tail (side effects, risks, monitoring) usually degrades into a checklist - fix it by deriving ALL consequences from the fight's single causal premise: the protagonists' mechanism suppresses the scene's immune defenders, and every hazard then FOLLOWS from that suppression (a sleeping infection wakes because no one is guarding it, the screening crew scrambles BECAUSE it woke, opportunistic invaders creep in through the unmanned walls, and so on). One premise, chained consequences - not a final paragraph of placed props.

BANNED transition shapes (rewrite any you find):
- Pure location: "in a dark corner", "on a nearby shelf", "further down the aisle", "at the center", "beside", "on a table"
- Section breaks: "Now, the collateral damage:", "Finally,", "Meanwhile", "Elsewhere", "Lastly"
- Passive placement: "sits on", "stands beside", "can be seen", "is displayed"

KEEP EVERYTHING ELSE:
- Mention every symbol, in the exact order of the list, bolding (**name**) each symbol's first mention.
- Keep the draft's setting, universe anchor, cameo, character names, and humor - polish, don't replace.
- Do not add new clinical facts, do not drop any, do not reorder symbols.
- Keep roughly the same length (2-4 paragraphs), same tone, escalating toward a small climax or punchline.

Output ONLY the rewritten narrative text - no preamble, no commentary, no markdown fences.`;

export type RefinableSymbol = { name: string; medicalFact: string };

export async function refineNarrative(args: {
  topic: string;
  setting: string;
  narrative: string;
  symbols: RefinableSymbol[];
}): Promise<string> {
  const { client, model } = getLLMClient();

  const symbolList = args.symbols
    .map((s, i) => `${i + 1}. ${s.name} — encodes: ${s.medicalFact}`)
    .join("\n");

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: REFINE_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Topic: ${args.topic}

SETTING (unchanged): ${args.setting}

SYMBOLS, in the exact order they must appear in the story:
${symbolList}

DRAFT NARRATIVE TO REWRITE:
"""
${args.narrative}
"""

Rewrite it now — every transition an event, every consequence chained to the fight.`,
      },
    ],
    temperature: 0.7,
  });

  const refined = completion.choices[0]?.message?.content?.trim();
  if (!refined) {
    throw new Error("Narrative refinement returned no content.");
  }
  return refined;
}
