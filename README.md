# pi-prompt-improver

Let the model improve its own prompts before answering. `pi-prompt-improver` adds `/improve` and `/improver` commands to [Pi Agent](https://github.com/badlogic/pi-mono) — it sends your task to a configurable _optimizer_ model that returns an optimized prompt, then forwards that prompt to your active model for execution.

## Features

- **Two-command design** — `/improve <task>` optimizes and runs; `/improver` configures the optimizer model and execution mode.
- **Configurable optimizer model** — pick any model available in your Pi registry via searchable TUI picker or direct `provider/model` reference.
- **Preview/edit mode** — review the optimized prompt before it reaches your active model; edit, submit, or cancel.
- **Auto-run mode** — skip the editor and send optimized prompts directly.
- **Cross-provider safety** — when the optimizer and active models are from different providers, a warning is shown before the request is sent.
- **Recursive-command guard** — `/improve` detects and blocks optimization results that would recursively invoke `/improve` again.
- **Sensitive-data redaction** — API keys and bearer tokens are redacted from optimizer error messages before they reach the user.
- **Searchable model picker** — custom TUI component with keyboard-driven filtering, styled as a native Pi selector.
- **Atomic config persistence** — settings are saved atomically (temp file + rename) with secure file permissions (`0o600`), surviving session deletion and spanning all projects.

## Install

```bash
pi install npm:pi-prompt-improver
```

Or clone the repository and let Pi discover the extension via the `pi` field in `package.json`. Restart your Pi session after installing.

### Manual placement

Place the extension directory in your auto-discovered extensions path:

```bash
cp -r extensions/response-improver ~/.pi/agent/extensions/response-improver
```

The extension is also discoverable via the `pi` field in this project's `package.json`:

```json
"pi": {
  "extensions": ["./extensions/response-improver/index.ts"]
}
```

## Commands

### `/improve <task>`

Send a task description to the configured optimizer model. The optimizer generates an improved prompt, which is then sent to your active Pi model.

```
/improve write a migration plan for PostgreSQL to CockroachDB
```

If the optimizer model belongs to a different provider than your active model, a warning is shown before the request proceeds.

### `/improver`

Configure and inspect the Response Improver settings. When run without arguments in a TUI session, opens an interactive menu:

```
/improver
```

**Subcommands:**

| Subcommand                         | Description                                           |
| ---------------------------------- | ----------------------------------------------------- |
| `/improver status`                 | Show current optimizer model and execution mode       |
| `/improver model <provider/model>` | Set optimizer model (e.g. `deepseek/deepseek-v4-pro`) |
| `/improver preview`                | Switch to preview/edit mode (default)                 |
| `/improver auto`                   | Switch to auto-run mode                               |

Tab-completion is available for subcommands — type `/improver ` then press `Tab`.

### Execution modes

**Preview/edit** (default) — `/improver preview` opens the optimized prompt in an editor before it is sent. You can edit the prompt, submit it, or cancel. Cancelling sends nothing.

**Auto-run** — `/improver auto` sends the optimized prompt immediately after generation, skipping the editor.

## Configuration

Settings are persisted to `~/.pi/agent/response-improver/config.json` using an atomic write strategy (temp file + `rename`) with secure permissions. Configuration survives session deletion and applies across all projects.

### Optimizer model

Set the optimizer model interactively:

```
/improver
→ Select "Set optimizer model" in the menu
```

Or directly:

```
/improver model deepseek/deepseek-v4-pro
```

The model reference format is `<provider>/<model-id>`.

### Execution mode

```
/improver preview      # Review before sending (default)
/improver auto         # Send immediately
```

## Trust boundary

`/improve` sends your task text to the configured optimizer model provider. That provider can differ from the active provider that answers the final prompt. When the providers differ, a warning is raised before the optimizer request is sent.

The extension is explicit by design — it does not intercept ordinary prompts or automatically optimize every user message.

## Failure behavior

The extension does **not** send an execution prompt when:

- `/improve` is invoked without a task
- No optimizer model is configured
- The optimizer model is unavailable or unauthenticated
- Optimizer generation fails or is cancelled
- Preview mode is active but no interactive editor is available
- The user cancels the preview editor
- The edited prompt is empty
- The optimized prompt would recursively invoke `/improve`

## Development

The project uses [Vite+](https://viteplus.dev), a unified toolchain built on Vite, Rolldown, Vitest, Oxlint, and Oxfmt. All checks and tests run through the `vp` CLI.

### Setup

```bash
vp install
```

### Validate

```bash
vp check          # Format, lint, and type-check
vp test           # Run test suite
vp run ready      # Full validation (check + test + build)
```

### Project structure

```
extensions/
  response-improver/
    index.ts              # Extension entry point, session_start config validation
    commands.ts           # /improve and /improver command handlers + argument completions
    config.ts             # Config load/save with atomic writes, error utilities
    types.ts              # Shared type definitions
    model-picker.ts       # Searchable TUI model selector component
    optimizer.ts          # Optimizer prompt generation via pi-ai's complete()
    *.test.ts             # Test suite (34 tests)
```

## Requirements

- **Node.js** >= 22.12.0
- **Pi Agent** with extension support (`@earendil-works/pi-coding-agent`)
- **bun** 1.3.14 (package manager)
- An API key for at least one model provider configured in Pi (for the active model) and optionally a different provider for the optimizer model
