import { complete, type Message } from "@earendil-works/pi-ai";
import { extractErrorMessage } from "./config";
import type {
  CommandContextLike,
  OptimizeResult,
  OptimizerModel,
  ResponseImproverConfig,
} from "./types";

export const OPTIMIZER_SYSTEM_PROMPT = `You are an expert prompt engineer. Given a user's task, write the best possible prompt to give an AI coding assistant so it can produce a 10/10 result.

Return only the optimized executable prompt. Do not include a preamble, explanation, critique, markdown fence, or commentary about what you changed. The returned prompt must be ready to send directly as a user message.`;

export interface CompleteAdapterOptions {
  apiKey?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export type CompleteAdapter = (
  model: OptimizerModel,
  context: { systemPrompt: string; messages: Message[] },
  options: CompleteAdapterOptions,
) => Promise<{ stopReason?: string; content: Array<{ type: string; text?: string }> }>;

// The `complete()` function from @earendil-works/pi-ai accepts a `ProviderStreamOptions`
// parameter whose concrete shape is not exported. The `as Record<string, unknown>` cast
// bridges the gap between our `CompleteAdapterOptions` (which carries the same runtime
// fields — apiKey, headers, signal) and the unexported options type. This is safe at
// runtime because `complete()` reads these fields by name. If the pi-ai options shape
// changes in a future version, this cast will compile but may break at runtime; the
// integration smoke test in optimizer.test.ts guards against this.
export const defaultCompleteAdapter: CompleteAdapter = async (model, context, options) =>
  complete(model, context, options as Record<string, unknown>);

export function extractTextContent(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter(
      (item): item is { type: "text"; text: string } =>
        item.type === "text" && typeof item.text === "string",
    )
    .map((item) => item.text)
    .join("\n")
    .trim();
}

export function redactSensitiveError(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-[REDACTED]")
    .replace(/(api[_-]?key["'\s:=]+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[REDACTED]");
}

export async function generateOptimizedPrompt(
  ctx: CommandContextLike,
  config: ResponseImproverConfig,
  task: string,
  options: { signal?: AbortSignal; completeAdapter?: CompleteAdapter } = {},
): Promise<OptimizeResult> {
  if (!config.optimizerModel) {
    return {
      ok: false,
      reason: "missing_model",
      message: "No optimizer model configured. Run /improver model <provider/model> first.",
    };
  }

  const model = ctx.modelRegistry.find(config.optimizerModel.provider, config.optimizerModel.model);
  if (!model) {
    return {
      ok: false,
      reason: "missing_model",
      message: `Optimizer model not found: ${config.optimizerModel.provider}/${config.optimizerModel.model}`,
    };
  }

  if (!ctx.modelRegistry.getApiKeyAndHeaders) {
    return {
      ok: false,
      reason: "auth",
      message: "Pi model registry cannot provide optimizer model credentials.",
    };
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    return { ok: false, reason: "auth", message: redactSensitiveError(auth.error) };
  }

  try {
    const userMessage: Message = {
      role: "user",
      content: [
        {
          type: "text",
          text: `<userTask>\n${task.trim()}\n</userTask>\n\nWrite the optimized prompt now.`,
        },
      ],
      timestamp: Date.now(),
    };

    const adapter = options.completeAdapter ?? defaultCompleteAdapter;
    const response = await adapter(
      model,
      { systemPrompt: OPTIMIZER_SYSTEM_PROMPT, messages: [userMessage] },
      { apiKey: auth.apiKey, headers: auth.headers, signal: options.signal },
    );

    if (response.stopReason === "aborted") {
      return { ok: false, reason: "aborted", message: "Optimizer generation was cancelled." };
    }

    const prompt = extractTextContent(response.content);
    if (!prompt) {
      return {
        ok: false,
        reason: "empty_response",
        message: "Optimizer model returned an empty prompt.",
      };
    }

    return { ok: true, prompt, model };
  } catch (error) {
    if (options.signal?.aborted) {
      return { ok: false, reason: "aborted", message: "Optimizer generation was cancelled." };
    }
    const message = redactSensitiveError(extractErrorMessage(error));
    return { ok: false, reason: "error", message: `Optimizer generation failed: ${message}` };
  }
}
