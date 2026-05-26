import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Information captured at session start for use in process-level error handlers.
 * These handlers fire on uncaughtException/unhandledRejection, where the pi
 * extension context is unavailable, so we must capture info ahead of time.
 */
export interface SessionInfo {
  id: string;
  sessionFile: string | undefined;
  hasUI: boolean;
}

/**
 * Format a crash banner for display after an uncaught exception or unhandled rejection.
 * Includes the session ID, file path, and commands to resume or fork the session.
 */
export function formatCrashBanner(info: SessionInfo): string {
  const resumeCmd = `pi --session ${info.id}`;
  const forkCmd = `pi --fork ${info.id}`;

  if (info.hasUI) {
    return [
      "",
      "\x1b[1m📋 Session crashed\x1b[0m",
      `\x1b[33m📁 File:\x1b[0m    ${info.sessionFile ?? "(unknown)"}`,
      `\x1b[36m↩️  Resume:\x1b[0m  ${resumeCmd}`,
      `\x1b[35m🔀 Fork:\x1b[0m    ${forkCmd}`,
      "",
    ].join("\n");
  }
  return [
    "",
    "Session crashed",
    `File:    ${info.sessionFile ?? "(unknown)"}`,
    `Resume:  ${resumeCmd}`,
    `Fork:    ${forkCmd}`,
    "",
  ].join("\n");
}

// Module-scoped state: shared across all extension instances in the same process.
// This prevents listener accumulation when the extension factory runs multiple times
// (e.g., in tests or hot-reload scenarios) and ensures process error handlers are
// registered only once.
let globalSessionInfo: SessionInfo | undefined;
let processHandlersRegistered = false;

/**
 * Write a crash banner to stderr if session info is available.
 * Returns true if a banner was written, false otherwise.
 * Exported for testing.
 */
export function onProcessError(): boolean {
  if (!globalSessionInfo) return false;
  process.stderr.write(formatCrashBanner(globalSessionInfo));
  return true;
}

/**
 * Register process-level error handlers exactly once per process.
 * Uses uncaughtExceptionMonitor so we observe crashes without
 * altering Node's default crash behavior (stack trace + exit).
 * Exported for testing.
 */
export function registerProcessHandlers(): void {
  if (processHandlersRegistered) return;
  processHandlersRegistered = true;

  process.on("uncaughtExceptionMonitor", () => {
    onProcessError();
  });

  process.on("unhandledRejection", () => {
    onProcessError();
  });
}

/**
 * Reset module-scoped state for testing.
 * If sessionInfo is provided, sets it as the current session info.
 * Also resets the process handler registration guard.
 */
export function _testReset(sessionInfo?: SessionInfo): void {
  globalSessionInfo = sessionInfo;
  processHandlersRegistered = false;
}

export default function (pi: ExtensionAPI) {
  // Register process-level error handlers exactly once per process.
  registerProcessHandlers();

  pi.on("session_start", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const sessionFile = ctx.sessionManager.getSessionFile();
    const id = sessionId || sessionFile;

    if (id) {
      globalSessionInfo = { id, sessionFile, hasUI: ctx.hasUI };
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const sessionFile = ctx.sessionManager.getSessionFile();
    const id = sessionId || sessionFile;

    if (!id) {
      // Ephemeral session (--no-session), nothing to resume
      return;
    }

    // Update session info in case session_start didn't capture it
    globalSessionInfo = { id, sessionFile, hasUI: ctx.hasUI };

    const resumeCmd = `pi --session ${id}`;
    const forkCmd = `pi --fork ${id}`;

    if (ctx.hasUI) {
      // In TUI mode, the alternate screen buffer gets wiped on exit.
      // Show a brief in-TUI notification AND schedule output after TUI teardown.
      ctx.ui.notify(
        `📋 Session: ${id}\n↩️  Resume: ${resumeCmd}\n🔀 Fork:   ${forkCmd}`,
        "info"
      );

      // Schedule the real output for after the TUI restores the main screen.
      // process.on('exit') runs synchronously during process shutdown,
      // after the TUI has restored the terminal to its original state.
      const banner = [
        "",
        "\x1b[1m📋 Session ended\x1b[0m",
        `\x1b[36m↩️  Resume:\x1b[0m ${resumeCmd}`,
        `\x1b[35m🔀 Fork:\x1b[0m   ${forkCmd}`,
        "",
      ].join("\n");
      process.on("exit", () => process.stderr.write(banner));
    } else {
      // Non-TUI mode: write directly to stderr
      process.stderr.write(`\nSession: ${id}\nResume: ${resumeCmd}\nFork:   ${forkCmd}\n`);
    }
  });
}