import { describe, it, expect, vi, beforeEach } from "vitest";

// We import the extension factory function.
// Since the extension uses ESM default export, we'll test the logic
// by creating mocks for the pi API and verifying the side effects.

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

describe("pi-exit-session extension", () => {
  let pi: ReturnType<typeof createMockPi>["pi"];
  let mockSessionManager: ReturnType<typeof createMockPi>["mockSessionManager"];
  let mockUi: ReturnType<typeof createMockPi>["mockUi"];

  beforeEach(async () => {
    vi.clearAllMocks();
    stderrWriteSpy.mockClear();

    const mock = createMockPi();
    pi = mock.pi;
    mockSessionManager = mock.mockSessionManager;
    mockUi = mock.mockUi;

    // Dynamically import the extension to register its handlers
    const mod = await import("../index.ts");
    const extensionFactory = mod.default;
    extensionFactory(pi as any);
  });

  it("registers a session_shutdown handler", () => {
    expect(pi._handlers["session_shutdown"]).toBeDefined();
    expect(pi._handlers["session_shutdown"].length).toBe(1);
  });

  it("shows notify and registers exit banner in TUI mode", async () => {
    mockSessionManager.getSessionId.mockReturnValue("abc123");
    mockSessionManager.getSessionFile.mockReturnValue("/home/.pi/agent/sessions/xxx.jsonl");

    // Capture process.on('exit') registrations
    const exitHandlers: Function[] = [];
    const origProcessOn = process.on.bind(process);
    const processOnSpy = vi.spyOn(process, "on").mockImplementation((event: string, handler: Function) => {
      if (event === "exit") {
        exitHandlers.push(handler);
      }
      return origProcessOn(event, handler) as typeof process;
    });

    const handler = pi._handlers["session_shutdown"][0];
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

    // Should register an exit handler that writes the banner
    expect(exitHandlers.length).toBe(1);

    // Simulate process exit — the exit handler should write ANSI-colored output to stderr
    stderrWriteSpy.mockClear();
    exitHandlers[0](); // call the exit handler
    expect(stderrWriteSpy).toHaveBeenCalledOnce();
    const output = stderrWriteSpy.mock.calls[0][0] as string;
    expect(output).toContain("Session ended");
    expect(output).toContain("pi --session abc123");
    expect(output).toContain("pi --fork abc123");
    expect(output).toContain("\x1b[1m"); // bold ANSI code

    processOnSpy.mockRestore();
  });

  it("uses sessionFile when sessionId is empty", async () => {
    mockSessionManager.getSessionId.mockReturnValue("");
    mockSessionManager.getSessionFile.mockReturnValue("/path/to/session.jsonl");

    const exitHandlers: Function[] = [];
    const processOnSpy = vi.spyOn(process, "on").mockImplementation((event: string, handler: Function) => {
      if (event === "exit") exitHandlers.push(handler);
      return process;
    });

    const handler = pi._handlers["session_shutdown"][0];
    const ctx = {
      sessionManager: mockSessionManager,
      hasUI: true,
      ui: mockUi,
    };

    await handler({}, ctx);

    expect(mockUi.notify).toHaveBeenCalledOnce();
    expect(mockUi.notify.mock.calls[0][0]).toContain("/path/to/session.jsonl");

    // Exit handler should use session file path
    stderrWriteSpy.mockClear();
    exitHandlers[0]();
    expect(stderrWriteSpy.mock.calls[0][0]).toContain("/path/to/session.jsonl");

    processOnSpy.mockRestore();
  });

  it("prints plain text to stderr in non-TUI mode", async () => {
    mockSessionManager.getSessionId.mockReturnValue("xyz789");
    mockSessionManager.getSessionFile.mockReturnValue("/home/.pi/sessions/xyz.jsonl");

    const handler = pi._handlers["session_shutdown"][0];
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

    const handler = pi._handlers["session_shutdown"][0];
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

    const exitHandlers: Function[] = [];
    const processOnSpy = vi.spyOn(process, "on").mockImplementation((event: string, handler: Function) => {
      if (event === "exit") exitHandlers.push(handler);
      return process;
    });

    const handler = pi._handlers["session_shutdown"][0];
    const ctx = {
      sessionManager: mockSessionManager,
      hasUI: true,
      ui: mockUi,
    };

    await handler({}, ctx);

    // Notify should use the short session ID
    expect(mockUi.notify.mock.calls[0][0]).toContain("short-id-42");

    // Exit banner should also use the short session ID
    stderrWriteSpy.mockClear();
    exitHandlers[0]();
    expect(stderrWriteSpy.mock.calls[0][0]).toContain("short-id-42");
    expect(stderrWriteSpy.mock.calls[0][0]).toContain("pi --session short-id-42");

    processOnSpy.mockRestore();
  });
});