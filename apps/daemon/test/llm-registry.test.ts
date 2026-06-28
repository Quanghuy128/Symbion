import { describe, expect, it } from "vitest";
import { getProvider, listProviderDescriptors } from "../src/llm/registry.js";
import { OllamaProvider } from "../src/llm/ollamaProvider.js";
import { OpenAiProvider } from "../src/llm/openaiProvider.js";
import { AnthropicProvider } from "../src/llm/anthropicProvider.js";
import { GeminiProvider } from "../src/llm/geminiProvider.js";

describe("listProviderDescriptors", () => {
  it("TC-R1: returns exactly 4 entries with the expected ids and kinds", () => {
    const descriptors = listProviderDescriptors();
    expect(descriptors).toHaveLength(4);
    const byId = new Map(descriptors.map((d) => [d.id, d]));
    expect(byId.get("ollama")?.kind).toBe("local");
    expect(byId.get("openai")?.kind).toBe("api-key");
    expect(byId.get("anthropic")?.kind).toBe("api-key");
    expect(byId.get("gemini")?.kind).toBe("api-key");
  });
});

describe("getProvider", () => {
  it("TC-R2: 'ollama' -> OllamaProvider instance satisfying LlmProvider (regression)", () => {
    const provider = getProvider("ollama");
    expect(provider).toBeInstanceOf(OllamaProvider);
    expect(provider.id).toBe("ollama");
    expect(typeof provider.generate).toBe("function");
    expect(typeof provider.listModels).toBe("function");
  });

  it("TC-R3: 'openai' -> OpenAiProvider instance", () => {
    const provider = getProvider("openai");
    expect(provider).toBeInstanceOf(OpenAiProvider);
    expect(provider.id).toBe("openai");
  });

  it("TC-R4: 'anthropic' -> AnthropicProvider instance (was 'remote' before this feature)", () => {
    const provider = getProvider("anthropic");
    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider.id).toBe("anthropic");
  });

  it("TC-R5: 'gemini' -> GeminiProvider instance", () => {
    const provider = getProvider("gemini");
    expect(provider).toBeInstanceOf(GeminiProvider);
    expect(provider.id).toBe("gemini");
  });

  it("TC-D9 (regression): an unrecognized id throws synchronously (no silent default to Ollama)", () => {
    expect(() => getProvider("bogus" as never)).toThrow();
  });
});
