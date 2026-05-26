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

/**
 * Format the normal "Session ended" exit banner (TUI mode only).
 * Exported for testing.
 */
export function formatExitBanner(info: SessionInfo): string {
  const resumeCmd = `pi --session ${info.id}`;
  const forkCmd = `pi --fork ${info.id}`;

  return [
    "",
    "\x1b[1m📋 Session ended\x1b[0m",
    `\x1b[36m↩️  Resume:\x1b[0m ${resumeCmd}`,
    `\x1b[35m🔀 Fork:\x1b[0m   ${forkCmd}`,
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
 * Also registers a process.on("exit") handler for TUI mode that prints
 * the "Session ended" banner after the TUI restores the main screen.
 * Exported for testing.
 */
export function registerProcessHandlers(): void {
  if ((process as any)[REGISTERED]) return;
  (process as any)[REGISTERED] = true;

  process.on("uncaughtExceptionMonitor", () => {
    onProcessError();
  });

  process.on("unhandledRejection", () => {
    onProcessError();
  });

  // Print the "Session ended" banner on normal exit (TUI mode only).
  // Skipped when:
  // - exit code is non-zero (crash banner was already printed)
  // - session is non-TUI (non-TUI already writes to stderr in session_shutdown)
  // - no session info (ephemeral session)
  process.on("exit", (code: number) => {
    if (code !== 0) return;
    const info = getSessionInfo();
    if (!info || !info.hasUI) return;
    process.stderr.write(formatExitBanner(info));
  });
}

/**
 * Reset session info for testing.
 * Does NOT reset the REGISTERED guard or remove process listeners —
 * doing so would cause listener accumulation across test runs.
 * Only resets the session info so tests start with a clean slate.
 */
export function _testReset(sessionInfo?: SessionInfo): void {
  setSessionInfo(sessionInfo);
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

    // Update session info so the process.on("exit") handler has the latest state.
    setSessionInfo({ id, sessionFile, hasUI: ctx.hasUI });

    const resumeCmd = `pi --session ${id}`;
    const forkCmd = `pi --fork ${id}`;

    if (ctx.hasUI) {
      // In TUI mode, show a brief in-TUI notification.
      // The actual post-TUI banner is printed by the process.on("exit") handler
      // registered in registerProcessHandlers() — it fires after the TUI
      // restores the terminal to its original state.
      ctx.ui.notify(
        `📋 Session: ${id}\n↩️  Resume: ${resumeCmd}\n🔀 Fork:   ${forkCmd}`,
        "info"
      );
    } else {
      // Non-TUI mode: write directly to stderr now.
      // No exit handler output — the exit handler only runs for TUI mode.
      process.stderr.write(`\nSession: ${id}\nResume: ${resumeCmd}\nFork:   ${forkCmd}\n`);
    }
  });
}
