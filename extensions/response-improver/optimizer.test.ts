import { describe, expect, test } from "vite-plus/test";
import {
  defaultCompleteAdapter,
  generateOptimizedPrompt,
  OPTIMIZER_SYSTEM_PROMPT,
  redactSensitiveError,
} from "./optimizer";
import type { CommandContextLike, OptimizerModel } from "./types";

const model = {
  provider: "deepseek",
  id: "deepseek-v4-pro",
  name: "DeepSeek V4 Pro",
  api: "openai-completions",
  baseUrl: "https://example.com",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 4096,
} as OptimizerModel;

function ctxWith(overrides: Partial<CommandContextLike["modelRegistry"]> = {}): CommandContextLike {
  return {
    ui: { notify() {} },
    model,
    modelRegistry: {
      find(provider, modelId) {
        return provider === model.provider && modelId === model.id ? model : undefined;
      },
      async getApiKeyAndHeaders() {
        return { ok: true, apiKey: "key", headers: { "x-test": "1" } };
      },
      ...overrides,
    },
  };
}

describe("optimizer", () => {
  test("uses configured model and trims optimized prompt without changing active model", async () => {
    const activeModel = { ...model, provider: "active", id: "active-model" } as OptimizerModel;
    let usedModel: OptimizerModel | undefined;
    const ctx = { ...ctxWith(), model: activeModel };
    const result = await generateOptimizedPrompt(
      ctx,
      {
        executionMode: "preview",
        optimizerModel: { provider: "deepseek", model: "deepseek-v4-pro" },
      },
      "write a plan",
      {
        completeAdapter: async (receivedModel) => {
          usedModel = receivedModel;
          return { content: [{ type: "text", text: "  Optimized prompt  " }] };
        },
      },
    );
    expect(result).toMatchObject({ ok: true, prompt: "Optimized prompt" });
    expect(usedModel).toBe(model);
    expect(ctx.model).toBe(activeModel);
  });

  test("fails when optimizer model is not configured", async () => {
    const result = await generateOptimizedPrompt(ctxWith(), { executionMode: "preview" }, "task");
    expect(result).toMatchObject({ ok: false, reason: "missing_model" });
  });

  test("fails when optimizer model cannot be found", async () => {
    const result = await generateOptimizedPrompt(
      ctxWith({ find: () => undefined }),
      { executionMode: "preview", optimizerModel: { provider: "missing", model: "missing" } },
      "task",
    );
    expect(result).toMatchObject({ ok: false, reason: "missing_model" });
  });

  test("fails when auth is unavailable", async () => {
    const result = await generateOptimizedPrompt(
      ctxWith({ getApiKeyAndHeaders: async () => ({ ok: false, error: "no auth" }) }),
      {
        executionMode: "preview",
        optimizerModel: { provider: "deepseek", model: "deepseek-v4-pro" },
      },
      "task",
    );
    expect(result).toMatchObject({ ok: false, reason: "auth", message: "no auth" });
  });

  test("returns aborted for aborted stop reason", async () => {
    const result = await generateOptimizedPrompt(
      ctxWith(),
      {
        executionMode: "preview",
        optimizerModel: { provider: "deepseek", model: "deepseek-v4-pro" },
      },
      "task",
      { completeAdapter: async () => ({ stopReason: "aborted", content: [] }) },
    );
    expect(result).toMatchObject({ ok: false, reason: "aborted" });
  });

  test("rejects empty optimizer response", async () => {
    const result = await generateOptimizedPrompt(
      ctxWith(),
      {
        executionMode: "preview",
        optimizerModel: { provider: "deepseek", model: "deepseek-v4-pro" },
      },
      "task",
      { completeAdapter: async () => ({ content: [{ type: "text", text: "   " }] }) },
    );
    expect(result).toMatchObject({ ok: false, reason: "empty_response" });
  });

  test("optimizer prompt contract asks for no meta-commentary", () => {
    expect(OPTIMIZER_SYSTEM_PROMPT).toContain("Return only the optimized executable prompt");
    expect(OPTIMIZER_SYSTEM_PROMPT).toContain("Do not include a preamble");
  });

  test("defaultCompleteAdapter is a callable function that returns a Promise", () => {
    // Structural guard: verifies the adapter exists and has the expected signature.
    // The cast in defaultCompleteAdapter bridges pi-ai's unexported options type;
    // this test confirms the adapter is callable and surfaces regressions early.
    expect(typeof defaultCompleteAdapter).toBe("function");
    const result = defaultCompleteAdapter(model, { systemPrompt: "test", messages: [] }, {});
    expect(result).toBeInstanceOf(Promise);
  });

  test("redacts sensitive values from error messages", () => {
    expect(
      redactSensitiveError("failed with Bearer sk-testsecret123456 and api_key=abc123456789"),
    ).toBe("failed with Bearer [REDACTED] and api_key=[REDACTED]");
  });
});
