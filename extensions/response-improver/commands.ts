import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import {
  extractErrorMessage,
  formatModelRef,
  loadConfig,
  parseModelRef,
  saveConfig,
  withConfig,
} from "./config";
import { chooseOptimizerModel } from "./model-picker";
import { generateOptimizedPrompt, type CompleteAdapter } from "./optimizer";
import type { CommandContextLike, ExecutionMode, PiLike, ResponseImproverConfig } from "./types";

export interface CommandDeps {
  loadConfig?: typeof loadConfig;
  saveConfig?: typeof saveConfig;
  generateOptimizedPrompt?: typeof generateOptimizedPrompt;
  completeAdapter?: CompleteAdapter;
}

export const HELP_TEXT = `Usage:
/improve <task>                      Improve a task prompt, then execute it with the active model
/improver                            Open the improver menu when UI is available
/improver status                     Show current settings
/improver model <provider/model>     Set optimizer model
/improver preview                    Preview/edit before execution
/improver auto                       Auto-run optimized prompts`;

function notifyWarnings(ctx: CommandContextLike, warnings: string[]) {
  for (const warning of warnings) ctx.ui.notify(warning, "warning");
}

export function formatStatus(config: ResponseImproverConfig): string {
  return `Response Improver
Optimizer model: ${formatModelRef(config.optimizerModel)}
Execution mode: ${config.executionMode === "auto" ? "auto-run" : "preview/edit"}

${HELP_TEXT}`;
}

async function setOptimizerModel(
  ctx: CommandContextLike,
  config: ResponseImproverConfig,
  modelRefText: string,
  deps: Required<Pick<CommandDeps, "saveConfig">>,
): Promise<ResponseImproverConfig> {
  const modelRef = parseModelRef(modelRefText);
  if (!modelRef) {
    ctx.ui.notify("Usage: /improver model <provider/model>", "warning");
    return config;
  }
  const model = ctx.modelRegistry.find(modelRef.provider, modelRef.model);
  if (!model) {
    ctx.ui.notify(`Unknown model: ${modelRef.provider}/${modelRef.model}`, "warning");
    return config;
  }
  const next = withConfig(config, { optimizerModel: modelRef });
  try {
    await deps.saveConfig(next);
  } catch (error) {
    const message = extractErrorMessage(error);
    ctx.ui.notify(`Failed to save optimizer model setting: ${message}`, "error");
    return config;
  }
  ctx.ui.notify(`Optimizer model set to ${formatModelRef(modelRef)}`, "info");
  const available = ctx.modelRegistry.getAvailable?.();
  if (
    available &&
    !available.some(
      (availableModel) =>
        availableModel.provider === model.provider && availableModel.id === model.id,
    )
  ) {
    ctx.ui.notify(
      `Pi does not currently report auth available for ${formatModelRef(modelRef)}; /improve will fail until credentials are configured.`,
      "warning",
    );
  }
  return next;
}

async function setExecutionMode(
  ctx: CommandContextLike,
  config: ResponseImproverConfig,
  mode: ExecutionMode,
  deps: Required<Pick<CommandDeps, "saveConfig">>,
): Promise<ResponseImproverConfig> {
  const next = withConfig(config, { executionMode: mode });
  try {
    await deps.saveConfig(next);
  } catch (error) {
    const message = extractErrorMessage(error);
    ctx.ui.notify(`Failed to save execution mode setting: ${message}`, "error");
    return config;
  }
  ctx.ui.notify(
    `Response Improver execution mode set to ${mode === "auto" ? "auto-run" : "preview/edit"}.`,
    "info",
  );
  return next;
}

