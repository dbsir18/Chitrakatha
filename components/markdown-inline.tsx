/**
 * Renders LLM prose containing inline markdown (**bold** / *italic*) as real
 * HTML emphasis instead of literal asterisks. Server-component safe.
 */
import { parseInlineMarkdown } from "@/lib/markdown";

export function MarkdownInline({ text }: { text: string }) {
  return (
    <>
      {parseInlineMarkdown(text).map((seg, i) =>
        seg.bold ? (
          <strong key={i}>{seg.text}</strong>
        ) : seg.italic ? (
          <em key={i}>{seg.text}</em>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  );
}
