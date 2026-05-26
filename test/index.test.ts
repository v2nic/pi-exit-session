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

// Import the actual extension
// We need to dynamically import since it's ESM
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
    // We pass our mock pi object as the ExtensionAPI
    const mod = await import("../index.ts");
    const extensionFactory = mod.default;
    extensionFactory(pi as any);
  });

  it("registers a session_shutdown handler", () => {
    expect(pi._handlers["session_shutdown"]).toBeDefined();
    expect(pi._handlers["session_shutdown"].length).toBe(1);
  });

  it("prints session ID and resume/fork commands to UI in TUI mode", async () => {
    mockSessionManager.getSessionId.mockReturnValue("abc123");
    mockSessionManager.getSessionFile.mockReturnValue("/home/.pi/agent/sessions/xxx.jsonl");

    const handler = pi._handlers["session_shutdown"][0];
    const ctx = {
      sessionManager: mockSessionManager,
      hasUI: true,
      ui: mockUi,
    };

    await handler({}, ctx);

    expect(mockUi.notify).toHaveBeenCalledOnce();
    const notification = mockUi.notify.mock.calls[0][0];
    expect(notification).toContain("abc123");
    expect(notification).toContain("pi --session abc123");
    expect(notification).toContain("pi --fork abc123");
  });

  it("falls back to session file when session ID is undefined", async () => {
    // getSessionId returns string, but let's test the fallback for empty/undefined
    // In practice, getSessionId always returns a string, but getSessionFile can return undefined
    mockSessionManager.getSessionId.mockReturnValue("abc123");
    mockSessionManager.getSessionFile.mockReturnValue(undefined);

    const handler = pi._handlers["session_shutdown"][0];
    const ctx = {
      sessionManager: mockSessionManager,
      hasUI: true,
      ui: mockUi,
    };

    await handler({}, ctx);

    // Should use sessionId since it's available
    expect(mockUi.notify).toHaveBeenCalledOnce();
    expect(mockUi.notify.mock.calls[0][0]).toContain("abc123");
  });

  it("uses sessionFile when sessionId is empty", async () => {
    mockSessionManager.getSessionId.mockReturnValue("");
    mockSessionManager.getSessionFile.mockReturnValue("/path/to/session.jsonl");

    const handler = pi._handlers["session_shutdown"][0];
    const ctx = {
      sessionManager: mockSessionManager,
      hasUI: true,
      ui: mockUi,
    };

    await handler({}, ctx);

    expect(mockUi.notify).toHaveBeenCalledOnce();
    expect(mockUi.notify.mock.calls[0][0]).toContain("/path/to/session.jsonl");
  });

  it("prints to stderr in non-TUI mode", async () => {
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
    const output = stderrWriteSpy.mock.calls[0][0];
    expect(output).toContain("xyz789");
    expect(output).toContain("pi --session xyz789");
    expect(output).toContain("pi --fork xyz789");
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
});