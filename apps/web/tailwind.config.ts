import type { Config } from "tailwindcss";

/**
 * Symbion design system — Tailwind mapping (docs/design-system/tokens.json).
 * Every colour/shadow is a CSS variable defined in src/app/globals.css that
 * holds a FULL colour value, so Tailwind opacity modifiers (`bg-x/10`) do not
 * work on token colours — use the matching `-soft` token instead.
 */
const v = (n: string) => `var(--${n})`;

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    fontSize: {
      greeting: ["40px", { lineHeight: "46px", fontWeight: "600", letterSpacing: "-0.02em" }],
      "page-title": ["32px", { lineHeight: "38px", fontWeight: "600", letterSpacing: "-0.02em" }],
      "dialog-title": ["22px", { lineHeight: "28px", fontWeight: "600", letterSpacing: "-0.015em" }],
      title: ["17px", { lineHeight: "24px", fontWeight: "500" }],
      body: ["15px", { lineHeight: "22px", fontWeight: "400" }],
      ui: ["14px", { lineHeight: "20px", fontWeight: "400" }],
      label: ["13px", { lineHeight: "18px", fontWeight: "500" }],
      caption: ["12px", { lineHeight: "16px", fontWeight: "400" }],
      overline: ["11px", { lineHeight: "14px", fontWeight: "600", letterSpacing: "0.06em" }],
      code: ["13px", { lineHeight: "20px", fontWeight: "400" }],
      "code-sm": ["12px", { lineHeight: "18px", fontWeight: "400" }],
    },
    extend: {
      colors: {
        app: v("bg-app"),
        sidebar: v("bg-sidebar"),
        deep: v("bg-deep"),
        surface: { DEFAULT: v("surface"), hover: v("surface-hover"), active: v("surface-active") },
        line: { DEFAULT: v("line"), soft: v("line-soft"), strong: v("line-strong") },
        ink: { DEFAULT: v("ink"), 2: v("ink-2"), 3: v("ink-3"), muted: v("ink-muted"), faint: v("ink-faint") },
        mint: {
          DEFAULT: v("mint"),
          text: v("mint-text"),
          hover: v("mint-hover"),
          strong: v("mint-strong"),
          soft: v("mint-soft"),
        },
        "on-mint": v("on-mint"),
        "focus-ring": v("focus-ring"),
        workflow: { DEFAULT: v("workflow"), soft: v("workflow-soft") },
        agent: { DEFAULT: v("agent"), soft: v("agent-soft") },
        skill: { DEFAULT: v("skill"), soft: v("skill-soft") },
        running: { DEFAULT: v("running"), soft: v("running-soft") },
        success: { DEFAULT: v("success"), soft: v("success-soft") },
        warning: { DEFAULT: v("warning"), soft: v("warning-soft") },
        danger: { DEFAULT: v("danger"), text: v("danger-text"), soft: v("danger-soft") },
        "on-danger": v("on-danger"),
        diff: { add: v("diff-add"), del: v("diff-del") },
        overlay: v("overlay"),
        "graph-dot": v("graph-dot"),
      },
      borderColor: { DEFAULT: v("line") },
      fontFamily: {
        display: ["var(--font-display)", "var(--font-sans)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: { xs: "6px", sm: "8px", md: "10px", lg: "14px", xl: "20px", pill: "999px" },
      boxShadow: {
        menu: v("shadow-menu"),
        dialog: v("shadow-dialog"),
        toast: v("shadow-toast"),
        composer: v("shadow-composer"),
        "ring-running": "0 0 0 2px var(--running), 0 0 18px var(--running-soft)",
      },
      spacing: {
        "control-sm": "30px",
        "control-md": "36px",
        "control-lg": "40px",
        sidebar: "288px",
        rail: "56px",
        drawer: "560px",
      },
      maxWidth: { content: "920px", "content-wide": "1040px" },
      zIndex: { rail: "10", runbar: "30", drawer: "40", dialog: "50", menu: "60", toast: "70" },
      transitionDuration: { DEFAULT: "120ms" },
      keyframes: {
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        slideIn: {
          from: { transform: "translateX(24px)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        popIn: {
          from: { transform: "scale(.97) translateY(6px)", opacity: "0" },
          to: { transform: "scale(1) translateY(0)", opacity: "1" },
        },
        // One-shot handle affordance ring (runs once; see animation.pulse).
        pulse: {
          "0%": { boxShadow: "0 0 0 0 var(--mint-soft)" },
          "100%": { boxShadow: "0 0 0 6px transparent" },
        },
        // Looping run-active ring pulse on an executing node.
        glowPulse: {
          "0%": { boxShadow: "0 0 0 0 var(--running-soft)" },
          "50%": { boxShadow: "0 0 0 6px var(--running-soft)" },
          "100%": { boxShadow: "0 0 0 0 var(--running-soft)" },
        },
        // Edge current while a dispatch is flowing.
        dashFlow: { from: { strokeDashoffset: "10" }, to: { strokeDashoffset: "0" } },
        // One-shot lock-in flash when a node's live token count freezes.
        countLockIn: {
          "0%": { boxShadow: "0 0 0 0 transparent" },
          "40%": { boxShadow: "0 0 0 3px var(--ink-faint)" },
          "100%": { boxShadow: "0 0 0 0 transparent" },
        },
        livePulse: { "50%": { opacity: ".35" } },
      },
      animation: {
        fadeIn: "fadeIn .16s ease both",
        slideIn: "slideIn .2s cubic-bezier(.2,.8,.2,1) both",
        popIn: "popIn .16s cubic-bezier(.2,.8,.2,1) both",
        pulse: "pulse .9s cubic-bezier(.2,.8,.2,1) 1",
        glowPulse: "glowPulse 1.8s cubic-bezier(.2,.8,.2,1) infinite",
        dashFlow: "dashFlow .6s linear infinite",
        countLockIn: "countLockIn .3s cubic-bezier(.2,.8,.2,1) 1",
        livePulse: "livePulse 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
