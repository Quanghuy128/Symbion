/**
 * getProvider — registry-driven factory resolving a provider id to its
 * LlmProvider implementation. Generalized per
 * docs/loops/multi-provider-settings-STATE.md §3.2/§3.4: a descriptor array
 * replaces the hardcoded switch so `listProviders` (RPC) and the registry
 * share one source of truth for id/label/kind metadata.
 *
 * Each api-key-kind provider's constructor calls secrets.ts's
 * loadProvidersConfig() internally to read its own key/model at construction
 * time (mirrors OllamaProvider's existing "resolve config in the
 * constructor" pattern) — getProvider() itself stays a pure id->instance
 * lookup with no secrets-file knowledge, keeping the registry/secrets
 * responsibilities separated.
 */
import { OllamaProvider } from "./ollamaProvider.js";
import { OpenAiProvider } from "./openaiProvider.js";
import { AnthropicProvider } from "./anthropicProvider.js";
import { GeminiProvider } from "./geminiProvider.js";
import type { LlmProvider } from "./types.js";

export interface ProviderDescriptorInternal {
  id: LlmProvider["id"];
  label: string;
  kind: "local" | "api-key";
  factory: () => LlmProvider;
}

const REGISTRY: ProviderDescriptorInternal[] = [
  { id: "ollama", label: "Ollama", kind: "local", factory: () => new OllamaProvider() },
  { id: "openai", label: "OpenAI", kind: "api-key", factory: () => new OpenAiProvider() },
  { id: "anthropic", label: "Anthropic", kind: "api-key", factory: () => new AnthropicProvider() },
  { id: "gemini", label: "Gemini", kind: "api-key", factory: () => new GeminiProvider() },
];

export function getProvider(id: LlmProvider["id"]): LlmProvider {
  const descriptor = REGISTRY.find((d) => d.id === id);
  if (!descriptor) {
    throw new Error(`Unknown LLM provider id: ${id}`);
  }
  return descriptor.factory();
}

export function listProviderDescriptors(): Array<{ id: LlmProvider["id"]; label: string; kind: "local" | "api-key" }> {
  return REGISTRY.map(({ id, label, kind }) => ({ id, label, kind }));
}
