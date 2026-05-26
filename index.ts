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
      ctx.ui.notify(
        `📋 Session: ${id}\n↩️  Resume: ${resumeCmd}\n🔀 Fork:   ${forkCmd}`,
        "info"
      );
    } else {
      process.stderr.write(`\nSession: ${id}\nResume: ${resumeCmd}\nFork:   ${forkCmd}\n`);
    }
  });
}