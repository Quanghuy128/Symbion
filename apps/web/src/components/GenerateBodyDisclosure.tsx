"use client";

import type { ProviderId } from "@/lib/rpc/types";

export const GENERATE_BODY_DISCLOSURE_FLAG_KEY = "symbion.llmDisclosureSeen.v1";

export interface GenerateBodyDisclosureProps {
  providerId: ProviderId | null;
}

/** Provider-conditional copy, generalized per
 * docs/loops/multi-provider-settings-STATE.md §3.2/§4d: the Ollama (local) path does not
 * say "leaves your machine" since it doesn't; any of the 3 cloud providers (openai,
 * anthropic, gemini) explicitly say content DOES leave the machine to the named
 * third-party provider. `providerId === null` means no provider is configured/active yet
 * (STATE §5's "no provider selected" state) — distinct copy, no generate is possible. */
export function persistentDisclosureCopy(providerId: ProviderId | null): string {
  if (providerId === null) {
    return "No AI provider selected — go to Settings to choose one before using AI content generation.";
  }
  if (providerId === "ollama") {
    return "Generate content with local AI (Ollama) — sends the name/description/current content to a model running on your machine, nothing leaves it.";
  }
  return "Generate content with third-party AI — your name/description/current content will be sent off your machine to an external AI provider.";
}

export function firstUseDisclosureCopy(providerId: ProviderId | null): string {
  if (providerId === null) {
    return "No AI provider configured — go to Settings to set one up before using AI content generation.";
  }
  if (providerId === "ollama") {
    return "First-time use: this feature sends the artifact's name, description, and current content to an AI model running locally on your machine (Ollama). No data leaves your machine.";
  }
  return "First-time use: this feature sends the artifact's name, description, and current content to a third-party AI service over the network. This data will leave your machine and be processed by an external provider.";
}

/**
 * GenerateBodyDisclosure — the PERSISTENT micro-copy line only (always visible next to
 * the generate button, regardless of dialog state). STATE §9 Q11 / §10.5 EC-7, generalized
 * for the multi-provider settings feature.
 *
 * The one-time first-use richer dialog is intentionally NOT rendered here — it is owned
 * by GenerateBodyButton and triggered by the *first click* of the generate button.
 */
export function GenerateBodyDisclosure({ providerId }: GenerateBodyDisclosureProps) {
  return <p className="text-xs text-text-muted">{persistentDisclosureCopy(providerId)}</p>;
}
