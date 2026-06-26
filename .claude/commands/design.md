---
description: Design phase — UI/UX ideas, wireframes, screen flows, and mockups BEFORE plan/build. Runs 3 parallel designer angles then synthesizes into a single design doc.
---

You are at the **design** step of the Symbion pipeline.

Feature: **$ARGUMENTS**

Read `docs/loops/<feature>-STATE.md` first to load the locked spec. If the spec is missing or incomplete, stop and tell the user to run `/office-hours` first.

Spin up **3 independent designer agents in parallel** using the Agent tool (subagent_type: `designer`), each exploring a different design angle. Send all 3 Agent calls in a single message so they run concurrently.

---

**Agent 1 — Minimalist / Functional**
Prompt: "You are a UI/UX designer for Symbion (desktop-class developer tool — local daemon + web UI, NOT mobile, NOT chat/map; Tailwind + shadcn/ui).
Feature spec: '$ARGUMENTS' — read docs/loops/ for the locked spec.

Design from a **minimalist/functional** angle:
- Fewest screens, fewest taps, zero decoration that doesn't carry meaning.
- Prioritize speed and clarity over richness.
- Produce: user journey (happy path), screen inventory, ASCII wireframes for each screen, component breakdown, interaction notes (loading/empty/error states).
- Flag any open design questions — do NOT guess on taste decisions.
Write your output to docs/loops/<feature>-design-minimalist.md"

**Agent 2 — Rich / Immersive**
Prompt: "You are a UI/UX designer for Symbion (desktop-class developer tool — local daemon + web UI, NOT mobile, NOT chat/map; Tailwind + shadcn/ui).
Feature spec: '$ARGUMENTS' — read docs/loops/ for the locked spec.

Design from a **rich/immersive** angle:
- Make the read-only dependency graph expressive (node badges, hover detail, per-target lossy warnings) and the publish diff viewer rich (staggered reveal, conflict resolver).
- Richer micro-interactions: transitions, toasts, inline previews.
- Produce: user journey (happy path), screen inventory, ASCII wireframes for each screen, component breakdown, interaction notes (loading/empty/error states).
- Flag any open design questions — do NOT guess on taste decisions.
Write your output to docs/loops/<feature>-design-rich.md"

**Agent 3 — Progressive Disclosure**
Prompt: "You are a UI/UX designer for Symbion (desktop-class developer tool — local daemon + web UI, NOT mobile, NOT chat/map; Tailwind + shadcn/ui).
Feature spec: '$ARGUMENTS' — read docs/loops/ for the locked spec.

Design from a **progressive disclosure** angle:
- Start with the simplest UI, reveal power features as the user gets deeper.
- Think: what does a first-time user see vs a power user who has used this 10×?
- Produce: user journey (happy path + advanced path), screen inventory, ASCII wireframes for each screen, component breakdown, interaction notes (loading/empty/error states).
- Flag any open design questions — do NOT guess on taste decisions.
Write your output to docs/loops/<feature>-design-progressive.md"

---

After all 3 agents finish, **synthesize** their outputs into a single canonical design doc:

1. Read all 3 partial design files.
2. Pick the best approach (or blend the strongest ideas from each) — briefly explain why.
3. Write the final unified design to `docs/loops/<feature>-design.md` using the standard sections:
   - **User Journey** (happy path narrative)
   - **Screen Inventory** (name, entry trigger, exit path)
   - **ASCII Wireframes** (one per screen, precise labels)
   - **Component Breakdown** (shadcn components, new components, interface contracts)
   - **Interaction Notes** (micro-interactions, loading/empty/error states)
   - **Open Design Questions** (taste decisions for the user)
   - **Future Ideas** (out-of-scope but worth capturing)

4. Delete or archive the 3 partial files.

After writing the design doc, suggest running `/plan` so the architect can use it alongside the spec.
