# pi-exit-session

A [pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extension that prints the session ID and resume/fork commands when you quit a session.

## What it does

When you exit a pi session — whether via `/quit`, `/exit`, `/bye`, Ctrl+C, Ctrl+D, or any other shutdown path — this extension prints:

```
📋 Session: abc123
↩️  Resume: pi --session abc123
🔀 Fork:   pi --fork abc123
```

In non-interactive mode (`-p`, `--mode json`, `--mode rpc`), the same information is written to stderr.

If the session is ephemeral (`--no-session`), nothing is printed (there's nothing to resume).

## Install

### From npm (once published)

```bash
pi install npm:pi-exit-session
```

### From Git

```bash
pi install git:github.com/nicolas-marchildon/pi-exit-session
```

### From local path (for development)

```bash
pi install -l /path/to/pi-exit-session
```

## Development

```bash
npm install
npm run build
npm test
```

## How it works

The extension registers a `session_shutdown` event handler that:

1. Retrieves the session ID via `ctx.sessionManager.getSessionId()`
2. Falls back to the session file path via `ctx.sessionManager.getSessionFile()`
3. Formats and prints the session ID, `--session` (resume) command, and `--fork` command
4. Uses `ctx.ui.notify()` in TUI mode, or `process.stderr.write()` in non-TUI mode

The `session_shutdown` event fires on **every** exit path: `/quit`, `/exit`, `/bye`, Ctrl+C, Ctrl+D, and `ctx.shutdown()`.

## License

MIT