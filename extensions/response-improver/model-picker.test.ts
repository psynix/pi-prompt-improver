import { describe, expect, test } from "vite-plus/test";
import { availableModelItems } from "./model-picker";
import type { OptimizerModel } from "./types";

const model = {
  provider: "deepseek",
  id: "deepseek-v4-pro",
  name: "DeepSeek V4 Pro",
  api: "openai-completions",
  baseUrl: "https://example.com",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 4096,
} as OptimizerModel;

describe("model picker", () => {
  test("builds native-like selectable model items", () => {
    const items = availableModelItems([model], { provider: "deepseek", model: "deepseek-v4-pro" });
    expect(items).toEqual([
      {
        value: "deepseek/deepseek-v4-pro",
        label: "DeepSeek V4 Pro",
        description: "current optimizer • deepseek/deepseek-v4-pro • reasoning • 128k ctx",
      },
    ]);
  });
});
