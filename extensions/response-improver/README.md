# Response Improver Extension

This extension registers two Pi commands:

- `/improve <task>` — generate an optimized prompt with the configured optimizer model, then send it to the active Pi model.
- `/improver` — configure and inspect the optimizer settings.

## Configuration

Run `/improver` in Pi TUI and choose **Set optimizer model** to open a searchable model picker similar to Pi's native model-selection experience.

You can also set the optimizer model with a Pi provider/model reference:

```text
/improver model deepseek/deepseek-v4-pro
```

Settings are persisted in user-local Pi agent state so they survive new sessions and apply across projects.

## Execution modes

Preview/edit is the default:

```text
/improver preview
```

In this mode, `/improve` opens the optimized prompt in an editor. You can edit it, submit it, or cancel. Cancelling sends nothing.

Auto-run skips the editor:

```text
/improver auto
```

In this mode, a successful optimizer response is immediately sent to the active model.

## Status and help

```text
/improver status
```

Shows the optimizer model, execution mode, and command usage. When interactive UI is unavailable, bare `/improver` falls back to this status/help output.

## Trust boundary

`/improve` sends your task text to the configured optimizer model provider. That provider can differ from the active provider that will answer the final prompt. When the providers differ, the extension warns before sending the optimizer request.

## Failure behavior

The extension sends no execution prompt when:

- `/improve` is invoked without a task
- no optimizer model is configured
- the optimizer model is unavailable or unauthenticated
- optimizer generation fails or is cancelled
- preview mode is active but no interactive editor is available
- the user cancels the preview editor
- the edited prompt is empty

## Scope

This extension is explicit by design. It does not intercept ordinary prompts or automatically optimize every user message.
