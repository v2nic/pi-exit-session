import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatCrashBanner, onProcessError, type SessionInfo, _testReset } from "../index.ts";
import extensionFactory from "../index.ts";

// Mock process.stderr.write
const stderrWriteSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

// Create a mock ExtensionAPI that records calls
function createMockPi() {
  const handlers: Record<string, Function[]> = {};
  const mockSessionManager = {
    getSessionId: vi.fn(),
    getSessionFile: vi.fn(),
  };
  const mockUi = {
    notify: vi.fn(),
  };

  const pi = {
    on(event: string, handler: Function) {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    },
    _handlers: handlers,
    _sessionManager: mockSessionManager,
    _ui: mockUi,
  };

  return { pi, mockSessionManager, mockUi, handlers };
}

describe("formatCrashBanner", () => {
  it("formats TUI crash banner with ANSI codes", () => {
    const info: SessionInfo = {
      id: "abc123",
      sessionFile: "/home/.pi/sessions/abc.jsonl",
      hasUI: true,
    };

    const banner = formatCrashBanner(info);

    expect(banner).toContain("Session crashed");
    expect(banner).toContain("abc123");
    expect(banner).toContain("pi --session abc123");
    expect(banner).toContain("pi --fork abc123");
    expect(banner).toContain("/home/.pi/sessions/abc.jsonl");
    expect(banner).toContain("\x1b[1m"); // bold
    expect(banner).toContain("\x1b[33m"); // yellow (file)
    expect(banner).toContain("\x1b[36m"); // cyan (resume)
    expect(banner).toContain("\x1b[35m"); // magenta (fork)
  });

  it("formats plain-text crash banner without ANSI codes", () => {
    const info: SessionInfo = {
      id: "xyz789",
      sessionFile: "/home/.pi/sessions/xyz.jsonl",
      hasUI: false,
    };

    const banner = formatCrashBanner(info);

    expect(banner).toContain("Session crashed");
    expect(banner).toContain("xyz789");
    expect(banner).toContain("pi --session xyz789");
    expect(banner).toContain("pi --fork xyz789");
    expect(banner).toContain("/home/.pi/sessions/xyz.jsonl");
    expect(banner).not.toContain("\x1b["); // no ANSI escape codes
  });

  it("shows (unknown) when sessionFile is undefined", () => {
    const info: SessionInfo = {
      id: "short-id",
      sessionFile: undefined,
      hasUI: true,
    };

    const banner = formatCrashBanner(info);

    expect(banner).toContain("(unknown)");
  });

  it("uses sessionFile path as id when sessionId is empty", () => {
    const info: SessionInfo = {
      id: "/path/to/session.jsonl",
      sessionFile: "/path/to/session.jsonl",
      hasUI: false,
    };

    const banner = formatCrashBanner(info);

    expect(banner).toContain("pi --session /path/to/session.jsonl");
    expect(banner).toContain("pi --fork /path/to/session.jsonl");
  });
});

describe("onProcessError", () => {
  beforeEach(() => {
    stderrWriteSpy.mockClear();
    // Reset module-scoped state between tests
    _testReset();
  });

  it("returns false and writes nothing when no session info is set", () => {
    const result = onProcessError();
    expect(result).toBe(false);
    expect(stderrWriteSpy).not.toHaveBeenCalled();
  });

  it("writes crash banner and returns true when session info is set (TUI mode)", () => {
    const info: SessionInfo = {
      id: "crash-session-1",
      sessionFile: "/home/.pi/sessions/crash.jsonl",
      hasUI: true,
    };
    _testReset(info);

    const result = onProcessError();

    expect(result).toBe(true);
    expect(stderrWriteSpy).toHaveBeenCalledOnce();
    const output = stderrWriteSpy.mock.calls[0][0] as string;
    expect(output).toContain("Session crashed");
    expect(output).toContain("crash-session-1");
    expect(output).toContain("pi --session crash-session-1");
    expect(output).toContain("pi --fork crash-session-1");
    expect(output).toContain("/home/.pi/sessions/crash.jsonl");
    expect(output).toContain("\x1b[1m"); // bold ANSI code
  });

  it("writes plain-text crash banner when session info has hasUI=false", () => {
    const info: SessionInfo = {
      id: "plain-crash-3",
      sessionFile: "/home/.pi/sessions/plain.jsonl",
      hasUI: false,
    };
    _testReset(info);

    const result = onProcessError();

    expect(result).toBe(true);
    expect(stderrWriteSpy).toHaveBeenCalledOnce();
    const output = stderrWriteSpy.mock.calls[0][0] as string;
    expect(output).toContain("Session crashed");
    expect(output).toContain("plain-crash-3");
    expect(output).toContain("pi --session plain-crash-3");
    expect(output).not.toContain("\x1b["); // no ANSI codes
  });

  it("uses sessionFile as id when sessionId is empty", () => {
    const info: SessionInfo = {
      id: "/home/.pi/sessions/no-id.jsonl",
      sessionFile: "/home/.pi/sessions/no-id.jsonl",
      hasUI: true,
    };
    _testReset(info);

    const result = onProcessError();

    expect(result).toBe(true);
    const output = stderrWriteSpy.mock.calls[0][0] as string;
    expect(output).toContain("/home/.pi/sessions/no-id.jsonl");
    expect(output).toContain("pi --session /home/.pi/sessions/no-id.jsonl");
  });
});

