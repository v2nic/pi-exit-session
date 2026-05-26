import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_shutdown", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const sessionFile = ctx.sessionManager.getSessionFile();
    const id = sessionId || sessionFile;

    if (!id) {
      // Ephemeral session (--no-session), nothing to resume
      return;
    }

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