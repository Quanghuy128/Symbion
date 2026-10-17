"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// Border + 3px halo carry focus (the global 2px outline is suppressed for these
// field controls — the border colour change and halo are the focus indicator).
const fieldBase =
  "w-full rounded-md border border-line-strong bg-surface px-3 text-ui text-ink placeholder:text-ink-faint transition-colors focus-visible:border-focus-ring focus-visible:outline-0 focus-visible:ring-[3px] focus-visible:ring-mint-soft aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:opacity-45";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn("flex h-control-md py-1", fieldBase, className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn("block min-h-[88px] py-2", fieldBase, className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn("h-control-md", fieldBase, className)} {...props} />
  ),
);
Select.displayName = "Select";

export function Field({
  label,
  htmlFor,
  help,
  error,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  help?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-label text-ink-2">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-caption text-danger-text">{error}</p>
      ) : help ? (
        <p className="text-caption text-ink-muted">{help}</p>
      ) : null}
    </div>
  );
}