describe("pi-exit-session extension", () => {
  let pi: ReturnType<typeof createMockPi>["pi"];
  let mockSessionManager: ReturnType<typeof createMockPi>["mockSessionManager"];
  let mockUi: ReturnType<typeof createMockPi>["mockUi"];

  beforeEach(async () => {
    vi.clearAllMocks();
    stderrWriteSpy.mockClear();
    // Reset module-scoped state between tests
    _testReset();

    const mock = createMockPi();
    pi = mock.pi;
    mockSessionManager = mock.mockSessionManager;
    mockUi = mock.mockUi;

    // Re-initialize the extension using the statically imported factory.
    // _testReset() above already cleared module-scoped state.
    extensionFactory(pi as any);
  });

  it("registers a session_shutdown handler", () => {
    expect(pi._handlers["session_shutdown"]).toBeDefined();
    expect(pi._handlers["session_shutdown"].length).toBeGreaterThanOrEqual(1);
  });

  it("registers a session_start handler", () => {
    expect(pi._handlers["session_start"]).toBeDefined();
    expect(pi._handlers["session_start"].length).toBeGreaterThanOrEqual(1);
  });

  it("shows notify in TUI mode and exit banner reads latest session info", async () => {
    mockSessionManager.getSessionId.mockReturnValue("abc123");
    mockSessionManager.getSessionFile.mockReturnValue("/home/.pi/agent/sessions/xxx.jsonl");

    const handler = pi._handlers["session_shutdown"][pi._handlers["session_shutdown"].length - 1];
    const ctx = {
      sessionManager: mockSessionManager,
      hasUI: true,
      ui: mockUi,
    };

    await handler({}, ctx);

    // Should show in-TUI notification
    expect(mockUi.notify).toHaveBeenCalledOnce();
    const notification = mockUi.notify.mock.calls[0][0];
    expect(notification).toContain("abc123");
    expect(notification).toContain("pi --session abc123");
    expect(notification).toContain("pi --fork abc123");

    // The exit banner is written by the process.on("exit") handler registered
    // once in registerProcessHandlers(). It reads session info at exit time.
    // Verify it would produce the correct output by calling onProcessError().
    stderrWriteSpy.mockClear();
    onProcessError();
    const output = stderrWriteSpy.mock.calls[0][0] as string;
    expect(output).toContain("Session crashed"); // crash banner shape
    expect(output).toContain("pi --session abc123");
    expect(output).toContain("pi --fork abc123");
    expect(output).toContain("\x1b[1m"); // bold ANSI code
  });

  it("uses sessionFile when sessionId is empty", async () => {
    mockSessionManager.getSessionId.mockReturnValue("");
    mockSessionManager.getSessionFile.mockReturnValue("/path/to/session.jsonl");

    const handler = pi._handlers["session_shutdown"][pi._handlers["session_shutdown"].length - 1];
    const ctx = {
      sessionManager: mockSessionManager,
      hasUI: true,
      ui: mockUi,
    };

    await handler({}, ctx);

    expect(mockUi.notify).toHaveBeenCalledOnce();
    expect(mockUi.notify.mock.calls[0][0]).toContain("/path/to/session.jsonl");

    // Session info is stored globally; verify it contains the file path
    stderrWriteSpy.mockClear();
    onProcessError();
    expect(stderrWriteSpy.mock.calls[0][0]).toContain("/path/to/session.jsonl");
  });

  it("prints plain text to stderr in non-TUI mode", async () => {
    mockSessionManager.getSessionId.mockReturnValue("xyz789");
    mockSessionManager.getSessionFile.mockReturnValue("/home/.pi/sessions/xyz.jsonl");

    const handler = pi._handlers["session_shutdown"][pi._handlers["session_shutdown"].length - 1];
    const ctx = {
      sessionManager: mockSessionManager,
      hasUI: false,
      ui: mockUi,
    };

    await handler({}, ctx);

    expect(stderrWriteSpy).toHaveBeenCalledOnce();
    const output = stderrWriteSpy.mock.calls[0][0] as string;
    expect(output).toContain("xyz789");
    expect(output).toContain("pi --session xyz789");
    expect(output).toContain("pi --fork xyz789");
    // Non-TUI should NOT have ANSI codes for the banner header
    expect(output).not.toContain("\x1b[1m📋");
    expect(mockUi.notify).not.toHaveBeenCalled();
  });

  it("does nothing for ephemeral sessions (no ID and no file)", async () => {
    mockSessionManager.getSessionId.mockReturnValue("");
    mockSessionManager.getSessionFile.mockReturnValue(undefined);

    const handler = pi._handlers["session_shutdown"][pi._handlers["session_shutdown"].length - 1];
    const ctx = {
      sessionManager: mockSessionManager,
      hasUI: true,
      ui: mockUi,
    };

    await handler({}, ctx);

    expect(mockUi.notify).not.toHaveBeenCalled();
    expect(stderrWriteSpy).not.toHaveBeenCalled();
  });

  it("prefers sessionId over sessionFile when both are available", async () => {
    mockSessionManager.getSessionId.mockReturnValue("short-id-42");
    mockSessionManager.getSessionFile.mockReturnValue("/long/path/to/session.jsonl");

    const handler = pi._handlers["session_shutdown"][pi._handlers["session_shutdown"].length - 1];
    const ctx = {
      sessionManager: mockSessionManager,
      hasUI: true,
      ui: mockUi,
    };

    await handler({}, ctx);

    // Notify should use the short session ID
    expect(mockUi.notify.mock.calls[0][0]).toContain("short-id-42");

    // Session info stored globally should also use the short session ID
    stderrWriteSpy.mockClear();
    onProcessError();
    expect(stderrWriteSpy.mock.calls[0][0]).toContain("short-id-42");
    expect(stderrWriteSpy.mock.calls[0][0]).toContain("pi --session short-id-42");
  });

  describe("session_start handler integration", () => {
    it("captures session info that onProcessError can use", async () => {
      mockSessionManager.getSessionId.mockReturnValue("start-id-99");
      mockSessionManager.getSessionFile.mockReturnValue("/home/.pi/sessions/start.jsonl");

      const startHandler = pi._handlers["session_start"][pi._handlers["session_start"].length - 1];
      await startHandler({}, {
        sessionManager: mockSessionManager,
        hasUI: true,
        ui: mockUi,
      });

      // Now onProcessError should print the crash banner
      stderrWriteSpy.mockClear();
      const result = onProcessError();

      expect(result).toBe(true);
      expect(stderrWriteSpy).toHaveBeenCalledOnce();
      const output = stderrWriteSpy.mock.calls[0][0] as string;
      expect(output).toContain("start-id-99");
      expect(output).toContain("pi --session start-id-99");
      expect(output).toContain("/home/.pi/sessions/start.jsonl");
    });

    it("does not capture info for ephemeral sessions", async () => {
      // Reset to clear any previous session info
      _testReset();

      mockSessionManager.getSessionId.mockReturnValue("");
      mockSessionManager.getSessionFile.mockReturnValue(undefined);

      const startHandler = pi._handlers["session_start"][pi._handlers["session_start"].length - 1];
      await startHandler({}, {
        sessionManager: mockSessionManager,
        hasUI: true,
        ui: mockUi,
      });

      // onProcessError should return false — no session info captured
      stderrWriteSpy.mockClear();
      const result = onProcessError();

      expect(result).toBe(false);
      expect(stderrWriteSpy).not.toHaveBeenCalled();
    });

    it("session_shutdown updates session info used by onProcessError", async () => {
      // First set session info via session_start
      mockSessionManager.getSessionId.mockReturnValue("old-id");
      mockSessionManager.getSessionFile.mockReturnValue("/old/path.jsonl");

      const startHandler = pi._handlers["session_start"][pi._handlers["session_start"].length - 1];
      await startHandler({}, {
        sessionManager: mockSessionManager,
        hasUI: true,
        ui: mockUi,
      });

      // Then update via session_shutdown
      mockSessionManager.getSessionId.mockReturnValue("updated-id");
      mockSessionManager.getSessionFile.mockReturnValue("/updated/path.jsonl");

      const shutdownHandler = pi._handlers["session_shutdown"][pi._handlers["session_shutdown"].length - 1];
      await shutdownHandler({ type: "session_shutdown", reason: "quit" }, {
        sessionManager: mockSessionManager,
        hasUI: true,
        ui: mockUi,
      });

      // onProcessError should use the updated session info
      stderrWriteSpy.mockClear();
      onProcessError();

      expect(stderrWriteSpy).toHaveBeenCalledOnce();
      const output = stderrWriteSpy.mock.calls[0][0] as string;
      expect(output).toContain("updated-id");
      expect(output).toContain("pi --session updated-id");
    });
  });
});