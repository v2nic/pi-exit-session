# pi-exit-session

A [pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extension that prints the session ID and resume/fork commands when you quit a session.

## What it does

When you exit a pi session — whether via `/quit`, `/exit`, `/bye`, Ctrl+C, Ctrl+D, or any other shutdown path — this extension prints a banner after the TUI restores your terminal:

```
📋 Session ended
↩️  Resume: pi --session 019e6297-e856-7b1e-963d-25e2cd43592e
🔀 Fork:   pi --fork 019e6297-e856-7b1e-963d-25e2cd43592e
```

In non-interactive mode (`-p`, `--mode json`, `--mode rpc`), the same information is written to stderr without ANSI colors.

If the session is ephemeral (`--no-session`), nothing is printed.

## Install

```bash
pi install git:github.com/v2nic/pi-exit-session
```

## Development

```bash
npm install
npm test
```

## How it works

The extension registers a `session_shutdown` event handler that:

1. Retrieves the session ID via `ctx.sessionManager.getSessionId()`
2. Falls back to the session file path if the ID is empty
3. In TUI mode: shows a brief `ctx.ui.notify()` and schedules a `process.on('exit')` callback that writes the banner to stderr **after** the TUI restores the main screen buffer
4. In non-TUI mode: writes directly to stderr

The `session_shutdown` event fires on **every** exit path: `/quit`, `/exit`, `/bye`, Ctrl+C, Ctrl+D, and `ctx.shutdown()`.

## License

MIT