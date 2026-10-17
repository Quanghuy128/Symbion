import { Bot, Slash, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface KindProps {
  kind: "workflow" | "agent" | "skill";
  size?: "sm" | "md";
  className?: string;
}

const KIND: Record<KindProps["kind"], { icon: LucideIcon; tone: string }> = {
  workflow: { icon: Slash, tone: "bg-workflow-soft text-workflow" },
  agent: { icon: Bot, tone: "bg-agent-soft text-agent" },
  skill: { icon: Sparkles, tone: "bg-skill-soft text-skill" },
};

/** Kind tile (workflow / agent / skill). Decorative: the name is adjacent text. */
export function Kind({ kind, size = "md", className }: KindProps) {
  const { icon: Icon, tone } = KIND[kind];
  return (
    <span
      aria-hidden
      data-kind={kind}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-xs",
        size === "sm" ? "h-[18px] w-[18px]" : "h-[22px] w-[22px]",
        tone,
        className,
      )}
    >
      <Icon size={size === "sm" ? 12 : 14} strokeWidth={1.6} />
    </span>
  );
}
