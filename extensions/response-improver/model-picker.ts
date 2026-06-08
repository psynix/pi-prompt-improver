import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import {
  Container,
  Key,
  matchesKey,
  type SelectItem,
  SelectList,
  Text,
} from "@earendil-works/pi-tui";
import { formatModelRef } from "./config";
import type { CommandContextLike, OptimizerModel, OptimizerModelRef } from "./types";

function modelRef(model: OptimizerModel): OptimizerModelRef {
  return { provider: model.provider, model: model.id };
}

function modelValue(model: OptimizerModel): string {
  return formatModelRef(modelRef(model));
}

function formatContextWindow(model: OptimizerModel): string | undefined {
  return typeof model.contextWindow === "number"
    ? `${Math.round(model.contextWindow / 1000)}k ctx`
    : undefined;
}

function modelDescription(model: OptimizerModel, current?: OptimizerModelRef): string {
  const pieces = [
    modelValue(model),
    model.reasoning ? "reasoning" : undefined,
    formatContextWindow(model),
  ].filter(Boolean);
  if (current && current.provider === model.provider && current.model === model.id)
    pieces.unshift("current optimizer");
  return pieces.join(" • ");
}

function modelLabel(model: OptimizerModel): string {
  return model.name && model.name !== model.id ? model.name : model.id;
}

export function availableModelItems(
  models: OptimizerModel[],
  current?: OptimizerModelRef,
): SelectItem[] {
  return models
    .slice()
    .sort((a, b) => modelValue(a).localeCompare(modelValue(b)))
    .map((model) => ({
      value: modelValue(model),
      label: modelLabel(model),
      description: modelDescription(model, current),
    }));
}

export async function chooseOptimizerModel(
  ctx: CommandContextLike,
  current?: OptimizerModelRef,
): Promise<string | undefined> {
  const available = ctx.modelRegistry.getAvailable?.() ?? [];
  if (available.length === 0) {
    return ctx.hasUI && ctx.ui.input
      ? ctx.ui.input("Optimizer model", "provider/model")
      : undefined;
  }

  if (ctx.mode === "tui" && ctx.ui.custom) {
    const items = availableModelItems(available, current);
    return ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
      const container = new Container();
      container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
      container.addChild(new Text(theme.fg("accent", theme.bold("Select optimizer model"))));

      let searchText = "";
      const searchBox = new Text("", 0, 0);
      container.addChild(searchBox);

      function renderSearchBox() {
        const prefix = theme.fg("accent", "🔍 ");
        const filterLabel = theme.fg("muted", `Filter models${searchText.length ? ":" : "..."} `);
        const filterValue = searchText ? theme.fg("text", searchText) : "";
        const clearHint = searchText
          ? `  ${theme.fg("dim", `(${items.filter((item) => matchesFilter(item, searchText)).length} matches • esc to clear)`)}`
          : theme.fg("dim", `  (${items.length} models • esc to cancel)`);
        searchBox.setText(prefix + filterLabel + filterValue + clearHint);
        container.invalidate();
      }

      const list = new SelectList(items, Math.min(items.length, 14), {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      });
      list.onSelect = (item) => done(item.value);
      list.onCancel = () => done(undefined);
      container.addChild(list);
      container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));

      function applyFilter() {
        list.setFilter(searchText);
      }

      function matchesFilter(item: SelectItem, query: string): boolean {
        const lower = query.toLowerCase();
        return (
          item.label.toLowerCase().includes(lower) ||
          (item.description ?? "").toLowerCase().includes(lower)
        );
      }

      renderSearchBox();

      return {
        render(width: number) {
          return container.render(width);
        },
        invalidate() {
          container.invalidate();
        },
        handleInput(data: string) {
          if (matchesKey(data, Key.escape)) {
            if (searchText) {
              searchText = "";
              applyFilter();
              renderSearchBox();
              tui.requestRender();
              return true;
            }
            done(undefined);
            return true;
          }

          if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) {
            if (searchText) {
              searchText = searchText.slice(0, -1);
              applyFilter();
            }
            renderSearchBox();
            tui.requestRender();
            return true;
          }

          if (
            matchesKey(data, Key.up) ||
            matchesKey(data, Key.down) ||
            matchesKey(data, Key.enter)
          ) {
            list.handleInput(data);
            tui.requestRender();
            return true;
          }

          if (data.length === 1 && !data.startsWith("\x1b") && data !== "\r" && data !== "\n") {
            searchText += data;
            applyFilter();
            renderSearchBox();
            tui.requestRender();
            return true;
          }

          return true;
        },
      };
    });
  }

  if (ctx.hasUI && ctx.ui.select) {
    // Build a stable mapping from display label -> model value so we can match
    // on the unique provider/model key after selection, avoiding fragility
    // from string-concatenation parsing.
    const items = availableModelItems(available, current);
    const choiceLabels = items.map((item) => `${item.label} — ${item.description}`);
    choiceLabels.push("Cancel");

    const choice = await ctx.ui.select("Select optimizer model", choiceLabels);
    if (!choice || choice === "Cancel") return undefined;

    const selectedIndex = choiceLabels.indexOf(choice);
    return selectedIndex >= 0 ? items[selectedIndex]?.value : undefined;
  }

  return undefined;
}