export async function handleImprove(
  pi: PiLike,
  ctx: CommandContextLike,
  args: string,
  deps: CommandDeps = {},
): Promise<void> {
  const load = deps.loadConfig ?? loadConfig;
  const generate = deps.generateOptimizedPrompt ?? generateOptimizedPrompt;
  const task = args.trim();
  if (!task) {
    ctx.ui.notify("Usage: /improve <task>", "warning");
    return;
  }

  const { config, warnings } = await load();
  notifyWarnings(ctx, warnings);

  if (
    config.optimizerModel &&
    ctx.model?.provider &&
    config.optimizerModel.provider !== ctx.model.provider
  ) {
    ctx.ui.notify(
      `Response Improver will send this task to optimizer provider "${config.optimizerModel.provider}" before execution by active provider "${ctx.model.provider}".`,
      "warning",
    );
  }

  const result = await generate(ctx, config, task, { completeAdapter: deps.completeAdapter });
  if (!result.ok) {
    ctx.ui.notify(result.message, result.reason === "aborted" ? "info" : "warning");
    return;
  }

  let finalPrompt = result.prompt;
  if (config.executionMode === "preview") {
    if (!ctx.hasUI || !ctx.ui.editor) {
      ctx.ui.notify(
        "Preview mode requires interactive UI. Run /improver auto to enable auto-run mode.",
        "warning",
      );
      return;
    }
    const edited = await ctx.ui.editor("Review optimized prompt", finalPrompt);
    if (edited === undefined) {
      ctx.ui.notify("Response Improver cancelled; optimized prompt was not sent.", "info");
      return;
    }
    finalPrompt = edited.trim();
    if (!finalPrompt) {
      ctx.ui.notify("Response Improver cancelled; edited prompt was empty.", "warning");
      return;
    }
  }

  if (/^\/improver?\b/i.test(finalPrompt)) {
    ctx.ui.notify(
      "Response Improver stopped because the optimized prompt would invoke /improve recursively.",
      "warning",
    );
    return;
  }

  if (ctx.isIdle?.() === false) {
    pi.sendUserMessage(finalPrompt, { deliverAs: "followUp" });
    ctx.ui.notify("Optimized prompt queued as a follow-up message.", "info");
    return;
  }

  pi.sendUserMessage(finalPrompt);
}

export async function handleImprover(
  ctx: CommandContextLike,
  args: string,
  deps: CommandDeps = {},
): Promise<void> {
  const load = deps.loadConfig ?? loadConfig;
  const save = deps.saveConfig ?? saveConfig;
  let { config, warnings } = await load();
  notifyWarnings(ctx, warnings);

  const trimmed = args.trim();
  const [command = "", ...rest] = trimmed.split(/\s+/).filter(Boolean);
  const subcommand = command.toLowerCase();

  if (subcommand === "status" || subcommand === "help") {
    ctx.ui.notify(formatStatus(config), "info");
    return;
  }

  if (subcommand === "model") {
    config = await setOptimizerModel(ctx, config, rest.join(" "), { saveConfig: save });
    return;
  }

  if (subcommand === "preview") {
    await setExecutionMode(ctx, config, "preview", { saveConfig: save });
    return;
  }

  if (subcommand === "auto" || subcommand === "autorun" || subcommand === "auto-run") {
    await setExecutionMode(ctx, config, "auto", { saveConfig: save });
    return;
  }

  if (subcommand) {
    ctx.ui.notify(`Unknown /improver command: ${subcommand}\n\n${HELP_TEXT}`, "warning");
    return;
  }

  if (!ctx.hasUI || !ctx.ui.select) {
    ctx.ui.notify(formatStatus(config), "info");
    return;
  }

  const options = [
    "Set optimizer model",
    config.executionMode === "preview" ? "Switch to auto-run" : "Switch to preview/edit",
    "Show status/help",
    "Cancel",
  ];
  const choice = await ctx.ui.select("Response Improver", options);
  if (!choice || choice === "Cancel") return;

  if (choice === "Show status/help") {
    ctx.ui.notify(formatStatus(config), "info");
    return;
  }

  if (choice === "Set optimizer model") {
    const modelRef = await chooseOptimizerModel(ctx, config.optimizerModel);
    if (!modelRef) return;
    await setOptimizerModel(ctx, config, modelRef, { saveConfig: save });
    return;
  }

  if (choice === "Switch to auto-run") {
    await setExecutionMode(ctx, config, "auto", { saveConfig: save });
    return;
  }

  if (choice === "Switch to preview/edit") {
    await setExecutionMode(ctx, config, "preview", { saveConfig: save });
  }
}

export function registerCommands(pi: ExtensionAPI, deps: CommandDeps = {}) {
  pi.registerCommand("improve", {
    description:
      "Improve a task prompt with the configured optimizer model, then execute it with the active model",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      await handleImprove(pi, ctx, args, deps);
    },
  });

  pi.registerCommand("improver", {
    description: "Configure Response Improver",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const subcommands = [
        { value: "status", label: "status", description: "Show current settings" },
        {
          value: "model ",
          label: "model ",
          description: "Set optimizer model (e.g. model deepseek/deepseek-v4-pro)",
        },
        { value: "preview", label: "preview", description: "Switch to preview/edit mode" },
        { value: "auto", label: "auto", description: "Switch to auto-run mode" },
        { value: "help", label: "help", description: "Show help text" },
      ];
      if (!prefix) return subcommands;
      const filtered = subcommands.filter((c) => c.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      await handleImprover(ctx, args, deps);
    },
  });
}
