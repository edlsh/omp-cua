import { expect, test } from "bun:test";
import desktop, { DESKTOP_PROMPT } from "../src/index.ts";
import { actParameters, driverParameters, observeParameters } from "@edlsh/cua-core";
import type { DesktopAPI, DesktopTool } from "../src/host.ts";

test("default export registers OMP tools with approval tiers, strict:false, and Draft-7 schemas", async () => {
  const tools = new Map<string, DesktopTool>();
  const commands = new Map<string, { description: string; getArgumentCompletions(prefix: string): { value: string; label: string }[] }>();
  const events = new Map<string, Function[]>();
  const api: DesktopAPI = {
    registerTool: tool => { tools.set(tool.name, tool); },
    registerCommand: (name, command) => { commands.set(name, command); },
    on: (event: string, handler: Function) => { events.set(event, [...(events.get(event) ?? []), handler]); },
  };
  desktop(api);

  expect([...tools.keys()]).toEqual(["desktop_observe", "desktop_act", "desktop_driver"]);
  expect(tools.get("desktop_observe")!.approval).toBe("read");
  expect(tools.get("desktop_act")!.approval).toBe("exec");
  expect(tools.get("desktop_driver")!.approval).toBe("exec");
  for (const tool of tools.values()) {
    expect(tool.strict).toBe(false);
    expect(tool.parameters.$schema).toContain("draft-07");
  }
  expect(commands.get("desktop")!.getArgumentCompletions("j").map(c => c.value)).toEqual(["jev on", "jev off"]);
  expect([...events.keys()].sort()).toEqual(["before_agent_start", "context", "session_shutdown", "session_switch"]);

  const promptResult = events.get("before_agent_start")![0]!({ systemPrompt: ["base"] }, {}) as { systemPrompt: string[] };
  expect(promptResult.systemPrompt).toEqual(["base", DESKTOP_PROMPT]);
});

test("schema enforces exact drag tuple length and clipboard single-field contract", () => {
  expect(actParameters.safeParse({ steps: [{ op: "drag", from: [1, 2], to: [3, 4] }] }).success).toBe(true);
  for (const bad of [[], [1], [1, 2, 3], ["bad", 2]]) {
    expect(actParameters.safeParse({ steps: [{ op: "drag", from: bad, to: [3, 4] }] }).success).toBe(false);
  }
  expect(actParameters.safeParse({ steps: [{ op: "clipboard" }] }).success).toBe(false);
  expect(actParameters.safeParse({ steps: [{ op: "clipboard", text: "a", file_path: "/tmp/a" }] }).success).toBe(false);
  expect(actParameters.safeParse({ steps: [{ op: "clipboard", image_path: "/tmp/a.png" }] }).success).toBe(true);
  expect(observeParameters.safeParse({ action: "state", since: "latest" }).success).toBe(true);
  expect(driverParameters.safeParse({ tool: "health_report" }).success).toBe(true);
});
