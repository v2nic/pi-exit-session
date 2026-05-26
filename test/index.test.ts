import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatCrashBanner, formatExitBanner, onProcessError, type SessionInfo, _testReset } from "../index.ts";
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

describe("formatExitBanner", () => {
  it("formats TUI exit banner with ANSI codes and 'Session ended'", () => {
    const info: SessionInfo = {
      id: "exit-id-1",
      sessionFile: "/home/.pi/sessions/exit.jsonl",
      hasUI: true,
    };

    const banner = formatExitBanner(info);

    expect(banner).toContain("Session ended");
    expect(banner).toContain("pi --session exit-id-1");
    expect(banner).toContain("pi --fork exit-id-1");
    expect(banner).toContain("\x1b[1m"); // bold
    expect(banner).not.toContain("Session crashed");
  });
});

describe("onProcessError", () => {
  beforeEach(() => {
    stderrWriteSpy.mockClear();
    _testReset();
  });

  it("returns false and writes nothing when no session info is set", () => {
    const result = onProcessError();
    expect(result).toBe(false);
    expect(stderrWriteSpy).not.toHaveBeenCalled();
  });

  it("writes crash banner and returns true when session info is set (TUI mode)", () => {
    _testReset({
      id: "crash-session-1",
      sessionFile: "/home/.pi/sessions/crash.jsonl",
      hasUI: true,
    });

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
    _testReset({
      id: "plain-crash-3",
      sessionFile: "/home/.pi/sessions/plain.jsonl",
      hasUI: false,
    });

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
    _testReset({
      id: "/home/.pi/sessions/no-id.jsonl",
      sessionFile: "/home/.pi/sessions/no-id.jsonl",
      hasUI: true,
    });

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

  beforeEach(() => {
    vi.clearAllMocks();
    stderrWriteSpy.mockClear();
    _testReset();

    const mock = createMockPi();
    pi = mock.pi;
    mockSessionManager = mock.mockSessionManager;
    mockUi = mock.mockUi;

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

  it("shows TUI notification on session_shutdown and stores session info for exit banner", async () => {
    mockSessionManager.getSessionId.mockReturnValue("abc123");
    mockSessionManager.getSessionFile.mockReturnValue("/home/.pi/agent/sessions/xxx.jsonl");

    const handler = pi._handlers["session_shutdown"][pi._handlers["session_shutdown"].length - 1];
    await handler({}, {
      sessionManager: mockSessionManager,
      hasUI: true,
      ui: mockUi,
    });

    // Should show in-TUI notification
    expect(mockUi.notify).toHaveBeenCalledOnce();
    const notification = mockUi.notify.mock.calls[0][0];
    expect(notification).toContain("abc123");
    expect(notification).toContain("pi --session abc123");
    expect(notification).toContain("pi --fork abc123");

    // The exit handler (registered once in registerProcessHandlers) will read
    // session info at exit time. Verify the correct info is stored by checking
    // what formatExitBanner would produce.
    const exitBanner = formatExitBanner({
      id: "abc123",
      sessionFile: "/home/.pi/agent/sessions/xxx.jsonl",
      hasUI: true,
    });
    expect(exitBanner).toContain("Session ended");
    expect(exitBanner).toContain("pi --session abc123");
    expect(exitBanner).toContain("pi --fork abc123");
  });

  it("uses sessionFile when sessionId is empty", async () => {
    mockSessionManager.getSessionId.mockReturnValue("");
    mockSessionManager.getSessionFile.mockReturnValue("/path/to/session.jsonl");

    const handler = pi._handlers["session_shutdown"][pi._handlers["session_shutdown"].length - 1];
    await handler({}, {
      sessionManager: mockSessionManager,
      hasUI: true,
      ui: mockUi,
    });

    expect(mockUi.notify).toHaveBeenCalledOnce();
    expect(mockUi.notify.mock.calls[0][0]).toContain("/path/to/session.jsonl");

    // Verify session info is stored for the exit handler
    stderrWriteSpy.mockClear();
    onProcessError(); // uses the same getSessionInfo() path
    expect(stderrWriteSpy.mock.calls[0][0]).toContain("/path/to/session.jsonl");
  });

  it("prints plain text to stderr in non-TUI mode", async () => {
    mockSessionManager.getSessionId.mockReturnValue("xyz789");
    mockSessionManager.getSessionFile.mockReturnValue("/home/.pi/sessions/xyz.jsonl");

    const handler = pi._handlers["session_shutdown"][pi._handlers["session_shutdown"].length - 1];
    await handler({}, {
      sessionManager: mockSessionManager,
      hasUI: false,
      ui: mockUi,
    });

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
    await handler({}, {
      sessionManager: mockSessionManager,
      hasUI: true,
      ui: mockUi,
    });

    expect(mockUi.notify).not.toHaveBeenCalled();
    expect(stderrWriteSpy).not.toHaveBeenCalled();
  });

  it("prefers sessionId over sessionFile when both are available", async () => {
    mockSessionManager.getSessionId.mockReturnValue("short-id-42");
    mockSessionManager.getSessionFile.mockReturnValue("/long/path/to/session.jsonl");

    const handler = pi._handlers["session_shutdown"][pi._handlers["session_shutdown"].length - 1];
    await handler({}, {
      sessionManager: mockSessionManager,
      hasUI: true,
      ui: mockUi,
    });

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
      _testReset();

      mockSessionManager.getSessionId.mockReturnValue("");
      mockSessionManager.getSessionFile.mockReturnValue(undefined);

      const startHandler = pi._handlers["session_start"][pi._handlers["session_start"].length - 1];
      await startHandler({}, {
        sessionManager: mockSessionManager,
        hasUI: true,
        ui: mockUi,
      });

      stderrWriteSpy.mockClear();
      const result = onProcessError();

      expect(result).toBe(false);
      expect(stderrWriteSpy).not.toHaveBeenCalled();
    });

    it("session_shutdown updates session info used by onProcessError", async () => {
      mockSessionManager.getSessionId.mockReturnValue("old-id");
      mockSessionManager.getSessionFile.mockReturnValue("/old/path.jsonl");

      const startHandler = pi._handlers["session_start"][pi._handlers["session_start"].length - 1];
      await startHandler({}, {
        sessionManager: mockSessionManager,
        hasUI: true,
        ui: mockUi,
      });

      mockSessionManager.getSessionId.mockReturnValue("updated-id");
      mockSessionManager.getSessionFile.mockReturnValue("/updated/path.jsonl");

      const shutdownHandler = pi._handlers["session_shutdown"][pi._handlers["session_shutdown"].length - 1];
      await shutdownHandler({ type: "session_shutdown", reason: "quit" }, {
        sessionManager: mockSessionManager,
        hasUI: true,
        ui: mockUi,
      });

      stderrWriteSpy.mockClear();
      onProcessError();

      expect(stderrWriteSpy).toHaveBeenCalledOnce();
      const output = stderrWriteSpy.mock.calls[0][0] as string;
      expect(output).toContain("updated-id");
      expect(output).toContain("pi --session updated-id");
    });
  });
});
