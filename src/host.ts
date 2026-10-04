/** The small host surface used by desktop tools, shared by Pi and OMP. */
export interface DesktopContext {
  sessionManager: { getSessionId(): string };
  hasUI: boolean;
  ui: {
    notify(message: string, level?: "info" | "warning" | "error"): void;
    setStatus(key: string, text: string | undefined): void;
  };
}

export interface DesktopResult {
  content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];
  details: Record<string, unknown>;
  isError?: boolean;
}

export interface DesktopTool {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  loadMode?: "essential";
  approval?: "read" | "exec";
  strict?: false;
  annotations?: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
  execute(id: string, input: unknown, signal: AbortSignal | undefined, onUpdate: unknown, ctx: DesktopContext): Promise<DesktopResult>;
}

export interface PromptEvent {
  systemPrompt: readonly string[] | string;
  systemPromptOptions?: { promptGuidelines: string[] };
}

export interface DesktopAPI {
  registerTool(tool: DesktopTool): void;
  registerCommand(name: string, command: {
    description: string;
    getArgumentCompletions(prefix: string): { value: string; label: string }[];
    handler(args: string, ctx: DesktopContext): Promise<void>;
  }): void;
  on(event: "before_agent_start", handler: (event: PromptEvent, ctx: DesktopContext) => void): void;
  on(event: "context", handler: (event: { messages: { role?: string; toolName?: string; content?: unknown }[] }, ctx: DesktopContext) => void): void;
  // Pi replaces its runtime on session changes; OMP retains it and emits session_switch.
  on(event: "session_switch" | "session_shutdown", handler: (event: unknown, ctx: DesktopContext) => Promise<void>): void;
}
