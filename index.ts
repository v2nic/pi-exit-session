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

// Use a well-known Symbol on process as a cross-module-instance guard.
// A module-scoped boolean would fail when two instances of this module
// are loaded in the same process (e.g. old + new version both installed),
// because each instance has its own copy of the variable.
// Symbol.for() resolves to the same symbol across all module instances.
const REGISTERED = Symbol.for("pi-exit-session:registered");
const SESSION_INFO = Symbol.for("pi-exit-session:sessionInfo");

function getSessionInfo(): SessionInfo | undefined {
  return (process as any)[SESSION_INFO];
}

function setSessionInfo(info: SessionInfo | undefined): void {
  (process as any)[SESSION_INFO] = info;
}

/**
 * Write a crash banner to stderr if session info is available.
 * Returns true if a banner was written, false otherwise.
 * Exported for testing.
 */
export function onProcessError(): boolean {
  const info = getSessionInfo();
  if (!info) return false;
  process.stderr.write(formatCrashBanner(info));
  return true;
}

/**
 * Register process-level error handlers exactly once per process.
 * Uses uncaughtExceptionMonitor so we observe crashes without
 * altering Node's default crash behavior (stack trace + exit).
 * The process.on("exit") handler for normal shutdown is also registered
 * here so it is never duplicated regardless of how many times the
 * extension factory runs.
 * Exported for testing.
 */
export function registerProcessHandlers(): void {
  if ((process as any)[REGISTERED]) return;
  (process as any)[REGISTERED] = true;

  // uncaughtExceptionMonitor fires on uncaught exceptions without
  // suppressing Node's default crash behavior.
  process.on("uncaughtExceptionMonitor", () => {
    onProcessError();
  });

  process.on("unhandledRejection", () => {
    onProcessError();
  });

  // Register the normal-exit banner once here instead of per session_shutdown,
  // so multiple calls to the extension factory don't stack up exit handlers.
  process.on("exit", () => {
    const info = getSessionInfo();
    if (!info) return;

    const resumeCmd = `pi --session ${info.id}`;
    const forkCmd = `pi --fork ${info.id}`;

    if (info.hasUI) {
      const banner = [
        "",
        "\x1b[1m📋 Session ended\x1b[0m",
        `\x1b[36m↩️  Resume:\x1b[0m ${resumeCmd}`,
        `\x1b[35m🔀 Fork:\x1b[0m   ${forkCmd}`,
        "",
      ].join("\n");
      process.stderr.write(banner);
    } else {
      process.stderr.write(`\nSession: ${info.id}\nResume: ${resumeCmd}\nFork:   ${forkCmd}\n`);
    }
  });
}

/**
 * Reset process-global state for testing.
 * If sessionInfo is provided, sets it as the current session info.
 * Also resets the process handler registration guard.
 */
export function _testReset(sessionInfo?: SessionInfo): void {
  setSessionInfo(sessionInfo);
  (process as any)[REGISTERED] = false;
}

export default function (pi: ExtensionAPI) {
  // Register process-level error handlers exactly once per process.
  registerProcessHandlers();

  pi.on("session_start", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const sessionFile = ctx.sessionManager.getSessionFile();
    const id = sessionId || sessionFile;

    if (id) {
      setSessionInfo({ id, sessionFile, hasUI: ctx.hasUI });
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
    setSessionInfo({ id, sessionFile, hasUI: ctx.hasUI });

    if (ctx.hasUI) {
      // In TUI mode, show a brief in-TUI notification.
      // The actual banner is printed by the process.on("exit") handler
      // registered in registerProcessHandlers().
      const resumeCmd = `pi --session ${id}`;
      const forkCmd = `pi --fork ${id}`;
      ctx.ui.notify(
        `📋 Session: ${id}\n↩️  Resume: ${resumeCmd}\n🔀 Fork:   ${forkCmd}`,
        "info"
      );
    } else {
      // Non-TUI mode: write directly to stderr now.
      // The exit handler also runs but only in TUI mode.
      const resumeCmd = `pi --session ${id}`;
      const forkCmd = `pi --fork ${id}`;
      process.stderr.write(`\nSession: ${id}\nResume: ${resumeCmd}\nFork:   ${forkCmd}\n`);
    }
  });
}
