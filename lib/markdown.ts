/**
 * Minimal inline-markdown parsing for LLM-generated prose.
 *
 * The scene designer sometimes emits **bold** (typically around a symbol's
 * name when the story first introduces it) and *italic* emphasis. Rather than
 * stripping it, both render surfaces (web page + PDF export) turn it into
 * real bold/italic. Headings, links, and lists never appear in lesson prose
 * and are deliberately not handled; `code` ticks are unwrapped to plain text.
 */

export type InlineMarkdownSegment = {
  text: string;
  bold?: boolean;
  italic?: boolean;
};

const TOKEN_RE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g;

export function parseInlineMarkdown(src: string): InlineMarkdownSegment[] {
  const segments: InlineMarkdownSegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(src)) !== null) {
    if (m.index > last) segments.push({ text: src.slice(last, m.index) });
    const token = m[0];
    if (token.startsWith("**")) {
      segments.push({ text: token.slice(2, -2), bold: true });
    } else if (token.startsWith("`")) {
      segments.push({ text: token.slice(1, -1) });
    } else {
      segments.push({ text: token.slice(1, -1), italic: true });
    }
    last = m.index + token.length;
  }
  if (last < src.length) segments.push({ text: src.slice(last) });
  return segments.length > 0 ? segments : [{ text: src }];
}
