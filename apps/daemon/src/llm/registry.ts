/**
 * getProvider — tiny factory resolving a provider id to its LlmProvider
 * implementation. v1's web UI only ever sends "ollama" (the default per
 * STATE §9); "remote" is still accepted so the seam is exercised by unit
 * tests even though no web control sends it yet.
 */
import { OllamaProvider } from "./ollamaProvider.js";
import { RemoteProvider } from "./remoteProvider.js";
import type { LlmProvider } from "./types.js";

export function getProvider(providerId: "ollama" | "remote"): LlmProvider {
  switch (providerId) {
    case "ollama":
      return new OllamaProvider();
    case "remote":
      return new RemoteProvider();
    default: {
      const exhaustive: never = providerId;
      throw new Error(`Unknown LLM provider id: ${exhaustive}`);
    }
  }
}
