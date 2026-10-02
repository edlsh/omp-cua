// Live smoke test against the real driver. Read-only unless SMOKE_ACT=1 (then drives Calculator).
import extension from "../src/index.ts";

const tools = new Map<string, any>();
const handlers = new Map<string, Function[]>();
const pi: any = {
  registerTool: (tool: any) => tools.set(tool.name, tool),
  registerCommand: () => {},
  on: (event: string, handler: Function) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
};
extension(pi);
const ctx: any = { sessionManager: { getSessionId: () => "smoke-0001" }, hasUI: false, cwd: process.cwd() };

async function run(name: string, args: unknown) {
  const start = performance.now();
  const result = await tools.get(name).execute("id", args, undefined, undefined, ctx);
  const ms = Math.round(performance.now() - start);
  const text = result.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
  const images = result.content.filter((part: any) => part.type === "image").map((part: any) => `${part.mimeType} ${Math.round(part.data.length / 1024)}KB`);
  console.log(`\n### ${name} ${JSON.stringify(args)} (${ms}ms)${result.isError ? " ERROR" : ""} ${images.join(", ")}\n${text.slice(0, 1800)}`);
  return result;
}

await run("desktop_observe", { action: "permissions" });
await run("desktop_observe", { action: "windows" });
await run("desktop_observe", { action: "state", app: "Finder", max_elements: 40 });
await run("desktop_observe", { action: "state", query: "recents" });
await run("desktop_observe", { action: "screenshot", max_image_dimension: 800 });
if (process.env.SMOKE_ACT === "1") {
  await run("desktop_act", { steps: [{ op: "launch", bundle_id: "com.apple.calculator" }], observe: false });
  await run("desktop_observe", { action: "state", app: "Calculator", query: "7" });
  const state = await run("desktop_observe", { action: "state", app: "Calculator", max_elements: 120 });
  const tree = state.content[0].text as string;
  const key = (label: string) => Number(tree.split("\n").find(line => new RegExp(`AXButton \\(${label}\\)|AXButton "${label}"`).test(line))?.match(/\[(\d+)\]/)?.[1]);
  const seven = key("7"), clear = key("All Clear") || key("Clear");
  console.log("indices", { seven, clear });
  if (Number.isFinite(seven)) {
    const steps = [...(Number.isFinite(clear) ? [{ op: "click", index: clear }] : []), { op: "click", index: seven }, { op: "click", index: seven }];
    await run("desktop_act", { app: "Calculator", steps, verify: [{ role: "AXStaticText", value: "77" }], query: "77" });
    // invoke_menu needs the app frontmost; a foreground hotkey quits without that precondition.
    await run("desktop_act", { app: "Calculator", steps: [{ op: "hotkey", keys: ["cmd", "q"], delivery: "foreground" }], observe: false });
  }
}
for (const handler of handlers.get("session_shutdown") ?? []) await handler({}, ctx);
