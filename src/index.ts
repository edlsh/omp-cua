import { createDesktopCore, formatSessionLabel, type DesktopHostAdapter, type DesktopOptions } from "@edlsh/cua-core";
import type { DesktopAPI, PromptEvent } from "./host.ts";

export { DesktopBackend, JEV_PROMPT, pruneScreenshots, redactTree, type DesktopOptions } from "@edlsh/cua-core";

export const DESKTOP_PROMPT = "For native macOS apps and windows, use desktop_observe and desktop_act (omp-cua), not AppleScript, shell UI scripting, or the eval `computer` prelude. Loop: desktop_observe action=state (use query to find a control) → desktop_act by [N] index, batching steps → read the returned state. Request screenshots only when the element tree is not enough.";

export function sessionLabel(sessionId: string, profile = process.env.OMP_PROFILE || "default"): string {
  return formatSessionLabel("omp", sessionId, profile);
}

function toolArguments(input: unknown): unknown {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return input;
  // OMP's eval bridge forwards intent metadata to extension callbacks; drop only that reserved field.
  const { i: _intent, ...args } = input as Record<string, unknown>;
  return args;
}

const ADAPTER: DesktopHostAdapter = {
  packageName: "omp-cua",
  sessionPrefix: "omp",
  profileEnvVar: "OMP_PROFILE",
  defaultAgentDirHost: "omp",
  connectionSymbol: "omp-cua.cua-driver",
  desktopPrompt: DESKTOP_PROMPT,
  normalizeToolArguments: toolArguments,
  toolMeta: name => ({ approval: name === "desktop_observe" ? "read" : "exec", strict: false }),
  appendSystemPrompt(event: PromptEvent, lines: string[]): { systemPrompt: string[] } {
    return { systemPrompt: [...event.systemPrompt, ...lines] };
  },
  hasSessionSwitch: true,
  resolveAgentDir: (api: DesktopAPI) => api.pi?.getAgentDir(),
};

export function createDesktopExtension(options: DesktopOptions = {}): (pi: DesktopAPI) => void {
  return createDesktopCore(ADAPTER, options);
}

export default createDesktopExtension();
