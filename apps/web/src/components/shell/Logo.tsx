import { cn } from "@/lib/utils";

/** Symbion mark (mint rounded tile with two linked nodes) + optional wordmark. */
export function Logo({ wordmark = true, className }: { wordmark?: boolean; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <svg
        viewBox="0 0 28 28"
        width="28"
        height="28"
        aria-hidden
        className="shrink-0 text-mint"
        fill="none"
      >
        <rect width="28" height="28" rx="8" fill="currentColor" />
        <circle cx="9.5" cy="14" r="3" className="fill-on-mint" />
        <circle cx="19" cy="9.5" r="2.2" className="fill-on-mint" />
        <circle cx="19" cy="18.5" r="2.2" className="fill-on-mint" />
        <path d="M12.3 13 16.8 10.4M12.3 15 16.8 17.6" strokeWidth="1.6" strokeLinecap="round" className="stroke-on-mint" />
      </svg>
      {wordmark && <span className="truncate font-display text-title font-semibold text-ink">Symbion</span>}
    </span>
  );
}
