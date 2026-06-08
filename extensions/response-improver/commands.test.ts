import { describe, expect, test } from "vite-plus/test";
import { handleImprove, handleImprover } from "./commands";
import type {
  CommandContextLike,
  OptimizeResult,
  OptimizerModel,
  PiLike,
  ResponseImproverConfig,
} from "./types";

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

function fakePi() {
  const sent: Array<{ content: string; options?: { deliverAs?: "steer" | "followUp" } }> = [];
  const pi: PiLike = {
    sendUserMessage(content, options) {
      sent.push({ content, options });
    },
  };
  return { pi, sent };
}

function fakeCtx(overrides: Partial<CommandContextLike> = {}) {
  const notifications: Array<{ message: string; type?: string }> = [];
  const ctx: CommandContextLike = {
    hasUI: true,
    ui: {
      notify(message, type) {
        notifications.push({ message, type });
      },
    },
    model,
    modelRegistry: {
      find(provider, modelId) {
        return provider === model.provider && modelId === model.id ? model : undefined;
      },
      getAvailable() {
        return [model];
      },
      async getApiKeyAndHeaders() {
        return { ok: true, apiKey: "key" };
      },
    },
    isIdle() {
      return true;
    },
    ...overrides,
  };
  return { ctx, notifications };
}

const configured: ResponseImproverConfig = {
  executionMode: "auto",
  optimizerModel: { provider: "deepseek", model: "deepseek-v4-pro" },
};

const success = (prompt = "optimized prompt"): OptimizeResult => ({ ok: true, prompt, model });

describe("/improve", () => {
  test("empty task shows usage and does not generate or send", async () => {
    const { pi, sent } = fakePi();
    const { ctx, notifications } = fakeCtx();
    let generated = false;
    await handleImprove(pi, ctx, "   ", {
      loadConfig: async () => ({ config: configured, warnings: [] }),
      generateOptimizedPrompt: async () => {
        generated = true;
        return success();
      },
    });
    expect(generated).toBe(false);
    expect(sent).toEqual([]);
    expect(notifications[0]).toMatchObject({ message: "Usage: /improve <task>", type: "warning" });
  });

  test("auto-run sends optimized prompt", async () => {
    const { pi, sent } = fakePi();
    const { ctx } = fakeCtx();
    await handleImprove(pi, ctx, "write a migration plan", {
      loadConfig: async () => ({ config: configured, warnings: [] }),
      generateOptimizedPrompt: async () => success("optimized migration prompt"),
    });
    expect(sent).toEqual([{ content: "optimized migration prompt", options: undefined }]);
  });

  test("preview mode sends edited prompt", async () => {
    const { pi, sent } = fakePi();
    const { ctx } = fakeCtx({
      ui: {
        notify() {},
        editor: async () => " edited optimized prompt ",
      },
    });
    await handleImprove(pi, ctx, "task", {
      loadConfig: async () => ({
        config: { ...configured, executionMode: "preview" },
        warnings: [],
      }),
      generateOptimizedPrompt: async () => success("optimized prompt"),
    });
    expect(sent).toEqual([{ content: "edited optimized prompt", options: undefined }]);
  });

  test("preview cancellation sends nothing", async () => {
    const { pi, sent } = fakePi();
    const { ctx, notifications } = fakeCtx({
      ui: {
        notify(message, type) {
          notifications.push({ message, type });
        },
        editor: async () => undefined,
      },
    });
    await handleImprove(pi, ctx, "task", {
      loadConfig: async () => ({
        config: { ...configured, executionMode: "preview" },
        warnings: [],
      }),
      generateOptimizedPrompt: async () => success("optimized prompt"),
    });
    expect(sent).toEqual([]);
    expect(notifications.at(-1)?.message).toContain("cancelled");
  });

  test("optimizer failure sends no prompt", async () => {
    const { pi, sent } = fakePi();
    const { ctx, notifications } = fakeCtx();
    await handleImprove(pi, ctx, "task", {
      loadConfig: async () => ({ config: configured, warnings: [] }),
      generateOptimizedPrompt: async () => ({ ok: false, reason: "auth", message: "no auth" }),
    });
    expect(sent).toEqual([]);
    expect(notifications.at(-1)).toMatchObject({ message: "no auth", type: "warning" });
  });

  test("busy state queues follow-up", async () => {
    const { pi, sent } = fakePi();
    const { ctx, notifications } = fakeCtx({ isIdle: () => false });
    await handleImprove(pi, ctx, "task", {
      loadConfig: async () => ({ config: configured, warnings: [] }),
      generateOptimizedPrompt: async () => success("optimized prompt"),
    });
    expect(sent).toEqual([{ content: "optimized prompt", options: { deliverAs: "followUp" } }]);
    expect(notifications.at(-1)?.message).toContain("queued");
  });

  test("warns when optimizer provider differs from active provider", async () => {
    const { pi } = fakePi();
    const { ctx, notifications } = fakeCtx({
      model: { ...model, provider: "active-provider" } as OptimizerModel,
    });
    await handleImprove(pi, ctx, "task", {
      loadConfig: async () => ({ config: configured, warnings: [] }),
      generateOptimizedPrompt: async () => success("optimized prompt"),
    });
    expect(notifications[0]!).toMatchObject({ type: "warning" });
    expect(notifications[0]!.message).toContain('optimizer provider "deepseek"');
    expect(notifications[0]!.message).toContain('active provider "active-provider"');
  });

  test("generated prompt is sent as normal user message, not /improve", async () => {
    const { pi, sent } = fakePi();
    const { ctx } = fakeCtx();
    await handleImprove(pi, ctx, "task", {
      loadConfig: async () => ({ config: configured, warnings: [] }),
      generateOptimizedPrompt: async () => success("Do the task well."),
    });
    expect(sent[0]?.content.startsWith("/improve")).toBe(false);
  });

  test("recursive optimized command is rejected", async () => {
    const { pi, sent } = fakePi();
    const { ctx, notifications } = fakeCtx();
    await handleImprove(pi, ctx, "task", {
      loadConfig: async () => ({ config: configured, warnings: [] }),
      generateOptimizedPrompt: async () => success("/improve do this again"),
    });
    expect(sent).toEqual([]);
    expect(notifications.at(-1)?.message).toContain("recursively");
  });
});

