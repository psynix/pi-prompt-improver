import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  ConfigLoadResult,
  ExecutionMode,
  OptimizerModelRef,
  ResponseImproverConfig,
} from "./types";

// Config is stored as a user-local file (not pi.appendEntry) because these are
// user-level settings that should:
//   - Survive session deletion and /new
//   - Apply across all projects (not per-session)
//   - Be shareable between concurrent pi instances
// pi.appendEntry is designed for per-session branching state; user configuration
// is intentionally kept outside that lifecycle.
//
// The path lives under `~/.pi/agent/` (Pi's own agent config directory) in a
// unique subdirectory per extension to avoid collisions and keep related data
// together. An atomic-write strategy (temp file + rename) protects against
// partial writes from crashes or concurrent access.
export const CONFIG_PATH = join(homedir(), ".pi", "agent", "response-improver", "config.json");

export const DEFAULT_CONFIG: ResponseImproverConfig = {
  executionMode: "preview",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseModelRef(input: string): OptimizerModelRef | undefined {
  const trimmed = input.trim();
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0 || slashIndex === trimmed.length - 1) return undefined;
  const provider = trimmed.slice(0, slashIndex).trim();
  const model = trimmed.slice(slashIndex + 1).trim();
  if (!provider || !model) return undefined;
  return { provider, model };
}

export function formatModelRef(model?: OptimizerModelRef): string {
  return model ? `${model.provider}/${model.model}` : "not configured";
}

function normalizeExecutionMode(value: unknown, warnings: string[]): ExecutionMode {
  if (value === "preview" || value === "auto") return value;
  if (value !== undefined) warnings.push("Invalid executionMode; using preview mode.");
  return DEFAULT_CONFIG.executionMode;
}

function normalizeOptimizerModel(
  value: unknown,
  warnings: string[],
): OptimizerModelRef | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) {
    warnings.push("Invalid optimizerModel; leaving optimizer model unconfigured.");
    return undefined;
  }
  if (typeof value.provider !== "string" || typeof value.model !== "string") {
    warnings.push("Invalid optimizerModel; leaving optimizer model unconfigured.");
    return undefined;
  }
  const provider = value.provider.trim();
  const model = value.model.trim();
  if (!provider || !model) {
    warnings.push("Invalid optimizerModel; leaving optimizer model unconfigured.");
    return undefined;
  }
  return { provider, model };
}

export function validateConfig(raw: unknown): ConfigLoadResult {
  const warnings: string[] = [];
  if (!isObject(raw)) {
    return {
      config: { ...DEFAULT_CONFIG },
      warnings: ["Response improver config must be a JSON object; using defaults."],
    };
  }

  return {
    config: {
      executionMode: normalizeExecutionMode(raw.executionMode, warnings),
      optimizerModel: normalizeOptimizerModel(raw.optimizerModel, warnings),
    },
    warnings,
  };
}

export async function loadConfig(configPath = CONFIG_PATH): Promise<ConfigLoadResult> {
  if (!existsSync(configPath)) return { config: { ...DEFAULT_CONFIG }, warnings: [] };
  try {
    const raw = JSON.parse(await readFile(configPath, "utf8"));
    return validateConfig(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      config: { ...DEFAULT_CONFIG },
      warnings: [`Could not load response improver config (${message}); using defaults.`],
    };
  }
}

export async function saveConfig(
  config: ResponseImproverConfig,
  configPath = CONFIG_PATH,
): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  await chmod(dirname(configPath), 0o700).catch(() => undefined);
  const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tempPath, configPath);
  } catch (error) {
    // Remove the temp file on failure so stale temp files don't accumulate.
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(tempPath);
    } catch {
      /* best effort */
    }
    throw error;
  }
  await chmod(configPath, 0o600).catch(() => undefined);
}

export function withConfig(
  config: ResponseImproverConfig,
  patch: Partial<ResponseImproverConfig>,
): ResponseImproverConfig {
  return { ...config, ...patch };
}
