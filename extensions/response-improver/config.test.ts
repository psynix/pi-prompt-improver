import { afterEach, describe, expect, test } from "vite-plus/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  DEFAULT_CONFIG,
  formatModelRef,
  loadConfig,
  parseModelRef,
  saveConfig,
  validateConfig,
} from "./config";

const tempDirs: string[] = [];

async function tempConfigPath() {
  const dir = await mkdtemp(join(tmpdir(), "response-improver-test-"));
  tempDirs.push(dir);
  return join(dir, "config.json");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("config", () => {
  test("loads defaults when config file is missing", async () => {
    const path = await tempConfigPath();
    const result = await loadConfig(join(path, "missing.json"));
    expect(result.config).toEqual(DEFAULT_CONFIG);
    expect(result.warnings).toEqual([]);
  });

  test("round-trips optimizer model and auto mode", async () => {
    const path = await tempConfigPath();
    await saveConfig(
      { executionMode: "auto", optimizerModel: { provider: "deepseek", model: "deepseek-v4-pro" } },
      path,
    );
    const result = await loadConfig(path);
    expect(result.config).toEqual({
      executionMode: "auto",
      optimizerModel: { provider: "deepseek", model: "deepseek-v4-pro" },
    });
    expect(await readFile(path, "utf8")).toContain("deepseek-v4-pro");
  });

  test("invalid JSON falls back to defaults with warning", async () => {
    const path = await tempConfigPath();
    await writeFile(path, "not json", "utf8");
    const result = await loadConfig(path);
    expect(result.config).toEqual(DEFAULT_CONFIG);
    expect(result.warnings[0]).toContain("Could not load response improver config");
  });

  test("invalid execution mode normalizes to preview", () => {
    const result = validateConfig({
      executionMode: "fast",
      optimizerModel: { provider: "p", model: "m" },
    });
    expect(result.config.executionMode).toBe("preview");
    expect(result.config.optimizerModel).toEqual({ provider: "p", model: "m" });
    expect(result.warnings).toContain("Invalid executionMode; using preview mode.");
  });

  test("invalid optimizer model is dropped", () => {
    const result = validateConfig({ executionMode: "auto", optimizerModel: { provider: "p" } });
    expect(result.config).toEqual({ executionMode: "auto", optimizerModel: undefined });
    expect(result.warnings[0]).toContain("Invalid optimizerModel");
  });

  test("parses and formats model references", () => {
    expect(parseModelRef("deepseek/deepseek-v4-pro")).toEqual({
      provider: "deepseek",
      model: "deepseek-v4-pro",
    });
    expect(parseModelRef("openrouter/nvidia/nemotron")).toEqual({
      provider: "openrouter",
      model: "nvidia/nemotron",
    });
    expect(parseModelRef("missing-slash")).toBeUndefined();
    expect(formatModelRef({ provider: "p", model: "m" })).toBe("p/m");
    expect(formatModelRef()).toBe("not configured");
  });

  test("saveConfig throws when a regular file blocks the target directory path", async () => {
    const path = await tempConfigPath();
    // Create a regular file where a directory is expected, so mkdir throws ENOTDIR.
    const blocker = join(dirname(path), "blocker");
    await writeFile(blocker, "block", "utf8");
    const blockedConfigPath = join(blocker, "config.json");
    await expect(saveConfig({ executionMode: "preview" }, blockedConfigPath)).rejects.toThrow();
  });
});