describe("/improver", () => {
  test("non-UI invocation shows status and help", async () => {
    const { ctx, notifications } = fakeCtx({ hasUI: false });
    await handleImprover(ctx, "", {
      loadConfig: async () => ({ config: configured, warnings: [] }),
    });
    expect(notifications[0]!.message).toContain("Optimizer model: deepseek/deepseek-v4-pro");
    expect(notifications[0]!.message).toContain("/improver model <provider/model>");
  });

  test("direct model subcommand validates and saves model", async () => {
    const { ctx, notifications } = fakeCtx();
    let saved: ResponseImproverConfig | undefined;
    await handleImprover(ctx, "model deepseek/deepseek-v4-pro", {
      loadConfig: async () => ({ config: { executionMode: "preview" }, warnings: [] }),
      saveConfig: async (config) => {
        saved = config;
      },
    });
    expect(saved?.optimizerModel).toEqual({ provider: "deepseek", model: "deepseek-v4-pro" });
    expect(notifications.at(-1)?.message).toContain("Optimizer model set");
  });

  test("malformed model subcommand does not save", async () => {
    const { ctx, notifications } = fakeCtx();
    let saved = false;
    await handleImprover(ctx, "model invalid", {
      loadConfig: async () => ({ config: configured, warnings: [] }),
      saveConfig: async () => {
        saved = true;
      },
    });
    expect(saved).toBe(false);
    expect(notifications.at(-1)?.message).toContain("Usage: /improver model");
  });

  test("unknown model does not overwrite previous setting", async () => {
    const { ctx, notifications } = fakeCtx();
    let saved = false;
    await handleImprover(ctx, "model missing/model", {
      loadConfig: async () => ({ config: configured, warnings: [] }),
      saveConfig: async () => {
        saved = true;
      },
    });
    expect(saved).toBe(false);
    expect(notifications.at(-1)?.message).toContain("Unknown model");
  });

  test("save failure during model setting notifies error and preserves previous config", async () => {
    const { ctx, notifications } = fakeCtx();
    await handleImprover(ctx, "model deepseek/deepseek-v4-pro", {
      loadConfig: async () => ({ config: configured, warnings: [] }),
      saveConfig: async () => {
        throw new Error("disk full");
      },
    });
    // Returns the config unchanged since save failed.
    const status = notifications.filter((n) => !n.message.includes("Failed to save"));
    expect(status.some((n) => n.message.includes("Optimizer model set"))).toBe(false);
    expect(
      notifications.some((n) =>
        n.message.includes("Failed to save optimizer model setting: disk full"),
      ),
    ).toBe(true);
  });

  test("model subcommand warns when model exists but is not auth-available", async () => {
    const { ctx, notifications } = fakeCtx({
      modelRegistry: {
        find: () => model,
        getAvailable: () => [],
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "key" }),
      },
    });
    await handleImprover(ctx, "model deepseek/deepseek-v4-pro", {
      loadConfig: async () => ({ config: { executionMode: "preview" }, warnings: [] }),
      saveConfig: async () => {},
    });
    expect(notifications.at(-1)?.message).toContain("does not currently report auth available");
    expect(notifications.at(-1)?.type).toBe("warning");
  });

  test("preview and auto subcommands save execution mode", async () => {
    const { ctx } = fakeCtx();
    const saved: ResponseImproverConfig[] = [];
    await handleImprover(ctx, "preview", {
      loadConfig: async () => ({ config: configured, warnings: [] }),
      saveConfig: async (config) => {
        saved.push(config);
      },
    });
    await handleImprover(ctx, "auto", {
      loadConfig: async () => ({
        config: { ...configured, executionMode: "preview" },
        warnings: [],
      }),
      saveConfig: async (config) => {
        saved.push(config);
      },
    });
    expect(saved.map((config) => config.executionMode)).toEqual(["preview", "auto"]);
  });

  test("interactive menu can set model from available model picker", async () => {
    const selections = [
      "Set optimizer model",
      "DeepSeek V4 Pro — deepseek/deepseek-v4-pro • 128k ctx",
    ];
    const { ctx } = fakeCtx({
      ui: {
        notify() {},
        select: async () => selections.shift(),
      },
    });
    let saved: ResponseImproverConfig | undefined;
    await handleImprover(ctx, "", {
      loadConfig: async () => ({ config: { executionMode: "preview" }, warnings: [] }),
      saveConfig: async (config) => {
        saved = config;
      },
    });
    expect(saved?.optimizerModel).toEqual({ provider: "deepseek", model: "deepseek-v4-pro" });
  });
});
