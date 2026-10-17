import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge classifies unknown `text-*` as a text COLOUR, so the design
// system's font-size scale (and custom radius/shadow/z names) must be declared
// or `cn("text-caption", "text-ink-muted")` would drop one of them.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "greeting",
            "page-title",
            "dialog-title",
            "title",
            "body",
            "ui",
            "label",
            "caption",
            "overline",
            "code",
            "code-sm",
          ],
        },
      ],
      rounded: [{ rounded: ["xs", "pill"] }],
      shadow: [{ shadow: ["menu", "dialog", "toast", "composer", "ring-running"] }],
      z: [{ z: ["rail", "runbar", "drawer", "dialog", "menu", "toast"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
