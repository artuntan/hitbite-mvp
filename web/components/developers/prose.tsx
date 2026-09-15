import * as React from "react";

/**
 * The tiny slice of Markdown the API description actually uses.
 *
 * The descriptions in `lib/openapi.ts` are Markdown because that is what an OpenAPI description
 * field is, and a partner's viewer will render them as such. This page has to render the same
 * strings, so it handles the two marks those strings use — `**bold**` and `` `code` `` — and
 * nothing else. A full Markdown renderer would be a dependency and an XSS surface for text that
 * never leaves this repository; leaving the marks unrendered would put literal backticks in a
 * table cell, which is what this replaces.
 *
 * Anything else in the string is emitted as plain text, so an unsupported mark degrades to the
 * characters the author typed rather than disappearing.
 */
export function renderInline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).map((piece, index) => {
    if (piece.startsWith("**") && piece.endsWith("**") && piece.length > 4) {
      return (
        <strong key={index} className="text-ink font-semibold">
          {renderCode(piece.slice(2, -2))}
        </strong>
      );
    }
    if (piece.startsWith("*") && piece.endsWith("*") && piece.length > 2) {
      return <em key={index}>{renderCode(piece.slice(1, -1))}</em>;
    }
    return <React.Fragment key={index}>{renderCode(piece)}</React.Fragment>;
  });
}

/** `code` spans, and nothing else — the inner pass, so a mark can hold code inside it. */
function renderCode(text: string): React.ReactNode[] {
  return text.split(/(`[^`]+`)/g).map((piece, index) => {
    if (piece.startsWith("`") && piece.endsWith("`") && piece.length > 2) {
      return (
        <code key={index} className="addr text-ink">
          {piece.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={index}>{piece}</React.Fragment>;
  });
}

/** One string, inline — for a table cell or a list item. */
export function Inline({ text }: { text: string }) {
  return <>{renderInline(text)}</>;
}

/** A blank-line-separated string, as paragraphs. */
export function Prose({ text, className }: { text: string; className?: string }) {
  return (
    <>
      {text.split("\n\n").map((paragraph, index) => (
        <p key={index} className={className ?? "text-muted text-sm leading-relaxed"}>
          {renderInline(paragraph)}
        </p>
      ))}
    </>
  );
}
