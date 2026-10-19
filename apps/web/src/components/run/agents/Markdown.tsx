"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "./CopyButton";

/**
 * Markdown — the ONLY place CLI-derived text gets formatted. The text is
 * untrusted, so: no raw HTML (react-markdown escapes it; rehype-raw is never
 * added), unsafe URL schemes are stripped by react-markdown's default
 * urlTransform, links open in a new tab with no referrer, and images are
 * never fetched (alt text only) so model output can't make the browser call
 * out. Nothing here uses dangerouslySetInnerHTML.
 */

/** Close an unterminated ``` fence while streaming so the rest doesn't render as prose. */
export function closeOpenFence(md: string): string {
  const fences = md.match(/^\s*```/gm)?.length ?? 0;
  return fences % 2 === 1 ? `${md}\n\`\`\`` : md;
}

/** Nesting depth past which markdown is shown as plain text: remark's parser
 *  recurses per level, and ~1,000 nested list / quote markers (well within a
 *  2,000-char preview) overflow the stack. */
const MAX_NESTING = 32;

/** Deepest run of leading block markers (`>`, `-`, `*`, `+`, `1.`) on any line. */
export function maxNesting(md: string): number {
  let max = 0;
  for (const line of md.split("\n")) {
    const prefix = /^[\s>*+\-\d.)]*/.exec(line)?.[0] ?? "";
    const depth = prefix.match(/(?:>|[*+-](?=\s)|\d+[.)](?=\s))/g)?.length ?? 0;
    if (depth > max) max = depth;
  }
  return max;
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <div className="overflow-hidden rounded-sm border border-line">
      <div className="flex items-center justify-between bg-surface px-3 py-0.5 font-mono text-overline normal-case tracking-normal text-ink-muted">
        <span>{lang ?? "text"}</span>
        <CopyButton text={code} label="Copy code" />
      </div>
      <pre className="overflow-x-auto bg-deep px-3 py-2 font-mono text-code-sm text-ink-2">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const components: Components = {
  h1: ({ children }) => <h3 className="text-title font-semibold text-ink">{children}</h3>,
  h2: ({ children }) => <h3 className="text-body font-semibold text-ink">{children}</h3>,
  h3: ({ children }) => <h4 className="text-ui font-semibold text-ink">{children}</h4>,
  h4: ({ children }) => <h4 className="font-semibold text-ink">{children}</h4>,
  h5: ({ children }) => <h5 className="font-semibold text-ink">{children}</h5>,
  h6: ({ children }) => <h6 className="font-semibold text-ink">{children}</h6>,
  p: ({ children }) => <p>{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  ul: ({ children }) => <ul className="flex list-disc flex-col gap-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="flex list-decimal flex-col gap-1 pl-5">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-line-strong pl-3 text-ink-muted">{children}</blockquote>,
  hr: () => <hr className="border-line" />,
  a: ({ href, children }) => {
    // urlTransform blanks unsafe schemes; such links (and app-relative ones) render as text.
    if (!href || !/^(https?:|mailto:|#)/i.test(href)) return <span className="text-mint-text">{children}</span>;
    if (href.startsWith("#")) {
      return (
        <a href={href} className="text-mint-text underline decoration-dotted">
          {children}
        </a>
      );
    }
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className="text-mint-text underline decoration-dotted">
        {children}
      </a>
    );
  },
  img: ({ alt }) => <span className="text-ink-muted">[image{alt ? `: ${alt}` : ""}]</span>,
  table: ({ children }) => (
    <div className="overflow-x-auto rounded-sm border border-line">
      <table className="w-full border-collapse text-label font-normal">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-line bg-surface px-3 py-2 text-left font-semibold text-ink-2">{children}</th>,
  td: ({ children }) => <td className="border-b border-line-soft px-3 py-1.5 align-top">{children}</td>,
  pre: ({ children }) => <>{children}</>, // CodeBlock renders its own <pre>
  code: ({ className, children, node }) => {
    const lang = /language-([\w-]+)/.exec(className ?? "")?.[1];
    const text = String(children).replace(/\n$/, "");
    // a fenced block spans several source lines even when its body is one line
    const multiLine = node?.position !== undefined && node.position.start.line !== node.position.end.line;
    if (lang || multiLine || text.includes("\n")) return <CodeBlock code={text} lang={lang} />;
    return <code className="rounded-xs bg-surface px-1 py-px font-mono text-code-sm text-ink">{children}</code>;
  },
};

export const Markdown = memo(function Markdown({ source, streaming }: { source: string; streaming?: boolean }) {
  if (maxNesting(source) > MAX_NESTING) {
    return (
      <pre className="whitespace-pre-wrap break-words font-sans text-ui text-ink-2" data-testid="markdown-plain">
        {source}
      </pre>
    );
  }
  return (
    <div className="flex flex-col gap-3 text-ui leading-[1.65] text-ink-2 [overflow-wrap:anywhere]" data-testid="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {streaming ? closeOpenFence(source) : source}
      </ReactMarkdown>
    </div>
  );
});
