import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import config from "../tailwind.config";

const repoRoot = path.resolve(__dirname, "../../..");
const tokens = JSON.parse(fs.readFileSync(path.join(repoRoot, "docs/design-system/tokens.json"), "utf8"));
const css = fs.readFileSync(path.join(__dirname, "app/globals.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(selector);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open, i);
  }
  return "";
}
// strips whitespace and trailing zeros in decimals ("0.10" == "0.1")
const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase().replace(/(\.\d*?)0+(?=\D)/g, "$1");

describe("design tokens: tokens.json <=> globals.css <=> tailwind config", () => {
  const dark = norm(block(":root"));
  const light = norm(block('[data-theme="light"]'));

  it("every colour token is a CSS variable in both themes with the exact value", () => {
    for (const t of tokens.color.tokens) {
      expect(dark, `dark --${t.name}`).toContain(norm(`--${t.name}:${t.value.dark};`));
      expect(light, `light --${t.name}`).toContain(norm(`--${t.name}:${t.value.light};`));
    }
  });

  it("every shadow token is defined in both themes", () => {
    for (const t of tokens.shadow.tokens) {
      expect(dark, t.name).toContain(norm(`--${t.name}:${t.value.dark};`));
      expect(light, t.name).toContain(norm(`--${t.name}:${t.value.light};`));
    }
  });

  it("tailwind font-size scale equals the 11 type styles", () => {
    const fs_ = (config.theme as { fontSize: Record<string, [string, { lineHeight: string }]> }).fontSize;
    const styles = tokens.type.groups.flatMap((g: { styles: unknown[] }) => g.styles) as {
      name: string; fontSize: string; lineHeight: string;
    }[];
    expect(Object.keys(fs_).sort()).toEqual(styles.map((s) => s.name).sort());
    for (const s of styles) {
      expect(fs_[s.name]![0]).toBe(s.fontSize);
      expect(fs_[s.name]![1].lineHeight).toBe(s.lineHeight);
    }
  });

  it("tailwind colours reference only variables that exist in :root", () => {
    const colors = (config.theme as { extend: { colors: Record<string, unknown> } }).extend.colors;
    const refs = JSON.stringify(colors).match(/--[a-z0-9-]+/g) ?? [];
    expect(refs.length).toBeGreaterThan(30);
    for (const r of new Set(refs)) expect(dark, r).toContain(`${r}:`);
  });

  it("radius and size tokens match", () => {
    const ext = (config.theme as { extend: { borderRadius: Record<string, string>; spacing: Record<string, string> } }).extend;
    for (const t of tokens.radius.tokens) {
      expect(ext.borderRadius[t.name.replace("radius-", "")]).toBe(t.value);
    }
    expect(ext.spacing["control-sm"]).toBe("30px");
    expect(ext.spacing["control-md"]).toBe("36px");
    expect(ext.spacing["control-lg"]).toBe("40px");
  });
});
