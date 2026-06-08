# Vite+ Monorepo Starter

A starter for creating a Vite+ monorepo.

## Response Improver Extension

This project includes the **Response Improver** extension for Pi — it registers `/improve` and `/improver` commands that use an optimizer model to enhance task prompts before sending them to the active model.

The extension is auto-discovered via the `pi` field in `package.json`:

```json
"pi": {
  "extensions": ["./extensions/response-improver/index.ts"]
}
```

### Usage

| Command                            | Description                                                 |
| ---------------------------------- | ----------------------------------------------------------- |
| `/improve <task>`                  | Optimize a task prompt and execute it with the active model |
| `/improver`                        | Open configuration menu (TUI)                               |
| `/improver status`                 | Show current settings                                       |
| `/improver model <provider/model>` | Set the optimizer model                                     |
| `/improver preview`                | Preview/edit before execution (default)                     |
| `/improver auto`                   | Auto-run optimized prompts                                  |

See `extensions/response-improver/README.md` for full documentation.

## Development

- Check everything is ready:

```bash
vp run ready
```

- Run the tests:

```bash
vp run -r test
```

- Build the monorepo:

```bash
vp run -r build
```

- Run the development server:

```bash
vp run dev
```
