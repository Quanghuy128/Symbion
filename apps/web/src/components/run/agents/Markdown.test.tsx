import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown, closeOpenFence, maxNesting } from "./Markdown";

describe("Markdown (untrusted CLI text)", () => {
  it("renders bold, tables, lists and code without leaving markdown syntax visible", () => {
    const { container } = render(
      <Markdown source={"**Chào bạn!**\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n- two\n\nuse `npm test`\n\n```ts\nconst x = 1;\n```"} />
    );
    expect(container.querySelector("strong")?.textContent).toBe("Chào bạn!");
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("pre code")?.textContent).toBe("const x = 1;");
    expect(container.textContent).not.toContain("**");
    expect(container.textContent).not.toContain("|");
  });

  it("never renders raw HTML, never fetches images, and strips javascript: links", () => {
    const { container } = render(
      <Markdown source={'<img src="x" onerror="alert(1)"><script>alert(2)</script>\n\n![tracker](https://evil.example/p.png)\n\n[click](javascript:alert(3))'} />
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("[image: tracker]")).toBeTruthy();
    const link = container.querySelector("a");
    expect(link?.getAttribute("href") ?? "").not.toContain("javascript:");
  });

  it("encoded / non-http schemes and app-relative links never become live links", () => {
    const { container } = render(
      <Markdown
        source={
          "[a](&#106;avascript:alert(1)) [b](%6Aavascript:x) [c](data:text/html,x) [d](vbscript:x) [e](file:///etc/passwd) [f](/rpc) <javascript:alert(1)>\n\n[r]: javascript:alert(2)\n\n[ref][r]"
        }
      />
    );
    for (const a of container.querySelectorAll("a")) {
      expect(a.getAttribute("href") ?? "").toMatch(/^(https?:|mailto:|#)/);
    }
  });

  it("HTML inside a GFM table cell or footnote stays text", () => {
    const { container } = render(<Markdown source={"| x |\n|---|\n| <b onclick=x>hi</b> |\n\nnote[^1]\n\n[^1]: <img src=x onerror=alert(1)>"} />);
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<b onclick=x>");
  });

  it("deeply nested markdown falls back to plain text instead of overflowing the parser", () => {
    const deep = "- ".repeat(1000) + "x";
    expect(maxNesting(deep)).toBe(1000);
    render(<Markdown source={deep} />);
    expect(screen.getByTestId("markdown-plain").textContent).toBe(deep);
  });

  it("links open in a new tab without a referrer", () => {
    const { container } = render(<Markdown source="[docs](https://example.com)" />);
    const a = container.querySelector("a")!;
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noreferrer");
  });

  it("a one-line fenced block without a language is still a code block", () => {
    const { container } = render(<Markdown source={"```\nnpm test\n```"} />);
    expect(container.querySelector("pre code")?.textContent).toBe("npm test");
  });

  it("closeOpenFence closes an unterminated fence while streaming", () => {
    expect(closeOpenFence("```ts\nconst a")).toBe("```ts\nconst a\n```");
    expect(closeOpenFence("```ts\nconst a\n```")).toBe("```ts\nconst a\n```");
  });
});
