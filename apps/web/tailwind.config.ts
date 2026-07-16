import type { Config } from "tailwindcss";

/**
 * Symbion dark left-rail redesign — Tailwind tokens ported from DESIGN.md
 * (docs/loops/symbion-dark-redesign-design.md §7) + the 10 PLAN resolutions
 * in docs/loops/symbion-dark-redesign-STATE.md §6.2. Dark-only (Q7): no
 * `.dark`-scoped variants are used anywhere in the app, `darkMode: "class"`
 * is kept only because removing it is out of scope for this presentation-only
 * pass (no code path ever applies `.dark`).
 */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Legacy semantic tokens (still consumed by existing className call
        // sites that haven't been migrated to the new named tokens below —
        // e.g. `border-border`, `bg-background`, `text-muted-foreground`).
        // Now backed by the SAME dark-token values as bg-app/border-hairline/
        // etc so old + new classnames render identically during migration.
        border: "rgba(var(--border), 0.06)",
        background: "rgb(var(--background))",
        foreground: "rgb(var(--foreground))",
        muted: "rgb(var(--muted))",
        "muted-foreground": "rgb(var(--muted-foreground))",
        primary: "rgb(var(--primary))",
        "primary-foreground": "rgb(var(--primary-foreground))",
        destructive: "rgb(var(--destructive))",
        accent: "rgb(var(--accent))",

        // DESIGN.md §7 token set — new named colors for the redesign.
        "bg-app": "#0a0b0e",
        "bg-rail": "#0e1014",
        "bg-panel": "#13151a",
        "bg-surface": "#15171d",
        "bg-menu": "#1b1e25",
        "bg-input": "#0d0f13",
        "bg-code": "#08090c",
        "border-hairline": "rgba(255,255,255,.06)",
        "border-subtle": "rgba(255,255,255,.05)",
        "border-input": "rgba(255,255,255,.10)",
        "border-menu": "rgba(255,255,255,.09)",
        "text-strong": "#f3f4f6",
        "text-body": "#e5e7eb",
        "text-secondary": "#c5cad3",
        "text-muted": "#9aa0ab",
        "text-dim": "#8a909b",
        "text-faint": "#565c68",
        "brand-accent": "#6366f1",
        "brand-accent-soft": "rgba(99,102,241,.16)",
        "accent-text": "#a5b4fc",
        "accent-text-hi": "#c7d2fe",
        command: "#818cf8",
        "command-hi": "#a5b4fc",
        agent: "#a78bfa",
        "agent-hi": "#c4b5fd",
        skill: "#22d3ee",
        success: "#4ade80",
        warning: "#fbbf24",
        danger: "#f87171",
        "danger-hi": "#fca5a5",
        "overwrite-btn": "#dc2626",
        // graph-execution-realtime design §7 (resolved Q1): run-active reuses
        // the `skill` hex under a distinct semantic name — pulsing ring, edge
        // flow, live dots for the run engine, never reused for outcomes.
        "run-active": "#22d3ee",
        "run-active-soft": "rgba(34,211,238,.18)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        sm: "8px",
        "nav-item": "9px",
        panel: "12px",
        dialog: "16px",
        pill: "20px",
      },
      boxShadow: {
        dropdown: "0 14px 40px rgba(0,0,0,.5)",
        dialog: "0 30px 80px rgba(0,0,0,.6)",
        drawer: "-20px 0 60px rgba(0,0,0,.5)",
        toast: "0 14px 40px rgba(0,0,0,.5)",
        // graph-execution-realtime design §7: looping run-active glow ring.
        "glow-run": "0 0 0 4px rgba(34,211,238,.18), 0 0 14px 2px rgba(34,211,238,.18)",
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        slideIn: {
          from: { transform: "translateX(24px)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        popIn: {
          from: { transform: "scale(.97) translateY(6px)", opacity: "0" },
          to: { transform: "scale(1) translateY(0)", opacity: "1" },
        },
        // interactive-graph (design §7): one-shot handle affordance ring.
        // Runs ONCE (see animation.pulse count `1`); collapsed by the global
        // prefers-reduced-motion block in globals.css like the other keyframes.
        pulse: {
          "0%": { boxShadow: "0 0 0 0 rgba(129,140,248,.5)" },
          "100%": { boxShadow: "0 0 0 6px rgba(129,140,248,0)" },
        },
        // graph-execution-realtime design §5/§7: looping run-active ring pulse
        // on an executing node (~1.6-2s loop, distinct from the one-shot `pulse`
        // above). Collapses to a state swap under prefers-reduced-motion
        // (joins the existing globals.css block).
        glowPulse: {
          "0%": { boxShadow: "0 0 0 0 rgba(34,211,238,.5)" },
          "50%": { boxShadow: "0 0 0 6px rgba(34,211,238,.05)" },
          "100%": { boxShadow: "0 0 0 0 rgba(34,211,238,.5)" },
        },
        // P2 (graph-execution-realtime design §3.5/§7): edge current while a
        // dispatch is actively flowing — stroke-dasharray 6/4 + dashoffset
        // linear loop ~600ms. Collapses under prefers-reduced-motion.
        dashFlow: {
          from: { strokeDashoffset: "10" },
          to: { strokeDashoffset: "0" },
        },
        // P2: one-shot "lock-in" flash when a node's live token count freezes
        // on settle (design §3.5's "pulse -> one 300ms lock-in flash -> steady").
        countLockIn: {
          "0%": { boxShadow: "0 0 0 0 rgba(255,255,255,0)" },
          "40%": { boxShadow: "0 0 0 3px rgba(255,255,255,.35)" },
          "100%": { boxShadow: "0 0 0 0 rgba(255,255,255,0)" },
        },
      },
      animation: {
        fadeIn: "fadeIn .16s ease both",
        slideIn: "slideIn .2s cubic-bezier(.2,.8,.2,1) both",
        popIn: "popIn .16s cubic-bezier(.2,.8,.2,1) both",
        pulse: "pulse .9s cubic-bezier(.2,.8,.2,1) 1",
        glowPulse: "glowPulse 1.8s cubic-bezier(.2,.8,.2,1) infinite",
        dashFlow: "dashFlow .6s linear infinite",
        countLockIn: "countLockIn .3s cubic-bezier(.2,.8,.2,1) 1",
      },
    },
  },
  plugins: [],
};

export default config;
