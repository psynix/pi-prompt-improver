import type { Api, Model } from "@earendil-works/pi-ai";

export type ExecutionMode = "preview" | "auto";

export interface OptimizerModelRef {
  provider: string;
  model: string;
}

export interface ResponseImproverConfig {
  optimizerModel?: OptimizerModelRef;
  executionMode: ExecutionMode;
}

export interface ConfigLoadResult {
  config: ResponseImproverConfig;
  warnings: string[];
}

export type OptimizerModel = Model<Api>;

export type OptimizeResult =
  | { ok: true; prompt: string; model: OptimizerModel }
  | {
      ok: false;
      reason: "missing_model" | "auth" | "empty_response" | "aborted" | "error";
      message: string;
    };

export interface UiLike {
  notify(message: string, type?: "info" | "warning" | "error"): void;
  select?(title: string, options: string[]): Promise<string | undefined>;
  input?(title: string, placeholder?: string): Promise<string | undefined>;
  editor?(title: string, initialText: string): Promise<string | undefined>;
  custom?<T>(factory: (...args: any[]) => any, options?: Record<string, unknown>): Promise<T>;
}

export interface CommandContextLike {
  ui: UiLike;
  hasUI?: boolean;
  mode?: string;
  model?: OptimizerModel;
  modelRegistry: {
    find(provider: string, modelId: string): OptimizerModel | undefined;
    getAvailable?: () => OptimizerModel[];
    getApiKeyAndHeaders?: (
      model: OptimizerModel,
    ) => Promise<
      { ok: true; apiKey?: string; headers?: Record<string, string> } | { ok: false; error: string }
    >;
  };
  isIdle?: () => boolean;
}

export interface PiLike {
  sendUserMessage(content: string, options?: { deliverAs?: "steer" | "followUp" }): void;
}
