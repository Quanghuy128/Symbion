import { describe, expect, it } from "vitest";
import { getProvider } from "../src/llm/registry.js";
import { OllamaProvider } from "../src/llm/ollamaProvider.js";
import { RemoteProvider } from "../src/llm/remoteProvider.js";

describe("getProvider", () => {
  it("TC-D9: 'ollama' -> OllamaProvider instance satisfying LlmProvider", () => {
    const provider = getProvider("ollama");
    expect(provider).toBeInstanceOf(OllamaProvider);
    expect(provider.id).toBe("ollama");
    expect(typeof provider.generate).toBe("function");
    expect(typeof provider.listModels).toBe("function");
  });

  it("TC-D9: 'remote' -> RemoteProvider instance satisfying LlmProvider", () => {
    const provider = getProvider("remote");
    expect(provider).toBeInstanceOf(RemoteProvider);
    expect(provider.id).toBe("remote");
    expect(typeof provider.generate).toBe("function");
    expect(typeof provider.listModels).toBe("function");
  });

  it("TC-D9: an unrecognized id throws synchronously (no silent default to Ollama)", () => {
    expect(() => getProvider("bogus" as never)).toThrow();
  });
});
