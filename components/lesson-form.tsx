"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Loader2, Sparkles, UploadCloud, X } from "lucide-react";
import { generateLesson } from "@/app/actions/lessons";
import { cleanPdfText } from "@/lib/pdf-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";

const LOADING_MESSAGES = [
  "Reading your content...",
  "Mapping every fact to a symbol...",
  "Designing the memory palace...",
  "Writing the scene...",
  "Painting the full scene...",
  "Painting each symbol...",
  "Writing quiz questions...",
  "Almost there...",
];

const EXAMPLE_PRESETS = [
  {
    label: "Drug profile",
    topic: "Methotrexate",
    content: `Methotrexate
Mechanism: Inhibits dihydrofolate reductase (DHFR), blocking folate synthesis and downstream purine/pyrimidine synthesis.
Uses: Psoriasis, rheumatoid arthritis, certain cancers (e.g. leukemia), ectopic pregnancy.
Side effects: Hepatotoxicity, bone marrow suppression (myelosuppression), mucositis/mouth sores, teratogenicity (contraindicated in pregnancy).
Dosing/monitoring: Weekly (not daily) dosing for autoimmune indications; monitor LFTs and CBC; folate/leucovorin rescue can reduce toxicity.`,
  },
  {
    label: "Organism list",
    topic: "Causes of Erythema Nodosum",
    content: `Causative/associated organisms and conditions for Erythema Nodosum:
- Streptococcus pyogenes (most common infectious cause, especially post-strep pharyngitis)
- Mycobacterium tuberculosis
- Yersinia species (GI infection)
- Histoplasma capsulatum (fungal, endemic areas)
- Also associated with: sarcoidosis, inflammatory bowel disease, oral contraceptives, pregnancy`,
  },
  {
    label: "Drug hierarchy",
    topic: "Topical Corticosteroid Potency",
    content: `Topical corticosteroid potency, highest to lowest:
1. Super high potency: Clobetasol propionate 0.05%
2. High potency: Betamethasone dipropionate 0.05%, Fluocinonide 0.05%
3. Medium potency: Triamcinolone acetonide 0.1%, Betamethasone valerate 0.1%
4. Low potency: Hydrocortisone 1-2.5%, Desonide 0.05%
General rule: higher potency for thick skin (palms/soles), lower potency for thin skin (face, groin, eyelids).`,
  },
];

export function LessonForm() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [content, setContent] = useState("");
  const [isPending, startTransition] = useTransition();
  const [loadingMessage, setLoadingMessage] = useState(LOADING_MESSAGES[0]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pdfFile, setPdfFile] = useState<{ name: string; pages: number } | null>(null);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!isPending) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    let i = 0;
    intervalRef.current = setInterval(() => {
      i = (i + 1) % LOADING_MESSAGES.length;
      setLoadingMessage(LOADING_MESSAGES[i]);
    }, 3200);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPending]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isPending) return;

    setLoadingMessage(LOADING_MESSAGES[0]);
    startTransition(async () => {
      const result = await generateLesson(topic, content);
      if (result.ok) {
        toast.success("Your memory palace is ready.");
        router.push(`/lessons/${result.lessonId}`);
      } else {
        toast.error(result.error);
      }
    });
  }

  function applyPreset(preset: (typeof EXAMPLE_PRESETS)[number]) {
    if (isPending) return;
    setTopic(preset.topic);
    setContent(preset.content);
    setPdfFile(null);
  }

  async function handlePdfFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Please upload a PDF file.");
      return;
    }
    setIsPdfLoading(true);
    try {
      // Parse entirely in the browser — no upload to server, no timeout risk.
      // unpdf is dynamically imported so it doesn't bloat the initial bundle.
      const { extractText } = await import("unpdf");
      const buffer = await file.arrayBuffer();
      const { text, totalPages } = await extractText(
        new Uint8Array(buffer),
        { mergePages: true }
      );
      const cleaned = cleanPdfText(text);

      if (!cleaned || cleaned.length < 20) {
        toast.error(
          "Could not extract readable text. This PDF may be a scanned image — try copy-pasting the text manually."
        );
        return;
      }

      setContent(cleaned);
      setPdfFile({ name: file.name, pages: totalPages });
      if (!topic.trim()) {
        setTopic(file.name.replace(/\.pdf$/i, "").replace(/[-_]/g, " "));
      }
      toast.success(
        `Extracted ${totalPages} page${totalPages === 1 ? "" : "s"} — review and edit below.`
      );
    } catch (err) {
      console.error("PDF parse error:", err);
      toast.error("Failed to read PDF. Make sure it's a valid, non-password-protected file.");
    } finally {
      setIsPdfLoading(false);
    }
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handlePdfFile(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handlePdfFile(file);
  }

  function clearPdf() {
    setPdfFile(null);
    setContent("");
  }

  return (
    <Card className="border-border/80 bg-card shadow-[0_2px_0_0_var(--border)] py-2">
      <CardContent className="pt-2">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="topic">Topic name</Label>
            <Input
              id="topic"
              placeholder="e.g. Methotrexate, Erythema Nodosum causes, Topical steroid potency"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              disabled={isPending}
              maxLength={120}
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="content">Study content</Label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isPending || isPdfLoading}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-ink-700 transition-colors disabled:opacity-50"
              >
                {isPdfLoading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <UploadCloud className="size-3.5" />
                )}
                {isPdfLoading ? "Reading PDF…" : "Upload PDF"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={handleFileInputChange}
              />
            </div>

            {/* Drop zone — shown when textarea is empty and no PDF loaded */}
            {!content && !isPdfLoading && (
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed cursor-pointer py-8 transition-colors ${
                  isDragging
                    ? "border-ink-500 bg-ink-50"
                    : "border-border hover:border-ink-400 hover:bg-secondary/30"
                }`}
              >
                <UploadCloud className="size-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground text-center">
                  Drop a PDF here, or{" "}
                  <span className="text-ink-600 font-medium underline underline-offset-2">
                    click to browse
                  </span>
                </p>
                <p className="text-xs text-muted-foreground/70">
                  Or paste text directly below
                </p>
              </div>
            )}

            {/* PDF badge shown when a file has been parsed */}
            {pdfFile && (
              <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2">
                <FileText className="size-4 text-ink-600 shrink-0" />
                <span className="text-sm text-ink-700 font-medium truncate flex-1">
                  {pdfFile.name}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {pdfFile.pages} {pdfFile.pages === 1 ? "page" : "pages"}
                </span>
                <button
                  type="button"
                  onClick={clearPdf}
                  disabled={isPending}
                  className="ml-1 text-muted-foreground hover:text-destructive transition-colors"
                  aria-label="Remove PDF"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}

            <Textarea
              id="content"
              placeholder="Paste a drug profile (mechanism, uses, side effects, dosing), a list of causative organisms, a drug-class potency hierarchy, or any other study content…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={isPending}
              className="min-h-[220px] font-mono text-sm resize-y"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Try an example:</span>
            {EXAMPLE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset)}
                disabled={isPending}
                className="text-xs rounded-full border border-border bg-secondary/50 px-3 py-1 text-secondary-foreground hover:border-ink-400 hover:text-ink-700 transition-colors disabled:opacity-50"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <Button
            type="submit"
            disabled={isPending}
            className="bg-ink-600 hover:bg-ink-700 text-white h-11 text-base gap-2"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {loadingMessage}
              </>
            ) : (
              <>
                <Sparkles className="size-4" />
                Generate memory palace
              </>
            )}
          </Button>

          {isPending && (
            <p className="text-xs text-center text-muted-foreground">
              Usually 30-90 seconds - every symbol is painted individually.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
